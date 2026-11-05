'use strict';

/**
 * Coding toolkit: workspace overview, git review and check detection. These
 * functions are shared by the Code page, the IPC layer and the agent tools, so
 * the page and the model always see the same view of the repository.
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { runConsoleCommand } = require('./console');

const IGNORE = new Set([
  'node_modules', '.git', '.hg', '.svn', '.idea', '.vscode', 'dist', 'build', 'out', '.next',
  '.nuxt', '.cache', 'target', '__pycache__', '.venv', 'venv', '.blank', 'coverage', '.turbo',
]);

const LANGUAGES = {
  '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.mts': 'TypeScript', '.cts': 'TypeScript',
  '.py': 'Python', '.rb': 'Ruby', '.go': 'Go', '.rs': 'Rust', '.java': 'Java', '.kt': 'Kotlin',
  '.kts': 'Kotlin', '.swift': 'Swift', '.m': 'Objective-C', '.mm': 'Objective-C',
  '.c': 'C', '.h': 'C', '.cc': 'C++', '.cpp': 'C++', '.hpp': 'C++', '.cs': 'C#', '.php': 'PHP',
  '.sh': 'Shell', '.bash': 'Shell', '.zsh': 'Shell', '.fish': 'Shell', '.ps1': 'PowerShell',
  '.lua': 'Lua', '.r': 'R', '.dart': 'Dart', '.scala': 'Scala', '.ex': 'Elixir', '.exs': 'Elixir',
  '.erl': 'Erlang', '.clj': 'Clojure', '.hs': 'Haskell', '.ml': 'OCaml', '.zig': 'Zig',
  '.jl': 'Julia', '.pl': 'Perl', '.sql': 'SQL', '.css': 'CSS', '.scss': 'SCSS', '.sass': 'Sass',
  '.less': 'Less', '.html': 'HTML', '.htm': 'HTML', '.vue': 'Vue', '.svelte': 'Svelte',
  '.astro': 'Astro', '.json': 'JSON', '.yml': 'YAML', '.yaml': 'YAML', '.toml': 'TOML',
  '.md': 'Markdown', '.mdx': 'MDX', '.svg': 'SVG', '.graphql': 'GraphQL', '.gql': 'GraphQL',
  '.tf': 'Terraform', '.nix': 'Nix', '.proto': 'Protobuf', '.sol': 'Solidity',
};

const CHECK_SCRIPTS = [
  ['test', 'Test'],
  ['lint', 'Lint'],
  ['typecheck', 'Typecheck'],
  ['type-check', 'Typecheck'],
  ['tsc', 'Typecheck'],
  ['check', 'Check'],
  ['build', 'Build'],
];

const MAX_FILES = 4000;

function git(workspace, args, timeout = 20_000) {
  return new Promise((resolve) => {
    execFile('git', args, {
      cwd: workspace,
      timeout,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
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

function parseGitStatus(stdout) {
  const result = { branch: '', upstream: '', ahead: 0, behind: 0, files: [], counts: { changed: 0, staged: 0, untracked: 0, conflicted: 0 } };
  const lines = String(stdout || '').split('\n').filter(Boolean);
  for (const line of lines) {
    if (line.startsWith('## ')) {
      const head = line.slice(3).trim();
      const branchPart = head.split('...')[0].trim();
      result.branch = branchPart === 'HEAD (no branch)' ? 'detached HEAD' : branchPart;
      if (head.includes('...')) result.upstream = head.split('...')[1].split(' [')[0].trim();
      const ahead = /ahead (\d+)/.exec(head);
      const behind = /behind (\d+)/.exec(head);
      if (ahead) result.ahead = Number(ahead[1]);
      if (behind) result.behind = Number(behind[1]);
      continue;
    }
    const code = line.slice(0, 2);
    const rawPath = line.slice(3).trim();
    const filePath = rawPath.includes(' -> ') ? rawPath.split(' -> ').pop() : rawPath;
    const entry = { code, path: filePath };
    if (code === '??') {
      entry.status = 'untracked';
      result.counts.untracked += 1;
    } else if (code.includes('U') || code === 'AA' || code === 'DD') {
      entry.status = 'conflicted';
      result.counts.conflicted += 1;
    } else {
      entry.status = code[0] !== ' ' ? 'staged' : 'modified';
      if (code[0] !== ' ') result.counts.staged += 1;
      result.counts.changed += 1;
    }
    result.files.push(entry);
  }
  return result;
}

async function gitStatus(workspace) {
  if (!workspace) return { isRepo: false, error: 'Open a workspace folder first.' };
  const inside = await git(workspace, ['rev-parse', '--is-inside-work-tree']);
  if (!inside.ok || inside.stdout.trim() !== 'true') {
    return { isRepo: false, root: '', error: inside.error || 'This folder is not a git repository.' };
  }
  const [status, root] = await Promise.all([
    git(workspace, ['status', '--porcelain=v1', '-b']),
    git(workspace, ['rev-parse', '--show-toplevel']),
  ]);
  const parsed = parseGitStatus(status.stdout);
  return {
    isRepo: true,
    root: root.stdout.trim() || workspace,
    branch: parsed.branch,
    upstream: parsed.upstream,
    ahead: parsed.ahead,
    behind: parsed.behind,
    files: parsed.files.slice(0, 200),
    totalFiles: parsed.files.length,
    counts: parsed.counts,
    error: status.ok ? '' : status.error,
  };
}

async function gitDiff(workspace, { file = '', staged = false, maxBytes = 160_000 } = {}) {
  if (!workspace) throw new Error('Open a workspace folder first.');
  const args = ['diff', '--no-color'];
  if (staged) args.push('--cached');
  if (file) args.push('--', String(file));
  const diff = await git(workspace, args, 30_000);
  if (!diff.ok && diff.error) {
    return { diff: '', file, staged, truncated: false, error: diff.error };
  }
  let raw = diff.stdout;
  let untracked = false;
  if (!raw.trim() && file) {
    // Untracked files have no diff; show their content instead.
    const status = await gitStatus(workspace);
    const entry = status.files?.find((item) => item.path === file && item.status === 'untracked');
    if (entry) {
      try {
        const full = path.join(workspace, file);
        const stat = fs.statSync(full);
        if (stat.size > 400_000) throw new Error('File is too large to preview.');
        const content = fs.readFileSync(full, 'utf8');
        raw = content.split('\n').map((line) => `+${line}`).join('\n');
        untracked = true;
      } catch (err) {
        return { diff: '', file, staged: false, untracked: true, truncated: false, error: err.message };
      }
    }
  }
  const truncated = raw.length > maxBytes;
  return {
    diff: truncated ? raw.slice(0, maxBytes) : raw,
    file,
    staged,
    untracked,
    truncated,
    error: '',
  };
}

function listSourceFiles(workspace) {
  const out = [];
  function walk(dir, depth) {
    if (out.length >= MAX_FILES || depth > 8) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (out.length >= MAX_FILES) break;
      if (entry.name.startsWith('.') && entry.name !== '.blank') continue;
      if (IGNORE.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.isFile()) out.push(full);
    }
  }
  walk(workspace, 1);
  return out;
}

function detectPackage(workspace) {
  const file = path.join(workspace, 'package.json');
  if (!fs.existsSync(file)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      name: String(data.name || ''),
      version: String(data.version || ''),
      scripts: data.scripts && typeof data.scripts === 'object' ? data.scripts : {},
      dependencies: Object.keys(data.dependencies || {}),
      devDependencies: Object.keys(data.devDependencies || {}),
    };
  } catch {
    return null;
  }
}

function detectManager(workspace) {
  if (fs.existsSync(path.join(workspace, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(workspace, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(workspace, 'bun.lockb')) || fs.existsSync(path.join(workspace, 'bun.lock'))) return 'bun';
  return 'npm';
}

function detectChecks(workspace) {
  const pkg = detectPackage(workspace);
  if (!pkg) return [];
  const manager = detectManager(workspace);
  const out = [];
  for (const [script, label] of CHECK_SCRIPTS) {
    if (!pkg.scripts[script]) continue;
    if (out.some((check) => check.script === script)) continue;
    const command = manager === 'npm' ? `npm run ${script}` : `${manager} run ${script}`;
    out.push({ id: script, label, script, command, manager, hint: String(pkg.scripts[script]).slice(0, 160) });
  }
  return out;
}

async function runCheck(workspace, id) {
  const checks = detectChecks(workspace);
  const check = checks.find((entry) => entry.id === id || entry.script === id);
  if (!check) throw new Error('That check is not defined in package.json.');
  const result = await runConsoleCommand({ workspace, command: check.command, timeout: 300_000 });
  return { ...result, check };
}

async function overview(workspace) {
  if (!workspace) {
    return { workspace: '', exists: false, files: 0, languages: [], package: null, checks: [], git: { isRepo: false, error: 'Open a workspace folder first.' } };
  }
  const files = listSourceFiles(workspace);
  const counts = new Map();
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    const language = LANGUAGES[ext];
    if (language) counts.set(language, (counts.get(language) || 0) + 1);
  }
  const languages = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([name, count]) => ({ name, count }));
  const pkg = detectPackage(workspace);
  const [gitState] = await Promise.all([gitStatus(workspace)]);
  return {
    workspace,
    exists: fs.existsSync(workspace),
    files: files.length,
    languages,
    package: pkg ? { name: pkg.name, version: pkg.version, scripts: Object.keys(pkg.scripts).slice(0, 24), dependencies: pkg.dependencies.length, devDependencies: pkg.devDependencies.length } : null,
    checks: detectChecks(workspace),
    git: gitState,
  };
}

async function projectMapText(workspace, data = null) {
  const info = data || (await overview(workspace));
  return formatMap(workspace, info);
}

function formatMap(workspace, info) {
  const lines = [`Workspace: ${workspace || '(none)'}`];
  if (info.git?.isRepo) {
    lines.push(`Git: ${info.git.branch || 'detached'}${info.git.ahead ? ` · ahead ${info.git.ahead}` : ''}${info.git.behind ? ` · behind ${info.git.behind}` : ''}`);
    const counts = info.git.counts || {};
    lines.push(`Changes: ${counts.changed || 0} modified · ${counts.staged || 0} staged · ${counts.untracked || 0} untracked${counts.conflicted ? ` · ${counts.conflicted} conflicted` : ''}`);
    const files = (info.git.files || []).slice(0, 24);
    if (files.length) lines.push('Changed files:', ...files.map((file) => `- [${file.status}] ${file.path}`));
    if (info.git.totalFiles > files.length) lines.push(`…and ${info.git.totalFiles - files.length} more.`);
  } else {
    lines.push(`Git: ${info.git?.error || 'not a repository'}`);
  }
  lines.push(`Files: ${info.files || 0}`);
  if (info.languages?.length) lines.push(`Languages: ${info.languages.map((item) => `${item.name} ${item.count}`).join(' · ')}`);
  if (info.package) {
    lines.push(`Package: ${info.package.name || 'unnamed'}${info.package.version ? `@${info.package.version}` : ''} · ${info.package.dependencies} dependencies · ${info.package.devDependencies} dev`);
    if (info.package.scripts?.length) lines.push(`Scripts: ${info.package.scripts.join(', ')}`);
  }
  if (info.checks?.length) lines.push(`Checks: ${info.checks.map((check) => `${check.label} (${check.command})`).join(' · ')}`);
  return lines.join('\n');
}

module.exports = {
  LANGUAGES,
  gitStatus,
  gitDiff,
  detectChecks,
  detectPackage,
  runCheck,
  overview,
  projectMapText,
  parseGitStatus,
  listSourceFiles,
};
