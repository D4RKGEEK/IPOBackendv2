import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { classifyFromName, classifyFromCoverText, classifyDocType } = require('../utils/docClassifier');

describe('classifyFromName — handles varied real filenames', () => {
  const cases = [
    ['https://cmr.co.in/.../CMRG-Red-Herring-Prospectus.pdf', 'rhp'],   // the case that broke the naive rule
    ['https://x/CMRG-Draft-Red-Herring-Prospectus.pdf', 'drhp'],
    ['https://gyr.com/rhphorizon.pdf', 'rhp'],
    ['https://x/abc-drhp.pdf', 'drhp'],
    ['https://x/company_FINAL_prospectus.pdf', 'final'],
    ['https://www.sebi.gov.in/filings/public-issues/x.pdf', 'drhp'],
    ['https://x/some-random-doc.pdf', null],                            // ambiguous -> null (cover decides)
  ];
  for (const [url, expected] of cases) {
    it(`${url.split('/').pop()} -> ${expected}`, () => {
      expect(classifyFromName(url).docType).toBe(expected);
    });
  }
  it('checks DRAFT before RED HERRING (drhp contains rhp)', () => {
    expect(classifyFromName('x/draft-red-herring.pdf').docType).toBe('drhp');
  });
});

describe('classifyFromCoverText — authoritative page-1 title', () => {
  it('reads the cover banner', () => {
    expect(classifyFromCoverText('... DRAFT RED HERRING PROSPECTUS dated ...').docType).toBe('drhp');
    expect(classifyFromCoverText('RED HERRING PROSPECTUS\nDated June 1, 2026').docType).toBe('rhp');
    expect(classifyFromCoverText('PROSPECTUS\nDated ... (fixed price)').docType).toBe('final');
  });
  it('returns null when no banner present', () => {
    expect(classifyFromCoverText('this page has no document type words')).toBe(null);
  });
});

describe('classifyDocType — cover overrides filename', () => {
  it('cover text wins over a misleading filename', () => {
    // filename says nothing/ambiguous, but the cover says DRAFT
    const r = classifyDocType({ url: 'https://x/offer-doc.pdf', coverText: 'DRAFT RED HERRING PROSPECTUS' });
    expect(r).toMatchObject({ docType: 'drhp', method: 'cover' });
  });
  it('falls back to filename when no cover text', () => {
    expect(classifyDocType({ url: 'https://x/CMRG-Red-Herring-Prospectus.pdf' }))
      .toMatchObject({ docType: 'rhp', method: 'filename' });
  });
  it('defaults to drhp when nothing is decisive', () => {
    expect(classifyDocType({ url: 'https://x/mystery.pdf' }))
      .toMatchObject({ docType: 'drhp', method: 'default' });
  });
});
