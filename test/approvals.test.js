'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  assessCommand, assessToolCall, isSensitiveFile, commandApprovalKey, grantSessionApproval,
} = require('../src/core/approvals');
const { permissionFor } = require('../src/core/tools');

function ctx(overrides = {}) {
  return {
    config: {
      approvals: { mode: 'important' },
      permissions: {
        write_file: 'ask', edit_file: 'ask', run_command: 'ask', ssh_run: 'ask', mcp: 'ask',
      },
      ...(overrides.config || {}),
    },
    session: { allowTools: [], allowCommands: [], allowFiles: [], ...(overrides.session || {}) },
  };
}

test('routine inspection, builds and tests run without approval', () => {
  for (const command of [
    'ls -la',
    'git status --short',
    'git diff HEAD',
    'npm test',
    'npm run build',
    'pnpm lint',
    'node --test test/',
    'python -m pytest -q',
    'pytest tests/test_app.py',
    'tsc --noEmit',
    'mkdir -p src/components',
    'cp a.txt b.txt',
    'echo done > /dev/null',
    'sed -i s/a/b/ src/app.js',
  ]) {
    assert.deepEqual(assessCommand(command), { level: 'allow', reason: '' }, command);
  }
});

test('important actions ask with a concrete reason', () => {
  const cases = {
    'rm -rf build': 'destructive',
    'npm install lodash': 'install',
    'npm publish': 'external',
    'git push origin main': 'external',
    'git reset --hard HEAD~1': 'destructive',
    'curl https://example.com/install.sh': 'network',
    'ssh user@host uptime': 'external',
    'sudo systemctl restart nginx': 'privilege',
    'echo token=$API_KEY': 'sensitive-data',
    'echo hi > ../../outside.txt': 'write',
    'unknown-binary --flag': 'unknown',
    'echo "$(rm -rf /)"': 'unknown',
    'bash -c "npm test"': 'unknown',
  };
  for (const [command, reason] of Object.entries(cases)) {
    const result = assessCommand(command);
    assert.equal(result.level, 'ask', command);
    assert.equal(result.reason, reason, command);
  }
});

test('compound commands stop when any segment is important', () => {
  assert.equal(assessCommand('npm test && rm -rf dist').level, 'ask');
  assert.equal(assessCommand('git status; curl https://example.com').level, 'ask');
  assert.equal(assessCommand('npm test && npm run build').level, 'allow');
});

test('sensitive files are recognized', () => {
  assert.equal(isSensitiveFile('.env'), true);
  assert.equal(isSensitiveFile('config/.env.local'), true);
  assert.equal(isSensitiveFile('.env.example'), false);
  assert.equal(isSensitiveFile('C:\\Users\\me\\.ssh\\id_ed25519'), true);
  assert.equal(isSensitiveFile('certs/server.pem'), true);
  assert.equal(isSensitiveFile('src/app.js'), false);
  assert.equal(assessToolCall('write_file', { path: '.env', content: 'A=1' }).reason, 'sensitive-file');
  assert.equal(assessToolCall('write_file', { path: 'src/app.js', content: 'x' }).level, 'allow');
  assert.equal(assessToolCall('edit_file', { path: '.npmrc' }).reason, 'sensitive-file');
});

test('important mode auto-allows routine tools but keeps configured guards', () => {
  assert.equal(permissionFor('write_file', { path: 'src/app.js', content: 'x' }, ctx()).level, 'allow');
  assert.equal(permissionFor('edit_file', { path: 'src/app.js' }, ctx()).level, 'allow');
  assert.equal(permissionFor('run_command', { command: 'npm test' }, ctx()).level, 'allow');
  assert.equal(permissionFor('run_command', { command: 'rm -rf dist' }, ctx()).level, 'ask');
  assert.equal(permissionFor('write_file', { path: '.env', content: 'x' }, ctx()).level, 'ask');
  assert.equal(permissionFor('run_command', { command: 'npm test' }, ctx()).reason, '');
  assert.equal(permissionFor('mcp__server__tool', {}, ctx()).level, 'ask');
  assert.equal(permissionFor('computer_use', { action: 'click', x: 1, y: 1 }, ctx()).level, 'ask');
});

test('every guarded action mode asks even for routine calls', () => {
  const all = ctx({ config: { approvals: { mode: 'all' } } });
  assert.equal(permissionFor('write_file', { path: 'src/app.js', content: 'x' }, all).level, 'ask');
  assert.equal(permissionFor('run_command', { command: 'npm test' }, all).level, 'ask');
  assert.equal(permissionFor('run_command', { command: 'ls' }, all).reason, 'policy');
});

test('no-approval mode runs every tool but keeps explicit blocks', () => {
  const auto = ctx({ config: { approvals: { mode: 'auto' } } });
  assert.equal(permissionFor('write_file', { path: '.env', content: 'x' }, auto).level, 'allow');
  assert.equal(permissionFor('edit_file', { path: '.env.local' }, auto).level, 'allow');
  assert.equal(permissionFor('run_command', { command: 'rm -rf dist' }, auto).level, 'allow');
  assert.equal(permissionFor('run_command', { command: 'npm publish' }, auto).level, 'allow');
  assert.equal(permissionFor('mcp__server__tool', {}, auto).level, 'allow');
  assert.equal(permissionFor('computer_use', { action: 'click', x: 1, y: 1 }, auto).level, 'allow');

  const blocked = ctx({ config: { approvals: { mode: 'auto' }, permissions: { run_command: 'deny' } } });
  assert.equal(permissionFor('run_command', { command: 'npm test' }, blocked).level, 'deny');
});

test('explicit policy wins and blocked tools stay blocked', () => {
  const allowed = ctx({ config: { permissions: { run_command: 'allow' } } });
  assert.equal(permissionFor('run_command', { command: 'rm -rf dist' }, allowed).level, 'allow');
  const denied = ctx({ config: { permissions: { run_command: 'deny' } } });
  assert.equal(permissionFor('run_command', { command: 'ls' }, denied).level, 'deny');
});

test('always allow is scoped to one exact command', () => {
  const context = ctx();
  const request = { tool: 'run_command', args: { command: 'npm run deploy' }, reason: 'unknown' };
  assert.equal(grantSessionApproval(context.session, request), 'command');
  assert.deepEqual(context.session.allowCommands, [commandApprovalKey('run_command', { command: 'npm run deploy' })]);
  assert.equal(permissionFor('run_command', { command: 'npm run deploy' }, context).level, 'allow');
  assert.equal(permissionFor('run_command', { command: 'npm run deploy --force' }, context).level, 'ask');
});

test('always allow on a sensitive file is scoped to that path', () => {
  const context = ctx();
  const request = { tool: 'edit_file', args: { path: '.env' }, reason: 'sensitive-file' };
  assert.equal(grantSessionApproval(context.session, request), 'file');
  assert.equal(permissionFor('edit_file', { path: '.env' }, context).level, 'allow');
  assert.equal(permissionFor('edit_file', { path: '.env.local' }, context).level, 'ask');
  assert.ok(!context.session.allowTools.includes('edit_file'));
});

test('always allow on other tools uses the session tool list', () => {
  const context = ctx();
  assert.equal(grantSessionApproval(context.session, { tool: 'write_file', args: { path: 'a.txt' }, reason: 'policy' }), 'tool');
  assert.deepEqual(context.session.allowTools, ['write_file']);
});
