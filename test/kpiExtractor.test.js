import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { canonicalizeKey, normalizePeriods, pickBestRun, scoreKpiPage, selectKpiPages } = require('../utils/kpiExtractor');

describe('canonicalizeKey', () => {
  it('keeps a valid canonical key', () => {
    expect(canonicalizeKey('roe', 'whatever')).toBe('roe');
  });
  it('rescues an "other" row using its label', () => {
    expect(canonicalizeKey('other', 'Net Asset Value per share')).toBe('nav');
    expect(canonicalizeKey('other', 'Current Ratio')).toBe('currentRatio');
    expect(canonicalizeKey('other', 'Debtor Turnover Days')).toBe('debtorDays');
    expect(canonicalizeKey('other', 'Return on Capital Employed')).toBe('roce');
  });
  it('leaves a genuinely company-specific KPI as other', () => {
    expect(canonicalizeKey('other', 'Capacity Utilisation')).toBe('other');
  });
});

describe('normalizePeriods', () => {
  it('reorders periods and values newest-first by endDate', () => {
    const r = {
      periods: [
        { label: 'Sep 2025', endDate: '2025-09-30' },
        { label: 'Sep 2024', endDate: '2024-09-30' },
        { label: 'Mar 2025', endDate: '2025-03-31' },
      ],
      kpis: [{ key: 'roe', values: [2, 13, 20] }], // aligned to above order
    };
    const out = normalizePeriods(r);
    expect(out.periods.map((p) => p.label)).toEqual(['Sep 2025', 'Mar 2025', 'Sep 2024']);
    expect(out.kpis[0].values).toEqual([2, 20, 13]); // values follow the reorder
  });
  it('leaves order untouched when any endDate is missing', () => {
    const r = {
      periods: [{ label: 'A', endDate: null }, { label: 'B', endDate: '2024-03-31' }],
      kpis: [{ key: 'roe', values: [1, 2] }],
    };
    const out = normalizePeriods(r);
    expect(out.periods.map((p) => p.label)).toEqual(['A', 'B']);
    expect(out.kpis[0].values).toEqual([1, 2]);
  });
});

describe('pickBestRun', () => {
  it('prefers the run with more grounded KPIs', () => {
    const a = { ok: true, kpis: [1, 2, 3], _grounding: { groundedCount: 2 } };
    const b = { ok: true, kpis: [1, 2, 3, 4, 5], _grounding: { groundedCount: 5 } };
    expect(pickBestRun([a, b])).toBe(b);
  });
  it('falls back to a failed result when none succeeded', () => {
    const out = pickBestRun([{ ok: false }, null]);
    expect(out.ok).toBe(false);
  });
});

describe('scoreKpiPage + selectKpiPages', () => {
  it('weights the KPI heading heavily', () => {
    const heading = 'Key Performance Indicators ROE 12.5% ROCE 14.36% debt-equity 2.07';
    const plain = 'our roe was strong this year';
    expect(scoreKpiPage(heading)).toBeGreaterThan(scoreKpiPage(plain) + 3);
  });
  it('picks the heading page even when isolated', () => {
    const pages = [
      'cover',
      'risk factors prose',
      'Basis for Offer Price Key Performance Indicators ROE 12.50% ROCE 14.36% RoNW 11.87% debt-equity 2.07 EBITDA margin 10.36% PAT margin 4.76%',
      'unrelated legal',
    ];
    const sel = selectKpiPages(pages, { window: 3 });
    expect(sel.pageNumbers).toContain(3);
  });
});
