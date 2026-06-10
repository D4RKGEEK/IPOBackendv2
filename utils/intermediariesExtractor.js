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

/** Email + phone appearing shortly after an anchor position. */
function contactNear(text, fromIndex, window = 400) {
  const seg = text.slice(fromIndex, fromIndex + window);
  const email = (seg.match(/e-?mail[^@:]{0,14}:?\s*\[?([\w.+-]+@[\w.-]+\.\w{2,})/i) || [])[1] || null;
  const phone = (seg.match(/tel(?:ephone)?\.?\s*:?\s*(\+?\d[\d\s().-]{6,16}\d)/i) || [])[1] || null;
  return { email: cleanEmail(email), phone: cleanPhone(phone) };
}

/** Lead manager(s): the named Book Running Lead Manager(s). */
function extractLeadManagers(text) {
  const found = [];
  const re = new RegExp(`(?:book\\s+running\\s+)?lead\\s+managers?\\s*(?:to\\s+the\\s+(?:issue|offer))?\\s*[,:]?\\s*(${NAME})`, 'ig');
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = canonName(m[1]);
    if (looksLikeName(name)) found.push({ name, ...contactNear(text, m.index) });
  }
  return dedupeParties(found);
}

/** Registrar to the Issue/Offer + its contact. */
function extractRegistrar(text) {
  const found = [];
  const re = new RegExp(`registrar\\s+(?:and\\s+share\\s+transfer\\s+agent\\s+)?to\\s+the\\s+(?:issue|offer)\\s*[,:]?\\s*(${NAME})`, 'ig');
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = canonName(m[1]);
    if (looksLikeName(name)) found.push({ name, ...contactNear(text, m.index) });
  }
  const parties = dedupeParties(found);
  // Prefer the entry carrying contact details.
  return parties.sort((a, b) => (b.email ? 1 : 0) - (a.email ? 1 : 0))[0] || null;
}

/** Company registered office + contact block. */
function extractCompany(text) {
  // Prefer the clean prose block ("Registered Office: <addr> Tel: ... Website: ... E-mail id: ...").
  const office = (text.match(/registered\s+office\s*:\s*(.+?)\s*(?:tel\b|telephone|website|e-?mail|contact\s+person|corporate\s+office)/i) || [])[1];
  const block = text.match(/registered\s+office\s*:[\s\S]{0,400}/i);
  const seg = block ? block[0] : text;
  const tel = (seg.match(/tel(?:ephone)?\.?\s*:?\s*(\+?\d[\d\s().-]{6,16}\d)/i) || [])[1] || null;
  const website = (seg.match(/website\s*:?\s*\[?(https?:\/\/[^\s\])]+)/i) || [])[1] || null;
  const email = (seg.match(/e-?mail(?:\s+id)?\s*:?\s*\[?([\w.+-]+@[\w.-]+\.\w{2,})/i) || [])[1] || null;
  const contactPerson = (seg.match(/contact\s+person\s*:?\s*([A-Z][A-Za-z. ]+?)\s*(?:,|;|\bcompany\s+secretary|\be-?mail|\btel\b)/i) || [])[1] || null;
  const result = {
    registeredOffice: office ? cleanName(office) : null,
    contactPerson: contactPerson ? cleanName(contactPerson) : null,
    email: cleanEmail(email),
    phone: cleanPhone(tel),
    website: website ? website.replace(/[\\)\].*;,'"]+$/, '') : null,
  };
  return Object.values(result).some((v) => v) ? result : null;
}

/**
 * Extract intermediaries/contacts from RHP markdown.
 * @param {string} md
 * @returns {{ leadManagers: object[], registrar: object|null, company: object|null }}
 */
function extractIntermediaries(md) {
  const text = norm(md);
  return {
    leadManagers: extractLeadManagers(text),
    registrar: extractRegistrar(text),
    company: extractCompany(text),
  };
}

module.exports = { extractIntermediaries, extractLeadManagers, extractRegistrar, extractCompany, cleanName, cleanPhone, cleanEmail };
