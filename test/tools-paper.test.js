'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'blank-tools-paper-'));
process.env.BLANK_HOME = home;

const {
  executeTool, summarizeArgs, getToolDefinition,
} = require('../src/core/tools');
const { listPapers } = require('../src/core/paper');

function ctx(overrides = {}) {
  return {
    session: { id: 's_tools_test' },
    config: {
      permissions: {
        create_paper: 'allow',
        update_paper: 'allow',
        read_paper: 'allow',
        list_papers: 'allow',
      },
    },
    mode: 'agent',
    ...overrides,
  };
}

test('create_paper writes a paper and returns card meta', async () => {
  const result = await executeTool({
    name: 'create_paper',
    args: { title: 'Agent page', kind: 'html', content: '<h1>Hello from the agent</h1>' },
  }, ctx());
  assert.equal(result.isError, undefined);
  assert.match(result.content, /Created paper/);
  assert.equal(result.meta.paper.title, 'Agent page');
  assert.equal(result.meta.paper.kind, 'html');
  assert.equal(result.meta.paper.version, 1);
  assert.equal(result.meta.paper.source, 'agent');
  assert.equal(result.meta.paper.sessionId, 's_tools_test');
  assert.equal(listPapers().total, 1);
});

test('update_paper raises the version and read_paper returns content', async () => {
  const created = await executeTool({
    name: 'create_paper',
    args: { kind: 'markdown', content: '# Notes\n\nFirst draft.' },
  }, ctx());
  const id = created.meta.paper.id;
  assert.equal(created.meta.paper.title, 'Notes');

  const updated = await executeTool({
    name: 'update_paper',
    args: { id, content: '# Notes\n\nSecond draft.' },
  }, ctx());
  assert.equal(updated.meta.paper.id, id);
  assert.equal(updated.meta.paper.version, 2);

  const read = await executeTool({ name: 'read_paper', args: { id } }, ctx());
  assert.match(read.content, /Second draft/);
  assert.match(read.content, /id /);
});

test('list_papers returns paper cards and a count', async () => {
  const result = await executeTool({
    name: 'list_papers',
    args: { query: 'Notes' },
  }, ctx());
  assert.equal(result.isError, undefined);
  assert.ok(Array.isArray(result.meta.papers));
  assert.ok(result.meta.papers.length >= 1);
  assert.equal(result.meta.count, result.meta.papers.length);
});

test('paper tools respect plan mode and permissions', async () => {
  const blocked = await executeTool({
    name: 'create_paper',
    args: { content: '<p>Plan</p>' },
  }, ctx({ mode: 'plan' }));
  assert.equal(blocked.isError, true);
  assert.match(blocked.content, /read-only/);

  const readSpec = getToolDefinition('read_paper');
  assert.equal(readSpec.planSafe, true);
  const createSpec = getToolDefinition('create_paper');
  assert.equal(createSpec.mutating, true);

  const denied = await executeTool({
    name: 'create_paper',
    args: { content: '<p>Denied</p>' },
  }, ctx({ config: { permissions: { create_paper: 'deny' } } }));
  assert.equal(denied.isError, true);
  assert.match(denied.content, /blocked/);
});

test('summarizeArgs describes paper calls', () => {
  assert.equal(summarizeArgs('create_paper', { kind: 'svg', title: 'Mark' }), 'svg · Mark');
  assert.equal(summarizeArgs('update_paper', { title: 'New name' }), 'New name');
  assert.equal(summarizeArgs('read_paper', { id: 'p_123' }), 'p_123');
  assert.equal(summarizeArgs('list_papers', { kind: 'code', query: 'hooks' }), 'code · hooks');
});

test.after(() => {
  try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
});
