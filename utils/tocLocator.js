const { PdfReader } = require('pdfreader');

/**
 * Canonical target section keys and their common aliases found in Indian IPO prospectuses.
 * Maps a canonical key -> array of heading patterns (case-insensitive substring match).
 */
const SECTION_TARGETS = {
  GENERAL_INFORMATION: [
    'general information',
    'general information of the company',
  ],
  CAPITAL_STRUCTURE: [
    'capital structure',
    'capital structure of the company',
    'capitalisation statement',
  ],
  OBJECTS_OF_THE_OFFER: [
    'objects of the offer',
    'objects of the issue',
    'object of the issue',
    'use of proceeds',
    'utilization of proceeds',
    'utilisation of net proceeds',
    'objects of the fresh issue',
  ],
  BASIS_FOR_OFFER_PRICE: [
    'basis for offer price',
    'basis for issue price',
    'basis of offer price',
    'basis of issue price',
    'basis for the offer price',
    'basis for the issue price',
  ],
  RESTATED_FINANCIAL_STATEMENTS: [
    'restated financial statements',
    'restated financial statement',
    'restated financial information',
    'restated consolidated financial statements',
    'restated consolidated financial information',
    'financial information',
    'financial information of the company',
    'audited financial statements',
  ],
  RISK_FACTORS: [
    'risk factors',
  ],
  OUR_MANAGEMENT: [
    'our management',
  ],
  OUR_PROMOTERS_AND_PROMOTER_GROUP: [
    'our promoters and promoter group',
    'our promoters & promoter group',
    'our promoter & promoter group',
  ],
  DIVIDEND_POLICY: [
    'dividend policy',
  ],
  INDUSTRY_OVERVIEW: [
    'industry overview',
  ],
  OUR_BUSINESS: [
    'our business',
    'business overview',
  ],
  STATEMENT_OF_SPECIAL_TAX_BENEFITS: [
    'statement of special tax benefits',
    'statement of possible special tax benefits',
    'statement of tax benefits',
  ],
  OTHER_FINANCIAL_INFORMATION: [
    'other financial information',
  ],
  STATEMENT_OF_FINANCIAL_INDEBTEDNESS: [
    'statement of financial indebtedness',
    'financial indebtedness',
  ],
  OUTSTANDING_LITIGATION: [
    'outstanding litigation',
    'outstanding litigation and material developments',
    'outstanding litigations and material developments',
    'outstanding litigation and other material developments',
  ],
  ISSUE_PROCEDURE: [
    'issue procedure',
    'terms of the issue',
    'terms of the offer',
  ],
  ISSUE_STRUCTURE: [
    'issue structure',
    'offer structure',
  ],
  OUR_GROUP_COMPANIES: [
    'our group companies',
    'our group company',
  ],
  KEY_REGULATIONS_AND_POLICIES: [
    'key regulations and policies',
    'key industry regulations and policies',
    'key industry regulations',
    'government and other approvals',
    'government and other statutory approvals',
  ],
  HISTORY_AND_CERTAIN_CORPORATE_MATTERS: [
    'history and certain corporate matters',
    'history and corporate structure',
    'our history and corporate structure',
    'our history and certain corporate matters',
  ],
  ABOUT_THE_COMPANY: [
    'about the company',
    'about our company',
    'about company',
  ],
};


/**
 * Normalize a heading line for matching: lowercase, collapse whitespace, strip punctuation.
 * @param {string} str
 * @returns {string}
 */
