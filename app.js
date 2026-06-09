'use strict';

/**
 * app.js — Express application for the IPO platform API.
 * Routers are mounted here; server.js wires the Mongo connection and listens.
 */

const express = require('express');
const { query, findBySlug } = require('./db/ipoRepository');
const { collections } = require('./db/mongo');
const { runScrape, ALL_SOURCES } = require('./services/scrapeService');
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
      out.push({ source: s, ipos: count });
    }
    res.json({ sources: out });
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
