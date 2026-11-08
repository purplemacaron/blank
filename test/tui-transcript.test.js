'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderTranscript } = require('../src/cli/tui/transcript');
const { createTheme } = require('../src/cli/tui/theme');
const { displayWidth, stripAnsi } = require('../src/cli/tui/width');

const text = (lines) => lines.map((line) => line.map((span) => span.text).join(''));
const styleOf = (lines, needle) => {
  for (const line of lines) {
    for (const span of line) if (span.text.includes(needle)) return span.style;
  }
  return null;
};

test('user rows get a prompt marker', () => {
  const lines = renderTranscript([{ kind: 'user', text: 'hello world' }], { width: 40 });
  assert.deepEqual(text(lines), ['› hello world']);
  assert.equal(lines[0][0].style, 'accent');
});

test('assistant text receives a label on the first line only', () => {
  const lines = renderTranscript([{ kind: 'assistant', text: 'one\ntwo' }], { width: 40 });
  assert.deepEqual(text(lines), ['● one', '  two']);
});

test('inline markdown becomes styled spans', () => {
  const lines = renderTranscript([{
    kind: 'assistant',
    text: 'see **bold** and `code` plus [site](https://example.com)',
  }], { width: 80 });
  assert.deepEqual(text(lines), ['● see bold and code plus site (https://example.com)']);
  assert.equal(styleOf(lines, 'bold'), 'bold');
  assert.equal(styleOf(lines, 'code'), 'code');
  assert.equal(styleOf(lines, 'site'), 'underline');
});

test('headings and bullets are rewritten', () => {
  const lines = renderTranscript([{
    kind: 'assistant',
    text: '# Title\n- one\n1. two',
  }], { width: 40 });
  assert.deepEqual(text(lines), ['● Title', '  • one', '  • two']);
  assert.equal(styleOf(lines, 'Title'), 'heading');
});

test('fenced code keeps its content and skips inline parsing', () => {
  const lines = renderTranscript([{
    kind: 'assistant',
    text: '```js\nconst *x* = 1;\n```',
  }], { width: 40 });
  const rows = text(lines);
  assert.ok(rows.some((row) => row.includes('const *x* = 1;')));
  assert.equal(styleOf(lines, 'const'), 'code');
});

test('an unclosed fence stays code until the end of the block', () => {
  const lines = renderTranscript([{
    kind: 'assistant',
    text: '```\n**not bold**',
  }], { width: 40 });
  assert.equal(styleOf(lines, 'not bold'), 'code');
  assert.equal(text(lines).join('\n').includes('not bold'), true);
});

test('tool rows move from running to ok or error', () => {
  const running = renderTranscript([{
    kind: 'tool', name: 'Bash', label: 'Bash', summary: 'ls -la', status: 'running',
  }], { width: 60 });
  assert.deepEqual(text(running), ['◇ Bash · ls -la']);

  const ok = renderTranscript([{
    kind: 'tool', name: 'Bash', label: 'Bash', status: 'ok', meta: { exitCode: 0 },
  }], { width: 60 });
  assert.deepEqual(text(ok), ['✓ Bash · exit 0']);

  const error = renderTranscript([{
    kind: 'tool', name: 'Bash', label: 'Bash', status: 'error', content: 'boom\nsecond line',
  }], { width: 60 });
  assert.deepEqual(text(error), ['✕ Bash · boom']);
});

test('expanded tool output follows the row', () => {
  const block = {
    kind: 'tool', name: 'Read', label: 'Read', status: 'ok', expanded: true,
    content: 'line one\nline two',
  };
  const expanded = renderTranscript([block], { width: 40 });
  assert.ok(text(expanded).some((row) => row.includes('line one')));
  const collapsed = renderTranscript([{ ...block, expanded: false }], { width: 40 });
  assert.equal(text(collapsed).some((row) => row.includes('line one')), false);
});

test('reasoning is hidden unless verbose is on', () => {
  const block = { kind: 'reasoning', text: 'thinking hard' };
  assert.deepEqual(renderTranscript([block], { width: 40 }), []);
  const shown = renderTranscript([block], { width: 40, verbose: true });
  assert.deepEqual(text(shown), ['· thinking hard']);
});

test('notices, errors and meta rows render with their markers', () => {
  const lines = renderTranscript([
    { kind: 'notice', level: 'warn', text: 'careful' },
    { kind: 'error', message: 'failed', hint: 'try again' },
    { kind: 'meta', text: '12 in · 4 out' },
    { kind: 'system', text: 'plain line' },
  ], { width: 40 });
  assert.deepEqual(text(lines), ['! careful', '✕ failed', '  try again', '· 12 in · 4 out', 'plain line']);
});

test('system rows strip ansi and wrap to the width', () => {
  const lines = renderTranscript([{
    kind: 'system',
    text: '\u001b[31mred\u001b[0m ' + 'word '.repeat(12).trim(),
  }], { width: 20 });
  const rows = text(lines);
  assert.equal(rows[0].startsWith('red word'), true);
  assert.equal(rows.some((row) => row.includes('\u001b')), false);
  assert.ok(rows.every((row) => displayWidth(row) <= 20));
});

test('wide characters wrap without exceeding the width', () => {
  const lines = renderTranscript([{ kind: 'assistant', text: '한글한글한글' }], { width: 8 });
  const rows = text(lines);
  assert.deepEqual(rows, ['● 한글한', '  글한글']);
  assert.ok(rows.every((row) => displayWidth(row) <= 8));
});

test('theme paints spans and can be disabled', () => {
  const painted = createTheme({ color: true }).paint([{ text: 'x', style: 'accent' }]);
  assert.equal(stripAnsi(painted), 'x');
  assert.notEqual(painted, 'x');
  assert.equal(createTheme({ color: false }).paint([{ text: 'x', style: 'accent' }]), 'x');
});
