'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { appendStream, previewStream } = require('../src/core/stream-preview');

test('appendStream keeps the newest characters within the cap', () => {
  assert.equal(appendStream('abc', 'def'), 'abcdef');
  assert.equal(appendStream('abcd', 'efgh', 5), 'defgh');
  assert.equal(appendStream('', 'x'), 'x');
  assert.equal(appendStream(undefined, 'y'), 'y');
});

test('previewStream collapses whitespace and strips markdown', () => {
  const text = '## Plan\n\nUse **grep** with `-n` and see [the docs](https://example.com).';
  assert.equal(previewStream(text), 'Plan Use grep with -n and see the docs.');
});

test('previewStream removes code fence markers but keeps the code', () => {
  assert.equal(previewStream('```js\nconst a = 1;\n```'), 'const a = 1;');
});

test('previewStream returns the tail with a leading ellipsis', () => {
  const preview = previewStream('alpha beta gamma delta epsilon', 24);
  assert.ok(preview.startsWith('…'));
  assert.ok(preview.length <= 25);
  assert.ok(preview.endsWith('epsilon'));
  assert.ok(!preview.startsWith('…eta'));
});

test('previewStream returns an empty string for blank input', () => {
  assert.equal(previewStream('   '), '');
  assert.equal(previewStream(null), '');
});
