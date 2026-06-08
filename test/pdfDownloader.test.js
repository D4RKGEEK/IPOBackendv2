import { test, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';
import os from 'os';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const axios = require('axios');
const { downloadPdf, urlToFilename } = require('../utils/pdfDownloader.js');
const crypto = require('crypto');

function computeFileHash(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('md5').update(buf).digest('hex');
}

function buildCachePath(cacheDir, url) {
  const filename = urlToFilename(url);
  return path.join(cacheDir, filename);
}

const tempFiles = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const f of tempFiles) {
    try { fs.unlinkSync(f); } catch { /* already gone */ }
  }
  tempFiles.length = 0;
});

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

test('downloadPdf returns download_failed when url is falsy', async () => {
  const result = await downloadPdf('');
  expect(result.status).toBe('download_failed');
  expect(result.error).toMatch(/url is required/i);
});

test('downloadPdf returns success status with filePath on first call', async () => {
  const pdfContent = Buffer.from('%PDF-1.4 fake content for gate test');

  vi.spyOn(axios, 'get').mockResolvedValue({
    status: 200,
    data: pdfContent,
    headers: { etag: '"abc123"' },
  });

  const result = await downloadPdf('https://example.com/test-first-call-' + Date.now() + '.pdf');

  // New API returns { status, filePath } object
  expect(result).toHaveProperty('status');
  expect(result).toHaveProperty('filePath');
  // Status is not download_failed
  expect(result.status).not.toBe('download_failed');
  if (result.filePath) tempFiles.push(result.filePath);
  expect(axios.get).toHaveBeenCalledOnce();
});

test('downloadPdf detects corrigendum/notice by filename and returns not_a_prospectus', async () => {
  const pdfContent = Buffer.from('%PDF-1.4 corrigendum content');

  vi.spyOn(axios, 'get').mockResolvedValue({
    status: 200,
    data: pdfContent,
    headers: {},
  });

  const result = await downloadPdf('https://example.com/corrigendum-notice.pdf');
  expect(result.status).toBe('not_a_prospectus');
});

test('downloadPdf detects abridged by filename and returns abridged_detected', async () => {
  const pdfContent = Buffer.from('%PDF-1.4 abridged prospectus');

  vi.spyOn(axios, 'get').mockResolvedValue({
    status: 200,
    data: pdfContent,
    headers: {},
  });

  const result = await downloadPdf('https://example.com/abridged-prospectus.pdf');
  expect(result.status).toBe('abridged_detected');
});

test('downloadPdf returns download_failed on HTTP 404', async () => {
  vi.spyOn(axios, 'get').mockResolvedValue({
    status: 404,
    data: Buffer.from('not found'),
    headers: {},
  });

  const result = await downloadPdf('https://example.com/missing-' + Date.now() + '.pdf');
  expect(result.status).toBe('download_failed');
});
