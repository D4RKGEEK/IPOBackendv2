# Taste (Continuously Learned by [CommandCode][cmd])

[cmd]: https://commandcode.ai/

# ui
- Use Tailwind CSS for styling. Confidence: 0.50
- Design UI in a clean, simple Groww-style aesthetic (modern fintech, card-based, minimal). Confidence: 0.50

# document-pipeline
- Resolve Google Drive document links to direct download URLs instead of rejecting them. Confidence: 0.70
- Detect section page ranges by using TOC-aware heading detection that skips TOC pages (pages where >30% of lines end in page numbers) to avoid matching TOC entries instead of actual section headers. Confidence: 0.80
- Minimize Firecrawl API calls — prefer batch/single-call strategies over per-section API calls to reduce cost and latency. Confidence: 0.65
- Use fallback chain for extraction: regex → validate → for failed sections → slice PDF to section pages → Firecrawl scrape → re-run extractor → validate. Confidence: 0.70
- Include provenance logging for all extracted data: track extraction method (regex vs firecrawl fallback), which module/function did the extraction, and why fallback was triggered. Confidence: 0.75
