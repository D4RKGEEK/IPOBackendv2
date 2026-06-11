'use strict';

/**
 * pdfTableParser.js — coordinate-based financial table parser.
 *
 * Uses pdfjs text item coordinates (x, y) to reconstruct table structure
 * deterministically. No regex on flat text, no LLM, no hallucinations.
 */

const MONTH_RE = /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\w*\b/i;
const YEAR_RE = /\b20\d{2}\b/;
const IS_NUMBER = /^[-\d,()]+(\.\d+)?$/;

// ---------------------------------------------------------------------------
// Coordinate grouping
// ---------------------------------------------------------------------------

function parseTable(items, yTolerance = 3, xTolerance = 5) {
  const rowMap = new Map();
  for (const item of items) {
    const str = (item.str || '').trim();
    if (!str) continue;
    const y = Math.round((item.transform[5] || 0) / yTolerance) * yTolerance;
    if (!rowMap.has(y)) rowMap.set(y, []);
    rowMap.get(y).push({ x: Math.round(item.transform[4] || 0), text: str });
  }

  const rows = [...rowMap.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([y, cells]) => {
      cells.sort((a, b) => a.x - b.x);
      const merged = [];
      for (const c of cells) {
        const last = merged[merged.length - 1];
        if (last && c.x - (last.x + last.text.length * 4) < xTolerance * 2) {
          last.text += ' ' + c.text;
        } else {
          merged.push({ ...c });
        }
      }
      return { y, cells: merged };
    });

  // Find period clusters — months + years grouped by x-position
  const clusters = [];
  for (const row of rows) {
    for (const cell of row.cells) {
      if (MONTH_RE.test(cell.text) || YEAR_RE.test(cell.text)) {
        const existing = clusters.find((c) => Math.abs(c.x - cell.x) < 30);
        if (existing) {
          if (!existing.texts.some((t) => t === cell.text)) existing.texts.push(cell.text);
        } else {
          clusters.push({ x: cell.x, texts: [cell.text] });
        }
      }
    }
  }

  // Keep only clusters with both month AND year
  const valid = clusters.filter((c) => {
    const all = c.texts.join(' ');
    return MONTH_RE.test(all) && YEAR_RE.test(all);
  }).sort((a, b) => a.x - b.x);

  if (valid.length < 2) return { rows, periodCols: [], periodLabels: [] };

  const periodLabels = valid.map((c) => c.texts.sort((a, b) => (MONTH_RE.test(a) ? -1 : 1)).join(' '));

  // Use period header x-positions directly to read values from any row.
  // No column index mapping needed — just match the closest number cell by x.
  const periodXs = valid.map((c) => c.x);

  return { rows, periodCols: [], periodLabels, periodXs };
}

// ---------------------------------------------------------------------------
// Metric matching
// ---------------------------------------------------------------------------

const FIN_METRICS = [
  ['totalAssets', ['total assets', 'total equity and liabilities', 'balance sheet total']],
  ['totalIncome', ['total income']],
  ['revenueFromOperations', ['revenue from operations', 'revenue from operation', 'i. revenue']],
  ['ebitda', ['ebitda', 'earnings before interest']],
  ['profitBeforeTax', ['profit before tax', 'profit/(loss) before tax', 'profit before exceptional']],
  ['profitAfterTax', ['profit/(loss) for the period', 'profit for the period', 'profit after tax', 'profit/ (loss) for the period', 'net profit', 'xi. profit']],
  ['netWorth', ['total equity', 'total shareholder', 'net worth']],
  ['reservesAndSurplus', ['reserves and surplus', 'reserves & surplus']],
  ['shareCapital', ['share capital']],
  ['totalAssets', ['total equity and liabilities', 'total assets']],
  ['totalBorrowings', ['total borrowings']], // NOT 'borrowings' — that would match long-term/short-term first
  ['longTermBorrowings', ['long-term borrowings', 'long term borrowings']],
  ['shortTermBorrowings', ['short-term borrowings', 'short term borrowings']],
  ['depreciation', ['depreciation and amortization', 'depreciation']],
  ['financeCosts', ['finance costs', 'finance cost']],
  ['basicEPS', ['basic.*eps', 'basic.*earning.*share', 'earning.*share', 'basic']],
  ['dilutedEPS', ['diluted.*eps', 'diluted.*earning.*share']],
  ['ronw', ['return on net worth', 'ronw']],
  ['netAssetValue', ['net asset value', 'nav per share']],
];

const KPI_METRICS = [
  ['roce', ['return on capital employed', 'roce']],
  ['ronw', ['return on net worth', 'ronw']],
  ['roe', ['return on equity', 'roe']],
  ['debtEquity', ['debt.*equity', 'debt equity']],
  ['ebitdaMargin', ['ebitda margin']],
  ['patMargin', ['pat margin', 'net profit margin']],
  ['grossMargin', ['gross margin', 'gross profit margin']],
  ['priceToBook', ['price to book', 'p/bv', 'price/book']],
  ['currentRatio', ['current ratio']],
  ['nav', ['net asset value', 'nav per']],
  ['eps', ['earnings per share', 'eps']],
];

function parseIndianNum(s) {
  if (!s || typeof s !== 'string') return null;
  let t = s.replace(/[₹,%$\s]/g, '').trim();
  if (!t) return null;
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  if (/^-/.test(t)) { neg = true; t = t.slice(1); }
  t = t.replace(/,/g, '');
  if (!/^-?\d*\.?\d+$/.test(t)) return null;
  const n = parseFloat(t);
  return Number.isNaN(n) ? null : (neg ? -n : n);
}

function matchMetric(cellText, metricList) {
  const text = cellText.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const [key, aliases] of metricList) {
    for (const alias of aliases) {
      const words = alias.toLowerCase().split(/\s+/);
      if (words.every((w) => text.includes(w))) return key;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Extraction functions
// ---------------------------------------------------------------------------

function readValues(row, periodXs) {
  // Filter valid data cells (numbers, not annotations)
  const dataCells = row.cells.filter((c) => {
    const clean = c.text.replace(/[,()]/g, '');
    if (!IS_NUMBER.test(clean) && !/^-?\d*\.?\d+$/.test(clean)) return false;
    if (!clean.includes(',') && !clean.includes('.') && /^\d{1,3}$/.test(clean)) return false;
    return true;
  });
  if (!dataCells.length) return periodXs.map(() => null);

  // Greedy nearest-neighbor assignment without reuse
  const used = new Set();
  return periodXs.map((px) => {
    let best = null, bestDist = 120, bestIdx = -1;
    for (let i = 0; i < dataCells.length; i++) {
      if (used.has(i)) continue;
      const dx = Math.abs(dataCells[i].x - px);
      if (dx < bestDist) { bestDist = dx; best = dataCells[i]; bestIdx = i; }
    }
    if (best) used.add(bestIdx);
    return best ? parseIndianNum(best.text) : null;
  });
}

function extractFinancialsFromItems(items) {
  const { rows, periodLabels, periodXs } = parseTable(items);
  if (!periodXs || periodXs.length < 2 || periodLabels.length < 2) return null;

  const metrics = {};
  let foundAny = false;

  for (const row of rows) {
    if (!row.cells.length) continue;
    const labelCell = row.cells.find((c) => {
      const clean = c.text.replace(/[,()]/g, '');
      return !IS_NUMBER.test(clean) && c.text.length > 3;
    });
    if (!labelCell) continue;
    const key = matchMetric(labelCell.text, FIN_METRICS);
    if (!key || metrics[key]) continue;
    const values = readValues(row, periodXs);
    if (values.some((v) => v != null)) {
      metrics[key] = values;
      foundAny = true;
    }
  }

  return foundAny ? { periods: periodLabels, metrics } : null;
}

function extractKpisFromItems(items) {
  const { rows, periodLabels, periodXs } = parseTable(items);
  if (!periodXs || periodXs.length < 2 || periodLabels.length < 2) return null;

  const kpis = {};
  let foundAny = false;

  for (const row of rows) {
    if (!row.cells.length) continue;
    const labelCell = row.cells.find((c) => {
      const clean = c.text.replace(/[,()]/g, '');
      return !IS_NUMBER.test(clean) && c.text.length > 3;
    });
    if (!labelCell) continue;
    const key = matchMetric(labelCell.text, KPI_METRICS);
    if (!key || kpis[key]) continue;
    const values = readValues(row, periodXs);
    if (values.some((v) => v != null)) {
      kpis[key] = values;
      foundAny = true;
    }
  }

  return foundAny ? { periods: periodLabels, kpis } : null;
}

module.exports = {
  parseTable,
  extractFinancialsFromItems,
  extractKpisFromItems,
  parseIndianNum,
  matchMetric,
};
