'use strict';

/**
 * backfill_extract.js — bring every IPO's extracted data current.
 *
 * For each IPO whose markdown is already cached in R2 (ipos/<SYM>/<type>.md):
 *  - restore documents.<type>.{status:'extracted', markdownUrl} if a re-scrape
 *    wiped it (so pickDoc works again),
 *  - re-run extraction from the cached markdown (financials / kpis / lot /
 *    issueDetails / intermediaries / objects) — no re-download, no Nutrient.
 */

require('dotenv').config();

const { connect, collections, close } = require('../db/mongo');
const r2 = require('../utils/r2');
const { docKey } = require('../utils/docPipeline');
const { runExtraction } = require('../services/extractionService');

const TYPES = ['rhp', 'final', 'drhp'];

async function main() {
  await connect();
  const ipos = await collections.ipos().find({}).project({ slug: 1, symbol: 1, documents: 1 }).toArray();
  let restored = 0; let extracted = 0; let skipped = 0; let failed = 0;

  for (const ipo of ipos) {
    const sym = ipo.symbol || ipo.slug;
    let hasMd = false;
    for (const t of TYPES) {
      let exists = false;
      try { exists = await r2.objectExists(docKey(sym, t, 'md')); } catch (_) { exists = false; }
      if (!exists) continue;
      hasMd = true;
      const cur = (ipo.documents || {})[t] || {};
      if (cur.status !== 'extracted' || !cur.markdownUrl) {
        const set = {
          [`documents.${t}.status`]: 'extracted',
          [`documents.${t}.markdownUrl`]: r2.getPublicUrl(docKey(sym, t, 'md')),
        };
        if (!cur.url) set[`documents.${t}.url`] = r2.getPublicUrl(docKey(sym, t, 'pdf'));
        await collections.ipos().updateOne({ slug: ipo.slug }, { $set: set });
        restored++;
      }
    }
    if (!hasMd) { skipped++; continue; }
    try {
      const r = await runExtraction(ipo.slug);
      extracted++;
      const bits = [r.objects && `obj:${r.objects.count}`, r.issueDetails && `issue:${r.issueDetails.confidence}`, r.financials && 'fin', r.kpis && `kpi:${r.kpis.length}`, r.intermediaries && `LM:${r.intermediaries.leadManagers}`].filter(Boolean).join(' ');
      console.log(`  ✓ ${ipo.slug} — ${bits}`);
    } catch (e) {
      failed++;
      console.log(`  ✗ ${ipo.slug} — ${e.message}`);
    }
  }

  console.log(`\nBackfill: ${extracted} extracted, ${restored} doc-status restored, ${skipped} no-markdown, ${failed} failed (of ${ipos.length})`);
  await close();
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
