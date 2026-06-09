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

const SECTION_SIGNALS = [
  ['financials', /restated|financial statements|profit (and|&) loss|balance sheet/i],
  ['risk-factors', /risk factors/i],
  ['objects-of-issue', /objects of the (issue|offer)/i],
  ['capital-structure', /capital structure/i],
  ['management', /our management|board of directors/i],
  ['kpis', /key performance indicator|basis for (the )?(offer|issue) price/i],
];

const sha256 = (s) => crypto.createHash('sha256').update(String(s).replace(/\s+/g, ' ').trim()).digest('hex');

/** Detect which known sections appear in the document text. */
function detectSections(fullText) {
  const found = [];
  for (const [name, re] of SECTION_SIGNALS) if (re.test(fullText)) found.push(name);
  return found;
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

  // 5. Sections (from page text; markdown also fine)
  const sections = detectSections(pages.join(' ').slice(0, 200000));

  const stored = {
    url, r2Url: pipe.pdfUrl, markdownUrl: pipe.mdUrl,
    pageCount: pages.length, pageHashes, sections,
    source: docMeta.source || null, confirmedType,
    status: 'extracted', uploadedAt: new Date().toISOString(),
    ...(overlapInfo || {}),
  };
  await saveDocMeta(ipo.slug, docType, stored);

  return {
    status: 'extracted', pagesExtracted: pages.length, newPages: overlapInfo ? overlapInfo.uniquePages : pages.length,
    r2Url: pipe.pdfUrl, markdownUrl: pipe.mdUrl, sections, confirmedType,
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
  return result;
}

module.exports = { processDocuments, processOne, detectSections, pageOverlap, sha256, OVERLAP_SKIP };
