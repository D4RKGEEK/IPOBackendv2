import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { extractIntermediaries, cleanPhone } = require('../utils/intermediariesExtractor');

// Condensed real-shape HORIZON cover + general-information lines.
const MD = `
NAME AND LOGO (Equity Shares) BOOK RUNNING LEAD MANAGER: GYR CAPITAL ADVISORS PRIVATE LIMITED
E-MAIL ID AND TELEPHONE E-mail: [horizon.ipo@gyrcapitaladvisors.in](mailto:horizon.ipo@gyrcapitaladvisors.in) Tel: +91 87775 64648
REGISTRAR TO THE ISSUE: KFIN TECHNOLOGIES LIMITED CONTACT PERSON Mr. M Murali Krishna
E-MAIL ID AND TELEPHONE Email: [horizonrec.ipo@kfintech.com](mailto:horizonrec.ipo@kfintech.com) Tel: +91 40 6716 2222
Registered Office: Khasra no. 9, Dehradun Road, Near Nirankari Bhawan, Village - Kumar Hera, Saharanpur - 247001, Uttar Pradesh
Tel: +91 8171000900; Website: [https://horizonreclaim.com/](https://horizonreclaim.com/)
Contact Person: Deeksha Thakral, Company Secretary and Compliance Officer; E-mail id: [cs@horizonreclaim.com](mailto:cs@horizonreclaim.com)
`;

describe('cleanPhone', () => {
  it('normalizes spacing, keeps + and digits', () => {
    expect(cleanPhone('+91 87775 64648')).toBe('+91 87775 64648');
  });
});

describe('extractIntermediaries (HORIZON)', () => {
  const d = extractIntermediaries(MD);

  it('extracts the book running lead manager + contact', () => {
    expect(d.leadManagers).toHaveLength(1);
    expect(d.leadManagers[0].name).toBe('GYR CAPITAL ADVISORS PRIVATE LIMITED');
    expect(d.leadManagers[0].email).toBe('horizon.ipo@gyrcapitaladvisors.in');
    expect(d.leadManagers[0].phone).toMatch(/87775/);
  });

  it('extracts the registrar + contact', () => {
    expect(d.registrar.name).toBe('KFIN TECHNOLOGIES LIMITED');
    expect(d.registrar.email).toBe('horizonrec.ipo@kfintech.com');
    expect(d.registrar.phone).toMatch(/6716/);
  });

  it('extracts the company registered-office contact', () => {
    expect(d.company.registeredOffice).toMatch(/Khasra no\. 9/);
    expect(d.company.email).toBe('cs@horizonreclaim.com');
    expect(d.company.website).toBe('https://horizonreclaim.com/');
    expect(d.company.phone).toMatch(/8171000900/);
    expect(d.company.contactPerson).toMatch(/Deeksha Thakral/);
  });
});

describe('extractIntermediaries (empty / no parties)', () => {
  it('returns empty/null structures gracefully', () => {
    const d = extractIntermediaries('some unrelated prospectus text with no parties');
    expect(d.leadManagers).toEqual([]);
    expect(d.registrar).toBe(null);
    expect(d.company).toBe(null);
  });
});
