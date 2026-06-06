# Codebase Concerns

**Analysis Date:** 2026-06-06

## Tech Debt

**Hardcoded secrets in version control:**
- Issue: Upstox JWT token `ACCESS_TOKEN` is hardcoded directly in `upstox.js` (line 4).
- Files: `upstox.js`
- Impact: Security vulnerability; token is exposed to anybody with read access to the git repository.
- Fix approach: Move `ACCESS_TOKEN` to environment variables (e.g. `process.env.UPSTOX_ACCESS_TOKEN` via `dotenv`).

**Empty script file:**
- Issue: `bse.js` is completely empty and serves no purpose.
- Files: `bse.js`
- Impact: Unused files clutter the root directory.
- Fix approach: Implement BSE fetching logic or remove the file.

**Undeclared dependency in package.json:**
- Issue: `upstox.js` imports `axios` directly, but `axios` is not listed in `dependencies` inside `package.json`.
- Files: `upstox.js` (line 1), `package.json`
- Impact: Potential failure if `axios` is not resolved transitively in certain environments.
- Fix approach: Add `axios` to `dependencies` in `package.json`.

## Known Bugs

- None currently identified.

## Security Considerations

**API Credentials Leak:**
- Risk: Hardcoded `ACCESS_TOKEN` in `upstox.js` is stored in plaintext in the codebase.
- Current mitigation: None.
- Recommendations: Set up `dotenv` package, add `.env` to `.gitignore`, and load token from environment.

## Performance Bottlenecks

**Sequential Paginated Requests:**
- Problem: `upstox.js` loops through 4 statuses and, for each status, queries pages sequentially in a `while` loop.
- Files: `upstox.js`
- Cause: Synchronous page-by-page fetching.
- Improvement path: Query page counts or execute page queries concurrently using `Promise.all` if page counts are known/predictable.

## Fragile Areas

- Hand-managed cookie files: `nse_cookies_http1.json` is automatically managed in the root directory by the wrapper SDK. Deleting this file can cause authentication issues on the next run.

## Scaling Limits

- Rate limits: Upstox API has query rate limits that paginated sequential fetches could trigger.
- File-based cache: Caching all IPOs in a single JSON file (`ipo.json`, `upstox_ipo.json`) will not scale if the data set grows very large, though IPO data sets are generally small.

## Test Coverage Gaps

- There are no automated tests (0% coverage) for any fetching, filtering, or file writing logic.

---

*Concerns audit: 2026-06-06*
*Update as issues are fixed or new ones discovered*
