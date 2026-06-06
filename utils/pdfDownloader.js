const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');

const CACHE_DIR = path.join(__dirname, '..', 'pdf_cache');
const CACHE_INDEX = path.join(CACHE_DIR, 'cache_index.json');

/**
 * Load the cache index from disk (maps URL -> { filePath, etag, sha256 })
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
 * Sanitize a URL into a safe local filename with .pdf extension.
 * @param {string} url
 * @returns {string}
 */
function urlToFilename(url) {
  const hash = crypto.createHash('md5').update(url).digest('hex').slice(0, 12);
  // Extract last segment for readability
  const segment = url.split('/').pop().replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60);
  const base = segment.endsWith('.pdf') ? segment : `${segment}.pdf`;
  return `${hash}_${base}`;
}

/**
 * Download a PDF from the given URL with ETag caching.
 * - If a cached file exists and the server returns 304 Not Modified, return the cached path.
 * - If the content hash matches, skip re-saving.
 * - Otherwise download fresh and cache.
 *
 * @param {string} url PDF URL to download
 * @returns {Promise<string>} Absolute local path to the cached PDF file
 */
async function downloadPdf(url) {
  if (!url) throw new Error('downloadPdf: url is required');

  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }

  const index = loadCacheIndex();
  const entry = index[url];

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
      timeout: 60000,
      validateStatus: (s) => s < 500
    });
  } catch (err) {
    // If we have a cached copy, return it on network failure
    if (entry && entry.filePath && fs.existsSync(entry.filePath)) {
      console.warn(`[pdfDownloader] Network error for ${url}, using cached file: ${err.message}`);
      return entry.filePath;
    }
    throw err;
  }

  // 304 Not Modified — cached file is still valid
  if (response.status === 304) {
    if (entry && entry.filePath && fs.existsSync(entry.filePath)) {
      return entry.filePath;
    }
    // Cache entry exists but file was deleted — fall through to re-download
  }

  if (response.status !== 200) {
    // If we have a cache, use it rather than crashing
    if (entry && entry.filePath && fs.existsSync(entry.filePath)) {
      console.warn(`[pdfDownloader] HTTP ${response.status} for ${url}, using cached file`);
      return entry.filePath;
    }
    throw new Error(`downloadPdf: HTTP ${response.status} for ${url}`);
  }

  const buf = Buffer.from(response.data);
  const hash = sha256(buf);

  // If hash matches, no need to re-write
  if (entry && entry.sha256 === hash && entry.filePath && fs.existsSync(entry.filePath)) {
    // Update etag if it changed
    const newEtag = response.headers['etag'] || entry.etag;
    if (newEtag !== entry.etag) {
      index[url] = { ...entry, etag: newEtag };
      saveCacheIndex(index);
    }
    return entry.filePath;
  }

  const filename = urlToFilename(url);
  const filePath = path.join(CACHE_DIR, filename);
  fs.writeFileSync(filePath, buf);

  index[url] = {
    filePath,
    etag: response.headers['etag'] || null,
    sha256: hash,
    downloadedAt: new Date().toISOString()
  };
  saveCacheIndex(index);

  return filePath;
}

module.exports = { downloadPdf, loadCacheIndex, urlToFilename };
