<!-- GSD:project-start source:PROJECT.md -->

## Project

**IPO Scraper & Tracker**

A lightweight Node.js service designed to regularly scrape, deduplicate, and track IPOs (Initial Public Offerings) from multiple sources, starting with the NSE-BSE SDK and Upstox API. The service downloads associated prospectus PDFs (DRHP, RHP), extracts key financial sections, converts them to Markdown, uploads them to Cloudflare R2, and uses Firecrawl/DeepSeek to produce structured JSON of critical financial ratios.

**Core Value:** Regularly updated, deduplicated, and clean IPO tracking and financial data.

### Constraints

- **Budget/Resource**: Low server resources and limited API budget — must run minimally and only invoke Firecrawl/DeepSeek on isolated pages.
- **Technology**: Node.js and CommonJS (existing stack).
- **Security**: API keys must be loaded exclusively from local `.env` file (gitignored).

<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->

## Technology Stack

## Languages

- JavaScript (ES6 / CommonJS) - Used for all script files (`ipo.js`, `upstox.js`, `bse.js`).
- JSON - Used for data caching (`ipo.json`, `upstox_ipo.json`, `nse_cookies_http1.json`).

## Runtime

- Node.js v25.1.0 - Executed as standalone terminal scripts.
- No browser runtime environment.
- npm 11.6.2
- Lockfile: `package-lock.json` present.

## Frameworks

- None (vanilla Node.js scripts).
- None configured.
- None configured.

## Key Dependencies

- `nse-bse-api` ^0.1.3 - Wraps NSE and BSE financial endpoints.
- `upstox-js-sdk` ^2.28.0 - Official SDK for the Upstox API.
- `axios` ^1.x (transitive / undeclared) - Used directly in `upstox.js` to fetch Upstox API data.

## Configuration

- No environment files (`.env`) configured. Authentication details and options are currently hardcoded in the scripts.
- No build configuration (raw JS scripts executed directly via Node.js).

## Platform Requirements

- macOS/Linux/Windows (any platform with Node.js installed).
- Handled as a set of local execution utilities (no production hosting target currently configured).

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

## Naming Patterns

- Lowercase script files (`ipo.js`, `upstox.js`, `bse.js`).
- Output JSON files matching source script name (`ipo.json`, `upstox_ipo.json`).
- camelCase for functions and variables (e.g. `fromDate`, `toDate`, `pastIPOs`, `page_number`, `allIpos`, `ipos2026`). Note: some camelCase and snake_case mix exists due to API responses.
- `UPPER_SNAKE_CASE` for hardcoded configuration or secret constants (e.g. `ACCESS_TOKEN`).

## Code Style

- CommonJS module format: `require()` for imports.
- Indentation: inconsistent (2 spaces in `ipo.js` vs 4 spaces in `upstox.js`).
- Quotes: single quotes (`'2022-01-01'`) and double quotes (`"axios"`) are mixed.
- Semicolons: generally required.
- Standalone execution wrapped in asynchronous IIFE blocks: `(async () => { ... })();`.
- `async/await` for asynchronous code flow.

## Import Organization

## Error Handling

- Main IIFE block is wrapped in a `try/catch` block.
- Catches errors and prints to `console.error` (e.g., `console.error("Error fetching past IPOs:", error.message)`).
- Upstox script has conditional logging for Axios-specific response errors: `e.response ? e.response.data : e.message`.

## Logging

- Direct use of `console.log` for output/success reporting.
- Direct use of `console.error` for exceptions.

<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

## Pattern Overview

- Standalone execution: Scripts are executed independently via command line.
- Output caching: Data fetched from external APIs is saved directly to JSON files in the root directory.
- No central orchestration: Each script is fully self-contained.

## Layers

- Purpose: Execute independent data retrieval tasks.
- Contains: `ipo.js`, `upstox.js`, `bse.js` (empty).
- Depends on: npm packages (`nse-bse-api`, `axios`), local cookie files (`nse_cookies_http1.json`).
- Used by: CLI user invocation.

## Data Flow

- Stateless in-memory execution.
- Persistence is file-based (`ipo.json`, `upstox_ipo.json`).
- Cookie sessions are persisted in `nse_cookies_http1.json`.

## Entry Points

- Location: `ipo.js`
- Triggers: `node ipo.js`
- Responsibilities: Fetches past IPOs from NSE and caches them.
- Location: `upstox.js`
- Triggers: `node upstox.js`
- Responsibilities: Fetches paginated IPOs from Upstox, filters by year 2026, and caches them.

## Error Handling

- Standalone async IIFE wrapped in `try/catch` block.
- Error logs to `console.error` displaying the message.

## Cross-Cutting Concerns

- Console outputs for reporting counts and output file locations.
- Upstox API uses a static bearer token header.
- NSE API uses standard HTTP cookie management via the `nse-bse-api` wrapper.

<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.agent/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
