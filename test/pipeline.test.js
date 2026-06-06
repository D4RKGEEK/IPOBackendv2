import { test, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const {
  mergeRecordPair,
  areDatesWithin30Days,
  isWithinDateRange
} = require('../run_pipeline.js');

test('areDatesWithin30Days calculates difference correctly', () => {
  expect(areDatesWithin30Days('2026-06-05', '2026-06-15')).toBe(true);
  expect(areDatesWithin30Days('2026-06-05', '2026-07-05')).toBe(true); // 30 days
  expect(areDatesWithin30Days('2026-06-05', '2026-07-10')).toBe(false); // 35 days
  expect(areDatesWithin30Days('2026-06-05', null)).toBe(false);
});

test('isWithinDateRange filters correct dates', () => {
  expect(isWithinDateRange('2026-06-05', null, null, 2026)).toBe(true);
  expect(isWithinDateRange('2025-06-05', null, null, 2026)).toBe(false);
  expect(isWithinDateRange('2026-06-05', '2026-06-01', '2026-06-10', null)).toBe(true);
  expect(isWithinDateRange('2026-06-15', '2026-06-01', '2026-06-10', null)).toBe(false);
});

test('mergeRecordPair applies precedence rules', () => {
  const upstoxRec = {
    isin: 'INE123',
    symbol: 'MOCK',
    companyName: 'Mock Company',
    status: 'open',
    biddingStartDate: '2026-06-01',
    priceBand: { minimum: 100, maximum: 110 },
    documentUrls: { rhp: 'http://upstox/rhp.pdf', drhp: null },
    raw_sources: { upstox: { dummy: 1 } }
  };

  const nseRec = {
    isin: 'INE123',
    symbol: 'MOCK',
    companyName: 'Mock Company Limited',
    status: 'closed',
    biddingStartDate: '2026-06-02',
    priceBand: { minimum: 90, maximum: 120 },
    documentUrls: { rhp: 'http://nse/rhp.pdf', drhp: 'http://nse/drhp.pdf' },
    raw_sources: { nse: { dummy: 2 } }
  };

  const result = mergeRecordPair(upstoxRec, nseRec);

  expect(result.isin).toBe('INE123');
  expect(result.symbol).toBe('MOCK');
  // Upstox companyName takes precedence (first record)
  expect(result.companyName).toBe('Mock Company');
  // Upstox status takes precedence
  expect(result.status).toBe('open');
  // NSE date takes precedence
  expect(result.biddingStartDate).toBe('2026-06-02');
  // NSE documents take precedence
  expect(result.documentUrls.rhp).toBe('http://nse/rhp.pdf');
  expect(result.documentUrls.drhp).toBe('http://nse/drhp.pdf');
  // Upstox price band takes precedence
  expect(result.priceBand.minimum).toBe(100);
  expect(result.priceBand.maximum).toBe(110);
  // Raw sources are merged
  expect(result.raw_sources.upstox).toEqual({ dummy: 1 });
  expect(result.raw_sources.nse).toEqual({ dummy: 2 });
});
