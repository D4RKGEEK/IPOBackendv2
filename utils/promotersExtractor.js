'use strict';

/**
 * promotersExtractor.js — extract promoter names from RHP/DRHP markdown.
 *
 * Three-path extraction (all deterministic, no LLM):
 *   1. Cover page / heading phrases
 *   2. Glossary table definitions
 *   3. Prose sentences
 *
 * Names are split, deduplicated, and returned with a confidence score.
 */

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** Known non-name boilerplate that can appear after "PROMOTERS OF THE COMPANY:" */
const NON_NAMES = /^(?:the\s+)?(?:issue|offer)\s*$/i;

/** Words that indicate a phrase is NOT a promoter name (lowercase). */
const STOP_WORDS = /\b(?:interested|regarded|director|extent|their|they|our|the|being|shall|may|company|also|such|these|those|been|have|has|had|from|thereof|thereto|therein|herein|himself|herself|itself|themselves|pursuant|accordance|relation|shareholding|dividend|entitlement|remuneration|reimbursement|expenses|rendered|services|managerial|personnel|sitting|fees|commission|bonus|profit|equity|loan|advance|deposit|property|taken|lease|rent|properties|encumbered|pledged|insured|life|insurance|policy|policies|max|life|aditya|sun|birla|financial|security|nominees|personal|accident|tata|aig|covering|accidental|death|disability|injury|group|entities|transactions|entered|themselves)\b/i;

/**
 * Check if a string looks like a real person name (not prose/paragraph junk).
 */
function isName(s) {
  // Must start with uppercase letter, 3-60 chars, mostly letters/spaces/dots
  if (!/^[A-Z][a-zA-Z\s.]+$/.test(s)) return false;
  // Must not contain stop words (prose indicators)
  if (STOP_WORDS.test(s)) return false;
  // Must have at least 2 words or be a single word ≥ 5 chars
  const words = s.trim().split(/\s+/);
  if (words.length === 1 && words[0].length < 5) return false;
  return true;
}

/**
 * Parse a combined promoter names string into an array of individual names.
 */
