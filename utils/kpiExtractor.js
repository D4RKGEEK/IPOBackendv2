'use strict';

/**
 * kpiExtractor.js — Slice 2: pull the printed Key Performance Indicators table
 * (the "Basis for Offer Price" KPI ratios) out of an IPO prospectus, grounded
 * to page + verbatim quote, same pattern as financialsExtractor.
 *
 * Scope = ratios PRINTED in the RHP: ROE, ROCE, RoNW, Debt/Equity, PAT margin,
 * EBITDA margin, Price/Book, NAV, EPS, turnover/days, etc. Price-dependent
 * figures (post-issue P/E, market cap) are NOT extracted here — they are
 * computed from the price band elsewhere.
 *
 * Hardening vs v1:
 *   - heading-aware, global top-N page selection (better coverage)
 *   - canonical key normalisation (kills most "other" rows)
 *   - best-of-N runs to damp LLM run-to-run variance
 *   - periods (and all values) normalised newest-first by date
 */

const { completeJson } = require('./llmClient');
const { readPageTexts, isQuoteGrounded } = require('./financialsExtractor');

// Strong heading signals — these almost always sit on the KPI page.
const HEADING_SIGNALS = [
  /key\s+performance\s+indicator/i,
  /basis\s+for\s+(?:the\s+)?(?:offer|issue)\s+price/i,
];
// Row-level signals.
const KPI_SIGNALS = [
  /\broce\b|return\s+on\s+capital\s+employed/i,
  /\broe\b|return\s+on\s+equity/i,
  /return\s+on\s+net\s+worth|\bronw\b/i,
  /debt[\s/-]+equity/i,
  /ebitda\s+margin/i,
  /pat\s+margin|net\s+profit\s+margin/i,
  /price\s+to\s+book|p\s*\/\s*bv/i,
  /current\s+ratio/i,
  /net\s+asset\s+value|nav\s+per/i,
  /(?:fixed\s+asset|inventory|debtor|receivable)\s+turnover/i,
];

const KPI_KEYS = [
  'roe', 'roce', 'ronw', 'debtEquity', 'patMargin', 'ebitdaMargin', 'grossMargin',
  'priceToBook', 'eps', 'nav', 'currentRatio', 'interestCoverage',
  'fixedAssetTurnover', 'inventoryTurnover', 'debtorDays', 'creditorDays',
  'inventoryDays', 'workingCapitalDays', 'revenueGrowth',
];

// label text -> canonical key (used to rescue rows the model tagged "other").
const ALIASES = [
  [/return\s+on\s+equity/i, 'roe'],
  [/return\s+on\s+capital\s+employed/i, 'roce'],
  [/return\s+on\s+net\s+worth/i, 'ronw'],
  [/debt[\s/-]*(?:to\s*)?equity/i, 'debtEquity'],
  [/(?:pat|net\s+profit|profit\s+after\s+tax)\s+margin/i, 'patMargin'],
  [/ebitda\s+margin/i, 'ebitdaMargin'],
  [/gross\s+(?:profit\s+)?margin/i, 'grossMargin'],
  [/price\s+to\s+book|p\s*\/\s*bv|price[-\s]to[-\s]book/i, 'priceToBook'],
  [/net\s+asset\s+value|nav\s+per/i, 'nav'],
  [/earnings?\s+per\s+share|\beps\b/i, 'eps'],
  [/current\s+ratio/i, 'currentRatio'],
  [/interest\s+coverage/i, 'interestCoverage'],
  [/fixed\s+asset\s+turnover/i, 'fixedAssetTurnover'],
  [/inventory\s+turnover/i, 'inventoryTurnover'],
  [/(?:debtor|receivable)s?\s+(?:turnover\s+)?days|days.*(?:debtor|receivable)/i, 'debtorDays'],
  [/(?:creditor|payable)s?\s+(?:turnover\s+)?days|days.*(?:creditor|payable)/i, 'creditorDays'],
  [/inventory\s+days|days.*inventory/i, 'inventoryDays'],
  [/working\s+capital\s+days/i, 'workingCapitalDays'],
  [/revenue\s+growth/i, 'revenueGrowth'],
];

/** Map a row's label to a canonical key, or return the original key/'other'. */
function canonicalizeKey(key, label) {
  if (key && key !== 'other' && KPI_KEYS.includes(key)) return key;
  const text = `${label || ''}`;
  for (const [re, canon] of ALIASES) if (re.test(text)) return canon;
  return key || 'other';
}

