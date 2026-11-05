'use strict';

/**
 * blank's local console runner. It executes a command the user typed in the
 * Console page or a check detected by the coding toolkit. Commands always run
 * inside the workspace, never through a remote service, and output is capped.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const MAX_OUTPUT = 200_000;
const DEFAULT_TIMEOUT = 120_000;
const isWin = process.platform === 'win32';

function stripAnsi(text) {
  return String(text || '')
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\r\n/g, '\n');
}

function resolveCwd(workspace) {
  const candidate = String(workspace || '').trim();
  if (candidate && fs.existsSync(candidate)) {
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch {}
  }
  return process.cwd();
}

function killTree(child) {
  if (!child || child.killed) return;
  try {
    if (isWin && child.pid) {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      return;
    }
    child.kill('SIGKILL');
  } catch {
    try { child.kill(); } catch {}
  }
}

function runConsoleCommand({ workspace, command, timeout = DEFAULT_TIMEOUT, maxBytes = MAX_OUTPUT } = {}) {
  const text = String(command || '').trim();
  if (!text) return Promise.resolve({ ok: false, code: null, error: 'Enter a command to run.', stdout: '', stderr: '', command: '', cwd: '', durationMs: 0, truncated: false });
  const cwd = resolveCwd(workspace);
  const limit = Math.max(4_000, Math.min(MAX_OUTPUT, Number(maxBytes) || MAX_OUTPUT));
  const timeLimit = Math.max(1_000, Math.min(600_000, Number(timeout) || DEFAULT_TIMEOUT));
  const started = Date.now();
  const shell = isWin ? (process.env.ComSpec || 'cmd.exe') : (process.env.SHELL || '/bin/sh');
  const args = isWin ? ['/d', '/s', '/c', text] : ['-lc', text];

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(shell, args, {
        cwd,
        env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', TERM: 'dumb' },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve({ ok: false, code: null, error: err.message, stdout: '', stderr: '', command: text, cwd, durationMs: 0, truncated: false });
      return;
    }

    let stdout = '';
    let stderr = '';
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeLimit);

    const append = (target, chunk) => {
      const next = target + chunk;
      if (next.length > limit) {
        truncated = true;
        return next.slice(0, limit);
      }
      return next;
    };

    child.stdout?.on('data', (chunk) => { stdout = append(stdout, chunk.toString('utf8')); });
    child.stderr?.on('data', (chunk) => { stderr = append(stderr, chunk.toString('utf8')); });

    const finish = (code, signal, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const cleanOut = stripAnsi(stdout).trimEnd();
      const cleanErr = stripAnsi(stderr).trimEnd();
      const exitCode = typeof code === 'number' ? code : null;
      resolve({
        ok: !timedOut && !error && (exitCode === 0 || exitCode === null),
        code: exitCode,
        signal: signal || '',
        error: timedOut ? `Timed out after ${Math.round(timeLimit / 1000)}s.` : error ? error.message : '',
        timedOut,
        stdout: cleanOut,
        stderr: cleanErr,
        command: text,
        cwd,
        durationMs: Date.now() - started,
        truncated,
      });
    };

    child.on('error', (err) => finish(null, '', err));
    child.on('close', (code, signal) => finish(code, signal));
  });
}

/* ------------------------------------------------------------------ terminal */

const MARK_START = '\u0001BLANK';
const MARK_END = '\u0003';
const TERMINAL_BUFFER = 200_000;

function terminalMarker() {
  return isWin
    ? `echo ${MARK_START}\u0002%ERRORLEVEL%\u0002"%CD%"${MARK_END}`
    : `printf '\\001BLANK\\002%s\\002%s\\003\\n' "$?" "$PWD"`;
}

function createStreamFilter() {
  let escape = '';
  let pending = '';
  let truncated = false;
  const strip = (text) => {
    let out = escape + text;
    escape = '';
    const partial = out.lastIndexOf('\u001b');
    if (partial !== -1) {
      const tail = out.slice(partial);
      if (!/^\u001b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\)?)/.test(tail) && !/\u0007|\u001b\\/.test(tail)) {
        // Hold an unfinished escape sequence until the next chunk.
        if (tail.length < 200) {
          escape = tail;
          out = out.slice(0, partial);
        }
      }
    }
    return out
      .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
      .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/[\u0000\u0004-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  };
  const isPrefix = (text) => MARK_START.startsWith(text);
  return {
    push(chunk) {
      pending += strip(String(chunk || ''));
      let visible = '';
      let cwd = '';
      let code = null;
      let sawMarker = false;
      const re = /\u0001BLANK\u0002(-?\d+)\u0002([^\u0003]*)\u0003/g;
      let last = 0;
      let match;
      while ((match = re.exec(pending))) {
        visible += pending.slice(last, match.index);
        last = re.lastIndex;
        code = Number(match[1]);
        cwd = match[2].replace(/^"|"$/g, '');
        sawMarker = true;
      }
      let rest = pending.slice(last);
      // Hold a possible partial marker at the tail so it can complete next chunk.
      let hold = '';
      for (let i = Math.max(0, rest.length - MARK_START.length); i < rest.length; i += 1) {
        const suffix = rest.slice(i);
        if (suffix.startsWith('\u0001') && isPrefix(suffix)) { hold = suffix; rest = rest.slice(0, i); break; }
      }
      pending = hold;
      visible += rest;
      if (visible.length > TERMINAL_BUFFER) {
        visible = visible.slice(-TERMINAL_BUFFER);
        truncated = true;
      }
      return { text: visible, code, cwd, sawMarker, truncated };
    },
    flush() {
      const out = pending + escape;
      pending = '';
      escape = '';
      return out;
    },
  };
}

