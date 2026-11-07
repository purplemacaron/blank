'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const triggers = require('../src/core/triggers');

test('a new automation defaults to a daily schedule trigger', () => {
  const trigger = triggers.normalizeTrigger({}, null, new Date(2026, 10, 7, 10, 0));
  assert.equal(trigger.type, 'schedule');
  assert.deepEqual(trigger.config, {
    cadence: 'daily',
    date: '',
    time: '09:00',
    everyMinutes: 30,
  });
  assert.equal(trigger.cooldownSeconds, 0);
});

test('file, startup, mcp, messenger and session defaults are filled in', () => {
  const file = triggers.normalizeTrigger({ type: 'file', config: { paths: ['C:\\work'] } });
  assert.deepEqual(file.config.events, ['change']);
  assert.equal(file.config.debounceSeconds, 3);
  assert.equal(file.cooldownSeconds, 60);

  const startup = triggers.normalizeTrigger({ type: 'startup', config: {} });
  assert.equal(startup.config.delaySeconds, 15);
  assert.equal(startup.cooldownSeconds, 0);

  const mcp = triggers.normalizeTrigger({ type: 'mcp', config: { serverId: 'github', toolName: 'issues' } });
  assert.deepEqual(mcp.config.args, {});
  assert.equal(mcp.config.intervalSeconds, 300);

  assert.throws(
    () => triggers.normalizeTrigger({ type: 'messenger', config: {} }),
    /provider/i,
  );
  const messenger = triggers.normalizeTrigger({
    type: 'messenger',
    config: { provider: 'telegram', textIncludes: 'deploy' },
  });
  assert.equal(messenger.config.fromIncludes, '');
  assert.equal(messenger.config.textIncludes, 'deploy');
  assert.equal(messenger.cooldownSeconds, 10);

  const session = triggers.normalizeTrigger({ type: 'session', config: {} });
  assert.equal(session.config.on, 'complete');
  assert.equal(session.config.includeAutomationRuns, false);
  assert.equal(session.cooldownSeconds, 30);
});

test('invalid trigger values are rejected', () => {
  assert.throws(() => triggers.normalizeTrigger({ type: 'nope' }), /unknown trigger/i);
  assert.throws(() => triggers.normalizeTrigger({
    type: 'file',
    config: { paths: [] },
  }), /path/i);
  assert.throws(() => triggers.normalizeTrigger({
    type: 'file',
    config: { paths: ['C:\\work'], events: ['explode'] },
  }), /event/i);
  assert.throws(() => triggers.normalizeTrigger({
    type: 'mcp',
    config: { serverId: 's', toolName: 't', intervalSeconds: 5 },
  }), /interval/i);
  assert.throws(() => triggers.normalizeTrigger({
    type: 'mcp',
    config: { serverId: 's', toolName: 't', args: [] },
  }), /args/i);
  assert.throws(() => triggers.normalizeTrigger({
    type: 'session',
    config: { on: 'stopped' },
  }), /session trigger/i);
});

test('webhook tokens are generated, preserved and never taken from input', () => {
  const first = triggers.normalizeTrigger({ type: 'webhook', config: {} });
  assert.match(first.config.token, /^[A-Za-z0-9_-]{40,}$/);
  assert.equal(first.config.allowQueryToken, false);
  assert.equal(first.cooldownSeconds, 5);

  const kept = triggers.normalizeTrigger(
    { type: 'webhook', config: { allowQueryToken: true } },
    { trigger: first },
  );
  assert.equal(kept.config.token, first.config.token);
  assert.equal(kept.config.allowQueryToken, true);

  const attacker = triggers.normalizeTrigger(
    { type: 'webhook', config: { token: 'attacker-token' } },
    { trigger: first },
  );
  assert.notEqual(attacker.config.token, 'attacker-token');
  assert.equal(attacker.config.token, first.config.token);

  const switched = triggers.normalizeTrigger(
    { type: 'mcp', config: { serverId: 's', toolName: 't' } },
    { trigger: first },
  );
  assert.equal(switched.config.token, undefined);
});

