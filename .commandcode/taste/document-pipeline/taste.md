# document-pipeline
- Upload HTML directly to Firecrawl's `/v2/parse` endpoint (multipart file upload) instead of uploading to R2 first — avoids R2 storage and round-trip latency. NOTE: Deprecated — Firecrawl not used anymore. Confidence: 0.65
- Resolve Google Drive document links to direct download URLs instead of rejecting them. Confidence: 0.70
- Detect section page ranges by skipping the first ~5 pages (cover + TOC) of Indian IPO prospectuses since pdfjs-dist returns text as space-joined strings (no line breaks), making trailing-page-number heuristics unreliable. Confidence: 0.75
- Do NOT use Firecrawl as a fallback for extraction — the data returned is unreliable/incorrect; rely solely on regex extraction from the original Nutrient-generated markdown. Confidence: 0.85
- Include provenance logging for all extracted data: track extraction method (regex vs firecrawl fallback), which module/function did the extraction, and why fallback was triggered. NOTE: Firecrawl fallback is deprecated. Confidence: 0.75
- Cap Firecrawl fallback page range at 200 pages max per section. Confidence: 0.70
