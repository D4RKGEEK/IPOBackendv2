'use strict';

/**
 * llmClient.js
 * Provider-agnostic chat client for structured (JSON) extraction.
 *
 * Supported providers (selected via LLM_PROVIDER, default "deepseek"):
 *   - "deepseek"  (default) — OpenAI-compatible /chat/completions, uses DEEPSEEK_API_KEY
 *   - "openai"              — OpenAI /chat/completions, uses OPENAI_API_KEY
 *   - "anthropic"           — Anthropic /v1/messages, uses ANTHROPIC_API_KEY
 *
 * The whole pipeline only ever calls completeJson(), so swapping providers is a
 * one-line env change. No SDK dependency — uses global fetch (Node 18+).
 */

const PROVIDERS = {
  deepseek: {
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com',
    keyEnv: 'DEEPSEEK_API_KEY',
    defaultModel: 'deepseek-chat',
  },
  openai: {
    kind: 'openai',
    baseUrl: 'https://api.openai.com',
    keyEnv: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4o-mini',
  },
  anthropic: {
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    keyEnv: 'ANTHROPIC_API_KEY',
    defaultModel: 'claude-haiku-4-5-20251001',
  },
};

function resolveProvider(name) {
  const key = (name || process.env.LLM_PROVIDER || 'deepseek')
    .toString()
    .toLowerCase()
    .trim();
  const cfg = PROVIDERS[key];
  if (!cfg) {
    throw new Error(`Unknown LLM provider "${key}". Supported: ${Object.keys(PROVIDERS).join(', ')}`);
  }
  return { name: key, ...cfg };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Strip ```json fences and pull the first balanced JSON object/array out of a
 * string, so we survive providers that ignore json-mode or wrap output.
 * @param {string} text
 * @returns {string}
 */
function extractJsonText(text) {
  if (!text) throw new Error('Empty LLM response');
  let t = text.trim();
  // Remove code fences
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  // If it already parses, done
  try {
    JSON.parse(t);
    return t;
  } catch (_) { /* fall through to brace scan */ }
  // Scan for first balanced { } or [ ]
  const start = t.search(/[\[{]/);
  if (start === -1) throw new Error('No JSON found in LLM response');
  const open = t[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else {
      if (c === '"') inStr = true;
      else if (c === open) depth++;
      else if (c === close) { depth--; if (depth === 0) return t.slice(start, i + 1); }
    }
  }
  throw new Error('Unbalanced JSON in LLM response');
}

async function callOpenAICompatible(cfg, apiKey, { system, user, model, temperature, maxTokens }) {
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: model || cfg.defaultModel,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: temperature ?? 0,
      max_tokens: maxTokens ?? 4096,
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`LLM HTTP ${res.status}: ${body.slice(0, 500)}`);
    err.status = res.status;
    throw err;
  }
  const json = await res.json();
  const content = json.choices?.[0]?.message?.content;
  return { content, usage: json.usage || null };
}

async function callAnthropic(cfg, apiKey, { system, user, model, temperature, maxTokens }) {
  const res = await fetch(`${cfg.baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model || cfg.defaultModel,
      max_tokens: maxTokens ?? 4096,
      temperature: temperature ?? 0,
      system: `${system}\n\nRespond with a single valid JSON object only. No prose, no code fences.`,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`LLM HTTP ${res.status}: ${body.slice(0, 500)}`);
    err.status = res.status;
    throw err;
  }
  const json = await res.json();
  const content = (json.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { content, usage: json.usage || null };
}

/**
 * Run a single JSON-returning completion, with retry on transient errors and
 * on JSON-parse failure.
 *
 * @param {object} opts
 * @param {string} opts.system   - system / instruction prompt
 * @param {string} opts.user     - user content (the document text)
 * @param {string} [opts.provider]
 * @param {string} [opts.model]
 * @param {number} [opts.temperature=0]
 * @param {number} [opts.maxTokens=4096]
 * @param {number} [opts.retries=3]
 * @returns {Promise<{ data: any, raw: string, usage: object|null, provider: string, model: string }>}
 */
async function completeJson(opts) {
  const cfg = resolveProvider(opts.provider);
  const apiKey = process.env[cfg.keyEnv];
  if (!apiKey) {
    throw new Error(`Missing API key: set ${cfg.keyEnv} in your environment (.env)`);
  }
  const model = opts.model || cfg.defaultModel;
  const retries = opts.retries ?? 3;
  const call = cfg.kind === 'anthropic' ? callAnthropic : callOpenAICompatible;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const { content, usage } = await call(cfg, apiKey, { ...opts, model });
      const jsonText = extractJsonText(content);
      return { data: JSON.parse(jsonText), raw: content, usage, provider: cfg.name, model };
    } catch (e) {
      lastErr = e;
      const transient = !e.status || e.status === 429 || e.status >= 500;
      if (attempt < retries && transient) {
        await sleep(800 * Math.pow(2, attempt)); // 0.8s, 1.6s, 3.2s
        continue;
      }
      if (attempt < retries && /JSON/i.test(e.message)) {
        continue; // re-ask once more for malformed JSON
      }
      break;
    }
  }
  throw new Error(`completeJson failed after ${retries + 1} attempts: ${lastErr?.message}`);
}

module.exports = { completeJson, resolveProvider, extractJsonText, PROVIDERS };
