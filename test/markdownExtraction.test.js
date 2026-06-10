import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { parseMarkdownTables, parseNum, looksLikePeriod, findPeriodRow } = require('../utils/markdownTables');
const { extractFinancials, extractKpis, computeLotDetails } = require('../services/extractionService');

describe('parseNum', () => {
  it('handles commas, %, parentheses (negative), ₹', () => {
    expect(parseNum('12,000')).toBe(12000);
    expect(parseNum('17.61%')).toBe(17.61);
    expect(parseNum('(6.80)')).toBe(-6.8);
    expect(parseNum('₹ 1,053')).toBe(1053);
    expect(parseNum('—')).toBe(null);
  });
});

describe('looksLikePeriod', () => {
  it('recognizes fiscal period labels', () => {
    expect(looksLikePeriod('March 31, 2025')).toBe(true);
    expect(looksLikePeriod('FY2024')).toBe(true);
    expect(looksLikePeriod('2023')).toBe(true);
    expect(looksLikePeriod('Particulars')).toBe(false);
  });
});

const FIN_MD = `
Some heading text.

| Particulars |  | March 31, 2025 | March 31, 2024 | March 31, 2023 |
| --- | --- | --- | --- | --- |
| Revenue from operations |  | 12,000 | 9,000 | 7,000 |
| Profit / (Loss) after Tax |  | 1,200 | 800 | (50) |
| Net Worth |  | 6,000 | 4,800 | 4,000 |
| Basic and Diluted EPS (In Rs) |  | 12.00 | 8.00 | 5.00 |
| Return on Net Worth |  | 20% | 16.67% | 12.5% |

Other prose.
`;

const KPI_MD = `
| Key Performance Indicator | Sep 30, 2025 | March 31, 2025 |
| --- | --- | --- |
| ROE | 11.87% | 17.61% |
| ROCE | 9.16% | 14.36% |
| Debt Equity Ratio | 1.68 | 2.07 |
| EBITDA Margin | 10.36% | 8.18% |
`;

describe('parseMarkdownTables', () => {
  it('parses a table, dropping the separator row', () => {
    const tables = parseMarkdownTables(FIN_MD);
    expect(tables).toHaveLength(1);
    expect(tables[0].rows.length).toBe(6); // header + 5 data rows (separator dropped)
  });
});

describe('extractFinancials', () => {
  it('maps row labels to metrics aligned to period columns', () => {
    const fin = extractFinancials(parseMarkdownTables(FIN_MD));
    expect(fin.periods).toEqual(['March 31, 2025', 'March 31, 2024', 'March 31, 2023']);
    expect(fin.metrics.revenueFromOperations).toEqual([12000, 9000, 7000]);
    expect(fin.metrics.profitAfterTax).toEqual([1200, 800, -50]); // parentheses → negative
    expect(fin.metrics.netWorth).toEqual([6000, 4800, 4000]);
    expect(fin.metrics.basicEPS).toEqual([12, 8, 5]);
    expect(fin.metrics.ronw).toEqual([20, 16.67, 12.5]);
  });
});

describe('extractKpis', () => {
  it('extracts ratios by abbreviation and phrase', () => {
    const { kpis } = extractKpis(parseMarkdownTables(KPI_MD));
    expect(kpis.roe).toEqual([11.87, 17.61]);
    expect(kpis.roce).toEqual([9.16, 14.36]);
    expect(kpis.debtEquity).toEqual([1.68, 2.07]);
    expect(kpis.ebitdaMargin).toEqual([10.36, 8.18]);
  });
});

describe('computeLotDetails', () => {
  it('computes the application table from issue mechanics', () => {
    const res = computeLotDetails({ lotSize: 70, issuePrice: 212, issueType: 'MAINBOARD' });
    expect(res.ok).toBe(true);
    expect(res.applications.find((a) => a.category === 'Retail' && a.type === 'Min').lots).toBe(1);
  });
  it('returns null without lot/price', () => {
    expect(computeLotDetails({ lotSize: null })).toBe(null);
  });
});