test('legacy records migrate to a schedule trigger exactly once', () => {
  const legacy = {
    id: 'sch_legacy',
    title: 'Old',
    prompt: 'Run it.',
    cadence: 'weekdays',
    date: '',
    time: '08:30',
    everyMinutes: 15,
    enabled: true,
    history: [{ at: '2026-11-01T00:00:00.000Z', status: 'ok' }],
    runCount: 2,
  };
  const migrated = triggers.migrateRecord(legacy);
  assert.equal(migrated.id, legacy.id);
  assert.equal(migrated.prompt, legacy.prompt);
  assert.equal(migrated.history.length, 1);
  assert.deepEqual(migrated.trigger, {
    type: 'schedule',
    config: { cadence: 'weekdays', date: '', time: '08:30', everyMinutes: 15 },
    cooldownSeconds: 0,
  });

  const again = triggers.migrateRecord(migrated);
  assert.deepEqual(again, migrated);
});

test('redaction removes the token and exposes only a hook hint', () => {
  const redacted = triggers.redactTrigger({
    type: 'webhook',
    config: { token: 'super-secret', allowQueryToken: true },
    cooldownSeconds: 5,
  }, 'sch_hook');
  assert.equal(redacted.config.token, undefined);
  assert.equal(redacted.config.tokenSet, true);
  assert.equal(redacted.config.hookPath, '/hooks/sch_hook');
  assert.equal(redacted.config.allowQueryToken, true);
  assert.ok(!JSON.stringify(redacted).includes('super-secret'));
});

test('tokens compare in constant time and reject length changes', () => {
  assert.equal(triggers.tokensEqual('abc123', 'abc123'), true);
  assert.equal(triggers.tokensEqual('abc123', 'abc124'), false);
  assert.equal(triggers.tokensEqual('abc123', 'abc1234'), false);
  assert.equal(triggers.tokensEqual('', ''), false);
});

