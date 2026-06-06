# Walking Skeleton — IPO Scraper & Tracker

**Phase:** 1
**Generated:** 2026-06-07

## Capability Proven End-to-End

A user can execute the command `node run_pipeline.js --year 2026` via the CLI to trigger ingestion from Upstox and NSE, run hierarchical matching and merging, and persist a clean, deduplicated JSON database of IPO listings to `ipo_master.json`.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Framework | Vanilla Node.js script (CommonJS module pattern) | Keep the stack simple, lightweight, and fast to execute. No server overhead is needed for background scraper scripts. |
| Data layer | Local JSON file database (`ipo_master.json`) | Low scale datasets (dozens of IPOs per year) can be efficiently managed via flat files. Persisted atomically to prevent corruption. |
| Auth | Gitignored local `.env` file + `dotenv` package | Securely manages secrets (e.g. `UPSTOX_ACCESS_TOKEN`) without exposing them in repositories or logs. |
| Deployment target | Local CLI environment | Built to run standalone or on scheduling runners (e.g. GitHub Actions cron) without complex cloud server configuration. |
| Directory layout | Modular helpers in `utils/`, tests in `test/`, and entrypoint scripts at the root | Keeps reusable functions isolated and easily testable, while keeping the main script readable. |

## Stack Touched in Phase 1

- [x] Project scaffold (dotenv configuration, package.json dependencies, and Vitest runner setup)
- [x] Routing — CLI arguments parsing (`--year YYYY`, `--from YYYY-MM-DD --to YYYY-MM-DD`)
- [x] Database — atomic read/write flow via POSIX-compliant temp-write-and-rename of `ipo_master.json`
- [x] UI — CLI stdout logging of scraping statistics, execution stages, and borderline match flags
- [x] Deployment — documented local run commands in PROJECT.md and test runner verification

## Out of Scope (Deferred to Later Slices)

- Prospectus PDF downloading, hashing, caching, and text range isolation (Phase 2).
- PDF-to-Markdown conversion using page slicing to prevent memory bloat (Phase 2).
- Cloudflare R2 S3-compatible staging file uploads and upload caching (Phase 3).
- Firecrawl structured ratio extraction & DeepSeek LLM data schema validation (Phase 3).
- InvestorGain GMP scraper, daily historic GMP trend aggregation (Phase 4).
- Upstox daily candle historical price tracking using ISIN symbols (Phase 4).
- GitHub Actions automation pipeline, cron configuration, and Telegram alert notification feeds (Phase 5).

## Subsequent Slice Plan

Each later phase adds one vertical slice on top of this skeleton without altering its architectural decisions:

- **Phase 2:** Prospectus PDF downloader, dynamic table-of-contents locator, and streaming page isolator.
- **Phase 3:** Cloudflare R2 staging uploads and Firecrawl/LLM financial ratio structured extractor.
- **Phase 4:** InvestorGain GMP historical trend scraper and Upstox daily price candle accumulator.
- **Phase 5:** CI/CD cron automation runner and Telegram alerts summary feed.
