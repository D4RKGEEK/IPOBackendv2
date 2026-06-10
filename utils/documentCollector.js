'use strict';

/**
 * documentCollector.js — gather every prospectus document (DRHP / RHP / final)
 * for an IPO from all merged sources, deduped, ready for the doc pipeline.
 *
 * Input: a standardized master record (already merged across Upstox/NSE/Groww by
 * run_pipeline). We pull document URLs from the top-level documentUrls AND from
 * each raw source, because different sources surface different documents.
 *
 * Output per IPO: { symbol, isin, companyName, documents: [{ docType, url, sources[] }] }
 */

const { classifyFromName } = require('./docClassifier');

/**
 * Classify a document into drhp | rhp | final. Prefer an explicit source-provided
 * hint, otherwise infer from the URL/filename via the shared robust classifier.
 */
function classifyDocType(hint, url) {
  if (hint && ['drhp', 'rhp', 'final'].includes(hint)) return hint;
  return classifyFromName(url).docType || 'drhp';
}

/** Normalize a URL for dedup (strip trailing slashes / query noise lightly). */
function normUrl(u) {
  return String(u || '').trim().replace(/\/+$/, '');
}

/**
 * Pull all (docType, url, source) candidates out of a master record.
 * @param {object} rec
 * @returns {Array<{docType, url, source}>}
 */
function extractCandidates(rec) {
  const out = [];
  const push = (docType, url, source) => {
    if (url) out.push({ docType: classifyDocType(docType, url), url: normUrl(url), source });
  };

  // Top-level merged documentUrls
  if (rec.documentUrls) {
    push('rhp', rec.documentUrls.rhp, 'merged');
    push('drhp', rec.documentUrls.drhp, 'merged');
  }

  const rs = rec.raw_sources || {};
  // Upstox raw
  if (rs.upstox) {
    push('rhp', rs.upstox.rhp_url, 'upstox');
    push('drhp', rs.upstox.drhp_url, 'upstox');
  }
  // NSE raw (and nested details)
  if (rs.nse) {
    push('rhp', rs.nse.rhpUrl, 'nse');
    push('drhp', rs.nse.drhpUrl, 'nse');
    const meta = rs.nse.metaInfo || (rs.nse.details && rs.nse.details.metaInfo);
    if (meta) {
      push('rhp', meta.rhpUrl, 'nse');
      push('drhp', meta.drhpUrl, 'nse');
    }
  }
  // Groww raw (docsOnly stores documentUrl; full mode has detail.documentUrl)
  if (rs.groww) {
    const gUrl = rs.groww.documentUrl || (rs.groww.detail && rs.groww.detail.documentUrl);
    push(rs.groww.docType || null, gUrl, 'groww');
  }
  // Zerodha raw (prospectus link scraped from detail page, with its inferred type)
  if (rs.zerodha && rs.zerodha.prospectusUrl) {
    push(rs.zerodha.docType, rs.zerodha.prospectusUrl, 'zerodha');
  }

  return out;
}

/**
 * Collect deduped documents for one IPO record.
 * @param {object} rec
 * @returns {{ symbol, isin, companyName, status, documents: Array<{docType,url,sources:string[]}> }}
 */
function collectDocuments(rec) {
  const candidates = extractCandidates(rec);
  const byUrl = new Map();
  for (const c of candidates) {
    if (!c.url) continue;
    const existing = byUrl.get(c.url);
    if (existing) {
      if (!existing.sources.includes(c.source)) existing.sources.push(c.source);
      // Prefer a more specific docType than a defaulted 'rhp' if another source disagrees with evidence
    } else {
      byUrl.set(c.url, { docType: c.docType, url: c.url, sources: [c.source] });
    }
  }
  return {
    symbol: rec.symbol || null,
    isin: rec.isin || null,
    companyName: rec.companyName || null,
    status: rec.status || null,
    documents: [...byUrl.values()],
  };
}

/**
 * Collect documents across a list of master records.
 * @param {object[]} records
 * @param {object} [opts]
 * @param {boolean} [opts.onlyWithDocs=true] drop IPOs with no documents
 * @returns {object[]}
 */
function collectAll(records, opts = {}) {
  const onlyWithDocs = opts.onlyWithDocs !== false;
  const result = records.map(collectDocuments);
  return onlyWithDocs ? result.filter((r) => r.documents.length > 0) : result;
}

module.exports = { collectDocuments, collectAll, extractCandidates, classifyDocType, normUrl };
