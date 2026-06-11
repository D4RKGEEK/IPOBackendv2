import { readFileSync, writeFileSync } from "fs";
const pdf2md = (await import("@opendocsg/pdf2md")).default;
const pdfPath = "/Users/vaibhav/Desktop/nse/pdf_cache/ad73a3796325_RHP_Leapfrog_BSE_08042026-2026-04-09-12-31.pdf";
const pdfData = readFileSync(pdfPath);
const markdown = await pdf2md(pdfData);
console.log("MARKDOWN_START");
console.log(markdown);
console.log("MARKDOWN_END");