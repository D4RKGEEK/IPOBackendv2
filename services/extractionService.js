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
const { extractPromoters } = require('../utils/promotersExtractor');
const { validateExtraction } = require('../utils/validation');
const { extractFinancialsFromItems, extractKpisFromItems } = require('../utils/pdfTableParser');
const { readPageItems } = require('../utils/pdfToHtml');

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
  let md = null;
  let financials = null; let kpis = null; let issueDetails = null; let intermediaries = null; let objects = null; let promoters = null;
  let issueDetailsRaw = null; let objectsRaw = null; let promotersRaw = null;
  if (docType) {
    const sym = ipo.symbol || ipo.slug;
    log(`reading ${docType} markdown from R2`);
    md = await getText(docKey(sym, docType, 'md'));
    const tables = parseMarkdownTables(md);
    log(`parsed ${tables.length} markdown tables`);

    // Coordinate-based financials + KPIs (primary — more accurate than regex on flat text)
    try {
      const docMeta = (ipo.documents || {})[docType] || {};
      const pdfUrl = docMeta.r2Url || docMeta.url;
      if (pdfUrl) {
        const { downloadPdf } = require('../utils/pdfDownloader');
        const dl = await downloadPdf(pdfUrl);
        if (dl.status === 'success' || dl.status === 'already_parsed') {
          const pages = await readPageItems(dl.filePath);

          const finItems = pages.filter((p) => {
            const t = p.items.map((i) => i.str).join(' ');
            return /\brestated\b/i.test(t) && /\bprofit.*loss|balance sheet|financial statement/i.test(t);
          });
          if (finItems.length) {
            for (const page of finItems) {
              const result = extractFinancialsFromItems(page.items);
              if (result && Object.keys(result.metrics).length >= 2) {
                financials = { ...result, source: `${docType}::coordinates`, extractedAt: new Date().toISOString() };
                log(`financials (pdf coords): ${Object.keys(result.metrics).length} metrics on page ${page.pageNum} over ${result.periods.length} periods`);
                break;
              }
            }
          }

          const kpiItems = pages.filter((p) => {
            const t = p.items.map((i) => i.str).join(' ');
            return /\b(?:return on|roce|ronw|roe|deb.*equity)\b/i.test(t) && /%\b/.test(t);
          });
          if (kpiItems.length) {
            for (const page of kpiItems) {
              const result = extractKpisFromItems(page.items);
              if (result && Object.keys(result.kpis).length >= 2) {
                kpis = { ...result, source: `${docType}::coordinates`, extractedAt: new Date().toISOString() };
                log(`kpis (pdf coords): ${Object.keys(result.kpis).length} ratios on page ${page.pageNum}`);
                break;
              }
            }
          }
        }
      }
    } catch (e) {
      log(`coordinate extraction failed: ${e.message}`);
    }

    // Fallback: regex on markdown tables (if coordinate extraction didn't yield results)
    if (!financials) {
      const fin = extractFinancials(tables);
      if (fin) { financials = { ...fin, source: docType, extractedAt: new Date().toISOString() }; log(`financials (regex): ${Object.keys(fin.metrics).length} metrics over ${fin.periods.length} periods`); }
    }
    if (!kpis) {
      const kpi = extractKpis(tables);
      if (kpi) { kpis = { ...kpi, source: docType, extractedAt: new Date().toISOString() }; log(`kpis (regex): ${Object.keys(kpi.kpis).length} ratios`); }
    }

    // Offer structure (shares from RHP, ₹ amounts computed from API cap price).
    const raw = extractIssueDetails(md, { isSme: ipo.issueType === 'SME' });
    issueDetailsRaw = raw;
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
    if (obj) { objectsRaw = obj; objects = { ...obj, docSource: docType, extractedAt: new Date().toISOString() }; log(`objects: ${obj.objects.length} (${obj.source}), total ${obj.totalCr ?? '?'} Cr`); }

    const promo = extractPromoters(md);
    if (promo) { promotersRaw = promo; promoters = { ...promo, docSource: docType, extractedAt: new Date().toISOString() }; log(`promoters: ${promo.promoters.length} names, confidence ${promo.confidence}`); }
  } else {
    log('no extracted document markdown available — lot details only');
  }

  // ── Validation pass ──────────────────────────────────────────────────────
  // Collect ALL extracted values into a flat map for cross-field consistency.
  const flat = {};
  // Financials
  if (financials) {
    for (const [k, vals] of Object.entries(financials.metrics || {})) {
      const lastVal = Array.isArray(vals) ? vals[vals.length - 1] : null;
      if (lastVal != null) flat[k] = lastVal;
    }
  }
  // KPIs
  if (kpis) {
    for (const [k, vals] of Object.entries(kpis.kpis || {})) {
      const lastVal = Array.isArray(vals) ? vals[vals.length - 1] : null;
      if (lastVal != null) flat[k] = lastVal;
    }
  }
  // Issue details
  if (issueDetails) {
    for (const k of ['totalIssueShares','freshIssueShares','ofsShares','marketMakerShares',
      'employeeReservationShares','netOfferShares','preIssueShares','postIssueShares']) {
      if (issueDetails[k] != null) flat[k] = issueDetails[k];
    }
    if (ipo.priceBand) { flat.priceMin = ipo.priceBand.min; flat.priceMax = ipo.priceBand.max; }
    if (ipo.faceValue) flat.faceValue = ipo.faceValue;
    if (ipo.issuePrice) flat.issuePrice = ipo.issuePrice;
  }
  // Promoters
  if (promoters) {
    flat.promoters = promoters.promoters;
    flat.promoterCount = promoters.promoters.length;
  }
  // Intermediaries
  if (intermediaries) {
    flat.leadManagerCount = intermediaries.leadManagers.length;
  }
  // Objects
  if (objects) {
    flat.objectCount = objects.objects.length;
    if (objects.total != null) flat.objectsTotal = objects.total;
  }

  // Build provenance from all extractors
  const allProvenance = {};
  if (issueDetailsRaw && issueDetailsRaw._provenance) Object.assign(allProvenance, issueDetailsRaw._provenance);
  if (objectsRaw && objectsRaw._provenance) Object.assign(allProvenance, objectsRaw._provenance);
  if (promotersRaw && promotersRaw._provenance) Object.assign(allProvenance, promotersRaw._provenance);
  if (intermediaries && intermediaries._provenance) Object.assign(allProvenance, intermediaries._provenance);

  const validation = validateExtraction(flat, { provenance: allProvenance });
  log(`validation: score ${validation.score}${validation.needsReview ? ' — NEEDS REVIEW' : ''} (${validation.sanity.flagged.length} sanity flags, ${validation.consistency.failed.length} consistency fails)`);

  const now = new Date().toISOString();
  const set = { updatedAt: now, validation };
  if (financials) set.financials = financials;
  if (kpis) set.kpis = kpis;
  if (lotDetails) set.lotDetails = lotDetails;
  if (issueDetails) set.issueDetails = issueDetails;
  if (intermediaries) set.intermediaries = intermediaries;
  if (objects) set.objects = objects;
  if (promoters) set.promoters = promoters;
  await collections.ipos().updateOne({ slug }, { $set: set });

  return {
    slug,
    financials: financials ? { periods: financials.periods, metrics: Object.keys(financials.metrics) } : null,
    kpis: kpis ? Object.keys(kpis.kpis) : null,
    lotDetails: lotDetails ? { tiers: lotDetails.applications.length } : null,
    issueDetails: issueDetails ? { confidence: issueDetails.confidence, saleType: issueDetails.saleType } : null,
    intermediaries: intermediaries ? { leadManagers: intermediaries.leadManagers.length, registrar: !!intermediaries.registrar } : null,
    objects: objects ? { count: objects.objects.length, totalCr: objects.totalCr, source: objects.source } : null,
    promoters: promoters ? { count: promoters.promoters.length, names: promoters.promoters, confidence: promoters.confidence } : null,
    validation: { score: validation.score, needsReview: validation.needsReview, flagged: validation.sanity.flagged.length, consistencyFails: validation.consistency.failed.length },
  };
}

module.exports = { runExtraction, extractFinancials, extractKpis, computeLotDetails, finScore };
