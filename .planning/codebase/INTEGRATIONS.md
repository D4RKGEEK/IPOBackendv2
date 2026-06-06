# External Integrations

**Analysis Date:** 2026-06-06

## APIs & External Services

**Stock Market APIs:**
- National Stock Exchange (NSE) API - Fetches past and current IPO data.
  - SDK/Client: `nse-bse-api` npm package v0.1.3
  - Auth: Cookie-based session storage in `nse_cookies_http1.json` (auto-generated/updated by the SDK during connection).
  - Endpoints used: `listPastIPO(fromDate, toDate)`
- Upstox API - Fetches IPO status and details.
  - Integration method: REST API via `axios` direct HTTP GET requests.
  - Auth: Bearer token hardcoded as `ACCESS_TOKEN` in `upstox.js`.
  - Endpoints used: `https://api.upstox.com/v2/ipos?status=${status}&page_number=${page_number}`

## Data Storage

**Files:**
- `ipo.json` - Local cache/dump of IPOs fetched from the NSE API.
- `upstox_ipo.json` - Local cache/dump of IPOs fetched from the Upstox API.
- `nse_cookies_http1.json` - Cookie storage file for NSE API session persistence.

## Monitoring & Observability

- None (stdout/stderr console logs only).

## CI/CD & Deployment

- None (executed locally on demand).

## Environment Configuration

**Development:**
- No environment variables are currently configured.
- Upstox `ACCESS_TOKEN` is hardcoded directly inside `upstox.js`.

---

*Integration audit: 2026-06-06*
*Update when adding/removing external services*
