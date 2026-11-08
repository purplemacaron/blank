'use strict';

const os = require('os');
const { StringDecoder } = require('string_decoder');
const { createScreen } = require('./screen');
const { createKeyParser } = require('./keys');
const { createComposer } = require('./composer');
const { createTheme } = require('./theme');
const { renderTranscript } = require('./transcript');
const { displayWidth, truncate } = require('./width');
const {
  createState, scrollPage, goEnd, newOutput, approvalDecision, paletteMove,
  composerLayout, layout,
} = require('./state');
const { summarizeArgs } = require('../../core/tools');
const { SLASH_COMMANDS } = require('../support');
const pkg = require('../../../package.json');

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const MAX_COMPOSER_ROWS = 8;

function shortPath(value) {
  const home = os.homedir();
  if (value && value.startsWith(home)) return `~${value.slice(home.length)}`;
  return value || '';
}

function formatTokens(tokens) {
  if (!tokens) return '0';
  if (tokens < 1000) return String(tokens);
  return `${(tokens / 1000).toFixed(1)}k`;
}

function padTo(text, width) {
  const delta = width - displayWidth(text);
  return delta > 0 ? `${text}${' '.repeat(delta)}` : text;
}

function headerLine(theme, header, width) {
  const brand = theme.paint([
    { text: '■ ', style: 'accent' },
    { text: 'blank', style: 'bold' },
    { text: ` v${header.version}`, style: 'dim' },
  ]);
  const right = theme.wrap('dim', `${header.model || 'no model'} · ${header.mode}`);
  const rightWidth = displayWidth(right);
  const title = header.title && header.title !== 'New session' ? ` · ${header.title}` : '';
  const gap = 2;
  const available = width - displayWidth(brand) - gap - (rightWidth + 2 <= width ? rightWidth + 2 : 0);
  let tail = `${shortPath(header.workspace)}${title}`;
  if (available > 0) tail = truncate(tail, available);
  else tail = '';
  let line = tail ? `${brand}  ${theme.wrap('dim', tail)}` : brand;
  if (rightWidth + 2 <= width && displayWidth(line) + rightWidth + 2 <= width) {
    line += ' '.repeat(width - displayWidth(line) - rightWidth);
    line += right;
  }
  return line;
}

function footerLine(theme, state, status, spinner, usage, width) {
  let left;
  if (state.approval) left = theme.wrap('yellow', 'approval pending');
  else if (state.overlay) left = theme.wrap('accent', 'picker');
  else if (status === 'running') left = `${theme.wrap('yellow', spinner)} ${theme.wrap('dim', 'running')}`;
  else if (status === 'command') left = `${theme.wrap('yellow', spinner)} ${theme.wrap('dim', 'working')}`;
  else left = `${theme.wrap('green', '●')} ${theme.wrap('dim', 'ready')}`;

  if (usage && (usage.input || usage.output)) {
    left += theme.wrap('dim', `  ${formatTokens(usage.input)} in · ${formatTokens(usage.output)} out`);
  }
  if (!state.follow && state.newLines) left += theme.wrap('yellow', `  ↓ ${state.newLines} new`);
  else if (!state.follow) left += theme.wrap('dim', '  ↑ scrolled');

  const hints = state.approval
    ? 'y allow · a always · n deny · Esc deny'
    : state.overlay
      ? '↑↓ move · Enter select · Esc close'
      : state.palette
        ? '↑↓ select · Tab accept · Esc close'
        : status !== 'idle'
          ? 'Esc stop · Ctrl+C stop'
          : 'Enter send · Alt+Enter newline · Ctrl+P commands';

  const right = theme.wrap('dim', hints);
  const leftWidth = displayWidth(left);
  const rightWidth = displayWidth(right);
  if (leftWidth + rightWidth + 2 <= width) {
    return left + ' '.repeat(width - leftWidth - rightWidth) + right;
  }
  return truncate(left, width);
}

