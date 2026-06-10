'use strict';

/**
 * docPipeline.js — per-document pipeline for an IPO prospectus.
 *
 *   localPath/sourceUrl  ->  R2 (stable archive + public URL)
 *                        ->  Firecrawl  ->  markdown
 *                        ->  R2 (save markdown)
 *
 * Caching: if the markdown already exists in R2 it is reused (Firecrawl is the
 * slow/paid step, so we only run it once per document unless `force`).
 *
 * Lifecycle: removeRawPdf() drops the heavy source PDF after an IPO has closed,
 * while keeping the markdown + any extracted JSON.
 *
 * Key scheme:
 *   ipos/<symbol>/<docType>.pdf      raw prospectus
 *   ipos/<symbol>/<docType>.md       Firecrawl markdown
 *   ipos/<symbol>/<docType>.json     extracted data (written by extractors later)
 */

const fs = require('fs');
const r2 = require('./r2');
const { scrapeToMarkdown } = require('./firecrawl');
const { convertPdfToMarkdown } = require('./pdfToMarkdownLocal');

const VALID_DOC_TYPES = ['drhp', 'rhp', 'final'];

/** Build the R2 key for a document artifact. */
function docKey(symbol, docType, ext) {
  const sym = String(symbol || 'unknown').toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
  const dt = String(docType || 'rhp').toLowerCase();
  const e = String(ext || 'pdf').replace(/^\./, '');
  return `ipos/${sym}/${dt}.${e}`;
}

/**
 * Ensure the PDF is in R2 and return its public URL.
 * - localPath given  -> upload it (unless already present and !force)
 * - only sourceUrl   -> use it directly (Firecrawl can fetch it); not archived
 */
async function ensurePdf({ symbol, docType, localPath, sourceUrl, force }) {
  const pdfKey = docKey(symbol, docType, 'pdf');
  if (localPath) {
    if (force || !(await r2.objectExists(pdfKey))) {
      const up = await r2.uploadFile(localPath, pdfKey);
      return { pdfKey, pdfUrl: up.url, archived: true };
    }
    return { pdfKey, pdfUrl: r2.getPublicUrl(pdfKey), archived: true };
  }
  if (sourceUrl) return { pdfKey: null, pdfUrl: sourceUrl, archived: false };
  throw new Error('ensurePdf: need localPath or sourceUrl');
}

/**
 * Process one document end-to-end.
 *
 * @param {object} input
 * @param {string} input.symbol
 * @param {'drhp'|'rhp'|'final'} input.docType
 * @param {string} [input.localPath]   local PDF to archive to R2
 * @param {string} [input.sourceUrl]   remote PDF URL (used if no localPath)
 * @param {boolean} [input.force]      re-run even if markdown is cached
 * @param {object} [input.firecrawl]   opts passed to scrapeToMarkdown
 * @returns {Promise<object>}
 */
async function processDocument(input) {
  const { symbol, docType, force } = input;
  if (!VALID_DOC_TYPES.includes(String(docType).toLowerCase())) {
    throw new Error(`invalid docType "${docType}" (expected ${VALID_DOC_TYPES.join('/')})`);
  }
  const mdKey = docKey(symbol, docType, 'md');

  // Cache hit: reuse existing markdown.
  if (!force && (await r2.objectExists(mdKey))) {
    return { symbol, docType, cached: true, mdKey, mdUrl: r2.getPublicUrl(mdKey), pdfUrl: r2.getPublicUrl(docKey(symbol, docType, 'pdf')) };
  }

  const { pdfKey, pdfUrl, archived } = await ensurePdf(input);

  // PDF → markdown. Default provider is Nutrient's local CLI (free, fast, good
  // tables); Firecrawl is the fallback (and used when only a remote URL exists).
  const provider = (input.markdownProvider || process.env.MARKDOWN_PROVIDER || 'nutrient').toLowerCase();
  let markdown; let via;
  if (provider === 'nutrient' && input.localPath) {
    ({ markdown } = await convertPdfToMarkdown(input.localPath, input.nutrient || {}));
    via = 'nutrient';
  } else {
    ({ markdown } = await scrapeToMarkdown(pdfUrl, input.firecrawl || {}));
    via = 'firecrawl';
  }
  if (!markdown || markdown.length < 200) {
    throw new Error(`${via} returned little/no markdown for ${symbol}/${docType} (len ${markdown ? markdown.length : 0})`);
  }
  const saved = await r2.putText(mdKey, markdown);

  return {
    symbol, docType, cached: false, archived, provider: via,
    pdfKey, pdfUrl, mdKey, mdUrl: saved.url,
    markdownLength: markdown.length,
  };
}

/**
 * Lifecycle cleanup: delete the raw PDF(s) for a closed IPO, keeping markdown/JSON.
 * @param {string} symbol
 * @param {string[]} [docTypes] defaults to all
 * @returns {Promise<{symbol, deleted: string[]}>}
 */
async function removeRawPdf(symbol, docTypes = VALID_DOC_TYPES) {
  const deleted = [];
  for (const dt of docTypes) {
    const key = docKey(symbol, dt, 'pdf');
    if (await r2.objectExists(key)) {
      await r2.deleteObject(key);
      deleted.push(key);
    }
  }
  return { symbol, deleted };
}

module.exports = { processDocument, removeRawPdf, docKey, ensurePdf, VALID_DOC_TYPES };
