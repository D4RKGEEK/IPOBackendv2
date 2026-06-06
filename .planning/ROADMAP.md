# Roadmap: IPO Scraper & Tracker

## Overview

This roadmap defines the implementation path for a lightweight, extensible Node.js scraper pipeline. The system Ingests listings from multiple sources, matches and merges duplicate records, isolates and extracts target sections from prospectus PDFs, uploads documents to Cloudflare R2, and uses Firecrawl/DeepSeek to capture structured financial ratios. Daily GMP trends and listed price candles are also crawled and aggregated.

## Phases

- [x] **Phase 1: Ingest, Deduplication & Master Listing** - Merge Upstox and NSE lists into a unified JSON database.
- [x] **Phase 2: PDF Downloader & Dynamic Section Page Isolator** - Download prospectuses and dynamically isolate target page ranges.
- [x] **Phase 3: Cloudflare R2 Staging & Firecrawl/LLM Extraction** - Upload isolated markdown to R2 and extract ratios.
- [ ] **Phase 4: InvestorGain GMP Crawler & Daily Candles** - Aggregate grey market premium histories and listed price candles.
- [ ] **Phase 5: GitHub Actions runner & Telegram Alerts** - Configure CI/CD scheduling and Telegram alert feeds.

## Phase Details

### Phase 1: Ingest, Deduplication & Master Listing

**Goal**: Fetch, match, and merge IPO listings from Upstox and NSE, persisting them in a local atomic master JSON database.
**Mode**: mvp
**Depends on**: Nothing
**Requirements**: INGEST-01, INGEST-02, MERGE-01, MERGE-02
**Success Criteria**:

  1. Execution retrieves data from Upstox API and NSE endpoints.
  2. Merging engine resolves duplicates using ISIN or Jaro-Winkler company fuzzy matching.
  3. Unique records are written atomically to `ipo_master.json`.

**Plans**: 3 plans
Plans:
**Wave 1**

- [x] 01-01: Set up project config, dependencies, and environment variable loaders.

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-02: Write ingestion modules for Upstox API and browser-emulated NSE endpoints.

**Wave 3** *(blocked on Wave 2 completion)*

- [ ] 01-03: Implement company fuzzy matcher and atomic merge pipeline saving to `ipo_master.json`.

### Phase 2: PDF Downloader & Dynamic Section Page Isolator

**Goal**: Download prospectus PDFs, locate target section printed page ranges dynamically, and slice them into compact files to avoid memory leaks.
**Mode**: mvp
**Depends on**: Phase 1
**Requirements**: DOCS-01, DOCS-02, DOCS-03, DOCS-04
**Success Criteria**:

  1. PDFs are cached locally via hash to prevent redundant network downloads.
  2. PDF page mapping matches targets like `OBJECTS_OF_THE_OFFER` and `BASIS_FOR_OFFER_PRICE` dynamically.
  3. Selected page range is sliced to a local PDF file and converted to clean Markdown.

**Plans**: 3 plans

Plans:

- [ ] 02-01: Implement local PDF downloader with file hashing and ETag cache validations.
- [ ] 02-02: Build table-of-contents (TOC) page-by-page heading locator using `pdfreader`.
- [ ] 02-03: Implement PDF slicing via `pdf-lib` and markdown text extraction writer.

### Phase 3: Cloudflare R2 Staging & Firecrawl/LLM Extraction

**Goal**: Stage Markdown pages on Cloudflare R2 and use Firecrawl/DeepSeek to parse key financial ratios.
**Mode**: mvp
**Depends on**: Phase 2
**Requirements**: STAGE-01, STAGE-02, EXTRACT-01, EXTRACT-02, EXTRACT-03
**Success Criteria**:

  1. Markdown sections are uploaded to R2 and public URLs cached.
  2. Firecrawl structured extraction returns clean JSON maps of target ratios.
  3. Extracted ratios pass Zod validation schemas and post-processing mathematical validations.

**Plans**: 3 plans

Plans:

- [ ] 03-01: Integrate S3-compatible R2 upload client and cache upload states.
- [ ] 03-02: Build Firecrawl structured API client with schema parameters.
- [ ] 03-03: Implement post-extraction mathematical checks and merge ratios into `ipo_master.json`.

### Phase 4: InvestorGain GMP Crawler & Daily Candles

**Goal**: Crawl daily GMP history trends and listed historical price candles.
**Mode**: mvp
**Depends on**: Phase 3
**Requirements**: GMP-01, GMP-02, PRICES-01, PRICES-02
**Success Criteria**:

  1. InvestorGain crawler fetches snapshot GMP listings and aggregates daily trends.
  2. Upstox daily candle scraper fetches post-listing price history using ISIN symbols.
  3. GMP and candle histories are merged successfully under each master list item.

**Plans**: 2 plans

Plans:

- [ ] 04-01: Build InvestorGain GMP crawler querying LIST and DETAIL APIs.
- [ ] 04-02: Write Upstox daily candle fetching client and append data to local JSON DB.

### Phase 5: GitHub Actions runner & Telegram Alerts

**Goal**: Automate daily pipeline runs via GitHub Actions cron and send Telegram alerts of status/GMP updates.
**Mode**: mvp
**Depends on**: Phase 4
**Requirements**: NOTF-01
**Success Criteria**:

  1. GitHub Actions runner executes the full script pipeline on a regular cron.
  2. Notifications summarizing changes are posted to the Telegram channel.

**Plans**: 2 plans

Plans:

- [ ] 05-01: Create GitHub Actions workflow schedule and configure secret bindings.
- [ ] 05-02: Implement Telegram notification integration sending status summaries.

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Master List Ingest | v1.0 | 2/3 | In Progress|  |
| 2. PDF Processing | v1.0 | 0/3 | Not started | - |
| 3. LLM Ratio Extract | v1.0 | 0/3 | Not started | - |
| 4. GMP & Historicals | v1.0 | 0/2 | Not started | - |
| 5. Automation & Alerts | v1.0 | 0/2 | Not started | - |
