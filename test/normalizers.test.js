import { test, expect } from 'vitest';
import {
  normalizeCompanyName,
  normalizeSymbol,
  parseIndianDate,
  formatDateISO
} from '../utils/normalizers.js';

test('Normalizers normalization checks', () => {
  expect(normalizeCompanyName('Apex Logistics Limited')).toBe('apex logistics');
  expect(normalizeSymbol('RELIANCE-EQ')).toBe('RELIANCE');
  expect(formatDateISO(parseIndianDate('25-MAY-2026'))).toBe('2026-05-25');
});
