# Pitfalls Research

**Domain:** IPO Scraper & Financial Processor
**Researched:** 2026-06-06
**Confidence:** HIGH

## Critical Pitfalls

### Pitfall 1: PDF Page Layout Drift & Hardcoded Offsets

**What goes wrong:**
Scraping engines fail to extract targeted prospectus sections (e.g., `OBJECTS OF THE OFFER` or `BASIS FOR OFFER PRICE`) because they rely on hardcoded physical page numbers or static page offsets (e.g., "always check pages 120-135"). These hardcoded indexes break across different IPOs, or even between different stages of the same IPO (Draft Red Herring Prospectus [DRHP] vs. Red Herring Prospectus [RHP] vs. Prospectus), due to varying layouts, legal boilerplate additions, tables of contents page count shifts, or custom page insert offsets.

**Why it happens:**
Developers assume the layout structure of prospectuses is standardized. They look at one company's RHP (e.g., page 110-125), see that it works, and hardcode the range. However, a different company's prospectus might place the same section on page 190. Furthermore, printed page numbers in the document's footer (e.g., "112") differ from physical PDF page indexes (e.g., page 125) due to cover sheets and introductory Roman numeral pages, making simple arithmetic offsets brittle.

**How to avoid:**
Build a **dynamic heading-based page range locator**:
1. **Table of Contents (TOC) Extraction**: Parse the first 30 pages of the PDF. Use regular expressions to extract the section names and their corresponding printed page numbers (e.g., `OBJECTS OF THE OFFER` -> `Page 145`).
2. **PDF Page Mapping**: Extract headers/footers of the PDF pages to build an index mapping physical PDF page indexes to printed page numbers (e.g., identifying the text string "Page 145" in footers).
3. **Heading Scanning (Regex & Normalization)**: If printed page numbers are missing or hard to extract, scan the entire document's page-by-page text for normalized headings (converting to lowercase, stripping whitespace, removing punctuation, and handling hyphenation). Match using a predefined synonym map (e.g., `OBJECTS OF THE OFFER` matches `OBJECTS OF THE ISSUE`, `THE OBJECTS`, etc.).
4. **Range Isolation**: The target section starts on the page containing the match and ends at the page containing the next major TOC section heading. Slice only this physical page range to generate the Markdown extract.

**Warning signs:**
- `Firecrawl` or `DeepSeek` returns data from unrelated sections (e.g., extracting risk factors instead of financial objects).
- High percentage of empty/null fields in extracted financial objects.
- Page range offsets resolving to negative numbers or values exceeding the total page count.

**Phase to address:**
Phase 2: Prospectus text processor (dynamic range locator implementation).

---

### Pitfall 2: API Rate Limiting, Cloudflare WAF Blocks, and IP Bans (NSE, Upstox, InvestorGain)

**What goes wrong:**
Scraping requests to NSE, Upstox, or InvestorGain are blocked, returning HTTP 403 Forbidden, 429 Too Many Requests, or forcing Cloudflare JS/CAPTCHA challenges. This halts the daily master listing sync and blocks IPO candle imports.

**Why it happens:**
- **NSE**: The public exchange website is protected by Akamai/Cloudflare. Standard HTTP requests from public cloud IPs (AWS, GCP, DigitalOcean) are blocked instantly. Additionally, the NSE API requires an active session initialized by visiting the homepage first, generating cookie headers that must be re-sent.
- **Upstox**: Has strict rate limits (e.g., 10 requests per second for standard applications, with rate limits on token generation or IP levels).
- **InvestorGain**: A media site that uses simple rate limiting and Cloudflare. Rapid page requests to scrape Grey Market Premium (GMP) histories easily trigger temporary IP bans.

**How to avoid:**
- **For NSE**:
  1. Initialize the session by first sending a request to the main homepage (`https://www.nseindia.com/`) using a browser-like User-Agent.
  2. Maintain and propagate the generated cookie jar (specifically tracking cookies like `nsit`, `nseappid`, and `bm_sv`) in all subsequent API requests. Use libraries like `axios-cookiejar-support` combined with `tough-cookie`.
  3. Use residentially routed proxy networks or smart proxy rotators (e.g., ScraperAPI, Bright Data) to bypass Cloudflare cloud-IP blacklists.
  4. Implement HTTP/2 protocol support, as modern WAFs block requests with mismatched TLS fingerprints.
