'use strict';

/**
 * ipoModel.js — map a merged standardized IPO record (from sources / ipo_master)
 * into the MongoDB IPO document shape used by the API. Pure + testable.
 *
 * Anything not promoted to a top-level field stays in raw_sources.
 */

const { slugify } = require('../utils/slug');
const { collectDocuments } = require('../utils/documentCollector');

const g = (record) => (record.raw_sources && record.raw_sources.groww) || {};
const gDetail = (record) => g(record).detail || g(record);
const u = (record) => (record.raw_sources && record.raw_sources.upstox) || {};
const z = (record) => (record.raw_sources && record.raw_sources.zerodha) || {};

/** SME vs MAINBOARD from whichever source knows. */
function issueType(record) {
  const up = u(record);
  if (up.issue_type) return /sme/i.test(up.issue_type) ? 'SME' : 'MAINBOARD';
  const gd = gDetail(record);
  if (typeof gd.isSme === 'boolean') return gd.isSme ? 'SME' : 'MAINBOARD';
  if (typeof z(record).isSme === 'boolean') return z(record).isSme ? 'SME' : 'MAINBOARD';
  if (gd.issueType) return /sme/i.test(gd.issueType) ? 'SME' : 'MAINBOARD';
  return null;
}

function firstDefined(...vals) {
  for (const v of vals) if (v !== undefined && v !== null && v !== '') return v;
  return null;
}

/** Build the { drhp, rhp, final } documents map with provenance. */
function documentsMap(record) {
  const { documents } = collectDocuments(record);
  const map = {};
  for (const d of documents) {
    if (!map[d.docType]) map[d.docType] = { url: d.url, source: d.sources[0] || null };
  }
  return map;
}

/** Subscription {retail,qualified,nii,total} from Groww's subscriptionRates. */
function subscription(record) {
  const rates = gDetail(record).subscriptionRates;
  if (!Array.isArray(rates) || !rates.length) return null;
  const by = {};
  for (const r of rates) by[(r.category || '').toUpperCase()] = r.subscriptionRate;
  const out = {};
  if (by.RETAIL != null) out.retail = round2(by.RETAIL);
  if (by.QIB != null) out.qualified = round2(by.QIB);
  if (by.NII != null) out.nii = round2(by.NII);
  if (by.TOTAL != null) out.total = round2(by.TOTAL);
  return Object.keys(out).length ? out : null;
}

const round2 = (n) => (typeof n === 'number' ? Math.round(n * 100) / 100 : n);

/** Per-source tracking: { nse:{url}, upstox:{...}, ... } seeded from raw_sources. */
function sourcesMeta(record, now) {
  const meta = {};
  const rs = record.raw_sources || {};
  for (const src of Object.keys(rs)) {
    const url = rs[src].detailUrl || rs[src].url || null;
    meta[src] = { lastFetched: now, url };
  }
  return meta;
}

/**
 * Map a standardized record to a Mongo IPO document body (no _id/createdAt).
 * @param {object} record
 * @param {object} [opts] { now }
 */
function toIpoDoc(record, opts = {}) {
  const now = opts.now || new Date().toISOString();
  const up = u(record);
  const gd = gDetail(record);
  const lotSize = firstDefined(up.lot_size, gd.lotSize, record.lotSize);
  const priceMax = record.priceBand && record.priceBand.maximum;
  const priceBand = record.priceBand
    ? { min: record.priceBand.minimum ?? null, max: record.priceBand.maximum ?? null }
    : { min: null, max: null };

  return {
    slug: record.slug || slugify(record.companyName || record.symbol),
    isin: record.isin || null,
    symbol: record.symbol || null,
    companyName: record.companyName || null,
    displayName: record.companyName ? `${record.companyName} IPO` : null,
    status: record.status || null,
    issueType: issueType(record),
    sector: firstDefined(gd.sector, up.industry),
    industry: firstDefined(up.industry, gd.sector),
    faceValue: firstDefined(up.face_value, gd.faceValue),
    priceBand,
    issuePrice: firstDefined(gd.issuePrice, up.cut_off_price),
    lotSize: lotSize ?? null,
    minimumAmount: lotSize && priceMax ? lotSize * priceMax : null,
    issueSize: firstDefined(gd.issueSize, up.issue_size),
    biddingStart: firstDefined(record.biddingStartDate, gd.startDate, up.bidding_start_date),
    biddingEnd: firstDefined(gd.endDate, up.bidding_end_date, up.timeline && up.timeline.application_end_date),
    listingDate: firstDefined(record.listingDate, gd.listingDate, up.timeline && up.timeline.listing_date),
    cutoffTime: firstDefined(gd.lastBidPlaceTime, up.timeline && up.timeline.application_end_date),
    allotmentDate: firstDefined(gd.allotmentDate, up.timeline && up.timeline.allotment_date),
    registrar: firstDefined(gd.registrar) || null,
    gmp: null,
    subscription: subscription(record),
    documents: documentsMap(record),
    sources: sourcesMeta(record, now),
    raw_sources: record.raw_sources || {},
    statusHistory: record.statusHistory || undefined,
    timeline: record.timeline || undefined,
    updatedAt: now,
  };
}

module.exports = { toIpoDoc, issueType, subscription, documentsMap, sourcesMeta };
