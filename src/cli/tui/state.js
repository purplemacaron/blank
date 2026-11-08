'use strict';

const { charWidth, displayWidth } = require('./width');

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function createState() {
  return {
    status: 'idle',
    follow: true,
    scroll: 0,
    newLines: 0,
    palette: null,
    overlay: null,
    approval: null,
    verbose: false,
  };
}

function scrollBy(state, delta, maxScroll) {
  state.scroll = clamp(state.scroll + delta, 0, Math.max(0, maxScroll));
  state.follow = state.scroll === 0;
  if (state.follow) state.newLines = 0;
}

function scrollPage(state, direction, viewport, maxScroll) {
  scrollBy(state, direction * Math.max(1, viewport), maxScroll);
}

function newOutput(state, count = 1) {
  if (!state.follow) state.newLines += count;
}

function goEnd(state) {
  state.scroll = 0;
  state.follow = true;
  state.newLines = 0;
}

function approvalDecision(key) {
  if (!key) return null;
  if (key.name === 'y') return 'allow';
  if (key.name === 'a') return 'always';
  if (key.name === 'n' || key.name === 'escape') return 'deny';
  return null;
}

function paletteMove(state, delta) {
  const palette = state.palette;
  if (!palette || !palette.items || !palette.items.length) {
    if (palette) palette.index = 0;
    return;
  }
  palette.index = (palette.index + delta + palette.items.length) % palette.items.length;
}

function wrapLine(line, width) {
  if (!line) return [''];
  const limit = Math.max(1, width);
  const rows = [];
  let current = '';
  let used = 0;
  for (const char of line) {
    const size = charWidth(char.codePointAt(0));
    if (used + size > limit && current) {
      rows.push(current);
      current = '';
      used = 0;
    }
    current += char;
    used += size;
  }
  rows.push(current);
  return rows;
}

function composerLayout(text, width, maxRows = 8, cursor = String(text ?? '').length) {
  const value = String(text ?? '').replace(/\r\n?/g, '\n');
  const cursorIndex = clamp(Number(cursor) || 0, 0, value.length);
  const lines = value.split('\n');
  const starts = [];
  let offset = 0;
  for (const line of lines) { starts.push(offset); offset += line.length + 1; }
  let lineIndex = 0;
  for (let i = 0; i < lines.length; i += 1) if (starts[i] <= cursorIndex) lineIndex = i;
  const lineCursor = clamp(cursorIndex - starts[lineIndex], 0, lines[lineIndex].length);
  const rows = [];
  let seen = 0;
  let cursorRow = 0;
  let cursorCol = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const wrapped = wrapLine(lines[i], width);
    if (i === lineIndex) {
      let charSeen = 0;
      for (const [rowIndex, row] of wrapped.entries()) {
        cursorRow = seen + rowIndex;
        if (lineCursor <= charSeen + row.length) {
          cursorCol = displayWidth(row.slice(0, lineCursor - charSeen));
          break;
        }
        charSeen += row.length;
        cursorCol = displayWidth(row);
      }
    }
    rows.push(...wrapped);
    seen += wrapped.length;
  }
  const visible = Math.max(1, Math.min(maxRows, rows.length));
  const start = clamp(cursorRow - visible + 1, 0, Math.max(0, rows.length - visible));
  return {
    rows: rows.slice(start, start + visible),
    cursorRow: clamp(cursorRow - start, 0, visible - 1),
    cursorCol,
    start,
    height: visible,
  };
}

function layout(state, size, composerRows) {
  const headerRows = 1;
  const footerRows = 1;
  const transcriptRows = Math.max(3, size.rows - headerRows - footerRows - composerRows);
  return { headerRows, footerRows, composerRows, transcriptRows };
}

module.exports = {
  createState, scrollBy, scrollPage, newOutput, goEnd,
  approvalDecision, paletteMove, composerLayout, layout,
};