const SCHEMA = `{
  "periods": [ { "label": string, "endDate": string|null } ],   // as printed
  "kpis": [
    { "key": one of [${KPI_KEYS.map((k) => `"${k}"`).join(',')}] or "other",
      "label": string,            // exact row label from the document
      "unit": "%" | "x" | "ratio" | "days" | string,
      "values": [ number|null, ... ],  // aligned 1:1 with periods
      "source": { "page": number, "quote": string } }   // verbatim line incl. numbers
  ],
  "notes": string
}`;

const SYSTEM_PROMPT = `You extract the Key Performance Indicators (KPI) table from an Indian IPO prospectus (the "Basis for Offer Price" section).
Text is provided page-by-page, each prefixed with "===== PAGE N =====".

Rules — follow strictly:
- Extract EVERY KPI / ratio row present in the KPI table. Do not skip rows. Include operational KPIs too (use key "other" with the exact label).
- ONLY use numbers that literally appear in the text. NEVER compute, infer, or guess. Use null where a KPI is not reported for a period.
- "values" MUST align 1:1 with "periods", same order.
- Strip the unit from the number: "11.87%" -> 11.87 with unit "%"; "2.07" with unit "x"/"ratio". A value in parentheses (1.2) is negative -> -1.2.
- "source.page" MUST be the integer from the PAGE marker; "source.quote" MUST be copied verbatim from that page and include the row's numbers.
- Do NOT include post-issue P/E or market capitalisation (those depend on the final price). You MAY include pre-issue P/E only if printed.
- Output ONLY the JSON object. No prose, no code fences.

Schema:
${SCHEMA}`;

/** Count distinct KPI ratio-row labels present. */
function ratioRowCount(text) {
  let c = 0;
  for (const re of KPI_SIGNALS) if (re.test(text)) c++;
  return c;
}
/** Count percentage figures — a real KPI table is %-dense; prose/cover isn't. */
function percentCount(text) {
  return (text.match(/\d{1,3}(?:\.\d+)?\s*%/g) || []).length;
}

/**
 * Composite KPI-table likelihood. The actual ratio table is identified by
 * row-label density + percentage density, with a bonus for the section heading
 * and a penalty for cover / offer-structure pages that merely name the ratios.
 */
function scoreKpiPage(text) {
  if (isTocPage(text)) return 0;
  const rows = ratioRowCount(text);
  const pct = Math.min(8, percentCount(text));
  let heading = 0;
  if (/key\s+performance\s+indicator/i.test(text)) heading += 3;
  if (/basis\s+for\s+(?:the\s+)?(?:offer|issue)\s+price/i.test(text)) heading += 1;
  const coverish = /selling\s+shareholder|draft\s+red\s+herring|offer\s+for\s+sale/i.test(text) && rows < 3;
  if (rows === 0 && heading === 0) return 0; // not a KPI page at all
  return Math.max(0, rows * 2 + pct + heading - (coverish ? 5 : 0));
}

/** A page that looks like a Table of Contents (dotted leaders / many entries). */
function isTocPage(text) {
  if (/table\s+of\s+contents/i.test(text)) return true;
  return (text.match(/\.{4,}\s*\d{1,4}/g) || []).length >= 5;
}

/**
 * Select KPI pages. Strategy: anchor on the real "Key Performance Indicators" /
 * "Basis for Offer Price" heading (the table lives there and continues forward),
 * not on stray pages that merely contain ratio-like numbers (covers, summaries).
 * Assemble the tagged text highest-score-first so the true table is never
 * truncated out by the char budget.
 */
function selectKpiPages(pages, opts = {}) {
  const maxPages = opts.window || 6;
  const maxChars = opts.maxChars || 26000;
  const scores = pages.map(scoreKpiPage);

  // Anchor = densest KPI-table page (composite score), not just a heading.
  let anchor = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[anchor]) anchor = i;

  // Take the cluster around the anchor: a KPI table can span a few pages, so
  // pull in nearby pages that are themselves KPI-rich.
  const idx = new Set([anchor]);
  for (let d = 1; d <= 4 && idx.size < maxPages; d++) {
    for (const j of [anchor - d, anchor + d]) {
      if (j >= 0 && j < pages.length && scores[j] >= 3 && idx.size < maxPages) idx.add(j);
    }
  }

  // Assemble highest-score-first so the anchor survives the char budget.
  const byScore = [...idx].sort((a, b) => scores[b] - scores[a]);
  const used = [];
  let budget = maxChars;
  for (const i of byScore) {
    const block = `\n\n===== PAGE ${i + 1} =====\n${pages[i]}`;
    if (block.length > budget) continue;
    budget -= block.length;
    used.push(i);
  }
  used.sort((a, b) => a - b); // present in reading order
  const tagged = used.map((i) => `\n\n===== PAGE ${i + 1} =====\n${pages[i]}`).join('').trim();
  return { pageNumbers: used.map((i) => i + 1), scores: used.map((i) => scores[i]), tagged };
}

