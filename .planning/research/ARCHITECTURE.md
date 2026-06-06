# Architecture Research

**Domain:** IPO Scraping & Financial Ingestion Pipeline
**Researched:** 2026-06-06
**Confidence:** HIGH

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                       Ingestion Layer                       │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                      │
│  │ Upstox  │  │   NSE   │  │   BSE   │                      │
│  │   API   │  │ Scraper │  │ Scraper │                      │
│  └────┬────┘  └────┬────┘  └────┬────┘                      │
│       │            │            │                           │
├───────┴────────────┴────────────┴───────────────────────────┤
│                   Data Processing Pipeline                  │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Deduplication & Merge                  │    │
│  └──────────────────────────┬──────────────────────────┘    │
│                             │                               │
│  ┌──────────────────────────▼──────────────────────────┐    │
│  │           PDF Downloader & Section Isolator         │    │
│  └──────────────────────────┬──────────────────────────┘    │
│                             │                               │
│  ┌──────────────────────────▼──────────────────────────┐    │
│  │        Markdown Converter & R2 Cloud Storage        │    │
│  └──────────────────────────┬──────────────────────────┘    │
│                             │                               │
│  ┌──────────────────────────▼──────────────────────────┐    │
│  │             Structured Firecrawl/LLM Extraction     │    │
│  └──────────────────────────┬──────────────────────────┘    │
│                             │                               │
│  ┌──────────────────────────▼──────────────────────────┐    │
│  │            Atomic Master JSON Updater & Commit      │    │
│  └─────────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────────┤
│                     Storage & Persistence                   │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                   │
│  │ Cloud    │  │ Local    │  │ Processing │                   │
│  │ R2 Bucket│  │ JSON DB  │  │ Cache    │                   │
│  └──────────┘  └──────────┘  └──────────┘                   │
└─────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| **Ingestion Clients** | Connects to external API feeds (Upstox REST endpoints, NSE browser-emulated HTTP/1.1 client) to fetch active, upcoming, closed, and listed IPO metadata. | `axios` with session handling, cookie management, and user-agent emulation. |
| **Deduplication Engine** | Merges records from multiple source feeds, resolving duplicate entries via ISIN, symbol matching, and fuzzy company name reconciliation. | Custom fuzzy matching logic (`natural` or `string-similarity` modules) with legal term filtering and date guards. |
| **PDF Section Isolator** | Extracts specified page ranges (e.g. "Objects of the Issue") from 1000+ page prospectuses without loading the entire document into memory. | Page-by-page streaming search with `pdfjs-dist` and range-based extraction using `pdf-lib`. |
| **Markdown Converter** | Transforms isolated PDF pages to clean, semantic markdown formatted for LLM ingestion. | Local parsers or specialized visual-document markdown APIs (e.g., LlamaParse, marker). |
| **R2 Storage Client** | Manages upload and retention of original PDFs, isolated PDF sections, and markdown documents for persistent access and auditing. | `@aws-sdk/client-s3` configured for Cloudflare R2 storage endpoints. |
| **Firecrawl/LLM Parser** | Converts unstructured markdown text into a strictly typed JSON schema containing key financial facts. | Firecrawl `/extract` API or direct LLM integration (e.g. Claude `JSON_mode` or structured outputs). |
| **Atomic JSON Database** | Persists consolidated structured data locally or to a repository file, ensuring crash-safety and version-controlled history. | Write-and-rename pattern using `fs.promises.rename` to maintain transactional integrity. |

## Recommended Project Structure

