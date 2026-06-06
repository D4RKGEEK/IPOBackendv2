# Coding Conventions

**Analysis Date:** 2026-06-06

## Naming Patterns

**Files:**
- Lowercase script files (`ipo.js`, `upstox.js`, `bse.js`).
- Output JSON files matching source script name (`ipo.json`, `upstox_ipo.json`).

**Functions:**
- camelCase for functions and variables (e.g. `fromDate`, `toDate`, `pastIPOs`, `page_number`, `allIpos`, `ipos2026`). Note: some camelCase and snake_case mix exists due to API responses.

**Constants:**
- `UPPER_SNAKE_CASE` for hardcoded configuration or secret constants (e.g. `ACCESS_TOKEN`).

## Code Style

**Formatting:**
- CommonJS module format: `require()` for imports.
- Indentation: inconsistent (2 spaces in `ipo.js` vs 4 spaces in `upstox.js`).
- Quotes: single quotes (`'2022-01-01'`) and double quotes (`"axios"`) are mixed.
- Semicolons: generally required.

**Async / Promise handling:**
- Standalone execution wrapped in asynchronous IIFE blocks: `(async () => { ... })();`.
- `async/await` for asynchronous code flow.

## Import Organization

**Order:**
1. Node.js built-ins (`fs`, `path`).
2. External packages (`axios`, `nse-bse-api`).

No specific Grouping or Path Aliases are configured.

## Error Handling

**Patterns:**
- Main IIFE block is wrapped in a `try/catch` block.
- Catches errors and prints to `console.error` (e.g., `console.error("Error fetching past IPOs:", error.message)`).
- Upstox script has conditional logging for Axios-specific response errors: `e.response ? e.response.data : e.message`.

## Logging

- Direct use of `console.log` for output/success reporting.
- Direct use of `console.error` for exceptions.

---

*Convention analysis: 2026-06-06*
*Update when patterns change*
