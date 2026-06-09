'use strict';

/**
 * extract_one.js — run the Slice 1 financials extraction on a single PDF.
 *
 * Usage:
 *   node extract_one.js PDFs/HARIKANTA_rhp.pdf
 *   node extract_one.js PDFs/HARIKANTA_rhp.pdf --out out.json --provider deepseek
 *
 * Writes a structured JSON: { financials, validation } and prints a summary.
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { extractFinancials } = require('./utils/financialsExtractor');
const { validate } = require('./utils/financialsValidator');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) args[a.slice(2)] = argv[++i];
    else args._.push(a);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const file = args._[0];
  if (!file) {
    console.error('Usage: node extract_one.js <pdf> [--out file.json] [--provider deepseek] [--model name]');
    process.exit(1);
  }
  if (!fs.existsSync(file)) {
    console.error(`File not found: ${file}`);
    process.exit(1);
  }

  console.log(`\nExtracting financials from: ${file}`);
  const t0 = Date.now();
  const financials = await extractFinancials(file, { provider: args.provider, model: args.model });
  const validation = validate(financials);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  const result = { financials, validation };
  const outPath = args.out || path.join('out', `${path.basename(file, path.extname(file))}.financials.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));

  // ── Console summary ─────────────────────────────────────────────────────────
  console.log(`Done in ${secs}s  ·  provider=${financials._meta?.provider} model=${financials._meta?.model}`);
  if (!financials.ok) {
    console.log(`❌ ${financials.reason}`);
    console.log(`Saved → ${outPath}`);
    return;
  }
  console.log(`Pages scanned: ${financials._meta.pageCount}  ·  candidate pages: ${financials._meta.candidatePages.join(', ')}`);
  console.log(`Basis: ${financials.reportingBasis}  ·  Unit: ${financials.currencyUnit}`);
  console.log(`Periods: ${(financials.periods || []).map((p) => p.label).join(' | ')}`);
  console.log('\nMetrics:');
  for (const m of financials.metrics || []) {
    const flag = m._grounded ? '✓' : '⚠ ungrounded';
    console.log(`  ${m.key.padEnd(22)} [${(m.values || []).join(', ')}]  p${m.source?.page} ${flag}`);
  }
  console.log(`\nGrounding: ${(financials._grounding.groundingScore * 100).toFixed(0)}% (${financials._grounding.groundedCount}/${financials._grounding.metricCount})`);
  console.log(`Confidence: ${(validation.confidence * 100).toFixed(0)}%  ·  reviewRequired: ${validation.reviewRequired}`);
  const fails = validation.checks.filter((c) => c.status === 'fail');
  if (fails.length) {
    console.log('Failed checks:');
    for (const c of fails) console.log(`  [${c.level}] ${c.name} — ${c.detail}`);
  }
  console.log(`\nSaved → ${outPath}`);
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
