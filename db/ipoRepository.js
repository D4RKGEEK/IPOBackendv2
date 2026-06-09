'use strict';

/**
 * ipoRepository.js — persistence + queries for IPO documents.
 *
 * Upsert key: ISIN when present, else symbol, else slug. Slug collisions across
 * different ISINs get a suffix. Merge preserves createdAt and deep-merges
 * documents/sources/raw_sources so no source's data is lost.
 */

const { collections } = require('./mongo');
const { toIpoDoc } = require('./ipoModel');
const { slugify } = require('../utils/slug');

const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Find an existing doc that this record should merge into. */
async function findExisting(record) {
  const ipos = collections.ipos();
  if (record.isin) {
    const byIsin = await ipos.findOne({ isin: record.isin });
    if (byIsin) return byIsin;
  }
  if (record.symbol) {
    const bySym = await ipos.findOne({ symbol: record.symbol });
    if (bySym) return bySym;
  }
  return null;
}

/** Resolve a unique slug, reusing existing.slug or suffixing on collision. */
async function resolveSlug(record, existing) {
  if (existing && existing.slug) return existing.slug;
  const ipos = collections.ipos();
  const base = slugify(record.companyName || record.symbol);
  const clash = await ipos.findOne({ slug: base });
  if (!clash) return base;
  // Different entity with same slug -> suffix with symbol/isin tail.
  return slugify(record.companyName || record.symbol, { suffix: record.symbol || (record.isin || '').slice(-4) });
}

/** Shallow-merge objects, preferring defined incoming values. */
function mergePreferIncoming(base = {}, incoming = {}) {
  const out = { ...base };
  for (const [k, v] of Object.entries(incoming)) {
    if (v !== null && v !== undefined && v !== '') out[k] = v;
  }
  return out;
}

/**
 * Upsert one standardized record. Returns { action, slug, changes }.
 * action ∈ new | updated | unchanged.
 */
async function upsertRecord(record, opts = {}) {
  const ipos = collections.ipos();
  const now = opts.now || new Date().toISOString();
  const existing = await findExisting(record);
  const slug = await resolveSlug(record, existing);
  const incoming = toIpoDoc({ ...record, slug }, { now });

  if (!existing) {
    const doc = { ...incoming, createdAt: now };
    await ipos.insertOne(doc);
    return { action: 'new', slug, changes: [] };
  }

  // Merge: documents/sources/raw_sources deep-merge; scalars prefer incoming-if-present.
  const merged = mergePreferIncoming(existing, incoming);
  merged.documents = mergePreferIncoming(existing.documents, incoming.documents);
  merged.sources = { ...(existing.sources || {}), ...(incoming.sources || {}) };
  merged.raw_sources = { ...(existing.raw_sources || {}), ...(incoming.raw_sources || {}) };
  merged.createdAt = existing.createdAt || now;
  merged.gmp = existing.gmp || incoming.gmp || null; // GMP managed by its own endpoint
  delete merged._id;

  const changes = diffFields(existing, merged);
  if (changes.length === 0) {
    // touch source lastFetched only
    await ipos.updateOne({ _id: existing._id }, { $set: { sources: merged.sources } });
    return { action: 'unchanged', slug, changes: [] };
  }
  merged.updatedAt = now;
  await ipos.updateOne({ _id: existing._id }, { $set: merged });
  return { action: 'updated', slug, changes };
}

/** Which meaningful top-level fields changed (ignores timestamps/sources/raw). */
function diffFields(a, b) {
  const watch = ['status', 'priceBand', 'lotSize', 'issueSize', 'listingDate', 'biddingStart', 'biddingEnd', 'issuePrice', 'documents', 'subscription'];
  const changed = [];
  for (const k of watch) {
    if (JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null)) changed.push(k);
  }
  return changed;
}

async function findBySlug(slug) {
  return collections.ipos().findOne({ slug });
}

/**
 * Query with filters/sort/pagination/search.
 * @param {object} q
 */
async function query(q = {}) {
  const ipos = collections.ipos();
  const filter = {};
  if (q.status) filter.status = q.status;
  if (q.source) filter[`sources.${q.source}`] = { $exists: true };
  if (q.document) filter[`documents.${q.document}`] = { $exists: true };
  if (q.search) {
    filter.$or = [
      { companyName: { $regex: q.search, $options: 'i' } },
      { symbol: { $regex: q.search, $options: 'i' } },
      { isin: { $regex: q.search, $options: 'i' } },
    ];
  }

  const sortField = ({ listingDate: 'listingDate', name: 'companyName', createdAt: 'createdAt' })[q.sort] || 'createdAt';
  const order = q.order === 'asc' ? 1 : -1;
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(q.limit, 10) || 50));

  const total = await ipos.countDocuments(filter);
  const data = await ipos.find(filter)
    .sort({ [sortField]: order })
    .skip((page - 1) * limit)
    .limit(limit)
    .toArray();

  return { data, pagination: { page, limit, total, hasMore: page * limit < total } };
}

async function deleteBySlug(slug) {
  return collections.ipos().deleteOne({ slug });
}

/** Append an error to an IPO's rolling log (keeps the last 5 per the data model). */
async function recordError(slug, operation, message) {
  const entry = { operation, error: String(message), at: new Date().toISOString() };
  await collections.ipos().updateOne(
    { slug },
    { $push: { errors: { $each: [entry], $slice: -5 } } },
  );
}

module.exports = { upsertRecord, findBySlug, query, deleteBySlug, recordError, findExisting, resolveSlug, diffFields };
