'use strict';

/**
 * sectionFallback.js — retry extraction for a single section that failed
 * regex-based validation, using Firecrawl on a page-range PDF slice.
 *
 * Flow:
 *   regex extraction → validate → failed? → slice PDF to section pages →
 *   upload slice to R2 → Firecrawl scrape (markdown + structured JSON) →
 *   re-run deterministic extractor on the returned markdown → validate → return
 *
 * Adding support for a new section? Just add an entry to SECTION_EXTRACTORS below.
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const { scrapeToMarkdown } = require('./firecrawl');
const { uploadFile, getPublicUrl, objectExists } = require('./r2');
const { validateExtraction } = require('./validation');

// ---------------------------------------------------------------------------
// Per-section: which extractor to call, and what Firecrawl JSON prompt to use.
// ---------------------------------------------------------------------------
const SECTION_EXTRACTORS = {
  financials: {
    extractorPath: '../utils/financialsExtractor',
    extractFn: 'extractFinancials',
    prompt: 'Extract the restated financial summary table: revenue, expenses, profit, balance sheet items, EPS. Return as structured JSON with periods and metric values.',
  },
  kpis: {
    extractorPath: '../utils/kpiExtractor',
    extractFn: 'extractKpis',
    prompt: 'Extract key performance indicators / financial ratios: ROCE, RONW, ROE, debt-equity, EBITDA margin, PAT margin, NAV, EPS. Return as structured JSON.',
  },
  objectsOfIssue: {
    extractorPath: '../utils/objectsExtractor',
    extractFn: 'extractObjects',
    prompt: 'Extract the objects of the issue / use of proceeds table: each object name and its estimated amount. Include the total. Return as structured JSON.',
  },
  issueDetails: {
    extractorPath: '../utils/issueDetailsExtractor',
    extractFn: 'extractIssueDetails',
    prompt: 'Extract IPO issue structure: total issue size, fresh issue, OFS, market maker reservation, employee reservation, net offer, pre/post issue shares. Return as structured JSON.',
  },
};

/** Fallback: does nothing for sections we can't handle yet. */
const NOOP_SECTIONS = new Set(['riskFactors', 'management']);

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/**
 * Retry extraction for a single section using Firecrawl on a PDF slice.
 *
 * @param {object} opts
 * @param {string} opts.slug        — IPO slug
 * @param {string} opts.docType      — 'drhp' | 'rhp' | 'final'
 * @param {string} opts.sectionName  — section short name (e.g. 'financials')
 * @param {{ start: number, end: number }} opts.pageRange  — 1-based page range
 * @param {string} [opts.pdfUrl]     — R2 public URL to download the full PDF (used if no localPdfPath)
 * @param {string} [opts.localPdfPath] — local file path of the full PDF (preferred)
 * @param {object} [opts.log]        — logger
 * @returns {Promise<{ ok: boolean, data?: object, validation?: object, error?: string }>}
 */
