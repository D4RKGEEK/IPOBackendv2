import { test, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { sanitize } = require('../utils/sectionsExtractor.js');

test('sanitize replaces special chars and collapses underscores', () => {
  expect(sanitize('Vahh Chemicals Ltd.')).toBe('Vahh_Chemicals_Ltd');
  expect(sanitize('ABC 123')).toBe('ABC_123');
  expect(sanitize('  spaces   everywhere  ')).toBe('spaces_everywhere');
  expect(sanitize('Hello-World_v2.0')).toBe('Hello-World_v2_0');
});

test('sanitize returns unknown for empty name', () => {
  expect(sanitize('')).toBe('unknown');
  expect(sanitize('   ')).toBe('unknown');
});

test('sanitize allows hyphens since they are common in dir names', () => {
  expect(sanitize('-test-')).toBe('-test-');
});

test('sanitize collapses consecutive underscores from multiple special chars', () => {
  expect(sanitize('ABC @#$ Co')).toBe('ABC_Co');
  expect(sanitize('Company  (India)  Ltd')).toBe('Company_India_Ltd');
});
