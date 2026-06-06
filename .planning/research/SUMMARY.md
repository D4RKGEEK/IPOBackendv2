# Project Research Summary

**Project:** IPO Scraper & Tracker
**Domain:** IPO Scraping & Ingestion Pipeline
**Researched:** 2026-06-06
**Confidence:** HIGH

## Executive Summary

This research establishes a blueprint for building a lightweight, extensible IPO data scraper and parser in Node.js. The system integrates data feeds from the NSE-BSE SDK and Upstox API, deduplicates them, downloads their associated prospectus PDFs (DRHP, RHP), dynamically isolates relevant sections (e.g. `OBJECTS_OF_THE_OFFER`, `BASIS_FOR_OFFER_PRICE`), and utilizes Cloudflare R2 and Firecrawl/DeepSeek to perform low-cost structured financial ratio extraction. 

The primary recommendation is to avoid full-text ingestion of prospectus PDFs, which are often over 500 pages long and cause Out-Of-Memory (OOM) crashes on low-resource runtimes. Instead, the scraper will use page-by-page streaming text searches to dynamically locate the page range of the target headings, slice the PDF, and convert only the relevant pages to Markdown before invoking the LLM.

Key risks include Akamai/Cloudflare bot blocking on the NSE website and InvestorGain portal, as well as rate limits on the Upstox API. These will be mitigated via browser-emulated session Handshakes (with persistent cookie jars), client-side call throttling, and random retry delay intervals.

## Key Findings

### Recommended Stack

A lightweight, pure JavaScript stack running on Node.js to minimize RAM usage and compute overhead.

**Core technologies:**
- **Node.js (v20+ / v22)**: Event-driven asynchronous runtime.
- **`axios`**: Flexible HTTP REST client for downloading prospectuses and querying REST endpoints.
- **`pdf-lib`**: Pure JavaScript PDF manipulator for splitting pages without requiring heavy C++ system bindings.
- **`pdfreader` / `pdf-parse`**: Memory-efficient streaming reader for page text analysis.
- **`@aws-sdk/client-s3`**: Modular AWS SDK for Cloudflare R2 staging uploads.
- **`@mendable/firecrawl-js`**: Used to apply structured schema extractions on markdown data.

### Expected Features

An end-to-end IPO tracking service that monitors the entire lifecycle of a public offering.

**Must have (table stakes):**
- **Deduplicated Master List**: Consolidates NSE-BSE and Upstox feeds using ISIN-based and normalized symbol mappings.
- **Date & Status State Machine**: Live schedule tracking (Upcoming, Open, Closed, Listed).
- **PDF Downloads**: Links to RHP, DRHP, and Final Prospectus documents.
- **Post-Listing Daily OHLCV**: Fetching daily candles from Upstox.

**Should have (differentiators):**
- **Structured PDF Ratio Parsing**: Automatic extraction of P/E, EPS, RoNW, and Issue Objects from RHP.
- **Daily GMP Aggregation**: Daily grey market premium tracking sourced from InvestorGain.
- **Mainboard vs. SME Separation**: Categorizing listings to separate small-medium enterprises.

### Architecture Approach

A modular, linear Pipe-and-Filter architecture where each stage (Ingest -> Merge -> Isolate -> Convert -> Upload -> Extract -> Save) acts as a testable unit. Fuzzy name matching (Jaro-Winkler) acts as a secondary deduplication fallback to ISIN matching. Writes to the JSON files will use the atomic write-and-rename pattern to prevent database corruption.

### Critical Pitfalls

1. **PDF Page Layout Drift**: Hardcoded page range offsets break across companies and documents. *Avoid by implementing dynamic header/TOC scanning to isolate page ranges.*
2. **IP Blocks & CAPTCHAs**: NSE and InvestorGain block cloud hosting IPs. *Avoid by reusing initialized cookie jars and throttling requests.*
3. **R2 Billing Runaway**: Storing huge raw PDFs in R2 lists up charges. *Avoid by deleting raw PDFs immediately and only storing small Markdown extracts.*
4. **LLM Hallucinations**: DeepSeek returning incorrect dates or ratios. *Avoid by enforcing Zod schemas and mathematical verification rules.*

## Implications for Roadmap

Suggested phase structure for implementation:

### Phase 1: Ingest, Deduplication & Master Listing
**Rationale:** Establishing the foundation of unique tracked IPO entities before performing document analysis.
**Delivers:** Merged `ipo_master.json` mapping listings from Upstox and NSE, running on GitHub Actions.
**Addresses:** Deduplicated Master IPO List, Date & Status State Machine.

### Phase 2: PDF Downloader & Dynamic Section Page Isolator
**Rationale:** Downloading documents and dynamically identifying section coordinates without crashing the heap.
**Delivers:** Local PDF downloader, TOC header scanner, and page ranges compiler using `pdf-lib`.
**Avoids:** Loading full PDF files in memory (OOM trap).

### Phase 3: Cloudflare R2 Upload & Firecrawl/LLM Extraction
**Rationale:** Staging the extracted markdown pages and invoking the structured JSON extractor.
**Delivers:** Cloudflare R2 client, Markdown converter, and Firecrawl structured schema extractor utilizing DeepSeek.
**Uses:** `@aws-sdk/client-s3`, `@mendable/firecrawl-js`.

### Phase 4: InvestorGain GMP Crawler & Daily Historical Candles
**Rationale:** Enriching the master list with sentiment trends and historical performance metrics.
**Delivers:** InvestorGain API collector fetching daily GMP histories and Upstox daily candle appender.
**Addresses:** Daily GMP History Aggregation, Post-Listing Daily OHLCV.

### Phase 5: Notifications & Cleanup
**Rationale:** User-facing alerts and pipeline cleanup to wrap up the system.
**Delivers:** Telegram notification integration for daily changes and temporary directory cleanup rules.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Libraries like `pdf-lib` and `@aws-sdk` are mature and well-tested in Node.js. |
| Features | HIGH | Domain requirements are clear, and APIs for Upstox/InvestorGain are verified. |
| Architecture | HIGH | Pipe-and-filter logic ensures testability and low RAM footprints. |
| Pitfalls | HIGH | Specific mitigations (cookie handshakes, dynamic offsets) are proven. |

**Overall confidence:** HIGH

### Gaps to Address

- **InvestorGain Cloudflare Protection**: Need to verify if GitHub Actions runners trigger Cloudflare verification during GMP fetches. *Mitigation: fall back to a residentially routed proxy if blocks occur.*

## Sources

### Primary (HIGH confidence)
- Upstox Developer API Docs (released May 2026) — Verified IPO schemas and rate limits.
- Cloudflare R2 S3 API Handshake Guides — Verified configuration properties.
- Firecrawl Structured JSON Schema Specifications — Verified extraction protocols.

---
*Research completed: 2026-06-06*
*Ready for roadmap: yes*
