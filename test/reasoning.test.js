'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const reasoning = require('../src/core/reasoning');

const FULL = ['none', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

test('the reasoning ladder runs from non-reasoning to ultra', () => {
  assert.deepEqual(reasoning.ORDER, ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
  assert.equal(reasoning.LEVELS.xhigh.label, 'xHigh');
  assert.equal(reasoning.LEVELS.max.label, 'Max');
  assert.equal(reasoning.LEVELS.ultra.label, 'Ultra');
  assert.ok(reasoning.EFFORTS.includes('ultra'));
  assert.equal(reasoning.isEffort('ultra'), true);
});

test('custom models only claim stages the endpoint reported', () => {
  /* Until the endpoint answers, show the universal OpenAI effort set. */
  assert.deepEqual(
    reasoning.profileFor('custom_nvidia-nim', 'mistralai/mistral-large-4-1t-a52b').levels,
    ['low', 'medium', 'high'],
  );
  const api = reasoning.profileFor('custom_nvidia-nim', 'mistralai/mistral-large-4-1t-a52b', {
    supported: true,
    levels: ['low', 'medium', 'high'],
    default: 'medium',
    source: 'api',
  });
  assert.deepEqual(api.levels, ['low', 'medium', 'high']);
  assert.equal(api.source, 'api');
  const probe = reasoning.profileFor('custom_x', 'solar-pro4', {
    supported: true,
    levels: ['low', 'high'],
    source: 'probe',
  });
  assert.deepEqual(probe.levels, ['low', 'high']);
  assert.equal(probe.source, 'probe');
  const off = reasoning.profileFor('custom_x', 'text-only', {
    supported: false,
    source: 'probe',
  });
  assert.deepEqual(off.levels, ['none']);
  assert.equal(reasoning.profileFromHint({ supported: true, levels: ['low', 'ultra', 'bogus'] }).levels.length, 2);
});

test('official models keep their own supported stages', () => {
  assert.deepEqual(reasoning.profileFor('groq', 'openai/gpt-oss-20b').levels, ['low', 'medium', 'high']);
  assert.deepEqual(reasoning.profileFor('openai', 'gpt-5.1-codex').levels, [
    'none', 'low', 'medium', 'high', 'xhigh',
  ]);
  assert.deepEqual(reasoning.profileFor('anthropic', 'claude-sonnet-5').levels, [
    'low', 'medium', 'high', 'xhigh', 'max',
  ]);
  assert.deepEqual(reasoning.profileFor('google', 'gemini-3.1-pro').levels, ['low', 'medium', 'high']);
  assert.deepEqual(reasoning.profileFor('google', 'gemini-3-pro').levels, ['low', 'high']);
});

test('normalize keeps ultra and clamps unsupported stages', () => {
  const full = reasoning.profileFor('custom_upstage', 'solar-pro4', {
    supported: true, levels: FULL, source: 'probe',
  });
  assert.equal(reasoning.normalize(full, 'ultra'), 'ultra');
  assert.equal(reasoning.normalize(full, 'xhigh'), 'xhigh');
  assert.equal(reasoning.normalize(full, 'auto'), 'medium');
  const limited = reasoning.profileFor('groq', 'openai/gpt-oss-20b');
  assert.equal(reasoning.normalize(limited, 'ultra'), 'high');
  assert.equal(reasoning.normalize(limited, 'bogus'), 'medium');
});
