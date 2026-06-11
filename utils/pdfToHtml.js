'use strict';

/**
 * pdfToHtml.js — convert PDF pages to clean HTML with proper tables,
 * using pdfjs text coordinates to preserve column/row structure.
 *
 * pdfjs item: { str, transform: [a, b, c, d, tx, ty], height, width }
 *   tx, ty = x, y position
 *   height ≈ fontSize
 */

/**
 * Group text items into rows by y-coordinate, then columns by x-position.
 * Returns an array of { pageNum, rows: [{ y, cells: [{ x, text }] }] }
 */
function buildPageHtml(pageNum, items, pageWidth = 612, pageHeight = 792) {
  if (!items || !items.length) {
    return `<h2>Page ${pageNum}</h2>\n<p>No text content found</p>`;
  }

  // 1. Filter out empty strings and group by y-position (rounded to nearest 2px)
  const Y_TOLERANCE = 2;
  const rows = [];
  for (const item of items) {
    const str = (item.str || '').trim();
    if (!str) continue;
    const y = Math.round((item.transform[5] || 0) / Y_TOLERANCE) * Y_TOLERANCE;
    const x = Math.round(item.transform[4] || 0);
    let row = rows.find((r) => r.y === y);
    if (!row) {
      row = { y, cells: [] };
      rows.push(row);
    }
    row.cells.push({ x, text: str });
  }

  // 2. Sort rows by y descending (top to bottom), cells by x ascending
  rows.sort((a, b) => b.y - a.y);
  for (const row of rows) {
    row.cells.sort((a, b) => a.x - b.x);
  }

  // 3. Detect if this page has a table structure: multiple adjacent rows
  // with similar cell count (≥2 rows with ≥2 columns each)
  const cellCounts = rows.map((r) => r.cells.length);
  const tableRows = rows.filter((r) => r.cells.length >= 2);
  const isTable = tableRows.length >= 2;

  if (isTable) {
    // Merge cells that are x-close into the same column (within 8px tolerance)
    const X_TOLERANCE = 8;
    let html = `<h2>Page ${pageNum}</h2>\n`;
    html += '<table border="1" cellpadding="4" style="border-collapse:collapse;font-size:10px">\n';

    // Build column groups from all table rows
    const allCols = [];
    for (const row of tableRows) {
      const cols = [];
      let cur = { x: row.cells[0].x, texts: [row.cells[0].text] };
      for (let i = 1; i < row.cells.length; i++) {
        const c = row.cells[i];
        if (c.x - cur.x < X_TOLERANCE + 20 && c.text.length < 3) {
          cur.texts.push(c.text);
          cur.x = c.x;
        } else if (c.x - (cur.x + 20) < X_TOLERANCE) {
          cur.texts.push(c.text);
          cur.x = Math.max(cur.x, c.x);
        } else {
          cols.push(cur);
          cur = { x: c.x, texts: [c.text] };
        }
      }
      cols.push(cur);
      allCols.push(cols);
    }

    // Normalize column count (use the median)
    const colCounts = allCols.map((c) => c.length).sort((a, b) => a - b);
    const targetCols = colCounts[Math.floor(colCounts.length / 2)] || colCounts[0] || 2;

    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri];
      const isHeader = ri === 0 || row.cells.every((c) => /^[A-Z]/.test(c.text) && c.text.length < 30);
      const tag = isHeader ? 'th' : 'td';

      // If this row is part of the table structure
      if (row.cells.length >= 1) {
        html += '  <tr>';
        for (let ci = 0; ci < row.cells.length; ci++) {
          const cell = row.cells[ci];
          // Check if next cell is very close (should be same column)
          const nextCell = row.cells[ci + 1];
          const safeText = cell.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          html += `<${tag}>${safeText}</${tag}>`;
        }
        html += '</tr>\n';
      }
    }
    html += '</table>\n';
    return html;
  }

  // 4. Not a table — plain text in <pre>
  const text = rows.map((r) => r.cells.map((c) => c.text).join(' ')).join('\n');
  const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<h2>Page ${pageNum}</h2>\n<pre>${safe}</pre>`;
}

/**
 * Convert a list of per-page pdfjs text contents into a full HTML document.
 * @param {Array<{ pageNum: number, items: object[] }>} pages
 * @param {string} title
 * @returns {string} HTML
 */
function pagesToHtml(pages, title = 'document') {
  const body = pages
    .map((p) => buildPageHtml(p.pageNum, p.items))
    .join('\n');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title></head>
<body>
<h1>${title}</h1>
${body}
</body></html>`;
}

/**
 * Read a PDF and return per-page text content items (with coordinates).
 * @param {string} filePath
 * @returns {Promise<Array<{ pageNum: number, items: object[] }>>}
 */
async function readPageItems(filePath) {
  const fs = require('fs');
  const pdfjsLib = await import('pdfjs-dist/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjsLib.getDocument({ data, verbosity: 0, disableWorker: true }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push({ pageNum: i, items: content.items });
  }
  await doc.destroy();
  return pages;
}

module.exports = { buildPageHtml, pagesToHtml, readPageItems };
