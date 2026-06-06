const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { writeAtomicSync } = require('./atomicWrite.js');

/**
 * Build an S3Client pointing at Cloudflare R2.
 * Reads CF_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY from process.env.
 * @returns {S3Client}
 */
function buildR2Client() {
  const accountId = process.env.CF_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('r2Uploader: missing CF_ACCOUNT_ID, R2_ACCESS_KEY_ID, or R2_SECRET_ACCESS_KEY');
  }

  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

/**
 * Load the upload state cache from disk.
 * Cache is a JSON object mapping r2Key -> publicUrl.
 * @param {string} cacheFile Absolute path to the JSON cache file
 * @returns {object}
 */
function loadUploadCache(cacheFile) {
  if (fs.existsSync(cacheFile)) {
    try {
      return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Save the upload state cache atomically to disk.
 * @param {string} cacheFile Absolute path to the JSON cache file
 * @param {object} cache     Cache object to persist
 */
function saveUploadCache(cacheFile, cache) {
  writeAtomicSync(cacheFile, cache);
}

/**
 * Derive the public URL for an R2 key.
 * Uses R2_PUBLIC_BASE_URL env var or falls back to the R2 endpoint URL.
 * @param {string} bucket R2 bucket name
 * @param {string} r2Key  Object key in R2
 * @returns {string}
 */
function buildPublicUrl(bucket, r2Key) {
  const base = process.env.R2_PUBLIC_BASE_URL;
  if (base) {
    return `${base.replace(/\/$/, '')}/${r2Key}`;
  }
  const accountId = process.env.CF_ACCOUNT_ID;
  return `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${r2Key}`;
}

/**
 * Upload a local file to R2, caching the result to avoid redundant uploads.
 * If the key already exists in the local cache, returns the cached URL.
 * @param {object} options
 * @param {string} options.localPath   Absolute path to the local file
 * @param {string} options.r2Key       Object key in R2 (e.g. 'ipos/INE123/objects.md')
 * @param {string} [options.bucket]    R2 bucket name (defaults to R2_BUCKET_NAME env var)
 * @param {string} [options.cacheFile] Path to upload state JSON cache
 * @param {string} [options.contentType] MIME type (default: 'text/markdown; charset=utf-8')
 * @returns {Promise<string>} Public URL of the uploaded object
 */
async function uploadToR2({ localPath, r2Key, bucket, cacheFile, contentType }) {
  const bucketName = bucket || process.env.R2_BUCKET_NAME;
  if (!bucketName) {
    throw new Error('r2Uploader: R2_BUCKET_NAME not set and no bucket param provided');
  }

  const resolvedCache = cacheFile || path.join(path.dirname(localPath), 'r2_upload_cache.json');
  const cache = loadUploadCache(resolvedCache);

  // Return cached URL if already uploaded
  if (cache[r2Key]) {
    return cache[r2Key];
  }

  const client = buildR2Client();
  const fileBuffer = fs.readFileSync(localPath);
  const mimeType = contentType || 'text/markdown; charset=utf-8';

  await client.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: r2Key,
    Body: fileBuffer,
    ContentType: mimeType,
  }));

  const publicUrl = buildPublicUrl(bucketName, r2Key);
  cache[r2Key] = publicUrl;
  saveUploadCache(resolvedCache, cache);

  return publicUrl;
}

/**
 * Check whether an R2 object exists (HEAD request).
 * @param {string} bucket  R2 bucket name
 * @param {string} r2Key   Object key in R2
 * @returns {Promise<boolean>}
 */
async function existsInR2(bucket, r2Key) {
  try {
    const client = buildR2Client();
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: r2Key }));
    return true;
  } catch (err) {
    if (err.$metadata && err.$metadata.httpStatusCode === 404) return false;
    if (err.name === 'NotFound') return false;
    throw err;
  }
}

module.exports = { uploadToR2, existsInR2, loadUploadCache, saveUploadCache, buildPublicUrl };
