'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  executeTool, getToolDefinitions, permissionFor,
} = require('../src/core/tools');
const { buildSystemPrompt } = require('../src/core/prompt');

function ctx(overrides = {}) {
  return {
    session: { id: 's_ask_test' },
    config: { permissions: {}, approvals: { mode: 'important' } },
    mode: 'agent',
    ...overrides,
  };
}

test('ask_user is offered in every working mode but not in ask mode', () => {
  for (const mode of ['agent', 'coding', 'design', 'research', 'plan']) {
    const names = getToolDefinitions({ mode }).map((tool) => tool.name);
    assert.ok(names.includes('ask_user'), `${mode} should list ask_user`);
  }
  const askMode = getToolDefinitions({ mode: 'ask' }).map((tool) => tool.name);
  assert.equal(askMode.includes('ask_user'), false);
});

test('ask_user never triggers an approval prompt', () => {
  const decision = permissionFor('ask_user', { question: 'Which?', options: ['A', 'B'] }, ctx({
    config: { permissions: { ask_user: 'ask' }, approvals: { mode: 'all' } },
  }));
  assert.equal(decision.level, 'allow');
});

test('a blocked ask_user stays blocked', () => {
  const decision = permissionFor('ask_user', {}, ctx({
    config: { permissions: { ask_user: 'deny' }, approvals: { mode: 'auto' } },
  }));
  assert.equal(decision.level, 'deny');
});

test('ask_user hands cleaned options to the UI and returns the pick', async () => {
  const requests = [];
  const result = await executeTool({
    name: 'ask_user',
    args: { question: 'Which folder?', options: ['src', ' test ', '', 'src'] },
  }, ctx({
    requestUserInput: async (request) => { requests.push(request); return { selected: ['test'] }; },
  }));

  assert.equal(result.isError, undefined);
  assert.deepEqual(requests[0], { question: 'Which folder?', options: ['src', 'test'], multiple: false });
  assert.match(result.content, /test/);
  assert.equal(result.meta.question, 'Which folder?');
  assert.deepEqual(result.meta.answers, ['test']);
});

test('ask_user keeps multiple picks and a typed answer', async () => {
  const result = await executeTool({
    name: 'ask_user',
    args: { question: 'Which checks?', options: ['tests', 'lint'], multiple: true },
  }, ctx({
    requestUserInput: async () => ({ selected: ['tests', 'lint'], custom: 'typecheck' }),
  }));

  assert.equal(result.isError, undefined);
  assert.deepEqual(result.meta.answers, ['tests', 'lint']);
  assert.equal(result.meta.custom, 'typecheck');
  assert.match(result.content, /tests, lint/);
  assert.match(result.content, /typecheck/);
});

test('ask_user caps the option list at six', async () => {
  const requests = [];
  await executeTool({
    name: 'ask_user',
    args: { question: 'Which?', options: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] },
  }, ctx({
    requestUserInput: async (request) => { requests.push(request); return { selected: ['a'] }; },
  }));
  assert.deepEqual(requests[0].options, ['a', 'b', 'c', 'd', 'e', 'f']);
});

test('a cancelled question is an error the model can recover from', async () => {
  const result = await executeTool({
    name: 'ask_user', args: { question: 'Which?', options: ['A', 'B'] },
  }, ctx({ requestUserInput: async () => ({ cancelled: true }) }));
  assert.equal(result.isError, true);
});

test('ask_user rejects a blank question or a single option', async () => {
  const blank = await executeTool({
    name: 'ask_user', args: { question: '   ', options: ['A', 'B'] },
  }, ctx({ requestUserInput: async () => ({ selected: ['A'] }) }));
  assert.equal(blank.isError, true);

  const thin = await executeTool({
    name: 'ask_user', args: { question: 'Which?', options: ['A'] },
  }, ctx({ requestUserInput: async () => ({ selected: ['A'] }) }));
  assert.equal(thin.isError, true);
});

test('without an interactive surface the model is told to ask in the reply', async () => {
  const result = await executeTool({
    name: 'ask_user', args: { question: 'Which?', options: ['A', 'B'] },
  }, ctx());
  assert.equal(result.isError, true);
  assert.match(result.content, /reply|plain text/i);
});

test('the agent prompt points at ask_user and ask mode does not', () => {
  const base = { workspace: '', config: {}, model: 'test', skills: [], memories: [], session: { messages: [] } };
  assert.match(buildSystemPrompt({ ...base, mode: 'agent' }), /ask_user/);
  assert.doesNotMatch(buildSystemPrompt({ ...base, mode: 'ask' }), /ask_user/);
});
