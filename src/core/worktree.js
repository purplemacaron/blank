'use strict';

/**
 * Git worktrees for isolated coding sessions.
 *
 * blank creates linked worktrees under ~/.blank/worktrees and only removes
 * worktrees it created there. The branch is never deleted: unmerged work stays
 * recoverable after the worktree is removed.
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { appPaths, ensureHome } = require('./paths');

const BRANCH_PREFIX = 'blank/';
const MAX_NAME = 40;
const isWin = process.platform === 'win32';

function git(cwd, args, timeout = 20_000) {
  return new Promise((resolve) => {
    execFile('git', args, {
      cwd,
      timeout,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' },
    }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
        error: error ? String(stderr || error.message || 'git failed').trim().slice(0, 800) : '',
      });
    });
  });
}

function samePath(a, b) {
  if (!a || !b) return false;
  const left = path.resolve(String(a));
  const right = path.resolve(String(b));
  return isWin ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function sanitizeName(raw) {
  const name = String(raw || '').trim().toLowerCase();
  if (!name) throw new Error('Name the worktree first.');
  if (name.length > MAX_NAME) throw new Error(`Keep the name under ${MAX_NAME} characters.`);
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) {
    throw new Error('Use lowercase letters, numbers, dots, dashes or underscores.');
  }
  if (name.includes('..') || name.endsWith('.lock')) throw new Error('That name is not allowed.');
  return name;
}

function worktreeRoot() {
  ensureHome();
  const dir = path.join(appPaths().root, 'worktrees');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function isManaged(target) {
  if (!target) return false;
  const root = path.resolve(worktreeRoot());
  const resolved = path.resolve(String(target));
  const prefix = root + path.sep;
  return isWin
    ? resolved.toLowerCase().startsWith(prefix.toLowerCase())
    : resolved.startsWith(prefix);
}

function parsePorcelain(text) {
  const items = [];
  let current = null;
  const flush = () => { if (current) { items.push(current); current = null; } };
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) { flush(); continue; }
    const space = line.indexOf(' ');
    const key = space === -1 ? line : line.slice(0, space);
    const value = space === -1 ? '' : line.slice(space + 1);
    if (key === 'worktree') {
      flush();
      current = { path: value, head: '', branch: '', detached: false, bare: false, locked: false, prunable: false };
      continue;
    }
    if (!current) continue;
    if (key === 'HEAD') current.head = value;
    else if (key === 'branch') current.branch = value.replace(/^refs\/heads\//, '');
    else if (key === 'detached') current.detached = true;
    else if (key === 'bare') current.bare = true;
    else if (key === 'locked') { current.locked = true; current.lockReason = value; }
    else if (key === 'prunable') current.prunable = true;
  }
  flush();
  return items;
}

async function context(workspace) {
  if (!workspace) return { isRepo: false, error: 'Open a workspace folder first.', root: '', branch: '', worktrees: [] };
  const inside = await git(workspace, ['rev-parse', '--is-inside-work-tree']);
  if (!inside.ok || inside.stdout.trim() !== 'true') {
    return { isRepo: false, error: 'This workspace is not a git repository.', root: '', branch: '', worktrees: [] };
  }
  const [rootResult, branchResult, list] = await Promise.all([
    git(workspace, ['rev-parse', '--show-toplevel']),
    git(workspace, ['rev-parse', '--abbrev-ref', 'HEAD']),
    git(workspace, ['worktree', 'list', '--porcelain']),
  ]);
  const root = rootResult.stdout.trim() || workspace;
  const worktrees = parsePorcelain(list.stdout).map((item) => ({
    ...item,
    managed: isManaged(item.path),
    current: samePath(item.path, workspace) || (!item.path && samePath(root, workspace)),
  }));
  return {
    isRepo: true,
    root,
    branch: branchResult.stdout.trim() === 'HEAD' ? '' : branchResult.stdout.trim(),
    current: worktrees.find((item) => item.current) || null,
    worktrees,
    error: '',
  };
}

async function list(workspace) {
  const info = await context(workspace);
  if (!info.isRepo) return info;
  return { ...info, managedRoot: worktreeRoot() };
}

async function create(workspace, { name } = {}) {
  const info = await context(workspace);
  if (!info.isRepo) throw new Error(info.error || 'Open a git repository first.');
  const slug = sanitizeName(name);
  const repo = path.basename(info.root).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'repo';
  const dir = path.join(worktreeRoot(), `${repo}-${slug}`.slice(0, 80));
  if (fs.existsSync(dir)) throw new Error('A worktree with that name already exists.');
  let branch = `${BRANCH_PREFIX}${slug}`;
  for (let attempt = 2; attempt < 60; attempt += 1) {
    const exists = await git(info.root, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
    if (!exists.ok) break;
    branch = `${BRANCH_PREFIX}${slug}-${attempt}`;
  }
  const added = await git(info.root, ['worktree', 'add', '-b', branch, dir, 'HEAD'], 120_000);
  if (!added.ok) throw new Error(added.error || 'Could not create the worktree.');
  return { path: dir, branch, root: info.root, workspace: dir };
}

async function switchTo(workspace, target) {
  const info = await context(workspace);
  if (!info.isRepo) throw new Error(info.error || 'Open a git repository first.');
  const resolved = String(target || '').trim();
  if (!resolved) throw new Error('Choose a worktree.');
  const entry = info.worktrees.find((item) => samePath(item.path, resolved));
  if (!entry) throw new Error('That path is not a worktree of this repository.');
  if (!fs.existsSync(entry.path)) throw new Error('That worktree folder is missing. Remove it to clean up the entry.');
  return { path: entry.path, branch: entry.branch, root: info.root };
}

async function remove(workspace, target, { force = false } = {}) {
  const info = await context(workspace);
  if (!info.isRepo) throw new Error(info.error || 'Open a git repository first.');
  const resolved = path.resolve(String(target || ''));
  if (!isManaged(resolved)) {
    throw new Error('blank only removes worktrees it created under its data folder. Remove other worktrees with git.');
  }
  const entry = info.worktrees.find((item) => samePath(item.path, resolved));
  if (!entry) throw new Error('That worktree is not registered in this repository.');
  if (samePath(resolved, workspace)) throw new Error('Switch back to the main workspace before removing this worktree.');
  const args = ['worktree', 'remove'];
  if (force) args.push('--force');
  args.push(resolved);
  const removed = await git(info.root, args, 60_000);
  if (!removed.ok) throw new Error(removed.error || 'Could not remove the worktree.');
  return { ...entry, removed: true };
}

async function summarize(target) {
  if (!target) return { changed: 0, files: [], branch: '' };
  const [status, branch] = await Promise.all([
    git(target, ['status', '--porcelain']),
    git(target, ['rev-parse', '--abbrev-ref', 'HEAD']),
  ]);
  const files = [...new Set((status.ok ? String(status.stdout).split('\n') : [])
    .map((line) => line.slice(3).trim())
    .filter(Boolean))];
  return {
    changed: files.length,
    files: files.slice(0, 60),
    branch: branch.stdout.trim() === 'HEAD' ? '' : branch.stdout.trim(),
  };
}

async function repoWorktrees(workspace) {
  const info = await context(workspace);
  if (!info.isRepo) return { root: '', entries: [] };
  return { root: info.root, entries: info.worktrees };
}

async function scan() {
  const root = worktreeRoot();
  let names = [];
  try { names = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }
  const entries = [];
  for (const dirent of names.slice(0, 100)) {
    if (!dirent.isDirectory()) continue;
    const target = path.join(root, dirent.name);
    if (!isManaged(target)) continue;
    if (!fs.existsSync(path.join(target, '.git'))) continue;
    const summary = await summarize(target);
    entries.push({
      path: target,
      name: dirent.name,
      managed: true,
      branch: summary.branch,
      changed: summary.changed,
      files: summary.files,
    });
  }
  return entries;
}

async function pruneEmpty(workspace) {
  const { entries } = await repoWorktrees(workspace);
  const managed = entries.filter((entry) => isManaged(entry.path) && fs.existsSync(entry.path));
  let removed = 0;
  let kept = 0;
  for (const entry of managed) {
    const summary = await summarize(entry.path);
    if (summary.changed > 0) { kept += 1; continue; }
    await remove(workspace, entry.path, { force: true });
    removed += 1;
  }
  return { removed, kept };
}

module.exports = {
  summarize,
  scan,
  pruneEmpty,
  BRANCH_PREFIX,
  sanitizeName,
  parsePorcelain,
  isManaged,
  samePath,
  worktreeRoot,
  context,
  list,
  create,
  switchTo,
  remove,
};
