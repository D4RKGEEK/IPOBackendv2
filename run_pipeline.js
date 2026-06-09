'use strict';

require('dotenv').config();

const path = require('path');
const { fetchUpstoxIpos } = require('./utils/upstox.js');
const { fetchNseIpos } = require('./utils/nse.js');
const { fetchGrowwIpos } = require('./utils/groww.js');
const { fetchZerodhaIpos } = require('./utils/zerodha.js');
const { jaroWinkler } = require('./utils/jaroWinkler.js');
const { writeAtomicSync } = require('./utils/atomicWrite.js');
const { normalizeCompanyName, normalizeSymbol, parseIndianDate } = require('./utils/normalizers.js');
const { applyTimeline } = require('./utils/timelineBuilder.js');

const MASTER_PATH = path.join(__dirname, 'ipo_master.json');
const BORDERLINE_PATH = path.join(__dirname, 'ipo_borderline.json');
const JARO_THRESHOLD = 0.90;

// ─── Date helpers ────────────────────────────────────────────────────────────

/**
 * Returns true if the absolute difference between two date strings is <= 30 days.
 * @param {string|null} dateStr1
 * @param {string|null} dateStr2
 * @returns {boolean}
 */
function areDatesWithin30Days(dateStr1, dateStr2) {
  if (!dateStr1 || !dateStr2) return false;
  const d1 = parseIndianDate(dateStr1);
  const d2 = parseIndianDate(dateStr2);
  if (!d1 || !d2) return false;
  const diffMs = Math.abs(d1.getTime() - d2.getTime());
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays <= 30;
}

/**
 * Returns true if a date string falls within the requested range.
 * Priority: --from/--to range check first, then --year check.
 * @param {string|null} dateStr
 * @param {string|null} fromStr  YYYY-MM-DD or null
 * @param {string|null} toStr    YYYY-MM-DD or null
 * @param {number|null} year
 * @returns {boolean}
 */
function isWithinDateRange(dateStr, fromStr, toStr, year) {
  if (!dateStr) return false;
  const d = parseIndianDate(dateStr);
  if (!d) return false;

  if (fromStr && toStr) {
    const from = parseIndianDate(fromStr);
    const to = parseIndianDate(toStr);
    if (!from || !to) return false;
    return d >= from && d <= to;
  }

  if (fromStr) {
    const from = parseIndianDate(fromStr);
    if (!from) return false;
    return d >= from;
  }

  if (toStr) {
    const to = parseIndianDate(toStr);
    if (!to) return false;
    return d <= to;
  }

  if (year) {
    return d.getFullYear() === year;
  }

  return true;
}

// ─── Merge helpers ────────────────────────────────────────────────────────────

/**
 * Merges two standardized IPO records applying source-precedence rules:
 *   - NSE: biddingStartDate, documentUrls
 *   - Upstox: priceBand (and other numeric fields preserved from upstox raw)
 *   - companyName / status: first record (typically Upstox) wins if present
 * @param {object} rec1  First record (Upstox-origin or whichever was seen first)
 * @param {object} rec2  Second record (NSE-origin or whichever was seen second)
 * @returns {object}
 */
function mergeRecordPair(rec1, rec2) {
  // Determine which record is nse-origin and which is upstox-origin
  const nseRec   = rec2.raw_sources && rec2.raw_sources.nse   ? rec2
                 : rec1.raw_sources && rec1.raw_sources.nse   ? rec1
                 : null;
  const upstoxRec = rec1.raw_sources && rec1.raw_sources.upstox ? rec1
                  : rec2.raw_sources && rec2.raw_sources.upstox ? rec2
                  : null;

  // Prefer non-null values; use precedence rules where both have values
  const merged = {
    isin:             rec1.isin || rec2.isin,
    symbol:           rec1.symbol || rec2.symbol,
    // companyName: first record wins (shorter/cleaner name tends to come from Upstox)
    companyName:      rec1.companyName || rec2.companyName,
    // status: first record wins
    status:           rec1.status || rec2.status,
    // NSE takes precedence for dates
    biddingStartDate: (nseRec && nseRec.biddingStartDate)
                        ? nseRec.biddingStartDate
                        : (upstoxRec && upstoxRec.biddingStartDate)
                        ? upstoxRec.biddingStartDate
                        : rec1.biddingStartDate || rec2.biddingStartDate,
    // Upstox takes precedence for price band
    priceBand: (upstoxRec && upstoxRec.priceBand && upstoxRec.priceBand.minimum != null)
                 ? upstoxRec.priceBand
                 : (nseRec && nseRec.priceBand)
                 ? nseRec.priceBand
                 : rec1.priceBand || rec2.priceBand,
    // NSE takes precedence for document URLs (official exchange docs)
    documentUrls: {
      rhp:  (nseRec && nseRec.documentUrls && nseRec.documentUrls.rhp)
              ? nseRec.documentUrls.rhp
              : (rec1.documentUrls && rec1.documentUrls.rhp) || (rec2.documentUrls && rec2.documentUrls.rhp) || null,
      drhp: (nseRec && nseRec.documentUrls && nseRec.documentUrls.drhp)
              ? nseRec.documentUrls.drhp
              : (rec1.documentUrls && rec1.documentUrls.drhp) || (rec2.documentUrls && rec2.documentUrls.drhp) || null,
    },
    // Merge raw_sources from both
    raw_sources: {
      ...(rec1.raw_sources || {}),
      ...(rec2.raw_sources || {}),
    },
  };

  // Carry over listingDate if present on either record
  if (rec1.listingDate || rec2.listingDate) {
    merged.listingDate = rec1.listingDate || rec2.listingDate;
  }

  // Carry over existing timeline and statusHistory — applyTimeline runs after
  // final dedup, so here we just preserve whichever record already has them
  if (rec1.timeline || rec2.timeline) {
    merged.timeline = rec1.timeline || rec2.timeline;
  }
  if (rec1.statusHistory || rec2.statusHistory) {
    merged.statusHistory = rec1.statusHistory || rec2.statusHistory;
  }

  return merged;
}

