'use strict';

const fs = require('fs');
const path = require('path');
const triggers = require('../src/core/triggers');
const triggerStateModule = require('../src/core/trigger-state');
const { normalizeContent } = require('../src/core/mcp');
const { createWebhookServer } = require('./trigger-webhook');

const TICK_MS = 15_000;
const FIRST_POLL_MS = 15_000;
const FILE_RETRY_MS = 60_000;
const SESSION_CHAIN_LIMIT = 3;

function createDebouncer(delayMs, fn) {
  let timer = null;
  let lastValue;
  const delay = typeof delayMs === 'function' ? delayMs : () => delayMs;
  return {
    push(value) {
      lastValue = value;
      if (timer) clearTimeout(timer);
      const wait = Math.max(0, Number(delay()) || 0);
      timer = setTimeout(() => {
        timer = null;
        fn(lastValue);
      }, wait);
      timer.unref?.();
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
    get pending() {
      return Boolean(timer);
    },
  };
}

function createTriggerEngine(options = {}) {
  const getSchedules = typeof options.getSchedules === 'function' ? options.getSchedules : () => [];
  const getConfig = typeof options.getConfig === 'function' ? options.getConfig : () => ({});
  const mcp = options.mcp || { callTool: async () => null, statuses: () => [] };
  const dispatch = typeof options.dispatch === 'function' ? options.dispatch : async () => ({ started: false, reason: 'busy' });
  const notify = typeof options.notify === 'function' ? options.notify : () => {};
  const fileDebounceMs = Number.isFinite(options.fileDebounceMs) ? options.fileDebounceMs : null;

  let running = false;
  let loaded = false;
  let startedAt = 0;
  let tickTimer = null;
  let ticking = false;
  let saveTimer = null;
  let startupArmed = false;
  let triggerState = { version: 1, seen: {}, lastFired: {}, mcp: {} };

  const watchers = new Map();
  const debounces = new Map();
  const mcpRuntime = new Map();
  const startupTimers = new Map();
  const sessionOrigins = new Map();
  const runtime = new Map();

  const webhook = createWebhookServer({
    getRecords: () => getSchedules(),
    getConfig: () => getConfig(),
    dispatch: (record, event, meta) => dispatchEvent(record, event, meta),
    onStatus: (status) => {
      try {
        if (status.error) notify({ type: 'automations:runtime', webhook: status });
      } catch {}
    },
  });

  function setRuntime(id, patch) {
    const previous = runtime.get(id) || {};
    runtime.set(id, { ...previous, ...patch, updatedAt: Date.now() });
  }

  function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try { triggerStateModule.saveTriggerState(triggerState); } catch {}
    }, 500);
    saveTimer.unref?.();
  }

  function enabledRecords(type) {
    return getSchedules().filter((record) => (
      record
      && record.enabled !== false
      && record.trigger
      && (!type || record.trigger.type === type)
    ));
  }

  function isRunning(record) {
    return Boolean(record && record.enabled !== false && record.trigger);
  }

  function findRecord(id) {
    return getSchedules().find((record) => record.id === id) || null;
  }

  function classify(eventType, target) {
    if (eventType === 'change') return 'change';
    return fs.existsSync(target) ? 'add' : 'remove';
  }

  function watchTarget(record, target, entry) {
    const stats = fs.statSync(target);
    const directory = stats.isDirectory();
    const root = directory ? target : path.dirname(target);
    const directFile = directory ? '' : target;
    const watcher = fs.watch(root, directory ? { recursive: true } : {}, (eventType, filename) => {
      const name = filename ? String(filename) : '';
      const changed = directFile || (name ? path.join(root, name) : root);
      if (directFile && name && path.join(root, name) !== directFile) return;
      const kind = classify(eventType, changed);
      const current = findRecord(record.id);
      if (!isRunning(current) || current.trigger.type !== 'file') return;
      handleFileEvent(current, { kind, path: changed });
    });
    watcher.on('error', (err) => {
      entry.error = String(err?.message || 'File watcher failed.').slice(0, 300);
      entry.retryAt = Date.now() + FILE_RETRY_MS;
      setRuntime(record.id, { lastError: entry.error });
      closeEntry(entry);
      try { notify({ type: 'automations:runtime', id: record.id, error: entry.error }); } catch {}
    });
    return () => {
      try { watcher.close(); } catch {}
    };
  }

  function closeEntry(entry) {
    if (!entry || entry.closed) return;
    entry.closed = true;
    for (const close of entry.closers || []) {
      try { close(); } catch {}
    }
    entry.closers = [];
  }

  function closeDebounce(id) {
    const entry = debounces.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    debounces.delete(id);
  }

  function reconcileWatchers(records) {
    const files = records.filter((record) => record.trigger.type === 'file');
    const keep = new Set(files.map((record) => record.id));
    for (const [id, entry] of watchers) {
      if (!keep.has(id)) {
        closeEntry(entry);
        watchers.delete(id);
        closeDebounce(id);
        setRuntime(id, { lastError: '' });
      }
    }

    for (const record of files) {
      const paths = Array.isArray(record.trigger.config?.paths) ? record.trigger.config.paths : [];
      const key = JSON.stringify(paths);
      const existing = watchers.get(record.id);
      if (existing && existing.key === key) {
        if (!existing.error || Date.now() < existing.retryAt) continue;
        closeEntry(existing);
        watchers.delete(record.id);
      } else if (existing) {
        closeEntry(existing);
        watchers.delete(record.id);
      }

      const entry = { key, closers: [], error: '', retryAt: 0, closed: false };
      for (const target of paths) {
        try {
          entry.closers.push(watchTarget(record, target, entry));
        } catch (err) {
          entry.error = String(err?.message || 'File watcher failed.').slice(0, 300);
          entry.retryAt = Date.now() + FILE_RETRY_MS;
          closeEntry(entry);
          break;
        }
      }
      watchers.set(record.id, entry);
      setRuntime(record.id, { lastError: entry.error || '' });
    }
  }

  function reconcileMcp(records) {
    const ids = new Set(records.filter((record) => record.trigger.type === 'mcp').map((record) => record.id));
    for (const id of mcpRuntime.keys()) {
      if (!ids.has(id)) mcpRuntime.delete(id);
    }
    for (const id of ids) {
      if (!mcpRuntime.has(id)) {
        mcpRuntime.set(id, { nextPollAt: Date.now() + FIRST_POLL_MS, lastPollAt: 0, polling: false, error: '' });
      }
    }
  }

  function armStartup() {
    if (startupArmed) return;
    startupArmed = true;
    for (const record of enabledRecords('startup')) {
      const delay = Math.max(0, Math.min(600, Number(record.trigger.config?.delaySeconds) || 0)) * 1000;
      const timer = setTimeout(() => {
        startupTimers.delete(record.id);
        const current = findRecord(record.id);
        if (!isRunning(current) || current.trigger.type !== 'startup') return;
        void dispatchEvent(current, { type: 'startup', at: new Date().toISOString() }, { chain: [] });
      }, delay);
      timer.unref?.();
      startupTimers.set(record.id, timer);
      setRuntime(record.id, { state: 'armed' });
    }
  }

  async function reconcile() {
    if (!running) return status();
    const records = getSchedules().filter((record) => record && record.id);
    reconcileWatchers(records);
    reconcileMcp(records);
    await webhook.reconcile();
    return status();
  }

  async function start() {
    if (running) return status();
    running = true;
    startedAt = Date.now();
    triggerState = triggerStateModule.loadTriggerState();
    loaded = true;
    await reconcile();
    armStartup();
    tickTimer = setInterval(() => {
      void tick();
    }, TICK_MS);
    tickTimer.unref?.();
    return status();
  }

  async function stop() {
    if (!running && !loaded) return;
    running = false;
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = null;
    for (const entry of watchers.values()) closeEntry(entry);
    watchers.clear();
    for (const id of [...debounces.keys()]) closeDebounce(id);
    for (const timer of startupTimers.values()) clearTimeout(timer);
    startupTimers.clear();
    mcpRuntime.clear();
    sessionOrigins.clear();
    runtime.clear();
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (loaded) {
      try { triggerStateModule.saveTriggerState(triggerState); } catch {}
    }
    loaded = false;
    await webhook.stop();
  }

  async function tick() {
    if (!running || ticking) return;
    ticking = true;
    try {
      const records = getSchedules();
      for (const record of records) {
        if (!isRunning(record) || record.trigger.type !== 'mcp') continue;
        const entry = mcpRuntime.get(record.id) || {
          nextPollAt: Date.now() + FIRST_POLL_MS,
          lastPollAt: 0,
          polling: false,
          error: '',
        };
        mcpRuntime.set(record.id, entry);
        if (entry.polling || Date.now() < entry.nextPollAt) continue;
        const interval = Math.max(60, Number(record.trigger.config?.intervalSeconds) || 300);
        entry.polling = true;
        entry.nextPollAt = Date.now() + interval * 1000;
        entry.lastPollAt = Date.now();
        try {
          await pollNow(record);
        } finally {
          entry.polling = false;
        }
      }
      const retry = [...watchers.values()].some((entry) => entry.error && Date.now() >= entry.retryAt);
      if (retry) await reconcile();
    } finally {
      ticking = false;
    }
  }

  async function pollNow(record) {
    if (!running || !isRunning(record) || record.trigger?.type !== 'mcp') {
      return { ok: false, reason: 'paused' };
    }
    const config = record.trigger.config || {};
    let statuses = [];
    try {
      statuses = typeof mcp.statuses === 'function' ? mcp.statuses(getConfig()) : [];
    } catch {}
    const server = Array.isArray(statuses) ? statuses.find((entry) => entry.id === config.serverId) : null;
    if (server && server.connected === false) {
      const error = `MCP server ${config.serverId} is not connected.`;
      setRuntime(record.id, { state: 'error', lastError: error });
      return { ok: false, error };
    }

    let result;
    try {
      result = await mcp.callTool(config.serverId, config.toolName, config.args || {});
    } catch (err) {
      const error = String(err?.message || 'MCP call failed.').slice(0, 300);
      setRuntime(record.id, { state: 'error', lastError: error });
      return { ok: false, error };
    }

    const preview = normalizeContent(result);
    const hash = triggers.fingerprint(normalizeContent(result));
    const configHash = triggers.fingerprint({
      serverId: config.serverId,
      toolName: config.toolName,
      args: config.args || {},
    });
    if (!triggerState.mcp || typeof triggerState.mcp !== 'object') triggerState.mcp = {};
    const entry = triggerState.mcp[record.id];
    if (!entry || entry.configHash !== configHash) {
      triggerState.mcp[record.id] = {
        configHash,
        fingerprint: hash,
        baselineAt: new Date().toISOString(),
        lastError: '',
      };
      scheduleSave();
      setRuntime(record.id, { state: 'polling', lastError: '' });
      return { ok: true, baseline: true, changed: false };
    }
    if (entry.fingerprint === hash) {
      entry.lastError = '';
      setRuntime(record.id, { state: 'polling', lastError: '' });
      return { ok: true, baseline: false, changed: false };
    }

    const event = {
      type: 'mcp',
      at: new Date().toISOString(),
      recordId: record.id,
      serverId: config.serverId,
      toolName: config.toolName,
      preview: triggers.clipText(preview, 2048),
      changed: true,
    };
    const outcome = await dispatchEvent(record, event, { chain: [] });
    if (outcome.started) {
      entry.fingerprint = hash;
      entry.baselineAt = new Date().toISOString();
      scheduleSave();
    }
    return { ok: true, baseline: false, changed: true, ...outcome };
  }

  async function dispatchEvent(record, event, meta = {}) {
    if (!isRunning(record)) return { started: false, reason: 'paused' };
    const trigger = record.trigger;
    const enriched = {
      ...event,
      recordId: event.recordId || record.id,
      at: event.at || new Date().toISOString(),
    };
    if (!triggers.matchesEvent(trigger, enriched)) {
      return { started: false, reason: 'mismatch' };
    }

    const lastFired = triggerStateModule.lastFiredAt(triggerState, record.id);
    if (triggers.cooldownRemaining(trigger.cooldownSeconds, lastFired, Date.now()) > 0) {
      setRuntime(record.id, { lastSkip: 'cooldown' });
      return { started: false, reason: 'cooldown' };
    }

    const key = triggers.dedupeKey(trigger, enriched);
    if (key && triggerStateModule.seenRecently(triggerState, key, Date.now(), triggers.dedupeWindowMs(trigger))) {
      setRuntime(record.id, { lastSkip: 'duplicate' });
      return { started: false, reason: 'duplicate' };
    }

    let outcome;
    try {
      outcome = await dispatch(record, enriched, { chain: Array.isArray(meta.chain) ? meta.chain : [] });
    } catch (err) {
      outcome = { started: false, reason: 'error', error: String(err?.message || 'Dispatch failed.') };
    }
    if (!outcome || typeof outcome !== 'object') outcome = { started: false, reason: 'busy' };

    if (outcome.started) {
      triggerStateModule.markFired(triggerState, record.id, Date.now());
      if (key) triggerStateModule.rememberSeen(triggerState, key, Date.now());
      scheduleSave();
      setRuntime(record.id, {
        lastSkip: '',
        lastError: '',
        lastFiredAt: new Date().toISOString(),
      });
    } else {
      setRuntime(record.id, { lastSkip: outcome.reason || 'busy' });
    }
    return outcome;
  }

  function handleFileEvent(record, input = {}) {
    if (!running || !isRunning(record) || record.trigger?.type !== 'file') return;
    if (!triggers.matchesEvent(record.trigger, { type: 'file', kind: input.kind })) return;
    const target = String(input.path || '');
    if (!target) return;

    const event = {
      type: 'file',
      at: new Date().toISOString(),
      recordId: record.id,
      kind: input.kind || 'change',
      path: target,
      mtimeMs: input.mtimeMs,
      size: input.size,
    };
    if (event.mtimeMs === undefined) {
      try {
        const stats = fs.statSync(target);
        event.mtimeMs = stats.mtimeMs;
        event.size = stats.size;
      } catch {}
    }

    const configured = Number(record.trigger.config?.debounceSeconds) || 3;
    const delay = fileDebounceMs === null ? configured * 1000 : fileDebounceMs;
    const previous = debounces.get(record.id);
    if (previous) clearTimeout(previous.timer);
    const timer = setTimeout(() => {
      debounces.delete(record.id);
      const current = findRecord(record.id);
      if (!isRunning(current) || current.trigger.type !== 'file') return;
      void dispatchEvent(current, event, { chain: [] });
    }, Math.max(0, delay));
    timer.unref?.();
    debounces.set(record.id, { timer, event });
  }

  async function notifyMessenger(input = {}) {
    if (!running) return [];
    const base = {
      type: 'messenger',
      at: input.at || new Date().toISOString(),
      provider: input.provider || '',
      chatId: input.chatId || '',
      label: input.label || '',
      text: input.text || '',
    };
    const results = [];
    const records = enabledRecords('messenger');
    for (const record of records) {
      const outcome = await dispatchEvent(record, { ...base, recordId: record.id }, { chain: [] });
      results.push(outcome);
    }
    return results;
  }

  function sessionExcerpt(session) {
    const messages = Array.isArray(session?.messages) ? session.messages : [];
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message?.role === 'assistant' && message.content) {
        return triggers.clipText(String(message.content), 1536);
      }
    }
    return '';
  }

  function sessionNames(list, limit = 10) {
    if (!Array.isArray(list)) return [];
    return list.slice(0, limit).map((entry) => {
      if (typeof entry === 'string') return entry;
      return String(entry?.title || entry?.name || entry?.path || '').trim();
    }).filter(Boolean);
  }

  async function notifySession(input = {}) {
    if (!running) return [];
    const sessionId = String(input.sessionId || '');
    const session = input.session || {};
    const outcome = input.outcome || {};
    const status = outcome.ok ? 'ok' : outcome.stopped ? 'stopped' : 'error';
    if (status === 'stopped') return [];

    const origin = sessionOrigins.get(sessionId) || null;
    const base = {
      type: 'session',
      at: new Date().toISOString(),
      sessionId,
      status,
      title: String(session.title || '').slice(0, 200),
      excerpt: sessionExcerpt(session),
      files: sessionNames(session.files),
      tasks: sessionNames(session.tasks),
    };

    const results = [];
    for (const record of enabledRecords('session')) {
      if (origin && origin.recordId === record.id) continue;
      if (origin && !record.trigger.config?.includeAutomationRuns) continue;
      const chain = origin ? [...(origin.chain || []), sessionId] : [];
      if (chain.length > SESSION_CHAIN_LIMIT) continue;
      const result = await dispatchEvent(record, { ...base, recordId: record.id }, { chain });
      results.push(result);
    }
    return results;
  }

  function noteAutomationSession(sessionId, info = {}) {
    if (!sessionId) return;
    sessionOrigins.set(sessionId, {
      recordId: String(info.recordId || ''),
      chain: Array.isArray(info.chain) ? info.chain : [],
    });
  }

  async function testTrigger(draft = {}) {
    try {
      const trigger = triggers.normalizeTrigger(draft, null, new Date());
      if (trigger.type !== 'mcp') return { ok: false, error: 'Only MCP triggers can be tested.' };
      const result = await mcp.callTool(trigger.config.serverId, trigger.config.toolName, trigger.config.args || {});
      const preview = normalizeContent(result);
      return {
        ok: true,
        preview: triggers.clipText(preview, 2000),
        hash: triggers.fingerprint(preview),
      };
    } catch (err) {
      return { ok: false, error: String(err?.message || 'Trigger test failed.') };
    }
  }

  function describe(record) {
    const trigger = record.trigger || {};
    const config = trigger.config || {};
    if (trigger.type === 'file') return `Watching ${Array.isArray(config.paths) ? config.paths.length : 0} path(s)`;
    if (trigger.type === 'startup') return 'Runs at launch';
    if (trigger.type === 'webhook') {
      const web = webhook.status();
      return web.running ? `Server ready on port ${web.port}` : 'Server stopped';
    }
    if (trigger.type === 'mcp') return `Every ${Math.round((Number(config.intervalSeconds) || 300) / 60)} min`;
    if (trigger.type === 'messenger') return String(config.provider || '');
    if (trigger.type === 'session') return config.on === 'error' ? 'When a chat fails' : 'When a chat completes';
    return 'Scheduled';
  }

  function status() {
    const records = getSchedules().filter((record) => record && record.id);
    const web = webhook.status();
    const automations = {};
    for (const record of records) {
      const id = record.id;
      const trigger = record.trigger || {};
      const entry = runtime.get(id) || {};
      const watcher = watchers.get(id);
      let state = 'ready';
      if (record.enabled === false) {
        state = 'paused';
      } else if (trigger.type === 'file') {
        state = watcher && watcher.closers.length ? 'watching' : watcher?.error ? 'error' : 'watching';
      } else if (trigger.type === 'startup') {
        state = startupTimers.has(id) ? 'armed' : 'ready';
      } else if (trigger.type === 'mcp') {
        state = entry.lastError ? 'error' : 'polling';
      } else if (trigger.type === 'webhook') {
        state = web.running ? 'ready' : 'error';
      }
      automations[id] = {
        state,
        detail: describe(record),
        lastSkip: entry.lastSkip || '',
        lastError: entry.lastError || watcher?.error || '',
        lastFiredAt: entry.lastFiredAt || '',
      };
    }
    return { webhook: web, automations };
  }

  return {
    start,
    stop,
    reconcile,
    noteAutomationSession,
    notifySession,
    notifyMessenger,
    pollNow,
    handleFileEvent,
    testTrigger,
    status,
    markQueuedRunStarted(id) {
      if (!running) return;
      setRuntime(String(id || ''), { lastSkip: '', lastError: '' });
      scheduleSave();
    },
  };
}

module.exports = { createTriggerEngine, createDebouncer };
