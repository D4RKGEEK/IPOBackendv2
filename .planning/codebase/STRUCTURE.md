# Codebase Structure

**Analysis Date:** 2026-06-06

## Directory Layout

```
[project-root]/
├── .agent/             # GSD skill resources and configs (internal)
├── .agents/            # GSD agents and workflows (internal)
├── .planning/          # Project planning and tracking documentation
│   └── codebase/      # Codebase maps (STACK, ARCHITECTURE, etc.)
├── node_modules/       # Node.js dependencies (not committed)
├── bse.js              # Empty script for BSE integration (planned)
├── ipo.js              # Fetch past IPOs from NSE API
├── ipo.json            # Cached NSE IPO data
├── nse_cookies_http1.json # Cookie store for NSE API
├── package.json        # Project manifest
├── package-lock.json   # Package lockfile
├── upstox.js           # Fetch IPOs from Upstox API
└── upstox_ipo.json     # Cached Upstox IPO data
```

## Directory Purposes

**[project-root]:**
- Purpose: Contains all codebase scripts, cached data, configurations, and environment resources.
- Contains: `*.js` files, `package.json`, `*.json` cache files, and system configuration directories.

**.planning/codebase/:**
- Purpose: Holds living documentation mapping the codebase.
- Contains: `*.md` files outlining stack, structure, integrations, testing, conventions, and concerns.

## Key File Locations

**Entry Points:**
- `ipo.js`: NSE IPO fetching script.
- `upstox.js`: Upstox IPO fetching script.

**Configuration:**
- `package.json`: Project manifest.
- `package-lock.json`: Dependency locks.

**Core Logic:**
- `ipo.js` & `upstox.js`: Contain data fetching, pagination, and caching logic.

**Testing:**
- None.

## Naming Conventions

**Files:**
- Lowercase / snake_case / camelCase for script files (`ipo.js`, `upstox.js`, `bse.js`).
- standard config names (`package.json`).
- `*_ipo.json` or `*.json` for caching.

## Where to Add New Code

**New Scraping / API Script:**
- Create in the root directory: `[project-root]/new-source.js`.

**New Planning Documents:**
- Add to `.planning/` folder.

---

*Structure analysis: 2026-06-06*
*Update when directory structure changes*
