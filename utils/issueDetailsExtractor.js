'use strict';

/**
 * issueDetailsExtractor.js — extract IPO offer-structure ("issue details") from
 * RHP markdown, deterministically. Share counts come from the prospectus; ₹
 * amounts are COMPUTED (shares × cap price) since the RHP shows ₹[●].
 *
 * Strategy: match labelled TABLE ROWS first (the glossary/issue tables are the
 * cleanest source), fall back to cover-page prose. Confidence is gated by
 * arithmetic invariants:
 *   post  = pre + fresh
 *   total = fresh + ofs
 *   fresh = marketMaker + employee + net      (reservations + net = fresh)
 *
 * Verified against HORIZON, UTKAL, GENXAI (see rules/issue_details_patterns.json).
 */

const { parseMarkdownTables } = require('./markdownTables');
const { jaroWinkler } = require('./jaroWinkler');

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** Parse an Indian-grouped integer ("1,42,46,200" → 14246200); placeholders → null. */
function parseShares(captured) {
  if (captured == null) return null;
  const t = String(captured).replace(/[*^]/g, '').replace(/,/g, '').trim();
  if (!/^\d+$/.test(t)) return null;
  return parseInt(t, 10);
}

// Label-cell patterns (matched against a normalized table cell).
const LABEL_PATTERNS = {
  totalIssueShares: [/^total\s+(?:issue|offer)\s+size\b/i],
  freshIssueShares: [/^\(?\s*i?\s*\)?\s*fresh\s+(?:issue|offer)(?:\s+size)?\b/i],
  ofsShares: [/^\(?\s*i{0,2}\s*\)?\s*offer\s+for\s+sale\b/i],
  marketMakerShares: [/market\s+maker\s+reservation\s+portion\b/i, /^(?:issue|offer)\s+reserved\s+for\s+the\s+market\s+makers?\b/i, /^reservation\s+for\s+(?:the\s+)?market\s+makers?\b/i],
  employeeReservationShares: [/employee\s+reservation\s+portion\b/i],
  netOfferShares: [/^net\s+(?:issue|offer)(?:\s+to\s+(?:the\s+)?public)?(?:\s*\(\d+\))?\s*$/i],
  preIssueShares: [/equity\s+shares\s+outstanding\s+prior\s+to\s+the\s+(?:issue|offer)/i, /^pre[\s-]*(?:issue|offer)\s+(?:paid[\s-]*up\s+)?(?:equity\s+)?(?:share\s+)?capital\b/i],
  postIssueShares: [/equity\s+shares\s+outstanding\s+after\s+the\s+(?:issue|offer)/i, /^post[\s-]*(?:issue|offer)\s+(?:paid[\s-]*up\s+)?(?:equity\s+)?(?:share\s+)?capital\b/i],
};

// Cover-page prose fallbacks (capture group 1 = share count).
const PROSE_PATTERNS = {
  totalIssueShares: [/total\s+(?:issue|offer)\s+size[^\d]{0,40}?(?:up\s*to\s+)?([\d,]{5,})\s+equity\s+shares/i],
  freshIssueShares: [/(?:the\s+)?fresh\s+(?:issue|offer)\s+of\s+(?:up\s*to\s+)?([\d,]{5,})\s+equity\s+shares/i],
  marketMakerShares: [/([\d,]{4,})\s+equity\s+shares[^.]{0,90}?reserved\s+for\s+subscription\s+by\s+(?:the\s+)?market\s+maker/i],
  employeeReservationShares: [/([\d,]{4,})\s+equity\s+shares[^.]{0,90}?reserved\s+for\s+subscription\s+by\s+(?:the\s+)?(?:eligible\s+)?employees/i],
  netOfferShares: [/(?:issue|offer)\s+less\s+the\s+market\s+maker\s+reservation\s+portion(?:\s+and\s+(?:the\s+)?employee\s+reservation\s+portion)?[^\d]{0,40}?(?:i\.?\s*e\.?|of)\s+(?:up\s*to\s+)?([\d,]{5,})\s+equity\s+shares/i],
  preIssueShares: [/equity\s+shares\s+outstanding\s+prior\s+to\s+the\s+(?:issue|offer)[^\d]{0,30}?([\d,]{5,})/i],
  postIssueShares: [/equity\s+shares\s+outstanding\s+after\s+the\s+(?:issue|offer)[^\d]{0,30}?(?:up\s*to\s+)?([\d,]{5,})/i],
};

/** Extract the share count from a matched table row's non-label cells. */
function sharesFromRow(cells, labelIdx) {
  const joined = cells.map((c, i) => (i === labelIdx ? '' : c)).join(' ');
  const m = joined.match(/([\d][\d,]{3,})\s*[*^]?\s*(?:equity\s+)?shares/i);
  if (m) { const v = parseShares(m[1]); if (v != null) return v; }
  for (let i = 0; i < cells.length; i++) {
    if (i === labelIdx) continue;
    const v = parseShares(cells[i]);
    if (v != null && v >= 1000) return v;
  }
  return null;
}