```
src/
├── ingest/             # Source-specific ingestion adapters
│   ├── upstox.ts       # Upstox IPO feed fetcher
│   ├── nse.ts          # NSE browser-emulated fetcher
│   └── index.ts        # Ingestion orchestrator
├── pipeline/           # Core processing stages
│   ├── merge.ts        # Deduplication & merging engine
│   ├── pdf-isolator.ts # TOC parser and low-memory page extractor
│   ├── markdown.ts     # Markdown converter
│   └── extract.ts      # LLM structured schema extractor
├── storage/            # Data storage and persistence
│   ├── r2.ts           # Cloudflare R2 bucket interface
│   └── db.ts           # Atomic JSON database manager
├── utils/              # Helper utilities
│   ├── clean.ts        # String cleaning and normalizers
│   └── fetch.ts        # Secure HTTP client wrapper
├── config.ts           # Config schema and env variable loader
└── index.ts            # CLI command runner & pipeline coordinator
```

### Structure Rationale

- **ingest/:** Isolates API connection logic, headers, and authentication for different providers. Adding new sources (like BSE or Moneycontrol) only requires creating a new client file here.
- **pipeline/:** Keeps execution stages linear and testable. Each file represents a single responsibility in the processing workflow (Single Responsibility Principle).
- **storage/:** Centralizes read/write interfaces to local files and cloud storage, preventing race conditions and scattered file IO throughout the codebase.

## Architectural Patterns

### Pattern 1: Modular Pipe-and-Filter Architecture

**What:** The pipeline is modeled as a series of distinct filters (functions) processing a single IPO entity. Data flows sequentially through stages, where each stage returns a modified or enriched representation.

**When to use:** When processing involves multiple asynchronous, network-heavy operations that can fail independently (e.g. PDF download, LLM extraction).

**Trade-offs:** 
- *Pros*: Extremely testable in isolation; simple to add retries, logging, or error-tracking boundaries between stages.
- *Cons*: Higher boilerplate as each stage requires defined input/output interfaces.

**Example:**
```typescript
import { IpoEntry, MergedIpo, ExtractedIpo } from './types';

export class IpoPipeline {
  async run(sourceData: any[]): Promise<void> {
    // Stage 1: Merge & Deduplicate
    const mergedEntries: MergedIpo[] = this.mergeAndDeduplicate(sourceData);

    for (const entry of mergedEntries) {
      try {
        // Stage 2: Cache Check
        if (await this.db.isProcessed(entry.symbol)) continue;

        // Stage 3: PDF Isolation
        const localPdfPath = await this.isolator.isolateObjectsSection(entry.prospectusUrl);

        // Stage 4: Markdown Conversion
        const markdownPath = await this.converter.toMarkdown(localPdfPath);

        // Stage 5: Upload Artifacts
        const r2Url = await this.r2.upload(markdownPath, `${entry.symbol}/objects.md`);

        // Stage 6: Structured LLM Extraction
        const financialFacts = await this.extractor.extractObjects(markdownPath);

        // Stage 7: Update Master JSON
        await this.db.updateEntry(entry.symbol, { ...entry, details: financialFacts, markdownUrl: r2Url });
      } catch (err) {
        console.error(`Pipeline failed for ${entry.symbol}:`, err);
        // Continue processing other entries
      }
    }
  }
}
```

### Pattern 2: Multi-Key Fuzzy Deduplication

**What:** Reconciling matching records between sources using hierarchical keys:
1. Exact ISIN match (Gold Standard).
2. Exact Symbol match (normalized by removing exchange-specific suffixes like `-SM`, `-ST`).
3. Normalization and Jaro-Winkler / Token Sort fuzzy matching on company names combined with bidding date range checks.

**When to use:** When combining records from sources where one uses symbols and names (NSE) and another uses ISINs and symbols (Upstox), without guaranteed identifier parity.

**Trade-offs:**
- *Pros*: Prevents duplicate listing entries; handles varying corporate designations ("Limited", "Ltd", "Pvt Ltd").
- *Cons*: Slight risk of false positives/negatives in edge cases where company names are very similar, requiring defensive date-guards and manual triage tags.

