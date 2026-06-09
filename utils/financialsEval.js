'use strict';

/**
 * financialsEval.js
 * Score an extraction against a hand-verified GOLD file (ground truth).
 *
 * Gold file shape (gold/<SYMBOL>.gold.json):
 *   {
 *     "symbol": "HARIKANTA",
 *     "sourceFile": "PDFs/HARIKANTA_rhp.pdf",
 *     "_verified": true,                 // only verified golds count toward accuracy
 *     "currencyUnit": "Rs in lakhs",
 *     "periods": ["30 Nov 2025","FY2025","FY2024","FY2023"],   // most-recent-first
 *     "metrics": {                       // values aligned 1:1 with periods; null = N/A
 *       "revenueFromOperations": [..],
 *       "profitAfterTax": [..]
 *     }
 *   }
 *
 * Cells (one metric × one period with a non-null gold value) are the unit of
 * measurement. We assume both gold and extraction list periods most-recent-first
 * and align by index — bootstrap drafts inherit the extractor's ordering, so this
 * holds as long as you edit values without reordering periods.
 */

/** Closeness test for two reported financial numbers. */
function valuesMatch(a, b, relTol = 0.01, absTol = 0.05) {
  if (a == null || b == null) return false;
  const diff = Math.abs(a - b);
  if (diff <= absTol) return true;
  const denom = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return diff / denom <= relTol;
}

function extractionMetricMap(extraction) {
  const map = {};
  for (const m of (extraction && extraction.metrics) || []) map[m.key] = m.values || [];
  return map;
}

/**
 * Score one extraction against one gold file.
 * @returns {{ symbol, verified, cells, correct, wrong, missed, coverage, accuracy, precision, errors }}
 */
function scoreOne(extraction, gold) {
  const ext = extractionMetricMap(extraction);
  const periods = gold.periods || [];
  let cells = 0, correct = 0, wrong = 0, missed = 0;
  const errors = [];

  for (const [key, goldVals] of Object.entries(gold.metrics || {})) {
    for (let i = 0; i < goldVals.length; i++) {
      const g = goldVals[i];
      if (g == null) continue; // not part of ground truth
      cells++;
      const extVals = ext[key];
      const e = extVals ? extVals[i] : undefined;
      if (e == null || e === undefined) {
        missed++;
        errors.push({ key, period: periods[i] ?? i, expected: g, got: null, type: 'missed' });
      } else if (valuesMatch(e, g)) {
        correct++;
      } else {
        wrong++;
        errors.push({ key, period: periods[i] ?? i, expected: g, got: e, type: 'wrong' });
      }
    }
  }

  const attempted = correct + wrong;
  return {
    symbol: gold.symbol,
    verified: gold._verified === true,
    cells,
    correct,
    wrong,
    missed,
    coverage: cells ? Number((attempted / cells).toFixed(3)) : 0,   // truth cells the extractor attempted
    accuracy: cells ? Number((correct / cells).toFixed(3)) : 0,     // truth cells extracted correctly
    precision: attempted ? Number((correct / attempted).toFixed(3)) : 0, // of attempted, fraction correct
    errors,
  };
}

/**
 * Aggregate per-file scores into a corpus-level report.
 * @param {object[]} scores  output of scoreOne, one per file
 */
function aggregate(scores) {
  const verified = scores.filter((s) => s.verified);
  const sum = (arr, k) => arr.reduce((a, s) => a + s[k], 0);
  const cells = sum(verified, 'cells');
  const correct = sum(verified, 'correct');
  const wrong = sum(verified, 'wrong');
  const missed = sum(verified, 'missed');
  const attempted = correct + wrong;
  return {
    filesTotal: scores.length,
    filesVerified: verified.length,
    cells,
    correct,
    wrong,
    missed,
    coverage: cells ? Number((attempted / cells).toFixed(3)) : 0,
    accuracy: cells ? Number((correct / cells).toFixed(3)) : 0,
    precision: attempted ? Number((correct / attempted).toFixed(3)) : 0,
  };
}

module.exports = { scoreOne, aggregate, valuesMatch };
