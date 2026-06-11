'use strict';

/**
 * documentService.js — process an IPO's prospectus documents.
 *
 * Per document (drhp/rhp/final):
 *   download PDF -> per-page SHA256 (for DRHP/RHP overlap dedup) ->
 *   confirm type from the cover page -> R2 archive + Firecrawl markdown ->
 *   detect sections -> store {url, r2Url, markdownUrl, pageCount, sections,...}.
 *
 * RHP usually overlaps DRHP heavily; if ≥ OVERLAP_SKIP of RHP pages already
 * appear in the processed DRHP, we skip re-extracting and just report overlap.
 */

const crypto = require('crypto');
const { collections } = require('../db/mongo');
const { findBySlug, recordError } = require('../db/ipoRepository');
const { downloadPdf } = require('../utils/pdfDownloader');
const { readPageTexts } = require('../utils/financialsExtractor');
const { classifyFromCoverText } = require('../utils/docClassifier');
const { processDocument: pipelineProcess } = require('../utils/docPipeline');

const OVERLAP_SKIP = 0.9; // skip RHP extraction if ≥90% of its pages are in the DRHP

/**
 * Section signals per section key (short name).
 * These match actual section content (not TOC lines).
 */
const SECTION_SIGNALS = [
  ['financials', /restated\s+financial|financial\s+statements?|profit\s+(and|&)\s+loss|balance\s+sheet/i],
  ['risk-factors', /^risk\s+factors\b/i],
  ['objects-of-issue', /^objects?\s+of\s+the\s+(issue|offer)\b/i],
  ['capital-structure', /^capital\s+structure\b/i],
  ['management', /^our\s+management\b|board\s+of\s+directors/i],
  ['kpis', /key\s+performance\s+indicator|basis\s+for\s+(the\s+)?(offer|issue)\s+price/i],
];

const sha256 = (s) => crypto.createHash('sha256').update(String(s).replace(/\s+/g, ' ').trim()).digest('hex');

/**
 * Check if a page looks like a TOC page — many lines ending in page numbers.
 * A page is TOC-like if >30% of non-trivial lines end in a number (1-4 digits).
 * @param {string} pageText
 * @returns {boolean}
 */
function isTocPage(pageText) {
  const lines = pageText.split('\n').filter((l) => l.trim().length > 8);
  if (lines.length < 3) return false;
  const withPageNum = lines.filter((l) => /\s+\d{1,4}\s*$/.test(l.trim()));
  return withPageNum.length / lines.length > 0.3;
}

/**
 * Detect section page ranges from per-page text.
 * 
 * Key improvement over the old version: skips TOC pages (pages 1-3ish) where
 * section names appear as list entries, not actual section content. This
 * prevents matching "Financial Information" in a TOC entry instead of the
 * real financial section header.
 *
 * Each entry: { start, end } — 1-based page numbers, inclusive.
 * The end page is inferred from the next section's start; the last section
 * defaults to the document's total page count.
 * @param {string[]} pages  per-page text array (pages[i] = page i+1)
 * @returns {object}  e.g. { financials: { start:45, end:72 }, kpis: { start:78, end:85 } }
 */
function detectSections(pages) {
  // First pass: identify TOC pages so we can skip them.
  const tocPages = new Set();
  for (let i = 0; i < Math.min(pages.length, 10); i++) {
    if (isTocPage(pages[i])) tocPages.add(i);
  }

  const found = {}; // name -> start page (1-based)
  for (let i = 0; i < pages.length; i++) {
    if (tocPages.has(i)) continue; // skip TOC — matches would be TOC entries, not real headings
    const text = pages[i];
    for (const [name, re] of SECTION_SIGNALS) {
      if (found[name] != null) continue;
      if (re.test(text)) found[name] = i + 1; // 1-based page
    }
  }
  // Derive end pages: next section's start - 1, or total pages
  const total = pages.length;
  const result = {};
  const names = Object.keys(found).sort((a, b) => found[a] - found[b]);
  for (let i = 0; i < names.length; i++) {
    const start = found[names[i]];
    const end = i < names.length - 1 ? found[names[i + 1]] - 1 : total;
    result[names[i]] = { start, end };
  }
  return result;
}

/** Overlap between two arrays of page hashes. */
function pageOverlap(rhpHashes, drhpHashes) {
  const set = new Set(drhpHashes || []);
  const overlap = rhpHashes.filter((h) => set.has(h)).length;
  return { overlap, uniquePages: rhpHashes.length - overlap };
}

/**
 * Process one document for an IPO.
 * @param {object} ipo  the IPO mongo doc
 * @param {'drhp'|'rhp'|'final'} docType
 * @param {object} [opts] { reUpload }
 * @returns {Promise<object>} result for this docType
 */
