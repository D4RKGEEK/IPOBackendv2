import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { extractObjects, cleanObjectName } = require('../utils/objectsExtractor');

describe('cleanObjectName', () => {
  it('strips leading numbering and trailing footnotes', () => {
    expect(cleanObjectName('1. Funding incremental working capital*')).toBe('Funding incremental working capital');
    expect(cleanObjectName('General Corporate Purposes(1)')).toBe('General Corporate Purposes');
  });
});

// Price-fixed RHP objects table (utkal shape; amounts in Lakhs, some [●]).
const TABLE_MD = `
(Amount in Rs. Lakhs except Percentage)

| Sr. No. | Particulars | Amount(1) | % of Net Offer Proceeds |
| --- | --- | --- | --- |
| 1. | Funding incremental working capital requirements of our Company | 530.75 | [●] |
| 2. | Prepayment or Repayment of certain outstanding borrowings | 1100.00 |  |
| 3. | Funding Capital Expenditure for new manufacturing facility at Khurda | 959.88 | [●] |
| 4. | General Corporate Purposes* | [●] | [●] |
| Total |  | [●] | [●] |
`;

describe('extractObjects (price-fixed table)', () => {
  const r = extractObjects(TABLE_MD);
  it('extracts each object + amount (Lakhs) and converts to Cr', () => {
    expect(r.source).toBe('table');
    expect(r.unit).toBe('Lakhs');
    expect(r.objects).toHaveLength(4);
    const wc = r.objects.find((o) => /working capital/i.test(o.name));
    expect(wc.amount).toBe(530.75);
    expect(wc.amountCr).toBe(5.31); // 530.75 / 100
    expect(r.objects.find((o) => /repayment/i.test(o.name)).amount).toBe(1100);
    expect(r.objects.find((o) => /corporate purpose/i.test(o.name)).amount).toBe(null); // [●]
  });
  it('sums known amounts when the Total row is [●]', () => {
    expect(r.total).toBe(530.75 + 1100 + 959.88);
  });
});

// DRHP-style: amounts are [●], object names appear as a numbered list.
const LIST_MD = `
The Company proposes to utilise the Net Proceeds towards the following objects:
1. Funding incremental working capital requirements of our Company;
2. Setting up a new manufacturing facility at Surat, Gujarat ("Proposed facility");
3. Repayment of loan availed by our Company;
4. General Corporate Purposes.
`;

describe('extractObjects (DRHP numbered list)', () => {
  const r = extractObjects(LIST_MD);
  it('falls back to object names with null amounts', () => {
    expect(r.source).toBe('list');
    expect(r.objects.map((o) => o.name)).toContain('Funding incremental working capital requirements of our Company');
    expect(r.objects.every((o) => o.amount === null)).toBe(true);
    expect(r.objects.length).toBeGreaterThanOrEqual(3);
  });
});

describe('extractObjects (none)', () => {
  it('returns null when no objects section', () => {
    expect(extractObjects('unrelated prospectus text')).toBe(null);
  });
});
