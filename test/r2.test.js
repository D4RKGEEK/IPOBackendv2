import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const r2 = require('../utils/r2');
const { parseRequiredTimeout } = require('../utils/firecrawl');
const { docKey, VALID_DOC_TYPES } = require('../utils/docPipeline');

const ENV = {
  CF_ACCOUNT_ID: 'acct123',
  R2_ACCESS_KEY_ID: 'ak',
  R2_SECRET_ACCESS_KEY: 'sk',
  R2_BUCKET: 'ipo-bucket',
  R2_PUBLIC_BASE: 'https://pub-abc.r2.dev/',
};

describe('r2.getConfig', () => {
  it('builds endpoint and trims trailing slash on public base', () => {
    const c = r2.getConfig(ENV);
    expect(c.endpoint).toBe('https://acct123.r2.cloudflarestorage.com');
    expect(c.publicBase).toBe('https://pub-abc.r2.dev');
  });
  it('throws listing every missing var', () => {
    expect(() => r2.getConfig({})).toThrow(/CF_ACCOUNT_ID/);
    expect(() => r2.getConfig({ CF_ACCOUNT_ID: 'x' })).toThrow(/R2_ACCESS_KEY_ID/);
  });
});

describe('r2.getPublicUrl', () => {
  it('joins base + key, stripping leading slashes', () => {
    expect(r2.getPublicUrl('ipos/FOO/rhp.pdf', ENV)).toBe('https://pub-abc.r2.dev/ipos/FOO/rhp.pdf');
    expect(r2.getPublicUrl('/ipos/FOO/rhp.pdf', ENV)).toBe('https://pub-abc.r2.dev/ipos/FOO/rhp.pdf');
  });
});

describe('r2.normalizeKey', () => {
  it('strips leading slashes and collapses duplicates', () => {
    expect(r2.normalizeKey('/a//b///c.pdf')).toBe('a/b/c.pdf');
  });
});

describe('r2.contentTypeFor', () => {
  it('maps known extensions', () => {
    expect(r2.contentTypeFor('x.pdf')).toBe('application/pdf');
    expect(r2.contentTypeFor('x.md')).toMatch(/markdown/);
    expect(r2.contentTypeFor('x.json')).toMatch(/json/);
    expect(r2.contentTypeFor('x.bin')).toBe('application/octet-stream');
  });
});

describe('firecrawl.parseRequiredTimeout', () => {
  it('extracts the suggested ms from the page-count error', () => {
    const err = 'The PDF has 318 pages ... increase the timeout parameter ... to at least 52700ms.';
    expect(parseRequiredTimeout(err)).toBe(52700);
  });
  it('handles comma-formatted ms and seconds fallback', () => {
    expect(parseRequiredTimeout('increase the timeout to at least 1,20,000ms')).toBe(120000);
    expect(parseRequiredTimeout('timeout too low; needs 80 seconds or more')).toBe(80000);
  });
  it('returns null for unrelated errors', () => {
    expect(parseRequiredTimeout('Invalid API key')).toBe(null);
  });
});

describe('docPipeline.docKey', () => {
  it('builds the canonical key scheme and sanitizes the symbol', () => {
    expect(docKey('HARIKANTA', 'rhp', 'pdf')).toBe('ipos/HARIKANTA/rhp.pdf');
    expect(docKey('harikanta', 'RHP', 'md')).toBe('ipos/HARIKANTA/rhp.md');
    expect(docKey('Foo Bar/Ltd', 'drhp', 'json')).toBe('ipos/FOO_BAR_LTD/drhp.json');
  });
  it('exposes the three document types', () => {
    expect(VALID_DOC_TYPES).toEqual(['drhp', 'rhp', 'final']);
  });
});
