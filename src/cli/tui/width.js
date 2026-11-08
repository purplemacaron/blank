'use strict';

const ANSI_PATTERN = /\u001b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\u0007]*\u0007)/g;

function stripAnsi(text) {
  return String(text ?? '').replace(ANSI_PATTERN, '');
}

function isWide(code) {
  return (
    (code >= 0x1100 && code <= 0x115f)
    || (code >= 0x2e80 && code <= 0x303e)
    || (code >= 0x3041 && code <= 0x33ff)
    || (code >= 0x3400 && code <= 0x4dbf)
    || (code >= 0x4e00 && code <= 0x9fff)
    || (code >= 0xa000 && code <= 0xa4cf)
    || (code >= 0xa960 && code <= 0xa97f)
    || (code >= 0xac00 && code <= 0xd7a3)
    || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0xfe10 && code <= 0xfe19)
    || (code >= 0xfe30 && code <= 0xfe6f)
    || (code >= 0xff00 && code <= 0xff60)
    || (code >= 0xffe0 && code <= 0xffe6)
    || (code >= 0x1f300 && code <= 0x1f64f)
    || (code >= 0x1f680 && code <= 0x1f6ff)
    || (code >= 0x1f900 && code <= 0x1f9ff)
    || (code >= 0x1fa70 && code <= 0x1faff)
    || (code >= 0x20000 && code <= 0x3fffd)
  );
}

function isZero(code) {
  return (
    code === 0x200b
    || code === 0x200c
    || code === 0x200d
    || code === 0xfe0e
    || code === 0xfe0f
    || (code >= 0x0300 && code <= 0x036f)
    || (code >= 0x1ab0 && code <= 0x1aff)
    || (code >= 0x1dc0 && code <= 0x1dff)
    || (code >= 0x20d0 && code <= 0x20ff)
    || (code >= 0xfe20 && code <= 0xfe2f)
    || code === 0x00ad
  );
}

function charWidth(code) {
  if (!Number.isFinite(code) || code < 0) return 0;
  if (code < 32 || (code >= 0x7f && code <= 0x9f)) return 0;
  if (isZero(code)) return 0;
  return isWide(code) ? 2 : 1;
}

function displayWidth(text) {
  const plain = stripAnsi(text);
  let width = 0;
  for (const char of plain) width += charWidth(char.codePointAt(0));
  return width;
}

function wrapPlain(text, width) {
  const limit = Math.max(1, Math.floor(width));
  const paragraphs = String(text ?? '').replace(/\t/g, '    ').split('\n');
  const out = [];
  for (const paragraph of paragraphs) {
    if (!paragraph) { out.push(''); continue; }
    let line = '';
    let lineWidth = 0;
    let lastSpace = -1;
    for (const char of paragraph) {
      const size = charWidth(char.codePointAt(0));
      if (lineWidth + size > limit && line) {
        if (char === ' ') { out.push(line); line = ''; lineWidth = 0; lastSpace = -1; continue; }
        const breakAt = lastSpace >= 0 && displayWidth(line.slice(0, lastSpace)) >= limit - 2;
        if (breakAt) {
          const head = line.slice(0, lastSpace);
          const rest = line.slice(lastSpace + 1);
          out.push(head);
          line = rest;
          lineWidth = displayWidth(rest);
          lastSpace = -1;
        } else {
          out.push(line);
          line = '';
          lineWidth = 0;
          lastSpace = -1;
        }
      }
      if (char === ' ') lastSpace = line.length;
      line += char;
      lineWidth += size;
    }
    out.push(line);
  }
  return out;
}

function truncate(text, width, ellipsis = '…') {
  const limit = Math.max(0, Math.floor(width));
  if (limit === 0) return '';
  if (displayWidth(text) <= limit) return String(text ?? '');
  const plain = stripAnsi(text);
  const target = limit - displayWidth(ellipsis);
  if (target <= 0) return ellipsis.slice(0, limit);
  let out = '';
  let used = 0;
  for (const char of plain) {
    const size = charWidth(char.codePointAt(0));
    if (used + size > target) break;
    out += char;
    used += size;
  }
  return out + ellipsis;
}

module.exports = { stripAnsi, charWidth, displayWidth, wrapPlain, truncate };
