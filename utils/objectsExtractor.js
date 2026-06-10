'use strict';

/**
 * objectsExtractor.js — extract the "Objects of the Issue" (use of proceeds) from
 * RHP markdown: the list of objects + estimated amounts. Deterministic table
 * parsing, with a numbered-list fallback (DRHPs often show amounts as ₹[●]).
 *
 * Amounts are in Lakhs (typical SME RHP unit); amountCr = Lakhs / 100.
 */

const { parseMarkdownTables, parseNum } = require('./markdownTables');

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const round2 = (n) => (n == null ? null : Math.round(n * 100) / 100);

const OBJECT_HINT = /working\s+capital|corporate\s+purpose|re-?payment|pre-?payment|capital\s+expenditure|manufactur|setting\s+up|offer\s+related\s+expense|issue\s+related\s+expense|inorganic|acquisition|brand|marketing/i;

/** Clean an object name: drop leading "1.", markdown escapes, trailing footnote markers. */
function cleanObjectName(s) {
  return norm(s).replace(/\\/g, '').replace(/^\(?\d+\)?\.?\s*/, '').replace(/[*#^]+$/, '').replace(/\s*\(\d+\)\s*$/, '').trim();
}

// Rows that are totals/subtotals, not actual objects.
const META_ROW = /^(?:net\s+(?:issue\s+)?proceeds|gross\s+proceeds|less\s*:|total\b|net\s+offer)/i;

/** Index of the cell with the most letters (the "Particulars" cell). */
function nameCellIndex(cells) {
  let bi = -1; let best = 0;
  cells.forEach((c, i) => { const n = (norm(c).match(/[a-z]/gi) || []).length; if (n > best) { best = n; bi = i; } });
  return best >= 6 ? bi : -1;
}

/** First parseable amount in a row after the name cell. */
function amountAfter(cells, nameIdx) {
  for (let i = nameIdx + 1; i < cells.length; i++) { const v = parseNum(cells[i]); if (v != null) return v; }
  return null;
}

/** Pick the objects table: contains GCP + object-like rows (+ ideally a Total). */
function pickObjectsTable(tables) {
  let best = null; let bestScore = 0;
  for (const t of tables) {
    const hasGcp = t.rows.some((r) => r.some((c) => /general\s+corporate\s+purpose/i.test(c)));
    if (!hasGcp) continue;
    const objectRows = t.rows.filter((r) => r.some((c) => OBJECT_HINT.test(c))).length;
    const hasTotal = t.rows.some((r) => /^total\b/i.test(norm(r.find((c) => norm(c)) || '')));
    const score = objectRows + (hasTotal ? 2 : 0);
    if (score > bestScore) { bestScore = score; best = t; }
  }
  return bestScore >= 2 ? best : null;
}

function detectUnit(md) {
  if (/amount[^.]{0,30}?(?:in\s*)?(?:rs\.?|₹|inr)?\s*(?:in\s*)?lakh/i.test(md)) return 'Lakhs';
  if (/amount[^.]{0,30}?(?:in\s*)?(?:rs\.?|₹|inr)?\s*(?:in\s*)?crore/i.test(md)) return 'Crore';
  return 'Lakhs';
}

/** Numbered-list fallback for object names (amounts not available, e.g. DRHP). */
function objectsFromList(text) {
  const idx = text.search(/following\s+objects?\s*[:\-]/i);
  if (idx < 0) return [];
  const seg = text.slice(idx, idx + 1500);
  const items = [...seg.matchAll(/\b\d+\.\s+([A-Z][^;|]{8,140}?)(?:;|\.\s|\|)/g)].map((m) => cleanObjectName(m[1]));
  const seen = new Set();
  const out = [];
  for (const name of items) {
    const key = name.toLowerCase();
    if (name.length >= 8 && !seen.has(key)) { seen.add(key); out.push({ name, amount: null, amountCr: null }); }
  }
  return out;
}

/**
 * Extract objects of the issue from RHP markdown.
 * @param {string} md
 * @returns {{ objects, total, totalCr, unit, source }|null}
 */
function extractObjects(md) {
  const tables = parseMarkdownTables(md);
  const table = pickObjectsTable(tables);
  const unit = detectUnit(md);
  const cr = (amt) => (amt == null ? null : (unit === 'Crore' ? round2(amt) : round2(amt / 100)));

  let objects = [];
  let total = null;
  if (table) {
    for (const row of table.rows) {
      if (row.some((c) => /particulars/i.test(c)) && row.some((c) => /amount|%/i.test(c))) continue; // header
      const firstNonEmpty = norm(row.find((c) => norm(c)) || '');
      if (/^total\b/i.test(firstNonEmpty)) { total = amountAfter(row, row.findIndex((c) => /^total\b/i.test(norm(c)))); continue; }
      const ni = nameCellIndex(row);
      if (ni < 0) continue;
      const name = cleanObjectName(row[ni]);
      if (name.length < 6 || META_ROW.test(name)) continue;
      const amount = amountAfter(row, ni);
      objects.push({ name, amount, amountCr: cr(amount) });
    }
  }

  // Fallback to the numbered list for names when the table is missing/sparse.
  let source = 'table';
  if (objects.length < 2) {
    const listed = objectsFromList(norm(md));
    if (listed.length > objects.length) { objects = listed; total = null; source = 'list'; }
  }
  if (!objects.length) return null;

  // Total: prefer the table's Total row, else the sum of known amounts.
  const known = objects.map((o) => o.amount).filter((v) => v != null);
  if (total == null && known.length) total = round2(known.reduce((a, b) => a + b, 0));

  return { objects, total, totalCr: cr(total), unit, source };
}

module.exports = { extractObjects, cleanObjectName, pickObjectsTable, objectsFromList, detectUnit };
