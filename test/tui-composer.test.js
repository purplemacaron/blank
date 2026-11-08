'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createComposer } = require('../src/cli/tui/composer');

test('insert writes at the cursor and moves it', () => {
  const composer = createComposer();
  composer.insert('helo');
  composer.left();
  composer.insert('l');
  assert.equal(composer.text, 'hello');
  assert.equal(composer.cursor, 4);
});

test('newline splits the line and backspace joins it again', () => {
  const composer = createComposer();
  composer.insert('alpha');
  composer.newline();
  composer.insert('beta');
  assert.equal(composer.text, 'alpha\nbeta');
  assert.equal(composer.cursor, 10);
  composer.backspace();
  composer.backspace();
  composer.backspace();
  composer.backspace();
  assert.equal(composer.text, 'alpha\n');
  composer.backspace();
  assert.equal(composer.text, 'alpha');
  assert.equal(composer.cursor, 5);
});

test('delete removes the character in front of the cursor', () => {
  const composer = createComposer();
  composer.insert('ab\ncd');
  composer.home();
  composer.deleteForward();
  assert.equal(composer.text, 'ab\nd');
  composer.end();
  composer.deleteForward();
  assert.equal(composer.text, 'ab\nd', 'end of the last line deletes nothing');
  composer.home();
  composer.up();
  composer.end();
  composer.deleteForward();
  assert.equal(composer.text, 'abd', 'delete at a line end joins the next line');
});

test('cursor movement is code point aware for surrogate pairs', () => {
  const composer = createComposer();
  composer.insert('a😀b');
  composer.left();
  composer.left();
  assert.equal(composer.cursor, 1);
  composer.insert('!');
  assert.equal(composer.text, 'a!😀b');
});

test('home and end stay inside the current line', () => {
  const composer = createComposer();
  composer.insert('one\ntwo\nthree');
  composer.up();
  composer.up();
  composer.end();
  composer.home();
  assert.equal(composer.text.slice(0, composer.cursor), '');
  composer.end();
  assert.equal(composer.text.slice(0, composer.cursor), 'one');
});

test('up and down report false at the first and last line', () => {
  const composer = createComposer();
  composer.insert('one\ntwo');
  assert.equal(composer.up(), true);
  assert.equal(composer.up(), false);
  assert.equal(composer.down(), true);
  assert.equal(composer.down(), false);
});

test('history walks back and restores the draft', () => {
  const composer = createComposer();
  composer.remember('first');
  composer.remember('second');
  composer.insert('draft');
  assert.equal(composer.historyPrev(), true);
  assert.equal(composer.text, 'second');
  assert.equal(composer.historyPrev(), true);
  assert.equal(composer.text, 'first');
  assert.equal(composer.historyNext(), true);
  assert.equal(composer.text, 'second');
  assert.equal(composer.historyNext(), true);
  assert.equal(composer.text, 'draft');
  assert.equal(composer.historyNext(), false);
});

test('history ignores blanks and duplicates the last entry', () => {
  const composer = createComposer();
  composer.remember('same');
  composer.remember('same');
  composer.remember('   ');
  composer.historyPrev();
  assert.equal(composer.text, 'same');
  composer.historyPrev();
  assert.equal(composer.text, 'same');
});

test('history is capped and clear keeps the buffer separate', () => {
  const composer = createComposer({ historySize: 3 });
  for (const item of ['a', 'b', 'c', 'd']) composer.remember(item);
  assert.deepEqual(composer.history, ['b', 'c', 'd']);
  composer.insert('hello');
  composer.clear();
  assert.equal(composer.text, '');
  assert.equal(composer.cursor, 0);
  assert.deepEqual(composer.history, ['b', 'c', 'd']);
});

test('completion offers slash commands and subcommands', () => {
  const composer = createComposer();
  composer.insert('/mo');
  assert.deepEqual(composer.completions(), ['/model', '/mode']);
  composer.clear();
  composer.insert('/memory ');
  assert.deepEqual(composer.completions(), ['add', 'list', 'search', 'rm']);
  composer.clear();
  composer.insert('/model gpt');
  assert.deepEqual(composer.completions(['gpt-5', 'gpt-5-mini', 'claude']), ['gpt-5', 'gpt-5-mini']);
});

test('paste inserts multiline text at the cursor', () => {
  const composer = createComposer();
  composer.insert('ab');
  composer.left();
  composer.insert('1\n2');
  assert.equal(composer.text, 'a1\n2b');
  assert.equal(composer.cursor, 4);
});