function normalizeHeading(str) {
  return str
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check if a normalized line matches any alias for a given target key.
 * @param {string} normalizedLine
 * @param {string[]} aliases
 * @returns {boolean}
 */
function matchesTarget(normalizedLine, aliases) {
  return aliases.some(alias => normalizedLine.includes(alias));
}

/**
 * Extract a TOC-style page number from a text item.
 * Looks for trailing digits that represent a printed page number.
 * e.g. "Objects of the Offer ............. 45" -> 45
 * @param {string} text
 * @returns {number|null}
 */
function extractTrailingPageNumber(text) {
  const match = text.match(/[\s.]+(\d{1,4})\s*$/);
  if (match) {
    const n = parseInt(match[1], 10);
    if (n > 0 && n < 5000) return n;
  }
  return null;
}

/**
 * Parse a PDF file and locate printed page ranges for target sections.
 * Uses pdfreader to stream text items page-by-page.
 *
 * Strategy:
 * 1. First pass: collect all text lines per PDF page, tracking printed page numbers
 *    by looking for sequential numeric items in typical TOC format.
 * 2. Detect TOC pages (pages with many dotted/spaced entries ending in numbers).
 * 3. Match section headings in TOC to extract printed page ranges.
 * 4. Fall back to full-document heading scan if TOC match fails.
 *
 * @param {string} filePath Absolute path to the PDF file
 * @returns {Promise<object>} Map of canonical key -> { printedStart, printedEnd, pdfPage }
 */
function locateSections(filePath) {
  return new Promise((resolve, reject) => {
    const reader = new PdfReader();

    // pageItems[pdfPageNum] = array of { text, x, y }
    const pageItems = {};
    let currentPage = 0;

    reader.parseFileItems(filePath, (err, item) => {
      if (err) {
        return reject(new Error(`tocLocator: pdfreader error: ${err.message || err}`));
      }

      if (!item) {
        // End of file — now analyze collected items
        try {
          const result = analyzeItems(pageItems);
          resolve(result);
        } catch (analysisErr) {
          reject(analysisErr);
        }
        return;
      }

      if (item.page) {
        currentPage = item.page;
        pageItems[currentPage] = pageItems[currentPage] || [];
        return;
      }

      if (item.text && currentPage > 0) {
        pageItems[currentPage].push({
          text: item.text,
          x: item.x || 0,
          y: item.y || 0
        });
      }
    });
  });
}

/**
 * Analyze collected page items to find section page ranges.
 * @param {object} pageItems
 * @returns {object} { OBJECTS_OF_THE_OFFER: { printedStart, printedEnd }, ... }
 */
function analyzeItems(pageItems) {
  const results = {};

  // Gather lines per PDF page (group items by y-coordinate rounded to 1dp)
  const pdfPages = Object.keys(pageItems).map(Number).sort((a, b) => a - b);

  // Build line-level text for each PDF page
  const pageLines = {};
  for (const pdfPage of pdfPages) {
    const items = pageItems[pdfPage];
    // Group by y position (rounded to nearest 0.5)
    const byY = {};
    for (const item of items) {
      const yKey = Math.round(item.y * 2) / 2;
      byY[yKey] = byY[yKey] || [];
      byY[yKey].push(item);
    }
    // Sort by y then x, concatenate into lines
    const lines = Object.keys(byY)
      .map(Number)
      .sort((a, b) => a - b)
      .map(y => byY[y].sort((a, b) => a.x - b.x).map(i => i.text).join(' ').trim())
      .filter(l => l.length > 0);
    pageLines[pdfPage] = lines;
  }

  // === Phase 1: TOC detection ===
  // A TOC page typically has many lines ending in a number (page reference)
  const tocPages = [];
  for (const pdfPage of pdfPages) {
    const lines = pageLines[pdfPage] || [];
    const linesWithNumbers = lines.filter(l => extractTrailingPageNumber(l) !== null);
    // If >30% of non-trivial lines end in a page number, it's likely a TOC page
    const nonTrivial = lines.filter(l => l.length > 8);
    if (nonTrivial.length > 3 && linesWithNumbers.length / nonTrivial.length > 0.3) {
      tocPages.push(pdfPage);
    }
  }

  // === Phase 2: TOC match ===
  // Build a map of canonical key -> printed page number from TOC
  const tocMatches = {}; // key -> array of printed page numbers seen

  for (const pdfPage of tocPages) {
    const lines = pageLines[pdfPage] || [];
    for (const line of lines) {
      const norm = normalizeHeading(line);
      const pageNum = extractTrailingPageNumber(line);
      if (pageNum === null) continue;

      for (const [key, aliases] of Object.entries(SECTION_TARGETS)) {
        if (matchesTarget(norm, aliases)) {
          tocMatches[key] = tocMatches[key] || [];
          tocMatches[key].push(pageNum);
        }
      }
    }
  }

  // === Phase 3: Build results from TOC matches ===
  // For each matched key, printedStart = first (smallest) page number found
  // printedEnd = next matched section's start - 1 (or +50 as a safe window)
  const matchedKeys = Object.keys(tocMatches);
  const allStartPages = matchedKeys
    .map(k => Math.min(...tocMatches[k]))
    .sort((a, b) => a - b);

  for (const key of matchedKeys) {
    const printedStart = Math.min(...tocMatches[key]);
    const idx = allStartPages.indexOf(printedStart);
    const printedEnd = idx < allStartPages.length - 1
      ? allStartPages[idx + 1] - 1
      : printedStart + 60; // safe window

    results[key] = {
      printedStart,
      printedEnd: Math.min(printedEnd, printedStart + 80), // cap window at 80 pages
      source: 'toc'
    };
  }

  // === Phase 4: Full-doc fallback scan for unmatched targets ===
  const unmatched = Object.keys(SECTION_TARGETS).filter(k => !results[k]);
  if (unmatched.length > 0) {
    // Scan every page for heading matches (no trailing page number required)
    // Track which PDF pages contain which section headings
    const headingPdfPages = {}; // key -> [pdfPage numbers]

    for (const pdfPage of pdfPages) {
      const lines = pageLines[pdfPage] || [];
      for (const line of lines) {
        const norm = normalizeHeading(line);
        for (const key of unmatched) {
          if (matchesTarget(norm, SECTION_TARGETS[key])) {
            headingPdfPages[key] = headingPdfPages[key] || [];
            headingPdfPages[key].push(pdfPage);
          }
        }
      }
    }

    for (const key of unmatched) {
      if (headingPdfPages[key] && headingPdfPages[key].length > 0) {
        const firstPdfPage = Math.min(...headingPdfPages[key]);
        results[key] = {
          printedStart: null, // printed page unknown without TOC
          printedEnd: null,
          pdfPageStart: firstPdfPage,
          pdfPageEnd: firstPdfPage + 60,
          source: 'fullscan'
        };
      }
    }
  }

  return results;
}

module.exports = { locateSections, SECTION_TARGETS, normalizeHeading };