// ─── Deduplication ────────────────────────────────────────────────────────────

/**
 * Merges an array of standardized IPO records from multiple sources into a
 * deduplicated master list using the hierarchical matching strategy (D-01).
 *
 * Match priority:
 *   1. Exact ISIN match
 *   2. Normalized symbol match
 *   3. Jaro-Winkler company name similarity > 0.90 AND dates within 30 days
 *
 * Borderline entries (fuzzy score > 0.85 but < 0.90, or date guard failed) are
 * logged separately for human review.
 *
 * @param {object[]} records
 * @returns {{ master: object[], borderline: object[] }}
 */
function deduplicateRecords(records) {
  const master = [];
  const borderline = [];

  for (const incoming of records) {
    let matched = false;

    for (let i = 0; i < master.length; i++) {
      const existing = master[i];

      // Match 1: ISIN
      if (incoming.isin && existing.isin && incoming.isin === existing.isin) {
        master[i] = mergeRecordPair(existing, incoming);
        matched = true;
        break;
      }

      // Match 2: Normalized symbol
      const inSym = normalizeSymbol(incoming.symbol);
      const exSym = normalizeSymbol(existing.symbol);
      if (inSym && exSym && inSym === exSym) {
        master[i] = mergeRecordPair(existing, incoming);
        matched = true;
        break;
      }

      // Match 3: Jaro-Winkler + 30-day date guard
      const inName = normalizeCompanyName(incoming.companyName);
      const exName = normalizeCompanyName(existing.companyName);
      if (inName && exName) {
        const score = jaroWinkler(inName, exName);
        if (score >= JARO_THRESHOLD) {
          if (areDatesWithin30Days(incoming.biddingStartDate, existing.biddingStartDate)) {
            master[i] = mergeRecordPair(existing, incoming);
            matched = true;
            break;
          } else {
            // Fuzzy name match but dates too far apart — borderline
            borderline.push({
              reason: 'fuzzy_name_match_date_guard_failed',
              score,
              record1: existing,
              record2: incoming,
            });
          }
        } else if (score >= 0.85) {
          // Near-miss — flag for human review
          borderline.push({
            reason: 'near_miss_below_threshold',
            score,
            record1: existing,
            record2: incoming,
          });
        }
      }
    }

    if (!matched) {
      master.push(incoming);
    }
  }

  // Apply timeline + statusHistory to every deduplicated record
  const timedMaster = master.map(rec => applyTimeline(rec));

  return { master: timedMaster, borderline };
}

// ─── CLI argument parsing ─────────────────────────────────────────────────────

/**
 * Parses process.argv for --year, --from, --to flags.
 * Validates year as 4-digit number and dates as YYYY-MM-DD.
 * Defaults to current calendar year if no args provided.
 * @returns {{ year: number|null, fromStr: string|null, toStr: string|null }}
 */
