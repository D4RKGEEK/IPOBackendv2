import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { extractPromoters, parseNames } = require('../utils/promotersExtractor');

// ─── parseNames unit tests ──────────────────────────────────────────────────

describe('parseNames', () => {
  it('splits comma-separated names', () => {
    expect(parseNames('Hiren Desai, Hetal Desai')).toEqual(['Hiren Desai', 'Hetal Desai']);
  });

  it('handles "and" separator', () => {
    expect(parseNames('Vishal Jain and Mahak Jain')).toEqual(['Vishal Jain', 'Mahak Jain']);
  });

  it('handles "&" separator', () => {
    expect(parseNames('Agarwal & Bansal, Chawla')).toEqual(['Agarwal', 'Bansal', 'Chawla']);
  });

  it('strips "Mr." prefix', () => {
    expect(parseNames('Mr. Pradeep Lohia, Mr. Rakesh Lohia')).toEqual(['Pradeep Lohia', 'Rakesh Lohia']);
  });

  it('strips trailing period', () => {
    expect(parseNames('Hiren Desai, Hetal Desai.')).toEqual(['Hiren Desai', 'Hetal Desai']);
  });

  it('strips trailing AND', () => {
    expect(parseNames('Mohan Agarwal, Pratibha Agarwal, Akshay Agarwal and')).toEqual(['Mohan Agarwal', 'Pratibha Agarwal', 'Akshay Agarwal']);
  });

  it('rejects boilerplate', () => {
    expect(parseNames('THE ISSUE')).toEqual([]);
    expect(parseNames('the offer')).toEqual([]);
  });

  it('dedupes identical names', () => {
    expect(parseNames('John Doe, John Doe')).toEqual(['John Doe']);
  });

  it('handles all-caps with &', () => {
    expect(parseNames('JAGDISH KUMAR SURI, RAHUL SURI AND RAMNIKA SURI'))
      .toEqual(['JAGDISH KUMAR SURI', 'RAHUL SURI', 'RAMNIKA SURI']);
  });

  it('handles comma+AND mixed', () => {
    expect(parseNames('Mohan Agarwal, Pratibha Agarwal, Akshay Agarwal, and Raghav Agarwal'))
      .toEqual(['Mohan Agarwal', 'Pratibha Agarwal', 'Akshay Agarwal', 'Raghav Agarwal']);
  });

  it('handles "and" without preceding comma', () => {
    expect(parseNames('Agarwal and Bansal')).toEqual(['Agarwal', 'Bansal']);
  });
});

// ─── Simple markdown snippets (no R2 dependency) ─────────────────────────────

function coverMd(names) {
  return `Some preamble text. PROMOTERS OF OUR COMPANY: ${names} DETAILS OF THE ISSUE Some more text.`;
}

function glossaryMd(names) {
  return `| Promoter(s) | The promoters of our Company,being ${names}.For details,see"Our Promoter and Promoter Group"on page 165 |`;
}

function headingMd(names) {
  return `OUR PROMOTERS: ${names} THE ISSUE HEREINAFTER REFERRED`;
}

function proseMd(names) {
  return `Our Promoters are ${names}. For further details, please see "Our Promoters" section.`;
}

// ─── extractPromoters integration tests ──────────────────────────────────────

