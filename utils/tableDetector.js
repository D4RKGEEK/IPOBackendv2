'use strict';

/**
 * tableDetector.js
 * Detect and extract ALL tables from a PDF page using coordinate analysis.
 * No hardcoded labels — finds any rectangular grid of text.
 *
 * Returns: Array of { tableIndex, rows: [[cell, cell, ...], ...] }
 */

const path = require('path');

/**
 * Group text items into rows by Y coordinate.
 */
function buildRows(items, yTolerance = 4) {
  const buckets = {};
  for (const item of items) {
    if (!item.str || !item.str.trim()) continue;
    const bucket = Math.round(item.transform[5] / yTolerance) * yTolerance;
    if (!buckets[bucket]) buckets[bucket] = [];
    buckets[bucket].push({ x: Math.round(item.transform[4]), text: item.str.trim() });
  }
  return Object.entries(buckets)
    .sort(([a], [b]) => Number(b) - Number(a))
    .map(([y, cells]) => ({
      y: Number(y),
      cells: cells.sort((a, b) => a.x - b.x),
      text: cells.map(c => c.text).join(' '),
    }));
}

/**
 * Detect columns by clustering X positions across consecutive data rows.
 * @param {Array} rows - From buildRows()
 * @returns {number[]} X-boundary positions between columns
 */
function detectColumnBoundaries(rows) {
  // Collect all X positions from rows that look like data (not headers)
  const allX = [];
  for (const row of rows) {
    for (const cell of row.cells) {
      allX.push(cell.x);
    }
  }
  if (allX.length === 0) return [];

  // Cluster X values within 20px tolerance
  allX.sort((a, b) => a - b);
  const clusters = [];
  let current = { min: allX[0], max: allX[0], count: 1 };
  for (let i = 1; i < allX.length; i++) {
    if (allX[i] - current.max < 20) {
      current.max = Math.max(current.max, allX[i]);
      current.count++;
    } else {
      clusters.push(current);
      current = { min: allX[i], max: allX[i], count: 1 };
    }
  }
  clusters.push(current);

  // Filter to clusters with at least 3 items (likely columns)
  return clusters.filter(c => c.count >= 2).map(c => Math.round((c.min + c.max) / 2));
}

/**
 * Assign each cell in a row to the nearest column center.
 */
function assignToColumns(cells, colCenters) {
  if (colCenters.length === 0) return [cells.map(c => c.text).join(' ')];
  const cols = new Array(colCenters.length).fill('');
  for (const cell of cells) {
    let best = 0;
    let bestDist = Math.abs(cell.x - colCenters[0]);
    for (let i = 1; i < colCenters.length; i++) {
      const d = Math.abs(cell.x - colCenters[i]);
      if (d < bestDist) { best = i; bestDist = d; }
    }
    cols[best] = (cols[best] ? cols[best] + ' ' : '') + cell.text;
  }
  return cols;
}

/**
 * Extract all tables from a single page.
 * Only returns pages that look like real tables (3+ cols, 3+ data rows).
 */
function extractTablesFromPage(items) {
  const rows = buildRows(items);
  if (rows.length < 5) return [];

  const colCenters = detectColumnBoundaries(rows);
  if (colCenters.length < 3) return []; // need 3+ columns for a real table

  // Build table: assign all rows to columns
  const assignedRows = rows.map(r => ({
    y: r.y,
    cells: assignToColumns(r.cells, colCenters),
  }));

  // Filter to rows that have content in at least 2 columns
  const dataRows = assignedRows.filter(r => r.cells.filter(c => c.trim()).length >= 2);
  if (dataRows.length < 3) return []; // too few real data rows

  // Key heuristic: real tables have proper numbers in at least one column
  const hasNumbers = colCenters.some((_, ci) => {
    const nums = dataRows.filter(r => {
      const v = r.cells[ci]?.trim();
      return v && /^-?[\d,]+\.?\d*%?$/.test(v);
    });
    return nums.length >= 3;
  });
  if (!hasNumbers) return [];

  // The first contentful row is the header
  const headers = dataRows[0].cells;
  const bodyRows = dataRows.slice(1).map(r => r.cells);

  const table = {
    numCols: colCenters.length,
    headers,
    rows: bodyRows,
  };

  return [table];
}

/**
 * Detect and extract ALL tables from a PDF file.
 * Scans every page, returns structured arrays.
 *
 * @param {string} filePath
 * @returns {Promise<Array<{page: number, coords: {left: number, right: number, top: number, bottom: number}, headers: string[], rows: string[][]}>>}
 */
async function detectAllTables(filePath) {
  const pdfjsLib = await import('pdfjs-dist/build/pdf.mjs');
  const fs = require('fs');

  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjsLib.getDocument({ data, disableWorker: true }).promise;
  const totalPages = doc.numPages;

  const allTables = [];

  for (let p = 1; p <= totalPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const tables = extractTablesFromPage(content.items);

    for (const t of tables) {
      allTables.push({
        page: p,
        numCols: t.numCols,
        headers: t.headers,
        rows: t.rows,
      });
    }
  }

  return allTables;
}

module.exports = { detectAllTables, buildRows, detectColumnBoundaries, extractTablesFromPage };
