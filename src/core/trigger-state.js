'use strict';

const crypto = require('crypto');
const { appPaths, readJSON, writeJSON } = require('./paths');

const MAX_SEEN = 200;
const SEEN_TTL_MS = 24 * 60 * 60 * 1000;

function cleanState(raw) {
  const state = { version: 1, seen: {}, lastFired: {}, mcp: {} };
  if (!raw || typeof raw !== 'object') return state;
  if (raw.seen && typeof raw.seen === 'object' && !Array.isArray(raw.seen)) state.seen = { ...raw.seen };
  if (raw.lastFired && typeof raw.lastFired === 'object' && !Array.isArray(raw.lastFired)) state.lastFired = { ...raw.lastFired };
  if (raw.mcp && typeof raw.mcp === 'object' && !Array.isArray(raw.mcp)) state.mcp = { ...raw.mcp };
  return state;
}

function loadTriggerState() {
  return cleanState(readJSON(appPaths().triggerState, null));
}

function hashKey(key) {
  return crypto.createHash('sha256').update(String(key || '')).digest('hex');
}

function pruneState(state, now = new Date()) {
  if (!state || typeof state !== 'object') return state;
  const current = now instanceof Date ? now.getTime() : Number(now) || Date.now();
  const seen = state.seen && typeof state.seen === 'object' ? state.seen : {};
  const entries = Object.entries(seen)
    .map(([key, value]) => [key, Date.parse(String(value))])
    .filter(([, at]) => Number.isFinite(at) && current - at <= SEEN_TTL_MS)
    .sort((left, right) => right[1] - left[1])
    .slice(0, MAX_SEEN);
  state.seen = Object.fromEntries(entries.map(([key, at]) => [key, new Date(at).toISOString()]));
  return state;
}

function seenRecently(state, key, now = Date.now(), windowMs = 60_000) {
  if (!state?.seen) return false;
  const at = Date.parse(String(state.seen[hashKey(key)] || ''));
  if (!Number.isFinite(at)) return false;
  const current = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(current)) return false;
  return current - at <= windowMs;
}

function rememberSeen(state, key, now = Date.now()) {
  if (!state) return;
  if (!state.seen || typeof state.seen !== 'object') state.seen = {};
  const at = now instanceof Date ? now.getTime() : Number(now) || Date.now();
  state.seen[hashKey(key)] = new Date(at).toISOString();
  pruneState(state, new Date(at));
}

function lastFiredAt(state, id) {
  const value = state?.lastFired?.[id];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function markFired(state, id, now = Date.now()) {
  if (!state || !id) return;
  if (!state.lastFired || typeof state.lastFired !== 'object') state.lastFired = {};
  const at = now instanceof Date ? now.getTime() : Number(now) || Date.now();
  state.lastFired[id] = new Date(at).toISOString();
}

function deleteTriggerState(state, id) {
  if (!state || !id) return;
  if (state.lastFired) delete state.lastFired[id];
  if (state.mcp) delete state.mcp[id];
}

function saveTriggerState(state) {
  pruneState(state, new Date());
  writeJSON(appPaths().triggerState, state);
}

module.exports = {
  loadTriggerState,
  saveTriggerState,
  pruneState,
  seenRecently,
  rememberSeen,
  lastFiredAt,
  markFired,
  deleteTriggerState,
  hashKey,
};