/** All candidate values for a field from labelled table rows (deduped order kept). */
function allFromTables(tables, patterns) {
  const vals = [];
  for (const t of tables) {
    for (const row of t.rows) {
      for (let i = 0; i < row.length; i++) {
        const cell = norm(row[i]);
        if (!cell || cell.length > 80) continue; // label cells are short
        if (patterns.some((re) => re.test(cell))) {
          const v = sharesFromRow(row, i);
          if (v != null) vals.push(v);
        }
      }
    }
  }
  return vals;
}

function allFromProse(text, patterns) {
  const vals = [];
  for (const re of patterns || []) {
    const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m;
    while ((m = r.exec(text)) !== null) { const v = parseShares(m[1]); if (v != null) vals.push(v); }
  }
  return vals;
}

/** Backward-compatible single-value accessor (first candidate). */
function fromTables(tables, patterns) { return allFromTables(tables, patterns)[0] ?? null; }

/** All candidate values for a field across tables + prose, deduped. */
function candidatesFor(tables, text, field) {
  return [...new Set([...allFromTables(tables, LABEL_PATTERNS[field] || []), ...allFromProse(text, PROSE_PATTERNS[field] || [])])];
}

/**
 * Pick fresh/mm/emp/net so that fresh = mm + emp + net. The arithmetic itself
 * selects the right values from the candidate lists (rejecting glossary typos),
 * preferring combinations that resolve the most reservation parts.
 */
function resolveReservations(freshC, mmC, empC, netC) {
  const fresh = freshC.length ? freshC : [null];
  const mm = [...new Set([...mmC, null])];
  const emp = [...new Set([...empC, null])];
  const net = netC.length ? netC : [null];
  let best = null;
  for (const f of fresh) {
    for (const m of mm) {
      for (const e of emp) {
        for (const n of net) {
          if (f == null || n == null) continue;
          if (f === (m || 0) + (e || 0) + n) {
            const score = (m != null ? 1 : 0) + (e != null ? 1 : 0);
            if (!best || score > best.score) best = { fresh: f, mm: m, emp: e, net: n, score };
          }
        }
      }
    }
  }
  if (best) return best;
  return { fresh: freshC[0] ?? null, mm: mmC[0] ?? null, emp: empC[0] ?? null, net: netC[0] ?? null };
}

/** Pick pre/post so that post = pre + fresh. */
function resolvePrePost(preC, postC, fresh) {
  if (fresh != null) {
    for (const pre of preC) for (const post of postC) if (post === pre + fresh) return { pre, post };
  }
  return { pre: preC[0] ?? null, post: postC[0] ?? null };
}

const NAME_PATTERNS = [
  /([A-Z][A-Za-z&.\s]{3,45}?(?:private\s+)?limited)\s+will\s+act\s+as\s+the\s+market\s+maker/ig,
  /market\s+maker[^.]{0,60}?being\s+([A-Z][A-Za-z&.\s]{3,45}?limited)/ig,
];

