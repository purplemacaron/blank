'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const providers = require('../src/core/providers.js');

test('request timeout defaults to 10 minutes', () => {
  assert.equal(providers.requestTimeoutMs({}), 600000);
  assert.equal(providers.requestTimeoutMs({ agent: {} }), 600000);
});

test('request timeout follows the configured minutes', () => {
  assert.equal(providers.requestTimeoutMs({ agent: { requestTimeoutMin: 5 } }), 300000);
  assert.equal(providers.requestTimeoutMs({ agent: { requestTimeoutMin: 30 } }), 1800000);
});

test('request timeout clamps to 1..180 minutes and rejects garbage', () => {
  assert.equal(providers.requestTimeoutMs({ agent: { requestTimeoutMin: 0 } }), 60000);
  assert.equal(providers.requestTimeoutMs({ agent: { requestTimeoutMin: -4 } }), 60000);
  assert.equal(providers.requestTimeoutMs({ agent: { requestTimeoutMin: 9999 } }), 10800000);
  assert.equal(providers.requestTimeoutMs({ agent: { requestTimeoutMin: 'abc' } }), 600000);
  assert.equal(providers.requestTimeoutMs({ agent: { requestTimeoutMin: null } }), 600000);
});