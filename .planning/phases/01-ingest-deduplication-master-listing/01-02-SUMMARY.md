---
phase: 01-ingest-deduplication-master-listing
plan: "02"
subsystem: api
tags: ["nse", "upstox", "axios"]
requires:
  - phase: 01-ingest-deduplication-master-listing
    plan: "01"
    provides: "Environment configurations and test stubs"
provides:
  - "Normalization helpers for company name, symbol, and date string formats"
  - "Upstox API client fetcher with pagination, details fetching, and 429 rate limit retries"
  - "NSE API client fetcher querying current, upcoming, and past issues"
affects:
  - "01-03"
tech-stack:
  added: ["axios"]
  patterns: ["Schema normalizer mapping", "HTTP client with retry backoff", "Mock SDK prototypes in testing"]
key-files:
  created:
    - "utils/normalizers.js"
    - "utils/upstox.js"
    - "utils/nse.js"
    - "test/upstox.test.js"
    - "test/nse.test.js"
  modified:
    - "test/normalizers.test.js"
key-decisions:
  - "Constructed custom date normalizers standardizing dates to local timezone representation to prevent timezone-shifting off-by-one errors."
  - "Used dynamic createRequire mapping in Vitest suites to force test mocks to bind to the identical Node.js CommonJS cache instance used by source modules."
requirements-completed: ["INGEST-01", "INGEST-02"]
duration: 35min
completed: 2026-06-06
---

# Phase 1 Plan 02: Ingestion Clients Summary

**API ingestion clients and normalization modules completed for Upstox API and NSE SDK endpoints.**

## Performance

- **Duration:** 35 min
- **Started:** 2026-06-06T19:05:30Z
- **Completed:** 2026-06-06T19:48:55Z
- **Tasks:** 3 completed
- **Files modified:** 1 modified, 5 created

## Accomplishments
- Implemented normalizer utilities (`utils/normalizers.js`) for company names, symbols, and Indian exchange date strings, preventing timezone shifts.
- Implemented the Upstox API client (`utils/upstox.js`) with paginated listings retrieval, detail page calls, and automatic retries for HTTP 429 rate limit responses.
- Implemented the NSE API client (`utils/nse.js`) interfacing with the `nse-bse-api` wrapper to pull current, upcoming, and past listings.
- Achieved full test coverage for normalizers, Upstox client mapping, and NSE client mapping.

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement normalizers, date parsing utilities, and unit test suite** - `eac26eb` (feat)
2. **Task 2: Build Upstox Ingestion Client module and test suite** - `79a530f` (feat)
3. **Task 3: Build NSE Ingestion Client module and test suite** - `b9551e7` (feat)

**Plan metadata:** `pending` (docs: complete plan)

## Files Created/Modified
- `utils/normalizers.js` - Normalizes casing, suffixes, symbols, and dates.
- `utils/upstox.js` - Queries Upstox list and detail APIs and standardizes response.
- `utils/nse.js` - Queries NSE SDK list and detail APIs and standardizes response.
- `test/normalizers.test.js` - Expanded test coverage for normalization edge cases.
- `test/upstox.test.js` - Mocks axios and tests Upstox mapping.
- `test/nse.test.js` - Mocks SDK prototype functions and tests NSE mapping.

## Decisions Made
- Handled Vitest mock boundary issues with CommonJS modules by importing `axios` via `createRequire(import.meta.url)` in test suites, ensuring Vitest overrides the correct package cache.
- Mapped price ranges dynamically for NSE listings to capture both flat prices and range bands.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- **CommonJS Require caching in tests:** When running tests using ESM, Vitest's `vi.mock` did not mock the instance of `axios` imported via `require` inside the source files because ESM and CommonJS were loading different physical builds of the package. Fixed by loading modules inside the test files using CommonJS `require` via `createRequire`.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Ingestion modules are complete.
- Ready for Plan 01-03: Implementing the fuzzy Jaro-Winkler string matcher, the atomic POSIX writer, and the consolidated ingestion pipeline.

---
*Phase: 01-ingest-deduplication-master-listing*
*Completed: 2026-06-06*
