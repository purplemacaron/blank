'use strict';

const { stripAnsi, charWidth, displayWidth, wrapPlain, truncate } = require('./width');

const GUTTER = 2;

function inlineSpans(value) {
  const text = String(value ?? '');
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  const spans = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) spans.push({ text: text.slice(last, match.index), style: '' });
    const token = match[0];
    if (token.startsWith('**')) spans.push({ text: token.slice(2, -2), style: 'bold' });
    else if (token.startsWith('`')) spans.push({ text: token.slice(1, -1), style: 'code' });
    else if (token.startsWith('[')) {
      const split = token.indexOf('](');
      spans.push({ text: token.slice(1, split), style: 'underline' });
      spans.push({ text: ` (${token.slice(split + 2, -1)})`, style: 'dim' });
    } else spans.push({ text: token.slice(1, -1), style: 'italic' });
    last = match.index + token.length;
  }
  if (last < text.length) spans.push({ text: text.slice(last), style: '' });
  return spans.filter((span) => span.text);
}

function toChars(spans) {
  const chars = [];
  for (const span of spans) {
    for (const char of span.text) chars.push({ char, style: span.style });
  }
  return chars;
}

function wrapChars(chars, width) {
  const limit = Math.max(1, Math.floor(width));
  const lines = [];
  let line = [];
  let used = 0;
  let lastSpace = -1;
  const flush = (next) => {
    while (line.length && line[line.length - 1].char === ' ') line.pop();
    lines.push(line);
    line = next || [];
    used = line.reduce((sum, item) => sum + charWidth(item.char.codePointAt(0)), 0);
    lastSpace = -1;
  };
  for (const item of chars) {
    const size = charWidth(item.char.codePointAt(0));
    if (used + size > limit && line.length) {
      if (item.char === ' ') { flush([]); continue; }
      if (lastSpace >= 0) {
        const head = line.slice(0, lastSpace);
        const rest = line.slice(lastSpace + 1);
        while (head.length && head[head.length - 1].char === ' ') head.pop();
        lines.push(head);
        line = rest;
        used = line.reduce((sum, entry) => sum + charWidth(entry.char.codePointAt(0)), 0);
        lastSpace = -1;
      } else {
        flush([]);
      }
    }
    if (item.char === ' ') lastSpace = line.length;
    line.push(item);
    used += size;
  }
  if (line.length || !lines.length) flush([]);
  return lines.map((row) => {
    const spans = [];
    for (const item of row) {
      const prev = spans[spans.length - 1];
      if (prev && prev.style === item.style) prev.text += item.char;
      else spans.push({ text: item.char, style: item.style });
    }
    return spans;
  });
}

function wrapSpans(spans, width) {
  return wrapChars(toChars(spans), width);
}

function prefixRows(rows, width, first, rest = '  ', style = 'accent') {
  const gutter = Math.max(displayWidth(first), displayWidth(rest));
  const contentWidth = Math.max(1, width - gutter);
  const out = [];
  for (const row of rows) {
    const wrapped = row.length ? wrapSpans(row, contentWidth) : [[]];
    for (const line of wrapped) out.push(line);
  }
  return out.map((line, index) => [
    { text: index === 0 ? first : rest, style: index === 0 && first ? style : '' },
    ...line,
  ]);
}

