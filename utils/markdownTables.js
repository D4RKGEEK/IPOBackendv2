'use strict';

/**
 * markdownTables.js — deterministic parsing of markdown tables (as produced by
 * Firecrawl from prospectus PDFs). No LLM. Used to extract financials/KPIs from
 * the cached markdown by locating the relevant table and reading its cells.
 */

/** Split a markdown table line "| a | b | c |" into trimmed cells. */
function splitRow(line) {
  let l = line.trim();
  if (l.startsWith('|')) l = l.slice(1);
  if (l.endsWith('|')) l = l.slice(0, -1);
  return l.split('|').map((c) => c.trim());
}

function isTableLine(line) {
  const t = line.trim();
  return t.startsWith('|') && t.indexOf('|', 1) !== -1;
}

/** A markdown separator row like |---|:--:|. */
function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c.replace(/\s/g, '')) || c === '');
}

/**
 * Parse all markdown tables into { rows: string[][] } blocks (separator rows
 * dropped). A block is 2+ consecutive table lines.
 */
function parseMarkdownTables(md) {
  const lines = String(md || '').split('\n');
  const tables = [];
  let cur = null;
  for (const line of lines) {
    if (isTableLine(line)) {
      const cells = splitRow(line);
      if (!cur) cur = { rows: [] };
      if (!isSeparatorRow(cells)) cur.rows.push(cells);
    } else if (cur) {
      if (cur.rows.length >= 2) tables.push(cur);
      cur = null;
    }
  }
  if (cur && cur.rows.length >= 2) tables.push(cur);
  return tables;
}

/** Parse an Indian-format number; (x) → negative; strips %, commas, ₹. Null if NaN. */
function parseNum(s) {
  if (s == null) return null;
  let t = String(s).replace(/[₹,%]/g, '').replace(/\s/g, '').trim();
  if (!t) return null;
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  if (/^-/.test(t)) { neg = true; t = t.slice(1); }
  if (!/^\d*\.?\d+$/.test(t)) return null;
  const n = parseFloat(t);
  if (Number.isNaN(n)) return null;
  return neg ? -n : n;
}

const PERIOD_RE = /(?:jan|feb|mar(?:ch)?|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?[, ]*\d{2,4}|fy\s*'?\d{2,4}|20\d{2}\s*[-–]\s*\d{2,4}|\b20\d{2}\b|\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/i;

/** Does a cell look like a fiscal-period label? */
function looksLikePeriod(cell) {
  return PERIOD_RE.test(String(cell || ''));
}

/**
 * In a table's rows, find the row that is the period header (most period-like
 * cells, ≥2) and the column indices that hold periods.
 * @returns {{ rowIndex: number, cols: number[], labels: string[] } | null}
 */
function findPeriodRow(rows) {
  let best = null;
  for (let i = 0; i < rows.length; i++) {
    const cols = [];
    rows[i].forEach((c, idx) => { if (looksLikePeriod(c)) cols.push(idx); });
    if (cols.length >= 2 && (!best || cols.length > best.cols.length)) {
      best = { rowIndex: i, cols, labels: cols.map((idx) => rows[i][idx]) };
    }
  }
  return best;
}

module.exports = { parseMarkdownTables, splitRow, isTableLine, isSeparatorRow, parseNum, looksLikePeriod, findPeriodRow, PERIOD_RE };
