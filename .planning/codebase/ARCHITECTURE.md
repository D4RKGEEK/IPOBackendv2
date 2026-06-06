# Architecture

**Analysis Date:** 2026-06-06

## Pattern Overview

**Overall:** Standalone Script-based Utility Codebase.

**Key Characteristics:**
- Standalone execution: Scripts are executed independently via command line.
- Output caching: Data fetched from external APIs is saved directly to JSON files in the root directory.
- No central orchestration: Each script is fully self-contained.

## Layers

**Standalone Scripts:**
- Purpose: Execute independent data retrieval tasks.
- Contains: `ipo.js`, `upstox.js`, `bse.js` (empty).
- Depends on: npm packages (`nse-bse-api`, `axios`), local cookie files (`nse_cookies_http1.json`).
- Used by: CLI user invocation.

## Data Flow

**NSE IPO Fetching (`ipo.js`):**
1. User executes `node ipo.js`.
2. Script instantiates `NSE` client using `__dirname` as the cookie storage path.
3. Script defines date ranges (2022-01-01 to 2026-12-31).
4. `nse.listPastIPO` is called, loading cookies from `nse_cookies_http1.json` or logging in.
5. Results are printed to console and written to `ipo.json`.

**Upstox IPO Fetching (`upstox.js`):**
1. User executes `node upstox.js`.
2. Script loops through statuses: `upcoming`, `open`, `closed`, `listed`.
3. For each status, paginated GET requests are made to `https://api.upstox.com/v2/ipos` using `axios` with the hardcoded bearer token.
4. IPOs are collected and filtered to only include those where bidding or listing occurs in `2026`.
5. Filtered results are written to `upstox_ipo.json`.

**State Management:**
- Stateless in-memory execution.
- Persistence is file-based (`ipo.json`, `upstox_ipo.json`).
- Cookie sessions are persisted in `nse_cookies_http1.json`.

## Entry Points

**NSE Script:**
- Location: `ipo.js`
- Triggers: `node ipo.js`
- Responsibilities: Fetches past IPOs from NSE and caches them.

**Upstox Script:**
- Location: `upstox.js`
- Triggers: `node upstox.js`
- Responsibilities: Fetches paginated IPOs from Upstox, filters by year 2026, and caches them.

## Error Handling

**Strategy:** Exception catching at the top level of each script.

**Patterns:**
- Standalone async IIFE wrapped in `try/catch` block.
- Error logs to `console.error` displaying the message.

## Cross-Cutting Concerns

**Logging:**
- Console outputs for reporting counts and output file locations.

**Authentication:**
- Upstox API uses a static bearer token header.
- NSE API uses standard HTTP cookie management via the `nse-bse-api` wrapper.

---

*Architecture analysis: 2026-06-06*
*Update when major patterns change*
