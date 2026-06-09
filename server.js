'use strict';

/**
 * server.js — IPO platform API entry point.
 * Connects MongoDB, builds the Express app, and listens.
 */

require('dotenv').config();

const { buildApp } = require('./app');
const { connect } = require('./db/mongo');

const PORT = process.env.PORT || 3001;

async function main() {
  await connect();
  const app = buildApp();
  app.listen(PORT, () => {
    console.log(`IPO API listening on http://localhost:${PORT}`);
    console.log('  GET  /health');
    console.log('  GET  /ipos                 — index (filter/sort/search/paginate)');
    console.log('  GET  /ipos/:slug           — full details (?raw=true for per-source)');
    console.log('  GET  /sources              — sources + counts');
  });
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
