'use strict';

/**
 * financialsExtractor.js
 * Slice 1 of the structured-extraction pipeline: pull the restated financial
 * summary (3 fiscal years) out of an IPO prospectus PDF, with every metric
 * grounded to a page number + a verbatim source quote.
 *
 * Flow:
 *   1. Read per-page text (page-tagged) from the PDF via pdfjs-dist.
 *   2. Score pages for "financial summary" signals; pick the best window.
 *   3. Ask the LLM to extract a strict JSON schema from those pages.
 *   4. Verify each metric's source.quote actually appears on the cited page
 *      (grounding) — this is the anti-hallucination guard.
 *
 * The deterministic math/consistency checks live in financialsValidator.js.
 */

const fs = require('fs');
const { completeJson } = require('./llmClient');

// Canonical metrics we want, with the row signals used for page scoring.
const METRIC_SIGNALS = [
  /revenue\s+from\s+operations/i,
  /total\s+income/i,
  /profit\s+(?:after\s+tax|for\s+the|\/\s*\(loss\))/i,
  /\bebitda\b/i,
  /net\s+worth|total\s+equity/i,
  /earnings?\s+per\s+(?:equity\s+)?share|basic.*\beps\b/i,
  /return\s+on\s+net\s+worth|\bronw\b/i,
  /restated/i,
  /total\s+borrowings?/i,
  /net\s+asset\s+value/i,
];

const YEAR_HEADER_RE = /(?:march|sept?|june?|dec)\w*[, ]*\s*\d{2,4}|fy\s*\d{2,4}|20\d{2}\s*[-–]\s*\d{2,4}/gi;

const EXTRACTION_SCHEMA = `{
  "reportingBasis": "consolidated" | "standalone" | "unknown",
  "currencyUnit": string,            // verbatim, e.g. "INR in lakhs", "Rs. in millions"
  "periods": [                       // most recent first; 2-4 entries
    { "label": string,               // e.g. "FY2025" or "Eight months ended Nov 30, 2025"
      "endDate": string|null,        // ISO "YYYY-MM-DD" if determinable
      "months": number|null }        // period length in months (12 for full year)
  ],
  "metrics": [
    { "key": one of [
        "revenueFromOperations","totalIncome","ebitda","profitAfterTax",
        "netWorth","totalBorrowings","basicEPS","dilutedEPS","ronw","navPerShare"
      ],
      "label": string,               // the exact row label from the document
      "values": [ number|null, ... ],// aligned 1:1 with periods, same order
      "source": { "page": number,    // the page number shown in the PAGE marker
                  "quote": string }   // a verbatim line/phrase from that page proving the row
    }
  ],
  "notes": string                    // anything ambiguous worth a human knowing
}`;

const SYSTEM_PROMPT = `You are a meticulous financial-data extraction engine for Indian IPO prospectuses (DRHP/RHP).
You are given text from a few pages, each prefixed with a "===== PAGE N =====" marker.
Extract the RESTATED financial summary into the exact JSON schema below.

Rules — follow strictly:
- ONLY use numbers that literally appear in the provided text. NEVER calculate, infer, or guess a value. If a metric is absent, omit that metric (do not invent it).
- "values" MUST be aligned 1:1 with "periods" and in the same order. Use null for a period where that metric is not reported.
- Report numbers as printed (do not rescale). Capture the unit in "currencyUnit". A value in parentheses like (12.34) is negative -> -12.34.
- "source.page" MUST be the integer from the PAGE marker of the line you took the row from, and "source.quote" MUST be copied verbatim from that page (enough to locate the row, including the numbers).
- Prefer the restated summary statements. If both consolidated and standalone appear, set reportingBasis to whichever the summary table uses and note the other in "notes".
- Output ONLY the JSON object. No prose, no code fences.

Schema:
${EXTRACTION_SCHEMA}`;

/**
 * Normalize whitespace for robust substring / grounding comparison.
 * @param {string} s
 */
