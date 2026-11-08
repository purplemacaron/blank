'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildSystemPrompt } = require('../src/core/prompt');

function prompt(mode, memories = []) {
  return buildSystemPrompt({
    workspace: '',
    mode,
    config: {},
    model: 'ollama/qwen3.8:27b',
    skills: [],
    memories,
    session: { messages: [] },
  });
}

test('agent mode tells the model to save durable memories', () => {
  const text = prompt('agent');
  assert.match(text, /remember/, 'the agent needs a rule for the remember tool');
  assert.match(text, /lasting|durable|preference/i, 'the rule explains what belongs in memory');
});

test('ask mode does not ask for tools it cannot use', () => {
  const text = prompt('ask');
  assert.doesNotMatch(text, /call remember|with remember/i, 'ask mode has no tools');
});

test('recalled memories are injected for the current request', () => {
  const text = prompt('agent', [{ text: 'Prefers concise Korean answers', pinned: true }]);
  assert.match(text, /Prefers concise Korean answers/);
  assert.match(text, /<memory>/);
});