async function retrySection(opts) {
  const log = opts.log || (() => {});

  const sectionKey = Object.keys(SECTION_EXTRACTORS).find(
    (k) => k === opts.sectionName || k.toLowerCase() === opts.sectionName.toLowerCase()
  );
  if (!sectionKey) {
    if (NOOP_SECTIONS.has(opts.sectionName)) return { ok: false, error: 'no_extractor_needed' };
    return { ok: false, error: `unknown section: ${opts.sectionName}` };
  }

  const { start, end } = opts.pageRange || {};
  if (!start || !end || end < start) return { ok: false, error: `invalid page range: ${JSON.stringify(opts.pageRange)}` };
  if (end - start > 80) return { ok: false, error: `page range too large (${end - start} pages), aborting` };

  const cfg = SECTION_EXTRACTORS[sectionKey];

  // 1. Get a local PDF path (download from R2 if needed)
  let localPdfPath = opts.localPdfPath;
  if (!localPdfPath && opts.pdfUrl) {
    localPdfPath = await downloadPdfFromUrl(opts.pdfUrl, opts.slug, opts.docType);
    log(`  fallback ${sectionKey}: downloaded PDF from R2`);
  }
  if (!localPdfPath) return { ok: false, error: 'no_pdf_source_available' };

  // 2. Upload sliced PDF to R2 so Firecrawl can reach it
  const sliceKey = `fallback/${opts.slug}/${opts.docType}/${sectionKey}_p${start}-${end}.pdf`;
  try {
    if (!(await objectExists(sliceKey))) {
      await uploadFile(slicePath, sliceKey);
    }
  } catch (e) {
    fs.unlink(slicePath, () => {});
    return { ok: false, error: `upload_failed: ${e.message}` };
  }
  const sliceUrl = getPublicUrl(sliceKey);
  fs.unlink(slicePath, () => {});

  // 3. Firecrawl scrape the sliced PDF → markdown + structured JSON
  let md;
  try {
    const result = await scrapeToMarkdown(sliceUrl);
    md = result.markdown;
    log(`  fallback ${sectionKey}: Firecrawl returned ${md.length} chars of markdown`);
  } catch (e) {
    return { ok: false, error: `firecrawl_failed: ${e.message}` };
  }
  if (!md || md.length < 50) return { ok: false, error: 'firecrawl_returned_empty_markdown' };

  // 4. Run the relevant deterministic extractor on the section markdown
  let extracted;
  try {
    const mod = require(cfg.extractorPath);
    const fn = mod[cfg.extractFn];
    if (typeof fn !== 'function') return { ok: false, error: `extractor ${cfg.extractFn} not found` };
    extracted = fn(md);
    log(`  fallback ${sectionKey}: extractor returned ${extracted ? 'data' : 'null'}`);
  } catch (e) {
    return { ok: false, error: `extraction_failed: ${e.message}` };
  }
  if (!extracted) return { ok: false, error: 'extractor_returned_null' };

  // 5. Validate
  const flat = flattenExtraction(extracted, sectionKey);
  const validation = validateExtraction(flat);

  log(`  fallback ${sectionKey}: validation score=${validation.score}, needsReview=${validation.needsReview}`);

  return {
    ok: validation.score >= 0.7 && !validation.needsReview,
    data: extracted,
    validation,
  };
}

/**
 * Slice a PDF to [start, end] pages using pdfSlicer.
 */
async function slicePdfPages(inputPath, start, end) {
  if (!inputPath || !fs.existsSync(inputPath)) throw new Error(`PDF not found: ${inputPath}`);
  const { slicePdf } = require('./pdfSlicer');
  const out = path.join(os.tmpdir(), `fallback_${path.basename(inputPath, '.pdf')}_p${start}-${end}_${Date.now()}.pdf`);
  await slicePdf(inputPath, start, end, out);
  return out;
}

/**
 * Flatten an extraction result into key→value pairs for validation.
 * (Minimal — covers the common fields; the validation itself handles gaps.)
 */
function flattenExtraction(data, sectionKey) {
  const flat = {};
  if (sectionKey === 'financials' && data.metrics) {
    for (const [k, vals] of Object.entries(data.metrics)) {
      const last = Array.isArray(vals) ? vals[vals.length - 1] : null;
      if (last != null) flat[k] = last;
    }
  }
  if (sectionKey === 'kpis' && data.kpis) {
    for (const [k, vals] of Object.entries(data.kpis)) {
      const last = Array.isArray(vals) ? vals[vals.length - 1] : null;
      if (last != null) flat[k] = last;
    }
  }
  if (sectionKey === 'objectsOfIssue' && data.objects) {
    flat.objectCount = data.objects.length;
    if (data.total != null) flat.objectsTotal = data.total;
  }
  if (sectionKey === 'issueDetails') {
    for (const k of ['totalIssueShares','freshIssueShares','ofsShares','marketMakerShares',
      'employeeReservationShares','netOfferShares','preIssueShares','postIssueShares']) {
      if (data[k] != null) flat[k] = data[k];
    }
  }
  return flat;
}

/**
 * Download a PDF from a URL to a temp file and return the local path.
 */
async function downloadPdfFromUrl(url, slug, docType) {
  const { downloadPdf } = require('./pdfDownloader');
  // pdfDownloader already handles URL → local file
  const dl = await downloadPdf(url);
  if (dl.status !== 'success' && dl.status !== 'already_parsed') {
    throw new Error(`download_failed: ${dl.status}`);
  }
  return dl.filePath;
}

module.exports = { retrySection, SECTION_EXTRACTORS };
