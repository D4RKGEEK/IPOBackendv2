# Technology Stack

**Analysis Date:** 2026-06-06

## Languages

**Primary:**
- JavaScript (ES6 / CommonJS) - Used for all script files (`ipo.js`, `upstox.js`, `bse.js`).

**Secondary:**
- JSON - Used for data caching (`ipo.json`, `upstox_ipo.json`, `nse_cookies_http1.json`).

## Runtime

**Environment:**
- Node.js v25.1.0 - Executed as standalone terminal scripts.
- No browser runtime environment.

**Package Manager:**
- npm 11.6.2
- Lockfile: `package-lock.json` present.

## Frameworks

**Core:**
- None (vanilla Node.js scripts).

**Testing:**
- None configured.

**Build/Dev:**
- None configured.

## Key Dependencies

**Critical:**
- `nse-bse-api` ^0.1.3 - Wraps NSE and BSE financial endpoints.
- `upstox-js-sdk` ^2.28.0 - Official SDK for the Upstox API.
- `axios` ^1.x (transitive / undeclared) - Used directly in `upstox.js` to fetch Upstox API data.

## Configuration

**Environment:**
- No environment files (`.env`) configured. Authentication details and options are currently hardcoded in the scripts.

**Build:**
- No build configuration (raw JS scripts executed directly via Node.js).

## Platform Requirements

**Development:**
- macOS/Linux/Windows (any platform with Node.js installed).

**Production:**
- Handled as a set of local execution utilities (no production hosting target currently configured).

---

*Stack analysis: 2026-06-06*
*Update after major dependency changes*