**Example:**
```typescript
import { JaroWinklerDistance } from 'natural';

export function cleanCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(limited|ltd|private|pvt|corp|corporation|inc|co|company|india|holding|holdings|ipo|sme)\b/gi, '')
    .replace(/[^a-z0-9\s]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function areSameIpo(a: any, b: any): boolean {
  // 1. ISIN match
  if (a.isin && b.isin && a.isin === b.isin) return true;

  // 2. Symbol match (normalized)
  const normSymA = a.symbol.replace(/-(SM|ST|STP|BE)$/i, '');
  const normSymB = b.symbol.replace(/-(SM|ST|STP|BE)$/i, '');
  if (normSymA === normSymB) return true;

  // 3. Normalized Company Name Fuzzy Match
  const nameA = cleanCompanyName(a.companyName || a.company || a.name || '');
  const nameB = cleanCompanyName(b.companyName || b.company || b.name || '');
  
  if (nameA === nameB) return true;
  
  const distance = JaroWinklerDistance(nameA, nameB);
  if (distance > 0.90) {
    // Guard: ensure dates are close (within 30 days) to prevent matching separate corporate actions
    const dateA = new Date(a.bidding_start_date || a.ipoStartDate);
    const dateB = new Date(b.bidding_start_date || b.ipoStartDate);
    const dayDiff = Math.abs(dateA.getTime() - dateB.getTime()) / (1000 * 60 * 60 * 24);
    return dayDiff < 30;
  }

  return false;
}
```

### Pattern 3: Low-Memory PDF Section Isolation (Page-by-Page Streaming)

**What:** Extracting text page-by-page from a streaming PDF parser to search for heading matches, identifying the start and end pages of target sections, and copying only those pages to a small buffer.

**When to use:** Running in memory-constrained serverless environments or GitHub Runners processing 1000-page prospectus documents.

**Trade-offs:**
- *Pros*: Low memory consumption (~50MB instead of 1GB+); fast execution as text parsing stops once the section bounds are resolved.
- *Cons*: Relies on consistent heading text patterns, requiring multiple regex expressions to catch variants.

```typescript
import * as fs from 'fs';
import { PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist';

async function locateSectionRange(pdfPath: string, patterns: RegExp[]): Promise<{ start: number; end: number } | null> {
  const loadingTask = pdfjs.getDocument(pdfPath);
  const pdfDoc = await loadingTask.promise;
  const numPages = pdfDoc.numPages;

  let startPage = -1;
  let endPage = -1;

  for (let i = 1; i <= numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map((item: any) => item.str).join(' ');

    if (startPage === -1) {
      if (patterns.some(pattern => pattern.test(pageText))) {
        startPage = i;
      }
    } else {
      // Find where next section starts to delineate the end
      if (/^\s*(?:SECTION|CHAPTER)\s+[IVXLCDM]+\s*[-–:]|BASIS\s+FOR\s+ISSUE\s+PRICE/i.test(pageText)) {
        endPage = i - 1;
        break;
      }
    }
  }

  if (startPage !== -1) {
    return { start: startPage, end: endPage === -1 ? startPage + 10 : endPage };
  }
  return null;
}
```

## Data Flow

### Request Flow

```
[Cron / GHA Trigger]
        ↓
[Ingest Adapter] ──(Stream Fetch)──→ [Source APIs (Upstox/NSE)]
        ↓
[Merge Adapter]  ──(Deduplicate)───→ [Unified Entities]
        ↓
[PDF Isolator]   ──(Page Search)───→ [Local Page Range PDF]
        ↓
[LLM Extractor]  ──(JSON Schema)───→ [Structured Facts]
        ↓
[Local DB Unit]  ──(Atomic Rename)─→ [master.json Update]
```

### State Management

```
[Local Database Cache]
        ↓ (Load/Save)
[Pipeline Processor] ──(Mark Processed)──→ [In-Memory State Map]
```

### Key Data Flows

