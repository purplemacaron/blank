'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const bin = path.join(__dirname, '..', 'bin', 'blank.js');

function runCli(args, { input = '', home } = {}) {
  const env = {
    ...process.env,
    BLANK_HOME: home,
    NO_COLOR: '1',
  };
  delete env.NO_TUI;
  delete env.BLANK_NO_TUI;
  return spawnSync(process.execPath, [bin, ...args], {
    input,
    env,
    cwd: os.tmpdir(),
    encoding: 'utf8',
    timeout: 30000,
  });
}

function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'blank-cli-'));
}

test('--help documents the TUI and the plain fallback', () => {
  const home = tempHome();
  try {
    const result = runCli(['--help'], { home });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /full-screen TUI/);
    assert.match(result.stdout, /--plain/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('piped sessions use the plain CLI and can run slash commands', () => {
  const home = tempHome();
  try {
    const input = ['/help', '/mode design', '/config', '/exit'].join('\n') + '\n';
    const result = runCli(['--plain'], { home, input });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /\/help/);
    assert.match(result.stdout, /mode → design/);
    assert.match(result.stdout, /permissions/);
    assert.strictEqual(result.stdout.includes('\u001b[?1049h'), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('a piped TTY-less run falls back without alternate-screen escapes', () => {
  const home = tempHome();
  try {
    const result = runCli([], { home, input: '/exit\n' });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.stdout.includes('\u001b[?1049h'), false);
    assert.match(result.stdout, /bye/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
