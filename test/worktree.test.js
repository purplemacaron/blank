'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function gitAvailable() {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const hasGit = gitAvailable();

function tempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blank-worktree-'));
  const run = (...args) => execFileSync('git', ['-c', 'user.name=blank', '-c', 'user.email=blank@example.com', ...args], { cwd: dir, stdio: 'ignore' });
  run('init', '-q');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  run('add', 'a.txt');
  run('commit', '-q', '-m', 'init');
  return dir;
}

test('summarize reports changed files in a worktree', { skip: hasGit ? false : 'git is not installed' }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'blank-home-'));
  const previous = process.env.BLANK_HOME;
  process.env.BLANK_HOME = home;
  try {
    const repo = tempRepo();
    const worktree = require('../src/core/worktree');
    const made = await worktree.create(repo, { name: 'summarize' });
    assert.equal((await worktree.summarize(made.path)).changed, 0);
    fs.writeFileSync(path.join(made.path, 'a.txt'), 'two\n');
    fs.writeFileSync(path.join(made.path, 'b.txt'), 'new\n');
    const summary = await worktree.summarize(made.path);
    assert.equal(summary.changed, 2);
    assert.deepEqual(summary.files.sort(), ['a.txt', 'b.txt']);
    assert.match(summary.branch, /^blank\//);
  } finally {
    if (previous === undefined) delete process.env.BLANK_HOME;
    else process.env.BLANK_HOME = previous;
  }
});

test('pruneEmpty removes only untouched worktrees', { skip: hasGit ? false : 'git is not installed' }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'blank-home-'));
  const previous = process.env.BLANK_HOME;
  process.env.BLANK_HOME = home;
  try {
    const repo = tempRepo();
    const worktree = require('../src/core/worktree');
    const clean = await worktree.create(repo, { name: 'clean' });
    const dirty = await worktree.create(repo, { name: 'dirty' });
    fs.writeFileSync(path.join(dirty.path, 'a.txt'), 'changed\n');
    const entries = await worktree.scan();
    assert.equal(entries.length, 2);
    assert.ok(entries.every((entry) => entry.managed));
    const pruned = await worktree.pruneEmpty(repo);
    assert.equal(pruned.removed, 1);
    assert.equal(fs.existsSync(clean.path), false);
    assert.equal(fs.existsSync(dirty.path), true);
  } finally {
    if (previous === undefined) delete process.env.BLANK_HOME;
    else process.env.BLANK_HOME = previous;
  }
});
