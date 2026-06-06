---
phase: 1
slug: ingest-deduplication-master-listing
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-06
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^2.x / Node.js test runner |
| **Config file** | none — Wave 0 installs |
| **Quick run command** | `npx vitest run --run` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --run`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | INGEST-01 | — | `dotenv` loads tokens securely | unit | `npx vitest run test/config.test.js` | ❌ W0 | ⬜ pending |
| 01-02-01 | 02 | 2 | INGEST-01 | — | Normalizers parse dates/symbols/names correctly | unit | `npx vitest run test/normalizers.test.js` | ❌ W0 | ⬜ pending |
| 01-02-02 | 02 | 2 | INGEST-01 | — | Upstox client parses active/upcoming/closed IPOs | integration | `npx vitest run test/upstox.test.js` | ❌ W0 | ⬜ pending |
| 01-02-03 | 02 | 2 | INGEST-02 | — | NSE client parses listings via SDK | integration | `npx vitest run test/nse.test.js` | ❌ W0 | ⬜ pending |
| 01-03-01 | 03 | 3 | MERGE-01 | — | Jaro-Winkler name matcher validates correct similarity | unit | `npx vitest run test/jaroWinkler.test.js` | ❌ W0 | ⬜ pending |
| 01-03-02 | 03 | 3 | MERGE-02 | — | Atomic write helper writes temp-then-rename | unit | `npx vitest run test/atomicWrite.test.js` | ❌ W0 | ⬜ pending |
| 01-03-03 | 03 | 3 | MERGE-01 | — | Merge pipeline merges schema with precedence | integration | `npx vitest run test/pipeline.test.js` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `test/normalizers.test.js` — stubs for normalization tests
- [x] `test/jaroWinkler.test.js` — stubs for similarity tests
- [x] `test/atomicWrite.test.js` — stubs for write-temp-then-rename checks
- [x] Install `vitest` as a devDependency in `package.json`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Execute full pipeline via CLI arguments | INGEST-01 | End-to-end network dependencies and cron options | Run `node run_pipeline.js --year 2026` and inspect generated `ipo_master.json` structure. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 5s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

