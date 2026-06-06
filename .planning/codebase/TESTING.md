# Testing Patterns

**Analysis Date:** 2026-06-06

## Test Framework

No test runner or assertion library is currently configured.
The `npm test` script in `package.json` outputs an error: `Error: no test specified`.

## Verification Strategy

Currently, verification is performed manually by running the scripts directly:
```bash
node ipo.js
node upstox.js
```
The developer then checks if `ipo.json` and `upstox_ipo.json` are populated correctly and contain valid JSON structure.

## Planned Testing Approach

When automated testing is introduced, the following conventions are proposed:

### 1. Proposed Test Runner
- **Vitest** is recommended as a fast, light, modern test runner for Node.js projects.

### 2. Unit Testing Filtering Logic
- Extract the 2026 filtering logic in `upstox.js` into a separate, pure function (e.g., `filterIposByYear(ipos, year)`).
- Write unit tests verifying correct filtering behaviour (including boundaries, missing dates, etc.).

### 3. Mocking APIs
- Mock `axios` GET calls to return stable mock JSON responses.
- Mock the `nse-bse-api` dependency using Vitest `vi.mock` to avoid making actual network requests to exchange servers during testing.

---

*Testing analysis: 2026-06-06*
*Update when test patterns change*
