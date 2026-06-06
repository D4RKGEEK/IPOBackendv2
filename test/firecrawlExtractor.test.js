import { test, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { FinancialRatioSchema, validateRatios } = require('../utils/firecrawlExtractor.js');

// FinancialRatioSchema

test('FinancialRatioSchema is a Zod schema with a parse method', () => {
  expect(typeof FinancialRatioSchema.parse).toBe('function');
});

test('FinancialRatioSchema.parse accepts an empty object (all fields optional)', () => {
  const result = FinancialRatioSchema.parse({});
  expect(result).toBeDefined();
});

test('FinancialRatioSchema.parse accepts a fully populated object', () => {
  const input = {
    pePreIpo: 45.2,
    pePostIpo: 38.1,
    epsPreIpo: 10.0,
    epsPostIpo: 12.5,
    ronw: 18.3,
    debtToEquity: 0.5,
    ebitdaMargin: 22.4,
    patMargin: 8.9,
    promoterHoldingPreIpo: 72.1,
    promoterHoldingPostIpo: 60.0,
    issueObjectsSummary: 'Expansion and working capital',
    freshIssueSizeInr: 500,
    ofsInr: 200,
    extractedSections: ['financials', 'promoter'],
  };
  const result = FinancialRatioSchema.parse(input);
  expect(result.pePreIpo).toBe(45.2);
  expect(result.epsPostIpo).toBe(12.5);
  expect(result.ronw).toBe(18.3);
  expect(result.debtToEquity).toBe(0.5);
  expect(result.promoterHoldingPreIpo).toBe(72.1);
  expect(result.ebitdaMargin).toBe(22.4);
  expect(result.patMargin).toBe(8.9);
});

test('FinancialRatioSchema.parse accepts null for nullable numeric fields', () => {
  const result = FinancialRatioSchema.parse({ pePreIpo: null, ebitdaMargin: null });
  expect(result.pePreIpo).toBeNull();
  expect(result.ebitdaMargin).toBeNull();
});

test('FinancialRatioSchema.parse rejects a string where a number is expected', () => {
  expect(() => FinancialRatioSchema.parse({ pePreIpo: 'not-a-number' })).toThrow();
});

// validateRatios

test('validateRatios returns valid:true and empty warnings for a clean ratios object', () => {
  const ratios = {
    pePreIpo: 45.2,
    pePostIpo: 38.1,
    ebitdaMargin: 22.4,
    patMargin: 8.9,
    promoterHoldingPreIpo: 72.1,
    promoterHoldingPostIpo: 60.0,
  };
  const result = validateRatios(ratios, 'TEST_IPO');
  expect(result.valid).toBe(true);
  expect(result.warnings).toEqual([]);
});

test('validateRatios returns valid:false when pePreIpo is negative', () => {
  const ratios = { pePreIpo: -5 };
  const result = validateRatios(ratios, 'TEST_IPO');
  expect(result.valid).toBe(false);
  expect(result.warnings.length).toBeGreaterThan(0);
  expect(result.warnings[0]).toMatch(/pePreIpo/);
});

test('validateRatios returns valid:false when pePostIpo is negative', () => {
  const ratios = { pePostIpo: -10 };
  const result = validateRatios(ratios, 'TEST_IPO');
  expect(result.valid).toBe(false);
  expect(result.warnings.some(w => w.includes('pePostIpo'))).toBe(true);
});

test('validateRatios returns valid:false when ebitdaMargin is out of range', () => {
  const ratios = { ebitdaMargin: 150 };
  const result = validateRatios(ratios, 'TEST_IPO');
  expect(result.valid).toBe(false);
  expect(result.warnings.some(w => w.includes('ebitdaMargin'))).toBe(true);
});

test('validateRatios returns valid:false when patMargin is out of range', () => {
  const ratios = { patMargin: -200 };
  const result = validateRatios(ratios, 'TEST_IPO');
  expect(result.valid).toBe(false);
  expect(result.warnings.some(w => w.includes('patMargin'))).toBe(true);
});

test('validateRatios warns when post-IPO promoter holding exceeds pre-IPO (unusual dilution direction)', () => {
  const ratios = {
    promoterHoldingPreIpo: 60.0,
    promoterHoldingPostIpo: 75.0, // post > pre — unusual
  };
  const result = validateRatios(ratios, 'TEST_IPO');
  expect(result.valid).toBe(false);
  expect(result.warnings.some(w => w.includes('promoter'))).toBe(true);
});

test('validateRatios ignores null/undefined fields without warning', () => {
  const ratios = {
    pePreIpo: null,
    pePostIpo: undefined,
    ebitdaMargin: null,
  };
  const result = validateRatios(ratios, 'TEST_IPO');
  expect(result.valid).toBe(true);
  expect(result.warnings).toEqual([]);
});

test('validateRatios uses "unknown" as default label when none provided', () => {
  const ratios = { pePreIpo: -1 };
  const result = validateRatios(ratios);
  expect(result.warnings[0]).toMatch(/unknown/);
});
