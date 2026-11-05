'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runConsoleCommand, stripAnsi } = require('../src/core/console');

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'blank-console-'));

test.after(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

test('stripAnsi removes colour codes and normalises newlines', () => {
  assert.equal(stripAnsi('\u001b[31mred\u001b[0m\r\nnext'), 'red\nnext');
  assert.equal(stripAnsi('plain'), 'plain');
});

test('a command runs inside the workspace and reports output', async () => {
  const command = process.platform === 'win32' ? 'echo blank-console' : 'printf "blank-console\\n"';
  const result = await runConsoleCommand({ workspace, command });
  assert.equal(result.ok, true);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /blank-console/);
  assert.equal(result.cwd, workspace);
  assert.equal(result.stderr, '');
  assert.equal(result.timedOut, false);
  assert.ok(result.durationMs >= 0);
});

test('empty commands fail without spawning', async () => {
  const result = await runConsoleCommand({ workspace, command: '   ' });
  assert.equal(result.ok, false);
  assert.match(result.error, /enter a command/i);
});

test('a failing command returns its exit code and stderr', async () => {
  const command = process.platform === 'win32'
    ? 'echo console-error 1>&2 && exit /b 3'
    : 'printf "console-error\\n" >&2; exit 3';
  const result = await runConsoleCommand({ workspace, command });
  assert.equal(result.ok, false);
  assert.equal(result.code, 3);
  assert.match(result.stderr, /console-error/);
});

test('output is capped at the requested size', async () => {
  const command = process.platform === 'win32' ? 'for /L %i in (1,1,200) do @echo aaaaaaaaaaaaaaaaaaaa' : 'yes aaaaaaaaaaaaaaaaaaaa | head -n 200';
  const result = await runConsoleCommand({ workspace, command, maxBytes: 4000 });
  assert.equal(result.truncated, true);
  assert.ok(result.stdout.length <= 4000);
});