function parseNames(raw) {
  let s = norm(raw);
  if (!s || NON_NAMES.test(s)) return [];
  if (s.endsWith('.')) s = s.slice(0, -1).trim();
  // Strip trailing "AND" / "&" (leftover from truncation at pipe)
  s = s.replace(/\s+(?:and|&)\s*$/i, '');
  // Replace " and " / " & " with comma
  s = s.replace(/\s+(?:and|&)\s+/gi, ',');
  const parts = s.split(',').map((p) => p.trim()).filter(Boolean);
  const seen = new Set();
  const out = [];
  for (let p of parts) {
    p = p.replace(/^(?:mr|mrs|ms|shri|smt)[.\s]+/i, '').trim();
    if (!p || p.length < 3) continue;
    // Filter out non-name phrases
    if (!isName(p)) continue;
    const key = p.toLowerCase().replace(/[^a-z]/g, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/**
 * Patterns tried in order.
 *
 * Terminator words after the names list (these are NOT promoter names):
 *   DETAILS, INITIAL, THE ISSUE, THE OFFER, ACTING, FOR, WILL NOT,
 *   OFFER FOR, ISSUE OF, AGGREGATING, HEREINAFTER, AND THE NET,
 *   TYPE, NAME OF, SHALL BE, AND STATUTORY, BEING SOLD, BEING MADE,
 *   UP TO, OUT OF, THE COMPANY, OFFER SIZE
 */
const TERM = '(?:details|initial|the\\s+(?:issue|offer|company)|general|acting|for\\s+(?:cash|the|further)|will\\s+not|offer\\s+(?:for|size|to)|issue\\s+of|aggregating|hereinafter|and\\s+the\\s+net|type|name\\s+of|shall\\s+be|and\\s+statutory|being\\s+(?:sold|made)|up\\s+to|out\\s+of|[|]\\s)';

const PATTERNS = [
  // P1: "PROMOTERS OF OUR COMPANY: <names>" — standard cover page with colon (also handles "PROMOTER S" typo)
  { re: new RegExp(`(?:promoters?|promoter\\s+s)\\s+of\\s+(?:our\\s+|the\\s+)?company\\s*[:;]\\s*([A-Z][A-Za-z\\s,.&()\\/]+?)(?=\\s+(?:${TERM}))`, 'i'), source: 'cover' },

  // P1b: "PROMOTERS OF OUR COMPANY ARE <names>" — cover page with ARE
  { re: new RegExp(`(?:the\\s+)?promoters?\\s+of\\s+(?:our\\s+|the\\s+)?company\\s+are\\s+([A-Z][A-Za-z\\s,.&()\\/]+?)(?=\\s+(?:${TERM}))`, 'i'), source: 'cover' },

  // P1c: "PROMOTERS OF OUR COMPANY <names> DETAILS" — no colon, only space; negative lookahead avoids eating "ARE <names>" (handled by P1b)
  { re: new RegExp(`(?:promoters?|promoter\\s+s)\\s+of\\s+(?:our\\s+|the\\s+)?company\\s+(?!are\\s)([A-Z][A-Za-z\\s,.&()\\/]+?)(?=\\s+(?:${TERM}))`, 'i'), source: 'cover' },

  // P1d: "NAME OF THE PROMOTERS OF THE COMPANY <names>" (e.g. BMLL)
  { re: new RegExp(`name\\s+of\\s+the\\s+promoters?\\s+of\\s+(?:our\\s+|the\\s+)?company\\s+([A-Z][A-Za-z\\s,.&()\\/]+?)(?=\\s+(?:${TERM}))`, 'i'), source: 'cover' },

  // P2: Glossary table — "| Promoter(s) | The promoters of our Company, being <names> |"
  { re: /promoter\(?s?\)?\s*\|\s*the\s+promoters?\s+of\s+(?:our\s+|the\s+)?company,?\s*being\s+([A-Za-z\s,.&()]+?)(?:\.\s*(?:for|see|\|)|\.(?:f|F)or|\.(?:s|S)ee|\.\|)/i, source: 'glossary' },

  // P2b: Glossary table — "| Promoters | <names> |" (shorter form). Names must contain a space (at least 2 words) to avoid matching "Sr. No" etc.
  { re: /promoters?\s*\|\s*([A-Z][A-Za-z\s,.&]{8,}?\s[A-Za-z][A-Za-z\s,.&]+?)\.\s*(?:\|)/i, source: 'glossary' },

  // P3: Standalone heading — "OUR PROMOTERS: <names>" followed by pipe or end
  { re: /our\s+promoters?\s*:\s*([A-Z][A-Z\s,.&]{5,}?)(?=\s*(?:\||details|the\s+issue|initial|offer))/i, source: 'heading' },

  // P4: Prose — "Our Promoters are <names>."  Max 120 chars to avoid paragraph captures.
  { re: /our\s+promoters?\s+(?:are|is)\s+([A-Z][A-Za-z\s,.&()]{3,120}?)(?:\.\s+(?:for|as\s+on|the\s+words|and\s+has|and\s+our|in))/i, source: 'prose' },

  // P5: Present tense — "Present Promoters of the Company are <names>"
  { re: /present\s+promoters?\s+of\s+(?:our\s+|the\s+)?company\s+are\s+([A-Z][A-Za-z\s,.&]{3,80}?)(?:\.\s)/i, source: 'present' },

  // P6: Table cell — "PROMOTERS OF THE COMPANY: THE ISSUE | <names> |"
  { re: /promoters?\s+of\s+(?:our\s+|the\s+)?company\s*:\s*the\s+issue\s*\|\s*([A-Z][A-Z\s,.&]{5,}?)(?=\s*\|)/i, source: 'table-cell' },
];

/**
 * Extract promoter names from RHP/DRHP markdown.
 * Returns null when no promoters found; otherwise:
 *   { promoters: string[], confidence: 'high'|'medium', source: string }
 */
function extractPromoters(md) {
  const text = norm(md);
  const hits = [];

  for (const { re, source } of PATTERNS) {
    const m = text.match(re);
    if (m) {
      const captured = m[1] || m[2];
      if (captured && captured.trim().length >= 5) {
        const names = parseNames(captured);
        if (names.length >= 1) {
          hits.push({ names, source });
        }
      }
    }
  }

  if (hits.length === 0) return null;

  // Dedupe: collect all unique names across all hits (deduped by normalized form)
  const seen = new Set();
  const allNames = [];
  for (const h of hits) {
    for (const n of h.names) {
      const key = n.toLowerCase().replace(/[^a-z]/g, '');
      if (!seen.has(key)) { seen.add(key); allNames.push(n); }
    }
  }
  if (!allNames.length) return null;

  // Prefer cover page source
  const cover = hits.find((h) => h.source === 'cover');
  if (cover) return { promoters: allNames, confidence: 'high', source: 'multi' };

  // 2+ patterns = high confidence
  const uniqueSources = new Set(hits.map((h) => h.source));
  if (uniqueSources.size >= 2 || hits.length >= 2) {
    return { promoters: allNames, confidence: 'high', source: 'multi' };
  }

  // Single non-cover pattern
  return { promoters: allNames, confidence: 'medium', source: hits[0].source };
}

module.exports = { extractPromoters, parseNames };
