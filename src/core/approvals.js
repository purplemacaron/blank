'use strict';

/**
 * Risk-based approvals.
 *
 * The default "important" mode lets routine local work run without a prompt:
 * ordinary file edits, builds, tests, formatting and read-only inspection.
 * It still asks before anything that is destructive, external, privileged,
 * costly or touches credentials. Unknown commands stay conservative.
 *
 * This is a policy heuristic, not a sandbox. The hard blocks in tools.js still
 * reject commands that can destroy the machine.
 */

const path = require('path');

const REASONS = {
  sensitiveFile: 'sensitive-file',
  sensitiveData: 'sensitive-data',
  destructive: 'destructive',
  external: 'external',
  network: 'network',
  install: 'install',
  privilege: 'privilege',
  system: 'system',
  write: 'write',
  unknown: 'unknown',
  remote: 'remote',
  policy: 'policy',
};

const SIMPLE_SAFE = new Set([
  'ls', 'dir', 'pwd', 'cat', 'type', 'head', 'tail', 'wc', 'stat', 'file', 'du', 'df', 'tree',
  'grep', 'rg', 'which', 'where', 'whereis', 'echo', 'printf', 'date', 'uname', 'whoami',
  'hostname', 'diff', 'cmp', 'sort', 'uniq', 'cut', 'tr', 'basename', 'dirname', 'realpath',
  'readlink', 'mkdir', 'touch', 'cp', 'ln', 'true', 'false', 'test', 'sleep', 'ps', 'id',
  'groups', 'locale', 'nproc', 'arch', 'journalctl', 'dmesg', 'uptime', 'free', 'lsof',
  'netstat', 'ss', 'ping', 'nslookup', 'dig', 'gofmt', 'prettier', 'black', 'sed', 'tee',
]);

const GIT_READ = new Set([
  'status', 'diff', 'log', 'show', 'rev-parse', 'ls-files', 'ls-tree', 'describe', 'blame',
  'shortlog', 'fetch', 'help', 'version',
]);

const GIT_LOCAL = new Set(['add', 'commit', 'init', 'remote', 'config', 'branch', 'tag', 'stash', 'worktree']);

const NPM_READ = new Set(['test', 't', 'ls', 'list', 'view', 'info', 'outdated', 'audit', 'why', 'root', 'prefix', 'bin']);
const NPM_INSTALL = new Set(['install', 'i', 'add', 'ci', 'update', 'upgrade', 'link', 'unlink', 'rebuild', 'dedupe']);
const NPM_EXTERNAL = new Set(['publish', 'unpublish', 'deprecate', 'owner', 'access', 'login', 'logout']);
const SAFE_SCRIPT = /^(test|tests|lint|build|check|typecheck|type-check|verify|validate|coverage|e2e|format|fmt)(:|$)/i;
const DEV_BINARIES = new Set([
  'tsc', 'eslint', 'prettier', 'vitest', 'jest', 'mocha', 'ava', 'vite', 'webpack', 'rollup',
  'esbuild', 'playwright', 'cypress', 'next', 'nuxt', 'astro', 'svelte-kit', 'remix',
]);

function normalized(filePath) {
  return String(filePath || '').replace(/\\/g, '/').toLowerCase();
}

function baseName(filePath) {
  return path.posix.basename(normalized(filePath));
}

function isSensitiveFile(filePath) {
  const full = normalized(filePath);
  const base = baseName(full);
  if (!base) return false;
  if (/^\.env\.(example|sample|template)$/.test(base)) return false;
  if (base === '.env' || base.startsWith('.env.')) return true;
  if (/^(id_rsa|id_dsa|id_ecdsa|id_ed25519)$/.test(base)) return true;
  if (/^(\.npmrc|\.pypirc|\.netrc|\.git-credentials|\.htpasswd)$/.test(base)) return true;
  if (/^(credentials|secrets?)(\.[a-z0-9]+)?$/.test(base)) return true;
  if (/\.(pem|key|p12|pfx|jks|keystore)$/.test(base)) return true;
  if (full.includes('/.ssh/') || full.endsWith('/.ssh')) return true;
  if (full.endsWith('/.git/config')) return true;
  return false;
}