function approvalRows(theme, approval, width, maxLines) {
  const rows = [];
  rows.push(theme.paint([
    { text: '🔒 ', style: '' },
    { text: 'approval needed', style: 'yellow' },
    { text: '  ', style: '' },
    { text: approval.label || approval.tool, style: 'bold' },
    { text: approval.reason ? `  (${approval.reason})` : '', style: 'dim' },
  ]));
  if (approval.summary) rows.push(theme.wrap('dim', `  ${truncate(approval.summary, Math.max(1, width - 4))}`));
  const args = (approval.args || '').split('\n').filter(Boolean);
  const room = Math.max(0, maxLines - rows.length - 1);
  for (const line of args.slice(0, room)) rows.push(theme.wrap('dim', `  ${truncate(line, Math.max(1, width - 4))}`));
  rows.push(theme.paint([
    { text: '[y]', style: 'green' }, { text: ' allow   ', style: '' },
    { text: '[a]', style: 'green' }, { text: ' always   ', style: '' },
    { text: '[n]', style: 'red' }, { text: ' deny', style: '' },
  ]));
  return rows.map((line) => truncate(line, width));
}

function overlayRows(theme, overlay, width, maxLines) {
  const rows = [theme.paint([{ text: overlay.title, style: 'bold' }])];
  const items = overlay.items || [];
  const limit = Math.max(1, maxLines - 1);
  const start = Math.max(0, Math.min(overlay.index - Math.floor(limit / 2), items.length - limit));
  const window = items.slice(start, start + limit);
  window.forEach((item, offset) => {
    const index = start + offset;
    const detail = item.detail ? `  ${theme.wrap('dim', item.detail)}` : '';
    const row = `  ${item.label}${detail} `;
    const line = index === overlay.index ? theme.wrap('reverse', padTo(row, width)) : row;
    rows.push(truncate(line, width));
  });
  return rows;
}

function composeFrame(options) {
  const {
    theme, size, header, blocks = [], verbose = false, state,
    composerText = '', composerCursor = 0, status = 'idle', spinner = SPINNER[0], usage = null,
  } = options;
  const width = Math.max(20, size.columns);
  const height = Math.max(6, size.rows);
  const maxComposer = Math.max(1, Math.min(MAX_COMPOSER_ROWS, height - 5));
  const bottom = [];
  let cursor = null;

  if (state.approval) {
    const rows = approvalRows(theme, state.approval, width, height - 4);
    bottom.push(...rows.slice(0, Math.max(1, height - 4)));
  } else if (state.overlay) {
    bottom.push(...overlayRows(theme, state.overlay, width, height - 4));
  } else {
    const info = composerLayout(composerText, width - 2, maxComposer, composerCursor);
    const composerRows = [];
    const lines = info.rows.length ? info.rows : [''];
    lines.forEach((row, index) => {
      const prompt = index === 0 ? theme.wrap('accent', '›') : ' ';
      const body = row || (index === 0 && !composerText ? theme.wrap('dim', 'Ask blank anything…') : row);
      composerRows.push(`${prompt} ${body}`);
    });

    const palette = state.palette;
    let paletteRows = [];
    if (palette && palette.items && palette.items.length) {
      const room = Math.max(0, height - 4 - composerRows.length);
      const limit = Math.min(5, room);
      const start = Math.max(0, Math.min(palette.index - Math.floor(limit / 2), palette.items.length - limit));
      paletteRows = palette.items.slice(start, start + limit).map((item, offset) => {
        const index = start + offset;
        const row = `  ${item} `;
        return truncate(index === palette.index ? theme.wrap('reverse', padTo(row, width)) : theme.wrap('dim', row), width);
      });
      cursor = {
        row: 0,
        col: Math.min(width - 1, 2 + info.cursorCol),
        relativeComposerRow: paletteRows.length + info.cursorRow,
      };
    } else {
      cursor = { row: 0, col: Math.min(width - 1, 2 + info.cursorCol), relativeComposerRow: info.cursorRow };
    }
    bottom.push(...paletteRows, ...composerRows);
  }

  const maxBottom = Math.max(1, height - 3);
  if (bottom.length > maxBottom) bottom.splice(0, bottom.length - maxBottom);
  const area = layout(state, { columns: width, rows: height }, bottom.length);
  const transcriptRows = Math.max(1, height - 2 - bottom.length);
  const rendered = renderTranscript(blocks, { width, verbose });
  const maxScroll = Math.max(0, rendered.length - transcriptRows);
  const end = state.follow ? rendered.length : rendered.length - Math.min(state.scroll, maxScroll);
  const start = Math.max(0, end - transcriptRows);
  const visible = rendered.slice(start, Math.max(start, end));

  const frame = [];
  frame.push(headerLine(theme, header, width));
  while (frame.length < 1 + transcriptRows) {
    const index = frame.length - 1;
    const row = visible[index - transcriptRows + visible.length];
    frame.push(row ? theme.paint(row) : '');
  }
  const bottomTop = frame.length;
  for (const row of bottom) frame.push(row);
  while (frame.length < height - 1) frame.push('');
  frame.length = Math.max(1, Math.min(frame.length, height - 1));
  frame.push(footerLine(theme, state, status, spinner, usage, width));

  let absoluteCursor = null;
  if (cursor && !state.approval && !state.overlay) {
    absoluteCursor = { row: bottomTop + cursor.relativeComposerRow, col: cursor.col };
    if (absoluteCursor.row >= height - 1) absoluteCursor.row = height - 2;
  }
  return {
    lines: frame,
    cursor: absoluteCursor,
    layout: area,
    transcriptRows,
    renderedRows: rendered.length,
  };
}

