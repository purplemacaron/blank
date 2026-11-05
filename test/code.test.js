'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const code = require('../src/core/code');

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'blank-code-'));

function hasGit() {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

test.after(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

test('detectChecks reads package scripts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blank-checks-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'demo',
    scripts: { test: 'node --test', lint: 'eslint .', build: 'vite build', custom: 'echo hi' },
  }));
  try {
    const checks = code.detectChecks(dir);
    assert.deepEqual(checks.map((check) => check.id), ['test', 'lint', 'build']);
    assert.equal(checks[0].command, 'npm run test');
    assert.ok(fs.existsSync(path.join(dir, 'package.json')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('overview reports languages and a clean non-repository workspace', async () => {
  fs.writeFileSync(path.join(workspace, 'main.rs'), 'fn main() {}');
  fs.writeFileSync(path.join(workspace, 'main.py'), 'print("hi")');
  fs.writeFileSync(path.join(workspace, 'Dockerfile'), 'FROM node:22');
  const overview = await code.overview(workspace);
  assert.equal(overview.exists, true);
  assert.ok(overview.files >= 3);
  assert.ok(overview.languages.some((entry) => entry.name === 'Rust'));
  assert.ok(overview.languages.some((entry) => entry.name === 'Python'));
  assert.equal(overview.git.isRepo, false);
});

test('gitStatus and gitDiff expose changes and untracked files', { skip: !hasGit() }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blank-git-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Blank Test'], { cwd: dir });
    fs.writeFileSync(path.join(dir, 'app.js'), 'const a = 1;\n');
    execFileSync('git', ['add', 'app.js'], { cwd: dir });
    execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir });
    fs.writeFileSync(path.join(dir, 'app.js'), 'const a = 2;\n');
    fs.writeFileSync(path.join(dir, 'new.js'), 'const b = 3;\n');

    const status = await code.gitStatus(dir);
    assert.equal(status.isRepo, true);
    assert.equal(status.counts.changed, 1);
    assert.equal(status.counts.untracked, 1);
    assert.ok(status.files.some((file) => file.path === 'new.js' && file.status === 'untracked'));

    const diff = await code.gitDiff(dir, { file: 'new.js' });
    assert.equal(diff.untracked, true);
    assert.equal(diff.error, '');
    assert.match(diff.diff, /\+const b = 3;/);

    const modified = await code.gitDiff(dir, { file: 'app.js' });
    assert.match(modified.diff, /-const a = 1;/);
    assert.match(modified.diff, /\+const a = 2;/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
