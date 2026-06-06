import { test, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const { normalizeHeading, SECTION_TARGETS } = require('../utils/tocLocator.js');

// ─── tests ────────────────────────────────────────────────────────────────────

test('normalizeHeading strips punctuation and lowercases', () => {
  const result = normalizeHeading('OBJECTS OF THE OFFER:');
  // The module replaces non-word/non-space chars then trims
  expect(result).toBe('objects of the offer');
});

test('normalizeHeading collapses internal whitespace and trims', () => {
  const result = normalizeHeading('  Basis  for   Offer Price  ');
  // Leading/trailing whitespace is trimmed and internal runs collapsed to single space
  expect(result).toBe('basis for offer price');
  expect(result.toLowerCase()).toBe(result);
  expect(result).toBe(result.trim());
});

test('SECTION_TARGETS contains required keys', () => {
  expect(typeof SECTION_TARGETS).toBe('object');
  expect(Array.isArray(SECTION_TARGETS)).toBe(false);

  expect(Object.keys(SECTION_TARGETS)).toContain('OBJECTS_OF_THE_OFFER');
  expect(Object.keys(SECTION_TARGETS)).toContain('BASIS_FOR_OFFER_PRICE');
});

test('SECTION_TARGETS entries are arrays of alias strings', () => {
  expect(Array.isArray(SECTION_TARGETS.OBJECTS_OF_THE_OFFER)).toBe(true);
  expect(SECTION_TARGETS.OBJECTS_OF_THE_OFFER.length).toBeGreaterThan(0);

  expect(Array.isArray(SECTION_TARGETS.BASIS_FOR_OFFER_PRICE)).toBe(true);
  expect(SECTION_TARGETS.BASIS_FOR_OFFER_PRICE.length).toBeGreaterThan(0);
});

test('normalizeHeading handles empty and null-like inputs', () => {
  expect(normalizeHeading('')).toBe('');
  expect(normalizeHeading('   ')).toBe('');
});
