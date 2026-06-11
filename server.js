'use strict';

/**
 * server.js — IPO platform API entry point.
 * Connects MongoDB, builds the Express app, and listens.
 */

// ── Polyfill for pdfjs-dist (used by all PDF extraction code) ──────────────
// pdfjs-dist 4.x uses Promise.withResolvers() at module-load time, which
// requires Node.js 22+. Railway likely runs an older Node. This polyfill
// ensures it's available before any module requiring pdfjs-dist loads.
if (typeof Promise.withResolvers === 'undefined') {
  Promise.withResolvers = function () {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
}

require('dotenv').config();

const { buildApp } = require('./app');
const { connect } = require('./db/mongo');
const { logger } = require('./utils/logger');

const PORT = process.env.PORT || 3001;

async function main() {
  await connect();
  const app = buildApp();
  app.listen(PORT, () => {
    logger.info({ port: PORT }, 'IPO API started');
  });
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
