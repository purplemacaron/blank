/* blank terminal — one persistent local shell shared by the Console page and the rail. */
(function () {
  'use strict';

  const MAX_BUFFER = 200_000;
  const state = {
    loaded: false,
    loading: false,
    buffer: '',
    cwd: '',
    workspace: '',
    shell: '',
    busy: false,
    running: false,
    code: null,
    error: '',
    history: [],
    index: -1,
  };
  const listeners = new Set();
  let subscribed = false;
  let scheduled = false;

  const emit = () => {
    for (const listener of [...listeners]) {
      try { listener(state); } catch {}
    }
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; emit(); }, 24);
  };
  const trim = () => {
    if (state.buffer.length > MAX_BUFFER) state.buffer = state.buffer.slice(-MAX_BUFFER);
  };
  const applySnapshot = (snapshot) => {
    if (!snapshot) return;
    if (typeof snapshot.buffer === 'string' && snapshot.buffer.length >= state.buffer.length) state.buffer = snapshot.buffer;
    state.cwd = snapshot.cwd || state.cwd;
    state.workspace = snapshot.workspace || state.workspace;
    state.shell = snapshot.shell || state.shell;
    state.busy = Boolean(snapshot.busy);
    state.running = Boolean(snapshot.running);
    state.code = typeof snapshot.code === 'number' ? snapshot.code : null;
  };
  const subscribe = () => {
    if (subscribed || !window.API?.onEvent) return;
    subscribed = true;
    window.API.onEvent((event) => {
      if (!event || typeof event.type !== 'string') return;
      if (event.type === 'console:data') {
        state.buffer += String(event.text || '');
        trim();
        schedule();
        return;
      }
      if (event.type === 'console:state') {
        if (event.cwd) state.cwd = event.cwd;
        if (typeof event.busy === 'boolean') state.busy = event.busy;
        if (typeof event.running === 'boolean') state.running = event.running;
        if (typeof event.code === 'number') state.code = event.code;
        schedule();
        return;
      }
      if (event.type === 'console:exit') {
        state.running = false;
        state.busy = false;
        if (typeof event.code === 'number') state.code = event.code;
        schedule();
      }
    });
  };

  async function ensure() {
    subscribe();
    if (state.loaded && state.running) return state;
    if (state.loading) return state;
    state.loading = true;
    state.error = '';
    emit();
    try {
      applySnapshot(await window.API.console.terminal.start());
      state.loaded = true;
    } catch (error) {
      state.error = error.message || 'The terminal could not start.';
      state.loaded = false;
    } finally {
      state.loading = false;
      emit();
    }
    return state;
  }

  async function write(text) {
    const command = String(text || '').replace(/[\r\n]+/g, '\n');
    if (!command.trim()) return;
    state.history = [command, ...state.history.filter((entry) => entry !== command)].slice(0, 60);
    state.index = -1;
    state.buffer += command.split('\n').map((line) => `❯ ${line}`).join('\n') + '\n';
    trim();
    schedule();
    try {
      await window.API.console.terminal.write(command);
    } catch (error) {
      state.error = error.message;
      emit();
    }
  }

  async function stop() {
    try { await window.API.console.terminal.stop(); } catch {}
    state.running = false;
    state.busy = false;
    emit();
  }

  async function restart() {
    try {
      state.buffer += state.buffer.endsWith('\n') || !state.buffer ? '' : '\n';
      state.buffer += '[restarted]\n';
      const snapshot = await window.API.console.terminal.restart();
      state.running = Boolean(snapshot?.running);
      state.cwd = snapshot?.cwd || state.cwd;
      state.code = null;
      state.error = '';
    } catch (error) {
      state.error = error.message;
    }
    emit();
  }

  async function clear() {
    try { await window.API.console.terminal.clear(); } catch {}
    state.buffer = '';
    emit();
  }

  function markup({ compact = false } = {}) {
    return `<div class="terminal-panel${compact ? ' compact' : ''}" data-terminal data-copy-block>
      <div class="terminal-bar">
        <span class="terminal-dot" data-terminal-dot></span>
        <span class="terminal-cwd mono" data-terminal-cwd>Terminal</span>
        <span class="terminal-status" data-terminal-status></span>
        <span class="terminal-spacer"></span>
        <button class="mini-icon js-copy-block" type="button" data-terminal-copy title="Copy output" aria-label="Copy output" data-icon-size="12">${icon('copy', 12)}</button>
        <button class="mini-icon" type="button" data-terminal-restart title="Restart">${icon('refresh', 12)}</button>
        <button class="mini-icon" type="button" data-terminal-clear title="Clear">${icon('trash', 12)}</button>
      </div>
      <pre class="terminal-output" data-terminal-output aria-live="polite"></pre>
      <div class="terminal-hint" data-terminal-hint></div>
      <div class="terminal-input-row">
        <span class="terminal-prompt">${icon('chevron-right', 11)}</span>
        <input class="terminal-input" data-terminal-input type="text" spellcheck="false" autocomplete="off" placeholder="Type a command and press Enter" aria-label="Terminal command" />
        <button class="btn btn-primary btn-sm" type="button" data-terminal-send>Run</button>
      </div>
    </div>`;
  }

  function wire(root) {
    if (!root) return () => {};
    const output = root.querySelector('[data-terminal-output]');
    const hint = root.querySelector('[data-terminal-hint]');
    const cwd = root.querySelector('[data-terminal-cwd]');
    const status = root.querySelector('[data-terminal-status]');
    const dot = root.querySelector('[data-terminal-dot]');
    const input = root.querySelector('[data-terminal-input]');
    let stick = true;
    const cleanOutput = (text) => String(text || '')
      .replace(/(^|\n)[A-Za-z]:\\[^\n>]*>/g, '$1')
      .replace(/\n{3,}/g, '\n\n');
    const paint = () => {
      if (!root.isConnected) { listeners.delete(paint); return; }
      if (output) {
        const display = cleanOutput(state.buffer);
        if (output.textContent !== display) output.textContent = display;
        if (stick) output.scrollTop = output.scrollHeight;
      }
      if (hint) {
        hint.textContent = state.error || (state.loading ? 'Starting terminal…' : state.buffer ? '' : 'A local shell opens in your workspace.');
        hint.hidden = !hint.textContent;
      }
      if (cwd) cwd.textContent = state.cwd ? shortCwd(state.cwd) : 'Terminal';
      if (status) {
        status.textContent = state.busy ? 'Running' : state.running ? 'Ready' : state.loaded ? 'Stopped' : '';
        status.classList.toggle('busy', state.busy);
      }
      if (dot) {
        dot.classList.toggle('on', state.running && !state.busy);
        dot.classList.toggle('busy', state.busy);
      }
      input?.classList.toggle('busy', state.busy);
    };
    listeners.add(paint);
    ensure();
    paint();
    output?.addEventListener('scroll', () => {
      stick = output.scrollTop + output.clientHeight >= output.scrollHeight - 24;
    });
    const send = () => {
      const value = input?.value || '';
      if (!value.trim()) return;
      if (input) input.value = '';
      write(value);
      input?.focus();
    };
    root.querySelector('[data-terminal-send]')?.addEventListener('click', send);
    input?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); send(); return; }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (!state.history.length) return;
        state.index = Math.min(state.history.length - 1, state.index + 1);
        input.value = state.history[state.index] || '';
        input.setSelectionRange(input.value.length, input.value.length);
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        state.index = Math.max(-1, state.index - 1);
        input.value = state.index >= 0 ? state.history[state.index] || '' : '';
        return;
      }
      if (event.key.toLowerCase() === 'l' && event.ctrlKey) {
        event.preventDefault();
        clear();
        return;
      }
      if (event.key.toLowerCase() === 'c' && event.ctrlKey && state.busy) {
        event.preventDefault();
        state.buffer += '^C\n';
        restart();
      }
    });
    root.querySelector('[data-terminal-restart]')?.addEventListener('click', restart);
    root.querySelector('[data-terminal-clear]')?.addEventListener('click', clear);
    setTimeout(() => { if (root.isConnected && !input?.value) input?.focus(); }, 80);
    return () => { listeners.delete(paint); };
  }

  function shortCwd(value) {
    const text = String(value || '');
    const parts = text.split(/[\\/]+/).filter(Boolean);
    if (parts.length <= 2) return text;
    return `…/${parts.slice(-2).join('/')}`;
  }

  window.TerminalView = { state, ensure, write, stop, restart, clear, markup, wire, subscribe };
})();
