'use strict';

/**
 * sections.js — single source of truth for all prospectus sections.
 *
 * Everything related to section names, aliases, heading patterns,
 * and which extractor handles each section lives here.
 *
 * Adding a new section? Just add an entry to SECTIONS below.
 */

const SECTIONS = {
  /** Capital structure — share capital, issued/paid-up capital tables */
  capitalStructure: {
    aliases: ['capital structure', 'capitalisation statement', 'capital structure of the company'],
    signals: [/capital structure/i],
    handledBy: 'issueDetailsExtractor',
  },

  /** Objects of the Issue / Offer — use of proceeds */
  objectsOfIssue: {
    aliases: [
      'objects of the offer', 'objects of the issue', 'object of the issue',
      'use of proceeds', 'utilization of proceeds', 'utilisation of net proceeds',
      'objects of the fresh issue',
    ],
    signals: [/objects of the (issue|offer)/i],
    handledBy: 'objectsExtractor',
  },

  /** Basis for Offer Price — KPIs, ratios, NAV, EPS */
  basisForOfferPrice: {
    aliases: [
      'basis for offer price', 'basis for issue price', 'basis of offer price',
      'basis of issue price', 'basis for the offer price', 'basis for the issue price',
    ],
    signals: [/key performance indicator|basis for (the )?(offer|issue) price/i],
    handledBy: 'kpiExtractor',
  },

  /** Restated Financial Statements — P&L, balance sheet, cash flow */
  financials: {
    aliases: [
      'restated financial statements', 'restated financial statement',
      'restated financial information', 'restated consolidated financial statements',
      'restated consolidated financial information', 'financial information',
      'financial information of the company', 'audited financial statements',
    ],
    signals: [/restated|financial statements|profit (and|&) loss|balance sheet/i],
    handledBy: 'financialsExtractor',
  },

  /** Risk Factors */
  riskFactors: {
    aliases: ['risk factors'],
    signals: [/risk factors/i],
    handledBy: null, // not extracted — prose only
  },

  /** Our Management — board of directors, key managerial personnel */
  management: {
    aliases: ['our management'],
    signals: [/our management|board of directors/i],
    handledBy: null,
  },

  /** Our Promoters and Promoter Group */
  promoters: {
    aliases: [
      'our promoters and promoter group', 'our promoters & promoter group',
      'our promoter & promoter group',
    ],
    signals: [], // handled by extractProMoters which scans the whole doc for cover/glossary
    handledBy: 'promotersExtractor',
  },

  /** Issue Structure — offer structure, lot size, market maker */
  issueStructure: {
    aliases: ['issue structure', 'offer structure', 'issue procedure', 'terms of the issue', 'terms of the offer'],
    signals: [], // issue details extractor scans cover + mixed sections
    handledBy: 'issueDetailsExtractor',
  },

  /** Intermediaries — lead managers, registrar, company info */
  intermediaries: {
    aliases: ['general information', 'general information of the company'],
    signals: [],
    handledBy: 'intermediariesExtractor',
  },
};

/** Short -> canonical name mapping for backward compat with documentService. */
const SHORT_TO_CANONICAL = {
  'financials': 'financials',
  'risk-factors': 'riskFactors',
  'objects-of-issue': 'objectsOfIssue',
  'capital-structure': 'capitalStructure',
  'management': 'management',
  'kpis': 'basisForOfferPrice',
};

function canonicalName(shortName) {
  return SHORT_TO_CANONICAL[shortName] || shortName;
}

function shortName(canonicalName) {
  const map = {};
  for (const [short, canon] of Object.entries(SHORT_TO_CANONICAL)) map[canon] = short;
  return map[canonicalName] || canonicalName;
}

module.exports = { SECTIONS, SHORT_TO_CANONICAL, canonicalName, shortName };
