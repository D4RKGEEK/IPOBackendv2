'use strict';

/**
 * intermediariesExtractor.js — extract the IPO's parties/contacts from RHP
 * markdown: Book Running Lead Manager(s), Registrar, and the company's
 * registered-office contact block. Deterministic regex; no LLM.
 *
 * (Lead-manager "performance reports" are an external website feature, not in
 * the prospectus, so they are out of scope here.)
 */

const { jaroWinkler } = require('./jaroWinkler');

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const cleanName = (s) => norm(s).replace(/[•·*"“”]/g, '').replace(/\s*,\s*$/, '').trim();
const cleanEmail = (s) => (s ? s.toLowerCase().trim() : null);
const cleanPhone = (s) => (s ? norm(s).replace(/[^\d+]/g, (m, i) => (i === 0 && m === '+' ? '+' : ' ')).replace(/\s+/g, ' ').trim() : null);

// A company/LLP name: ends in Limited/Ltd/LLP (case-insensitive capture; cleaned after).
const NAME = "[A-Za-z][A-Za-z0-9&.,'’() -]{3,80}?\\b(?:Private\\s+Limited|Limited|Ltd\\.?|LLP)";

/**
 * Strip glossary lead-in phrases ("... to the Issue, in this case being X") so
 * the captured group reduces to the actual party name.
 */
function canonName(s) {
  let n = cleanName(s);
  if (/\bbeing\b/i.test(n)) n = n.replace(/^.*?\bbeing\s+/i, '');
  n = n.replace(/^(?:the\s+|sole\s+|book\s+running\s+|lead\s+managers?\b[,:]?\s*|registrar\b[,:]?\s*|to\s+the\s+(?:issue|offer)\b[,]?\s*|in\s+this\s+case\s+)+/i, '').trim();
  return n;
}

// Entities that end in "Limited" but are NOT IPO intermediaries.
const NON_PARTY = /stock\s+exchange|national\s+stock|securities\s+and\s+exchange\s+board|\bsebi\b|\brta\b|\bnsdl\b|\bcdsl\b|sponsor\s+bank|banker\s+to|escrow|depositor/i;

/** A plausible intermediary name: starts uppercase, ends in Limited/LLP, not a stopword/non-party. */
function looksLikeName(n) {
  return /^[A-Z]/.test(n) && /\b(?:Limited|Ltd\.?|LLP)\b/i.test(n) && n.length >= 6
    && !/^(?:to|in|the|being|a|of)\b/i.test(n) && !NON_PARTY.test(n);
}

/** Merge contact info into fuzzy-deduped name clusters (handles "Private Limited" vs "Limited"). */
function dedupeParties(list) {
  const out = [];
  for (const p of list) {
    const hit = out.find((e) => jaroWinkler(e.name.toLowerCase(), p.name.toLowerCase()) >= 0.9);
    if (hit) { hit.email = hit.email || p.email; hit.phone = hit.phone || p.phone; }
    else out.push({ name: p.name, email: p.email, phone: p.phone });
  }
  return out;
}

/** First significant lowercase token of a name (e.g. "Marwadi…" → "marwadi"). */
function nameToken(name) {
  const m = String(name || '').toLowerCase().match(/[a-z]{4,}/);
  return m ? m[0] : null;
}

/** Find an email whose local-part or domain contains the party's name token. */
function emailFor(text, name) {
  const token = nameToken(name);
  if (!token) return null;
  const m = text.match(new RegExp(`([\\w.+-]*${token}[\\w.+-]*@[\\w.-]+\\.\\w{2,}|[\\w.+-]+@[\\w.-]*${token}[\\w.-]*\\.\\w{2,})`, 'i'));
  return m ? cleanEmail(m[1]) : null;
}

/** Find a website URL whose host contains the token. */
function websiteFor(text, name) {
  const token = nameToken(name);
  if (!token) return null;
  const m = text.match(new RegExp(`(https?:\\/\\/[\\w.-]*${token}[\\w.-]*\\.[^\\s\\])]+)`, 'i'));
  return m ? m[1].replace(/[\\)\].*;,'"]+$/, '') : null;
}

const PHONE_RE = /(?:tel(?:ephone)?\.?\s*(?:no\.?)?|phone|mobile)\s*[:.]?\s*(\+?\d[\d\s().-]{6,16}\d)/i;

/**
 * A labelled phone near an anchor: prefer the phone AFTER the anchor (a party's
 * phone typically follows its name/email), else the nearest phone before it.
 */
function phoneNear(text, idx, fwd = 300, back = 220) {
  const after = text.slice(idx, idx + fwd).match(PHONE_RE);
  if (after) return cleanPhone(after[1]);
  const before = [...text.slice(Math.max(0, idx - back), idx).matchAll(new RegExp(PHONE_RE, 'ig'))];
  return before.length ? cleanPhone(before[before.length - 1][1]) : null;
}

/** Resolve a party's email (by name domain) + phone (anchored to that email). */
function partyContact(text, name, anchorIdx) {
  const email = emailFor(text, name);
  const idx = email ? text.indexOf(email) : anchorIdx;
  return { email, phone: phoneNear(text, idx >= 0 ? idx : anchorIdx) };
}

/** Lead manager(s): the named Book Running Lead Manager(s). */
function extractLeadManagers(text) {
  const found = [];
  const re = new RegExp(`(?:book\\s+running\\s+)?lead\\s+managers?\\s*(?:to\\s+the\\s+(?:issue|offer))?\\s*[,:]?\\s*(${NAME})`, 'ig');
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = canonName(m[1]);
    if (looksLikeName(name)) found.push({ name, ...partyContact(text, name, m.index) });
  }
  return dedupeParties(found);
}

/** Registrar to the Issue/Offer + its contact. ("/" separator handles glossary forms.) */
function extractRegistrar(text) {
  const found = [];
  const re = new RegExp(`registrar\\s+(?:and\\s+share\\s+transfer\\s+agent\\s+)?to\\s+the\\s+(?:issue|offer)\\s*[/,:]?\\s*(${NAME})`, 'ig');
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = canonName(m[1]);
    if (looksLikeName(name)) found.push({ name, ...partyContact(text, name, m.index) });
  }
  const parties = dedupeParties(found);
  return parties.sort((a, b) => (b.email ? 1 : 0) - (a.email ? 1 : 0))[0] || null;
}

