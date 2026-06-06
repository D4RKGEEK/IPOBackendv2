# Stack Research

**Domain:** IPO Data Scraper & Prospectus Parser
**Researched:** 2026-06-06
**Confidence:** HIGH

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **Node.js** | v20+ / v22 (LTS) | Core runtime environment | Asynchronous event-driven model suited for concurrent I/O operations (fetching lists, downloading files). |
| **`@aws-sdk/client-s3`** | ^3.500.0 | Cloudflare R2 / S3 interactions | Official AWS SDK v3 is modular, supporting tree-shaking for low bundle size. Works seamlessly with R2 for zero egress fee hosting. |
| **`axios`** | ^1.7.0 | HTTP REST API client | Flexible request/response interceptors, robust error handling, and stream pipe integration, ideal for API integration and file downloads. |
| **`pdf-lib`** | ^1.30.0 | PDF page splitting and merging | High-performance pure JavaScript library that doesn't require native system bindings. Critical for splitting huge prospectus PDFs. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **`pdf-parse`** | ^1.1.1 | Simple text extraction | Use to extract raw text content from small, isolated PDF pages or byte buffers. |
| **`@mendable/firecrawl-js`** | ^1.1.0 | Web scraping and structured LLM extraction | Use when retrieving dynamic web contents or applying structured schemas to convert markdown data into structured JSON. |
| **`upstox-js-sdk`** | ^2.28.0 | Standard trading and market API | Use for standard Upstox auth/listing queries; note that newly released features (May 2026 IPO endpoints) are best queried directly. |
| **`pdfreader`** | ^3.0.0 | Streaming event-based PDF reading | Use as a memory-efficient alternative to `pdf-parse` for streaming through page contents line-by-line without buffering. |
| **`dotenv`** | ^16.4.0 | Environment variables management | Use in all environments to securely load API credentials and endpoints from a gitignored `.env` file. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| **`eslint`** | JavaScript linting | Use to enforce CommonJS standard code quality and catch syntax errors early. |
| **`prettier`** | Code formatting | Enforces formatting rules for code readability. |
| **`jest`** | Testing framework | Run automated tests for scraper engines, mocking API responses using `nock`. |

## Installation

```bash
# Core
npm install @aws-sdk/client-s3 axios pdf-lib

# Supporting
npm install @mendable/firecrawl-js upstox-js-sdk pdf-parse pdfreader dotenv

# Dev dependencies
npm install -D eslint prettier jest
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `pdf-lib` + `pdf-parse` | `pdf2json` | When coordinate-based position mapping or structured page boundaries are needed for table parsing, and PDF sizes are small. |
| `@aws-sdk/client-s3` | `@google-cloud/storage` | When deploying the service on Google Cloud Platform and preferring native Cloud Storage buckets instead of S3/R2. |
| `@mendable/firecrawl-js` | Direct REST API via `axios` | When seeking to avoid library dependency overhead in serverless functions and interacting purely through direct endpoint requests. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **`pdf2json`** (on full RHP/DRHP files) | Memory hog: loading 500+ page prospectuses into memory causes severe heap spikes and crashes low-resource environments (OOM). | `pdf-lib` to isolate the target page ranges first, then parse only those pages using `pdf-parse` or `pdfreader`. |
| **`fs.readFile`** (for downloading large PDFs) | Buffering large files (50-100MB+) in RAM leads to memory leaks and process failures. | Streaming pipeline using `fs.createWriteStream` to download straight to temp disk. |
| **`upstox-js-sdk`** (for new IPO APIs) | The May 23, 2026 IPO APIs might not be fully mapped in the generated SDK classes yet. | Direct REST calls via `axios` (configured with authorization headers) to query `https://api.upstox.com/v2/ipos`. |

## Stack Patterns by Variant

**If parsing extremely large PDFs (>100 pages) in low-RAM environments (e.g. 512MB RAM):**
- Do not read the entire PDF into a memory buffer.
- Use `fs.createReadStream` to download the file directly to `/tmp`.
- Use `pdf-lib` to open the local file stream, copy only the specified page numbers/ranges (e.g., containing the table of contents or target headings), and write a smaller sub-PDF to disk.
- Finally, use `pdf-parse` or `pdfreader` to parse only this sub-PDF.

**If uploading prospectus files to Cloudflare R2:**
- Use `@aws-sdk/client-s3` to configure an S3 client pointing to the custom R2 endpoint format: `https://<accountid>.r2.cloudflarestorage.com`.
- Keep `region: "auto"` as required by Cloudflare R2.
- For files larger than 5MB, utilize `@aws-sdk/lib-storage`'s `Upload` constructor to stream multipart uploads directly without buffering the entire payload in memory.

**If interacting with newly launched Upstox API v2 endpoints:**
- Create an Axios instance with pre-configured headers:
  ```javascript
  const upstoxClient = axios.create({
    baseURL: 'https://api.upstox.com/v2',
    headers: {
      Authorization: `Bearer ${process.env.UPSTOX_ACCESS_TOKEN}`,
      Accept: 'application/json'
    }
  });
  ```
- Use `upstoxClient.get('/ipos', { params: { status, page_number } })` to fetch IPO lists, handling pagination by reading the `meta_data.page.total_pages` parameter.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `@aws-sdk/client-s3@^3.500.0` | Node.js >= 18.x | Compatible with R2's S3 API implementation. |
| `pdf-lib@^1.30.0` | Node.js >= 16.x | Pure JS, runs without native C++ compilation. |
| `@mendable/firecrawl-js@^1.1.0`| Node.js >= 18.x | Direct support for CommonJS and ESM environments. |

## Sources

- Upstox Developer Portal (released May 23, 2026) — Verified IPO list and details REST endpoints.
- Cloudflare R2 S3 Compatibility Documentation — Verified S3 SDK setup, credentials, and custom endpoint patterns.
- Firecrawl Official JS Client SDK Repository — Checked options for scrape/crawl formatting and dynamic interactions.
- pdf-lib and pdfreader NPM Specifications — Assessed memory footprints, streaming patterns, and page-splitting workflows.

---
*Stack research for: IPO Data Scraper & Prospectus Parser*
*Researched: 2026-06-06*
