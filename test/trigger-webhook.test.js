'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createWebhookServer } = require('../electron/trigger-webhook');

const record = {
  id: 'sch_hook',
  enabled: true,
  prompt: 'Handle the hook.',
  trigger: {
    type: 'webhook',
    config: { token: 'test-token', allowQueryToken: false },
    cooldownSeconds: 5,
  },
};

function makeServer(options = {}) {
  const calls = [];
  const server = createWebhookServer({
    getRecords: () => [record],
    getConfig: () => ({ triggers: { webhookPort: 0, webhookAllowLan: false } }),
    dispatch: async (entry, event) => {
      calls.push(event);
      if (options.reply) return options.reply;
      return { started: true, sessionId: 's_hook' };
    },
    onStatus: () => {},
  });
  return { server, calls };
}

test('webhook accepts a bearer token and dispatches the body', async () => {
  const { server, calls } = makeServer();
  test.after(() => server.stop());
  const status = await server.start();
  assert.equal(status.running, true);
  assert.ok(status.port > 0);

  const response = await fetch(`http://127.0.0.1:${status.port}/hooks/sch_hook`, {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify({ build: 42 }),
  });
  assert.equal(response.status, 202);
  const payload = await response.json();
  assert.equal(payload.started, true);
  assert.equal(payload.sessionId, 's_hook');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body, { build: 42 });
  assert.equal(calls[0].type, 'webhook');
  assert.equal(calls[0].recordId, 'sch_hook');
});

test('webhook rejects a bad token, unknown id and wrong method', async () => {
  const { server } = makeServer();
  test.after(() => server.stop());
  const status = await server.start();
  const base = `http://127.0.0.1:${status.port}`;

  const bad = await fetch(`${base}/hooks/sch_hook`, {
    method: 'POST',
    headers: { authorization: 'Bearer wrong' },
    body: '{}',
  });
  assert.equal(bad.status, 401);

  const unknown = await fetch(`${base}/hooks/nope`, {
    method: 'POST',
    headers: { authorization: 'Bearer test-token' },
    body: '{}',
  });
  assert.equal(unknown.status, 401);

  const wrongMethod = await fetch(`${base}/hooks/sch_hook`, {
    method: 'GET',
    headers: { authorization: 'Bearer test-token' },
  });
  assert.equal(wrongMethod.status, 405);
});

test('webhook reports a skipped dispatch without failing', async () => {
  const { server } = makeServer({ reply: { started: false, reason: 'cooldown' } });
  test.after(() => server.stop());
  const status = await server.start();
  const response = await fetch(`http://127.0.0.1:${status.port}/hooks/sch_hook`, {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: '{"ok":true}',
  });
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { ok: true, started: false, reason: 'cooldown' });
});

test('webhook enforces the body limit and query-token policy', async () => {
  const { server } = makeServer();
  test.after(() => server.stop());
  const status = await server.start();
  const base = `http://127.0.0.1:${status.port}`;

  const big = await fetch(`${base}/hooks/sch_hook?token=test-token`, {
    method: 'POST',
    headers: { authorization: 'Bearer test-token' },
    body: 'x'.repeat(70 * 1024),
  });
  assert.equal(big.status, 413);

  const query = await fetch(`${base}/hooks/sch_hook?token=test-token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"a":1}',
  });
  assert.equal(query.status, 401);
});
