import { test, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { mergeRatiosIntoRecord } = require('../utils/ratioMerger.js');

// mergeRatiosIntoRecord

test('mergeRatiosIntoRecord adds a financialRatios key to the record', () => {
  const record = { isin: 'INE123A01011', companyName: 'Test Corp' };
  const ratios = { pePreIpo: 45.2, epsPostIpo: 12.5, ronw: 18.3 };

  const result = mergeRatiosIntoRecord(record, ratios);

  expect(result).toHaveProperty('financialRatios');
  expect(typeof result.financialRatios).toBe('object');
});

test('mergeRatiosIntoRecord stores ratio values under financialRatios', () => {
  const record = { isin: 'INE123A01011' };
  const ratios = { pePreIpo: 45.2, epsPostIpo: 12.5, ronw: 18.3, debtToEquity: 0.5 };

  const result = mergeRatiosIntoRecord(record, ratios);

  expect(result.financialRatios.pePreIpo).toBe(45.2);
  expect(result.financialRatios.epsPostIpo).toBe(12.5);
  expect(result.financialRatios.ronw).toBe(18.3);
  expect(result.financialRatios.debtToEquity).toBe(0.5);
});

test('mergeRatiosIntoRecord strips null and undefined values', () => {
  const record = { isin: 'INE123A01011' };
  const ratios = { pePreIpo: 45.2, pePostIpo: null, ebitdaMargin: undefined };

  const result = mergeRatiosIntoRecord(record, ratios);

  expect(result.financialRatios.pePreIpo).toBe(45.2);
  expect(result.financialRatios).not.toHaveProperty('pePostIpo');
  expect(result.financialRatios).not.toHaveProperty('ebitdaMargin');
});

test('mergeRatiosIntoRecord adds an extractedAt timestamp', () => {
  const record = { isin: 'INE123A01011' };
  const ratios = { pePreIpo: 30 };

  const result = mergeRatiosIntoRecord(record, ratios);

  expect(typeof result.financialRatios.extractedAt).toBe('string');
  // Should be a valid ISO date string
  expect(() => new Date(result.financialRatios.extractedAt).toISOString()).not.toThrow();
});

test('mergeRatiosIntoRecord mutates the record in place and returns it', () => {
  const record = { isin: 'INE123A01011' };
  const ratios = { ronw: 18.3 };

  const result = mergeRatiosIntoRecord(record, ratios);

  // Same object reference
  expect(result).toBe(record);
  expect(record).toHaveProperty('financialRatios');
});

test('mergeRatiosIntoRecord merges into existing financialRatios without losing prior fields', () => {
  const record = {
    isin: 'INE123A01011',
    financialRatios: { pePreIpo: 45.2, extractedAt: '2024-01-01T00:00:00.000Z' },
  };
  const ratios = { ronw: 18.3, debtToEquity: 0.5 };

  const result = mergeRatiosIntoRecord(record, ratios);

  expect(result.financialRatios.pePreIpo).toBe(45.2);
  expect(result.financialRatios.ronw).toBe(18.3);
  expect(result.financialRatios.debtToEquity).toBe(0.5);
});

test('mergeRatiosIntoRecord with an empty ratios object adds only extractedAt', () => {
  const record = { isin: 'INE123A01011' };
  const ratios = {};

  const result = mergeRatiosIntoRecord(record, ratios);

  expect(result).toHaveProperty('financialRatios');
  expect(typeof result.financialRatios.extractedAt).toBe('string');
  // No other keys beyond extractedAt
  const keys = Object.keys(result.financialRatios);
  expect(keys).toEqual(['extractedAt']);
});