/** Parse a period endDate to a sortable timestamp; null if unknown. */
function periodTime(p) {
  if (p && p.endDate) {
    const t = Date.parse(p.endDate);
    if (!Number.isNaN(t)) return t;
  }
  return null;
}

/** Reorder periods (and every kpi's values) to newest-first by endDate. */
function normalizePeriods(result) {
  const periods = result.periods || [];
  const times = periods.map(periodTime);
  if (times.some((t) => t == null)) return result; // can't safely reorder
  const order = periods.map((_, i) => i).sort((a, b) => times[b] - times[a]);
  const same = order.every((v, i) => v === i);
  if (same) return result;
  result.periods = order.map((i) => periods[i]);
  for (const k of result.kpis || []) {
    if (Array.isArray(k.values)) k.values = order.map((i) => k.values[i]);
  }
  return result;
}

/** Of several runs, keep the one with the most grounded KPIs (then most KPIs). */
function pickBestRun(runs) {
  const ok = runs.filter((r) => r && r.ok);
  if (!ok.length) return runs.find((r) => r) || { ok: false, reason: 'no_kpi_pages_found' };
  return ok.sort((a, b) => {
    const ga = a._grounding.groundedCount, gb = b._grounding.groundedCount;
    if (gb !== ga) return gb - ga;
    return (b.kpis?.length || 0) - (a.kpis?.length || 0);
  })[0];
}

/** One extraction pass (single LLM call). */
async function extractOnce(pages, cand, opts) {
  const { data, usage, provider, model } = await completeJson({
    system: SYSTEM_PROMPT,
    user: cand.tagged,
    provider: opts.provider,
    model: opts.model,
    maxTokens: opts.maxTokens || 4096,
  });

  const kpis = Array.isArray(data.kpis) ? data.kpis : [];
  let grounded = 0;
  for (const k of kpis) {
    k.key = canonicalizeKey(k.key, k.label);
    const p = k.source && k.source.page;
    const pageText = p && p >= 1 && p <= pages.length ? pages[p - 1] : '';
    k._grounded = isQuoteGrounded(k.source && k.source.quote, pageText);
    if (k._grounded) grounded++;
  }

  let result = {
    ok: true,
    ...data,
    kpis,
    _meta: {
      candidatePages: cand.pageNumbers, candidateScores: cand.scores,
      provider, model, usage,
    },
    _grounding: {
      metricCount: kpis.length,
      groundedCount: grounded,
      groundingScore: kpis.length ? Number((grounded / kpis.length).toFixed(3)) : 0,
    },
  };
  return normalizePeriods(result);
}

/**
 * Extract grounded KPIs from a prospectus PDF.
 * @param {string} filePath
 * @param {object} [opts]
 * @param {number} [opts.runs=2]  best-of-N runs to damp LLM variance
 */
async function extractKpis(filePath, opts = {}) {
  const pages = await readPageTexts(filePath);
  const cand = selectKpiPages(pages, opts);
  if (!cand.pageNumbers.length || Math.max(0, ...cand.scores) < 4) {
    return { ok: false, reason: 'no_kpi_pages_found', _meta: { sourceFile: filePath, pageCount: pages.length } };
  }

  const runs = Math.max(1, opts.runs ?? 2);
  const results = [];
  for (let i = 0; i < runs; i++) results.push(await extractOnce(pages, cand, opts));
  const best = pickBestRun(results);
  
  // Post-process to fix key confusion between raw values and ratios
  remapKeysByUnit(best);

  best._meta = {
    ...best._meta,
    sourceFile: filePath, pageCount: pages.length, runs,
    coveragePerRun: results.map((r) => r._grounding?.metricCount ?? 0),
    extractedAt: new Date().toISOString(),
  };
  return best;
}

/**
 * Post-process KPIs to fix key confusion: LLM assigns same key to raw values
 * (₹735L) and percentages (27.97%). This function remaps based on unit.
 * @param {object} result - extraction result with kpis array
 * @returns {object} result with corrected keys
 */
