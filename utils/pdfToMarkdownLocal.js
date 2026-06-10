'use strict';

/**
 * pdfToMarkdownLocal.js — convert a local PDF to markdown using Nutrient's
 * pdf-to-markdown CLI (@pspdfkit/pdf-to-markdown). Local, free, fast (~10s),
 * no API key — and produces clean markdown tables (the thing our extractors need).
 *
 * This is the default PDF→markdown provider; Firecrawl remains a fallback.
 */

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const BIN = path.join(__dirname, '..', 'node_modules', '.bin', 'pdf-to-markdown');

/**
 * Convert a local PDF file to markdown.
 * @param {string} localPdfPath
 * @param {object} [opts] { timeout }
 * @returns {Promise<{ markdown: string, provider: 'nutrient' }>}
 */
function convertPdfToMarkdown(localPdfPath, opts = {}) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(localPdfPath)) return reject(new Error(`PDF not found: ${localPdfPath}`));
    const out = path.join(os.tmpdir(), `nutrient_${process.pid}_${Date.now()}.md`);
    execFile(BIN, [localPdfPath, out], { timeout: opts.timeout || 180000, maxBuffer: 128 * 1024 * 1024 }, (err) => {
      let md = '';
      try { if (fs.existsSync(out)) { md = fs.readFileSync(out, 'utf8'); fs.unlink(out, () => {}); } } catch (_) { /* ignore */ }
      if (!md || md.length < 200) {
        return reject(new Error(`pdf-to-markdown produced no output${err ? `: ${err.message}` : ''}`));
      }
      resolve({ markdown: md, provider: 'nutrient' });
    });
  });
}

module.exports = { convertPdfToMarkdown, BIN };