/** Company registered office + contact. Uses the company name to resolve its
 *  own email/website by domain (robust to scrambled cover tables). */
function extractCompany(text, companyName) {
  // The clean office line has a colon ("Registered Office: <addr>"); the garbled
  // cover ("REGISTERED OFFICE | |") does not, so requiring the colon avoids junk.
  const officeRe = /registered\s+office\s*:\s*(.+?)\s*(?:tel\b|telephone|website|e-?mail|contact\s+person|corporate\s+office|corporate\s+identity)/i;
  const office = (text.match(officeRe) || [])[1];
  const officeIdx = text.search(/registered\s+office/i);
  const block = officeIdx >= 0 ? text.slice(officeIdx, officeIdx + 700) : text;

  // Company email/website by domain token (e.g. "Vahh Chemicals" → vahhchemicals.com).
  let email = companyName ? emailFor(text, companyName) : null;
  let website = companyName ? websiteFor(text, companyName) : null;
  // Fallbacks: a labelled email/website within the office block.
  if (!email) email = (block.match(/e-?mail(?:\s+id)?\s*:?\s*\[?([\w.+-]+@[\w.-]+\.\w{2,})/i) || [])[1] || null;
  if (!website) website = (block.match(/(https?:\/\/[^\s\])]+)/i) || [])[1] || null;

  // Phone anchored to the company email (reliable) rather than the office label.
  const phone = phoneNear(text, email ? text.indexOf(email) : (officeIdx >= 0 ? officeIdx : 0));
  const contactPerson = (block.match(/contact\s+person\s*:?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/i) || [])[1] || null;

  const result = {
    registeredOffice: office ? cleanName(office) : null,
    contactPerson: contactPerson ? cleanName(contactPerson) : null,
    email: cleanEmail(email),
    phone,
    website: website ? website.replace(/[\\)\].*;,'"]+$/, '') : null,
  };
  return Object.values(result).some((v) => v) ? result : null;
}

/**
 * Extract intermediaries/contacts from RHP markdown.
 * @param {string} md
 * @returns {{ leadManagers: object[], registrar: object|null, company: object|null }}
 */
function extractIntermediaries(md, opts = {}) {
  const text = norm(md);
  return {
    leadManagers: extractLeadManagers(text),
    registrar: extractRegistrar(text),
    company: extractCompany(text, opts.companyName),
  };
}

module.exports = { extractIntermediaries, extractLeadManagers, extractRegistrar, extractCompany, cleanName, cleanPhone, cleanEmail };
