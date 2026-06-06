# Phase 1: Ingest, Deduplication & Master Listing - Context

**Gathered:** 2026-06-06
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers the core ingestion, deduplication, and local atomic persistence layer of the IPO scraper pipeline. It pulls active/upcoming/closed IPO lists from the Upstox API and NSE endpoints, merges duplicate company listings, and writes a unified deduplicated list of unique IPO entities to a local `ipo_master.json` file.

</domain>

<decisions>
## Implementation Decisions

### Ingestion & Deduplication
- **D-01:** Deduplication uses a hierarchical strategy: 1) ISIN matching, 2) Normalized Symbol matching (exchange suffixes removed), 3) Fuzzy Company Name matching using Jaro-Winkler distance (>0.90 similarity) combined with a 30-day bidding date range overlap check. Borderline listings that fail dates or fuzzy validation are logged separately and flagged for review.

### Field Merging Precedence
- **D-02:** When merging duplicate entries, the NSE-BSE SDK takes precedence for listing circular dates and official document links (DRHP, RHP, and Final Prospectus PDFs). The Upstox API takes precedence for structured numeric data (price bands, issue size, lot sizes, category allocations).

### CLI Arguments & Date Range Filters
- **D-03:** The scraping pipeline defaults to the current calendar year (e.g. 2026) for daily cron updates, but accepts optional CLI arguments (`--year YYYY` or `--from YYYY-MM-DD --to YYYY-MM-DD`) to allow manual historical backfills.

### Master Database Schema
- **D-04:** The `ipo_master.json` output file will store normalized fields (such as `isin`, `symbol`, `companyName`, `status`, `biddingStartDate`, `priceBand`, `documentUrls`) at the top level of each IPO entry. The raw response payloads will be nested under `raw_sources.upstox` and `raw_sources.nse` keys for auditing and future parsing. Writes to the file will use the atomic write-temp-then-rename pattern.

### agent's Discretion
- The choice of Jaro-Winkler string similarity package or custom lightweight helper is left to the agent's discretion.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Specifications
- `.planning/PROJECT.md` — Core value, active requirements, and constraints.
- `.planning/REQUIREMENTS.md` — Full checkable requirements and traceability mappings.

### Codebase Maps
- `.planning/codebase/STACK.md` — Active technology stack (Node.js v25.1.0, CommonJS).
- `.planning/codebase/ARCHITECTURE.md` — Conceptual design patterns and request flow structure.
- `.planning/codebase/INTEGRATIONS.md` — Upstox API and NSE SDK endpoints.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ipo.js`: Contains NSE SDK initialization (`new NSE(__dirname)`) and past listing retrieval.
- `upstox.js`: Contains axios requests to Upstox API, pagination parsing logic, and standard bearer token configuration.

### Established Patterns
- Standalone execution wrapped in async IIFE blocks `(async () => { ... })()`.
- File-based cache writing (`fs.writeFileSync`).
- Local cookie storage (`nse_cookies_http1.json`).

### Integration Points
- Root directory files: The new pipeline entry script will run from the root.

</code_context>

<specifics>
## Specific Ideas

- Use `dotenv` to pull the `UPSTOX_ACCESS_TOKEN` securely from the `.env` file instead of hardcoding it.
- Use an atomic write utility to output `ipo_master.json` securely without risking file corruption if the process is killed midway.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 01-Ingest, Deduplication & Master Listing*
*Context gathered: 2026-06-06*
