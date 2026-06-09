'use strict';

/**
 * app.js — Express application for the IPO platform API.
 * Routers are mounted here; server.js wires the Mongo connection and listens.
 */

const express = require('express');
const { query, findBySlug, deleteBySlug } = require('./db/ipoRepository');
const { collections } = require('./db/mongo');
const r2 = require('./utils/r2');
const { runScrape, ALL_SOURCES } = require('./services/scrapeService');
const { processDocuments } = require('./services/documentService');
const { runGmp } = require('./services/gmpService');
const { runHistorical } = require('./services/historicalService');
const { createJob, completeJob, failJob, getJob, listJobs } = require('./db/jobRepository');

function buildApp() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  const asyncH = (fn) => (req, res) => fn(req, res).catch((e) => {
    console.error(`[api] ${req.method} ${req.path}:`, e.message);
    res.status(500).json({ error: e.message });
  });

  // ── Index card projection for GET /ipos ────────────────────────────────────
  function toCard(doc) {
    return {
      slug: doc.slug,
      companyName: doc.companyName,
      displayName: doc.displayName,
      isin: doc.isin,
      symbol: doc.symbol,
      status: doc.status,
      issueType: doc.issueType,
      priceBand: doc.priceBand,
      lotSize: doc.lotSize,
      issueSize: doc.issueSize,
      listingDate: doc.listingDate,
      gmp: doc.gmp ? doc.gmp.value : null,
      sector: doc.sector,
      sources: Object.keys(doc.sources || {}),
      documents: doc.documents || {},
      updatedAt: doc.updatedAt,
      createdAt: doc.createdAt,
    };
  }

  app.get('/health', asyncH(async (_req, res) => {
    const count = await collections.ipos().estimatedDocumentCount();
    res.json({ ok: true, ipos: count });
  }));

  // API 1: GET /ipos — meta/index
  app.get('/ipos', asyncH(async (req, res) => {
    const { data, pagination } = await query(req.query);
    res.json({ data: data.map(toCard), pagination });
  }));

  // GET /sources — available sources + health
  app.get('/sources', asyncH(async (_req, res) => {
    const ipos = collections.ipos();
    const known = ['nse', 'bse', 'upstox', 'groww', 'zerodha', 'investorgain'];
    const out = [];
    for (const s of known) {
      const count = await ipos.countDocuments({ [`sources.${s}`]: { $exists: true } });
      const latest = await ipos.find({ [`sources.${s}.lastFetched`]: { $exists: true } })
        .sort({ [`sources.${s}.lastFetched`]: -1 }).limit(1).project({ sources: 1 }).toArray();
      out.push({
        source: s,
        ipos: count,
        healthy: count > 0,
        lastFetched: latest[0] ? latest[0].sources[s].lastFetched : null,
      });
    }
    const lastScrape = (await collections.jobs().find({ type: 'scrape' }).sort({ createdAt: -1 }).limit(1).toArray())[0] || null;
    res.json({ sources: out, lastScrape: lastScrape ? { jobId: lastScrape._id.toString(), status: lastScrape.status, at: lastScrape.createdAt } : null });
  }));

  // API 2: GET /ipos/:slug — full details (merged, or ?raw=true)
  app.get('/ipos/:slug', asyncH(async (req, res) => {
    const doc = await findBySlug(req.params.slug);
    if (!doc) return res.status(404).json({ error: 'IPO not found', slug: req.params.slug });
    if (req.query.raw === 'true') {
      return res.json({ slug: doc.slug, _raw: doc.raw_sources || {} });
    }
    const { raw_sources, _id, ...merged } = doc;
    res.json(merged);
  }));

  // API 3: POST /ipos/scrape — scrape & save
  // Body: { sources?, dryRun?, force?, async? }. Synchronous by default (returns
  // summary); pass async:true to get a jobId immediately and poll GET /jobs/:id.
  app.post('/ipos/scrape', asyncH(async (req, res) => {
    const { sources, dryRun = false, force = false, async: isAsync = false } = req.body || {};
    const params = { sources: sources || ALL_SOURCES, dryRun, force };
    const jobId = await createJob('scrape', params);

    if (isAsync) {
      runScrape({ sources, dryRun, force })
        .then((summary) => completeJob(jobId, summary))
        .catch((e) => failJob(jobId, e.message));
      return res.status(202).json({ jobId, status: 'running', poll: `/jobs/${jobId}` });
    }

    try {
      const summary = await runScrape({ sources, dryRun, force });
      await completeJob(jobId, summary);
      res.json({ jobId, ...summary });
    } catch (e) {
      await failJob(jobId, e.message);
      throw e;
    }
  }));

  // API 4: POST /ipos/:slug/documents — extract & upload PDFs
  // Body: { documents?: ["drhp","rhp"], reUpload?: false }
  app.post('/ipos/:slug/documents', asyncH(async (req, res) => {
    const { documents, reUpload = false } = req.body || {};
    const out = await processDocuments(req.params.slug, { documents, reUpload });
    if (out.error) return res.status(404).json(out);
    res.json(out);
  }));

  // GET /ipos/:slug/history — GMP / status time series
  app.get('/ipos/:slug/history', asyncH(async (req, res) => {
    const doc = await findBySlug(req.params.slug);
    if (!doc) return res.status(404).json({ error: 'IPO not found', slug: req.params.slug });
    const gmp = await collections.gmpHistory().find({ slug: req.params.slug }).sort({ at: -1 }).limit(500).toArray();
    res.json({
      slug: req.params.slug,
      statusHistory: doc.statusHistory || [],
      gmp: gmp.map((g) => ({ value: g.value, percentage: g.percentage, source: g.source, at: g.at })),
    });
  }));

  // API 5: POST /ipos/gmp — scrape GMP (open/upcoming only), store + time-series
  app.post('/ipos/gmp', asyncH(async (req, res) => {
    const { slugs, status } = req.body || {};
    res.json(await runGmp({ slugs, status }));
  }));

  // API 6: POST /ipos/historical — post-listing price data for listed IPOs
  app.post('/ipos/historical', asyncH(async (req, res) => {
    const { status, since, limit } = req.body || {};
    res.json(await runHistorical({ status, since, limit }));
  }));

  // POST /ipos/:slug/retry — retry failed document extraction
  app.post('/ipos/:slug/retry', asyncH(async (req, res) => {
    const ipo = await findBySlug(req.params.slug);
    if (!ipo) return res.status(404).json({ error: 'IPO not found', slug: req.params.slug });
    // Default to retrying documents currently in error; else whatever body asks.
    const errored = Object.entries(ipo.documents || {}).filter(([, m]) => m && m.status === 'error').map(([t]) => t);
    const documents = (req.body && req.body.documents) || errored;
    if (!documents.length) return res.json({ retried: [], message: 'nothing in error state' });
    const out = await processDocuments(req.params.slug, { documents, reUpload: true });
    res.json({ retried: documents, result: out });
  }));

  // DELETE /ipos/:slug — remove IPO + its documents (R2) + GMP history
  app.delete('/ipos/:slug', asyncH(async (req, res) => {
    const ipo = await findBySlug(req.params.slug);
    if (!ipo) return res.status(404).json({ error: 'IPO not found', slug: req.params.slug });
    let r2Deleted = 0;
    try {
      const sym = String(ipo.symbol || ipo.slug).toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
      r2Deleted = (await r2.deletePrefix(`ipos/${sym}/`)).deleted;
    } catch (e) { /* R2 optional / not configured */ }
    await collections.gmpHistory().deleteMany({ slug: req.params.slug });
    await deleteBySlug(req.params.slug);
    res.json({ deleted: req.params.slug, r2ObjectsDeleted: r2Deleted });
  }));

  // GET /jobs — background job status (history)
  app.get('/jobs', asyncH(async (req, res) => {
    res.json({ jobs: await listJobs(req.query) });
  }));

  app.get('/jobs/:id', asyncH(async (req, res) => {
    const job = await getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found', id: req.params.id });
    res.json(job);
  }));

  app.use((req, res) => res.status(404).json({ error: 'Not found', path: req.path }));
  return app;
}

module.exports = { buildApp };
