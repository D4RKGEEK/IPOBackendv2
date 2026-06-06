# Requirements: IPO Scraper & Tracker

**Defined:** 2026-06-06
**Core Value:** Regularly updated, deduplicated, and clean IPO tracking and financial data.

## v1 Requirements

Requirements for the initial release, mapped to roadmap phases.

### Ingestion (INGEST)

- [x] **INGEST-01**: Ingest active, upcoming, and closed IPO metadata from the Upstox API.
- [ ] **INGEST-02**: Ingest IPO schedules and document links from the NSE-BSE API using a browser-emulated session handshake with cookie persistence.

### Merge & Deduplication (MERGE)

- [ ] **MERGE-01**: Merge and deduplicate IPO records across Upstox and NSE-BSE feeds by primary key matches (ISIN, normalized Symbol) or fuzzy company name matching (Jaro-Winkler distance) with date-range safety checks.
- [x] **MERGE-02**: Save the consolidated listings list to a local atomic JSON file (`ipo_master.json`) using the write-temp-then-rename pattern.

### Prospectus Processing (DOCS)

- [ ] **DOCS-01**: Download prospectus PDFs (DRHP, RHP, Final) locally from URLs present in the API payloads.
- [ ] **DOCS-02**: Dynamically locate printed page ranges for target sections (e.g. `OBJECTS_OF_THE_OFFER` and `BASIS_FOR_OFFER_PRICE` or their aliases) in the PDF via streaming table-of-contents / regex heading matches.
- [ ] **DOCS-03**: Isolate and slice the identified page range into a smaller local PDF file using `pdf-lib` without loading the full document into memory.
- [ ] **DOCS-04**: Convert the isolated PDF section into a clean Markdown document.

### Staging (STAGE)

- [ ] **STAGE-01**: Upload isolated Markdown prospectus sections to a Cloudflare R2 bucket using `@aws-sdk/client-s3`.
- [ ] **STAGE-02**: Store and cache R2 upload URLs locally to prevent redundant uploads on subsequent runs.

### Financial Extraction (EXTRACT)

- [ ] **EXTRACT-01**: Parse staged prospectus Markdown sections using Firecrawl's structured extraction tool to fetch key financial ratios.
- [ ] **EXTRACT-02**: Retrieve target indicators (Pre/Post IPO P/E, EPS, RoNW, debt/equity, promoter holding, EBITDA/PAT margins, and Issue Objects) via DeepSeek.
- [ ] **EXTRACT-03**: Validate LLM output JSON structures using Zod runtime schemas and run post-extraction sanity/mathematical checks.

### Grey Market Premium (GMP)

- [ ] **GMP-01**: Crawl the InvestorGain LIST API to fetch the current snapshot of Grey Market Premiums for all active and upcoming listings.
- [ ] **GMP-02**: Crawl the InvestorGain DETAIL API to aggregate daily historical GMP trends and store them in the database.

### Historical Prices (PRICES)

- [ ] **PRICES-01**: Fetch daily OHLCV candles from the Upstox API for listed IPOs using exchange-prefixed ISIN mappings (`NSE_EQ|{ISIN}` or `BSE_EQ|{ISIN}`).
- [ ] **PRICES-02**: Append daily candle historical price series to the master database.

## v2 Requirements

Deferred to future releases.

### Notifications (NOTIFY)

- **NOTF-01**: Send Telegram notification summaries of newly detected IPOs, status transitions, or updated GMP valuations.
- **NOTF-02**: Send email alerts for upcoming bidding starts and RHP document releases.

### Interface (UI)

- **UI-01**: Render the consolidated IPO listings list, GMP histories, and extracted financial ratios on a local web dashboard.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Direct Grey Market Trading | Illegal under SEBI regulations; raises immense security and compliance liabilities. |
| Tick-by-Tick Price Storage | Too heavy for local JSON database; EOD daily candles are sufficient for tracking. |
| Direct Bidding Gateways | Requires ASBA or broker login integrations, which are outside scraper scope. |

## Traceability

This table tracks which phase covers each v1 requirement.

| Requirement | Phase | Status |
|-------------|-------|--------|
| INGEST-01   | Phase 1 | Complete |
| INGEST-02   | Phase 1 | Pending |
| MERGE-01    | Phase 1 | Pending |
| MERGE-02    | Phase 1 | Complete |
| DOCS-01     | Phase 2 | Pending |
| DOCS-02     | Phase 2 | Pending |
| DOCS-03     | Phase 2 | Pending |
| DOCS-04     | Phase 2 | Pending |
| STAGE-01    | Phase 3 | Pending |
| STAGE-02    | Phase 3 | Pending |
| EXTRACT-01  | Phase 3 | Pending |
| EXTRACT-02  | Phase 3 | Pending |
| EXTRACT-03  | Phase 3 | Pending |
| GMP-01      | Phase 4 | Pending |
| GMP-02      | Phase 4 | Pending |
| PRICES-01   | Phase 4 | Pending |
| PRICES-02   | Phase 4 | Pending |

**Coverage:**

- v1 requirements: 17 total
- Mapped to phases: 17
- Unmapped: 0 ✓

---
*Requirements defined: 2026-06-06*
*Last updated: 2026-06-06 after initialization*
