'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { stripAnsi, charWidth, displayWidth, wrapPlain, truncate } = require('../src/cli/tui/width');

test('ascii and latin text count one column per character', () => {
  assert.equal(displayWidth('hello'), 5);
  assert.equal(displayWidth('cafe\u0301'), 4);
  assert.equal(displayWidth(''), 0);
});

test('east asian characters and emoji take two columns', () => {
  assert.equal(charWidth('가'.codePointAt(0)), 2);
  assert.equal(charWidth('漢'.codePointAt(0)), 2);
  assert.equal(charWidth('😀'.codePointAt(0)), 2);
  assert.equal(displayWidth('한글'), 4);
  assert.equal(displayWidth('a😀b'), 4);
});

test('combining marks and control characters take no columns', () => {
  assert.equal(charWidth(0x0301), 0);
  assert.equal(charWidth(0x200d), 0);
  assert.equal(charWidth(0x7), 0);
});

test('ansi colour codes never count toward width', () => {
  const painted = '\u001b[38;2;47;107;255mblue\u001b[0m';
  assert.equal(stripAnsi(painted), 'blue');
  assert.equal(displayWidth(painted), 4);
});

test('wrapping keeps words together and honours explicit newlines', () => {
  assert.deepEqual(wrapPlain('one two three', 7), ['one two', 'three']);
  assert.deepEqual(wrapPlain('alpha\nbeta', 10), ['alpha', 'beta']);
  assert.deepEqual(wrapPlain('', 10), ['']);
});

test('wrapping splits a token longer than the line', () => {
  assert.deepEqual(wrapPlain('abcdefgh', 3), ['abc', 'def', 'gh']);
});

test('wrapping counts wide characters as two columns', () => {
  assert.deepEqual(wrapPlain('한글한글', 4), ['한글', '한글']);
  assert.deepEqual(wrapPlain('a한b', 3), ['a한', 'b']);
});

test('truncate shortens to the requested width and appends an ellipsis', () => {
  assert.equal(truncate('hello world', 8), 'hello w…');
  assert.equal(truncate('hello', 8), 'hello');
  assert.equal(truncate('한글한글', 5), '한글…');
  assert.equal(truncate('\u001b[2mdim\u001b[0m text', 5), 'dim …');
});

test('truncate never returns a negative slice', () => {
  assert.equal(truncate('abc', 0), '');
  assert.equal(truncate('abc', 1), '…');
});
