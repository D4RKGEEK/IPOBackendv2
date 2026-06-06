# IPO Scraper & Tracker

## What This Is

A lightweight Node.js service designed to regularly scrape, deduplicate, and track IPOs (Initial Public Offerings) from multiple sources, starting with the NSE-BSE SDK and Upstox API. The service downloads associated prospectus PDFs (DRHP, RHP), extracts key financial sections, converts them to Markdown, uploads them to Cloudflare R2, and uses Firecrawl/DeepSeek to produce structured JSON of critical financial ratios.

## Core Value

Regularly updated, deduplicated, and clean IPO tracking and financial data.

## Requirements

### Validated

- ✓ Local environment setup and codebase mapping — Phase 0

### Active

- [ ] Merged IPO master listing consolidating NSE-BSE SDK and Upstox API data, deduplicated by ISIN, NSE Symbol, or BSE Script Code.
- [ ] Automatic prospectus PDF downloader (DRHP, RHP, Final) caching files locally.
- [ ] Prospectus text processor: parse PDFs, locate target headings (e.g. `OBJECTS_OF_THE_OFFER`, `BASIS_FOR_OFFER_PRICE`), and extract specific page ranges to Markdown.
- [ ] Cloudflare R2 uploader for staging extracted markdown documents.
- [ ] Firecrawl & DeepSeek integration to extract key financial metrics (EPS, P/E, RoNW, etc.) from the staged markdown.
- [ ] InvestorGain GMP crawler fetching daily GMP histories.
- [ ] Upstox historical price candle scraper to append listed IPO price data.

### Out of Scope

- [ ] Full web UI dashboard — deferred to later milestones (currently CLI/GitHub Actions only).
- [ ] Persistent SQL/NoSQL Database — deferred to later phases (local JSON files `ipo_master.json` and `gmp_latest` used for now).

## Context

- The codebase is currently written in vanilla CommonJS JavaScript executing on Node.js.
- PDF prospectus parsing leverages section headings to isolate pages rather than full PDF ingestion to save API costs and compute resources.
- Integrations include Cloudflare R2 for document hosting, Firecrawl for document scraping, and DeepSeek for structured data extraction.

## Constraints

- **Budget/Resource**: Low server resources and limited API budget — must run minimally and only invoke Firecrawl/DeepSeek on isolated pages.
- **Technology**: Node.js and CommonJS (existing stack).
- **Security**: API keys must be loaded exclusively from local `.env` file (gitignored).

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Local JSON storage | Simple starting point, later migrating to MongoDB or Supabase | — Pending |
| GitHub Actions runner | Zero-cost serverless execution trigger | — Pending |
| R2 Staging | Host extracted markdown files for Firecrawl extraction | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-06 after initialization*
