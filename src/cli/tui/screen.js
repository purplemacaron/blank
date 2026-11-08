'use strict';

const { displayWidth, stripAnsi, truncate } = require('./width');

const ALT_ON = '\u001b[?1049h';
const ALT_OFF = '\u001b[?1049l';
const CURSOR_ON = '\u001b[?25h';
const CURSOR_OFF = '\u001b[?25l';
const PASTE_ON = '\u001b[?2004h';
const PASTE_OFF = '\u001b[?2004l';
const CLEAR = '\u001b[2J\u001b[H';

function changedRows(previous, next) {
  const out = [];
  const length = Math.max(previous.length, next.length);
  for (let i = 0; i < length; i += 1) {
    if ((previous[i] ?? '') !== (next[i] ?? '')) out.push(i);
  }
  return out;
}

function fitLine(value, columns) {
  const line = String(value ?? '');
  const width = displayWidth(line);
  if (width === columns) return line;
  if (width < columns) return line + ' '.repeat(columns - width);
  return truncate(stripAnsi(line), columns);
}

function createScreen({ input = process.stdin, output = process.stdout } = {}) {
  let started = false;
  let lastFrame = null;
  let lastColumns = 0;
  let lastRows = 0;
  let resizeHandler = null;

  const screen = {
    get started() { return started; },

    size() {
      return {
        columns: Math.max(20, Number(output.columns) || 80),
        rows: Math.max(6, Number(output.rows) || 24),
      };
    },

    start() {
      if (started) return;
      started = true;
      lastFrame = null;
      output.write(ALT_ON + CURSOR_OFF + PASTE_ON);
      if (input.isTTY && typeof input.setRawMode === 'function') input.setRawMode(true);
      if (typeof output.on === 'function') {
        resizeHandler = () => { lastFrame = null; };
        output.on('resize', resizeHandler);
      }
    },

    stop() {
      if (!started) return;
      started = false;
      if (resizeHandler && typeof output.off === 'function') output.off('resize', resizeHandler);
      resizeHandler = null;
      if (input.isTTY && typeof input.setRawMode === 'function') input.setRawMode(false);
      output.write(PASTE_OFF + CURSOR_ON + ALT_OFF);
      lastFrame = null;
    },

    render(lines, cursor) {
      if (!started) return;
      const { columns, rows } = screen.size();
      const frame = [];
      for (let i = 0; i < rows; i += 1) frame.push(fitLine(lines[i] ?? '', columns));
      const resized = !lastFrame || columns !== lastColumns || rows !== lastRows;
      let out = '';
      if (resized) {
        out += CLEAR;
        lastColumns = columns;
        lastRows = rows;
      }
      const previous = lastFrame || [];
      for (const index of changedRows(previous, frame)) {
        out += `\u001b[${index + 1};1H\u001b[K${frame[index]}`;
      }
      out += cursor ? `\u001b[${cursor.row + 1};${cursor.col + 1}H${CURSOR_ON}` : CURSOR_OFF;
      lastFrame = frame;
      output.write(out);
    },
  };

  return screen;
}

module.exports = { createScreen, changedRows };
