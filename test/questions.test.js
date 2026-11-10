'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createQuestionBroker } = require('../src/core/questions');

function broker(overrides = {}) {
  const events = [];
  let next = 0;
  const instance = createQuestionBroker({
    timeoutMs: 30,
    makeId: () => `q_${++next}`,
    onEvent: (event) => events.push(event),
    ...overrides,
  });
  return { broker: instance, events };
}

test('a question is published once and resolves with the chosen option', async () => {
  const { broker: questions, events } = broker();
  const pending = questions.ask({ question: 'Which folder?', options: ['src', 'docs'] }, { sessionId: 's_1', runId: 'r_1' });

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'question');
  assert.equal(events[0].questionId, 'q_1');
  assert.equal(events[0].question, 'Which folder?');
  assert.deepEqual(events[0].options, ['src', 'docs']);
  assert.equal(events[0].multiple, false);
  assert.equal(events[0].sessionId, 's_1');

  const result = questions.answer('q_1', { selected: ['docs'] });
  assert.equal(result.ok, true);
  assert.deepEqual(await pending, { selected: ['docs'], custom: '' });
  assert.equal(events[1].type, 'question:resolved');
  assert.deepEqual(events[1].selected, ['docs']);
});

test('a single-select question keeps one valid label', async () => {
  const { broker: questions } = broker();
  const pending = questions.ask({ question: 'Which?', options: ['A', 'B'], multiple: false });
  questions.answer('q_1', { selected: ['B', 'A', 'missing'] });
  assert.deepEqual((await pending).selected, ['B']);
});

test('a multiple-select question keeps every valid label in order', async () => {
  const { broker: questions } = broker();
  const pending = questions.ask({ question: 'Which?', options: ['A', 'B'], multiple: true });
  questions.answer('q_1', { selected: ['B', 'missing', 'A'] });
  assert.deepEqual((await pending).selected, ['B', 'A']);
});

test('an empty answer is rejected and the question stays open', async () => {
  const { broker: questions } = broker();
  const pending = questions.ask({ question: 'Which?', options: ['A', 'B'] });

  const rejected = questions.answer('q_1', { selected: ['unknown'] });
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /Choose an option/);

  questions.answer('q_1', { custom: 'Mine' });
  assert.deepEqual(await pending, { selected: [], custom: 'Mine' });
});

test('a typed answer is trimmed and capped', async () => {
  const { broker: questions } = broker();
  const pending = questions.ask({ question: 'Which?', options: ['A', 'B'] });
  questions.answer('q_1', { custom: `  ${'x'.repeat(2500)}  ` });
  const answer = await pending;
  assert.equal(answer.custom.length, 2000);
});

test('answering an unknown question reports an expired request', () => {
  const { broker: questions } = broker();
  const result = questions.answer('q_none', { selected: ['A'] });
  assert.equal(result.ok, false);
  assert.match(result.error, /no longer waiting|expired/i);
});

test('a question that times out emits an expiry and resolves cancelled', async () => {
  const { broker: questions, events } = broker({ timeoutMs: 5 });
  const answer = await questions.ask({ question: 'Which?', options: ['A', 'B'] }, { sessionId: 's_1' });
  assert.deepEqual(answer, { cancelled: true });
  assert.equal(events.at(-1).type, 'question:expired');
  assert.equal(events.at(-1).reason, 'timeout');
  assert.equal(questions.answer('q_1', { selected: ['A'] }).ok, false);
});

test('cancelling by run resolves pending questions as cancelled', async () => {
  const { broker: questions, events } = broker();
  const answer = questions.ask({ question: 'Which?', options: ['A', 'B'] }, { runId: 'r_9' });
  const count = questions.cancel((entry) => entry.runId === 'r_9');
  assert.equal(count, 1);
  assert.deepEqual(await answer, { cancelled: true });
  assert.equal(events.at(-1).type, 'question:expired');
});

test('pending questions can be listed for a session', () => {
  const { broker: questions } = broker();
  questions.ask({ question: 'One?', options: ['A', 'B'] }, { sessionId: 's_1' });
  questions.ask({ question: 'Two?', options: ['A', 'B'] }, { sessionId: 's_2' });
  const listed = questions.list((entry) => entry.sessionId === 's_1');
  assert.equal(listed.length, 1);
  assert.equal(listed[0].question, 'One?');
});
