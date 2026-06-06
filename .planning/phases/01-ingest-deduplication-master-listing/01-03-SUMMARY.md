---
phase: 01-ingest-deduplication-master-listing
plan: "03"
subsystem: pipeline
tags: ["jaro-winkler", "deduplication", "atomic-write", "cli"]
requires:
  - phase: 01-ingest-deduplication-master-listing
    plan: "02"
    provides: "Upstox and NSE ingestion clients, normalizers"
provides:
  - "Jaro-Winkler string similarity utility"
  - "POSIX atomic file writer (write-temp-then-rename)"
  - "Main pipeline CLI runner with ISIN/symbol/fuzzy deduplication and atomic persistence"
affects: []
tech-stack:
  added: []
  patterns: ["Hierarchical deduplication", "POSIX atomic rename", "CLI argument parsing"]
key-files:
  created:
    - "run_pipeline.js"
    - "test/pipeline.test.js"
  verified:
    - "utils/jaroWinkler.js"
    - "utils/atomicWrite.js"
    - "test/jaroWinkler.test.js"
    - "test/atomicWrite.test.js"
key-decisions:
  - "Deduplication uses 3-tier hierarchy: ISIN exact → normalized symbol exact → Jaro-Winkler >0.90 + 30-day date guard."
  - "Borderline matches (score 0.85–0.90) are logged to ipo_borderline.json for manual review."
  - "NSE takes precedence for dates and document URLs; Upstox takes precedence for price band, lot size, and allocation data."
  - "CLI defaults to current calendar year; supports --year YYYY and --from/--to date range flags."
  - "pipeline.test.js rewritten as pure ESM (import syntax) to match project Vitest pattern — avoids require-before-init hoisting error."
requirements-completed: ["MERGE-01", "MERGE-02"]
duration: ~20min
completed: 2026-06-07
---

# Phase 1 Plan 03: Merge Pipeline & CLI Runner Summary

**Jaro-Winkler fuzzy matcher, atomic POSIX writer, and main pipeline CLI runner implemented and verified.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-06-07
- **Completed:** 2026-06-07
- **Tasks:** 2 completed
- **Files modified:** 2 updated (test files), 1 created (run_pipeline.js), 2 verified (utils)

## Accomplishments

- `utils/jaroWinkler.js` — Jaro-Winkler similarity with Winkler prefix correction (p=0.1, up to 4 chars). Already implemented from prior work; verified passing.
- `utils/atomicWrite.js` — POSIX atomic write-temp-then-rename with fsync flush. Already implemented; verified passing.
- `run_pipeline.js` — Full pipeline orchestrator:
  - CLI argument parsing (`--year`, `--from`, `--to`) with input validation and sanitization.
  - Fetches Upstox + NSE IPOs in parallel.
  - 3-tier hierarchical deduplication: ISIN → symbol → Jaro-Winkler + 30-day date guard.
  - Merge precedence: NSE wins dates/documents, Upstox wins price/size/lot data.
  - Borderline matches (JW 0.85–0.90) written to `ipo_borderline.json` for review.
  - Results atomically persisted to `ipo_master.json`.
- All 15 tests across 7 test files pass (`npm test`).

## Test Results

```
Test Files  7 passed (7)
Tests       15 passed (15)
```

## Files Created/Modified

- `run_pipeline.js` — Pipeline CLI entry point with full deduplication and merge logic.
- `test/pipeline.test.js` — Rewritten as pure ESM; tests `areDatesWithin30Days`, `isWithinDateRange`, `mergeRecordPair`.
- `test/atomicWrite.test.js` — Updated with `fileURLToPath` for `__dirname` compat in ESM context.

## Decisions Made

- Rewrote `pipeline.test.js` from mixed `require`/`import` to pure ESM `import` to fix a `require-before-initialization` hoisting error that Vitest's transform exposed.
- Used `import.meta.url` + `fileURLToPath` in `atomicWrite.test.js` to resolve `__dirname` in ESM context.

## Deviations from Plan

None — all acceptance criteria met exactly as specified.

## Issues Encountered

- **Mixed CJS/ESM in pipeline.test.js:** Original skeleton used `require('vitest')` on line 1 followed by `import { createRequire }` — ESM `import` is hoisted so `require` was undefined at parse time. Fixed by converting to pure `import` syntax (matching other passing test files).

## Next Phase Readiness

- Phase 1 complete — all 3 plans executed.
- `ipo_master.json` populated with live Upstox + NSE data.
- Ready for Phase 2: PDF Downloader & Dynamic Section Page Isolator.

---
*Phase: 01-ingest-deduplication-master-listing*
*Completed: 2026-06-07*
