'use strict';

/**
 * Lifecycle hooks.
 *
 * A hook is a shell command the user writes for one event. It runs with the
 * workspace as cwd and a small, explicit environment: no provider keys, no
 * stored secrets. Output is shown as a chat notice and never fed back to the
 * model. A failing hook is reported, not fatal.
 */

const { exec } = require('child_process');

const EVENTS = ['runStart', 'toolBefore', 'toolAfter', 'runEnd'];
const TIMEOUT_MS = 20_000;
const MAX_OUTPUT = 4000;
const MAX_COMMAND = 2000;
const MAX_ENV_VALUE = 2000;

function normalizeHooks(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const commands = source.commands && typeof source.commands === 'object' ? source.commands : {};
  const clean = { enabled: source.enabled !== false, commands: {} };
  for (const event of EVENTS) {
    clean.commands[event] = String(commands[event] || '').trim().slice(0, MAX_COMMAND);
  }
  return clean;
}

function activeHooks(config = {}) {
  const hooks = normalizeHooks(config.hooks);
  if (!hooks.enabled) return [];
  return EVENTS
    .filter((event) => hooks.commands[event])
    .map((event) => ({ event, command: hooks.commands[event] }));
}

function safeEnv(extra = {}) {
  const source = process.env;
  const env = {};
  for (const key of ['PATH', 'Path', 'HOME', 'USERPROFILE', 'SystemRoot', 'windir', 'ComSpec', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'SHELL']) {
    if (source[key] !== undefined) env[key] = source[key];
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined || value === null) continue;
    env[key] = String(value).slice(0, MAX_ENV_VALUE);
  }
  return env;
}

function clip(value) {
  const text = String(value || '').trim();
  return text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}…` : text;
}

function runOne({ command, event, workspace, session, runId, tool, args, result, signal }) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ event, ok: false, aborted: true, code: null, output: '', durationMs: 0 });
      return;
    }
    const started = Date.now();
    let extra = {
      BLANK_EVENT: event,
      BLANK_SESSION: session?.id || '',
      BLANK_RUN: runId || '',
      BLANK_WORKSPACE: workspace || '',
      BLANK_MODEL: session?.model || '',
    };
    if (tool) extra.BLANK_TOOL = tool;
    if (args !== undefined) extra.BLANK_TOOL_ARGS = JSON.stringify(args).slice(0, MAX_ENV_VALUE);
    if (result !== undefined) {
      extra.BLANK_TOOL_ERROR = result?.isError ? '1' : '0';
      extra.BLANK_TOOL_RESULT = String(result?.content || '').slice(0, MAX_ENV_VALUE);
    }
    const child = exec(command, {
      cwd: workspace || undefined,
      env: safeEnv(extra),
      timeout: TIMEOUT_MS,
      maxBuffer: 512 * 1024,
      windowsHide: true,
      shell: true,
    }, (error, stdout, stderr) => {
      const output = clip([String(stdout || '').trim(), String(stderr || '').trim()].filter(Boolean).join('\n'));
      const code = error?.code === undefined ? (error ? 1 : 0) : (typeof error.code === 'number' ? error.code : 1);
      resolve({
        event,
        ok: !error,
        aborted: Boolean(error?.killed),
        code,
        output: error?.killed && !output ? 'Hook timed out or was stopped.' : output,
        durationMs: Date.now() - started,
      });
    });
    if (signal) {
      const stop = () => { try { child.kill(); } catch {} };
      signal.addEventListener('abort', stop, { once: true });
      child.once('exit', () => signal.removeEventListener('abort', stop));
    }
  });
}

async function runHooks({ config, event, workspace, session, runId, tool, args, result, emit = () => {}, signal }) {
  const hook = activeHooks(config).find((item) => item.event === event);
  if (!hook) return null;
  const outcome = await runOne({ ...hook, workspace, session, runId, tool, args, result, signal });
  if (outcome.aborted && signal?.aborted) return outcome;
  const label = {
    runStart: 'run start',
    runEnd: 'run end',
    toolBefore: `before ${tool || 'tool'}`,
    toolAfter: `after ${tool || 'tool'}`,
  }[event];
  if (outcome.ok && outcome.output) {
    emit({ type: 'notice', level: 'info', text: `Hook · ${label} — ${outcome.output}` });
  } else if (!outcome.ok && !outcome.aborted) {
    const detail = outcome.output || `exit ${outcome.code}`;
    emit({ type: 'notice', level: 'warn', text: `Hook · ${label} failed — ${detail}` });
  }
  return outcome;
}

module.exports = {
  EVENTS,
  MAX_COMMAND,
  normalizeHooks,
  activeHooks,
  runHooks,
  safeEnv,
};