function norm(s) {
  return (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Read each page's text, returned as an array indexed by page (1-based access
 * via pages[i-1]).
 * @param {string} filePath
 * @returns {Promise<string[]>}
 */
async function readPageTexts(filePath) {
  const pdfjsLib = await import('pdfjs-dist/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjsLib.getDocument({ data, verbosity: 0 }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((it) => it.str).join(' ').replace(/[ \t]+/g, ' ');
    pages.push(text);
  }
  await doc.destroy();
  return pages;
}

/**
 * Score one page's text for "financial summary" likelihood.
 * @param {string} text
 * @returns {number}
 */
function scorePage(text) {
  let score = 0;
  for (const re of METRIC_SIGNALS) if (re.test(text)) score++;
  const yearHeaders = (text.match(YEAR_HEADER_RE) || []).length;
  if (yearHeaders >= 2) score += 2;
  if (yearHeaders >= 3) score += 1;
  // must contain actual numbers to be a table, not a prose mention
  if (!/\d{2,}(?:[.,]\d+)?/.test(text)) score = 0;
  return score;
}

/**
 * Pick the best contiguous window of candidate pages.
 * @param {string[]} pages
 * @param {object} [opts]
 * @param {number} [opts.window=5]   max pages to send
 * @param {number} [opts.maxChars=28000]
 * @returns {{ pageNumbers: number[], scores: number[], tagged: string }}
 */
function selectCandidatePages(pages, opts = {}) {
  const window = opts.window || 5;
  const maxChars = opts.maxChars || 28000;
  const scores = pages.map(scorePage);

  // Find the page with the highest score (the table's "core"), then grow around it.
  let bestIdx = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[bestIdx]) bestIdx = i;

  // Gather the top-scoring pages near the core, preferring contiguous neighbours.
  const picked = new Set([bestIdx]);
  let radius = 1;
  while (picked.size < window && radius < pages.length) {
    for (const j of [bestIdx - radius, bestIdx + radius]) {
      if (j >= 0 && j < pages.length && scores[j] >= 2 && picked.size < window) picked.add(j);
    }
    radius++;
  }

  const ordered = [...picked].sort((a, b) => a - b);
  let tagged = '';
  const usedPages = [];
  for (const idx of ordered) {
    const block = `\n\n===== PAGE ${idx + 1} =====\n${pages[idx]}`;
    if (tagged.length + block.length > maxChars) break;
    tagged += block;
    usedPages.push(idx + 1);
  }
  return {
    pageNumbers: usedPages,
    scores: usedPages.map((p) => scores[p - 1]),
    tagged: tagged.trim(),
  };
}

/**
 * Check whether a quote can be located on its cited page (grounding).
 * Tolerant: needs a meaningful chunk of the quote to appear on the page.
 * @param {string} quote
 * @param {string} pageText
 * @returns {boolean}
 */
function isQuoteGrounded(quote, pageText) {
  if (!quote || !pageText) return false;
  const q = norm(quote);
  const p = norm(pageText);
  if (q.length < 4) return false;
  if (p.includes(q)) return true;
  // Quotes can pick up reflow/spacing noise; require a solid leading chunk to match.
  const head = q.slice(0, Math.min(40, q.length));
  if (p.includes(head)) return true;
  // Token-overlap fallback for number-heavy rows.
  const qTokens = q.split(' ').filter((t) => t.length > 1);
  if (qTokens.length === 0) return false;
  const hits = qTokens.filter((t) => p.includes(t)).length;
  return hits / qTokens.length >= 0.7;
}

/**
 * Extract grounded restated financials from a prospectus PDF.
 *
 * @param {string} filePath
 * @param {object} [opts]  passed through to llmClient (provider, model) and page selection
 * @returns {Promise<object>} structured result with _meta + _grounding
 */
async function extractFinancials(filePath, opts = {}) {
  const pages = await readPageTexts(filePath);
  const candidates = selectCandidatePages(pages, opts);

  if (!candidates.pageNumbers.length || Math.max(0, ...candidates.scores) < 3) {
    return {
      ok: false,
      reason: 'no_financial_pages_found',
      _meta: { sourceFile: filePath, pageCount: pages.length, candidatePages: candidates.pageNumbers },
    };
  }

  const { data, usage, provider, model } = await completeJson({
    system: SYSTEM_PROMPT,
    user: candidates.tagged,
    provider: opts.provider,
    model: opts.model,
    maxTokens: opts.maxTokens || 4096,
  });

  // Grounding pass: verify each metric quote against the cited page text.
  const metrics = Array.isArray(data.metrics) ? data.metrics : [];
  let grounded = 0;
  for (const m of metrics) {
    const pageNum = m.source && m.source.page;
    const pageText = pageNum && pageNum >= 1 && pageNum <= pages.length ? pages[pageNum - 1] : '';
    const ok = isQuoteGrounded(m.source && m.source.quote, pageText);
    m._grounded = ok;
    if (ok) grounded++;
  }
  const groundingScore = metrics.length ? grounded / metrics.length : 0;

  return {
    ok: true,
    ...data,
    _meta: {
      sourceFile: filePath,
      pageCount: pages.length,
      candidatePages: candidates.pageNumbers,
      candidateScores: candidates.scores,
      provider,
      model,
      usage,
      extractedAt: new Date().toISOString(),
    },
    _grounding: {
      metricCount: metrics.length,
      groundedCount: grounded,
      groundingScore: Number(groundingScore.toFixed(3)),
    },
  };
}

module.exports = {
  extractFinancials,
  readPageTexts,
  selectCandidatePages,
  scorePage,
  isQuoteGrounded,
  norm,
};