function markdownRows(text, width, { inline = true } = {}) {
  const source = String(text ?? '').replace(/\r\n?/g, '\n');
  const rows = [];
  let fence = false;
  for (const line of source.split('\n')) {
    if (/^\s*```/.test(line)) { fence = !fence; continue; }
    if (fence) { rows.push(...wrapSpans([{ text: line, style: 'code' }], width)); continue; }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) { rows.push(...wrapSpans([{ text: heading[1], style: 'heading' }], width)); continue; }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { rows.push([{ text: '─'.repeat(Math.min(width, 40)), style: 'dim' }]); continue; }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (bullet) { rows.push(...prefixNoWrap([{ text: '• ', style: 'accent' }, ...inlineSpans(bullet[1])], width, 0)); continue; }
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ordered) { rows.push(...prefixNoWrap([{ text: '• ', style: 'accent' }, ...inlineSpans(ordered[1])], width, 0)); continue; }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) { rows.push(...prefixNoWrap([{ text: '│ ', style: 'dim' }, ...inlineSpans(quote[1])], width, 0)); continue; }
    if (!line) { rows.push([]); continue; }
    rows.push(...wrapSpans(inline ? inlineSpans(line) : [{ text: line, style: '' }], width));
  }
  return rows;
}

function prefixNoWrap(spans, width) {
  const plain = truncate(spans.map((span) => span.text).join(''), width);
  if (displayWidth(plain) < displayWidth(spans.map((span) => span.text).join(''))) {
    return [[{ text: plain, style: spans[0]?.style || '' }]];
  }
  return [spans];
}

function metaText(meta) {
  if (!meta) return '';
  const parts = [];
  if (meta.count !== undefined) parts.push(`${meta.count} result${meta.count === 1 ? '' : 's'}`);
  if (meta.path) parts.push(String(meta.path));
  if (meta.exitCode !== undefined) parts.push(`exit ${meta.exitCode}`);
  return parts.join(' · ');
}

function firstLine(content) {
  return String(content || '').split('\n')[0].slice(0, 200);
}

function renderTool(block, width) {
  const status = block.status || 'running';
  const marker = status === 'ok' ? '✓' : status === 'error' ? '✕' : '◇';
  const style = status === 'ok' ? 'green' : status === 'error' ? 'red' : 'yellow';
  const label = block.label || block.name || 'tool';
  const detail = status === 'running'
    ? (block.summary || '')
    : status === 'error'
      ? firstLine(block.content)
      : metaText(block.meta);
  const head = [
    { text: `${marker} `, style },
    { text: label, style: 'bold' },
  ];
  if (detail) head.push({ text: ` · ${detail}`, style: 'dim' });
  const rows = [prefixNoWrap(head, width)[0]];
  if (block.expanded && block.content) {
    const lines = String(block.content).replace(/\r\n?/g, '\n').split('\n').slice(0, 40);
    for (const line of lines) {
      for (const wrapped of wrapSpans([{ text: line, style: 'dim' }], Math.max(1, width - 2))) {
        rows.push([{ text: '  ', style: '' }, ...wrapped]);
      }
    }
  }
  return rows;
}

function renderBlock(block, options) {
  const { width, verbose } = options;
  const contentWidth = Math.max(1, width - GUTTER);
  switch (block.kind) {
    case 'user':
      return prefixRows([inlineSpans(block.text)], width, '› ');
    case 'assistant':
      return prefixRows(markdownRows(block.text, contentWidth), width, '● ');
    case 'reasoning':
      if (!verbose) return [];
      return prefixRows([[{ text: block.text, style: 'dim' }]], width, '· ');
    case 'tool':
      return renderTool(block, width);
    case 'notice': {
      const marker = block.level === 'warn' ? '!' : '·';
      const style = block.level === 'warn' ? 'yellow' : 'dim';
      return prefixRows(wrapSpans([{ text: block.text, style: 'dim' }], contentWidth), width, `${marker} `, '  ', style);
    }
    case 'error': {
      const rows = [prefixNoWrap([
        { text: '✕ ', style: 'red' },
        { text: block.message, style: 'red' },
      ], width)[0]];
      if (block.hint) rows.push([{ text: '  ', style: '' }, { text: block.hint, style: 'dim' }]);
      return rows;
    }
    case 'meta':
      return prefixRows(wrapSpans([{ text: block.text, style: 'dim' }], contentWidth), width, '· ');
    case 'system': {
      const plain = stripAnsi(block.text);
      return wrapPlain(plain, width).map((line) => [{ text: line, style: 'dim' }]);
    }
    default:
      return [];
  }
}

function renderTranscript(blocks, { width = 80, verbose = false } = {}) {
  const lines = [];
  for (const block of blocks || []) lines.push(...renderBlock(block, { width, verbose }));
  return lines;
}

module.exports = { renderTranscript, inlineSpans, wrapSpans };