function remapKeysByUnit(result) {
  const rawMetricUnits = ['₹ lakhs', '₹ millions', 'rs in lakhs', 'rs in millions', 'inr in lakhs', 'inr in millions', '₹ per share'];

  for (const k of result.kpis || []) {
    const unit = (k.unit || '').toLowerCase();
    const labelLower = (k.label || '').toLowerCase();

    // Skip if already a proper ratio key
    if (['roe', 'roce', 'ronw', 'debtEquity', 'patMargin', 'ebitdaMargin', 
         'grossMargin', 'priceToBook', 'currentRatio', 'interestCoverage'].includes(k.key)) {
      // If unit is raw (currency) but key is ratio → remap to raw version
      if (rawMetricUnits.some(u => unit.includes(u))) {
        if (k.key === 'ebitdaMargin') { k.key = 'ebitda'; k._rawType = 'raw'; }
        else if (k.key === 'patMargin') { k.key = 'profitAfterTax'; k._rawType = 'raw'; }
      }
      // If unit is % but key is raw → remap to ratio version
      else if (unit === '%') {
        if (k.key === 'ebitda') { k.key = 'ebitdaMargin'; k._rawType = 'ratio'; }
        else if (k.key === 'profitAfterTax') { k.key = 'patMargin'; k._rawType = 'ratio'; }
      }
      continue;
    }
    
    // Handle "other" keys and revenueGrowth misuse
    if (unit === '%' || labelLower.includes('margin') || labelLower.includes('ratio') || labelLower.includes('%')) {
      // It's a ratio/percentage
      if (labelLower.includes('ebitda')) { k.key = 'ebitdaMargin'; k._rawType = 'ratio'; }
      else if (labelLower.includes('pat') || labelLower.includes('net profit')) { k.key = 'patMargin'; k._rawType = 'ratio'; }
      else if (labelLower.includes('roe') || labelLower.includes('return on equity')) { k.key = 'roe'; k._rawType = 'ratio'; }
      else if (labelLower.includes('roce') || labelLower.includes('return on capital')) { k.key = 'roce'; k._rawType = 'ratio'; }
      else if (labelLower.includes('ronw') || labelLower.includes('return on net worth')) { k.key = 'ronw'; k._rawType = 'ratio'; }
    } else if (rawMetricUnits.some(u => unit.includes(u)) || /^\d+\.?\d*$/.test(unit)) {
      // It's a raw metric
      if (labelLower.includes('revenue') && !labelLower.includes('growth')) { k.key = 'revenueFromOperations'; k._rawType = 'raw'; }
      else if (labelLower.includes('total income')) { k.key = 'totalIncome'; k._rawType = 'raw'; }
      else if (labelLower.includes('ebitda') && !labelLower.includes('margin')) { k.key = 'ebitda'; k._rawType = 'raw'; }
      else if (labelLower.includes('profit') || labelLower.includes('pat')) { k.key = 'profitAfterTax'; k._rawType = 'raw'; }
      else if (labelLower.includes('nav') || labelLower.includes('net asset')) { k.key = 'nav'; k._rawType = 'raw'; }
    }
  }
  
  return result;
}

/** Light, deterministic sanity checks + confidence for KPI values. */
function validateKpis(result) {
  const checks = [];
  const add = (name, status, detail) => checks.push({ name, status, detail });
  for (const k of result.kpis || []) {
    for (let i = 0; i < (k.values || []).length; i++) {
      const v = k.values[i];
      if (v == null) continue;
      if (k.unit === '%' && (v < -1000 || v > 1000)) add(`range:${k.key}`, 'fail', `${v}% out of range`);
      if ((k.unit === 'x' || k.unit === 'ratio') && v < 0 && k.key !== 'revenueGrowth') add(`negative:${k.key}`, 'fail', `${v}`);
    }
  }
  const g = result._grounding || { groundingScore: 0 };
  let confidence = 0.30 + 0.70 * g.groundingScore - 0.05 * checks.filter((c) => c.status === 'fail').length;
  confidence = Math.max(0, Math.min(1, Number(confidence.toFixed(3))));
  return { confidence, reviewRequired: confidence < 0.8 || g.groundingScore < 0.6, checks };
}

module.exports = {
  extractKpis, validateKpis, selectKpiPages, scoreKpiPage, isTocPage,
  canonicalizeKey, normalizePeriods, pickBestRun, KPI_KEYS, remapKeysByUnit,
};
