const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const pdfParse = require('pdf-parse');

/**
 * Slice a PDF file to a specific page range and save to outputPath.
 * Uses pdf-lib to copy only the target pages without loading the full PDF into V8 heap.
 *
 * @param {string} inputPath  Absolute path to source PDF
 * @param {number} startPage  1-indexed start page (inclusive)
 * @param {number} endPage    1-indexed end page (inclusive)
 * @param {string} outputPath Absolute path to write the sliced PDF
 * @returns {Promise<void>}
 */
async function slicePdf(inputPath, startPage, endPage, outputPath) {
  const srcBytes = fs.readFileSync(inputPath);
  const srcDoc = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
  const totalPages = srcDoc.getPageCount();

  // Clamp to actual document range (1-indexed -> 0-indexed internally)
  const clampedStart = Math.max(1, startPage);
  const clampedEnd = Math.min(totalPages, endPage);

  if (clampedStart > clampedEnd) {
    throw new Error(
      `pdfSlicer: invalid page range ${startPage}-${endPage} for PDF with ${totalPages} pages`
    );
  }

  // Build 0-indexed page list
  const pageIndices = [];
  for (let i = clampedStart - 1; i <= clampedEnd - 1; i++) {
    pageIndices.push(i);
  }

  const destDoc = await PDFDocument.create();
  const copiedPages = await destDoc.copyPages(srcDoc, pageIndices);
  for (const page of copiedPages) {
    destDoc.addPage(page);
  }

  const destBytes = await destDoc.save();
  fs.writeFileSync(outputPath, destBytes);
}

/**
 * Convert a PDF file (or buffer) to clean Markdown text.
 * Uses pdf-parse for text extraction, then applies cleaning heuristics:
 * - Collapse excessive blank lines
 * - Strip non-printable characters
 * - Normalize whitespace
 *
 * @param {string} pdfPath  Absolute path to the PDF file
 * @returns {Promise<string>} Markdown-formatted text
 */
async function pdfToMarkdown(pdfPath) {
  const buffer = fs.readFileSync(pdfPath);
  const data = await pdfParse(buffer, {
    // Preserve layout for table detection
    pagerender: null,
  });

  const rawText = data.text || '';

  // Clean and convert to markdown
  const markdown = rawText
    // Normalize line endings
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Strip null bytes and other non-printable chars (except newlines/tabs)
    .replace(/[^\x09\x0A\x20-\x7E\u00A0-\uFFFF]/g, '')
    // Collapse 3+ consecutive blank lines to 2
    .replace(/\n{3,}/g, '\n\n')
    // Remove trailing spaces on each line
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .trim();

  return markdown;
}

/**
 * Slice a PDF to a page range and convert the slice to Markdown in one step.
 *
 * @param {string} inputPath   Source PDF absolute path
 * @param {number} startPage   1-indexed start page
 * @param {number} endPage     1-indexed end page
 * @param {string} sliceOutDir Directory to write the temporary slice PDF
 * @param {string} sliceName   Base name for the slice file (without extension)
 * @returns {Promise<{ slicePath: string, markdown: string }>}
 */
async function sliceAndConvert(inputPath, startPage, endPage, sliceOutDir, sliceName) {
  fs.mkdirSync(sliceOutDir, { recursive: true });
  const slicePath = path.join(sliceOutDir, `${sliceName}.pdf`);

  await slicePdf(inputPath, startPage, endPage, slicePath);
  const markdown = await pdfToMarkdown(slicePath);

  return { slicePath, markdown };
}

module.exports = { slicePdf, pdfToMarkdown, sliceAndConvert };
