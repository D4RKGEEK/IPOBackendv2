'use strict';

/**
 * extractionService.js — parse the CACHED Firecrawl markdown (in R2) into
 * structured financials + KPIs, and compute lot details. No Firecrawl/LLM calls:
 * we read one markdown file from R2 and parse its tables deterministically.
 */

const { collections } = require('../db/mongo');
const { findBySlug } = require('../db/ipoRepository');
const { getText } = require('../utils/r2');
const { docKey } = require('../utils/docPipeline');
const { parseMarkdownTables, findPeriodRow, parseNum } = require('../utils/markdownTables');
const { computeApplicationTable } = require('../utils/lotSizeCalculator');
const { extractIssueDetails, computeAmounts } = require('../utils/issueDetailsExtractor');
const { extractIntermediaries } = require('../utils/intermediariesExtractor');
const { extractObjects } = require('../utils/objectsExtractor');

// KPI row matchers — abbreviation- AND phrase-aware (prospectus tables use both).
const KPI_METRICS = [
  ['roce', /\broce\b|return\s+on\s+capital\s+employed/i],
  ['ronw', /\bronw\b|return\s+on\s+net\s+worth/i],
  ['roe', /\broe\b|return\s+on\s+equity/i],
  ['debtEquity', /debt[\s/-]*(?:to\s*)?equity/i],
  ['ebitdaMargin', /ebitda\s*margin/i],
  ['patMargin', /pat\s*margin|net\s*profit\s*margin/i],
  ['grossMargin', /gross\s*(?:profit\s*)?margin/i],
  ['priceToBook', /price\s*to\s*book|p\s*\/\s*bv/i],
  ['currentRatio', /current\s+ratio/i],
  ['nav', /net\s+asset\s+value|nav\s+per/i],
  ['eps', /earnings?\s+per\s+share|\beps\b/i],
];

// Financial line-item matchers (row label → canonical metric).
const FIN_METRICS = [
  ['revenueFromOperations', /revenue\s+from\s+operations/i],
  ['totalIncome', /total\s+income/i],
  ['ebitda', /\bebitda\b(?!\s*margin)/i],
  ['profitAfterTax', /profit\s*(?:\/\s*\(loss\))?\s*(?:for the (?:year|period)|after tax)|restated\s+profit/i],
  ['netWorth', /net\s+worth|total\s+equity/i],
  ['totalBorrowings', /total\s+borrowings?/i],
  ['basicEPS', /basic.*(?:earning|eps)|earnings?\s+per\s+(?:equity\s+)?share/i],
  ['ronw', /return\s+on\s+net\s+worth/i],
  ['netAssetValue', /net\s+asset\s+value/i],
];

const firstLabel = (row) => (row.find((c) => c && c.trim()) || '').trim();
const valuesAt = (row, cols) => cols.map((i) => (i < row.length ? parseNum(row[i]) : null));

/** Count how many financial metrics a table's rows match. */
function finScore(rows) {
  let n = 0;
  for (const [, re] of FIN_METRICS) if (rows.some((r) => re.test(firstLabel(r)))) n++;
  return n;
}

/** Extract restated financials from the best period-bearing table. */
function extractFinancials(tables) {
  const candidates = tables
    .map((t) => ({ t, pr: findPeriodRow(t.rows), score: finScore(t.rows) }))
    .filter((c) => c.pr && c.score >= 2)
    .sort((a, b) => b.score - a.score);
  if (!candidates.length) return null;

  const { t, pr } = candidates[0];
  const periods = pr.labels;
  const metrics = {};
  const sourceRows = {};
  for (let i = 0; i < t.rows.length; i++) {
    if (i === pr.rowIndex) continue;
    const label = firstLabel(t.rows[i]);
    for (const [key, re] of FIN_METRICS) {
      if (metrics[key]) continue;
      if (re.test(label)) {
        const vals = valuesAt(t.rows[i], pr.cols);
        if (vals.some((v) => v != null)) { metrics[key] = vals; sourceRows[key] = label; }
        break;
      }
    }
  }
  if (!Object.keys(metrics).length) return null;
  return { periods, metrics, _source: { rowLabels: sourceRows, table: 'markdown' } };
}

/** Count distinct KPI matchers a table's rows hit. */
function kpiScore(rows) {
  let n = 0;
  for (const [, re] of KPI_METRICS) if (rows.some((r) => re.test(firstLabel(r)))) n++;
  return n;
}

/**
 * Extract KPI ratios from the single best KPI table (most matches), so all KPIs
 * share one period basis instead of mixing rows from unrelated tables.
 */
function extractKpis(tables) {
  const ranked = tables
    .map((t) => ({ t, pr: findPeriodRow(t.rows), score: kpiScore(t.rows) }))
    .filter((c) => c.score >= 2)
    .sort((a, b) => b.score - a.score);
  if (!ranked.length) return null;

  const { t, pr } = ranked[0];
  const periods = pr ? pr.labels : null;
  const kpis = {};
  const sourceRows = {};
  for (let i = 0; i < t.rows.length; i++) {
    if (pr && i === pr.rowIndex) continue;
    const label = firstLabel(t.rows[i]);
    if (!label) continue;
    const match = KPI_METRICS.find(([, re]) => re.test(label));
    if (!match || kpis[match[0]]) continue;
    const vals = pr
      ? valuesAt(t.rows[i], pr.cols)
      : (() => { const nums = t.rows[i].map(parseNum).filter((v) => v != null); return nums.length ? [nums[0]] : []; })();
    if (vals.some((v) => v != null)) { kpis[match[0]] = vals; sourceRows[match[0]] = label; }
  }
  if (!Object.keys(kpis).length) return null;
  return { periods, kpis, _source: { rowLabels: sourceRows, table: 'markdown' } };
}

