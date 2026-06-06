import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import os from 'os';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const axios = require('axios');
const { downloadPdf, urlToFilename } = require('../utils/pdfDownloader.js');

// ─── helpers ──────────────────────────────────────────────────────────────────

// Compute MD5 of a file synchronously (mirrors the spec's computeFileHash intent
// using Node's built-in crypto — the actual module uses SHA-256 internally, but
// the spec asks us to verify MD5 of a known string independently).
const crypto = require('crypto');
function computeFileHash(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('md5').update(buf).digest('hex');
}

// Mirror the module's urlToFilename logic so we can assert the cache path shape.
// urlToFilename(url) -> "<12-char-md5-prefix>_<segment>.pdf"
function buildCachePath(cacheDir, url) {
  const filename = urlToFilename(url);
  return path.join(cacheDir, filename);
}

// ─── cleanup registry ─────────────────────────────────────────────────────────

const tempFiles = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const f of tempFiles) {
    try { fs.unlinkSync(f); } catch { /* already gone */ }
  }
  tempFiles.length = 0;
});

// ─── tests ────────────────────────────────────────────────────────────────────

test('computeFileHash returns consistent md5 hex', () => {
  const tmpFile = path.join(os.tmpdir(), 'test_hash_input.txt');
  fs.writeFileSync(tmpFile, 'hello world');
  tempFiles.push(tmpFile);

  const hash = computeFileHash(tmpFile);
  expect(hash).toBe('5eb63bbbe01eeed093cb22bb8f5acdc3');
});

test('buildCachePath returns deterministic path under cacheDir', () => {
  const result = buildCachePath('/tmp/cache', 'https://example.com/test.pdf');
  expect(result.startsWith('/tmp/cache/')).toBe(true);
  expect(result.endsWith('.pdf')).toBe(true);
});

test('urlToFilename produces the same filename for the same URL', () => {
  const url = 'https://example.com/prospectus.pdf';
  const a = urlToFilename(url);
  const b = urlToFilename(url);
  expect(a).toBe(b);
  expect(a.endsWith('.pdf')).toBe(true);
});

test('downloadPdf throws when url is falsy', async () => {
  await expect(downloadPdf('')).rejects.toThrow('url is required');
});

test('downloadPdf fetches and writes a file on first call', async () => {
  const pdfContent = Buffer.from('%PDF-1.4 fake content');

  vi.spyOn(axios, 'get').mockResolvedValue({
    status: 200,
    data: pdfContent,
    headers: { etag: '"abc123"' },
  });

  const filePath = await downloadPdf('https://example.com/test-first-call.pdf');
  tempFiles.push(filePath);

  expect(fs.existsSync(filePath)).toBe(true);
  expect(axios.get).toHaveBeenCalledOnce();
});

test('downloadPdf returns cached file on second call when hash matches', async () => {
  const pdfContent = Buffer.from('%PDF-1.4 cached content unique-' + Date.now());
  const mockGet = vi.spyOn(axios, 'get').mockResolvedValue({
    status: 200,
    data: pdfContent,
    headers: {},
  });

  const url = 'https://example.com/cache-test-' + Date.now() + '.pdf';

  const firstPath = await downloadPdf(url);
  tempFiles.push(firstPath);

  // Second call — same content, same hash -> module skips re-writing and
  // returns the existing path without a second write.
  const secondPath = await downloadPdf(url);

  expect(firstPath).toBe(secondPath);
  // axios.get is called twice because the module uses ETag / hash comparison
  // on the response — it still makes the HTTP request but avoids disk writes.
  expect(mockGet).toHaveBeenCalledTimes(2);
});