function splitSegments(input) {
  const parts = [];
  let current = '';
  let quote = '';
  let substitution = false;
  const flush = () => {
    if (current.trim()) parts.push(current.trim());
    current = '';
  };
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];
    if (quote) {
      // Command and arithmetic substitution still runs inside double quotes.
      if (quote === '"' && (char === '`' || (char === '$' && next === '('))) substitution = true;
      current += char;
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === '`') substitution = true;
    if (char === '$' && next === '(') substitution = true;
    if (char === '&') {
      if (next === '&') {
        flush();
        index += 1;
        continue;
      }
      if (current.endsWith('>')) {
        current += char;
        continue;
      }
      flush();
      continue;
    }
    if (char === '|') {
      flush();
      if (next === '|') index += 1;
      continue;
    }
    if (char === ';' || char === '\n' || char === '\r') {
      flush();
      continue;
    }
    current += char;
  }
  flush();
  return { parts, substitution, unclosed: Boolean(quote) };
}

function tokenize(segment) {
  const tokens = [];
  let current = null;
  let quote = '';
  for (let index = 0; index < segment.length; index += 1) {
    const char = segment[index];
    if (quote) {
      if (char === quote) quote = '';
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      if (current === null) current = '';
      continue;
    }
    if (/\s/.test(char)) {
      if (current !== null) {
        tokens.push(current);
        current = null;
      }
      continue;
    }
    if (char === '>' || char === '<') {
      if (current !== null) {
        tokens.push(current);
        current = null;
      }
      let operator = char;
      if (segment[index + 1] === char) {
        operator += char;
        index += 1;
      }
      tokens.push(operator);
      continue;
    }
    if (current === null) current = '';
    current += char;
  }
  if (quote) return null;
  if (current !== null) tokens.push(current);
  return tokens;
}

function important(reason) {
  return { safe: false, reason };
}

function safe() {
  return { safe: true, reason: '' };
}

function outsideWorkspace(target) {
  if (!target) return false;
  if (/^[a-zA-Z]:[\\/]/.test(target)) return true;
  if (target.startsWith('~') || target.startsWith('/') || target.startsWith('\\\\')) return true;
  return target.split(/[\\/]/).includes('..');
}

function writeTargetRisk(target) {
  if (!target) return null;
  if (isSensitiveFile(target)) return REASONS.sensitiveFile;
  if (outsideWorkspace(target)) return REASONS.write;
  return null;
}

function redirectRisk(tokens) {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token !== '>' && token !== '>>') continue;
    const target = tokens[index + 1] || '';
    if (!target || /^&[0-9]+$/.test(target)) continue;
    if (/^(\/dev\/null|null|nul)$/i.test(target)) continue;
    const risk = writeTargetRisk(target);
    if (risk) return risk;
  }
  return null;
}

function argsWithoutOptions(args) {
  return args.filter((arg) => arg && !arg.startsWith('-'));
}

function lastTarget(args) {
  const values = argsWithoutOptions(args);
  return values.length ? values[values.length - 1] : '';
}

function classifyPackageManager(command, args) {
  const sub = String(args[0] || '').toLowerCase();
  if (!sub) return important(REASONS.install);
  if (['--version', '-v', '-h', '--help'].includes(sub)) return safe();
  if (NPM_INSTALL.has(sub)) return important(REASONS.install);
  if (NPM_EXTERNAL.has(sub)) return important(REASONS.external);
  if (sub === 'run' || sub === 'run-script') {
    const script = String(args[1] || '');
    if (SAFE_SCRIPT.test(script)) return safe();
    if (/^(dev|start|serve|watch|preview)$/i.test(script)) return important(REASONS.system);
    return important(REASONS.unknown);
  }
  if (NPM_READ.has(sub)) return safe();
  if ((command === 'yarn' || command === 'pnpm') && SAFE_SCRIPT.test(sub)) return safe();
  if (command === 'bun' && ['test', 'build', 'pm'].includes(sub)) {
    return sub === 'pm' ? important(REASONS.install) : safe();
  }
  return important(REASONS.unknown);
}

