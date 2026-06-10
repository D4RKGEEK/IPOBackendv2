# Taste (Continuously Learned by [CommandCode][cmd])

[cmd]: https://commandcode.ai/

# ui
- Use Tailwind CSS for styling. Confidence: 0.50
- Design UI in a clean, simple Groww-style aesthetic (modern fintech, card-based, minimal). Confidence: 0.50

# document-pipeline
- Resolve Google Drive document links to direct download URLs instead of rejecting them. Confidence: 0.70
- Detect section page ranges by scanning the already-loaded `pages[]` array (from `readPageTexts()`) for section heading patterns, rather than doing a separate PDF parse with `tocLocator.js` or `pdfreader`. Confidence: 0.70

