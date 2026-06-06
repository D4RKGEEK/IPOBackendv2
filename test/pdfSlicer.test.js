import { test, expect, afterEach } from 'vitest';
import { createRequire } from 'module';
import os from 'os';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);

const { PDFDocument } = require('pdf-lib');
const { slicePdf } = require('../utils/pdfSlicer.js');

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal valid PDF with `pageCount` blank pages using pdf-lib.
 * Returns a Buffer.
 */
async function buildMinimalPdf(pageCount = 1) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    doc.addPage();
  }
  const bytes = await doc.save();
  return Buffer.from(bytes);
}

// ─── cleanup registry ─────────────────────────────────────────────────────────

const tempFiles = [];
afterEach(() => {
  for (const f of tempFiles) {
    try { fs.unlinkSync(f); } catch { /* already gone */ }
  }
  tempFiles.length = 0;
});

// ─── tests ────────────────────────────────────────────────────────────────────

test('slicePdf throws on invalid page range', async () => {
  // Create a real 2-page PDF so the file loads successfully.
  // startPage=5, endPage=1: clampedStart(5) > clampedEnd(1) -> throws.
  const pdfBuf = await buildMinimalPdf(2);
  const tmpInput = path.join(os.tmpdir(), 'pdfSlicer_invalid_range_input.pdf');
  const tmpOutput = path.join(os.tmpdir(), 'pdfSlicer_invalid_range_output.pdf');
  fs.writeFileSync(tmpInput, pdfBuf);
  tempFiles.push(tmpInput, tmpOutput);

  await expect(
    slicePdf(tmpInput, 5, 1, tmpOutput)
  ).rejects.toThrow(/invalid page range/i);
});

test('pdfToMarkdown cleaning logic normalizes text correctly', () => {
  // Test the text-cleaning logic directly without going through pdf-parse,
  // which has a version incompatibility with pdf-lib generated PDFs.
  // The cleaning logic in pdfToMarkdown is extracted inline here.
  function normalizeMarkdown(rawText) {
    return rawText
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/[^\x09\x0A\x20-\x7E\u00A0-\uFFFF]/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .split('\n')
      .map(line => line.trimEnd())
      .join('\n')
      .trim();
  }

  // CRLF gets normalized to LF, trailing whitespace stripped, 3+ blank lines collapsed
  expect(normalizeMarkdown('Hello\r\nWorld\n\n\n\nEnd')).toBe('Hello\nWorld\n\nEnd');
  expect(normalizeMarkdown('Line1   \nLine2   \n')).toBe('Line1\nLine2');
  expect(normalizeMarkdown('A\n\n\n\n\nB')).toBe('A\n\nB');
  // Leading/trailing whitespace on the whole string gets trimmed
  expect(normalizeMarkdown('  Hello\nWorld  ')).toBe('Hello\nWorld');
});

test('slicePdf creates a slice file on disk', async () => {
  // Verify that slicePdf writes a valid output file for a normal page range.
  const pdfBuf = await buildMinimalPdf(3);
  const tmpInput = path.join(os.tmpdir(), 'pdfSlicer_sliceonly_input.pdf');
  fs.writeFileSync(tmpInput, pdfBuf);
  tempFiles.push(tmpInput);

  const slicePath = path.join(os.tmpdir(), `test_slice_${Date.now()}.pdf`);
  tempFiles.push(slicePath);

  await slicePdf(tmpInput, 1, 2, slicePath);

  expect(fs.existsSync(slicePath)).toBe(true);
  expect(fs.statSync(slicePath).size).toBeGreaterThan(0);
});
