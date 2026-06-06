'use strict';

/**
 * tableExtractor.js
 * Extract structured financial data from IPO prospectus PDFs using pdfjs-dist.
 * Uses coordinate-based table reconstruction — no LLM needed.
 */

const path = require('path');

// Row label matchers → field names
const ROW_MATCHERS = [
  { re: /revenue from operations/i,          field: 'revenueFromOperations' },
  { re: /total\s+income/i,                   field: 'totalIncome' },
  { re: /net\s+profit\s+(?:for|after)/i,     field: 'netProfit' },
  { re: /profit\s+after\s+tax/i,             field: 'netProfit' },
  { re: /pat\b/i,                            field: 'netProfit' },
  { re: /ebitda/i,                           field: 'ebitda' },
  { re: /basic\s+earn/i,                     field: 'basicEPS' },
  { re: /diluted\s+earn/i,                   field: 'dilutedEPS' },
  { re: /net\s+asset\s+value\s+per\s+share/i, field: 'navPerShare' },
  { re: /net\s+worth/i,                      field: 'netWorth' },
  { re: /total\s+borrowings?/i,              field: 'totalBorrowings' },
  { re: /equity\s+share\s+capital/i,         field: 'equityShareCapital' },
  { re: /return\s+on\s+net\s+worth/i,        field: 'ronw' },
  { re: /ronw/i,                             field: 'ronw' },
  { re: /p\s*\/\s*e\s*ratio/i,               field: 'peRatio' },
  { re: /debt\s*[/-]\s*equity/i,             field: 'debtToEquity' },
];

// Column header matchers → year labels
const YEAR_RE = /(?:march|sep|june?|dec)\w*\s*\d{2,4}|fy\s*\d{2,4}|20\d{2}[-–]\d{2,4}/i;

/**
 * Reconstruct rows from pdfjs text items using Y-coordinate grouping.
 * @param {Array} items - pdfjs TextItem array
 * @param {number} yTolerance - pixels to group into same row
 * @returns {Array<{y: number, cells: Array<{x: number, text: string}>}>}
 */
function buildRows(items, yTolerance = 4) {
  const buckets = {};
  for (const item of items) {
    if (!item.str || !item.str.trim()) continue;
    const y = item.transform[5];
    const x = item.transform[4];
    // Round y to nearest bucket
    const bucket = Math.round(y / yTolerance) * yTolerance;
    if (!buckets[bucket]) buckets[bucket] = [];
    buckets[bucket].push({ x, text: item.str.trim() });
  }
  return Object.entries(buckets)
    .sort(([a], [b]) => Number(b) - Number(a)) // top to bottom
    .map(([y, cells]) => ({
      y: Number(y),
      cells: cells.sort((a, b) => a.x - b.x),
      text: cells.sort((a, b) => a.x - b.x).map(c => c.text).join(' '),
    }));
}

/**
 * Parse a number string from Indian format (e.g. "1,08,900" or "1,652.47")
 * @param {string} s
 * @returns {number|null}
 */
function parseIndianNumber(s) {
  const clean = s.replace(/,/g, '').trim();
  const n = parseFloat(clean);
  return isNaN(n) ? null : n;
}

/**
 * Extract financial KPIs from a single PDF page's text items.
 * @param {Array} items - pdfjs TextItem array from page.getTextContent()
 * @returns {object} extracted fields
 */
function extractFromPageItems(items) {
  const rows = buildRows(items);
  const result = {};

  // First pass: find header row with year columns by scanning for rows with 2+ year-like fragments
  // Collect ALL year-fragment cells across consecutive rows (headers often span 2 rows due to wrapping)
  let colPositions = []; // { x, label }
  let headerY = null;
  for (const row of rows) {
    const yearMatches = row.cells.filter(c => YEAR_RE.test(c.text));
    if (yearMatches.length >= 2) {
      headerY = row.y;
      colPositions = yearMatches.map(c => ({ x: c.x, label: c.text }));
      break;
    }
  }

  // Build a stable ordered column index sorted by X position (left=latest, right=oldest)
  colPositions.sort((a, b) => a.x - b.x);
  const colKeys = colPositions.map((_, i) => `fy${i}`);
  const colLabels = colPositions.map(c => c.label);

  // Store column labels in result meta
  if (colLabels.length > 0) {
    result._columns = colLabels;
  }

  // Second pass: match data rows to field names
  for (const row of rows) {
    for (const matcher of ROW_MATCHERS) {
      if (result[matcher.field]) continue; // already found
      if (!matcher.re.test(row.text)) continue;

      // Extract numeric cells from this row
      const numericCells = row.cells.filter(c => {
        const clean = c.text.replace(/,/g, '').trim();
        return /^-?\d+\.?\d*$/.test(clean);
      });

      if (numericCells.length === 0) continue;

      if (colPositions.length >= 2 && numericCells.length >= 2) {
        // Map numbers to column index by X proximity
        const values = {};
        for (const num of numericCells) {
          let bestIdx = 0;
          let bestDist = Math.abs(num.x - colPositions[0].x);
          for (let ci = 1; ci < colPositions.length; ci++) {
            const d = Math.abs(num.x - colPositions[ci].x);
            if (d < bestDist) { bestIdx = ci; bestDist = d; }
          }
          values[colKeys[bestIdx]] = parseIndianNumber(num.text);
        }
        result[matcher.field] = values;
      } else {
        // Single value — take first numeric after label
        result[matcher.field] = parseIndianNumber(numericCells[0].text);
      }
      break;
    }
  }

  return result;
}

/**
 * Extract financial KPIs from a PDF file.
 * Scans pages 20–80 looking for the financial summary section.
 *
 * @param {string} filePath - path to PDF
 * @param {{ startPage?: number, endPage?: number }} options
 * @returns {Promise<object>} extracted KPIs
 */
async function extractFinancials(filePath, options = {}) {
  const pdfjsLib = await import('pdfjs-dist/build/pdf.mjs');
  const fs = require('fs');

  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const totalPages = doc.numPages;

  const startPage = options.startPage || 1;
  const endPage = Math.min(options.endPage || 100, totalPages);

  let best = {};
  let bestScore = 0;

  for (let i = startPage; i <= endPage; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const extracted = extractFromPageItems(content.items);
    const score = Object.keys(extracted).length;

    if (score > bestScore) {
      bestScore = score;
      best = { ...extracted, _sourcePage: i };
    }

    // If we have enough fields, stop scanning
    if (score >= 5) break;
  }

  return best;
}

/**
 * Extract promoter holding data from a PDF file.
 * Looks for shareholding pattern tables.
 *
 * @param {string} filePath
 * @returns {Promise<{preIssue: number|null, postIssue: number|null}>}
 */
async function extractPromoterHolding(filePath) {
  const pdfjsLib = await import('pdfjs-dist/build/pdf.mjs');
  const fs = require('fs');

  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const totalPages = doc.numPages;

  for (let i = 1; i <= Math.min(totalPages, 120); i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const rows = buildRows(content.items);

    for (const row of rows) {
      // Look for promoter + promoter group total row
      if (!/total.*promoter|promoter.*total/i.test(row.text)) continue;

      const pctCells = row.cells.filter(c => /\d+\.\d+%?/.test(c.text));
      if (pctCells.length >= 2) {
        const vals = pctCells.map(c => parseFloat(c.text.replace('%', '')));
        return { preIssue: vals[0], postIssue: vals[vals.length - 1] };
      }
    }
  }

  return { preIssue: null, postIssue: null };
}

module.exports = { extractFinancials, extractPromoterHolding, buildRows, extractFromPageItems };
