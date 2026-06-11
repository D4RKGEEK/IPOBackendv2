'use strict';

/**
 * sectionFallback.js — retry extraction for a single section that failed
 * regex-based validation, using Firecrawl on a page-range PDF slice.
 *
 * Flow:
 *   regex extraction → validate → failed? → download full PDF →
 *   slice to section's page range → upload slice to R2 →
 *   Firecrawl scrape → re-run deterministic extractor → validate → return
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const { scrapeToMarkdown } = require('./firecrawl');
const { putText, getPublicUrl, objectExists } = require('./r2');
const { validateExtraction } = require('./validation');

/**
 * Retry extraction for a single section using Firecrawl on a PDF slice.
 *
 * @param {object} opts
 * @param {string} opts.slug          — IPO slug
 * @param {string} opts.docType       — 'drhp' | 'rhp' | 'final'
 * @param {string} opts.sectionName   — section short name (e.g. 'financials')
 * @param {{ start: number, end: number }} opts.pageRange  — 1-based page range
 * @param {string} opts.pdfUrl        — URL to download the full PDF
 * @param {Function} opts.extractFn   — extractor function(text) that returns parsed data
 * @param {object} [opts.log]         — logger
 * @returns {Promise<{ ok: boolean, data?: object, validation?: object, error?: string }>}
 */
async function retrySection(opts) {
  const log = opts.log || (() => {});
  if (!opts.extractFn || typeof opts.extractFn !== 'function') return { ok: false, error: 'no_extractFn_provided' };

  const { start, end } = opts.pageRange || {};
  if (!start || !end || end < start) return { ok: false, error: `invalid page range: ${JSON.stringify(opts.pageRange)}` };
  const pageCount = end - start + 1;
  if (pageCount > 200) return { ok: false, error: `page range too large (${pageCount} pages, max 200)` };

  // 1. Download the full PDF
  let localPdf;
  try {
    localPdf = await downloadPdfFromUrl(opts.pdfUrl);
    log(`  fallback ${opts.sectionName}: downloaded PDF`);
  } catch (e) {
    return { ok: false, error: `download_failed: ${e.message}` };
  }
  if (!localPdf) return { ok: false, error: 'no_pdf_source_available' };

  // 2. Slice to the section's page range
  let slicePath;
  try {
    const { slicePdf } = require('./pdfSlicer');
    slicePath = path.join(os.tmpdir(), `fallback_${opts.slug}_${opts.sectionName}_p${start}-${end}_${Date.now()}.pdf`);
    await slicePdf(localPdf, start, end, slicePath);
    log(`  fallback ${opts.sectionName}: sliced pages ${start}-${end} (${pageCount} pages)`);
  } catch (e) {
    return { ok: false, error: `slice_failed: ${e.message}` };
  }

  // 3. Read per-page text from the sliced PDF, format as markdown
  let pageTexts;
  try {
    const { readPageTexts } = require('./financialsExtractor');
    pageTexts = await readPageTexts(slicePath);
  } catch (e) {
    fs.unlink(slicePath, () => {});
    return { ok: false, error: `page_text_failed: ${e.message}` };
  }
  fs.unlink(slicePath, () => {});

  // Build markdown with page headers so Firecrawl has structure to work with
  const md = `# Section: ${opts.sectionName} (pages ${start}-${end})\n\n`
    + pageTexts.map((t, i) => `## Page ${start + i}\n\n${t}`).join('\n\n');

  // 4. Upload markdown to R2
  const sliceKey = `fallback/${opts.slug}/${opts.docType}/${opts.sectionName}_p${start}-${end}.md`;
  if (!(await objectExists(sliceKey))) await putText(sliceKey, md);
  const sliceUrl = getPublicUrl(sliceKey);

  // 5. Firecrawl scrape the uploaded markdown (1 credit)
  let fcMd;
  try {
    const result = await scrapeToMarkdown(sliceUrl);
    fcMd = result.markdown;
    log(`  fallback ${opts.sectionName}: ${fcMd.length} chars`);
  } catch (e) {
    return { ok: false, error: `firecrawl_failed: ${e.message}` };
  }
  if (!fcMd || fcMd.length < 50) return { ok: false, error: 'firecrawl_returned_empty_markdown' };

  // 6. Run the extractor on Firecrawl's result
  let extracted;
  try {
    extracted = opts.extractFn(fcMd);
    log(`  fallback ${opts.sectionName}: extractor returned ${extracted ? 'data' : 'null'}`);
  } catch (e) {
    return { ok: false, error: `extraction_failed: ${e.message}` };
  }
  if (!extracted) return { ok: false, error: 'extractor_returned_null' };

  // 6. Validate
  const flat = flattenExtraction(extracted, opts.sectionName);
  const validation = validateExtraction(flat);
  log(`  fallback ${opts.sectionName}: validation score=${validation.score}, needsReview=${validation.needsReview}`);

  return {
    ok: validation.score >= 0.7 && !validation.needsReview,
    data: extracted,
    validation,
  };
}

/** Download a PDF from a URL to a temp file and return the local path. */
async function downloadPdfFromUrl(url) {
  const { downloadPdf } = require('./pdfDownloader');
  const dl = await downloadPdf(url);
  if (dl.status !== 'success' && dl.status !== 'already_parsed') throw new Error(dl.status);
  return dl.filePath;
}

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

module.exports = { retrySection };
