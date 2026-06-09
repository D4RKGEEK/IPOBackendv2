import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { detectSections, pageOverlap, sha256 } = require('../services/documentService');

describe('sha256 page hashing', () => {
  it('is whitespace-insensitive and content-sensitive', () => {
    expect(sha256('Revenue  100   200')).toBe(sha256('Revenue 100 200'));
    expect(sha256('Revenue 100')).not.toBe(sha256('Revenue 200'));
  });
});

describe('detectSections', () => {
  it('finds known sections by keyword', () => {
    const text = 'RISK FACTORS ... OBJECTS OF THE ISSUE ... Restated financial statements ... Basis for Offer Price';
    const s = detectSections(text);
    expect(s).toContain('risk-factors');
    expect(s).toContain('objects-of-issue');
    expect(s).toContain('financials');
    expect(s).toContain('kpis');
  });
  it('returns empty for unrelated text', () => {
    expect(detectSections('lorem ipsum dolor')).toEqual([]);
  });
});

describe('pageOverlap (DRHP/RHP dedup)', () => {
  it('counts overlapping and unique pages', () => {
    const drhp = ['a', 'b', 'c', 'd'];
    const rhp = ['a', 'b', 'c', 'e', 'f']; // 3 overlap, 2 unique
    expect(pageOverlap(rhp, drhp)).toEqual({ overlap: 3, uniquePages: 2 });
  });
  it('handles no DRHP hashes', () => {
    expect(pageOverlap(['a', 'b'], undefined)).toEqual({ overlap: 0, uniquePages: 2 });
  });
});
