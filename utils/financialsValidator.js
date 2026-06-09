'use strict';

/**
 * financialsValidator.js
 * Deterministic, LLM-free validation of extracted restated financials.
 * Turns a raw extraction into a trust verdict: a set of checks, a confidence
 * score, and a reviewRequired flag. The extractor reads; this re-checks the math.
 *
 * Philosophy: the system is allowed to say "I'm not sure". Anything that fails a
 * hard check or scores low is routed to human review rather than silently trusted.
 */

const HARD = 'hard';
const SOFT = 'soft';

/** Relative closeness test, tolerant of restated rounding. */
function approxEqual(a, b, relTol = 0.05, absTol = 0.5) {
  if (a == null || b == null) return null;
  const diff = Math.abs(a - b);
  if (diff <= absTol) return true;
  const denom = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return diff / denom <= relTol;
}

function getMetric(financials, key) {
  return (financials.metrics || []).find((m) => m.key === key) || null;
}

/**
 * Validate a financials extraction object (output of financialsExtractor).
 * @param {object} financials
 * @returns {{ confidence: number, reviewRequired: boolean, checks: object[], perMetric: object }}
 */
function validate(financials) {
  const checks = [];
  const add = (name, level, status, detail) => checks.push({ name, level, status, detail });

  if (!financials || financials.ok === false) {
    return {
      confidence: 0,
      reviewRequired: true,
      checks: [{ name: 'extraction', level: HARD, status: 'fail', detail: financials?.reason || 'no extraction' }],
      perMetric: {},
    };
  }

  const periods = Array.isArray(financials.periods) ? financials.periods : [];
  const metrics = Array.isArray(financials.metrics) ? financials.metrics : [];
  const n = periods.length;

  // ── Structural (HARD) ──────────────────────────────────────────────────────
  add('periods_count', HARD, n >= 2 && n <= 4 ? 'pass' : 'fail', `${n} periods`);

  let alignedAll = true;
  for (const m of metrics) {
    const len = Array.isArray(m.values) ? m.values.length : -1;
    if (len !== n) {
      alignedAll = false;
      add(`values_aligned:${m.key}`, HARD, 'fail', `${len} values vs ${n} periods`);
    }
  }
  if (alignedAll) add('values_aligned', HARD, 'pass', 'all metric rows aligned to periods');

  add('has_metrics', HARD, metrics.length >= 3 ? 'pass' : 'fail', `${metrics.length} metrics`);

  // ── Grounding (HARD-ish) ────────────────────────────────────────────────────
  const groundingScore = financials._grounding ? financials._grounding.groundingScore : 0;
  add('grounding', HARD, groundingScore >= 0.6 ? 'pass' : 'fail',
    `${financials._grounding?.groundedCount ?? 0}/${financials._grounding?.metricCount ?? 0} quotes verified on cited page`);

  // ── Cross-checks (SOFT), evaluated per period ──────────────────────────────
  const rev = getMetric(financials, 'revenueFromOperations');
  const inc = getMetric(financials, 'totalIncome');
  const pat = getMetric(financials, 'profitAfterTax');
  const ebitda = getMetric(financials, 'ebitda');
  const nw = getMetric(financials, 'netWorth');
  const ronw = getMetric(financials, 'ronw');
  const basic = getMetric(financials, 'basicEPS');
  const diluted = getMetric(financials, 'dilutedEPS');

  const at = (m, i) => (m && Array.isArray(m.values) ? m.values[i] : null);

  for (let i = 0; i < n; i++) {
    const label = periods[i]?.label || `period${i}`;

    // revenue <= total income
    if (at(rev, i) != null && at(inc, i) != null) {
      add(`rev<=income:${label}`, SOFT, at(rev, i) <= at(inc, i) * 1.02 ? 'pass' : 'fail',
        `rev ${at(rev, i)} vs income ${at(inc, i)}`);
    }
    // PAT <= total income
    if (at(pat, i) != null && at(inc, i) != null) {
      add(`pat<=income:${label}`, SOFT, at(pat, i) <= at(inc, i) * 1.02 ? 'pass' : 'fail',
        `pat ${at(pat, i)} vs income ${at(inc, i)}`);
    }
    // EPS sign matches PAT sign
    if (at(pat, i) != null && at(basic, i) != null) {
      const same = Math.sign(at(pat, i)) === Math.sign(at(basic, i)) || at(basic, i) === 0;
      add(`eps_sign:${label}`, SOFT, same ? 'pass' : 'fail',
        `pat ${at(pat, i)} / basicEPS ${at(basic, i)}`);
    }
    // diluted EPS <= basic EPS (when positive)
    if (at(basic, i) != null && at(diluted, i) != null && at(basic, i) > 0) {
      add(`diluted<=basic:${label}`, SOFT, at(diluted, i) <= at(basic, i) + 0.01 ? 'pass' : 'fail',
        `basic ${at(basic, i)} / diluted ${at(diluted, i)}`);
    }
    // RoNW ≈ PAT / netWorth * 100
    if (at(pat, i) != null && at(nw, i) != null && at(ronw, i) != null && at(nw, i) !== 0) {
      const implied = (at(pat, i) / at(nw, i)) * 100;
      const ok = approxEqual(implied, at(ronw, i), 0.20, 1.0);
      add(`ronw_consistency:${label}`, SOFT, ok ? 'pass' : 'fail',
        `reported ${at(ronw, i)}% vs implied ${implied.toFixed(2)}%`);
    }
    // EBITDA margin sanity
    if (at(ebitda, i) != null && at(rev, i) != null && at(rev, i) !== 0) {
      const margin = at(ebitda, i) / at(rev, i);
      add(`ebitda_margin:${label}`, SOFT, margin >= -1 && margin <= 1.5 ? 'pass' : 'fail',
        `${(margin * 100).toFixed(1)}%`);
    }
  }

  // ── Per-metric verdict ──────────────────────────────────────────────────────
  const perMetric = {};
  for (const m of metrics) {
    const related = checks.filter((c) => c.name.endsWith(`:${m.key}`) || c.name.includes(`:${m.key}`));
    const failed = related.filter((c) => c.status === 'fail').length;
    perMetric[m.key] = {
      grounded: m._grounded === true,
      values: m.values,
      page: m.source?.page ?? null,
      ok: m._grounded === true && failed === 0,
    };
  }

  // ── Confidence model ────────────────────────────────────────────────────────
  const hardFails = checks.filter((c) => c.level === HARD && c.status === 'fail').length;
  const softFails = checks.filter((c) => c.level === SOFT && c.status === 'fail').length;

  let confidence = 1.0;
  // Grounding dominates: zero grounding caps confidence at 0.30.
  confidence *= 0.30 + 0.70 * groundingScore;
  // Each hard failure is severe.
  confidence -= 0.25 * hardFails;
  // Soft failures chip away, capped.
  confidence -= Math.min(0.30, 0.05 * softFails);
  confidence = Math.max(0, Math.min(1, Number(confidence.toFixed(3))));

  const reviewRequired = confidence < 0.8 || hardFails > 0 || groundingScore < 0.6;

  return { confidence, reviewRequired, checks, perMetric, summary: { hardFails, softFails, groundingScore } };
}

module.exports = { validate, approxEqual };