1. **State Reconciliation & Processing Loop:** At the beginning of a workflow run, the cached state map of already processed IPOs is loaded. The pipeline filters out any records in the ingestion payloads that have already been completely processed, preventing redundant PDF downloads and LLM calls.
2. **Atomic In-Place Update Flow:** When updating the JSON file, the system writes to a temporary file (`master.json.[random].tmp`) and performs an atomic POSIX rename operation. This protects the database from truncation and syntax errors if the Node.js event loop is killed abruptly.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| **0-100 IPOs / year** | Single local runner, storing data inside a version-controlled git JSON file. Direct extraction via LLM endpoints. |
| **100-5k IPOs / year (Cross-global)** | Migration of JSON state to a persistent database (e.g. SQLite or Cloudflare D1 / KV store). Run PDF downloads and analysis inside serverless worker functions (AWS Lambda or Cloudflare Workers) triggered concurrently. |
| **5k+ Document Pipelines** | Implement message-queueing architectures (BullMQ, RabbitMQ) with distributed worker pools. Dedicate a worker cluster for visual document analysis and separate jobs for ingestion/merging. |

### Scaling Priorities

1. **First bottleneck:** Network timeout and memory limits when downloading/processing multiple massive PDFs concurrently in a single thread. Fix: Stream files directly to disk temp folders, process them sequentially or with bounded concurrency (`p-limit`), and isolate section page ranges before text extraction.
2. **Second bottleneck:** API rate limits (Cloudflare blocks on NSE; API token rotation on Upstox). Fix: Employ robust proxy routing, session/cookie reuse, and jittered delay policies between request retries.

## Anti-Patterns

### Anti-Pattern 1: Loading Full PDF Files in Memory

**What people do:** Reading the entire prospectus PDF buffer into memory using `fs.readFileSync` or passing it whole to parsing modules.
**Why it's wrong:** A 1000-page prospectus file can exceed 50-100MB in raw size, converting to several gigabytes of raw memory objects when parsed into DOM-like structures, crashing standard Node processes (`FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory`).
**Do this instead:** Stream PDF files to disk, extract the table of contents and target sections page-by-page, and process only the isolated page range.

### Anti-Pattern 2: Non-Atomic JSON Writes

**What people do:** Writing directly to the master database using `fs.writeFileSync('ipo.json', ...)` or `fs.writeFile(...)`.
**Why it's wrong:** If the system crashes, runs out of disk space, or is terminated while writing, the JSON file gets corrupted or truncated, breaking future pipeline runs.
**Do this instead:** Use the write-temp-then-rename pattern to perform atomic file updates.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| **Upstox API** | HTTP REST Client with Bearer Token auth. | Subject to API rate limits; tokens must be refreshed periodically. |
| **NSE API** | HTTP/1.1 client mimicking a real browser session. | Requires custom cookies and User-Agent headers to bypass Akamai bot protection. |
| **Cloudflare R2** | AWS S3 SDK (v3) client wrapper. | Used for durable caching of PDFs and generated Markdowns. |
| **Firecrawl API** | REST API client for visual layout-preserving extraction. | Used to convert the isolated section to markdown and extract key structured metrics. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `Ingest Adapters` ↔ `Pipeline Engine` | In-memory TypeScript Interfaces | Input adapters must map varying source payload schemas to a normalized internal representation. |
| `Pipeline Engine` ↔ `Atomic DB` | Local file writes and cache states | The Database module must block concurrent writes using simple file locks or queue write actions. |

## Sources

- [PDF Reference and outline specification (Adobe)](https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/PDF32000_2008.pdf)
- [Node.js Atomic File System write strategies](https://nodejs.org/api/fs.html#fspromisesrenameoldpath-newpath)
- [NSE India past listings specification](https://www.nseindia.com/products/content/equities/ipos/homepage_ipo.htm)

---
*Architecture research for: IPO Scraper & Processing Pipeline*
*Researched: 2026-06-06*
