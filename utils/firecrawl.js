'use strict';

/**
 * firecrawl.js — minimal Firecrawl client for turning a (PDF) URL into markdown.
 *
 * Firecrawl parses PDFs into clean markdown TABLES, which we then parse
 * deterministically (no LLM on the numbers). Large prospectuses (300+ pages)
 * need a generous timeout; Firecrawl returns a specific error telling us the
 * minimum required ms, which we parse and retry with automatically.
 *
 * Config (.env): FIRECRAWL_API_KEY
 */

const API_URL = 'https://api.firecrawl.dev/v1/scrape';
const DEFAULT_TIMEOUT_MS = 90000;
const MAX_TIMEOUT_MS = 280000;

/**
 * Parse the "increase the timeout ... to at least Xms" hint out of Firecrawl's
 * SCRAPE_PDF_INSUFFICIENT_TIME_ERROR. Returns the suggested ms, or null.
 */
function parseRequiredTimeout(errBody) {
  const text = typeof errBody === 'string' ? errBody : JSON.stringify(errBody || {});
  if (!/INSUFFICIENT_TIME|timeout/i.test(text)) return null;
  const m = text.match(/at least\s*([\d,]+)\s*ms/i);
  if (m) return parseInt(m[1].replace(/,/g, ''), 10);
  const secs = text.match(/(\d+)\s*seconds?/i);
  return secs ? parseInt(secs[1], 10) * 1000 : null;
}

/** Get the API key or throw. */
function getApiKey(env = process.env) {
  const key = env.FIRECRAWL_API_KEY;
  if (!key) throw new Error('Missing FIRECRAWL_API_KEY');
  return key;
}

async function rawScrape(url, { formats = ['markdown'], timeout = DEFAULT_TIMEOUT_MS } = {}) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getApiKey()}` },
    body: JSON.stringify({ url, formats, timeout }),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

/**
 * Scrape a URL to markdown, auto-bumping the timeout if Firecrawl says the PDF
 * needs more time.
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {number} [opts.timeout]   initial timeout ms
 * @param {number} [opts.retries=1] extra attempts after a timeout-hint bump
 * @returns {Promise<{ markdown, metadata, status, timeoutUsed }>}
 */
async function scrapeToMarkdown(url, opts = {}) {
  let timeout = opts.timeout || DEFAULT_TIMEOUT_MS;
  const retries = opts.retries ?? 1;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const { ok, status, json } = await rawScrape(url, { timeout });
    if (ok && json.data) {
      return {
        markdown: json.data.markdown || '',
        metadata: json.data.metadata || null,
        status,
        timeoutUsed: timeout,
      };
    }
    // Auto-bump on the page-count timeout error.
    const required = parseRequiredTimeout(json.error || json);
    if (required && attempt < retries) {
      timeout = Math.min(MAX_TIMEOUT_MS, Math.ceil((required + 10000) / 1000) * 1000);
      continue;
    }
    const msg = json.error || `HTTP ${status}`;
    throw new Error(`Firecrawl scrape failed: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
  }
  throw new Error('Firecrawl scrape failed: exhausted retries');
}

/**
 * Parse HTML content directly via Firecrawl /v2/parse with file upload.
 * No R2 upload needed — sends the HTML as a multipart file.
 *
 * @param {string} htmlContent — raw HTML string
 * @param {string} filename — e.g. "financials_p15-38.html"
 * @param {object} schema — JSON Schema for structured output
 * @param {string} prompt — extraction instructions
 * @param {object} [opts] — { timeout }
 * @returns {Promise<object>} parsed JSON data
 */
async function parseHtml(htmlContent, filename, schema, prompt, opts = {}) {
  const form = new FormData();
  const blob = new Blob([htmlContent], { type: 'text/html' });
  form.append('file', blob, filename);
  form.append('options', JSON.stringify({
    onlyMainContent: true,
    formats: [{ type: 'json', schema, prompt }],
  }));

  const timeout = opts.timeout || 120000;
  const res = await fetch('https://api.firecrawl.dev/v2/parse', {
    method: 'POST',
    headers: { Authorization: `Bearer ${getApiKey()}` },
    body: form,
    signal: AbortSignal.timeout(timeout),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json.error || `HTTP ${res.status}`;
    throw new Error(`Firecrawl parse failed: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
  }
  return json.data?.json || json.data || json;
}

module.exports = { scrapeToMarkdown, parseHtml, parseRequiredTimeout, getApiKey, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS };
