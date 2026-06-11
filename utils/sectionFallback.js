'use strict';

/**
 * sectionFallback.js — retry extraction for a single section that failed
 * regex-based validation, using Firecrawl on a page-range markdown slice.
 *
 * Flow:
 *   regex extraction → validate → failed? → slice the existing markdown
 *   (which has "===== PAGE N =====" markers) to the section's page range →
 *   upload text slice to R2 → Firecrawl scrape → re-run deterministic
 *   extractor → validate → return
 *
 * No PDF re-parsing — we already have the full markdown. Slicing text is
 * instant and costs nothing.
 *
 * Adding support for a new section? Just add an entry to SECTION_EXTRACTORS below.
 */

const { scrapeToMarkdown } = require('./firecrawl');
const { getPublicUrl, objectExists, putText } = require('./r2');
const { validateExtraction } = require('./validation');
const { getText } = require('./r2');

/**
 * Retry extraction for a single section using Firecrawl on a markdown slice.
 *
 * @param {object} opts
 * @param {string} opts.slug        — IPO slug
 * @param {string} opts.docType      — 'drhp' | 'rhp' | 'final'
 * @param {string} opts.sectionName  — section short name (e.g. 'financials')
 * @param {{ start: number, end: number }} opts.pageRange  — 1-based page range
 * @param {string} opts.markdown     — full document markdown (with PAGE markers)
 * @param {Function} opts.extractFn  — extractor function(md) that returns parsed data
 * @param {object} [opts.log]        — logger
 * @returns {Promise<{ ok: boolean, data?: object, validation?: object, error?: string }>}
 */
async function retrySection(opts) {
  const log = opts.log || (() => {});
  if (!opts.extractFn || typeof opts.extractFn !== 'function') return { ok: false, error: 'no_extractFn_provided' };
  if (!sectionKey) {
    if (NOOP_SECTIONS.has(opts.sectionName)) return { ok: false, error: 'no_extractor_needed' };
    return { ok: false, error: `unknown section: ${opts.sectionName}` };
  }

  const { start, end } = opts.pageRange || {};
  if (!start || !end || end < start) return { ok: false, error: `invalid page range: ${JSON.stringify(opts.pageRange)}` };
  const pageCount = end - start + 1;
  if (pageCount > 200) return { ok: false, error: `page range too large (${pageCount} pages, max 200)` };
  if (!opts.markdown) return { ok: false, error: 'no_markdown_provided' };

  // 1. Slice markdown to the section's page range using PAGE markers.
  const pageRe = /=====\s*PAGE\s+(\d+)\s*=====/gi;
  const pages = [];
  let lastIdx = 0;
  let lastPage = null;
  let m;
  while ((m = pageRe.exec(opts.markdown)) !== null) {
    const pageNum = parseInt(m[1], 10);
    if (lastPage != null) pages.push({ page: lastPage, start: lastIdx, end: m.index });
    lastPage = pageNum;
    lastIdx = m.index;
  }
  if (lastPage != null) pages.push({ page: lastPage, start: lastIdx, end: opts.markdown.length });

  const sliceParts = pages.filter((p) => p.page >= start && p.page <= end);
  if (!sliceParts.length) return { ok: false, error: `no pages found in range ${start}-${end}` };

  const slicedMd = sliceParts.map((p) => opts.markdown.slice(p.start, p.end)).join('\n');
  log(`  fallback ${opts.sectionName}: sliced ${sliceParts.length} pages (${start}-${end}) from markdown → ${slicedMd.length} chars`);

  // 2. Upload sliced markdown to R2 so Firecrawl can reach it
  const sliceKey = `fallback/${opts.slug}/${opts.docType}/${opts.sectionName}_p${start}-${end}.md`;
  if (!(await objectExists(sliceKey))) await putText(sliceKey, slicedMd);
  const sliceUrl = getPublicUrl(sliceKey);

  // 3. Firecrawl scrape the sliced markdown
  let md;
  try {
    const result = await scrapeToMarkdown(sliceUrl);
    md = result.markdown;
    log(`  fallback ${opts.sectionName}: Firecrawl returned ${md.length} chars`);
  } catch (e) {
    return { ok: false, error: `firecrawl_failed: ${e.message}` };
  }
  if (!md || md.length < 50) return { ok: false, error: 'firecrawl_returned_empty_markdown' };

  // 4. Run the extractor directly on the Firecrawl markdown
  let extracted;
  try {
    extracted = opts.extractFn(md);
    log(`  fallback ${opts.sectionName}: extractor returned ${extracted ? 'data' : 'null'}`);
  } catch (e) {
    return { ok: false, error: `extraction_failed: ${e.message}` };
  }
  if (!extracted) return { ok: false, error: 'extractor_returned_null' };

  // 5. Validate
  const flat = flattenExtraction(extracted, opts.sectionName);
  const validation = validateExtraction(flat);

  log(`  fallback ${opts.sectionName}: validation score=${validation.score}, needsReview=${validation.needsReview}`);

  return {
    ok: validation.score >= 0.7 && !validation.needsReview,
    data: extracted,
    validation,
  };
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

module.exports = { retrySection, SECTION_EXTRACTORS };
