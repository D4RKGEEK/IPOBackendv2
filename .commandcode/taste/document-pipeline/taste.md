# document-pipeline
- Resolve Google Drive document links to direct download URLs instead of rejecting them. Confidence: 0.70
- Detect section page ranges by skipping the first ~5 pages (cover + TOC) of Indian IPO prospectuses since pdfjs-dist returns text as space-joined strings (no line breaks), making trailing-page-number heuristics unreliable. Confidence: 0.75
- Minimize Firecrawl API calls — prefer batch/single-call strategies over per-section API calls to reduce cost and latency. Confidence: 0.65
- Use fallback chain for extraction: regex → validate → for failed sections → slice PDF to section pages → Firecrawl scrape → re-run extractor → validate. Confidence: 0.80
- Include provenance logging for all extracted data: track extraction method (regex vs firecrawl fallback), which module/function did the extraction, and why fallback was triggered. Confidence: 0.75
- Cap Firecrawl fallback page range at 200 pages max per section. Confidence: 0.70
- Upload the sliced markdown document (not the sliced PDF) in the Firecrawl fallback path — Firecrawl processes markdown, not raw PDF pages. Confidence: 0.65
