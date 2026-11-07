'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'blank-trigger-state-'));
process.env.BLANK_HOME = home;

const stateModule = require('../src/core/trigger-state');
const { appPaths } = require('../src/core/paths');

test.after(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

test('missing state loads a clean versioned object', () => {
  const state = stateModule.loadTriggerState();
  assert.deepEqual(state, { version: 1, seen: {}, lastFired: {}, mcp: {} });
  assert.equal(appPaths().triggerState, path.join(home, 'trigger-state.json'));
});

test('seen entries remember, expire and hash the key', () => {
  const state = stateModule.loadTriggerState();
  const now = Date.now();
  assert.equal(stateModule.seenRecently(state, 'raw-key', now, 5000), false);
  stateModule.rememberSeen(state, 'raw-key', now);
  assert.equal(stateModule.seenRecently(state, 'raw-key', now + 1000, 5000), true);
  assert.equal(stateModule.seenRecently(state, 'raw-key', now + 6000, 5000), false);
  assert.ok(!JSON.stringify(state).includes('raw-key'));
});

test('pruning keeps 200 newest seen entries and drops old ones', () => {
  const state = stateModule.loadTriggerState();
  const base = Date.now();
  for (let index = 0; index < 210; index += 1) {
    stateModule.rememberSeen(state, `key-${index}`, base + index);
  }
  state.seen[stateModule.hashKey('old')] = new Date(base - 25 * 60 * 60 * 1000).toISOString();
  stateModule.pruneState(state, new Date(base + 1000));
  assert.equal(Object.keys(state.seen).length, 200);
  assert.equal(state.seen[stateModule.hashKey('old')], undefined);
});

test('fired timestamps and MCP entries round-trip through the file', () => {
  const state = stateModule.loadTriggerState();
  stateModule.markFired(state, 'sch_a', new Date('2026-11-07T00:00:00.000Z'));
  state.mcp.sch_a = { configHash: 'h', fingerprint: 'f', baselineAt: '2026-11-07T00:00:00.000Z', lastError: '' };
  stateModule.saveTriggerState(state);
  const loaded = stateModule.loadTriggerState();
  assert.equal(stateModule.lastFiredAt(loaded, 'sch_a'), Date.parse('2026-11-07T00:00:00.000Z'));
  assert.equal(loaded.mcp.sch_a.fingerprint, 'f');
  stateModule.deleteTriggerState(loaded, 'sch_a');
  assert.equal(loaded.lastFired.sch_a, undefined);
  assert.equal(loaded.mcp.sch_a, undefined);
});
