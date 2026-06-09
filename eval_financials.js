'use strict';

/**
 * eval_financials.js — gold-set harness for the financials extractor.
 *
 * Modes:
 *   Bootstrap draft gold files from extraction (then YOU verify each value):
 *     node eval_financials.js --bootstrap
 *     node eval_financials.js --bootstrap --symbols HARIKANTA,AMBAAUTO
 *
 *   Score the extractor against existing gold files:
 *     node eval_financials.js            # runs every gold/*.gold.json
 *     node eval_financials.js --symbols HARIKANTA
 *
 * A gold file only counts toward accuracy once you set "_verified": true.
 * Each draft value carries a "_page"/"_quote" hint so you can verify fast.
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { extractFinancials } = require('./utils/financialsExtractor');
const { scoreOne, aggregate } = require('./utils/financialsEval');

const GOLD_DIR = path.join(__dirname, 'gold');
const PDF_DIR = path.join(__dirname, 'PDFs');

// Default diverse gold set (SME + untyped, spanning size).
const DEFAULT_SYMBOLS = [
  'HARIKANTA', 'AMBAAUTO', 'RFIL', 'ADISOFT', 'ACCORDTS',
  'CMRGREEN', 'ACETECH', 'AFLTD', 'AMIRCHAND', 'CLEANMAX',
];

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--bootstrap') args.bootstrap = true;
    else if (a.startsWith('--')) args[a.slice(2)] = argv[++i];
    else args._.push(a);
  }
  return args;
}

/** Find the PDF for a symbol (prefers rhp over drhp). */
function pdfForSymbol(sym) {
  const files = fs.readdirSync(PDF_DIR).filter((f) => f.toUpperCase().startsWith(sym.toUpperCase() + '_'));
  if (!files.length) return null;
  files.sort((a) => (/_rhp\.pdf$/i.test(a) ? -1 : 1));
  return path.join('PDFs', files[0]);
}

/** Turn an extraction into a draft gold file the user can correct. */
function toDraftGold(sym, pdfPath, extraction) {
  const metrics = {};
  const hints = {};
  for (const m of extraction.metrics || []) {
    metrics[m.key] = m.values || [];
    hints[m.key] = { _page: m.source?.page ?? null, _quote: (m.source?.quote || '').slice(0, 120) };
  }
  return {
    symbol: sym,
    sourceFile: pdfPath,
    _verified: false,
    _instructions: 'Open the PDF at each _page, confirm/correct the values, then set _verified: true. Add revenueFromOperations / totalIncome rows if missing.',
    currencyUnit: extraction.currencyUnit || null,
    periods: (extraction.periods || []).map((p) => p.label),
    metrics,
    _hints: hints,
  };
}

async function bootstrap(symbols, opts) {
  fs.mkdirSync(GOLD_DIR, { recursive: true });
  for (const sym of symbols) {
    const outPath = path.join(GOLD_DIR, `${sym}.gold.json`);
    if (fs.existsSync(outPath) && !opts.force) {
      console.log(`  • ${sym}: gold exists, skipping (use --force to overwrite)`);
      continue;
    }
    const pdf = pdfForSymbol(sym);
    if (!pdf) { console.log(`  ✗ ${sym}: no PDF found`); continue; }
    try {
      const ext = await extractFinancials(pdf, { provider: opts.provider, model: opts.model });
      if (!ext.ok) { console.log(`  ✗ ${sym}: ${ext.reason}`); continue; }
      fs.writeFileSync(outPath, JSON.stringify(toDraftGold(sym, pdf, ext), null, 2));
      const g = ext._grounding;
      console.log(`  ✓ ${sym}: ${ext.metrics.length} metrics, grounding ${(g.groundingScore * 100).toFixed(0)}%  → ${path.relative(__dirname, outPath)}`);
    } catch (e) {
      console.log(`  ✗ ${sym}: ${e.message}`);
    }
  }
  console.log(`\nDraft gold written to gold/. Verify the numbers against each PDF, set "_verified": true, then run: node eval_financials.js`);
}

async function score(symbols, opts) {
  let golds = fs.existsSync(GOLD_DIR) ? fs.readdirSync(GOLD_DIR).filter((f) => f.endsWith('.gold.json')) : [];
  if (symbols && symbols.length) golds = golds.filter((f) => symbols.includes(f.replace('.gold.json', '')));
  if (!golds.length) {
    console.log('No gold files found. Run: node eval_financials.js --bootstrap');
    return;
  }
  const scores = [];
  for (const file of golds) {
    const gold = JSON.parse(fs.readFileSync(path.join(GOLD_DIR, file), 'utf8'));
    const pdf = gold.sourceFile || pdfForSymbol(gold.symbol);
    const ext = await extractFinancials(pdf, { provider: opts.provider, model: opts.model });
    const s = scoreOne(ext, gold);
    scores.push(s);
    const tag = s.verified ? '' : '  (unverified — not counted)';
    console.log(`\n${gold.symbol}: acc ${(s.accuracy * 100).toFixed(0)}%  cov ${(s.coverage * 100).toFixed(0)}%  prec ${(s.precision * 100).toFixed(0)}%  (${s.correct}/${s.cells} cells)${tag}`);
    for (const e of s.errors.slice(0, 8)) {
      console.log(`   ${e.type.padEnd(6)} ${e.key} @ ${e.period}: expected ${e.expected}, got ${e.got}`);
    }
  }
  const agg = aggregate(scores);
  console.log('\n──────── CORPUS (verified golds only) ────────');
  console.log(`Files: ${agg.filesVerified}/${agg.filesTotal} verified`);
  console.log(`Accuracy : ${(agg.accuracy * 100).toFixed(1)}%   (${agg.correct}/${agg.cells} truth cells correct)`);
  console.log(`Coverage : ${(agg.coverage * 100).toFixed(1)}%   (attempted ${agg.correct + agg.wrong}/${agg.cells})`);
  console.log(`Precision: ${(agg.precision * 100).toFixed(1)}%   (of attempted, ${agg.correct} correct, ${agg.wrong} wrong)`);
  console.log(`Missed   : ${agg.missed}   Wrong: ${agg.wrong}`);
  if (agg.filesVerified === 0) {
    console.log('\n⚠ No verified golds yet — numbers above are meaningless until you verify drafts and set "_verified": true.');
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const symbols = args.symbols ? args.symbols.split(',').map((s) => s.trim().toUpperCase()) : null;
  const opts = { provider: args.provider, model: args.model, force: args.force !== undefined };
  if (args.bootstrap) {
    await bootstrap(symbols || DEFAULT_SYMBOLS, opts);
  } else {
    await score(symbols, opts);
  }
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
