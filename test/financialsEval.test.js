import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { scoreOne, aggregate, valuesMatch } = require('../utils/financialsEval');

function gold() {
  return {
    symbol: 'TEST',
    _verified: true,
    periods: ['FY25', 'FY24', 'FY23'],
    metrics: {
      revenueFromOperations: [12000, 9000, 7000],
      profitAfterTax: [1200, 800, 500],
      basicEPS: [12.0, 8.0, 5.0],
    },
  };
}

function extractionFrom(metrics) {
  return { metrics: Object.entries(metrics).map(([key, values]) => ({ key, values })) };
}

describe('valuesMatch', () => {
  it('matches within 1% relative tolerance', () => {
    expect(valuesMatch(1000, 1005)).toBe(true);
    expect(valuesMatch(1000, 1200)).toBe(false);
  });
  it('matches tiny absolute differences (rounding)', () => {
    expect(valuesMatch(12.0, 12.04)).toBe(true);
  });
  it('never matches null', () => {
    expect(valuesMatch(null, 5)).toBe(false);
  });
});

describe('scoreOne', () => {
  it('scores a perfect extraction as 100% across the board', () => {
    const ext = extractionFrom({
      revenueFromOperations: [12000, 9000, 7000],
      profitAfterTax: [1200, 800, 500],
      basicEPS: [12.0, 8.0, 5.0],
    });
    const s = scoreOne(ext, gold());
    expect(s.cells).toBe(9);
    expect(s.correct).toBe(9);
    expect(s.accuracy).toBe(1);
    expect(s.coverage).toBe(1);
    expect(s.precision).toBe(1);
  });

  it('counts a missing metric as missed (not wrong)', () => {
    const ext = extractionFrom({
      revenueFromOperations: [12000, 9000, 7000],
      profitAfterTax: [1200, 800, 500],
      // basicEPS absent
    });
    const s = scoreOne(ext, gold());
    expect(s.missed).toBe(3);
    expect(s.wrong).toBe(0);
    expect(s.accuracy).toBeCloseTo(6 / 9, 2);
    expect(s.coverage).toBeCloseTo(6 / 9, 2);
    expect(s.precision).toBe(1); // of what it attempted, all correct
  });

  it('counts a bad value as wrong and drops precision', () => {
    const ext = extractionFrom({
      revenueFromOperations: [99999, 9000, 7000], // first value wrong
      profitAfterTax: [1200, 800, 500],
      basicEPS: [12.0, 8.0, 5.0],
    });
    const s = scoreOne(ext, gold());
    expect(s.wrong).toBe(1);
    expect(s.correct).toBe(8);
    expect(s.precision).toBeCloseTo(8 / 9, 2);
    expect(s.errors.find((e) => e.type === 'wrong')).toMatchObject({ key: 'revenueFromOperations', expected: 12000, got: 99999 });
  });

  it('ignores gold cells that are null (not part of truth)', () => {
    const g = gold();
    g.metrics.basicEPS = [12.0, null, 5.0];
    const ext = extractionFrom({
      revenueFromOperations: [12000, 9000, 7000],
      profitAfterTax: [1200, 800, 500],
      basicEPS: [12.0, 999, 5.0], // the 999 is at a null gold cell -> ignored
    });
    const s = scoreOne(ext, g);
    expect(s.cells).toBe(8);
    expect(s.correct).toBe(8);
    expect(s.wrong).toBe(0);
  });
});

describe('aggregate', () => {
  it('only counts verified golds', () => {
    const verified = scoreOne(extractionFrom({ revenueFromOperations: [12000, 9000, 7000] }), { ...gold(), metrics: { revenueFromOperations: [12000, 9000, 7000] } });
    const unverified = { ...scoreOne(extractionFrom({ revenueFromOperations: [1, 1, 1] }), { symbol: 'X', _verified: false, periods: ['a'], metrics: { revenueFromOperations: [12000, 9000, 7000] } }) };
    const agg = aggregate([verified, unverified]);
    expect(agg.filesTotal).toBe(2);
    expect(agg.filesVerified).toBe(1);
    expect(agg.cells).toBe(3); // only the verified file's cells
    expect(agg.accuracy).toBe(1);
  });
});