function parseCliArgs(argv) {
  const args = argv.slice(2);
  let year = null;
  let fromStr = null;
  let toStr = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--year' && args[i + 1]) {
      const y = parseInt(args[++i], 10);
      if (isNaN(y) || y < 1900 || y > 2100) {
        throw new Error(`Invalid --year value: ${args[i]}`);
      }
      year = y;
    } else if (args[i] === '--from' && args[i + 1]) {
      const v = args[++i];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        throw new Error(`Invalid --from date format (expected YYYY-MM-DD): ${v}`);
      }
      fromStr = v;
    } else if (args[i] === '--to' && args[i + 1]) {
      const v = args[++i];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        throw new Error(`Invalid --to date format (expected YYYY-MM-DD): ${v}`);
      }
      toStr = v;
    }
  }

  // Default to current year if nothing specified
  if (!year && !fromStr && !toStr) {
    year = new Date().getFullYear();
  }

  return { year, fromStr, toStr };
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

/**
 * Main pipeline controller. Fetches from Upstox + NSE, deduplicates, filters
 * by date range, and atomically writes ipo_master.json.
 * @param {object} opts  { year, fromStr, toStr }
 * @returns {Promise<{ master: object[], borderline: object[] }>}
 */
async function runPipeline({ year, fromStr, toStr } = {}) {
  console.log(`[pipeline] Starting ingestion (year=${year || 'all'}, from=${fromStr || '-'}, to=${toStr || '-'})`);

  // Determine date window for NSE past-IPO fetch
  let nseFrom, nseTo;
  if (fromStr && toStr) {
    nseFrom = parseIndianDate(fromStr);
    nseTo   = parseIndianDate(toStr);
  } else if (year) {
    nseFrom = new Date(year, 0, 1);
    nseTo   = new Date(year, 11, 31);
  } else {
    nseFrom = new Date('2022-01-01');
    nseTo   = new Date();
  }

  // Fetch from all sources in parallel
  let upstoxRecords = [];
  let nseRecords = [];
  let growwRecords = [];
  let zerodhaRecords = [];

  const [upstoxResult, nseResult, growwResult, zerodhaResult] = await Promise.allSettled([
    fetchUpstoxIpos(),
    fetchNseIpos(__dirname, nseFrom, nseTo),
    fetchGrowwIpos(),
    fetchZerodhaIpos(),
  ]);

  if (upstoxResult.status === 'fulfilled') {
    upstoxRecords = upstoxResult.value;
    console.log(`[pipeline] Upstox: fetched ${upstoxRecords.length} records`);
  } else {
    console.error(`[pipeline] Upstox fetch failed: ${upstoxResult.reason.message}`);
  }

  if (nseResult.status === 'fulfilled') {
    nseRecords = nseResult.value;
    console.log(`[pipeline] NSE: fetched ${nseRecords.length} records`);
  } else {
    console.error(`[pipeline] NSE fetch failed: ${nseResult.reason.message}`);
  }

  if (growwResult.status === 'fulfilled') {
    growwRecords = growwResult.value;
    console.log(`[pipeline] Groww: fetched ${growwRecords.length} records`);
  } else {
    console.error(`[pipeline] Groww fetch failed: ${growwResult.reason.message}`);
  }

  if (zerodhaResult.status === 'fulfilled') {
    zerodhaRecords = zerodhaResult.value;
    console.log(`[pipeline] Zerodha: fetched ${zerodhaRecords.length} records`);
  } else {
    console.error(`[pipeline] Zerodha fetch failed: ${zerodhaResult.reason.message}`);
  }

  const allRecords = [...upstoxRecords, ...nseRecords, ...growwRecords, ...zerodhaRecords];
  console.log(`[pipeline] Total raw records: ${allRecords.length}`);

  // Deduplicate
  const { master, borderline } = deduplicateRecords(allRecords);
  console.log(`[pipeline] After dedup: ${master.length} unique records, ${borderline.length} borderline`);

  // Filter by date range
  const filtered = master.filter(r =>
    isWithinDateRange(r.biddingStartDate, fromStr, toStr, year)
  );
  console.log(`[pipeline] After date filter: ${filtered.length} records`);

  // Persist atomically
  writeAtomicSync(MASTER_PATH, filtered);
  console.log(`[pipeline] Written: ${MASTER_PATH}`);

  if (borderline.length > 0) {
    writeAtomicSync(BORDERLINE_PATH, borderline);
    console.log(`[pipeline] Borderline written: ${BORDERLINE_PATH}`);
  }

  return { master: filtered, borderline };
}

// ─── Entry point ──────────────────────────────────────────────────────────────

if (require.main === module) {
  (async () => {
    try {
      const opts = parseCliArgs(process.argv);
      await runPipeline(opts);
      console.log('[pipeline] Done.');
    } catch (err) {
      console.error('[pipeline] Fatal error:', err.message);
      process.exit(1);
    }
  })();
}

module.exports = {
  runPipeline,
  deduplicateRecords,
  mergeRecordPair,
  areDatesWithin30Days,
  isWithinDateRange,
  parseCliArgs,
};
