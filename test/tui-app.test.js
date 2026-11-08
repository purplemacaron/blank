'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { composeFrame, blocksFromSession } = require('../src/cli/tui/app');
const { createState } = require('../src/cli/tui/state');
const { createTheme } = require('../src/cli/tui/theme');
const { displayWidth, stripAnsi } = require('../src/cli/tui/width');

const theme = createTheme({ color: false });

function build(overrides = {}) {
  const state = createState();
  Object.assign(state, overrides.state || {});
  const text = overrides.text || '';
  return composeFrame({
    theme,
    size: { columns: overrides.columns || 80, rows: overrides.rows || 24 },
    header: {
      version: '1.5.0',
      workspace: 'C:/work/blank',
      title: overrides.title || 'New session',
      model: 'local/qwen',
      mode: 'agent',
    },
    blocks: overrides.blocks || [],
    verbose: Boolean(overrides.verbose),
    state,
    composerText: text,
    composerCursor: overrides.cursor === undefined ? text.length : overrides.cursor,
    status: overrides.status || 'idle',
    spinner: '⠋',
    usage: overrides.usage || null,
  });
}

function plainLines(frame) {
  return frame.lines.map((line) => stripAnsi(line));
}

test('idle frame fills the terminal and shows header, composer and footer', () => {
  const frame = build();
  assert.strictEqual(frame.lines.length, 24);
  assert.strictEqual(frame.lines.filter((line) => displayWidth(line) > 80).length, 0);
  const lines = plainLines(frame);
  assert.match(lines[0], /blank v1\.5\.0/);
  assert.match(lines[0], /blank/);
  assert.match(lines[0], /local\/qwen · agent/);
  assert.strictEqual(lines[23].includes('ready'), true);
  assert.strictEqual(lines[23].includes('Enter send'), true);
  assert.ok(lines.some((line) => line.startsWith('› ')));
  assert.ok(frame.cursor);
  assert.ok(frame.cursor.row > 0 && frame.cursor.row < 23);
  assert.strictEqual(frame.cursor.col, 2);
});

test('footer shows live usage when the session has tokens', () => {
  const frame = build({ usage: { input: 1200, output: 340 } });
  assert.match(plainLines(frame)[23], /1\.2k in · 340 out/);
});

test('transcript renders user and assistant blocks above the composer', () => {
  const frame = build({
    blocks: [
      { kind: 'user', text: 'hello there' },
      { kind: 'assistant', text: 'working on it' },
    ],
  });
  const lines = plainLines(frame);
  const userRow = lines.findIndex((line) => line.includes('hello there'));
  const assistantRow = lines.findIndex((line) => line.includes('working on it'));
  assert.ok(userRow > 0);
  assert.ok(assistantRow > userRow);
  assert.match(lines[userRow], /› hello there/);
  assert.match(lines[assistantRow], /● working on it/);
  assert.ok(userRow < frame.cursor.row);
});

test('running status renders the spinner in the footer', () => {
  const frame = build({ status: 'running' });
  const footer = plainLines(frame)[23];
  assert.match(footer, /⠋ running/);
  assert.match(footer, /Esc stop/);
});

test('scrolled transcript reports new output and offset', () => {
  const blocks = Array.from({ length: 40 }, (_, index) => ({ kind: 'user', text: `line ${index}` }));
  const frame = build({ blocks, state: { follow: false, scroll: 2, newLines: 3 } });
  const footer = plainLines(frame)[23];
  assert.match(footer, /↓ 3 new/);
  const lines = plainLines(frame);
  assert.strictEqual(lines.some((line) => line.includes('line 39')), false);
});

test('end-to-live frame shows the newest output and no new counter', () => {
  const blocks = Array.from({ length: 40 }, (_, index) => ({ kind: 'user', text: `line ${index}` }));
  const frame = build({ blocks, state: { follow: true } });
  const lines = plainLines(frame);
  assert.strictEqual(lines.some((line) => line.includes('line 39')), true);
  assert.strictEqual(plainLines(frame)[23].includes('↓'), false);
});

test('approval overlay replaces the composer and offers decisions', () => {
  const state = {
    approval: {
      label: 'Run command',
      tool: 'run_command',
      reason: 'writes files',
      summary: 'npm test',
      args: '{\n  "command": "npm test"\n}',
    },
  };
  const frame = build({ state });
  const lines = plainLines(frame);
  assert.ok(lines.some((line) => line.includes('approval needed')));
  assert.ok(lines.some((line) => line.includes('Run command')));
  assert.ok(lines.some((line) => line.includes('writes files')));
  assert.ok(lines.some((line) => line.includes('[y] allow')));
  assert.strictEqual(frame.cursor, null);
  assert.match(lines[23], /y allow · a always · n deny/);
});

test('slash palette renders above the composer and hints Tab', () => {
  const frame = build({ text: '/m', state: { palette: { items: ['/mode', '/model'], index: 1 } } });
  const lines = plainLines(frame);
  assert.ok(lines.some((line) => line.includes('/model')));
  assert.match(lines[23], /Tab accept/);
  assert.ok(frame.cursor);
});

test('overlay pickers replace the composer area', () => {
  const frame = build({
    state: {
      overlay: {
        title: 'Models',
        index: 0,
        items: [{ label: 'local/qwen', detail: 'Qwen' }, { label: 'openai/gpt', detail: 'GPT' }],
      },
    },
  });
  const lines = plainLines(frame);
  assert.ok(lines.some((line) => line.includes('Models')));
  assert.ok(lines.some((line) => line.includes('local/qwen')));
  assert.match(lines[23], /Enter select/);
  assert.strictEqual(frame.cursor, null);
});

test('composer growth is capped at eight rows', () => {
  const text = Array.from({ length: 20 }, (_, index) => `line ${index}`).join('\n');
  const frame = build({ text });
  assert.strictEqual(frame.layout.composerRows, 8);
  assert.strictEqual(frame.lines.length, 24);
});

test('narrow terminal keeps every row inside the width', () => {
  const frame = build({
    columns: 40,
    rows: 12,
    text: '/mode agent',
    blocks: [{ kind: 'assistant', text: '한글 텍스트가 길게 이어지는 응답입니다 '.repeat(4) }],
  });
  assert.strictEqual(frame.lines.length, 12);
  for (const line of frame.lines) assert.ok(displayWidth(line) <= 40, line);
});

test('wide terminal renders 30 rows with an aligned footer', () => {
  const frame = build({ columns: 120, rows: 30 });
  assert.strictEqual(frame.lines.length, 30);
  assert.strictEqual(displayWidth(frame.lines[29]) <= 120, true);
  assert.match(plainLines(frame)[29], /ready/);
});

test('blocksFromSession rebuilds history and tool outcomes', () => {
  const blocks = blocksFromSession({
    messages: [
      { role: 'user', content: 'fix the bug' },
      { role: 'assistant', content: 'looking', reasoning: 'think', toolCalls: [{ id: 'c1', name: 'read_file' }] },
      { role: 'tool', toolCallId: 'c1', name: 'read_file', content: 'boom', isError: true },
    ],
  });
  assert.deepStrictEqual(blocks.map((block) => block.kind), ['user', 'assistant', 'reasoning', 'tool']);
  assert.strictEqual(blocks[3].status, 'error');
  assert.strictEqual(blocks[3].content, 'boom');
});
