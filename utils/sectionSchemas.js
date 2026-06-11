'use strict';

/**
 * sectionSchemas.js — JSON schemas + prompts for Firecrawl /v2/parse fallback.
 *
 * Each section has:
 *   pageKey     — key used in DB's sectionPages map (e.g. "financials", "kpis")
 *   schema      — JSON Schema the Firecrawl LLM fills
 *   prompt      — instructions for extraction, currency, comma format, etc.
 *
 * To add a new section: just add an entry below. That's it.
 */

const SECTIONS = {

  financials: {
    shortName: 'financials',
    pageKey: 'financials',
    schema: {
      type: 'object',
      required: ['companyName', 'periods', 'metrics'],
      properties: {
        companyName: { type: 'string', description: 'Company name from the prospectus' },
        currencyUnit: { type: 'string', description: 'e.g. INR in Thousands, ₹ in Lakhs' },
        periods: {
          type: 'array',
          description: 'All fiscal periods in the restated financials, most recent first',
          items: {
            type: 'object',
            required: ['label', 'endDate'],
            properties: {
              label: { type: 'string', description: 'e.g. Dec 2025, Mar 2025, Mar 2024' },
              endDate: { type: 'string', description: 'ISO date YYYY-MM-DD' },
            },
          },
        },
        metrics: {
          type: 'array',
          description: 'Financial line items with values aligned to periods',
          items: {
            type: 'object',
            required: ['key', 'values'],
            properties: {
              key: {
                type: 'string',
                enum: [
                  'revenueFromOperations', 'totalIncome', 'ebitda', 'profitAfterTax',
                  'netWorth', 'totalBorrowings', 'basicEPS', 'dilutedEPS', 'ronw', 'netAssetValue',
                ],
              },
              values: {
                type: 'array',
                items: { type: 'number' },
                description: 'One value per period, same order as periods array. Use null if not available.',
              },
              page: { type: 'number', description: 'Page number where this row appears' },
            },
          },
        },
      },
    },
    prompt: `Extract the RESTATED FINANCIAL STATEMENTS (balance sheet, P&L, cash flow) from this IPO prospectus section.
The data is for ACCORD TRANSFORMER & SWITCHGEAR LIMITED or similar SME IPO.

Rules:
- Parse Indian number format correctly: "1,50,112.89" = 150112.89
- Values are in ₹ Thousands unless stated otherwise
- Align all metric values 1:1 with periods, same order
- Revenue = "Revenue from Operations" or "Revenue From Operations"
- PAT = "Profit for the period" or "Profit After Tax" or "Net Profit"
- EBITDA = operating profit, or derive from PBT + Depreciation + Finance Cost if not explicitly stated
- Net Worth = Share Capital + Reserves & Surplus
- Total Borrowings = Long-term + Short-term borrowings
- Include ALL periods shown (typically 3-4 periods)
- Use null for any metric not found`,
  },

  kpis: {
    shortName: 'kpis',
    pageKey: 'kpis',
    schema: {
      type: 'object',
      required: ['periods', 'kpis'],
      properties: {
        periods: {
          type: 'array',
          items: {
            type: 'object',
            required: ['label', 'endDate'],
            properties: {
              label: { type: 'string' },
              endDate: { type: 'string' },
            },
          },
        },
        kpis: {
          type: 'array',
          items: {
            type: 'object',
            required: ['key', 'values'],
            properties: {
              key: {
                type: 'string',
                enum: [
                  'roce', 'ronw', 'roe', 'debtEquity',
                  'ebitdaMargin', 'patMargin', 'grossMargin',
                  'priceToBook', 'currentRatio', 'nav', 'eps',
                ],
              },
              values: {
                type: 'array',
                items: { type: 'number' },
                description: 'One per period, same order. null if missing.',
              },
            },
          },
        },
      },
    },
    prompt: `Extract KEY PERFORMANCE INDICATORS / ACCOUNTING RATIOS from this IPO prospectus section.

Rules:
- Parse Indian format: "11.91%" = 11.91
- ROCE = Return on Capital Employed (%)
- RONW or RoNW = Return on Net Worth (%)
- ROE = Return on Equity (%)
- Debt Equity ratio = Debt / Equity (in times)
- Current Ratio = Current Assets / Current Liabilities (in times)
- NAV = Net Asset Value per share (₹)
- EPS = Earnings Per Share (₹)
- All values aligned 1:1 with periods, same order
- Use null for missing values`,
  },

  objectsOfIssue: {
    shortName: 'objectsOfIssue',
    pageKey: 'objects-of-issue',
    schema: {
      type: 'object',
      required: ['objects'],
      properties: {
        objects: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name'],
            properties: {
              name: { type: 'string', description: 'Object name/description' },
              amount: { type: 'number', description: 'Amount in Lakhs (Indian unit). null if [●]' },
            },
          },
        },
        total: { type: 'number', description: 'Total amount in Lakhs' },
        unit: { type: 'string', enum: ['Lakhs', 'Crore'] },
      },
    },
    prompt: `Extract the OBJECTS OF THE ISSUE / USE OF PROCEEDS table from this prospectus section.

Rules:
- Parse Indian number format: "2,000.00" = 2000.00
- Amounts are typically in ₹ Lakhs
- Skip header rows and total rows (capture total separately)
- For amounts shown as [●] or placeholder, use null
- Include general corporate purpose if listed
- Return amount in Lakhs (divide by 100 if the table says Crore)`,
  },

  issueDetails: {
    shortName: 'issueDetails',
    pageKey: null, // issue details span cover + multiple tables, no single section
    schema: {
      type: 'object',
      required: ['totalIssueShares', 'freshIssueShares', 'ofsShares'],
      properties: {
        totalIssueShares: { type: 'number', description: 'Total issue size in shares' },
        freshIssueShares: { type: 'number', description: 'Fresh issue portion in shares' },
        ofsShares: { type: 'number', description: 'Offer for Sale portion in shares' },
        marketMakerShares: { type: 'number', description: 'Market maker reservation' },
        employeeReservationShares: { type: 'number', description: 'Employee reservation' },
        netOfferShares: { type: 'number', description: 'Net offer to public' },
        preIssueShares: { type: 'number', description: 'Shares outstanding before the issue' },
        postIssueShares: { type: 'number', description: 'Shares outstanding after the issue' },
        marketMakerName: { type: 'string', description: 'Name of the market maker' },
        issueType: { type: 'string', enum: ['Bookbuilding', 'Fixed Price'] },
        listingAt: { type: 'string', description: 'e.g. BSE SME, NSE, BSE' },
      },
    },
    prompt: `Extract IPO ISSUE STRUCTURE from the offer details / terms of the issue section.

Rules:
- Parse Indian number format: "1,00,00,000" = 10000000
- Total Issue = Fresh Issue + OFS
- For SME: Fresh = Market Maker + Employee Reservation + Net Offer
- Pre + Fresh = Post
- All values in number of shares (not ₹ amounts)
- Use null for fields not found`,
  },

};

/** Get section config by short name. */
function getSection(shortName) {
  return SECTIONS[shortName] || null;
}

/** List all section short names that have page ranges (can be sliced). */
function getSliceableSections() {
  return Object.values(SECTIONS).filter((s) => s.pageKey != null && s.shortName !== 'issueDetails');
}

module.exports = { SECTIONS, getSection, getSliceableSections };
