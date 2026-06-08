const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const AdmZip = require('adm-zip');

const CACHE_DIR = path.join(__dirname, '..', 'pdf_cache');
const CACHE_INDEX = path.join(CACHE_DIR, 'cache_index.json');

// Gate: minimum pages to be considered a real prospectus
const MIN_PAGES = 3;

// Keywords that identify skip-worthy documents (in filename or first-page content)
const SKIP_KEYWORDS = ['corrigendum', 'addendum', 'notice', 'erratum', 'clarification'];
const ABRIDGED_KEYWORDS = ['abridged'];

// Filename priority keywords for picking the right PDF from a ZIP
const PRIORITY_KEYWORDS = ['rhp', 'drhp', 'fp', 'prospectus'];

/**
 * Load the cache index from disk (maps URL -> { filePath, etag, sha256, status })
 * @returns {object}
 */
function loadCacheIndex() {
  if (!fs.existsSync(CACHE_INDEX)) return {};
  try {
    return JSON.parse(fs.readFileSync(CACHE_INDEX, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Save the cache index to disk.
 * @param {object} index
 */
function saveCacheIndex(index) {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
  fs.writeFileSync(CACHE_INDEX, JSON.stringify(index, null, 2), 'utf8');
}

/**
 * Compute SHA-256 hash of a Buffer.
 * @param {Buffer} buf
 * @returns {string}
 */
function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Sanitize a URL into a safe local filename.
 * @param {string} url
 * @param {string} [ext='.pdf']
 * @returns {string}
 */
function urlToFilename(url, ext = '.pdf') {
  const hash = crypto.createHash('md5').update(url).digest('hex').slice(0, 12);
  const segment = url.split('/').pop().replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60);
  const base = segment.endsWith(ext) ? segment : `${segment}${ext}`;
  return `${hash}_${base}`;
}

/**
 * Check if a filename contains any of the given keywords (case-insensitive).
 * @param {string} name
 * @param {string[]} keywords
 * @returns {boolean}
 */
function hasKeyword(name, keywords) {
  const lower = name.toLowerCase();
  return keywords.some(k => lower.includes(k));
}

/**
 * Estimate page count from a PDF buffer by counting /Page occurrences.
 * Fast approximation — not 100% accurate but good enough for gate checks.
 * @param {Buffer} buf
 * @returns {number}
 */
function estimatePageCount(buf) {
  const str = buf.toString('latin1');
  // Count /Type /Page entries (not /Pages which is the catalog)
  const matches = str.match(/\/Type\s*\/Page[^s]/g);
  return matches ? matches.length : 0;
}

/**
 * Pick the best PDF entry from a ZIP file.
 * Priority: rhp/drhp/fp/prospectus in name → largest file
 * Skip: abridged
 * @param {AdmZip} zip
 * @returns {AdmZip.IZipEntry|null}
 */
function pickBestPdfFromZip(zip) {
  const entries = zip.getEntries().filter(e => {
    const name = e.entryName.toLowerCase();
    return name.endsWith('.pdf') && !e.isDirectory;
  });

  if (entries.length === 0) return null;

  // Filter out abridged
  const nonAbridged = entries.filter(e => !hasKeyword(e.entryName, ABRIDGED_KEYWORDS));
  const candidates = nonAbridged.length > 0 ? nonAbridged : entries;

  // Prefer priority keywords in filename
  const priority = candidates.filter(e => hasKeyword(e.entryName, PRIORITY_KEYWORDS));
  if (priority.length > 0) {
    // Among priority matches, pick largest
    return priority.sort((a, b) => b.header.size - a.header.size)[0];
  }

  // Fallback: largest file
  return candidates.sort((a, b) => b.header.size - a.header.size)[0];
}

/**
 * Gate check: is this buffer a real prospectus?
 * Returns { pass: boolean, reason: string }
 * @param {Buffer} buf
 * @param {string} filename
 * @returns {{ pass: boolean, reason: string }}
 */
function gateCheck(buf, filename) {
  // Gate 1: filename-based skip keywords
  if (hasKeyword(filename, SKIP_KEYWORDS)) {
    return { pass: false, reason: 'not_a_prospectus' };
  }

  // Gate 2: abridged check
  if (hasKeyword(filename, ABRIDGED_KEYWORDS)) {
    return { pass: false, reason: 'abridged_detected' };
  }

  // Gate 3: minimum page count
  // Only apply if we can detect page markers — 0 means compressed/encrypted PDF, pass through.
  const pages = estimatePageCount(buf);
  if (pages > 0 && pages < MIN_PAGES) {
    // Also check for abridged content marker in the PDF text
    const preview = buf.slice(0, 4096).toString('latin1').toLowerCase();
    if (preview.includes('abridged')) {
      return { pass: false, reason: 'abridged_detected' };
    }
    return { pass: false, reason: 'not_a_prospectus' };
  }

  // Gate 4: if exactly < 20 pages AND content says abridged → abridged
  if (pages < 20) {
    const preview = buf.slice(0, 8192).toString('latin1').toLowerCase();
    if (preview.includes('abridged')) {
      return { pass: false, reason: 'abridged_detected' };
    }
  }

  return { pass: true, reason: 'success' };
}

/**
 * Download a PDF (or ZIP containing a PDF) with full gate checks and caching.
 *
 * Returns:
 *   { status: 'success', filePath: string, sha256: string }
 *   { status: 'already_parsed', filePath: string }
 *   { status: 'download_failed', error: string }
 *   { status: 'not_a_prospectus', reason: string }
 *   { status: 'abridged_detected' }
 *   { status: 'no_pdf_in_zip' }
 *
 * @param {string} url  PDF or ZIP URL
 * @returns {Promise<object>}
 */
async function downloadPdf(url) {
  if (!url) return { status: 'download_failed', error: 'url is required' };

  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }

  const index = loadCacheIndex();
  const entry = index[url];

  // Already processed and passed gates — return cached path
  if (entry && entry.status === 'success' && entry.filePath && fs.existsSync(entry.filePath)) {
    return { status: 'already_parsed', filePath: entry.filePath };
  }

  // Already determined to be permanently skippable
  if (entry && ['not_a_prospectus', 'abridged_detected', 'no_pdf_in_zip'].includes(entry.status)) {
    return { status: entry.status };
  }

  const headers = { 'User-Agent': 'Mozilla/5.0 (compatible; IPOScraper/1.0)' };
  if (entry && entry.etag) {
    headers['If-None-Match'] = entry.etag;
  }

  let response;
  try {
    response = await axios.get(url, {
      responseType: 'arraybuffer',
      headers,
      maxRedirects: 5,
      timeout: 90000,
      validateStatus: s => s < 500,
    });
  } catch (err) {
    // Network failure — return cached file if available
    if (entry && entry.filePath && fs.existsSync(entry.filePath)) {
      console.warn(`[pdfDownloader] Network error, using cache: ${err.message}`);
      return { status: 'already_parsed', filePath: entry.filePath };
    }
    return { status: 'download_failed', error: err.message };
  }

  if (response.status === 304) {
    if (entry && entry.filePath && fs.existsSync(entry.filePath)) {
      return { status: 'already_parsed', filePath: entry.filePath };
    }
    // Cache file deleted — fall through to re-download
  }

  if (response.status !== 200) {
    if (entry && entry.filePath && fs.existsSync(entry.filePath)) {
      console.warn(`[pdfDownloader] HTTP ${response.status}, using cache`);
      return { status: 'already_parsed', filePath: entry.filePath };
    }
    return { status: 'download_failed', error: `HTTP ${response.status}` };
  }

  let buf = Buffer.from(response.data);
  const contentType = (response.headers['content-type'] || '').toLowerCase();
  const isZip = contentType.includes('zip') ||
    url.toLowerCase().endsWith('.zip') ||
    (buf[0] === 0x50 && buf[1] === 0x4B); // PK magic bytes

  let filename = url.split('/').pop().split('?')[0] || 'document';
  let pdfBuf = buf;

  if (isZip) {
    let zip;
    try {
      zip = new AdmZip(buf);
    } catch (err) {
      return { status: 'download_failed', error: `ZIP parse failed: ${err.message}` };
    }

    const best = pickBestPdfFromZip(zip);
    if (!best) {
      index[url] = { status: 'no_pdf_in_zip', checkedAt: new Date().toISOString() };
      saveCacheIndex(index);
      return { status: 'no_pdf_in_zip' };
    }

    filename = path.basename(best.entryName);
    pdfBuf = best.getData();
  }

  // Gate checks
  const gate = gateCheck(pdfBuf, filename);
  if (!gate.pass) {
    index[url] = { status: gate.reason, checkedAt: new Date().toISOString() };
    saveCacheIndex(index);
    return { status: gate.reason };
  }

  // Hash dedup — skip re-saving if content unchanged
  const hash = sha256(pdfBuf);
  if (entry && entry.sha256 === hash && entry.filePath && fs.existsSync(entry.filePath)) {
    const newEtag = response.headers['etag'] || entry.etag;
    if (newEtag !== entry.etag) {
      index[url] = { ...entry, etag: newEtag };
      saveCacheIndex(index);
    }
    return { status: 'already_parsed', filePath: entry.filePath };
  }

  // Save to disk
  const saveFilename = urlToFilename(url);
  const filePath = path.join(CACHE_DIR, saveFilename);
  fs.writeFileSync(filePath, pdfBuf);

  index[url] = {
    filePath,
    etag: response.headers['etag'] || null,
    sha256: hash,
    status: 'success',
    downloadedAt: new Date().toISOString(),
  };
  saveCacheIndex(index);

  return { status: 'success', filePath, sha256: hash };
}

module.exports = { downloadPdf, loadCacheIndex, urlToFilename, pickBestPdfFromZip, gateCheck };
