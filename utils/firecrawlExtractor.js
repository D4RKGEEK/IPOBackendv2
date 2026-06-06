const FirecrawlApp = require('@mendable/firecrawl-js').default;
const { z } = require('zod');

/**
 * Zod schema for the structured financial ratios we want to extract.
 * All fields are optional — LLMs don't always find everything.
 */
const FinancialRatioSchema = z.object({
  // Valuation
  pePreIpo: z.number().nullable().optional().describe('Pre-IPO Price/Earnings ratio'),
  pePostIpo: z.number().nullable().optional().describe('Post-IPO Price/Earnings ratio'),
  epsPreIpo: z.number().nullable().optional().describe('Pre-IPO Earnings Per Share (INR)'),
  epsPostIpo: z.number().nullable().optional().describe('Post-IPO Earnings Per Share (INR)'),
  ronw: z.number().nullable().optional().describe('Return on Net Worth % (post-issue)'),

  // Financial health
  debtToEquity: z.number().nullable().optional().describe('Debt-to-Equity ratio'),
  ebitdaMargin: z.number().nullable().optional().describe('EBITDA margin %'),
  patMargin: z.number().nullable().optional().describe('PAT (Profit After Tax) margin %'),

  // Promoter
  promoterHoldingPreIpo: z.number().nullable().optional().describe('Promoter holding % pre-IPO'),
  promoterHoldingPostIpo: z.number().nullable().optional().describe('Promoter holding % post-IPO'),

  // Offer details
  issueObjectsSummary: z.string().nullable().optional().describe('Brief summary of objects of the offer (use of proceeds)'),
  freshIssueSizeInr: z.number().nullable().optional().describe('Fresh issue size in INR crores'),
  ofsInr: z.number().nullable().optional().describe('Offer for sale component in INR crores'),

  // Metadata
  extractedSections: z.array(z.string()).optional().describe('Which sections were used for extraction'),
}).describe('Key financial ratios from an IPO prospectus');

/**
 * Extract structured financial ratios from a public URL using Firecrawl.
 *
 * @param {string} url        Public URL of the markdown document (e.g. R2 public URL)
 * @param {object} [options]
 * @param {number} [options.timeout]  Request timeout in ms (default: 60000)
 * @returns {Promise<object>} Parsed financial ratios object (may have null fields)
 */
async function extractRatiosFromUrl(url, options = {}) {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error('firecrawlExtractor: FIRECRAWL_API_KEY not set');
  }

  const app = new FirecrawlApp({ apiKey });

  const result = await app.scrapeUrl(url, {
    formats: ['extract'],
    extract: {
      schema: FinancialRatioSchema,
      prompt: [
        'Extract key financial metrics from this IPO prospectus section.',
        'Focus on: P/E ratios (pre and post IPO), EPS, RoNW, debt-to-equity,',
        'EBITDA margin, PAT margin, promoter holding percentages,',
        'fresh issue size and OFS size in crores, and objects of the offer.',
        'Return null for any value you cannot find or are not confident about.',
        'All monetary values should be in INR crores unless otherwise noted.',
        'All ratios/percentages should be plain numbers (e.g. 25.3, not "25.3%").',
      ].join(' '),
    },
    timeout: options.timeout || 60000,
  });

  if (!result.success) {
    throw new Error(`firecrawlExtractor: scrape failed for ${url}: ${result.error || 'unknown error'}`);
  }

  return result.extract || {};
}

/**
 * Run post-extraction mathematical sanity checks on extracted ratios.
 * Logs warnings for suspicious values but does not throw.
 *
 * Checks:
 * - P/E ratios should be positive if present
 * - Margins should be between -100 and 100
 * - Promoter holding % should be between 0 and 100
 * - Post-IPO promoter holding should be <= pre-IPO (dilution direction)
 * - EPS should be positive if company is profitable (no way to enforce without PAT data, skip)
 *
 * @param {object} ratios  Extracted ratios from extractRatiosFromUrl
 * @param {string} [label] IPO label for log messages
 * @returns {object} { valid: boolean, warnings: string[] }
 */
function validateRatios(ratios, label = 'unknown') {
  const warnings = [];

  if (ratios.pePreIpo !== null && ratios.pePreIpo !== undefined && ratios.pePreIpo < 0) {
    warnings.push(`[${label}] pePreIpo is negative (${ratios.pePreIpo}) — suspicious`);
  }
  if (ratios.pePostIpo !== null && ratios.pePostIpo !== undefined && ratios.pePostIpo < 0) {
    warnings.push(`[${label}] pePostIpo is negative (${ratios.pePostIpo}) — suspicious`);
  }
  if (ratios.ebitdaMargin !== null && ratios.ebitdaMargin !== undefined) {
    if (ratios.ebitdaMargin < -100 || ratios.ebitdaMargin > 100) {
      warnings.push(`[${label}] ebitdaMargin out of range (${ratios.ebitdaMargin})`);
    }
  }
  if (ratios.patMargin !== null && ratios.patMargin !== undefined) {
    if (ratios.patMargin < -100 || ratios.patMargin > 100) {
      warnings.push(`[${label}] patMargin out of range (${ratios.patMargin})`);
    }
  }
  if (ratios.promoterHoldingPreIpo !== null && ratios.promoterHoldingPreIpo !== undefined) {
    if (ratios.promoterHoldingPreIpo < 0 || ratios.promoterHoldingPreIpo > 100) {
      warnings.push(`[${label}] promoterHoldingPreIpo out of range (${ratios.promoterHoldingPreIpo})`);
    }
  }
  if (ratios.promoterHoldingPostIpo !== null && ratios.promoterHoldingPostIpo !== undefined) {
    if (ratios.promoterHoldingPostIpo < 0 || ratios.promoterHoldingPostIpo > 100) {
      warnings.push(`[${label}] promoterHoldingPostIpo out of range (${ratios.promoterHoldingPostIpo})`);
    }
  }
  if (
    ratios.promoterHoldingPreIpo != null &&
    ratios.promoterHoldingPostIpo != null &&
    ratios.promoterHoldingPostIpo > ratios.promoterHoldingPreIpo
  ) {
    warnings.push(
      `[${label}] post-IPO promoter holding (${ratios.promoterHoldingPostIpo}) > pre-IPO (${ratios.promoterHoldingPreIpo}) — unusual`
    );
  }

  return { valid: warnings.length === 0, warnings };
}

module.exports = { extractRatiosFromUrl, validateRatios, FinancialRatioSchema };