async function processOne(ipo, docType, opts = {}) {
  const log = opts.log || (() => {});
  const docMeta = (ipo.documents || {})[docType];
  const url = docMeta && docMeta.url;
  if (!url) return { status: 'error', reason: 'no_document_url' };
  log(`${docType}: downloading ${url.slice(0, 80)}`);

  // 1. Download
  let dl;
  try {
    dl = await downloadPdf(url);
  } catch (e) {
    return { status: 'error', reason: `download_failed: ${e.message}` };
  }
  if (dl.status !== 'success' && dl.status !== 'already_parsed') {
    return { status: 'error', reason: `download_failed: ${dl.status}` };
  }
  const localPath = dl.filePath;

  // 2. Per-page text + hashes + cover classification
  let pages;
  try {
    pages = await readPageTexts(localPath);
  } catch (e) {
    return { status: 'error', reason: `parse_failed: ${e.message}` };
  }
  const pageHashes = pages.map(sha256);
  const cover = classifyFromCoverText(pages[0] || '');
  const confirmedType = cover ? cover.docType : docType;
  log(`${docType}: ${pages.length} pages, cover says "${confirmedType}"`);

  // 3. DRHP/RHP overlap dedup — skip RHP re-extraction if mostly in DRHP
  let overlapInfo = null;
  if (docType === 'rhp' && ipo.documents && ipo.documents.drhp && Array.isArray(ipo.documents.drhp.pageHashes)) {
    const { overlap, uniquePages } = pageOverlap(pageHashes, ipo.documents.drhp.pageHashes);
    overlapInfo = { overlap, uniquePages };
    const ratio = pageHashes.length ? overlap / pageHashes.length : 0;
    log(`${docType}: overlaps DRHP by ${overlap}/${pageHashes.length} pages (${uniquePages} unique)`);
    if (ratio >= OVERLAP_SKIP && !opts.reUpload) {
      const stored = {
        ...docMeta, pageCount: pages.length, pageHashes,
        confirmedType, overlap, uniquePages, status: 'skipped', uploadedAt: new Date().toISOString(),
      };
      await saveDocMeta(ipo.slug, docType, stored);
      log(`${docType}: skipped extraction (mostly in DRHP)`);
      return { status: 'skipped', reason: 'mostly overlaps DRHP', overlap, uniquePages, pageCount: pages.length };
    }
  }

  // 4. R2 archive + Firecrawl markdown (cached unless reUpload)
  log(`${docType}: uploading to R2 + Firecrawl markdown...`);
  let pipe;
  try {
    pipe = await pipelineProcess({ symbol: ipo.symbol || ipo.slug, docType, localPath, force: opts.reUpload });
  } catch (e) {
    return { status: 'error', reason: `pipeline_failed: ${e.message}` };
  }
  log(`${docType}: markdown ${pipe.cached ? 'cached' : 'generated'} → ${pipe.mdUrl}`);

  // 5. Section page ranges (from per-page text)
  const sectionPages = detectSections(pages);

  const stored = {
    url, r2Url: pipe.pdfUrl, markdownUrl: pipe.mdUrl,
    pageCount: pages.length, pageHashes, sections: Object.keys(sectionPages), sectionPages,
    source: docMeta.source || null, confirmedType,
    status: 'extracted', uploadedAt: new Date().toISOString(),
    ...(overlapInfo || {}),
  };
  await saveDocMeta(ipo.slug, docType, stored);

  return {
    status: 'extracted', pagesExtracted: pages.length, newPages: overlapInfo ? overlapInfo.uniquePages : pages.length,
    r2Url: pipe.pdfUrl, markdownUrl: pipe.mdUrl, sections: Object.keys(sectionPages), sectionPages, confirmedType,
    ...(overlapInfo || {}),
  };
}

async function saveDocMeta(slug, docType, meta) {
  await collections.ipos().updateOne({ slug }, { $set: { [`documents.${docType}`]: meta, updatedAt: new Date().toISOString() } });
}

/**
 * Process the requested documents for an IPO slug. Processes DRHP before RHP so
 * overlap dedup can work.
 * @param {string} slug
 * @param {object} [opts] { documents, reUpload }
 */
async function processDocuments(slug, opts = {}) {
  const ipo = await findBySlug(slug);
  if (!ipo) return { error: 'IPO not found' };
  let types = (opts.documents && opts.documents.length) ? opts.documents : Object.keys(ipo.documents || {});
  // Ensure DRHP runs before RHP for overlap comparison.
  types = types.filter((t) => ['drhp', 'rhp', 'final'].includes(t)).sort((a) => (a === 'drhp' ? -1 : 1));

  const result = {};
  let current = ipo;
  for (const t of types) {
    const r = await processOne(current, t, opts);
    result[t] = r;
    if (r.status === 'error') {
      await recordError(slug, `documents.${t}`, r.reason);
      await saveDocMeta(slug, t, { ...(current.documents || {})[t], status: 'error', reason: r.reason, attemptedAt: new Date().toISOString() });
    }
    current = await findBySlug(slug); // refresh so RHP sees DRHP's stored pageHashes
  }
  // Auto-parse the freshly-cached markdown into structured fields (no extra Firecrawl/LLM).
  if (Object.values(result).some((r) => r.status === 'extracted')) {
    try {
      const { runExtraction } = require('./extractionService');
      result._extraction = await runExtraction(slug, { log: opts.log });
    } catch (e) {
      result._extraction = { error: e.message };
    }
  }
  return result;
}

module.exports = { processDocuments, processOne, detectSections, pageOverlap, sha256, OVERLAP_SKIP };
