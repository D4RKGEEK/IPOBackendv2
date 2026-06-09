'use strict';

/**
 * r2.js — Cloudflare R2 storage client (S3-compatible).
 *
 * Used by the IPO document pipeline: PDF -> R2 (stable public URL) -> Firecrawl,
 * and to store the resulting markdown / extracted JSON. Also supports the
 * lifecycle cleanup (delete an IPO's raw PDFs once it has been closed a while).
 *
 * Config (from .env):
 *   CF_ACCOUNT_ID          Cloudflare account id (for the S3 endpoint)
 *   R2_ACCESS_KEY_ID       R2 access key
 *   R2_SECRET_ACCESS_KEY   R2 secret
 *   R2_BUCKET              bucket name
 *   R2_PUBLIC_BASE         public base URL (e.g. https://pub-xxxx.r2.dev or a custom domain)
 */

const fs = require('fs');
const path = require('path');
const {
  S3Client, HeadObjectCommand, DeleteObjectCommand, DeleteObjectsCommand,
  ListObjectsV2Command, GetObjectCommand,
} = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');

const REQUIRED_ENV = ['CF_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_BASE'];

/** Throw a clear error if any required env var is missing. Returns the config. */
function getConfig(env = process.env) {
  const missing = REQUIRED_ENV.filter((k) => !env[k]);
  if (missing.length) throw new Error(`R2 config missing env: ${missing.join(', ')}`);
  return {
    accountId: env.CF_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucket: env.R2_BUCKET,
    publicBase: env.R2_PUBLIC_BASE.replace(/\/+$/, ''),
    endpoint: `https://${env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  };
}

/** Build the public URL for a key (no network call). */
function getPublicUrl(key, env = process.env) {
  const { publicBase } = getConfig(env);
  return `${publicBase}/${String(key).replace(/^\/+/, '')}`;
}

/** Normalise a key: strip leading slashes, collapse dup slashes. */
function normalizeKey(key) {
  return String(key).replace(/^\/+/, '').replace(/\/{2,}/g, '/');
}

/** Guess a content type from a file extension. */
function contentTypeFor(key) {
  const ext = path.extname(key).toLowerCase();
  return {
    '.pdf': 'application/pdf',
    '.md': 'text/markdown; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
  }[ext] || 'application/octet-stream';
}

let _client = null;
function client(env = process.env) {
  if (_client) return _client;
  const cfg = getConfig(env);
  _client = new S3Client({
    region: 'auto',
    endpoint: cfg.endpoint,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
  return _client;
}

/**
 * Upload a local file to R2 (multipart-safe for large PDFs).
 * @returns {Promise<{key, url, bucket}>}
 */
async function uploadFile(localPath, key, opts = {}) {
  const cfg = getConfig();
  const Key = normalizeKey(key);
  const upload = new Upload({
    client: client(),
    params: {
      Bucket: cfg.bucket,
      Key,
      Body: fs.createReadStream(localPath),
      ContentType: opts.contentType || contentTypeFor(Key),
    },
  });
  await upload.done();
  return { key: Key, url: getPublicUrl(Key), bucket: cfg.bucket };
}

/** Upload a Buffer/string body. */
async function uploadBuffer(body, key, opts = {}) {
  const cfg = getConfig();
  const Key = normalizeKey(key);
  const upload = new Upload({
    client: client(),
    params: { Bucket: cfg.bucket, Key, Body: body, ContentType: opts.contentType || contentTypeFor(Key) },
  });
  await upload.done();
  return { key: Key, url: getPublicUrl(Key), bucket: cfg.bucket };
}

/** Convenience: store text (markdown / JSON). Objects are serialized if not a string. */
async function putText(key, text, opts = {}) {
  const body = typeof text === 'string' ? text : JSON.stringify(text, null, 2);
  return uploadBuffer(Buffer.from(body, 'utf8'), key, opts);
}

/** True if the object exists. */
async function objectExists(key) {
  const cfg = getConfig();
  try {
    await client().send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: normalizeKey(key) }));
    return true;
  } catch (e) {
    if (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) return false;
    throw e;
  }
}

/** Read an object back as a UTF-8 string. */
async function getText(key) {
  const cfg = getConfig();
  const res = await client().send(new GetObjectCommand({ Bucket: cfg.bucket, Key: normalizeKey(key) }));
  return res.Body.transformToString();
}

/** Delete a single object. */
async function deleteObject(key) {
  const cfg = getConfig();
  await client().send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: normalizeKey(key) }));
  return { key: normalizeKey(key), deleted: true };
}

/** List object keys under a prefix (handles pagination). */
async function list(prefix = '') {
  const cfg = getConfig();
  const keys = [];
  let token;
  do {
    const res = await client().send(new ListObjectsV2Command({
      Bucket: cfg.bucket, Prefix: normalizeKey(prefix), ContinuationToken: token,
    }));
    for (const o of res.Contents || []) keys.push(o.Key);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

/** Delete every object under a prefix (e.g. one IPO's folder). Returns count. */
async function deletePrefix(prefix) {
  const cfg = getConfig();
  const keys = await list(prefix);
  let deleted = 0;
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    if (!batch.length) break;
    await client().send(new DeleteObjectsCommand({
      Bucket: cfg.bucket,
      Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
    }));
    deleted += batch.length;
  }
  return { prefix: normalizeKey(prefix), deleted };
}

module.exports = {
  getConfig, getPublicUrl, normalizeKey, contentTypeFor,
  uploadFile, uploadBuffer, putText, objectExists, getText,
  deleteObject, list, deletePrefix, REQUIRED_ENV,
};
