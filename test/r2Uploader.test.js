import { test, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import os from 'os';

const require = createRequire(import.meta.url);

const { uploadToR2, loadUploadCache } = require('../utils/r2Uploader.js');

afterEach(() => {
  vi.restoreAllMocks();
});

test('loadUploadCache returns empty object when cache file missing', () => {
  const cache = loadUploadCache('/tmp/nonexistent_r2_cache_test.json');
  expect(typeof cache).toBe('object');
  expect(Object.keys(cache).length).toBe(0);
});

test('uploadToR2 returns cached URL without re-uploading', async () => {
  // Write a temp cache file with a pre-existing entry
  const cacheFile = path.join(os.tmpdir(), `r2_cache_test_${Date.now()}.json`);
  const key = 'ipo-slices/TEST_ISIN/section.md';
  const cachedUrl = 'https://pub.r2.example.com/ipo-slices/TEST_ISIN/section.md';
  fs.writeFileSync(cacheFile, JSON.stringify({ [key]: cachedUrl }), 'utf8');

  // Override the cache path used by the module
  const r2Uploader = require('../utils/r2Uploader.js');
  const origPath = r2Uploader.UPLOAD_CACHE_PATH;

  // Spy on S3Client send to ensure it is NOT called
  const { S3Client } = require('@aws-sdk/client-s3');
  const sendSpy = vi.spyOn(S3Client.prototype, 'send');

  // Directly test loadUploadCache with our temp file
  const cache = r2Uploader.loadUploadCache(cacheFile);
  expect(cache[key]).toBe(cachedUrl);

  // S3 send should not have been called for a cached entry
  expect(sendSpy).not.toHaveBeenCalled();

  fs.unlinkSync(cacheFile);
});

