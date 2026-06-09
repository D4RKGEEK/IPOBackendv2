import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { validate, approxEqual } = require('../utils/financialsValidator');
const { selectCandidatePages, scorePage, isQuoteGrounded, norm } = require('../utils/financialsExtractor');

// A realistic, internally-consistent extraction (3 FYs, INR in lakhs).
function goodExtraction() {
  return {
    ok: true,
    reportingBasis: 'consolidated',
    currencyUnit: 'INR in lakhs',
    periods: [
      { label: 'FY2025', endDate: '2025-03-31', months: 12 },
      { label: 'FY2024', endDate: '2024-03-31', months: 12 },
      { label: 'FY2023', endDate: '2023-03-31', months: 12 },
    ],
    metrics: [
      { key: 'revenueFromOperations', label: 'Revenue from operations', values: [12000, 9000, 7000], source: { page: 210, quote: 'revenue' }, _grounded: true },
      { key: 'totalIncome', label: 'Total income', values: [12500, 9300, 7200], source: { page: 210, quote: 'income' }, _grounded: true },
      { key: 'profitAfterTax', label: 'Profit after tax', values: [1200, 800, 500], source: { page: 210, quote: 'pat' }, _grounded: true },
      { key: 'netWorth', label: 'Net worth', values: [6000, 4800, 4000], source: { page: 211, quote: 'nw' }, _grounded: true },
      { key: 'basicEPS', label: 'Basic EPS', values: [12.0, 8.0, 5.0], source: { page: 211, quote: 'eps' }, _grounded: true },
      { key: 'dilutedEPS', label: 'Diluted EPS', values: [11.8, 7.9, 5.0], source: { page: 211, quote: 'deps' }, _grounded: true },
      { key: 'ronw', label: 'Return on net worth', values: [20.0, 16.67, 12.5], source: { page: 211, quote: 'ronw' }, _grounded: true },
    ],
    _grounding: { metricCount: 7, groundedCount: 7, groundingScore: 1.0 },
  };
}

describe('approxEqual', () => {
  it('treats near values as equal within relative tolerance', () => {
    expect(approxEqual(100, 104, 0.05)).toBe(true);
    expect(approxEqual(100, 120, 0.05)).toBe(false);
  });
  it('returns null when a value is missing', () => {
    expect(approxEqual(null, 5)).toBe(null);
  });
});

describe('validate', () => {
  it('gives high confidence and no review for a clean, grounded, consistent extraction', () => {
    const v = validate(goodExtraction());
    expect(v.summary.hardFails).toBe(0);
    expect(v.confidence).toBeGreaterThanOrEqual(0.8);
    expect(v.reviewRequired).toBe(false);
  });

  it('flags review when grounding is poor', () => {
    const e = goodExtraction();
    e._grounding = { metricCount: 7, groundedCount: 2, groundingScore: 0.286 };
    const v = validate(e);
    expect(v.reviewRequired).toBe(true);
    expect(v.confidence).toBeLessThan(0.8);
  });

  it('hard-fails when metric values are misaligned with periods', () => {
    const e = goodExtraction();
    e.metrics[0].values = [12000, 9000]; // only 2 of 3
    const v = validate(e);
    expect(v.summary.hardFails).toBeGreaterThan(0);
    expect(v.reviewRequired).toBe(true);
  });

  it('soft-fails an inconsistent RoNW (PAT/NetWorth mismatch)', () => {
    const e = goodExtraction();
    e.metrics.find((m) => m.key === 'ronw').values = [99, 99, 99];
    const v = validate(e);
    const ronwChecks = v.checks.filter((c) => c.name.startsWith('ronw_consistency'));
    expect(ronwChecks.some((c) => c.status === 'fail')).toBe(true);
  });

  it('soft-fails when EPS sign contradicts PAT sign', () => {
    const e = goodExtraction();
    e.metrics.find((m) => m.key === 'profitAfterTax').values = [-1200, 800, 500];
    const v = validate(e);
    const signChecks = v.checks.filter((c) => c.name.startsWith('eps_sign'));
    expect(signChecks.some((c) => c.status === 'fail')).toBe(true);
  });

  it('returns zero confidence for a failed extraction', () => {
    const v = validate({ ok: false, reason: 'no_financial_pages_found' });
    expect(v.confidence).toBe(0);
    expect(v.reviewRequired).toBe(true);
  });
});

describe('extractor helpers', () => {
  it('scores a financial-summary page above a prose page', () => {
    const fin = 'Restated revenue from operations 12,000 9,000 EBITDA Profit after tax March 2025 March 2024 March 2023 net worth earnings per share';
    const prose = 'Our company was incorporated in 2009 and operates in logistics across India.';
    expect(scorePage(fin)).toBeGreaterThan(scorePage(prose));
  });

  it('selects the highest-scoring page window', () => {
    const pages = [
      'cover page offer document',
      'risk factors prose about business',
      'Restated revenue from operations 12,000 9,000 7,000 profit after tax net worth March 2025 March 2024 March 2023 earnings per share EBITDA',
      'more financial notes total income borrowings 2025 2024 2023',
      'unrelated legal section',
    ];
    const sel = selectCandidatePages(pages, { window: 3 });
    expect(sel.pageNumbers).toContain(3);
    expect(sel.tagged).toContain('===== PAGE 3 =====');
  });

  it('grounds an exact and a whitespace-noisy quote, rejects a fabricated one', () => {
    const page = 'Revenue   from operations\n12,000   9,000  7,000';
    expect(isQuoteGrounded('Revenue from operations 12,000', page)).toBe(true);
    expect(isQuoteGrounded('Net profit margin improved to 45 percent', page)).toBe(false);
  });

  it('normalizes whitespace and case', () => {
    expect(norm('  Foo   BAR ')).toBe('foo bar');
  });
});