function createTerminal({ workspace, onData, onState, onExit } = {}) {
  const cwd = resolveCwd(workspace);
  const shellPath = isWin ? (process.env.ComSpec || 'cmd.exe') : (process.env.SHELL || '/bin/sh');
  const args = isWin ? ['/d', '/q', '/k', 'chcp 65001>nul'] : ['-s'];
  const filter = createStreamFilter();
  let child = null;
  let buffer = '';
  let busy = false;
  let startedAt = Date.now();
  let stopped = false;
  let exitCode = null;

  const emit = (payload) => { try { onState?.(payload); } catch {} };
  const append = (text) => {
    if (!text) return;
    buffer += text;
    if (buffer.length > TERMINAL_BUFFER) buffer = buffer.slice(-TERMINAL_BUFFER);
    try { onData?.(text); } catch {}
  };

  const start = () => {
    try {
      child = spawn(shellPath, args, {
        cwd,
        env: { ...process.env, TERM: 'dumb', FORCE_COLOR: '0', NO_COLOR: '1', PYTHONIOENCODING: 'utf-8' },
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      emit({ running: false, error: error.message });
      return;
    }
    const onChunk = (chunk) => {
      const result = filter.push(chunk);
      if (result.text) append(result.text);
      if (result.truncated) emit({ truncated: true });
      if (result.sawMarker) {
        busy = false;
        exitCode = result.code;
        emit({ cwd: result.cwd || cwd, busy: false, code: result.code, running: true });
      }
    };
    child.stdout?.on('data', onChunk);
    child.stderr?.on('data', onChunk);
    child.on('error', (error) => {
      append(`\n${error.message}\n`);
      emit({ running: false, error: error.message });
    });
    child.on('exit', (code, signal) => {
      const wasStopped = stopped;
      stopped = true;
      const tail = filter.flush();
      if (tail) append(tail);
      busy = false;
      exitCode = typeof code === 'number' ? code : null;
      if (!wasStopped) append(`\n[process exited${exitCode === null ? '' : ` ${exitCode}`}${signal ? ` · ${signal}` : ''}]\n`);
      emit({ running: false, code: exitCode, signal: signal || '', stopped: wasStopped });
      try { onExit?.({ code: exitCode, signal: signal || '', stopped: wasStopped }); } catch {}
    });
    if (isWin) {
      // Give cmd a moment to apply the UTF-8 code page, then establish the prompt marker.
      setTimeout(() => { if (child && !stopped) child.stdin.write(`${terminalMarker()}\r\n`); }, 120);
    } else {
      child.stdin.write(`${terminalMarker()}\n`);
    }
  };

  const write = (data) => {
    const text = String(data || '').slice(0, 8000);
    if (!child || stopped) return false;
    busy = true;
    emit({ busy: true, running: true });
    const lines = text.replace(/\r\n/g, '\n').split('\n').filter((line, index, all) => line.length || index < all.length - 1);
    for (const line of lines) child.stdin.write(`${line}\r\n`);
    child.stdin.write(`${terminalMarker()}\r\n`);
    return true;
  };

  const stop = () => {
    if (!child || stopped) return;
    stopped = true;
    busy = false;
    killTree(child);
    emit({ running: false, stopped: true, code: exitCode });
  };

  const clear = () => {
    buffer = '';
    emit({ cleared: true });
  };

  const state = () => ({
    ok: true,
    workspace: cwd,
    shell: shellPath,
    cwd,
    buffer,
    busy,
    running: Boolean(child && !stopped),
    code: exitCode,
    startedAt,
  });

  start();
  return { write, stop, state, clear, filter };
}

module.exports = { runConsoleCommand, stripAnsi, createTerminal, createStreamFilter, MAX_OUTPUT, DEFAULT_TIMEOUT, TERMINAL_BUFFER };
