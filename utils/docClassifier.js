'use strict';

/**
 * docClassifier.js — robustly decide whether a prospectus is a DRHP, RHP, or
 * final prospectus. Two signals, combined:
 *
 *   1. Filename / URL patterns — cheap, available at scrape time. Handles both
 *      abbreviations ("drhp", "rhp") and full phrases ("Draft Red Herring
 *      Prospectus", "Red-Herring-Prospectus"), plus SEBI filing pages (DRHP).
 *   2. Cover-page text — AUTHORITATIVE. Every Indian IPO doc prints its type at
 *      the top of page 1: "DRAFT RED HERRING PROSPECTUS" / "RED HERRING
 *      PROSPECTUS" / "PROSPECTUS". When available this overrides the filename.
 *
 * classifyDocType({url, coverText}) merges them; default is 'drhp' when nothing
 * is decisive (per project rule).
 */

/**
 * Classify from a URL / filename. Order matters: 'drhp' contains 'rhp', and
 * "draft red herring" contains "red herring", so the draft checks run first.
 * @returns {{docType: 'drhp'|'rhp'|'final'|null, confidence: number, method: string}}
 */
function classifyFromName(url) {
  if (!url) return { docType: null, confidence: 0, method: 'filename' };
  let s = String(url);
  try { s = decodeURIComponent(s); } catch (_) { /* keep raw */ }
  s = s.toLowerCase().replace(/[._\-/+%]+/g, ' ');

  const draft = /\bdrhp\b/.test(s) || /draft\s+red\s*herring/.test(s) || /\bddrhp\b/.test(s) || s.includes('drhp');
  if (draft) return { docType: 'drhp', confidence: 0.9, method: 'filename' };

  // SEBI public-issue filing pages are draft offer documents.
  if (/sebi\s+gov\s+in\s+filings/.test(s) || /sebi\.gov\.in\/filings/i.test(String(url))) {
    return { docType: 'drhp', confidence: 0.8, method: 'filename' };
  }

  if (s.includes('rhp') || /red\s*herring/.test(s)) return { docType: 'rhp', confidence: 0.88, method: 'filename' };
  if (/\bfinal\b/.test(s)) return { docType: 'final', confidence: 0.8, method: 'filename' };
  // bare "prospectus" with no qualifier is ambiguous -> let the cover decide
  return { docType: null, confidence: 0, method: 'filename' };
}

/**
 * Classify from cover-page text (page 1). Authoritative.
 * @param {string} text
 * @returns {{docType, confidence, method: 'cover'}|null}
 */
function classifyFromCoverText(text) {
  if (!text) return null;
  const t = String(text).toUpperCase().replace(/\s+/g, ' ');
  // Look only near the top — the type banner is in the first chunk of the cover.
  const head = t.slice(0, 4000);
  if (/DRAFT\s+RED\s+HERRING\s+PROSPECTUS/.test(head)) return { docType: 'drhp', confidence: 0.99, method: 'cover' };
  if (/RED\s+HERRING\s+PROSPECTUS/.test(head)) return { docType: 'rhp', confidence: 0.98, method: 'cover' };
  if (/\bPROSPECTUS\b/.test(head)) return { docType: 'final', confidence: 0.8, method: 'cover' };
  return null;
}

/**
 * Combine both signals. Cover text wins when present; otherwise filename;
 * otherwise default to 'drhp'.
 * @param {{url?: string, coverText?: string}} input
 * @returns {{docType, confidence, method}}
 */
function classifyDocType(input = {}) {
  const cover = input.coverText ? classifyFromCoverText(input.coverText) : null;
  if (cover) return cover;
  const name = classifyFromName(input.url);
  if (name.docType) return name;
  return { docType: 'drhp', confidence: 0.3, method: 'default' };
}

/**
 * Extract cover-page text (page 1 by default) from a PDF file path or Buffer,
 * for authoritative classification.
 * @param {string|Buffer} input
 * @param {{pages?: number}} [opts]
 * @returns {Promise<string>}
 */
async function extractCoverText(input, opts = {}) {
  const pdfjsLib = await import('pdfjs-dist/build/pdf.mjs');
  const fs = require('fs');
  const bytes = Buffer.isBuffer(input) ? input : fs.readFileSync(input);
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(bytes), verbosity: 0, disableWorker: true }).promise;
  const pages = Math.min(opts.pages || 1, doc.numPages);
  let text = '';
  for (let i = 1; i <= pages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += ' ' + content.items.map((it) => it.str).join(' ');
  }
  await doc.destroy();
  return text.replace(/\s+/g, ' ').trim();
}

module.exports = { classifyDocType, classifyFromName, classifyFromCoverText, extractCoverText };
