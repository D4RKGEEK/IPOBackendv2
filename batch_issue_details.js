'use strict';

/**
 * batch_issue_details.js — process documents + extract issue-details for the
 * latest N non-listed IPOs and report extraction confidence. Ad-hoc verification.
 */

require('dotenv').config();

const { connect, collections, close } = require('./db/mongo');
const { processDocuments } = require('./services/documentService');
const { findBySlug } = require('./db/ipoRepository');

const SLUGS = [
  'horizon-reclaim-india-ipo',
  'utkal-speciality-industries-india-ipo',
  'susan-electricals-india-ipo-susan',
  'genxai-analytics-ipo',
  'hexagon-nutrition-ipo',
  'uhm-vacation-ipo',
  'vahh-chemicals-ipo',
  'cmr-green-technologies-ipo',
  'bio-medica-laboratories-ipo',
  'q-line-biotech-ipo',
];

async function main() {
  await connect();
  const rows = [];
  for (const slug of SLUGS) {
    const t0 = Date.now();
    let note = '';
    try {
      await processDocuments(slug, {}); // downloads → R2 → Firecrawl → auto-extract
    } catch (e) {
      note = `process_err: ${e.message}`;
    }
    const ipo = await findBySlug(slug);
    const id = ipo && ipo.issueDetails;
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    if (!id) {
      rows.push({ slug, confidence: '—', note: note || 'no issueDetails', secs });
    } else {
      const a = id.arithmetic || {};
      rows.push({
        slug,
        type: ipo.issueType,
        confidence: id.confidence,
        checks: `post=${a.postEqualsPrePlusFresh ?? '-'} total=${a.totalEqualsFreshPlusOfs ?? '-'} fresh=mm+net:${a.freshEqualsMmPlusNet ?? '-'}`,
        total: id.totalIssueShares, fresh: id.freshIssueShares, mm: id.marketMakerShares,
        net: id.netOfferShares, pre: id.preIssueShares, post: id.postIssueShares,
        amtCr: id.amounts && id.amounts.totalIssueAmountRupees ? (id.amounts.totalIssueAmountRupees / 1e7).toFixed(1) : null,
        secs,
      });
    }
    console.log(`  ${slug} → ${rows[rows.length - 1].confidence} (${secs}s) ${note}`);
  }

  console.log('\n──────── ISSUE-DETAILS CONFIDENCE (latest 10) ────────');
  const tally = {};
  for (const r of rows) tally[r.confidence] = (tally[r.confidence] || 0) + 1;
  console.log('distribution:', JSON.stringify(tally));
  console.log('');
  for (const r of rows) {
    if (r.confidence === '—') { console.log(`✗ ${r.slug.padEnd(40)} ${r.note}`); continue; }
    const ok = r.confidence === 'high' ? '✅' : r.confidence === 'needs_review' ? '⚠️' : '·';
    console.log(`${ok} ${r.slug.padEnd(40)} ${String(r.confidence).padEnd(13)} ${r.checks}`);
    console.log(`   total ${r.total} fresh ${r.fresh} mm ${r.mm} net ${r.net} pre ${r.pre} post ${r.post}  ₹${r.amtCr}Cr`);
  }
  await close();
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
