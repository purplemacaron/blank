'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createScreen, changedRows } = require('../src/cli/tui/screen');

function fakeTty({ columns = 60, rows = 10 } = {}) {
  const output = {
    columns,
    rows,
    isTTY: true,
    chunks: [],
    write(value) { this.chunks.push(value); return true; },
    text() { return this.chunks.join(''); },
    clear() { this.chunks = []; },
  };
  const input = {
    isTTY: true,
    raw: false,
    setRawMode(value) { this.raw = value; },
    on() {},
    off() {},
  };
  return { output, input };
}

test('changedRows reports only lines that differ', () => {
  assert.deepEqual(changedRows(['a', 'b'], ['a', 'b']), []);
  assert.deepEqual(changedRows(['a', 'b'], ['a', 'c']), [1]);
  assert.deepEqual(changedRows(['a'], ['a', 'b']), [1]);
  assert.deepEqual(changedRows(['a', 'b'], ['a']), [1]);
});

test('start enters the alternate screen and stop restores it once', () => {
  const { output, input } = fakeTty();
  const screen = createScreen({ input, output, color: true });
  screen.start();
  screen.start();
  assert.equal(input.raw, true);
  assert.equal((output.text().match(/\u001b\[\?1049h/g) || []).length, 1);
  assert.equal(output.text().includes('\u001b[?25l'), true);
  assert.equal(output.text().includes('\u001b[?2004h'), true);
  output.clear();
  screen.stop();
  screen.stop();
  assert.equal(input.raw, false);
  assert.equal((output.text().match(/\u001b\[\?1049l/g) || []).length, 1);
  assert.equal(output.text().includes('\u001b[?25h'), true);
});

test('the first render paints every row and pads to the width', () => {
  const { output, input } = fakeTty({ columns: 10, rows: 3 });
  const screen = createScreen({ input, output, color: true });
  screen.start();
  output.clear();
  screen.render(['hello'], { row: 2, col: 3 });
  const painted = output.text();
  assert.equal(painted.includes('hello     '), true);
  assert.equal(painted.includes('\u001b[3;4H'), true, 'cursor is positioned');
  assert.equal(painted.includes('\u001b[?25h'), true);
});

test('an unchanged frame only repositions the cursor', () => {
  const { output, input } = fakeTty({ columns: 20, rows: 3 });
  const screen = createScreen({ input, output, color: true });
  screen.start();
  screen.render(['one', 'two', 'three'], { row: 0, col: 0 });
  output.clear();
  screen.render(['one', 'two', 'three'], { row: 1, col: 2 });
  const painted = output.text();
  assert.equal(painted.includes('one'), false);
  assert.equal(painted.includes('two'), false);
  assert.equal(painted.includes('\u001b[2;3H'), true);
});

test('only the changed row is painted again', () => {
  const { output, input } = fakeTty({ columns: 20, rows: 3 });
  const screen = createScreen({ input, output, color: true });
  screen.start();
  screen.render(['one', 'two', 'three'], { row: 0, col: 0 });
  output.clear();
  screen.render(['one', 'TWO', 'three'], { row: 0, col: 0 });
  const painted = output.text();
  assert.equal(painted.includes('TWO'), true);
  assert.equal(painted.includes('one'), false);
  assert.equal(painted.includes('three'), false);
});

test('a resize forces a full repaint', () => {
  const { output, input } = fakeTty({ columns: 20, rows: 3 });
  const screen = createScreen({ input, output, color: true });
  screen.start();
  screen.render(['one', 'two'], { row: 0, col: 0 });
  output.columns = 24;
  output.clear();
  screen.render(['one', 'two'], { row: 0, col: 0 });
  const painted = output.text();
  assert.equal(painted.includes('one'), true);
  assert.equal(painted.includes('two'), true);
});

test('hiding the cursor when no position is given', () => {
  const { output, input } = fakeTty({ columns: 20, rows: 2 });
  const screen = createScreen({ input, output, color: true });
  screen.start();
  output.clear();
  screen.render(['x'], null);
  assert.equal(output.text().includes('\u001b[?25l'), true);
  assert.equal(output.text().includes('\u001b[?25h'), false);
});

function applyTerminal(sequence, columns, rows) {
  const grid = Array.from({ length: rows }, () => Array(columns).fill(' '));
  let x = 0;
  let y = 0;
  let pendingWrap = false;
  const pattern = /\u001b\[([0-9;?]*)([A-Za-z])/y;
  for (let i = 0; i < sequence.length;) {
    if (sequence[i] === '\u001b') {
      pattern.lastIndex = i;
      const match = pattern.exec(sequence);
      assert.ok(match, `unparsed escape at ${i}`);
      const params = match[1];
      const final = match[2];
      if (final === 'H') {
        const [row, col] = params ? params.split(';').map(Number) : [1, 1];
        y = row - 1;
        x = col - 1;
        pendingWrap = false;
      } else if (final === 'J' && params === '2') {
        for (const row of grid) row.fill(' ');
      } else if (final === 'K') {
        // xterm erases from the cursor cell; a pending wrap keeps the cursor
        // on the last cell, so a trailing EL also erases that cell.
        for (let cx = x; cx < columns; cx += 1) grid[y][cx] = ' ';
      }
      i += match[0].length;
      continue;
    }
    const char = sequence[i];
    if (pendingWrap) {
      x = 0;
      y = Math.min(rows - 1, y + 1);
      pendingWrap = false;
    }
    grid[y][x] = char;
    if (x === columns - 1) pendingWrap = true;
    else x += 1;
    i += 1;
  }
  return grid.map((row) => row.join(''));
}

test('a full-width row keeps its last column on a real terminal', () => {
  const columns = 20;
  const rows = 6;
  const { output, input } = fakeTty({ columns, rows });
  const screen = createScreen({ input, output, color: true });
  screen.start();
  output.clear();
  const lines = ['abcdefghijklmnopqrst', 'klmnopqrstuvwxyz0123'];
  screen.render(lines, { row: 1, col: 0 });
  const expected = [...lines, ...Array.from({ length: rows - lines.length }, () => ' '.repeat(columns))];
  assert.deepEqual(applyTerminal(output.text(), columns, rows), expected);
});

test('erasing happens before painting so stale text cannot survive', () => {
  const columns = 20;
  const rows = 6;
  const { output, input } = fakeTty({ columns, rows });
  const screen = createScreen({ input, output, color: true });
  screen.start();
  screen.render(['longer line than before'], { row: 0, col: 0 });
  output.clear();
  screen.render(['short'], { row: 0, col: 0 });
  const expected = ['short'.padEnd(columns), ...Array.from({ length: rows - 1 }, () => ' '.repeat(columns))];
  assert.deepEqual(applyTerminal(output.text(), columns, rows), expected);
});

test('rendering after stop writes nothing', () => {
  const { output, input } = fakeTty();
  const screen = createScreen({ input, output, color: true });
  screen.start();
  screen.stop();
  output.clear();
  screen.render(['x'], { row: 0, col: 0 });
  assert.equal(output.text(), '');
});