function blocksFromSession(session) {
  const blocks = [];
  for (const message of session?.messages || []) {
    if (message.role === 'user') {
      blocks.push({ kind: 'user', text: message.content || '' });
    } else if (message.role === 'assistant') {
      if (message.content) blocks.push({ kind: 'assistant', text: message.content });
      if (message.reasoning) blocks.push({ kind: 'reasoning', text: message.reasoning });
      for (const call of message.toolCalls || []) {
        blocks.push({
          kind: 'tool',
          callId: call.id,
          name: call.name,
          label: call.name,
          status: 'running',
          content: '',
        });
      }
    } else if (message.role === 'tool') {
      const block = blocks.find((item) => item.kind === 'tool' && item.callId === message.toolCallId && item.status === 'running' && !item.content);
      if (block) {
        block.status = message.isError ? 'error' : 'ok';
        block.content = message.content || '';
        block.meta = message.meta || {};
      } else {
        blocks.push({
          kind: 'tool',
          callId: message.toolCallId,
          name: message.name,
          label: message.name,
          status: message.isError ? 'error' : 'ok',
          content: message.content || '',
          meta: message.meta || {},
        });
      }
    }
  }
  return blocks;
}

async function runTui(runtime, { color = true, input = process.stdin, output = process.stdout } = {}) {
  const theme = createTheme({ color });
  const screen = createScreen({ input, output });
  const parser = createKeyParser();
  const decoder = new StringDecoder('utf8');
  const composer = createComposer();
  const state = createState();
  state.verbose = runtime.verbose;

  let blocks = blocksFromSession(runtime.session);
  let status = 'idle';
  let spinnerIndex = 0;
  let spinnerTimer = null;
  let renderTimer = null;
  let escTimer = null;
  let activeRun = null;
  let shut = false;
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  if (!blocks.length) {
    blocks.push({
      kind: 'notice',
      text: 'TUI · Enter send · Alt+Enter newline · Esc stop · Ctrl+P commands · Ctrl+R sessions · Ctrl+E models · Ctrl+O tools · blank --plain for the simple REPL',
    });
  }

  const modelList = runtime.listModels();
  const modelIds = () => modelList.map((model) => model.fullId);
  let viewportRows = Math.max(1, screen.size().rows - 6);
  let viewportTotal = 0;

  function requestRender() {
    if (shut || renderTimer) return;
    renderTimer = setTimeout(() => {
      renderTimer = null;
      draw();
    }, 30);
    if (typeof renderTimer.unref === 'function') renderTimer.unref();
  }

  function draw() {
    if (shut) return;
    const frame = composeFrame({
      theme,
      size: screen.size(),
      header: {
        version: pkg.version,
        workspace: runtime.workspace,
        title: runtime.session.title,
        model: runtime.session.model,
        mode: runtime.session.mode,
      },
      blocks,
      verbose: state.verbose,
      state,
      composerText: composer.text,
      composerCursor: composer.cursor,
      status,
      spinner: SPINNER[spinnerIndex % SPINNER.length],
      usage: runtime.session.usage,
    });
    screen.render(frame.lines, frame.cursor);
    viewportRows = frame.transcriptRows;
    viewportTotal = frame.renderedRows;
  }

  function setStatus(value) {
    status = value;
    if (status === 'running' || status === 'command') startSpinner();
    else stopSpinner();
    requestRender();
  }

  function startSpinner() {
    if (spinnerTimer) return;
    spinnerTimer = setInterval(() => {
      spinnerIndex += 1;
      requestRender();
    }, 100);
    if (typeof spinnerTimer.unref === 'function') spinnerTimer.unref();
  }

  function stopSpinner() {
    if (!spinnerTimer) return;
    clearInterval(spinnerTimer);
    spinnerTimer = null;
  }

  function refreshPalette() {
    if (!composer.text.startsWith('/') || composer.text.includes('\n')) { state.palette = null; return; }
    const items = composer.completions(modelIds());
    if (!items.length) { state.palette = null; return; }
    const fragment = composer.text.slice(composer.text.lastIndexOf(' ') + 1);
    if (items.every((item) => item === fragment)) { state.palette = null; return; }
    const index = Math.min(state.palette?.index || 0, items.length - 1);
    state.palette = { items, index };
  }

  function closeOverlays() {
    state.palette = null;
    state.overlay = null;
    requestRender();
  }

  function pushSystem(lines) {
    for (const line of [].concat(lines)) blocks.push({ kind: 'system', text: String(line ?? '') });
  }

  function appendMeta(text) {
    if (!text) return;
    const last = blocks[blocks.length - 1];
    if (last && last.kind === 'meta') last.text = `${last.text} · ${text}`;
    else blocks.push({ kind: 'meta', text });
  }

  function startRun(text) {
    blocks.push({ kind: 'user', text });
    composer.remember(text);
    composer.clear();
    state.palette = null;
    goEnd(state);
    setStatus('running');
    let currentAssistant = null;
    let currentReasoning = null;
    const tools = new Map();
    let errorSeen = false;

    const emit = (event) => {
      if (event.type === 'text') {
        if (!currentAssistant) {
          currentAssistant = { kind: 'assistant', text: '' };
          blocks.push(currentAssistant);
        }
        currentAssistant.text += event.delta;
        newOutput(state);
      } else if (event.type === 'reasoning') {
        if (!currentReasoning) {
          currentReasoning = { kind: 'reasoning', text: '' };
          blocks.push(currentReasoning);
        }
        currentReasoning.text += event.delta;
        newOutput(state);
      } else if (event.type === 'assistant:start') {
        currentAssistant = null;
        currentReasoning = null;
      } else if (event.type === 'assistant:end') {
        if (event.message) {
          if (!currentAssistant) {
            currentAssistant = { kind: 'assistant', text: '' };
            blocks.push(currentAssistant);
          }
          currentAssistant.text = event.message.content || currentAssistant.text;
        }
        currentAssistant = null;
        currentReasoning = null;
      } else if (event.type === 'tool:start') {
        const block = {
          kind: 'tool',
          callId: event.callId,
          name: event.name,
          label: event.label || event.name,
          summary: event.summary || '',
          status: 'running',
          content: '',
        };
        tools.set(event.callId, block);
        blocks.push(block);
        newOutput(state);
      } else if (event.type === 'tool:end') {
        const block = tools.get(event.callId);
        if (block) {
          block.status = event.isError ? 'error' : 'ok';
          block.content = String(event.content || '');
          block.meta = event.meta || {};
          block.summary = '';
        }
        newOutput(state);
      } else if (event.type === 'notice') {
        blocks.push({ kind: 'notice', text: event.text, level: event.level });
        newOutput(state);
      } else if (event.type === 'error') {
        errorSeen = true;
        blocks.push({ kind: 'error', message: event.message, hint: event.hint });
        newOutput(state);
      } else if (event.type === 'compacted') {
        blocks.push({ kind: 'notice', text: 'context compacted' });
        newOutput(state);
      } else if (event.type === 'title') {
        requestRender();
      }
      requestRender();
    };

    const requestApproval = (event) => {
      if (runtime.autoYes) return Promise.resolve('allow');
      state.overlay = null;
      state.palette = null;
      return new Promise((resolve) => {
        state.approval = {
          event,
          tool: event.tool,
          label: event.label || event.tool,
          reason: event.reason || '',
          summary: summarizeArgs(event.tool, event.args || {}),
          args: JSON.stringify(event.args || {}, null, 2),
          resolve,
        };
        requestRender();
      });
    };

    activeRun = runtime.run(text, { emit, requestApproval }).then((outcome) => {
      activeRun = null;
      if (state.approval) {
        state.approval.resolve('deny');
        state.approval = null;
      }
      setStatus('idle');
      if (outcome?.ok) {
        appendMeta(`${formatTokens(runtime.session.usage?.input)} in · ${formatTokens(runtime.session.usage?.output)} out · ${outcome.steps} step${outcome.steps === 1 ? '' : 's'}`);
      } else if (outcome?.stopped) {
        appendMeta('stopped');
      } else if (outcome?.error && !errorSeen) {
        blocks.push({ kind: 'error', message: outcome.error });
      }
      requestRender();
    });
  }

  async function runCommand(line) {
    setStatus('command');
    try {
      const result = await runtime.command(line, {
        print: (text) => { pushSystem(text); requestRender(); },
      });
      if (result.action === 'exit') { await shutdown(); return; }
      if (result.action === 'clear') {
        blocks = [];
        goEnd(state);
      }
      if (result.action === 'new' || result.action === 'resume') {
        blocks = blocksFromSession(runtime.session);
        blocks.push({ kind: 'notice', text: `${result.action === 'new' ? 'new session' : 'resumed'} ${runtime.session.title}  ${runtime.session.id}` });
        goEnd(state);
      }
    } catch (error) {
      blocks.push({ kind: 'error', message: error.message });
    } finally {
      if (!shut) setStatus('idle');
      requestRender();
    }
  }

  function submit() {
    const text = composer.text.trim();
    if (!text) return;
    if (runtime.active) {
      blocks.push({ kind: 'notice', text: 'a run is in progress — Esc to stop' });
      requestRender();
      return;
    }
    if (text === '/sessions') { composer.clear(); openOverlay('sessions'); return; }
    if (text === '/model') { composer.clear(); openOverlay('models'); return; }
    if (text.startsWith('/')) {
      composer.clear();
      void runCommand(text);
      return;
    }
    startRun(text);
  }

  function acceptPalette() {
    const palette = state.palette;
    if (!palette || !palette.items.length) return;
    const item = palette.items[palette.index] || palette.items[0];
    const text = composer.text;
    const space = text.indexOf(' ');
    if (space === -1 && item.startsWith('/')) composer.insert(`${item.slice(text.length)} `);
    else if (space !== -1) {
      const base = text.slice(0, text.lastIndexOf(' ') + 1);
      composer.clear();
      composer.insert(`${base}${item} `);
    } else {
      composer.clear();
      composer.insert(`${item} `);
    }
    state.palette = null;
    requestRender();
  }

  function openOverlay(type) {
    if (type === 'commands') {
      state.overlay = {
        type,
        title: 'Commands',
        items: SLASH_COMMANDS.map((command) => ({ label: command, value: command })),
        index: 0,
      };
    } else if (type === 'sessions') {
      const sessions = runtime.listSessions().slice(0, 15);
      state.overlay = {
        type,
        title: 'Sessions',
        items: sessions.map((session) => ({
          label: session.title || session.id,
          detail: `${session.id} · ${session.model || ''}`,
          value: session.id,
        })),
        index: 0,
      };
    } else if (type === 'models') {
      state.overlay = {
        type,
        title: 'Models',
        items: modelList.map((model) => ({
          label: model.fullId,
          detail: model.name,
          value: model.fullId,
        })),
        index: 0,
      };
    }
    state.palette = null;
    requestRender();
  }

  function chooseOverlay() {
    const overlay = state.overlay;
    if (!overlay) return;
    const item = overlay.items[overlay.index];
    state.overlay = null;
    if (!item) { requestRender(); return; }
    if (overlay.type === 'commands') {
      composer.clear();
      composer.insert(`${item.value} `);
      refreshPalette();
      requestRender();
      return;
    }
    if (overlay.type === 'sessions') {
      void runCommand(`/resume ${item.value}`);
      return;
    }
    if (overlay.type === 'models') void runCommand(`/model ${item.value}`);
  }

  function finishApproval(decision) {
    const approval = state.approval;
    if (!approval) return;
    state.approval = null;
    approval.resolve(decision);
    requestRender();
  }

  function toggleToolOutput() {
    for (let i = blocks.length - 1; i >= 0; i -= 1) {
      if (blocks[i].kind === 'tool') {
        blocks[i].expanded = !blocks[i].expanded;
        requestRender();
        return;
      }
    }
  }

  async function shutdown(code = 0) {
    if (shut) return;
    shut = true;
    if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
    if (escTimer) { clearTimeout(escTimer); escTimer = null; }
    stopSpinner();
    input.off('data', onData);
    if (typeof output.off === 'function') output.off('resize', requestRender);
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    process.off('exit', restore);
    try { runtime.abort(); } catch {}
    screen.stop();
    try { input.pause(); } catch {}
    try { await runtime.close(); } catch {}
    if (code) process.exitCode = code;
    resolveDone();
  }

  function restore() {
    screen.stop();
  }

  function onSignal() {
    void shutdown();
  }

  function onKey(key) {
    if (state.approval) {
      if (key.name === 'c' && key.ctrl) { finishApproval('deny'); runtime.abort(); return; }
      if (key.name === 'text' && key.text) {
        const value = key.text.trim().toLowerCase();
        if (value === 'y' || value === 'a' || value === 'n') {
          finishApproval(value === 'y' ? 'allow' : value === 'a' ? 'always' : 'deny');
        }
        return;
      }
      const decision = approvalDecision(key);
      if (decision) finishApproval(decision);
      return;
    }
    if (state.overlay) {
      if (key.name === 'up') { state.overlay.index = Math.max(0, state.overlay.index - 1); requestRender(); return; }
      if (key.name === 'down') {
        state.overlay.index = Math.min(state.overlay.items.length - 1, state.overlay.index + 1);
        requestRender();
        return;
      }
      if (key.name === 'enter') { chooseOverlay(); return; }
      if (key.name === 'escape' || (key.ctrl && key.name === 'p')) { state.overlay = null; requestRender(); return; }
      if (key.ctrl && key.name === 'c') { state.overlay = null; requestRender(); return; }
      return;
    }
    if (state.palette && (key.name === 'up' || key.name === 'down')) {
      paletteMove(state, key.name === 'up' ? -1 : 1);
      requestRender();
      return;
    }
    if (state.palette && (key.name === 'tab' || (key.name === 'enter' && !key.alt))) {
      acceptPalette();
      return;
    }
    if (key.name === 'escape') {
      if (state.palette) { state.palette = null; requestRender(); return; }
      if (runtime.active) {
        blocks.push({ kind: 'notice', text: 'stopping…' });
        runtime.abort();
        requestRender();
      }
      return;
    }
    if (key.ctrl && key.name === 'c') {
      if (runtime.active) {
        runtime.abort();
        blocks.push({ kind: 'notice', text: 'stopping…' });
        requestRender();
        return;
      }
      if (composer.text) { composer.clear(); refreshPalette(); requestRender(); return; }
      void shutdown();
      return;
    }
    if (key.ctrl && key.name === 'd') { void shutdown(); return; }
    if (key.ctrl && key.name === 'l') { blocks = []; goEnd(state); requestRender(); return; }
    if (key.ctrl && key.name === 'o') { toggleToolOutput(); return; }
    if (key.ctrl && key.name === 'p') { openOverlay('commands'); return; }
    if (key.ctrl && key.name === 'r') { openOverlay('sessions'); return; }
    if (key.ctrl && key.name === 'e') { openOverlay('models'); return; }
    if (key.name === 'pgup') { scrollPage(state, 1, viewportRows, Math.max(0, viewportTotal - viewportRows)); requestRender(); return; }
    if (key.name === 'pgdown') { scrollPage(state, -1, viewportRows, Math.max(0, viewportTotal - viewportRows)); requestRender(); return; }
    if (key.name === 'end') { goEnd(state); requestRender(); return; }
    if (key.name === 'enter') {
      if (key.alt) { composer.newline(); refreshPalette(); requestRender(); return; }
      submit();
      return;
    }
    if (key.name === 'newline') { composer.newline(); refreshPalette(); requestRender(); return; }
    if (key.name === 'tab') { acceptPalette(); return; }
    if (key.name === 'backspace') { composer.backspace(); refreshPalette(); requestRender(); return; }
    if (key.name === 'delete') { composer.deleteForward(); refreshPalette(); requestRender(); return; }
    if (key.name === 'left') { composer.left(); requestRender(); return; }
    if (key.name === 'right') { composer.right(); requestRender(); return; }
    if (key.name === 'home') { composer.home(); requestRender(); return; }
    if (key.name === 'up') {
      if (!composer.up()) composer.historyPrev();
      refreshPalette();
      requestRender();
      return;
    }
    if (key.name === 'down') {
      if (!composer.down()) composer.historyNext();
      refreshPalette();
      requestRender();
      return;
    }
    if (key.name === 'paste') { composer.insert(key.text); refreshPalette(); requestRender(); return; }
    if (key.name === 'text' && key.text) {
      composer.insert(key.text);
      state.palette = null;
      refreshPalette();
      requestRender();
    }
  }

  function onData(chunk) {
    if (escTimer) { clearTimeout(escTimer); escTimer = null; }
    const events = parser.feed(decoder.write(chunk));
    for (const event of events) onKey(event);
    if (parser.pending() === '\u001b') {
      escTimer = setTimeout(() => {
        escTimer = null;
        for (const event of parser.flush()) onKey(event);
      }, 30);
      if (typeof escTimer.unref === 'function') escTimer.unref();
    }
  }

  try {
    screen.start();
  } catch (error) {
    process.stderr.write(`blank: could not start the terminal UI (${error.message}). Run another command or use: blank --plain\n`);
    return;
  }
  process.on('exit', restore);
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  input.on('data', onData);
  if (typeof output.on === 'function') output.on('resize', requestRender);

  draw();
  await done;
  return { shutdown };
}

module.exports = { runTui, composeFrame, blocksFromSession, footerLine };
