'use strict';

/**
 * sectionFallback.js — retry extraction for a single section that failed
 * regex-based validation, using Firecrawl /v1/scrape with JSON schema.
 *
 * Flow:
 *   regex extraction → validate → fail?
 *   → slice PDF to section pages → read per-page text → build HTML →
 *   upload HTML to R2 → Firecrawl scrape with section's JSON schema + prompt →
 *   get clean structured JSON → validate → return
 *
 * Adding a new section? Just add an entry in utils/sectionSchemas.js.
 * This file doesn't need to change.
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const { parseHtml } = require('./firecrawl');
const { validateExtraction } = require('./validation');
const { getSection } = require('./sectionSchemas');

/**
 * Retry extraction using Firecrawl JSON extraction on a page-range HTML slice.
 *
 * @param {object} opts
 * @param {string} opts.slug          — IPO slug
 * @param {string} opts.docType       — 'drhp' | 'rhp' | 'final'
 * @param {string} opts.sectionName   — short name from sectionSchemas (e.g. 'financials')
 * @param {{ start: number, end: number }} opts.pageRange  — 1-based page range
 * @param {string} opts.pdfUrl        — URL to download the full PDF
 * @param {object} [opts.log]         — logger
 * @returns {Promise<{ ok: boolean, data?: object, validation?: object, error?: string }>}
 */
async function retrySection(opts) {
  const log = opts.log || (() => {});
  const section = getSection(opts.sectionName);
  if (!section) return { ok: false, error: `unknown section: ${opts.sectionName}` };

  const { start, end } = opts.pageRange || {};
  if (!start || !end || end < start) return { ok: false, error: `invalid page range: ${JSON.stringify(opts.pageRange)}` };
  const pageCount = end - start + 1;
  if (pageCount > 200) return { ok: false, error: `page range too large (${pageCount} pages, max 200)` };

  // 1. Download the full PDF
  let localPdf;
  try {
    localPdf = await downloadPdfFromUrl(opts.pdfUrl);
  } catch (e) {
    return { ok: false, error: `download_failed: ${e.message}` };
  }
  if (!localPdf) return { ok: false, error: 'no_pdf_source' };

  // 2. Slice to the section's page range
  let slicePath;
  try {
    const { slicePdf } = require('./pdfSlicer');
    slicePath = path.join(os.tmpdir(), `fb_${opts.slug}_${opts.sectionName}_p${start}-${end}_${Date.now()}.pdf`);
    await slicePdf(localPdf, start, end, slicePath);
    log(`  fallback ${opts.sectionName}: sliced pages ${start}-${end} (${pageCount} pgs)`);
  } catch (e) {
    return { ok: false, error: `slice_failed: ${e.message}` };
  }

  // 3. Read per-page text from the sliced PDF → build HTML
  let pageTexts;
  try {
    const { readPageTexts } = require('./financialsExtractor');
    pageTexts = await readPageTexts(slicePath);
  } catch (e) {
    fs.unlink(slicePath, () => {});
    return { ok: false, error: `page_text_failed: ${e.message}` };
  }
  fs.unlink(slicePath, () => {});

  const html = buildHtml(section.shortName, start, pageTexts);
  log(`  fallback ${opts.sectionName}: built HTML (${html.length} chars, ${pageTexts.length} pages)`);

  // 4. Firecrawl /v2/parse with JSON schema — send HTML directly (no R2 needed)
  let data;
  try {
    const filename = `${opts.slug}_${opts.sectionName}_p${start}-${end}.html`;
    data = await parseHtml(html, filename, section.schema, section.prompt);
    log(`  fallback ${opts.sectionName}: Firecrawl returned structured data`);
  } catch (e) {
    return { ok: false, error: `firecrawl_failed: ${e.message}` };
  }
  if (!data || (Array.isArray(data.metrics) && !data.metrics.length)) {
    return { ok: false, error: 'firecrawl_returned_empty_data' };
  }

  // 6. Validate
  const flat = flattenExtraction(data, opts.sectionName);
  const validation = validateExtraction(flat);
  log(`  fallback ${opts.sectionName}: validation score=${validation.score}, needsReview=${validation.needsReview}`);

  return {
    ok: validation.score >= 0.7 && !validation.needsReview,
    data,
    validation,
  };
}

/** Build a simple HTML doc from per-page text. */
function buildHtml(sectionName, startPage, pageTexts) {
  const rows = pageTexts.map((t, i) => {
    const safe = t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<h2>Page ${startPage + i}</h2>\n<pre>${safe}</pre>`;
  });
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>
<h1>${sectionName}</h1>
${rows.join('\n')}
</body></html>`;
}

/** Download PDF to temp file, return path. */
async function downloadPdfFromUrl(url) {
  const { downloadPdf } = require('./pdfDownloader');
  const dl = await downloadPdf(url);
  if (dl.status !== 'success' && dl.status !== 'already_parsed') throw new Error(dl.status);
  return dl.filePath;
}

/** Flatten Firecrawl JSON into key→value map for validation. */
function flattenExtraction(data, sectionName) {
  const flat = {};
  if (sectionName === 'financials' && Array.isArray(data.metrics)) {
    for (const m of data.metrics) {
      const vals = m.values || [];
      const last = vals[vals.length - 1];
      if (last != null) flat[m.key] = last;
    }
  }
  if (sectionName === 'kpis' && Array.isArray(data.kpis)) {
    for (const k of data.kpis) {
      const vals = k.values || [];
      const last = vals[vals.length - 1];
      if (last != null) flat[k.key] = last;
    }
  }
  if (sectionName === 'objectsOfIssue' && Array.isArray(data.objects)) {
    flat.objectCount = data.objects.length;
    if (data.total != null) flat.objectsTotal = data.total;
  }
  if (sectionName === 'issueDetails') {
    for (const k of ['totalIssueShares','freshIssueShares','ofsShares','marketMakerShares',
      'employeeReservationShares','netOfferShares','preIssueShares','postIssueShares']) {
      if (data[k] != null) flat[k] = data[k];
    }
  }
  return flat;
}

module.exports = { retrySection };