function classifyGit(args) {
  const sub = String(args[0] || '').toLowerCase();
  if (!sub) return safe();
  if (['--version', '--help', 'version', 'help'].includes(sub)) return safe();
  if (GIT_READ.has(sub)) return safe();
  if (sub === 'push' || sub === 'pull' || sub === 'clone' || sub === 'submodule' || sub === 'lfs') {
    return important(REASONS.external);
  }
  if (['reset', 'clean', 'checkout', 'restore', 'rebase', 'merge', 'cherry-pick', 'revert', 'apply', 'am', 'filter-branch'].includes(sub)) {
    return important(REASONS.destructive);
  }
  if (GIT_LOCAL.has(sub)) {
    if (sub === 'branch' && args.some((arg) => arg === '-D' || arg === '-d' || arg === '--delete')) {
      return important(REASONS.destructive);
    }
    if (sub === 'tag' && args.some((arg) => arg === '-d' || arg === '--delete')) {
      return important(REASONS.destructive);
    }
    if (sub === 'stash' && args.some((arg) => arg === 'drop' || arg === 'clear')) {
      return important(REASONS.destructive);
    }
    if (sub === 'worktree' && args.some((arg) => arg === 'remove' || arg === 'prune')) {
      return important(REASONS.destructive);
    }
    return safe();
  }
  return important(REASONS.destructive);
}

function classifyPython(args) {
  const first = String(args[0] || '');
  if (first === '--version' || first === '-V' || first === '-h' || first === '--help') return safe();
  if (first === '-m') {
    const module = String(args[1] || '').toLowerCase();
    if (['pytest', 'unittest', 'compileall', 'py_compile', 'ruff', 'mypy', 'flake8', 'black'].includes(module)) {
      if (module === 'pip') return important(REASONS.install);
      return safe();
    }
    return important(REASONS.unknown);
  }
  return important(REASONS.unknown);
}

function classifyNode(args) {
  const first = String(args[0] || '');
  if (['--version', '-v', '-h', '--help'].includes(first)) return safe();
  if (first === '--test' || first.startsWith('--test=')) return safe();
  return important(REASONS.unknown);
}

function classifyNpx(args) {
  const binary = String(args[0] || '').toLowerCase();
  if (!DEV_BINARIES.has(binary)) return important(REASONS.unknown);
  if (args.some((arg) => /^(install|add|dlx|create)$/i.test(arg))) return important(REASONS.install);
  if (args.some((arg) => /^(dev|start|preview)$/i.test(arg))) return important(REASONS.system);
  return safe();
}

function classifyDocker(args) {
  const sub = String(args[0] || '').toLowerCase();
  if (!sub) return important(REASONS.unknown);
  if (['ps', 'images', 'logs', 'inspect', 'version', 'info', 'stats', 'top', 'port'].includes(sub)) return safe();
  if (sub === 'compose' || sub === 'container' || sub === 'image' || sub === 'volume' || sub === 'network') {
    const action = String(args[1] || '').toLowerCase();
    if (['ps', 'ls', 'logs', 'config', 'images', 'inspect'].includes(action)) return safe();
    if (['build'].includes(action)) return safe();
    return important(REASONS.system);
  }
  if (sub === 'build') return safe();
  return important(REASONS.system);
}

function classifySystem(args) {
  const sub = String(args[0] || '').toLowerCase();
  if (['status', 'is-active', 'is-enabled', 'is-failed', 'show', 'list-units', 'list-unit-files', 'cat'].includes(sub)) return safe();
  return important(REASONS.system);
}

function classifyDevTool(command, args) {
  if (command === 'playwright') {
    return String(args[0] || '') === 'test' ? safe() : important(REASONS.install);
  }
  if (command === 'cypress') {
    return String(args[0] || '') === 'run' ? safe() : important(REASONS.system);
  }
  if (['vite', 'next', 'nuxt', 'astro'].includes(command)) {
    const sub = String(args[0] || '').toLowerCase();
    if (sub === 'build' || sub === 'test') return safe();
    return important(REASONS.system);
  }
  return safe();
}

function classifyCargo(args) {
  const sub = String(args[0] || '').toLowerCase();
  if (['test', 'check', 'build', 'clippy', 'fmt', 'metadata', 'tree', 'bench', 'doc'].includes(sub)) return safe();
  if (['add', 'install', 'publish', 'update'].includes(sub)) return important(REASONS.install);
  if (sub === 'run') return important(REASONS.system);
  return important(REASONS.unknown);
}

function classifyGo(args) {
  const sub = String(args[0] || '').toLowerCase();
  if (['test', 'build', 'vet', 'list', 'env', 'version', 'fmt', 'doc'].includes(sub)) return safe();
  if (['get', 'install', 'mod'].includes(sub)) return important(REASONS.install);
  if (sub === 'run' || sub === 'generate') return important(REASONS.system);
  return important(REASONS.unknown);
}

