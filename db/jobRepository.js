'use strict';

/**
 * jobRepository.js — background job tracking (scrape, gmp, historical, documents).
 * A job: { _id, type, status: running|completed|failed, params, result, error, createdAt, finishedAt }.
 */

const { collections } = require('./mongo');

async function createJob(type, params = {}) {
  const now = new Date().toISOString();
  const res = await collections.jobs().insertOne({ type, status: 'running', params, result: null, error: null, createdAt: now, finishedAt: null });
  return res.insertedId.toString();
}

async function completeJob(id, result) {
  const { ObjectId } = require('mongodb');
  await collections.jobs().updateOne({ _id: new ObjectId(id) }, { $set: { status: 'completed', result, finishedAt: new Date().toISOString() } });
}

async function failJob(id, error) {
  const { ObjectId } = require('mongodb');
  await collections.jobs().updateOne({ _id: new ObjectId(id) }, { $set: { status: 'failed', error: String(error), finishedAt: new Date().toISOString() } });
}

async function getJob(id) {
  const { ObjectId } = require('mongodb');
  let _id;
  try { _id = new ObjectId(id); } catch { return null; }
  const job = await collections.jobs().findOne({ _id });
  if (!job) return null;
  return { jobId: job._id.toString(), ...job, _id: undefined };
}

async function listJobs({ type, status, limit = 20 } = {}) {
  const filter = {};
  if (type) filter.type = type;
  if (status) filter.status = status;
  const jobs = await collections.jobs().find(filter).sort({ createdAt: -1 }).limit(Math.min(100, limit)).toArray();
  return jobs.map((j) => ({ jobId: j._id.toString(), type: j.type, status: j.status, createdAt: j.createdAt, finishedAt: j.finishedAt, result: j.result, error: j.error }));
}

module.exports = { createJob, completeJob, failJob, getJob, listJobs };