function extractMarketMaker(text) {
  const counts = new Map();
  for (const re of NAME_PATTERNS) {
    let m; const r = new RegExp(re.source, re.flags);
    while ((m = r.exec(text)) !== null) {
      const name = norm(m[1]);
      if (name.length < 6) continue;
      let key = name;
      for (const k of counts.keys()) if (jaroWinkler(k.toLowerCase(), name.toLowerCase()) >= 0.9) { key = k; break; }
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  if (!counts.size) return { name: null, variants: [] };
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return { name: sorted[0][0], variants: sorted.map((e) => e[0]) };
}

function deriveSaleType(fresh, ofs) {
  if (fresh && ofs) return 'Fresh + OFS';
  if (ofs && !fresh) return 'Offer for Sale only';
  return 'Fresh capital only';
}

/** Extract issue-details from RHP markdown. */
function extractIssueDetails(md, opts = {}) {
  const isSme = opts.isSme !== false; // default SME (most of our data)
  const tables = parseMarkdownTables(md);
  const text = norm(md);
  const cand = {};
  for (const field of Object.keys(LABEL_PATTERNS)) cand[field] = candidatesFor(tables, text, field);

  const out = {};
  out.ofsShares = cand.ofsShares[0] ?? null;
  const ofsOnly = out.ofsShares != null && cand.freshIssueShares.length === 0
    && /through\s+an\s+offer\s+for\s+sale|solely\s+through\s+an\s+offer\s+for\s+sale|will\s+not\s+receive\s+any\s+proceeds\s+from\s+the\s+offer/i.test(text);

  if (isSme) {
    // SME: market-maker structure; resolve fresh = mm + emp + net by arithmetic.
    const r = resolveReservations(cand.freshIssueShares, cand.marketMakerShares, cand.employeeReservationShares, cand.netOfferShares);
    out.freshIssueShares = r.fresh;
    out.marketMakerShares = r.mm;
    out.employeeReservationShares = r.emp;
    out.netOfferShares = r.net;
  } else {
    // Mainboard: no market maker; offer = fresh + OFS; net = offer − reservations.
    out.marketMakerShares = null;
    out.employeeReservationShares = cand.employeeReservationShares[0] ?? null;
    out.freshIssueShares = ofsOnly ? 0 : (cand.freshIssueShares[0] ?? null);
    out.netOfferShares = cand.netOfferShares[0] ?? null;
  }
  if (out.ofsShares == null && /(ofs\s+size\s+nil|entire\s+(?:issue|offer)\s+constitutes\s+fresh|offer\s+for\s+sale[^.]{0,20}(?:nil|not\s+applicable))/i.test(text)) out.ofsShares = 0;

  // Total = fresh + ofs (or a matching candidate).
  const computedTotal = (out.freshIssueShares != null || out.ofsShares != null) ? (out.freshIssueShares || 0) + (out.ofsShares || 0) : null;
  out.totalIssueShares = cand.totalIssueShares.find((t) => t === computedTotal) ?? cand.totalIssueShares[0] ?? computedTotal;

  const pp = resolvePrePost(cand.preIssueShares, cand.postIssueShares, out.freshIssueShares);
  out.preIssueShares = pp.pre;
  out.postIssueShares = pp.post;
  out._isSme = isSme;

  const mm = extractMarketMaker(text);
  out.marketMakerName = mm.name;
  out._marketMakerVariants = mm.variants;
  out.issueType = /fixed\s+price\s+(?:issue|offer)|100%\s+fixed\s+price/i.test(text) ? 'Fixed Price'
    : /book\s*build/i.test(text) ? 'Bookbuilding' : null;
  out.listingAt = /\bBSE\s*SME\b|SME\s+platform\s+of\s+BSE/i.test(text) ? 'BSE SME'
    : /\bNSE\s+EMERGE\b|emerge\s+platform\s+of\s+(?:the\s+)?(?:national\s+stock\s+exchange|nse)/i.test(text) ? 'NSE SME'
    : /\bBSE\b/.test(text) ? 'BSE' : /\bNSE\b/.test(text) ? 'NSE' : null;
  out.saleType = deriveSaleType(out.freshIssueShares, out.ofsShares);

  out._arithmetic = arithmetic(out, isSme);
  out.confidence = confidenceOf(out._arithmetic, out);
  return out;
}

const eq = (a, b) => a != null && b != null && a === b;

function arithmetic(d, isSme) {
  const checks = {};
  if (d.postIssueShares != null && d.preIssueShares != null && d.freshIssueShares != null) {
    checks.postEqualsPrePlusFresh = eq(d.postIssueShares, d.preIssueShares + d.freshIssueShares);
  }
  if (d.totalIssueShares != null && (d.freshIssueShares != null || d.ofsShares != null)) {
    checks.totalEqualsFreshPlusOfs = eq(d.totalIssueShares, (d.freshIssueShares || 0) + (d.ofsShares || 0));
  }
  if (isSme && d.freshIssueShares != null && d.netOfferShares != null) {
    // SME: missing reservations treated as 0 — so an un-found market maker is caught, not skipped
    checks.freshEqualsReservationsPlusNet = eq(d.freshIssueShares, (d.marketMakerShares || 0) + (d.employeeReservationShares || 0) + d.netOfferShares);
  }
  if (!isSme && d.netOfferShares != null && d.totalIssueShares != null) {
    // Mainboard: net = total offer − employee reservation (− other reservations)
    checks.netEqualsOfferMinusReservations = eq(d.netOfferShares, d.totalIssueShares - (d.employeeReservationShares || 0));
  }
  return checks;
}

function confidenceOf(checks, d) {
  // A meaningful extraction must have a positive offer magnitude somewhere.
  const hasMagnitude = (d.totalIssueShares || 0) > 0 || (d.freshIssueShares || 0) > 0 || (d.ofsShares || 0) > 0;
  const vals = Object.values(checks);
  if (!vals.length || !hasMagnitude) return 'low';
  if (vals.every((c) => c === true)) return 'high';
  if (vals.some((c) => c === false)) return 'needs_review';
  return 'medium';
}

/** Add computed ₹ amounts (shares × cap price). */
function computeAmounts(details, capPrice, isSme = true) {
  const fields = ['totalIssue', 'freshIssue', 'marketMaker', 'employeeReservation', 'netOffer'];
  const amounts = { computable: capPrice != null, capPrice: capPrice || null, unit: isSme ? 'Lakhs' : 'Crore' };
  for (const f of fields) {
    const shares = details[`${f}Shares`];
    if (capPrice == null || shares == null) { amounts[`${f}AmountRupees`] = null; amounts[`${f}Amount`] = null; continue; }
    const rupees = shares * capPrice;
    amounts[`${f}AmountRupees`] = rupees;
    amounts[`${f}Amount`] = Math.round((rupees / (isSme ? 1e5 : 1e7)) * 100) / 100;
  }
  return amounts;
}

module.exports = { extractIssueDetails, computeAmounts, extractMarketMaker, deriveSaleType, parseShares, fromTables, norm };