test('resource validation checks file paths and MCP names', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blank-trigger-path-'));
  const file = path.join(dir, 'watch.txt');
  fs.writeFileSync(file, 'x');
  try {
    assert.doesNotThrow(() => triggers.validateTriggerResources(
      { type: 'file', config: { paths: [file] } },
      { mcpServerIds: [], mcpToolNames: [] },
    ));
    assert.throws(() => triggers.validateTriggerResources(
      { type: 'file', config: { paths: [path.join(dir, 'missing.txt')] } },
      { mcpServerIds: [], mcpToolNames: [] },
    ), /does not exist/i);
    assert.throws(() => triggers.validateTriggerResources(
      { type: 'mcp', config: { serverId: 'nope', toolName: 'x' } },
      { mcpServerIds: ['other'], mcpToolNames: [] },
    ), /server/i);
    assert.throws(() => triggers.validateTriggerResources(
      { type: 'mcp', config: { serverId: 'other', toolName: 'nope' } },
      { mcpServerIds: ['other'], mcpToolNames: ['watch'] },
    ), /tool/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('events match their trigger configuration', () => {
  const file = { type: 'file', config: { events: ['add', 'change'], paths: ['C:\\x'] } };
  assert.equal(triggers.matchesEvent(file, { type: 'file', kind: 'change' }), true);
  assert.equal(triggers.matchesEvent(file, { type: 'file', kind: 'remove' }), false);

  const messenger = {
    type: 'messenger',
    config: { provider: 'telegram', fromIncludes: 'Alice', textIncludes: 'deploy' },
  };
  assert.equal(triggers.matchesEvent(messenger, {
    type: 'messenger', provider: 'telegram', label: 'Alice Kim', text: 'please deploy now',
  }), true);
  assert.equal(triggers.matchesEvent(messenger, {
    type: 'messenger', provider: 'discord', label: 'Alice', text: 'deploy',
  }), false);
  assert.equal(triggers.matchesEvent(messenger, {
    type: 'messenger', provider: 'telegram', label: 'Alice', text: 'hello',
  }), false);

  const session = { type: 'session', config: { on: 'error', includeAutomationRuns: false } };
  assert.equal(triggers.matchesEvent(session, { type: 'session', status: 'error' }), true);
  assert.equal(triggers.matchesEvent(session, { type: 'session', status: 'ok' }), false);
  assert.equal(triggers.matchesEvent(session, { type: 'session', status: 'stopped' }), false);
});

test('dedupe keys are stable for identical events and hide raw text', () => {
  const trigger = { type: 'messenger', config: { provider: 'telegram' } };
  const base = {
    recordId: 'sch_msg',
    type: 'messenger',
    provider: 'telegram',
    chatId: 'chat-9',
    text: 'hello secret',
  };
  const first = triggers.dedupeKey(trigger, base);
  assert.equal(first, triggers.dedupeKey(trigger, { ...base }));
  assert.notEqual(first, triggers.dedupeKey(trigger, { ...base, text: 'other' }));
  assert.ok(!first.includes('hello secret'));
  assert.ok(!first.includes('chat-9'));

  const webhook = { type: 'webhook', config: {} };
  assert.equal(
    triggers.dedupeKey(webhook, { recordId: 'sch_w', type: 'webhook', body: '{"a":1}' }),
    triggers.dedupeKey(webhook, { recordId: 'sch_w', type: 'webhook', body: '{"a":1}' }),
  );
});

test('canonical JSON and fingerprints ignore object key order', () => {
  assert.equal(
    triggers.canonicalJson({ b: 1, a: { d: 4, c: 3 } }),
    triggers.canonicalJson({ a: { c: 3, d: 4 }, b: 1 }),
  );
  assert.equal(
    triggers.fingerprint({ a: 1, b: [{ y: 2, x: 1 }] }),
    triggers.fingerprint({ b: [{ x: 1, y: 2 }], a: 1 }),
  );
  assert.notEqual(triggers.fingerprint({ a: 1 }), triggers.fingerprint({ a: 2 }));
});

test('event prompts are bounded, labeled as data and never include a token', () => {
  const trigger = { type: 'webhook', config: { token: 'super-secret' } };
  const event = {
    type: 'webhook',
    at: '2026-11-07T00:00:00.000Z',
    body: `{"payload":"${'x'.repeat(10000)}"}`,
    token: 'super-secret',
  };
  const output = triggers.formatEventPrompt(trigger, event, 'Summarize.');
  assert.ok(output.length < 4 * 1024 + 'Summarize.'.length + 120);
  assert.match(output, /not instructions/i);
  assert.match(output, /Summarize\.$/);
  assert.ok(!output.includes('super-secret'));
});

test('event summaries are short and readable', () => {
  assert.match(triggers.summarizeEvent(
    { type: 'file', config: {} },
    { type: 'file', kind: 'change', path: 'C:\\work\\report.csv' },
  ), /change.*report\.csv/i);
  assert.match(triggers.summarizeEvent(
    { type: 'mcp', config: {} },
    { type: 'mcp', serverId: 'github', toolName: 'issues' },
  ), /github\/issues/);
});

test('manual events carry only type and time and are labeled in history', () => {
  const event = { type: 'manual', at: '2026-11-07T00:00:00.000Z' };
  const output = triggers.formatEventPrompt({ type: 'schedule', config: {} }, event, 'Do it.');
  assert.match(output, /type: manual/);
  assert.match(output, /at: 2026-11-07T00:00:00\.000Z/);
  assert.ok(!/^kind:|^path:|^body:|^token:/m.test(output));
  assert.equal(triggers.summarizeEvent({ type: 'schedule', config: {} }, event), 'Manual run');
});