describe('extractPromoters', () => {
  // Cover page patterns
  it('extracts from cover page with colon', () => {
    const r = extractPromoters(coverMd('HIREN DESAI, HETAL DESAI'));
    expect(r.promoters).toEqual(['HIREN DESAI', 'HETAL DESAI']);
    expect(r.confidence).toBe('high');
    expect(r.source).toBe('multi');
  });

  it('extracts from cover page with ARE', () => {
    const md = 'THE PROMOTERS OF OUR COMPANY ARE MOHAN AGARWAL AND PRATIBHA AGARWAL DETAILS OF THE ISSUE';
    const r = extractPromoters(md);
    expect(r.promoters).toEqual(['MOHAN AGARWAL', 'PRATIBHA AGARWAL']);
  });

  it('extracts from cover page bare style (no colon, pipe-terminated)', () => {
    const md = 'OUR PROMOTERS OF THE COMPANY Hardik Gotawala, Abhishek Gotawala | WEBSITE';
    const r = extractPromoters(md);
    expect(r.promoters).toEqual(['Hardik Gotawala', 'Abhishek Gotawala']);
  });

  // Glossary table patterns
  it('extracts from glossary table with "being"', () => {
    const r = extractPromoters(glossaryMd('Hiren Desai and Hetal Desai'));
    expect(r.promoters).toEqual(['Hiren Desai', 'Hetal Desai']);
  });

  it('extracts from short glossary table', () => {
    const md = '| Promoters | Hardik Gotawala, Abhishek Gotawala and Nilesh Gotawala. |';
    const r = extractPromoters(md);
    expect(r.promoters).toEqual(['Hardik Gotawala', 'Abhishek Gotawala', 'Nilesh Gotawala']);
  });

  // Heading patterns
  it('extracts from standalone heading', () => {
    const r = extractPromoters(headingMd('JAGDISH SURI, RAHUL SURI AND RAMNIKA SURI'));
    expect(r.promoters).toEqual(['JAGDISH SURI', 'RAHUL SURI', 'RAMNIKA SURI']);
  });

  // Prose patterns
  it('extracts from prose', () => {
    const r = extractPromoters(proseMd('Jagdish Suri, Rahul Suri and Ramnika Suri'));
    expect(r.promoters).toEqual(['Jagdish Suri', 'Rahul Suri', 'Ramnika Suri']);
  });

  // Table cell pattern (P6)
  it('extracts from table cell with THE ISSUE column', () => {
    const md = 'PROMOTERS OF THE COMPANY: THE ISSUE | HARDIK GOTAWALA, ABHISHEK GOTAWALA, NILESH GOTAWALA |';
    const r = extractPromoters(md);
    expect(r.promoters).toEqual(['HARDIK GOTAWALA', 'ABHISHEK GOTAWALA', 'NILESH GOTAWALA']);
  });

  // Realistic combined docs
  it('extracts VAHH-style', () => {
    const md = [
      'PROMOTERS OF OUR COMPANY: HIREN INDRAVADAN DESAI, HETAL HIRENBHAI DESAI & AAYUSH HIREN DESAI DETAILS OF THE ISSUE',
      '| Promoter(s) | The promoters of our Company,being Hiren Indravadan Desai,Hetal Hirenbhai Desai and Aayush Hiren Desai.For details',
    ].join('\n');
    const r = extractPromoters(md);
    expect(r.promoters).toEqual([
      'HIREN INDRAVADAN DESAI', 'HETAL HIRENBHAI DESAI', 'AAYUSH HIREN DESAI',
    ]);
    expect(r.confidence).toBe('high');
  });

  it('extracts SUSAN-style', () => {
    const md = 'Promoters of our Company: Vishal Jain and Mahak Jain\nINITIAL PUBLIC OFFER';
    const r = extractPromoters(md);
    expect(r.promoters).toEqual(['Vishal Jain', 'Mahak Jain']);
  });

  it('extracts AMIRCHAND-style', () => {
    const md = '|OUR PROMOTERS: JAGDISH KUMAR SURI, RAHUL SURI AND RAMNIKA SURI|';
    const r = extractPromoters(md);
    expect(r.promoters).toEqual(['JAGDISH KUMAR SURI', 'RAHUL SURI', 'RAMNIKA SURI']);
  });

  it('extracts CMRGREEN-style (4 promoters, comma+AND, pipe-terminated)', () => {
    const md = 'OUR PROMOTERS: MOHAN AGARWAL, PRATIBHA AGARWAL, AKSHAY AGARWAL, AND RAGHAV AGARWAL INITIAL PUBLIC OFFERING';
    const r = extractPromoters(md);
    expect(r.promoters).toEqual(['MOHAN AGARWAL', 'PRATIBHA AGARWAL', 'AKSHAY AGARWAL', 'RAGHAV AGARWAL']);
  });

  it('extracts AMBAAUTO-style with Mr. prefixes', () => {
    const md = 'Promoters of our Company: Mr. Pradeep Kumar Lohia, Mr. Rakesh Kumar Lohia and Mr. Vikash Kumar Lohia THE ISSUE';
    const r = extractPromoters(md);
    expect(r.promoters).toEqual(['Pradeep Kumar Lohia', 'Rakesh Kumar Lohia', 'Vikash Kumar Lohia']);
  });

  it('extracts ADISOFT-style', () => {
    const md = 'PROMOTERS OF OUR COMPANY: AJAY CHANDRASHEKHAR PRABHU AND PREETI AJAY PRABHU DETAILS OF THE ISSUE';
    const r = extractPromoters(md);
    expect(r.promoters).toEqual(['AJAY CHANDRASHEKHAR PRABHU', 'PREETI AJAY PRABHU']);
  });

  // Edge cases
  it('returns null for no promoters', () => {
    expect(extractPromoters('Some random text without any promoter mention')).toBeNull();
  });

  it('returns medium confidence for single heading match', () => {
    const md = 'OUR PROMOTERS: SOME NAME THE ISSUE';
    const r = extractPromoters(md);
    expect(r.confidence).toBe('medium');
  });

  it('handles smt. / mrs. prefix', () => {
    const md = 'Promoters of our Company: Smt. Ramnika Suri and Mrs. Preeti Prabhu DETAILS';
    const r = extractPromoters(md);
    expect(r.promoters).toEqual(['Ramnika Suri', 'Preeti Prabhu']);
  });
});