- **For Upstox**:
  1. Integrate a rate-limiter library (like `bottleneck` in Node.js) to enforce client-side queueing and limit calls to 5-8 requests/sec (well under the 10 requests/sec limit).
  2. Gracefully parse the `Retry-After` header and implement exponential backoff.
- **For InvestorGain**:
  1. Cache GMP HTML pages locally. Scraping should only occur once or twice a day.
  2. Implement randomized delays (jitter) between pages (e.g., 2–5 seconds).

**Warning signs:**
- Scraper tasks fail with `AxiosError: Request failed with status code 403` or `429`.
- NSE API returns HTML page content containing "Access Denied" or Cloudflare challenge markers instead of expected JSON data.

**Phase to address:**
Phase 1: Master listing consolidation & Phase 4: InvestorGain GMP crawler.

---

### Pitfall 3: Suboptimal Cloudflare R2 Bandwidth & Storage Utilization (Billing Runaway)

**What goes wrong:**
The Cloudflare billing invoice spikes due to excessive storage usage and high Class A (write/list) operations. This happens when the system processes multiple drafts of identical prospectuses, uploading massive raw PDFs repeatedly or continuously listing bucket objects.

**Why it happens:**
- Uploading full 500-page prospectus PDFs (often 30MB - 100MB each) instead of isolated text files.
- Lack of content deduplication, resulting in the same PDF being uploaded multiple times under different filenames.
- Using costly S3 List API calls (`ListObjectsV2` - Class A operations) to check if a file already exists instead of querying a local or database-backed state index.
- Lack of object lifecycle management policies, leading to stale or intermediate draft files accumulating indefinitely.

**How to avoid:**
1. **Only Store Extracts**: Store only the extracted markdown files (usually <200KB) in R2. Keep raw PDFs strictly local (temporary workspace) or delete them immediately after parsing.
2. **Hash-Based Deduplication**: Before uploading any document, compute its SHA-256 hash or construct a unique key (e.g., `[ISIN]-[docType]-[version].md`).
3. **Local State Check**: Query a local metadata registry (e.g., `ipo_master.json`) to check if a document has already been processed and uploaded, bypassing R2 List operations entirely.
4. **Configure R2 Lifecycle Rules**: Define storage rules to automatically delete raw or intermediate files in a temporary bucket after 14 days, keeping only final structured summaries.
5. **Edge Caching via CDN**: Set `Cache-Control: public, max-age=31536000` on R2 objects and serve them via a Cloudflare CDN subdomain, serving read requests from the edge cache to minimize R2 Class B operations.

**Warning signs:**
- Cloudflare Dashboard shows a spike in Class A and Class B billing metrics.
- R2 bucket size grows exponentially (gigabytes per week) for a relatively small list of active IPOs.

**Phase to address:**
Phase 3: Cloudflare R2 uploader integration.

---

### Pitfall 4: Firecrawl/DeepSeek Extraction Failures and Hallucinated Financial Metrics

**What goes wrong:**
The LLM (DeepSeek) hallucinates key financial ratios (e.g., confusing FY23 metrics with FY24, reversing EPS values, or hallucinating a positive RoNW when the company is loss-making). Additionally, Firecrawl crawls might time out or return malformed Markdown representations of tables, resulting in parsing failures.

**Why it happens:**
- Financial prospectuses contain complex multi-column tables and footnotes. When converted to Markdown, tables can lose column alignments. The LLM might pair the wrong header with the wrong row data.
- The context window is overloaded with irrelevant pages, causing the LLM to lose focus ("lost in the middle").
- Lack of input schema enforcement allows the LLM to output freeform JSON with arbitrary key names or format values as strings instead of numbers.

**How to avoid:**
1. **Schema Enforcement via JSON Schema/Zod**: Use Firecrawl's native extraction endpoint with a strict JSON Schema, or use DeepSeek's structured output mode (JSON mode with system prompt constraints).
2. **Define Strict Types in Zod**: Enforce types (e.g., numeric validation for P/E ratios, ISO format for dates, string representation for ISINs).
3. **Post-Extraction Validation Rules (Sanity Checks)**:
   - Check math: E.g., `EPS * P/E Ratio` should approximately equal the IPO share price.
   - Check ranges: E.g., Return on Net Worth (RoNW) should be expressed as a percentage (typically between -100 and 100). If it exceeds these bounds, flag it.
   - Verify dates: Ensure financial years extracted match the actual prospectus timeline (e.g., checking for the correct header 'For the year ended March 31, 2026').
