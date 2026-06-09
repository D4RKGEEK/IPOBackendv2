'use strict';

/**
 * migrate.js — load ipo_master.json into MongoDB via the repository upsert.
 * Usage: node scripts/migrate.js [path-to-master.json]
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { connect, close } = require('../db/mongo');
const { upsertRecord } = require('../db/ipoRepository');

async function main() {
  const file = process.argv[2] || path.join(__dirname, '..', 'ipo_master.json');
  const records = JSON.parse(fs.readFileSync(file, 'utf8'));
  await connect();

  const tally = { new: 0, updated: 0, unchanged: 0, errors: 0 };
  for (const rec of records) {
    try {
      const { action } = await upsertRecord(rec);
      tally[action]++;
    } catch (e) {
      tally.errors++;
      console.error(`  ✗ ${rec.symbol || rec.companyName}: ${e.message}`);
    }
  }
  console.log(`Migrated ${records.length} records:`, tally);
  await close();
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
