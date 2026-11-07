'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'blank-trigger-engine-'));
process.env.BLANK_HOME = home;

const { createTriggerEngine } = require('../electron/trigger-engine');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test.after(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

function mcpRecord(id = 'sch_mcp') {
  return {
    id,
    enabled: true,
    prompt: 'Check it.',
    trigger: {
      type: 'mcp',
      config: { serverId: 'srv', toolName: 'watch', args: {}, intervalSeconds: 60 },
      cooldownSeconds: 0,
    },
  };
}

test('MCP polling baselines first and dispatches only on change', async () => {
  let result = { content: [{ type: 'text', text: 'one' }] };
  const mcp = {
    callTool: async () => result,
    statuses: () => [{ id: 'srv', connected: true, tools: ['watch'] }],
  };
  const dispatched = [];
  const record = mcpRecord();
  const engine = createTriggerEngine({
    getSchedules: () => [record],
    getConfig: () => ({ mcpServers: [{ id: 'srv', enabled: true }], triggers: {} }),
    mcp,
    dispatch: async (entry, event) => {
      dispatched.push(event);
      return { started: true, sessionId: 's_mcp' };
    },
    notify: () => {},
  });
  await engine.start();
  await engine.pollNow(record);
  assert.equal(dispatched.length, 0);

  result = { content: [{ type: 'text', text: 'two' }] };
  await engine.pollNow(record);
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].type, 'mcp');
  assert.equal(dispatched[0].recordId, 'sch_mcp');

  result = { content: [{ type: 'text', text: 'two' }] };
  await engine.pollNow(record);
  assert.equal(dispatched.length, 1);
  await engine.stop();
});

test('file events debounce and respect the configured kinds', async () => {
  const record = {
    id: 'sch_file',
    enabled: true,
    prompt: 'Summarize.',
    trigger: {
      type: 'file',
      config: { paths: [home], events: ['change'], debounceSeconds: 3 },
      cooldownSeconds: 0,
    },
  };
  const dispatched = [];
  const engine = createTriggerEngine({
    getSchedules: () => [record],
    getConfig: () => ({ triggers: {} }),
    mcp: { callTool: async () => null, statuses: () => [] },
    dispatch: async (entry, event) => {
      dispatched.push(event);
      return { started: true, sessionId: 's_file' };
    },
    notify: () => {},
    fileDebounceMs: 30,
  });
  await engine.start();
  const file = path.join(home, 'watched.txt');
  fs.writeFileSync(file, 'one');
  engine.handleFileEvent(record, { kind: 'change', path: file });
  engine.handleFileEvent(record, { kind: 'change', path: file });
  assert.equal(dispatched.length, 0);
  await sleep(100);
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].type, 'file');

  engine.handleFileEvent(record, { kind: 'remove', path: file });
  await sleep(100);
  assert.equal(dispatched.length, 1);
  await engine.stop();
});

test('cooldown suppresses a second dispatch', async () => {
  const record = mcpRecord('sch_mcp_cooldown');
  record.trigger.cooldownSeconds = 60;
  let result = { content: [{ type: 'text', text: 'one' }] };
  const mcp = { callTool: async () => result, statuses: () => [{ id: 'srv', connected: true, tools: ['watch'] }] };
  let count = 0;
  const engine = createTriggerEngine({
    getSchedules: () => [record],
    getConfig: () => ({ mcpServers: [{ id: 'srv', enabled: true }], triggers: {} }),
    mcp,
    dispatch: async () => {
      count += 1;
      return { started: true, sessionId: `s_${count}` };
    },
    notify: () => {},
  });
  await engine.start();
  await engine.pollNow(record);
  result = { content: [{ type: 'text', text: 'two' }] };
  await engine.pollNow(record);
  result = { content: [{ type: 'text', text: 'three' }] };
  await engine.pollNow(record);
  assert.equal(count, 1);
  await engine.stop();
});

test('startup triggers are armed once per process', async () => {
  const record = {
    id: 'sch_start',
    enabled: true,
    prompt: 'Hello.',
    trigger: { type: 'startup', config: { delaySeconds: 0 }, cooldownSeconds: 0 },
  };
  const dispatched = [];
  const engine = createTriggerEngine({
    getSchedules: () => [record],
    getConfig: () => ({ triggers: {} }),
    mcp: { callTool: async () => null, statuses: () => [] },
    dispatch: async (entry, event) => {
      dispatched.push(event);
      return { started: true, sessionId: 's_start' };
    },
    notify: () => {},
  });
  await engine.start();
  await sleep(50);
  assert.equal(dispatched.length, 1);
  record.enabled = false;
  await engine.reconcile();
  record.enabled = true;
  await engine.reconcile();
  await sleep(50);
  assert.equal(dispatched.length, 1);
  await engine.stop();
});

test('session notifications skip automation-origin sessions by default', async () => {
  const record = {
    id: 'sch_after',
    enabled: true,
    prompt: 'Follow up.',
    trigger: { type: 'session', config: { on: 'complete', includeAutomationRuns: false }, cooldownSeconds: 0 },
  };
  const dispatched = [];
  const engine = createTriggerEngine({
    getSchedules: () => [record],
    getConfig: () => ({ triggers: {} }),
    mcp: { callTool: async () => null, statuses: () => [] },
    dispatch: async (entry, event) => {
      dispatched.push(event);
      return { started: true, sessionId: 's_after' };
    },
    notify: () => {},
  });
  await engine.start();
  engine.noteAutomationSession('s_auto', { recordId: 'sch_other', chain: [] });
  await engine.notifySession({
    sessionId: 's_auto',
    session: { id: 's_auto', title: 'Auto', messages: [] },
    outcome: { ok: true, stopped: false },
  });
  assert.equal(dispatched.length, 0);
  await engine.notifySession({
    sessionId: 's_chat',
    session: { id: 's_chat', title: 'Chat', messages: [] },
    outcome: { ok: true, stopped: false },
  });
  assert.equal(dispatched.length, 1);
  await engine.stop();
});
