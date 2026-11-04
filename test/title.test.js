'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { cleanTitle, canAutoTitle, generateSessionTitle } = require('../src/core/title');

function session(overrides = {}) {
  return {
    id: 's_test',
    title: 'Build a login screen',
    titleSource: 'auto',
    titleGeneratedAt: '',
    messages: [
      { role: 'user', content: 'Can you fix the OAuth redirect loop on the login screen?' },
      { role: 'assistant', content: 'I traced it to the callback route and fixed the state check.' },
    ],
    ...overrides,
  };
}

test('cleanTitle strips wrapping, labels and punctuation', () => {
  assert.equal(cleanTitle('"Fix the login bug."'), 'Fix the login bug');
  assert.equal(cleanTitle('Title: Add session titles\nExtra commentary'), 'Add session titles');
  assert.equal(cleanTitle('**세션 자동 이름**'), '세션 자동 이름');
  assert.equal(cleanTitle('```\nOAuth redirect loop\n```'), 'OAuth redirect loop');
  assert.equal(cleanTitle('New session'), '');
  assert.equal(cleanTitle('…'), '');
});

test('cleanTitle caps long titles at a word boundary', () => {
  const title = cleanTitle('A '.repeat(80));
  assert.ok(title.length <= 65, title);
  assert.ok(title.endsWith('…'));
});

test('canAutoTitle requires an opted-in session with both sides of the first exchange', () => {
  assert.equal(canAutoTitle(session()), true);
  assert.equal(canAutoTitle(session({ titleSource: 'manual' })), false);
  assert.equal(canAutoTitle(session({ titleSource: undefined })), false);
  assert.equal(canAutoTitle(session({ titleGeneratedAt: '2026-01-01T00:00:00.000Z' })), false);
  assert.equal(canAutoTitle(session({ messages: [{ role: 'user', content: 'Hi' }] })), false);
});

test('generateSessionTitle names the session once with the active model', async () => {
  const target = session();
  let calls = 0;
  let prompt = '';
  const result = await generateSessionTitle({
    session: target,
    config: {},
    modelId: 'test/model',
    complete: async ({ messages }) => {
      calls += 1;
      prompt = messages[0].content;
      return '“OAuth redirect repair”\n';
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.changed, true);
  assert.equal(target.title, 'OAuth redirect repair');
  assert.equal(target.titleSource, 'auto');
  assert.ok(target.titleGeneratedAt);
  assert.match(prompt, /OAuth redirect loop/);
  assert.match(prompt, /callback route/);

  const again = await generateSessionTitle({
    session: target,
    config: {},
    modelId: 'test/model',
    complete: async () => {
      calls += 1;
      return 'Second title';
    },
  });
  assert.equal(again.skipped, true);
  assert.equal(calls, 1);
});

test('generateSessionTitle keeps the old title when the model fails', async () => {
  const target = session();
  const result = await generateSessionTitle({
    session: target,
    config: {},
    modelId: 'test/model',
    complete: async () => { throw new Error('rate limited'); },
  });
  assert.equal(result.changed, false);
  assert.equal(target.title, 'Build a login screen');
  assert.ok(target.titleGeneratedAt);
});