/** Compute the lot / application table from issue mechanics already on the doc. */
function computeLotDetails(ipo) {
  const price = ipo.issuePrice || (ipo.priceBand && ipo.priceBand.max);
  if (!ipo.lotSize || !price) return null;
  const res = computeApplicationTable({
    lotSize: ipo.lotSize,
    price,
    marketType: ipo.issueType === 'SME' ? 'sme' : 'mainboard',
  });
  return res.ok ? res : null;
}

/** Pick the best processed document (rhp > final > drhp) that has markdown. */
function pickDoc(ipo) {
  for (const t of ['rhp', 'final', 'drhp']) {
    const d = (ipo.documents || {})[t];
    if (d && d.markdownUrl && d.status === 'extracted') return t;
  }
  return null;
}

/**
 * Run extraction for an IPO from its cached markdown.
 * @param {string} slug
 * @param {object} [opts] { log }
 */
async function runExtraction(slug, opts = {}) {
  const log = opts.log || (() => {});
  const ipo = await findBySlug(slug);
  if (!ipo) return { error: 'IPO not found' };

  const lotDetails = computeLotDetails(ipo);
  if (lotDetails) log(`computed lot table (${lotDetails.applications.length} tiers)`);

  const docType = pickDoc(ipo);
  let financials = null; let kpis = null; let issueDetails = null; let intermediaries = null; let objects = null;
  if (docType) {
    const sym = ipo.symbol || ipo.slug;
    log(`reading ${docType} markdown from R2`);
    const md = await getText(docKey(sym, docType, 'md'));
    const tables = parseMarkdownTables(md);
    log(`parsed ${tables.length} markdown tables`);
    const fin = extractFinancials(tables);
    const kpi = extractKpis(tables);
    if (fin) { financials = { ...fin, source: docType, extractedAt: new Date().toISOString() }; log(`financials: ${Object.keys(fin.metrics).length} metrics over ${fin.periods.length} periods`); }
    if (kpi) { kpis = { ...kpi, source: docType, extractedAt: new Date().toISOString() }; log(`kpis: ${Object.keys(kpi.kpis).length} ratios`); }

    // Offer structure (shares from RHP, ₹ amounts computed from API cap price).
    const raw = extractIssueDetails(md, { isSme: ipo.issueType === 'SME' });
    const capPrice = ipo.issuePrice || (ipo.priceBand && ipo.priceBand.max) || null;
    const amounts = computeAmounts(raw, capPrice, ipo.issueType === 'SME');
    issueDetails = {
      ipoDateStart: ipo.biddingStart || null,
      ipoDateEnd: ipo.biddingEnd || null,
      listingDate: ipo.listingDate || null,
      faceValue: ipo.faceValue || null,
      priceBand: ipo.priceBand || null,
      lotSize: ipo.lotSize || null,
      saleType: raw.saleType,
      issueType: raw.issueType,
      listingAt: raw.listingAt,
      totalIssueShares: raw.totalIssueShares,
      freshIssueShares: raw.freshIssueShares,
      ofsShares: raw.ofsShares,
      marketMakerShares: raw.marketMakerShares,
      employeeReservationShares: raw.employeeReservationShares,
      marketMakerName: raw.marketMakerName,
      netOfferShares: raw.netOfferShares,
      preIssueShares: raw.preIssueShares,
      postIssueShares: raw.postIssueShares,
      amounts,
      arithmetic: raw._arithmetic,
      confidence: raw.confidence,
      source: docType,
      extractedAt: new Date().toISOString(),
    };
    log(`issue details: confidence ${raw.confidence} — ${JSON.stringify(raw._arithmetic)}`);

    intermediaries = { ...extractIntermediaries(md, { companyName: ipo.companyName }), source: docType, extractedAt: new Date().toISOString() };
    log(`intermediaries: ${intermediaries.leadManagers.length} LM, registrar ${intermediaries.registrar ? '✓' : '✗'}, company ${intermediaries.company ? '✓' : '✗'}`);

    const obj = extractObjects(md);
    if (obj) { objects = { ...obj, docSource: docType, extractedAt: new Date().toISOString() }; log(`objects: ${obj.objects.length} (${obj.source}), total ${obj.totalCr ?? '?'} Cr`); }
  } else {
    log('no extracted document markdown available — lot details only');
  }

  const now = new Date().toISOString();
  const set = { updatedAt: now };
  if (financials) set.financials = financials;
  if (kpis) set.kpis = kpis;
  if (lotDetails) set.lotDetails = lotDetails;
  if (issueDetails) set.issueDetails = issueDetails;
  if (intermediaries) set.intermediaries = intermediaries;
  if (objects) set.objects = objects;
  await collections.ipos().updateOne({ slug }, { $set: set });

  return {
    slug,
    financials: financials ? { periods: financials.periods, metrics: Object.keys(financials.metrics) } : null,
    kpis: kpis ? Object.keys(kpis.kpis) : null,
    lotDetails: lotDetails ? { tiers: lotDetails.applications.length } : null,
    issueDetails: issueDetails ? { confidence: issueDetails.confidence, saleType: issueDetails.saleType } : null,
    intermediaries: intermediaries ? { leadManagers: intermediaries.leadManagers.length, registrar: !!intermediaries.registrar } : null,
    objects: objects ? { count: objects.objects.length, totalCr: objects.totalCr, source: objects.source } : null,
  };
}

module.exports = { runExtraction, extractFinancials, extractKpis, computeLotDetails, finScore };
