import { test, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { buildRows, extractFromPageItems } = require('../utils/tableExtractor.js');

// Mock pdfjs-dist so tests run without real PDFs
vi.mock('pdfjs-dist/build/pdf.mjs', () => ({
  getDocument: vi.fn(),
}));

// Helper: create a fake pdfjs text item
function item(str, x, y) {
  return { str, transform: [1, 0, 0, 1, x, y], width: str.length * 6, height: 10 };
}

test('buildRows groups items by Y coordinate', () => {
  const items = [
    item('Revenue', 50, 100),
    item('1,000', 200, 100),
    item('900', 300, 100),
    item('Label', 50, 80),
    item('50', 200, 81), // within yTolerance=4
  ];
  const rows = buildRows(items);
  expect(rows.length).toBe(2);
  expect(rows[0].cells.length).toBe(3); // y=100 row
  expect(rows[1].cells.length).toBe(2); // y=80/81 merged
});

test('buildRows sorts rows top-to-bottom (descending Y)', () => {
  const items = [
    item('Bottom', 50, 50),
    item('Top', 50, 200),
    item('Middle', 50, 125),
  ];
  const rows = buildRows(items);
  expect(rows[0].y).toBe(200);
  expect(rows[1].y).toBe(124); // rounded
  expect(rows[2].y).toBe(52);  // rounded (50/4=12.5 → round→13*4=52)
});

test('extractFromPageItems extracts revenue and net profit', () => {
  const items = [
    // Header row with year fragments
    item('March 31, 2025', 200, 300),
    item('March 31, 2024', 300, 300),
    item('March 31, 2023', 400, 300),
    // Revenue row
    item('Revenue from Operations', 50, 280),
    item('1,652.47', 200, 280),
    item('2,374.71', 300, 280),
    item('1,015.53', 400, 280),
    // Net profit row
    item('Net profit for the year', 50, 260),
    item('207.76', 200, 260),
    item('258.22', 300, 260),
    item('34.46', 400, 260),
  ];
  const result = extractFromPageItems(items);
  expect(result.revenueFromOperations).toBeDefined();
  expect(result.revenueFromOperations.fy0).toBe(1652.47);
  expect(result.revenueFromOperations.fy1).toBe(2374.71);
  expect(result.netProfit).toBeDefined();
  expect(result.netProfit.fy0).toBe(207.76);
});

test('extractFromPageItems extracts EPS and net worth', () => {
  const items = [
    item('FY2025', 200, 300),
    item('FY2024', 300, 300),
    item('Basic Earnings per Share', 50, 280),
    item('3.25', 200, 280),
    item('4.99', 300, 280),
    item('Net Worth', 50, 260),
    item('1,201.45', 200, 260),
    item('686.99', 300, 260),
  ];
  const result = extractFromPageItems(items);
  expect(result.basicEPS.fy0).toBe(3.25);
  expect(result.basicEPS.fy1).toBe(4.99);
  expect(result.netWorth.fy0).toBe(1201.45);
});

test('extractFromPageItems returns empty object when no matching rows', () => {
  const items = [
    item('Some random text', 50, 100),
    item('More text', 200, 100),
  ];
  const result = extractFromPageItems(items);
  expect(Object.keys(result).length).toBe(0);
});

test('buildRows ignores empty strings', () => {
  const items = [
    item('', 50, 100),
    item('   ', 100, 100),
    item('Valid', 150, 100),
  ];
  const rows = buildRows(items);
  expect(rows.length).toBe(1);
  expect(rows[0].cells.length).toBe(1);
  expect(rows[0].cells[0].text).toBe('Valid');
});
