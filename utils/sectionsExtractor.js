'use strict';

/**
 * sectionsExtractor.js
 * For a given IPO company:
 * 1. Download the RHP/DRHP PDF
 * 2. Locate all hardcoded sections via tocLocator
 * 3. Slice each section into individual PDF + markdown
 * 4. Save under data/<companyName>/pdfs/
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

/** Lazy-loaded deps so tests can mock */
const _dl = () => require('./pdfDownloader');
const _toc = () => require('./tocLocator');
const _slice = () => require('./pdfSlicer');

/**
 * Sanitize a company name to a safe directory name.
 */
function sanitize(name) {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'unknown';
}

/**
 * Extract all hardcoded sections for a single IPO.
 *
 * @param {object} ipo - Record from ipo_master.json
 * @param {object} [options]
 * @param {string} [options.outDir] - Override output directory (default: data/<sanitized_name>)
 * @param {boolean} [options.skipExisting] - Skip sections already extracted
 * @returns {Promise<{ sections: object, pdfStatus: string, errors: string[] }>}
 */
async function extractSectionsForIpo(ipo, options = {}) {
  const { downloadPdf } = _dl();
  const { locateSections, SECTION_TARGETS } = _toc();
  const { slicePdf, pdfToMarkdown } = _slice();

  const errors = [];
  const sections = {};
  let pdfPath = null;
  let pdfStatus = 'skipped';

  // 1. Resolve PDF URL
  const rhpUrl = ipo.documentUrls && (ipo.documentUrls.rhp || ipo.documentUrls.drhp);
  if (!rhpUrl) {
    return { sections, pdfStatus: 'no_url', errors: ['No RHP/DRHP URL available'] };
  }

  // 2. Download PDF
  try {
    const dl = await downloadPdf(rhpUrl);
    pdfStatus = dl.status;
    if (dl.status === 'success' || dl.status === 'already_parsed') {
      pdfPath = dl.filePath;
    } else {
      return { sections, pdfStatus, errors: [`PDF download failed: ${dl.status}`] };
    }
  } catch (e) {
    return { sections, pdfStatus: 'error', errors: [`Download error: ${e.message}`] };
  }

  // 3. Determine output directory
  const companyDir = sanitize(ipo.companyName || ipo.symbol || 'unknown');
  const outDir = options.outDir || path.join(DATA_DIR, companyDir, 'pdfs');
  const companyRoot = path.join(DATA_DIR, companyDir);

  // Copy full PDF into company dir
  const fullPdfDest = path.join(companyRoot, 'full.pdf');
  if (!fs.existsSync(companyRoot)) {
    fs.mkdirSync(companyRoot, { recursive: true });
  }
  fs.copyFileSync(pdfPath, fullPdfDest);

  // 4. Locate sections
  let tocResults = {};
  try {
    tocResults = await locateSections(pdfPath);
  } catch (e) {
    errors.push(`TOC locate error: ${e.message}`);
  }
  const sectionsToExtract = Object.keys(SECTION_TARGETS);

  // 5. For each hardcoded section, locate page range and slice
  for (const sectionKey of sectionsToExtract) {
    const sectionInfo = tocResults[sectionKey];
    if (!sectionInfo) {
      sections[sectionKey] = { status: 'not_found' };
      continue;
    }

    const startPage = sectionInfo.printedStart || sectionInfo.pdfPageStart;
    const endFromToc = sectionInfo.printedEnd || sectionInfo.pdfPageEnd;
    if (!startPage) {
      sections[sectionKey] = { status: 'not_found', detail: 'no page number' };
      continue;
    }

    let endPage = endFromToc;
    if (!endPage) {
      const keys = sectionsToExtract;
      const currentIdx = keys.indexOf(sectionKey);
      for (let i = currentIdx + 1; i < keys.length; i++) {
        const next = tocResults[keys[i]];
        if (next) {
          const nextStart = next.printedStart || next.pdfPageStart;
          if (nextStart && nextStart > startPage) {
            endPage = nextStart - 1;
            break;
          }
        }
      }
    }
    if (!endPage) {
      endPage = startPage + 50;
    }
    if (endPage < startPage) {
      sections[sectionKey] = { status: 'skipped', reason: `endPage(${endPage}) < startPage(${startPage})` };
      continue;
    }

    // 6. Slice PDF + extract markdown
    const pdfOut = path.join(outDir, `${sectionKey}.pdf`);
    const mdOut = path.join(outDir, `${sectionKey}.md`);

    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    try {
      const tempSlice = path.join(outDir, `_${sectionKey}_slice.pdf`);
      await slicePdf(pdfPath, startPage, endPage, tempSlice);
      const markdown = await pdfToMarkdown(tempSlice);
      fs.writeFileSync(mdOut, markdown, 'utf8');
      fs.renameSync(tempSlice, pdfOut);

      sections[sectionKey] = {
        status: 'extracted',
        pdfPages: `${startPage}-${endPage}`,
        pdfFile: `${sectionKey}.pdf`,
        mdFile: `${sectionKey}.md`,
      };
    } catch (e) {
      errors.push(`Section ${sectionKey} (p${startPage}-${endPage}): ${e.message}`);
      sections[sectionKey] = { status: 'error', error: e.message };
    }
  }

  // Write manifest
  const manifest = {
    companyName: ipo.companyName,
    symbol: ipo.symbol,
    isin: ipo.isin,
    pdfUrl: rhpUrl,
    pdfStatus,
    sections,
    errors,
    extractedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(companyRoot, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  return { sections, pdfStatus, errors };
}

/**
 * Extract sections for ALL IPOs that have document URLs.
 * @param {Array} ipos
 * @param {object} [options]
 * @param {number} [options.concurrency=3]
 * @returns {Promise<{ total: number, success: number, failed: number, results: object[] }>}
 */
async function extractAllSections(ipos, options = {}) {
  const concurrency = options.concurrency || 3;
  const results = [];
  let success = 0;
  let failed = 0;

  const withDocs = ipos.filter(ipo => ipo.documentUrls && (ipo.documentUrls.rhp || ipo.documentUrls.drhp));

  for (let i = 0; i < withDocs.length; i += concurrency) {
    const batch = withDocs.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map(ipo => extractSectionsForIpo(ipo, options))
    );

    for (let j = 0; j < batchResults.length; j++) {
      const r = batchResults[j];
      const company = batch[j].companyName;
      if (r.status === 'fulfilled') {
        const extracted = Object.values(r.value.sections).filter(s => s.status === 'extracted').length;
        results.push({ company, isin: batch[j].isin, extracted, errors: r.value.errors });
        success++;
        console.log(`  ✓ ${company}: ${extracted} sections`);
      } else {
        results.push({ company, isin: batch[j].isin, error: r.reason?.message });
        failed++;
        console.log(`  ✗ ${company}: ${r.reason?.message}`);
      }
    }
  }

  return { total: withDocs.length, success, failed, results };
}

module.exports = { extractSectionsForIpo, extractAllSections, sanitize };
