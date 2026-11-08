'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseArgs,
  pickContinueSession,
  resolveSession,
  completeLine,
  composePrompt,
} = require('../src/cli/support');

test('parseArgs reads flags, values and positionals', () => {
  const parsed = parseArgs(['run', 'fix the build', '--model', 'openai/gpt-5', '-w', '/tmp/project', '-y', '-v']);
  assert.deepEqual(parsed._, ['run', 'fix the build']);
  assert.equal(parsed.flags.model, 'openai/gpt-5');
  assert.equal(parsed.flags.workspace, '/tmp/project');
  assert.equal(parsed.flags.yes, true);
  assert.equal(parsed.flags.verbose, true);
});

test('parseArgs understands continue, session and no-color', () => {
  const parsed = parseArgs(['-c', '--session', 's_abc', '--no-color']);
  assert.equal(parsed.flags.continue, true);
  assert.equal(parsed.flags.session, 's_abc');
  assert.equal(parsed.flags.noColor, true);
});

test('pickContinueSession prefers the current workspace, then the newest session', () => {
  const sessions = [
    { id: 's_new_other', updatedAt: '2026-11-06T10:00:00.000Z', workspace: '/other' },
    { id: 's_older_here', updatedAt: '2026-11-05T10:00:00.000Z', workspace: '/here' },
    { id: 's_newer_here', updatedAt: '2026-11-05T12:00:00.000Z', workspace: '/here' },
    { id: 's_archived', updatedAt: '2026-11-07T10:00:00.000Z', workspace: '/here', archived: true },
  ];
  assert.equal(pickContinueSession(sessions, '/here').id, 's_newer_here');
  assert.equal(pickContinueSession(sessions, '/missing').id, 's_new_other');
  assert.equal(pickContinueSession([], '/here'), null);
  assert.equal(pickContinueSession([{ id: 's_only', archived: true }], '/here'), null);
});

test('resolveSession accepts numbers, ids, prefixes and unique titles', () => {
  const sessions = [
    { id: 's_alpha1', title: 'First task' },
    { id: 's_beta2', title: 'Second task' },
    { id: 's_alpha2', title: 'Third task' },
  ];
  assert.equal(resolveSession(sessions, '2').session.id, 's_beta2');
  assert.equal(resolveSession(sessions, 's_beta2').session.id, 's_beta2');
  assert.equal(resolveSession(sessions, 's_beta').session.id, 's_beta2');
  assert.equal(resolveSession(sessions, 'third task').session.id, 's_alpha2');
  assert.equal(resolveSession(sessions, 's_alpha').error, 'ambiguous');
  assert.equal(resolveSession(sessions, '9').error, 'range');
  assert.equal(resolveSession(sessions, 'nope').error, 'missing');
  assert.equal(resolveSession(sessions, '').error, 'empty');
});

test('completeLine completes commands and known arguments', () => {
  assert.deepEqual(completeLine('/mo'), [['/model', '/mode'], '/mo']);
  assert.deepEqual(completeLine('/'), [['/help', '/model', '/mode', '/new', '/sessions', '/resume', '/rename', '/compact', '/memory', '/skills', '/skill', '/mcp', '/learn', '/workspace', '/config', '/init', '/clear', '/exit', '/quit'], '/']);
  assert.deepEqual(completeLine('/mode '), [['agent', 'coding', 'design', 'research', 'plan', 'ask'], '']);
  assert.deepEqual(completeLine('/mode pl'), [['plan'], 'pl']);
  assert.deepEqual(completeLine('/mcp '), [['example', 'refresh'], '']);
  assert.deepEqual(completeLine('/model opus', { models: ['anthropic/claude-opus-4', 'openai/gpt-5'] }), [['anthropic/claude-opus-4'], 'opus']);
  assert.deepEqual(completeLine('/model one two'), [[], 'two']);
  assert.deepEqual(completeLine('plain text'), [[], 'plain text']);
});

test('composePrompt uses stdin only for an empty prompt or a dash', () => {
  assert.equal(composePrompt('', 'diff --git a/x b/x'), 'diff --git a/x b/x');
  assert.equal(composePrompt('-', 'piped prompt\n'), 'piped prompt');
  assert.equal(composePrompt('review this', 'ignored stdin'), 'review this');
  assert.equal(composePrompt('', '   '), null);
  assert.equal(composePrompt('-', ''), null);
});
