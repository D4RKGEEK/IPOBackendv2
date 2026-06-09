import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { collectDocuments, collectAll, classifyDocType } = require('../utils/documentCollector');

describe('classifyDocType', () => {
  it('detects drhp/rhp/sebi filings', () => {
    expect(classifyDocType(null, 'https://x/abc-drhp.pdf')).toBe('drhp');
    expect(classifyDocType(null, 'https://x/abc-rhp.pdf')).toBe('rhp');
    expect(classifyDocType(null, 'https://www.sebi.gov.in/filings/public-issues/x.pdf')).toBe('drhp');
    expect(classifyDocType('rhp', 'https://x/whatever.pdf')).toBe('rhp');
  });
});

describe('collectDocuments', () => {
  it('gathers and dedupes doc URLs across sources, tracking provenance', () => {
    const rec = {
      symbol: 'FOO', isin: 'INE123', companyName: 'Foo Ltd', status: 'open',
      documentUrls: { rhp: 'https://cdn/foo-rhp.pdf', drhp: null },
      raw_sources: {
        upstox: { rhp_url: 'https://cdn/foo-rhp.pdf', drhp_url: null },     // same RHP as merged
        nse: { rhpUrl: 'https://nse/foo-rhp.pdf', drhpUrl: 'https://nse/foo-drhp.pdf' },
        groww: { documentUrl: 'https://drive.google.com/file/d/abc/view' },
      },
    };
    const r = collectDocuments(rec);
    expect(r.symbol).toBe('FOO');
    const urls = r.documents.map((d) => d.url);
    // merged+upstox RHP collapse to one; nse rhp, nse drhp, groww drive = 4 unique
    expect(urls).toHaveLength(4);
    const merged = r.documents.find((d) => d.url === 'https://cdn/foo-rhp.pdf');
    expect(merged.sources.sort()).toEqual(['merged', 'upstox']);
    expect(r.documents.find((d) => d.url.includes('foo-drhp')).docType).toBe('drhp');
  });

  it('strips trailing slashes when deduping', () => {
    const rec = {
      symbol: 'BAR',
      documentUrls: { rhp: 'https://x/bar-rhp.pdf/', drhp: null },
      raw_sources: { upstox: { rhp_url: 'https://x/bar-rhp.pdf' } },
    };
    const r = collectDocuments(rec);
    expect(r.documents).toHaveLength(1);
  });
});

describe('collectAll', () => {
  it('drops IPOs with no documents by default', () => {
    const withDoc = { symbol: 'A', documentUrls: { rhp: 'https://x/a.pdf' } };
    const noDoc = { symbol: 'B', documentUrls: { rhp: null, drhp: null }, raw_sources: {} };
    expect(collectAll([withDoc, noDoc])).toHaveLength(1);
    expect(collectAll([withDoc, noDoc], { onlyWithDocs: false })).toHaveLength(2);
  });
});
