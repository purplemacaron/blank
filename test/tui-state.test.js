'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createState, scrollBy, scrollPage, newOutput, goEnd,
  approvalDecision, paletteMove, composerLayout, layout,
} = require('../src/cli/tui/state');

test('a fresh state follows live output', () => {
  const state = createState();
  assert.equal(state.follow, true);
  assert.equal(state.scroll, 0);
  newOutput(state, 3);
  assert.equal(state.newLines, 0);
});

test('scrolling up pauses follow and counts new lines until End', () => {
  const state = createState();
  scrollPage(state, 1, 10, 40);
  assert.equal(state.follow, false);
  assert.equal(state.scroll, 10);
  newOutput(state, 2);
  assert.equal(state.newLines, 2);
  goEnd(state);
  assert.equal(state.follow, true);
  assert.equal(state.scroll, 0);
  assert.equal(state.newLines, 0);
});

test('scrolling is clamped to the available range', () => {
  const state = createState();
  scrollBy(state, 100, 12);
  assert.equal(state.scroll, 12);
  scrollBy(state, -100, 12);
  assert.equal(state.scroll, 0);
  assert.equal(state.follow, true);
});

test('approval keys map to decisions', () => {
  assert.equal(approvalDecision({ name: 'y' }), 'allow');
  assert.equal(approvalDecision({ name: 'a' }), 'always');
  assert.equal(approvalDecision({ name: 'n' }), 'deny');
  assert.equal(approvalDecision({ name: 'escape' }), 'deny');
  assert.equal(approvalDecision({ name: 'x' }), null);
});

test('palette movement wraps around', () => {
  const state = createState();
  state.palette = { items: ['a', 'b', 'c'], index: 0 };
  paletteMove(state, -1);
  assert.equal(state.palette.index, 2);
  paletteMove(state, 1);
  assert.equal(state.palette.index, 0);
  state.palette.items = [];
  paletteMove(state, 1);
  assert.equal(state.palette.index, 0);
});

test('composer layout wraps long lines and places the cursor', () => {
  const result = composerLayout('abcdefghijklm', 10);
  assert.deepEqual(result.rows, ['abcdefghij', 'klm']);
  assert.equal(result.cursorRow, 1);
  assert.equal(result.cursorCol, 3);
});

test('composer layout keeps the cursor visible when the buffer is long', () => {
  const text = Array.from({ length: 10 }, (_, i) => `line${i}`).join('\n');
  const result = composerLayout(text, 20, 4);
  assert.equal(result.rows.length, 4);
  assert.equal(result.rows[3], 'line9');
  assert.equal(result.cursorRow, 3);
});

test('composer layout accounts for wide characters', () => {
  const result = composerLayout('한글', 10);
  assert.equal(result.rows[0], '한글');
  assert.equal(result.cursorCol, 4);
});

test('layout splits rows between header, transcript, composer and footer', () => {
  const state = createState();
  const size = layout(state, { columns: 80, rows: 24 }, 3);
  assert.equal(size.headerRows, 1);
  assert.equal(size.footerRows, 1);
  assert.equal(size.composerRows, 3);
  assert.equal(size.transcriptRows, 19);
});
