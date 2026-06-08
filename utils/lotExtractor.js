'use strict';

/**
 * lotExtractor.js
 * Extract IPO lot size / application table from a PDF.
 * 
 * This table follows a SEBI-mandated standard format found in every IPO
 * prospectus under "Issue Procedure" or "Terms of the Offer".
 */

/**
 * Parse the lot/application table from raw markdown text.
 * Looks for standard patterns:
 *   Retail (Min) / Retail (Max) / S-HNI (Min) / S-HNI (Max) / B-HNI (Min) / B-HNI (Max)
 *   followed by: lot_number  share_count  ₹amount
 *
 * @param {string} text - Raw markdown text from a section
 * @returns {object|null} { lotSize: number, applications: [...] }
 */
function extractLotTable(text) {
  const result = { applications: [] };

  // First try to find minimum lot size from patterns like:
  // "minimum of 333 shares" or "lot of 333 shares" or "333 shares per lot"
  const lotMatch = text.match(/(?:minimum\s+(?:of\s+)?|lot\s+(?:of\s+)?)?(\d{2,5})\s*(?:equity\s+)?shares\b/i);
  if (lotMatch) {
    result.lotSize = parseInt(lotMatch[1], 10);
  }

  // Find the application table rows
  // Pattern: Category (Min|Max)  lots  shares  ₹amount
  const categories = ['Retail', 'S-HNI', 'B-HNI', 'HNI'];
  const types = ['Min', 'Max'];

  for (const cat of categories) {
    for (const type of types) {
      // Look for patterns like:
      // "Retail (Min)  1  333  ₹14,985"
      // "Retail (Min)\n1\n333\n14,985"
      const re = new RegExp(
        `${cat}\\s*\\(?${type}\\)?[^\\d]*(\\d+)[^\\d]*(\\d{1,3}(?:,\\d{3})*)[^\\d]*(?:₹|Rs\\.?\\s*)?(\\d{1,3}(?:,\\d{3})*)`,
        'i'
      );
      const m = text.match(re);
      if (m) {
        result.applications.push({
          category: cat,
          type,
          lots: parseInt(m[1], 10),
          shares: parseInt(m[2].replace(/,/g, ''), 10),
          amount: parseInt(m[3].replace(/,/g, ''), 10),
        });
      }
    }
  }

  if (result.applications.length === 0 && !result.lotSize) return null;

  return result;
}

/**
 * Extract lot data from a PDF file by scanning relevant sections.
 * @param {string} sectionMdPath - Path to the ISSUE_PROCEDURE or ISSUE_STRUCTURE markdown
 * @returns {Promise<object|null>}
 */
async function extractLotFromFile(sectionMdPath) {
  const fs = require('fs');
  if (!fs.existsSync(sectionMdPath)) return null;
  const text = fs.readFileSync(sectionMdPath, 'utf8');
  return extractLotTable(text);
}

module.exports = { extractLotTable, extractLotFromFile };