function classifyTokens(rawTokens) {
  let tokens = rawTokens.slice();
  while (tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) tokens.shift();
  if (!tokens.length) return safe();

  const redirect = redirectRisk(tokens);
  if (redirect) return important(redirect);

  const rawCommand = tokens[0].replace(/^["']|["']$/g, '');
  const command = path.posix.basename(rawCommand.replace(/\\/g, '/')).toLowerCase();
  const args = tokens.slice(1);

  if (!command) return safe();
  if (args.some((arg) => /\$\{?[A-Za-z0-9_]*(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)[A-Za-z0-9_]*\}?/i.test(arg))) {
    return important(REASONS.sensitiveData);
  }
  if (['sudo', 'doas', 'runas'].includes(command)) return important(REASONS.privilege);
  if (['time', 'command', 'builtin'].includes(command)) return classifyTokens(tokens.slice(1));
  if (['eval', 'exec', 'source', '.'].includes(command)) return important(REASONS.unknown);
  if (['bash', 'sh', 'zsh', 'fish', 'cmd', 'powershell', 'pwsh', 'wsl'].includes(command)) {
    if (args.some((arg) => arg === '--version' || arg === '-v')) return safe();
    return important(REASONS.unknown);
  }
  if (['xargs', 'parallel', 'awk', 'gawk', 'env', 'printenv', 'set'].includes(command)) {
    return important(command === 'env' || command === 'printenv' || command === 'set' ? REASONS.sensitiveData : REASONS.unknown);
  }
  if (['rm', 'rmdir', 'rd', 'del', 'erase', 'mv', 'move', 'ren', 'rename'].includes(command)) {
    return important(REASONS.destructive);
  }
  if (['kill', 'killall', 'pkill', 'taskkill'].includes(command)) return important(REASONS.destructive);
  if (['chmod', 'chown', 'chgrp', 'takeown', 'icacls', 'attrib'].includes(command)) {
    return important(REASONS.privilege);
  }
  if (['mount', 'umount', 'diskpart', 'mkfs', 'format', 'shutdown', 'reboot', 'poweroff'].includes(command)) {
    return important(REASONS.privilege);
  }
  if (['curl', 'wget'].includes(command)) return important(REASONS.network);
  if (['ssh', 'scp', 'sftp', 'rsync', 'ftp'].includes(command)) return important(REASONS.external);
  if (['git'].includes(command)) return classifyGit(args);
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(command)) return classifyPackageManager(command, args);
  if (command === 'npx') return classifyNpx(args);
  if (['pip', 'pip3', 'conda', 'uv', 'poetry'].includes(command)) {
    const sub = String(args[0] || '').toLowerCase();
    if (['list', 'show', 'freeze', '--version', '-v', 'check'].includes(sub)) return safe();
    if (['install', 'add', 'sync', 'update', 'upgrade', 'remove', 'uninstall'].includes(sub)) return important(REASONS.install);
    return important(REASONS.unknown);
  }
  if (['python', 'python3', 'py'].includes(command)) return classifyPython(args);
  if (command === 'pytest') return safe();
  if (command === 'node') return classifyNode(args);
  if (['tsc', 'eslint', 'vitest', 'jest', 'mocha', 'ava'].includes(command)) return safe();
  if (DEV_BINARIES.has(command)) return classifyDevTool(command, args);
  if (command === 'cargo') return classifyCargo(args);
  if (command === 'go') return classifyGo(args);
  if (['rustc', 'make', 'cmake', 'ninja', 'gcc', 'g++', 'clang', 'clang++'].includes(command)) {
    return important(REASONS.unknown);
  }
  if (['dotnet', 'gradle', 'gradlew', 'mvn'].includes(command)) {
    const sub = String(args[0] || '').toLowerCase();
    return ['test', 'build', 'check', 'restore'].includes(sub) ? safe() : important(REASONS.unknown);
  }
  if (command === 'docker') return classifyDocker(args);
  if (['systemctl', 'service', 'sc', 'launchctl'].includes(command)) return classifySystem(args);
  if (['gh'].includes(command)) {
    const sub = String(args[0] || '').toLowerCase();
    if (['pr', 'issue', 'run', 'release', 'repo', 'workflow'].includes(sub)) {
      const action = String(args[1] || '').toLowerCase();
      if (['view', 'diff', 'checks', 'list', 'status', 'logs'].includes(action)) return safe();
    }
    return important(REASONS.external);
  }
  if (['terraform', 'tofu', 'kubectl', 'helm', 'aws', 'gcloud', 'az', 'firebase', 'vercel', 'netlify', 'flyctl', 'heroku', 'wrangler'].includes(command)) {
    return important(REASONS.external);
  }
  if (['brew', 'apt', 'apt-get', 'dnf', 'yum', 'pacman', 'winget', 'choco', 'scoop'].includes(command)) {
    const sub = String(args[0] || '').toLowerCase();
    if (['list', 'search', 'info', 'show', '--version', '-v'].includes(sub)) return safe();
    return important(REASONS.install);
  }
  if (SIMPLE_SAFE.has(command)) {
    if (command === 'find' && args.some((arg) => ['-delete', '-exec', '-execdir', '-ok', '-okdir', '-fprint', '-fprintf'].includes(arg))) {
      return important(REASONS.destructive);
    }
    if (command === 'sort' && args.some((arg) => arg === '-o')) {
      const risk = writeTargetRisk(lastTarget(args));
      if (risk) return important(risk);
    }
    if (command === 'sed' && args.some((arg) => arg === '-i' || arg === '--in-place' || arg.startsWith('-i'))) {
      const risk = writeTargetRisk(argsWithoutOptions(args).pop() || '');
      if (risk) return important(risk);
    }
    if (['cp', 'ln', 'tee', 'mkdir', 'touch'].includes(command)) {
      for (const target of argsWithoutOptions(args)) {
        const risk = writeTargetRisk(target);
        if (risk) return important(risk);
      }
    }
    return safe();
  }
  return important(REASONS.unknown);
}

function assessCommand(command) {
  const text = String(command || '').trim();
  if (!text) return { level: 'allow', reason: '' };
  const split = splitSegments(text);
  if (split.substitution || split.unclosed) return { level: 'ask', reason: REASONS.unknown };
  for (const segment of split.parts) {
    const tokens = tokenize(segment);
    if (!tokens) return { level: 'ask', reason: REASONS.unknown };
    const result = classifyTokens(tokens);
    if (!result.safe) return { level: 'ask', reason: result.reason || REASONS.unknown };
  }
  return { level: 'allow', reason: '' };
}

function assessToolCall(name, args = {}) {
  if (name === 'write_file' || name === 'edit_file') {
    if (isSensitiveFile(args.path)) return { level: 'ask', reason: REASONS.sensitiveFile };
    return { level: 'allow', reason: '' };
  }
  if (name === 'deliver_file') return { level: 'allow', reason: '' };
  if (name === 'run_command') return assessCommand(args.command);
  if (name === 'ssh_run') {
    const result = assessCommand(args.command);
    if (result.level === 'allow') return { level: 'allow', reason: '' };
    return { level: 'ask', reason: REASONS.remote };
  }
  return null;
}

function commandApprovalKey(name, args = {}) {
  if (name === 'ssh_run') {
    return `ssh_run\u0000${String(args.host || '').trim()}\u0000${String(args.command || '').trim()}`;
  }
  return `run_command\u0000${String(args.command || '').trim()}`;
}

function fileApprovalKey(args = {}) {
  return String(args.path || '').trim();
}

function hasExactApproval(session, name, args = {}) {
  if (name === 'run_command' || name === 'ssh_run') {
    return Boolean(session?.allowCommands?.includes(commandApprovalKey(name, args)));
  }
  if (name === 'write_file' || name === 'edit_file') {
    return Boolean(session?.allowFiles?.includes(fileApprovalKey(args)));
  }
  return false;
}

/**
 * Remember an "Always allow" decision. Commands and credential files are
 * remembered by exact call, never as a blanket tool permission.
 */
function grantSessionApproval(session, request = {}) {
  if (!session) return 'none';
  const tool = String(request.tool || '');
  const args = request.args && typeof request.args === 'object' ? request.args : {};
  if (tool === 'run_command' || tool === 'ssh_run') {
    session.allowCommands = [...new Set([...(session.allowCommands || []), commandApprovalKey(tool, args)])];
    return 'command';
  }
  if ((tool === 'write_file' || tool === 'edit_file') && request.reason === REASONS.sensitiveFile) {
    session.allowFiles = [...new Set([...(session.allowFiles || []), fileApprovalKey(args)])];
    return 'file';
  }
  session.allowTools = [...new Set([...(session.allowTools || []), tool])];
  return 'tool';
}

module.exports = {
  assessToolCall,
  assessCommand,
  isSensitiveFile,
  splitSegments,
  commandApprovalKey,
  fileApprovalKey,
  hasExactApproval,
  grantSessionApproval,
  REASONS,
};
