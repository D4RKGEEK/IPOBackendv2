import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { extractIssueDetails, computeAmounts, extractMarketMaker, deriveSaleType, parseShares } = require('../utils/issueDetailsExtractor');

// Condensed markdown carrying the real HORIZON offer-structure lines.
const HORIZON_MD = `
INITIAL PUBLIC OFFER OF UP TO 52,69,200 EQUITY SHARES (THE "ISSUE") OF WHICH 2,64,000 EQUITY SHARES
AGGREGATING TO Rs [●] LAKHS WILL BE RESERVED FOR SUBSCRIPTION BY MARKET MAKER ("MARKET MAKER RESERVATION
PORTION"). THE ISSUE LESS THE MARKET MAKER RESERVATION PORTION I.E. ISSUE OF 50,05,200 EQUITY SHARES.
ENTIRE ISSUE CONSTITUTES FRESH ISSUE OF EQUITY SHARES. TOTAL ISSUE SIZE Upto 52,69,200 Equity Shares. OFS SIZE Nil.
The Equity Shares are proposed to be listed on the SME platform of BSE Limited ("BSE SME").
The Issue is being made through the Book Building Process.
| Fresh Issue | The Fresh Issue of upto 52,69,200 Equity Shares of face value of Rs 10 each |
| Issue Reserved for the Market Makers | 2,64,000 Equity Shares of face value of Rs10 each |
| Equity Shares outstanding prior to the Issue | 1,42,46,200 Equity Shares of face value of Rs10 each |
| Equity Shares outstanding after the Issue | Upto 1,95,15,400 Equity Shares of face value Rs10 each |
Giriraj Stock Broking Private Limited will act as the Market Maker.
Girtraj Stock Broking Private Limited (OCR typo elsewhere).
`;

describe('parseShares', () => {
  it('parses Indian-grouped integers, strips footnotes', () => {
    expect(parseShares('1,42,46,200')).toBe(14246200);
    expect(parseShares('52,34,000*')).toBe(5234000);
    expect(parseShares('[●]')).toBe(null);
  });
});

describe('extractIssueDetails (HORIZON)', () => {
  const d = extractIssueDetails(HORIZON_MD);
  it('extracts the share counts', () => {
    expect(d.totalIssueShares).toBe(5269200);
    expect(d.freshIssueShares).toBe(5269200);
    expect(d.marketMakerShares).toBe(264000);
    expect(d.netOfferShares).toBe(5005200);
    expect(d.preIssueShares).toBe(14246200);
    expect(d.postIssueShares).toBe(19515400);
    expect(d.ofsShares).toBe(0);
  });
  it('derives sale/issue/listing type', () => {
    expect(d.saleType).toBe('Fresh capital only');
    expect(d.issueType).toBe('Bookbuilding');
    expect(d.listingAt).toBe('BSE SME');
  });
  it('all arithmetic invariants hold → high confidence', () => {
    expect(d._arithmetic.postEqualsPrePlusFresh).toBe(true);
    expect(d._arithmetic.totalEqualsFreshPlusOfs).toBe(true);
    expect(d._arithmetic.freshEqualsReservationsPlusNet).toBe(true);
    expect(d.confidence).toBe('high');
  });
  it('fuzzy-dedupes the market maker name (Giriraj vs OCR Girtraj)', () => {
    expect(d.marketMakerName).toMatch(/Gir.raj Stock Broking Private Limited/);
  });
});

// GENXAI-style: includes an Employee Reservation Portion (the case that broke v1).
const GENXAI_MD = `
| Fresh Issue | The Fresh Issue of up to 47,28,000 Equity Shares aggregating up to Rs [●] Lakhs |
| Market Maker Reservation Portion | The reserved portion of 2,40,000 Equity Shares of Rs 10/- each |
| Net Issue | The Issue (excluding the Market Maker Reservation Portion and Employee Reservation Portion) of 43,08,000 Equity Shares of Face Value of Rs 10 each |
INITIAL PUBLIC ISSUE OF UPTO 47,28,000 EQUITY SHARES OF WHICH 2,40,000 EQUITY SHARES AGGREGATING Rs[●] LAKHS WILL BE RESERVED FOR SUBSCRIPTION BY THE MARKET MAKER AND UP TO 1,80,000 EQUITY SHARES AGGREGATING UP TO Rs[●] LAKHS WILL BE RESERVED FOR SUBSCRIPTION BY ELIGIBLE EMPLOYEES
The Issue is being made through the Book Building Process Listed on NSE EMERGE
`;

