const axios = require('axios');

const INVESTORGAIN_LIST_URL = 'https://api.investorgain.com/api/v1/gmp/list';
const INVESTORGAIN_DETAIL_URL = 'https://api.investorgain.com/api/v1/gmp/detail';

// Fallback scrape URLs if API isn't available
const SCRAPE_LIST_URL = 'https://www.investorgain.com/report/live-ipo-gmp/331/';

/**
 * Normalize a company name for matching purposes.
 * @param {string} name
 * @returns {string}
 */
function normalizeName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/\b(limited|ltd\.?|ipo)\b/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fetch GMP snapshot list from InvestorGain.
 * Returns array of { companyName, gmp, price, estimatedListingPrice, lastUpdated }
 * @returns {Promise<Array>}
 */
async function fetchGmpList() {
  try {
    const response = await axios.get(INVESTORGAIN_LIST_URL, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; IPOScraper/1.0)',
        Accept: 'application/json',
      },
    });

    const data = response.data;
    const items = Array.isArray(data) ? data : (data.data || data.result || []);

    return items.map(item => ({
      companyName: item.company_name || item.name || item.companyName || null,
      gmp: parseFloat(item.gmp) || 0,
      price: parseFloat(item.price || item.issue_price) || null,
      estimatedListingPrice: parseFloat(item.estimated_listing || item.est_listing) || null,
      gmpPercent: parseFloat(item.gmp_percent || item.gmp_percentage) || null,
      lastUpdated: item.updated_at || item.last_updated || new Date().toISOString(),
    }));
  } catch (err) {
    console.warn(`[gmpCrawler] fetchGmpList failed: ${err.message}`);
    return [];
  }
}

/**
 * Fetch daily GMP history for a specific IPO from InvestorGain.
 * @param {string} companyName - Company name or slug
 * @param {string} [isin]      - ISIN for precise lookup
 * @returns {Promise<Array>}   Array of { date, gmp, gmpPercent }
 */
async function fetchGmpHistory(companyName, isin) {
  try {
    const params = {};
    if (isin) params.isin = isin;
    if (companyName) params.name = companyName;

    const response = await axios.get(INVESTORGAIN_DETAIL_URL, {
      params,
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; IPOScraper/1.0)',
        Accept: 'application/json',
      },
    });

    const data = response.data;
    const history = Array.isArray(data) ? data : (data.data || data.history || data.result || []);

    return history.map(item => ({
      date: item.date || item.updated_at || null,
      gmp: parseFloat(item.gmp) || 0,
      gmpPercent: parseFloat(item.gmp_percent || item.gmp_percentage) || null,
    }));
  } catch (err) {
    console.warn(`[gmpCrawler] fetchGmpHistory(${companyName}) failed: ${err.message}`);
    return [];
  }
}

/**
 * Match a GMP list entry to an IPO master record by company name similarity.
 * Uses simple normalized substring matching.
 * @param {object} gmpEntry  - { companyName, ... }
 * @param {Array}  ipoList   - Array of IPO master records
 * @returns {object|null}    Matched IPO record or null
 */
function matchGmpToIpo(gmpEntry, ipoList) {
  if (!gmpEntry.companyName) return null;
  const gmpNorm = normalizeName(gmpEntry.companyName);

  for (const ipo of ipoList) {
    const ipoNorm = normalizeName(ipo.companyName);
    if (!ipoNorm) continue;

    // Exact normalized match
    if (gmpNorm === ipoNorm) return ipo;

    // Substring match (one contains the other)
    if (gmpNorm.length >= 4 && ipoNorm.includes(gmpNorm)) return ipo;
    if (ipoNorm.length >= 4 && gmpNorm.includes(ipoNorm)) return ipo;
  }

  return null;
}

/**
 * Fetch GMP snapshot and detailed histories, then merge into IPO master records.
 * Mutates records in-place by adding gmp and gmpHistory fields.
 *
 * @param {Array} ipoRecords  - Array of IPO master records (from ipo_master.json)
 * @param {object} [options]
 * @param {boolean} [options.fetchHistory=true] - Whether to fetch per-IPO daily histories
 * @param {number} [options.historyDelayMs=200]  - Delay between history API calls
 * @returns {Promise<{ updated: number, skipped: number }>}
 */
async function crawlAndMergeGmp(ipoRecords, options = {}) {
  const { fetchHistory = true, historyDelayMs = 200 } = options;

  let updated = 0;
  let skipped = 0;

  // Step 1: Fetch snapshot list
  const gmpList = await fetchGmpList();
  console.log(`[gmpCrawler] Fetched ${gmpList.length} GMP snapshot entries`);

  // Step 2: Match each GMP entry to a master record and update snapshot
  for (const gmpEntry of gmpList) {
    const match = matchGmpToIpo(gmpEntry, ipoRecords);
    if (!match) {
      skipped++;
      continue;
    }

    match.gmp = {
      current: gmpEntry.gmp,
      gmpPercent: gmpEntry.gmpPercent,
      estimatedListingPrice: gmpEntry.estimatedListingPrice,
      lastUpdated: gmpEntry.lastUpdated,
    };
    updated++;
  }

  // Step 3: Optionally fetch per-IPO daily history for matched records
  if (fetchHistory) {
    for (const record of ipoRecords) {
      if (!record.gmp) continue;

      await new Promise(r => setTimeout(r, historyDelayMs));

      const history = await fetchGmpHistory(record.companyName, record.isin);
      if (history.length > 0) {
        record.gmpHistory = history;
      }
    }
  }

  return { updated, skipped };
}

module.exports = {
  fetchGmpList,
  fetchGmpHistory,
  matchGmpToIpo,
  crawlAndMergeGmp,
  normalizeName,
};
