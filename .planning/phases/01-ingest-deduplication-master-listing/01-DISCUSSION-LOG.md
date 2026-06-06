# Phase 1: Ingest, Deduplication & Master Listing - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-06
**Phase:** 1-Ingest, Deduplication & Master Listing
**Areas discussed:** Deduplication & Fuzzy Name Matching, Field Merging Precedence, CLI Arguments & Date Range Filters, Master Schema Structure

---

## Deduplication & Fuzzy Name Matching

| Option | Description | Selected |
|--------|-------------|----------|
| Strict Fuzzy + Date Guard | Match by Jaro-Winkler company name similarity (>0.90) AND bidding/listing dates overlap within 30 days. Otherwise, mark them as separate and flag for review. | ✓ |
| Deterministic Only | Only match if there is an exact ISIN or normalized Symbol match. Skip fuzzy matching entirely. | |
| Discretion | Let the agent decide matching threshold dynamically. | |

**User's choice:** Strict Fuzzy + Date Guard (Option 1)
**Notes:** Helps reconcile names while preventing false matches across separate corporate timelines.

---

## Field Merging Precedence

| Option | Description | Selected |
|--------|-------------|----------|
| Hybrid Winner | NSE wins for listing circular dates and prospectus URLs (DRHP/RHP/Final PDF links); Upstox wins for structured numerical fields (price bands, issue size, retail share allocation). | ✓ |
| Upstox Preferred | Treat Upstox as the primary source of truth for all fields. Only pull from NSE if a field is completely missing in Upstox. | |
| NSE Preferred | Treat the NSE-BSE SDK as the primary source of truth. Only pull from Upstox if the field is missing from NSE. | |
| Discretion | Let the agent decide which field looks cleaner or more complete during ingestion. | |

**User's choice:** Hybrid Winner (Option 1)
**Notes:** Capitalizes on the strengths of both sources (NSE for documents, Upstox for numerical fields).

---

## CLI Arguments & Date Range Filters

| Option | Description | Selected |
|--------|-------------|----------|
| Flexible CLI | Scraper defaults to the current calendar year (e.g. 2026) for daily cron runs, but accepts optional CLI arguments like `--year YYYY` or `--from YYYY-MM-DD --to YYYY-MM-DD` for custom historical backfills. | ✓ |
| Fixed Range | Always scrape from a fixed date (e.g. 2022-01-01 to 2026-12-31) as currently hardcoded in the scripts, without accepting any input parameters. | |
| Current Year Only | Hardcoded to scrape only the current calendar year. No parameters accepted. | |
| Discretion | Let the agent design the CLI argument parser. | |

**User's choice:** Flexible CLI (Option 1)
**Notes:** Provides optimal defaults for scheduling/cron while preserving backfilling capabilities.

---

## Master Schema Structure

| Option | Description | Selected |
|--------|-------------|----------|
| Nested Auditing Schema | Store clean, normalized fields at the top level (e.g., `isin`, `symbol`, `companyName`, `status`, `biddingStartDate`, `priceBand`). Below these, nest the raw API responses under `raw_sources.upstox` and `raw_sources.nse` keys to allow debugging and parsing additions without needing to re-fetch from the APIs. | ✓ |
| Clean Flat Schema | Store only normalized fields that map directly to the system requirements. Discard all raw unmapped API data to keep the file size extremely small. | |
| Discretion | Let the agent design the schema structure. | |

**User's choice:** Nested Auditing Schema (Option 1)
**Notes:** Ensures auditing capability and future parsing changes do not require hit limits or remote re-fetches.

---

## the agent's Discretion

- Choice of string similarity library or custom Jaro-Winkler implementation.

## Deferred Ideas

None.