describe('extractIssueDetails (GENXAI — with employee reservation)', () => {
  const d = extractIssueDetails(GENXAI_MD);
  it('separates market-maker and employee reservations', () => {
    expect(d.freshIssueShares).toBe(4728000);
    expect(d.marketMakerShares).toBe(240000);   // not 1,80,000 (the employee portion)
    expect(d.employeeReservationShares).toBe(180000);
    expect(d.netOfferShares).toBe(4308000);
  });
  it('fresh = mm + employee + net → high confidence', () => {
    expect(d._arithmetic.freshEqualsReservationsPlusNet).toBe(true);
    expect(d.confidence).toBe('high');
  });
});

// HEXAGON-style: mainboard, pure Offer-for-Sale (no fresh issue, no market maker).
const HEXAGON_MD = `
INITIAL PUBLIC OFFERING OF UP TO 30,859,704 EQUITY SHARES OF FACE VALUE OF Rs 1 EACH THROUGH AN OFFER FOR SALE BY THE SELLING SHAREHOLDERS. Our Company will not receive any proceeds from the Offer.
| Offer for Sale(2) | Up to 30,859,704 Equity Shares of face value of Rs 1 each aggregating up to Rs [●] million |
| Equity Shares outstanding prior to the Offer | 122,918,109 Equity Shares of face value of Rs 1 each |
| Equity Shares outstanding after the Offer | 122,918,109 Equity Shares of face value of Rs 1 each |
The Offer is being made through the Book Building Process. Listed on BSE and NSE.
`;

describe('extractIssueDetails (HEXAGON — mainboard, OFS-only)', () => {
  const d = extractIssueDetails(HEXAGON_MD, { isSme: false });
  it('recognizes pure OFS: fresh 0, no market maker, pre == post', () => {
    expect(d.freshIssueShares).toBe(0);
    expect(d.ofsShares).toBe(30859704);
    expect(d.totalIssueShares).toBe(30859704);
    expect(d.marketMakerShares).toBe(null);
    expect(d.preIssueShares).toBe(122918109);
    expect(d.postIssueShares).toBe(122918109);
    expect(d.saleType).toBe('Offer for Sale only');
  });
  it('mainboard invariants pass → high confidence', () => {
    expect(d._arithmetic.totalEqualsFreshPlusOfs).toBe(true);
    expect(d._arithmetic.postEqualsPrePlusFresh).toBe(true);
    expect(d._arithmetic.freshEqualsReservationsPlusNet).toBeUndefined(); // SME-only check skipped
    expect(d.confidence).toBe('high');
  });
});

describe('computeAmounts', () => {
  it('computes ₹ from shares × cap price (HORIZON cap 103 → ~₹54Cr total)', () => {
    const d = extractIssueDetails(HORIZON_MD);
    const a = computeAmounts(d, 103, true); // SME → Lakhs
    expect(a.computable).toBe(true);
    expect(a.totalIssueAmountRupees).toBe(5269200 * 103); // 542,727,600
    expect(a.marketMakerAmountRupees).toBe(264000 * 103);
    // ₹54.27 Cr = 5427.28 Lakhs
    expect(a.totalIssueAmount).toBeCloseTo(5427.28, 1);
  });
  it('is null/uncomputable without a cap price', () => {
    const a = computeAmounts({ totalIssueShares: 100 }, null, true);
    expect(a.computable).toBe(false);
    expect(a.totalIssueAmount).toBe(null);
  });
});

describe('deriveSaleType', () => {
  it('classifies fresh / OFS combos', () => {
    expect(deriveSaleType(100, 0)).toBe('Fresh capital only');
    expect(deriveSaleType(100, 50)).toBe('Fresh + OFS');
    expect(deriveSaleType(0, 50)).toBe('Offer for Sale only');
  });
});
