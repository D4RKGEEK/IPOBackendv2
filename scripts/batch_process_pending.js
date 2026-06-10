'use strict';

/**
 * batch_process_pending.js — process documents + extract for every non-listed
 * IPO that has a direct-PDF document but no extraction yet. Reports coverage so
 * we can see how well extraction works across the corpus.
 */

require('dotenv').config();

const { connect, collections, close } = require('../db/mongo');
const { processDocuments } = require('../services/documentService');
const { findBySlug } = require('../db/ipoRepository');

const docUrl = (d) => { const x = d.documents || {}; return (x.rhp && x.rhp.url) || (x.drhp && x.drhp.url) || (x.final && x.final.url) || ''; };

async function main() {
  await connect();
  const all = await collections.ipos().find({ status: { $ne: 'listed' } }).project({ slug: 1, documents: 1, objects: 1, financials: 1, issueType: 1 }).toArray();
  const targets = all.filter((d) => /\.pdf($|\?)/i.test(docUrl(d)) && !(d.objects || d.financials));
  console.log(`Processing ${targets.length} pending IPOs (direct-PDF, non-listed, not yet extracted)\n`);

  const agg = { total: targets.length, ok: 0, downloadFail: 0, noExtract: 0, fin: 0, kpi: 0, obj: 0, issueHigh: 0, issueReview: 0, lm: 0 };
  for (const t of targets) {
    const t0 = Date.now();
    try {
      await processDocuments(t.slug, {});
    } catch (e) { /* recorded on the doc */ }
    const ipo = await findBySlug(t.slug);
    const rhp = ipo.documents && (ipo.documents.rhp || ipo.documents.drhp || ipo.documents.final);
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    if (rhp && rhp.status === 'error') { agg.downloadFail++; console.log(`  ✗ ${t.slug.padEnd(40)} ${rhp.reason} (${secs}s)`); continue; }
    const fin = !!ipo.financials; const kpi = ipo.kpis ? Object.keys(ipo.kpis.kpis).length : 0;
    const obj = ipo.objects ? ipo.objects.objects.length : 0; const id = ipo.issueDetails;
    const lm = ipo.intermediaries ? ipo.intermediaries.leadManagers.length : 0;
    if (!fin && !obj && !id) { agg.noExtract++; console.log(`  · ${t.slug.padEnd(40)} processed but nothing extracted (${secs}s)`); continue; }
    agg.ok++;
    if (fin) agg.fin++; if (kpi) agg.kpi++; if (obj) agg.obj++; if (lm) agg.lm++;
    if (id && id.confidence === 'high') agg.issueHigh++; else if (id && id.confidence === 'needs_review') agg.issueReview++;
    console.log(`  ✓ ${t.slug.padEnd(40)} ${[fin && 'fin', kpi && `kpi:${kpi}`, obj && `obj:${obj}`, id && `issue:${id.confidence}`, lm && `LM:${lm}`].filter(Boolean).join(' ')} (${secs}s)`);
  }

  console.log('\n──────── COVERAGE ────────');
  console.log(`processed ok: ${agg.ok}/${agg.total}  ·  download/parse failed: ${agg.downloadFail}  ·  empty: ${agg.noExtract}`);
  console.log(`financials: ${agg.fin}  ·  kpis: ${agg.kpi}  ·  objects: ${agg.obj}  ·  intermediaries(LM): ${agg.lm}`);
  console.log(`issueDetails: ${agg.issueHigh} high, ${agg.issueReview} needs_review`);
  await close();
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