4. **Markdown Table Pre-processing**: Format markdown tables using clear separator lines (`|---|---|`) and clean whitespaces to preserve tabular structures before sending them to the LLM.

**Warning signs:**
- DeepSeek returns JSON structures that do not match the expected API contracts.
- Key financial metrics are missing (null) or contain impossible numbers (e.g., negative P/E when net profit is positive).
- Validation checks fail, throwing schema type mismatches.

**Phase to address:**
Phase 3: Firecrawl & DeepSeek extraction implementation.

---

### Pitfall 5: Incomplete, Silent, or Delayed Document Updates from Stock Exchanges

**What goes wrong:**
An IPO listing is missed or tracks outdated financial statistics because the stock exchange silently updates prospectus links (e.g., replacing a draft DRHP with an updated RHP) without changing the index metadata or notifying the API. Alternatively, listing data and symbol assignments may lag by days after the IPO is officially finalized.

**Why it happens:**
Stock exchanges update documents asynchronously. The URL to a prospectus might remain identical while the file content changes, or the URL might dynamically change with a new timestamp. Additionally, exchange API feeds do not prioritize immediate updates for newly listed companies, creating latency in Symbol and ISIN mappings.

**How to avoid:**
1. **Document Hashing**: Store the HTTP `ETag` or compute a hash (SHA-256) of downloaded PDFs. Regularly poll the file endpoints and compare hashes to detect silent changes.
2. **Multi-Source Fallbacks**: Verify listings by cross-referencing multiple sources: SEBI (regulatory filing), NSE (exchange listing), BSE (exchange listing), and Chittorgarh/InvestorGain (retail portals).
3. **Fuzzy Name Matching**: Implement a robust mapping layer using Jaro-Winkler or Levenshtein distance to associate Upstox Symbol names with NSE/BSE entities (e.g., matching "Kay Cee Industries" to "KAYCEE").
4. **State-Driven Polling**: Maintain an IPO lifecycle state machine (`Draft` -> `RHP Filed` -> `Bidding Open` -> `Allotted` -> `Listed`). Increase checking frequency (e.g., from daily to hourly) as an IPO transitions to critical dates (e.g., listing day).

**Warning signs:**
- Discrepancies between the list of IPOs on InvestorGain (listed) and the master list in our JSON storage (still marked as open/closed).
- Broken download URLs or 404 errors on previously saved PDF links.

**Phase to address:**
Phase 1: Master listing consolidation & Phase 5: Upstox historical price candle scraper.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Hardcoded page numbers/offsets | Quick implementation for the first analyzed prospectus | Scraper fails on subsequent IPOs due to drift; data extraction is corrupted. | Never acceptable. Page locator must be dynamic from day one. |
| Uploading full raw PDFs to R2 | Bypasses local PDF parsing/extraction step | Exploding storage costs, higher R2 Class A operations, and higher egress when LLM fetches them. | Only in Phase 0 (sandbox testing) with manual cleanup. |
| Scraping exchanges without proxy rotation | Simplifies network code, zero dependency costs | Quick IP blocking from Cloudflare/Akamai; halts execution on production runners. | Local development with slow rate limits. |
| Skipping schema validation for LLM output | Fast development, avoids writing parser logic | Hallucinated values break master listing database schema; downstream analytics fail silently. | Never acceptable. Strict schemas (Zod/JSON Schema) must protect the master list. |

## Integration Gotchas

