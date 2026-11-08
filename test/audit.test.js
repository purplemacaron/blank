'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAudit } = require('../src/core/audit');

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'blank-audit-'));
}

test('writes one JSON line per event', () => {
  const root = tempRoot();
  const audit = createAudit({ root });
  audit.record('run.start', { sessionId: 's_1', model: 'gpt-4o', mode: 'agent' });
  audit.record('tool.call', { sessionId: 's_1', tool: 'read_file', ok: true });
  const lines = fs.readFileSync(audit.file(), 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  const first = JSON.parse(lines[0]);
  assert.equal(first.type, 'run.start');
  assert.equal(first.sessionId, 's_1');
  assert.ok(first.ts, 'each entry carries a timestamp');
});

test('masks secrets in fields and inline text', () => {
  const root = tempRoot();
  const audit = createAudit({ root });
  audit.record('tool.call', {
    sessionId: 's_1',
    apiKey: 'sk-live-abcdef1234567890',
    token: 'ghp_abcdefghijklmnopqrstuvwx',
    args: { password: 'hunter2', path: 'src/app.js' },
    headers: { Authorization: 'Bearer abcdefghijkl' },
    note: 'using sk-live-abcdef1234567890 now',
  });
  const raw = fs.readFileSync(audit.file(), 'utf8');
  assert.ok(!raw.includes('sk-live-abcdef1234567890'));
  assert.ok(!raw.includes('hunter2'));
  assert.ok(!raw.includes('abcdefghijkl'));
  const entry = JSON.parse(raw.trim());
  assert.equal(entry.apiKey, '***');
  assert.equal(entry.token, '***');
  assert.equal(entry.args.password, '***');
  assert.equal(entry.args.path, 'src/app.js');
  assert.equal(entry.headers.Authorization, '***');
  assert.ok(entry.note.includes('sk-live'), 'inline secrets inside prose are replaced too');
  assert.ok(entry.note.includes('***'));
});

test('rotates the log once it passes the size limit', () => {
  const root = tempRoot();
  const audit = createAudit({ root, maxBytes: 600, keep: 2 });
  for (let index = 0; index < 30; index += 1) {
    audit.record('tool.call', { index, pad: 'x'.repeat(80) });
  }
  const files = fs.readdirSync(path.join(root, 'logs')).sort();
  assert.ok(files.includes('audit.jsonl'));
  assert.ok(files.some((name) => name.startsWith('audit-')), 'an older segment was kept');
  assert.ok(files.length <= 3, 'current file plus two segments');
  for (const name of files.filter((entry) => entry.startsWith('audit-') && entry !== 'audit.jsonl')) {
    const text = fs.readFileSync(path.join(root, 'logs', name), 'utf8');
    for (const line of text.trim().split('\n')) JSON.parse(line);
  }
});

test('prune drops entries older than the retention window', () => {
  const root = tempRoot();
  const audit = createAudit({ root, retentionDays: 1 });
  audit.record('run.start', { old: true }, { at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) });
  audit.record('run.start', { old: false });
  audit.prune();
  const lines = fs.readFileSync(audit.file(), 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).old, false);
});

test('info reports the log path and size', () => {
  const root = tempRoot();
  const audit = createAudit({ root });
  audit.record('run.start', { sessionId: 's_1' });
  const info = audit.info();
  assert.equal(info.path, audit.file());
  assert.ok(info.bytes > 0);
});
