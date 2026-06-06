const fs = require('fs');
const path = require('path');
const { uploadToR2, loadUploadCache } = require('./r2Uploader.js');
const { extractRatiosFromUrl, validateRatios } = require('./firecrawlExtractor.js');
const { writeAtomicSync } = require('./atomicWrite.js');

const MASTER_PATH = path.join(__dirname, '..', 'ipo_master.json');

/**
 * Load ipo_master.json. Returns empty array if file doesn't exist.
 * @returns {Array}
 */
function loadMaster() {
  if (!fs.existsSync(MASTER_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(MASTER_PATH, 'utf8'));
  } catch {
    return [];
  }
}

/**
 * Merge extracted financial ratios into a master record in-place.
 * Ratios are stored under record.financialRatios.
 *
 * @param {object} record  IPO master record (mutated in place)
 * @param {object} ratios  Extracted ratios from firecrawlExtractor
 * @returns {object} Updated record
 */
function mergeRatiosIntoRecord(record, ratios) {
  // Strip out null/undefined values to keep the master clean
  const cleaned = Object.fromEntries(
    Object.entries(ratios).filter(([, v]) => v !== null && v !== undefined)
  );

  record.financialRatios = {
    ...(record.financialRatios || {}),
    ...cleaned,
    extractedAt: new Date().toISOString(),
  };

  return record;
}

/**
 * Process a single IPO record:
 *  1. Find a sliced markdown file for the record
 *  2. Upload it to R2 if not already cached
 *  3. Extract ratios via Firecrawl
 *  4. Validate ratios
 *  5. Return { isin, ratios, warnings, publicUrl }
 *
 * @param {object} record     IPO master record
 * @param {string} sliceDir   Directory containing pre-generated slice markdown files
 * @param {object} [options]
 * @param {boolean} [options.dryRun]  If true, skip actual Firecrawl call
 * @returns {Promise<object>}
 */
async function processRecord(record, sliceDir, options = {}) {
  const isin = record.isin || record.companyName || 'unknown';

  // Find slice markdown files for this record
  // Convention: {sliceDir}/{isin}_{section}.md or {isin}.md
  const safeIsin = (isin).replace(/[^a-zA-Z0-9]/g, '_');
  const candidates = [];

  if (fs.existsSync(sliceDir)) {
    for (const f of fs.readdirSync(sliceDir)) {
      if (f.startsWith(safeIsin) && f.endsWith('.md')) {
        candidates.push(path.join(sliceDir, f));
      }
    }
  }

  if (candidates.length === 0) {
    return { isin, ratios: null, warnings: [`No slice markdown found in ${sliceDir} for ${isin}`], publicUrl: null };
  }

  // Use first candidate (could extend to merge multiple sections)
  const sliceMdPath = candidates[0];
  const sliceContent = fs.readFileSync(sliceMdPath, 'utf8');

  // Upload to R2
  const r2Key = `ipo-slices/${safeIsin}/${path.basename(sliceMdPath)}`;
  const uploadResult = await uploadToR2(sliceContent, r2Key, 'text/markdown');
  const publicUrl = uploadResult.publicUrl;

  if (options.dryRun) {
    return { isin, ratios: null, warnings: ['dryRun: skipped Firecrawl extraction'], publicUrl };
  }

  // Extract ratios
  const ratios = await extractRatiosFromUrl(publicUrl);
  const { warnings } = validateRatios(ratios, isin);

  if (warnings.length > 0) {
    warnings.forEach(w => console.warn(w));
  }

  return { isin, ratios, warnings, publicUrl };
}

/**
 * Main extraction pipeline:
 *  1. Load ipo_master.json
 *  2. For each record with document slices, extract ratios
 *  3. Merge ratios back into master
 *  4. Atomically save ipo_master.json
 *
 * @param {string} sliceDir    Directory containing pre-sliced markdown files
 * @param {object} [options]
 * @param {boolean} [options.dryRun]  Skip Firecrawl calls
 * @param {string}  [options.isin]    Process only one specific ISIN
 * @returns {Promise<{ processed: number, skipped: number, errors: number }>}
 */
async function runExtractionPipeline(sliceDir, options = {}) {
  const records = loadMaster();

  if (records.length === 0) {
    console.log('[extraction] No records in ipo_master.json');
    return { processed: 0, skipped: 0, errors: 0 };
  }

  let processed = 0;
  let skipped = 0;
  let errors = 0;

  for (const record of records) {
    // Filter to specific ISIN if requested
    if (options.isin && record.isin !== options.isin) continue;

    // Skip if already extracted (unless force flag)
    if (record.financialRatios && !options.force) {
      skipped++;
      continue;
    }

    try {
      const result = await processRecord(record, sliceDir, options);
      if (result.ratios) {
        mergeRatiosIntoRecord(record, result.ratios);
        processed++;
        console.log(`[extraction] ✓ ${result.isin} — extracted ${Object.keys(result.ratios).length} fields`);
      } else {
        skipped++;
        if (result.warnings.length > 0) {
          console.warn(`[extraction] skip ${result.isin}: ${result.warnings[0]}`);
        }
      }
    } catch (err) {
      errors++;
      console.error(`[extraction] ✗ ${record.isin || record.companyName}: ${err.message}`);
    }
  }

  // Persist updated master
  writeAtomicSync(MASTER_PATH, records);
  console.log(`[extraction] Done. processed=${processed} skipped=${skipped} errors=${errors}`);

  return { processed, skipped, errors };
}

module.exports = {
  loadMaster,
  mergeRatiosIntoRecord,
  processRecord,
  runExtractionPipeline,
};