Common mistakes when connecting to external services.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| NSE API | Making direct requests to `/api/...` endpoints from a Node process. | Visit the base homepage `nseindia.com` to initialize cookies first, and carry them forward via a persistent Cookie Jar. |
| Upstox API | Repetitive polling of the IPO listing endpoint. | Cache results locally and use webhooks or polling with long intervals (e.g., once every 6 hours), utilizing client-side throttling. |
| InvestorGain | Aggressively scraping HTML tables every few minutes. | Set a high caching time (e.g. 4-12 hours) and inject randomized delay (jitter) between HTTP requests to simulate humans. |
| Cloudflare R2 | Performing `ListObjects` to check if a prospectus is already uploaded. | Keep a local SQLite or JSON index representing uploaded objects to avoid S3 Class A charges. |
| Firecrawl / DeepSeek | Sending massive raw text files without dividing sections. | Pre-extract and clean targeted pages to Markdown, send only the relevant pages, and use structured schemas. |

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Whole-Document LLM Ingestion | Out of memory, high LLM token billing, lost-in-the-middle accuracy degradation. | Implement dynamic page isolation to extract and send only target pages (~10-15 pages instead of 500). | > 3 concurrent IPO runs / files > 10MB |
| Blocking Event Loop in PDF Parsing | Node.js process becomes unresponsive, API timeouts, dropped network calls. | Move PDF text parsing/decoding tasks to Worker Threads or external sub-processes. | > 5 parallel PDF parsings |
| Uncached PDF Downloaders | Repetitive download of the same 50MB PDF on each runner execution. | Use local disk caching checked by content hash or ETag before attempting download. | > 10 active trackings |

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Hardcoding Upstox Access Token in code | Token compromise, leading to unauthorized account or data access. | Store tokens inside an environment file (`.env`) loaded via `dotenv` and added to `.gitignore`. |
| Making R2 buckets completely public | Unauthorized access or scraping of extracted prospectus data, resulting in egress billing attacks. | Keep bucket private; generate short-lived pre-signed URLs (e.g., 5-minute expiry) for Firecrawl to access resources. |
| Lack of SSRF validation on PDF links | Server-side request forgery (SSRF) if the crawler attempts to download user-submitted or manipulated PDF URLs. | Restrict download domains to known lists (e.g., `*.nseindia.com`, `*.bseindia.com`, `*.sebi.gov.in`). |

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Cryptic parser/scraping error messages | Developer cannot diagnose why a specific prospectus failed to parse (e.g., "Error: Cannot read property '0'"). | Catch parsing exceptions, log the filename, the attempted page range, and fallback gracefully without crashing the pipeline. |
| Lack of progress tracking in CLI / Logs | Long-running runs (e.g. parsing 10 PDFs) look frozen or hang without diagnostic logs. | Output clear verbose logs (e.g. "Downloading [Company] (12/54MB)...", "Extracting pages 120-134..."). |
| Missing daily run summaries | No summary of what was fetched, updated, or failed; difficult to know if listings are up to date. | Generate a final summary table in standard output or GitHub step summary listing status updates. |

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Master Listing Merge:** Often misses duplicate records when symbols change — verify deduplication against ISIN first, falling back to fuzzy name matching.
- [ ] **Prospectus Parser:** Works on a single test company — verify dynamic locator works across a test set of 5+ prospectuses from different sectors.
- [ ] **R2 Uploader:** Uploads files — verify that lifecycle rules are active and cache-control headers are set.
- [ ] **Firecrawl/LLM Extraction:** Returns structured data — verify that Zod types enforce numeric validation and post-processing mathematical validations are run.
- [ ] **InvestorGain Crawler:** Works on local machine — verify Github Action runners do not get blocked by Cloudflare.

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| IP Block from Exchange / Cloudflare | LOW | Rotate proxy nodes; refresh cookie jar by re-triggering homepage initialization; increase scrape delay. |
| Hallucinated Financial Metrics | MEDIUM | Re-run Firecrawl/DeepSeek extraction with a lower temperature, fallback to a more capable model (like GPT-4o), or trigger a manual correction flag. |
| PDF Layout Drift Failure (Zero pages extracted) | MEDIUM | Fallback to searching for secondary synonym headings; if still unresolved, flag the IPO in the master list for manual page range input. |
| Massive Billing Spike in R2 | HIGH | Purge all raw PDFs from bucket; configure standard 7-day retention lifecycle policies; add CDN routing and caching. |

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Dynamic page range drift | Phase 2 (Text Processor) | Run unit tests on 5 historical PDFs; verify extracted pages contain the expected headings. |
| Rate limits & Cloudflare blocks | Phase 1 & Phase 4 | Monitor response codes during a mock sync run; ensure zero 403 or 429 status codes. |
| Cloudflare R2 billing runaway | Phase 3 (R2 Integration) | Inspect bucket logs after a test run; check that raw PDFs are deleted and CDN cache is hit on read. |
| LLM Hallucinations | Phase 3 (LLM Extraction) | Run extraction assertions; verify Zod schema validation passes and mathematical rules check out. |
| Delayed exchange updates | Phase 1 & Phase 5 | Cross-validate master list counts against SEBI/InvestorGain records and log discrepancies. |

## Sources

- Upstox Developer API Documentation (Rate limits, paging contracts)
- NSE India Web API Session Guidelines & Cookie Handshakes
- Cloudflare R2 Operations & Class Billing Guides
- Firecrawl Structured Extraction & JSON Schema Integration Docs
- Zod Runtime Schema Validation Documentation
- Community forums on scraping protected financial websites
