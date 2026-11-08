'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createKeyParser } = require('../src/cli/tui/keys');

const feed = (parser, chunk) => parser.feed(chunk);

test('printable text arrives as one event and controls stay separate', () => {
  const parser = createKeyParser();
  assert.deepEqual(feed(parser, 'abc'), [{ name: 'text', text: 'abc' }]);
  assert.deepEqual(feed(parser, '\r'), [{ name: 'enter', alt: false }]);
  assert.deepEqual(feed(parser, 'x\r'), [
    { name: 'text', text: 'x' },
    { name: 'enter', alt: false },
  ]);
});

test('alt+enter is distinct from enter and ctrl+j is a newline', () => {
  const parser = createKeyParser();
  assert.deepEqual(feed(parser, '\u001b\r'), [{ name: 'enter', alt: true }]);
  assert.deepEqual(feed(parser, '\n'), [{ name: 'newline', ctrl: true }]);
});

test('editing keys map to named events', () => {
  const parser = createKeyParser();
  assert.deepEqual(feed(parser, '\u007f'), [{ name: 'backspace' }]);
  assert.deepEqual(feed(parser, '\b'), [{ name: 'backspace' }]);
  assert.deepEqual(feed(parser, '\t'), [{ name: 'tab', shift: false }]);
  assert.deepEqual(feed(parser, '\u001b[Z'), [{ name: 'tab', shift: true }]);
});

test('arrow, home, end, delete and page keys parse from CSI sequences', () => {
  const parser = createKeyParser();
  const keys = feed(parser, '\u001b[A\u001b[B\u001b[C\u001b[D\u001b[H\u001b[F\u001b[3~\u001b[5~\u001b[6~');
  assert.deepEqual(keys.map((key) => key.name), [
    'up', 'down', 'right', 'left', 'home', 'end', 'delete', 'pgup', 'pgdown',
  ]);
});

test('SS3 home and end and modified arrows carry modifiers', () => {
  const parser = createKeyParser();
  assert.deepEqual(feed(parser, '\u001bOH'), [{ name: 'home' }]);
  assert.deepEqual(feed(parser, '\u001b[1;5C'), [{ name: 'right', ctrl: true, alt: false, shift: false }]);
  assert.deepEqual(feed(parser, '\u001b[1;3D'), [{ name: 'left', ctrl: false, alt: true, shift: false }]);
});

test('control letters are reported with ctrl set', () => {
  const parser = createKeyParser();
  assert.deepEqual(feed(parser, '\u0003'), [{ name: 'c', ctrl: true }]);
  assert.deepEqual(feed(parser, '\u0010'), [{ name: 'p', ctrl: true }]);
  assert.deepEqual(feed(parser, '\u000f'), [{ name: 'o', ctrl: true }]);
  assert.deepEqual(feed(parser, '\u000c'), [{ name: 'l', ctrl: true }]);
  assert.deepEqual(feed(parser, '\u0004'), [{ name: 'd', ctrl: true }]);
});

test('alt+letter does not swallow the next character', () => {
  const parser = createKeyParser();
  assert.deepEqual(feed(parser, '\u001bx'), [{ name: 'x', alt: true }]);
  assert.deepEqual(feed(parser, 'y'), [{ name: 'text', text: 'y' }]);
});

test('an escape sequence split across chunks is held until complete', () => {
  const parser = createKeyParser();
  assert.deepEqual(feed(parser, '\u001b['), []);
  assert.deepEqual(feed(parser, 'A'), [{ name: 'up' }]);
});

test('a lone escape resolves to escape on flush', () => {
  const parser = createKeyParser();
  assert.deepEqual(feed(parser, '\u001b'), []);
  assert.deepEqual(parser.flush(), [{ name: 'escape' }]);
});

test('bracketed paste is a single event, even when split', () => {
  const parser = createKeyParser();
  assert.deepEqual(feed(parser, '\u001b[200~ab'), []);
  assert.deepEqual(feed(parser, 'c\n\u001b[201~'), [{ name: 'paste', text: 'abc\n' }]);
});

test('unknown sequences never crash the parser', () => {
  const parser = createKeyParser();
  const keys = feed(parser, '\u001b[99~\u001b[I');
  assert.deepEqual(keys.map((key) => key.name), ['unknown']);
  assert.deepEqual(feed(parser, 'ok'), [{ name: 'text', text: 'ok' }]);
});
