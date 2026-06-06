'use strict';

require('dotenv').config();

const http = require('http');
const fs = require('fs');
const path = require('path');

const { writeAtomicSync } = require('./utils/atomicWrite');
const { downloadPdf } = require('./utils/pdfDownloader');
const { extractFinancials, extractPromoterHolding } = require('./utils/tableExtractor');
const { fetchTodayCandle } = require('./utils/candleFetcher');
const { extractSectionsForIpo, sanitize } = require('./utils/sectionsExtractor');
const { detectAllTables } = require('./utils/tableDetector');

const MASTER_FILE = path.join(__dirname, 'ipo_master.json');
const DATA_DIR = path.join(__dirname, 'data');
const PORT = process.env.PORT || 3001;

function loadMaster() {
  try { return JSON.parse(fs.readFileSync(MASTER_FILE, 'utf8')); } catch { return []; }
}

function saveMaster(ipos) {
  writeAtomicSync(MASTER_FILE, ipos);
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function sendFile(res, filePath, contentType) {
  if (!fs.existsSync(filePath)) {
    return sendJson(res, 404, { error: 'File not found', path: filePath });
  }
  const stat = fs.statSync(filePath);
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': stat.size,
  });
  fs.createReadStream(filePath).pipe(res);
}

const MIME = { '.pdf': 'application/pdf', '.md': 'text/markdown; charset=utf-8', '.json': 'application/json' };

const enriching = new Set();

async function enrichIpo(ipo) {
  const updates = {};
  const rhpUrl = ipo.documentUrls && (ipo.documentUrls.rhp || ipo.documentUrls.drhp);

  if (rhpUrl && !ipo.ratios) {
    try {
      const dl = await downloadPdf(rhpUrl);
      if (dl.status === 'success' || dl.status === 'already_parsed') {
        const filePath = dl.filePath;
        const [financials, promoter] = await Promise.all([
          extractFinancials(filePath),
          extractPromoterHolding(filePath),
        ]);
        updates.ratios = { ...financials, promoterHolding: promoter };
      } else {
        updates.ratios = { _pdfStatus: dl.status };
      }
    } catch (e) {
      updates.ratios = { _error: e.message };
    }
  }

  const listingYear = ipo.listingDate && new Date(ipo.listingDate).getFullYear();
  if (ipo.isin && listingYear === 2026 && !ipo.todayCandle) {
    try {
      const token = process.env.UPSTOX_ACCESS_TOKEN;
      if (token) updates.todayCandle = await fetchTodayCandle(ipo.isin, token);
    } catch (e) {
      updates.todayCandle = { _error: e.message };
    }
  }

  if (rhpUrl && !ipo.sections) {
    try {
      const secResult = await extractSectionsForIpo(ipo);
      updates.sections = secResult.sections;
      updates._sectionsPdfStatus = secResult.pdfStatus;
      updates._sectionsErrors = secResult.errors;
    } catch (e) {
      updates.sections = { _error: e.message };
    }
  }

  return updates;
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  // ── GET /ipos ──────────────────────────────────────────────────────────────
  if (req.method === 'GET' && url === '/ipos') {
    const ipos = loadMaster();
    const list = ipos.map(ipo => ({
      id: ipo.isin,
      isin: ipo.isin,
      symbol: ipo.symbol,
      companyName: ipo.companyName,
      status: ipo.status,
      issueType: ipo.issueType,
      biddingStartDate: ipo.biddingStartDate,
      biddingEndDate: ipo.biddingEndDate,
      listingDate: ipo.listingDate,
      priceBand: ipo.priceBand,
      issueSize: ipo.issueSize,
    }));
    return sendJson(res, 200, { count: list.length, ipos: list });
  }

  // ── GET /ipos/:id/sections/:sectionName/:file ──────────────────────────────
  const sectionFile = url.match(/^\/ipos\/([^/]+)\/sections\/([A-Z_]+)\.(pdf|md)$/);
  if (req.method === 'GET' && sectionFile) {
    const id = decodeURIComponent(sectionFile[1]);
    const sectionName = sectionFile[2];
    const ext = sectionFile[3];
    const ipos = loadMaster();
    const ipo = ipos.find(i => i.isin === id || i.symbol === id);
    if (!ipo) return sendJson(res, 404, { error: 'IPO not found', id });
    const companyDir = sanitize(ipo.companyName || ipo.symbol || 'unknown');
    const filePath = path.join(DATA_DIR, companyDir, 'pdfs', `${sectionName}.${ext}`);
    return sendFile(res, filePath, MIME['.' + ext]);
  }

  // ── GET /ipos/:id/tables ───────────────────────────────────────────────────
  const tablesMatch = url.match(/^\/ipos\/([^/]+)\/tables$/);
  if (req.method === 'GET' && tablesMatch) {
    const id = decodeURIComponent(tablesMatch[1]);
    const ipos = loadMaster();
    const ipo = ipos.find(i => i.isin === id || i.symbol === id);
    if (!ipo) return sendJson(res, 404, { error: 'IPO not found', id });

    // Need PDF — download first
    const rhpUrl = ipo.documentUrls && (ipo.documentUrls.rhp || ipo.documentUrls.drhp);
    if (!rhpUrl) return sendJson(res, 400, { error: 'No PDF URL available for this IPO' });

    try {
      const dl = await downloadPdf(rhpUrl);
      if (dl.status !== 'success' && dl.status !== 'already_parsed') {
        return sendJson(res, 500, { error: `PDF download failed: ${dl.status}` });
      }
      const tables = await detectAllTables(dl.filePath);
      return sendJson(res, 200, {
        companyName: ipo.companyName,
        symbol: ipo.symbol,
        isin: ipo.isin,
        totalTables: tables.length,
        tables,
      });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  // ── GET /ipos/:id ──────────────────────────────────────────────────────────
  const detailMatch = url.match(/^\/ipos\/([^/]+)$/);
  if (req.method === 'GET' && detailMatch) {
    const id = decodeURIComponent(detailMatch[1]);
    const ipos = loadMaster();
    const idx = ipos.findIndex(i => i.isin === id || i.symbol === id);
    if (idx === -1) return sendJson(res, 404, { error: 'IPO not found', id });
    const ipo = ipos[idx];

    if (!enriching.has(ipo.isin)) {
      const needs = !ipo.ratios || !ipo.todayCandle;
      if (needs) {
        enriching.add(ipo.isin);
        try {
          const updates = await enrichIpo(ipo);
          if (Object.keys(updates).length > 0) {
            ipos[idx] = { ...ipo, ...updates, _enrichedAt: new Date().toISOString() };
            saveMaster(ipos);
            return sendJson(res, 200, ipos[idx]);
          }
        } finally { enriching.delete(ipo.isin); }
      }
    }
    return sendJson(res, 200, ipo);
  }

  sendJson(res, 404, { error: 'Not found', path: url });
});

server.listen(PORT, () => {
  console.log(`IPO API listening on http://localhost:${PORT}`);
  console.log(`  GET /ipos                              — list all IPOs`);
  console.log(`  GET /ipos/:isin                        — full details + lazy extraction`);
  console.log(`  GET /ipos/:isin/tables                 — all PDF tables as JSON`);
  console.log(`  GET /ipos/:isin/sections/:name.pdf     — serve section PDF`);
  console.log(`  GET /ipos/:isin/sections/:name.md      — serve section markdown`);
});
