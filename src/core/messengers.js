'use strict';

/**
 * Messenger connections for blank.
 *
 * A chat must be paired with the six-digit code shown in Settings before it can
 * start runs or approve tools. Tokens stay in config.json and never leave the
 * main process. Errors are redacted before they reach the renderer or logs.
 */

const http = require('http');
const crypto = require('crypto');
const configModule = require('./config');

const PROVIDERS = ['telegram', 'discord', 'slack', 'webhook'];
const MAX_TEXT = 20000;
const MAX_LINKS = 80;
const MAX_SEEN_RUNS = 60;
const UNPAIRED_REPLY_MS = 20000;
const PAIR_WINDOW_MS = 10 * 60 * 1000;
const PAIR_ATTEMPTS = 20;
const CHAT_RATE_WINDOW_MS = 60 * 1000;
const CHAT_RATE_LIMIT = 24;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const now = () => Date.now();

function chunkText(text, limit) {
  const value = String(text || '').replace(/\r/g, '').trim();
  if (!value) return [];
  if (value.length <= limit) return [value];
  const out = [];
  let rest = value;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit);
    if (cut < Math.floor(limit * 0.5)) cut = rest.lastIndexOf(' ', limit);
    if (cut < Math.floor(limit * 0.5)) cut = limit;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

function parseCommand(input) {
  const text = String(input || '').trim();
  if (!text.startsWith('/')) return { name: 'text', arg: text };
  const [first] = text.split(/\s+/);
  const name = first.slice(1).split('@')[0].toLowerCase();
  const arg = text.slice(first.length).trim();
  return { name, arg };
}

function maskToken(value) {
  const token = String(value || '');
  if (!token) return '';
  if (token.length <= 8) return '••••';
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  if (!a.length || a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(a, b); } catch { return false; }
}

function freshRuntime() {
  return { running: false, botName: '', error: '', lastAt: 0, startedAt: 0, stop: null, generation: 0 };
}

function createMessengerService(options = {}) {
  const config = options.configModule || configModule;
  const fetchImpl = options.fetch || ((...args) => fetch(...args));
  const WebSocketImpl = options.WebSocket || WebSocket;
  const readHandlers = typeof options.handlers === 'function' ? options.handlers : () => options.handlers;
  let onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};
  const endpoint = String(options.telegramBaseUrl || '').replace(/\/+$/, '');

  const runtime = Object.fromEntries(PROVIDERS.map((provider) => [provider, freshRuntime()]));
  const senders = {};
  const approvalSenders = {};
  const sessionOrigins = new Map();
  const runOrigins = new Map();
  const approvalTargets = new Map();
  const finishedRuns = new Map();
  const finishedSessions = new Map();
  const waiters = new Map();
  const unpairedReplies = new Map();
  const chatRate = new Map();
  const pairFailures = [];
  let started = false;
  let lastActive = null;
  let pairCode = '';

  /* -------------------------------------------------------------- config */

  function readRoot() {
    const root = config.loadConfig().messengers;
    return root && typeof root === 'object' ? root : {};
  }

  function readProvider(provider) {
    const entry = readRoot()[provider];
    return entry && typeof entry === 'object' ? entry : {};
  }

  function updateProvider(provider, mutate) {
    const file = config.loadConfig();
    if (!file.messengers || typeof file.messengers !== 'object') file.messengers = {};
    if (!file.messengers[provider] || typeof file.messengers[provider] !== 'object') file.messengers[provider] = {};
    mutate(file.messengers[provider], file.messengers);
    config.saveConfig(file);
  }

  function updateRoot(mutate) {
    const file = config.loadConfig();
    if (!file.messengers || typeof file.messengers !== 'object') file.messengers = {};
    mutate(file.messengers);
    config.saveConfig(file);
  }

  function ensurePairCode() {
    const current = String(readRoot().pairCode || '');
    if (/^\d{6}$/.test(current)) {
      pairCode = current;
      return;
    }
    pairCode = String(crypto.randomInt(100000, 1000000));
    updateRoot((root) => { root.pairCode = pairCode; });
  }

  function rotatePairCode() {
    pairCode = String(crypto.randomInt(100000, 1000000));
    updateRoot((root) => { root.pairCode = pairCode; });
    emitStatus();
  }

  function linksOf(provider) {
    const links = readProvider(provider).links;
    return links && typeof links === 'object' ? links : {};
  }

  function paired(provider, chatId) {
    return Boolean(linksOf(provider)[String(chatId)]);
  }

  function addLink(provider, chatId, sessionId, label) {
    const at = new Date().toISOString();
    updateProvider(provider, (entry) => {
      const links = entry.links && typeof entry.links === 'object' ? entry.links : {};
      links[String(chatId)] = {
        sessionId: String(sessionId || ''),
        title: String(label || '').slice(0, 120),
        at,
      };
      entry.links = Object.fromEntries(
        Object.entries(links)
          .sort((a, b) => String(b[1]?.at || '').localeCompare(String(a[1]?.at || '')))
          .slice(0, MAX_LINKS),
      );
      entry.lastChatId = String(chatId).slice(0, 200);
    });
  }

  function updateLink(provider, chatId, patch) {
    updateProvider(provider, (entry) => {
      const links = entry.links && typeof entry.links === 'object' ? entry.links : {};
      if (!links[String(chatId)]) return;
      links[String(chatId)] = {
        ...links[String(chatId)],
        ...patch,
        at: new Date().toISOString(),
      };
      entry.links = links;
    });
  }

  function clearLinks(provider) {
    updateProvider(provider, (entry) => {
      entry.links = {};
      entry.lastChatId = '';
    });
  }

  function markActive(provider, chatId) {
    lastActive = { provider, chatId: String(chatId), at: now() };
    const entry = readProvider(provider);
    if (String(entry.lastChatId || '') !== String(chatId)) {
      updateProvider(provider, (target) => { target.lastChatId = String(chatId).slice(0, 200); });
    }
  }

  function secretsFor(provider) {
    const entry = readProvider(provider);
    return [entry.token, entry.appToken, entry.botToken, entry.secret].filter((value) => value);
  }

  function redact(provider, error) {
    let text = String((error && error.message) || error || '').replace(/\s+/g, ' ').trim();
    for (const secret of secretsFor(provider)) {
      if (secret) text = text.split(secret).join('[redacted]');
    }
    text = text.replace(/\b\d{5,12}:[A-Za-z0-9_-]{10,}\b/g, '[redacted]');
    text = text.replace(/xox[abp]-[A-Za-z0-9-]+/g, '[redacted]');
    text = text.replace(/xapp-[A-Za-z0-9-]+/g, '[redacted]');
    return text.slice(0, 400) || 'Connection failed.';
  }

  function setError(provider, error) {
    const rt = runtime[provider];
    if (!rt) return;
    rt.error = redact(provider, error);
    rt.lastAt = now();
    emitStatus();
  }

  function clearError(provider) {
    const rt = runtime[provider];
    if (!rt || !rt.error) return;
    rt.error = '';
    emitStatus();
  }

  function emitStatus() {
    try { onStatus(status()); } catch {}
  }

  /* -------------------------------------------------------------- status */

  function status() {
    const root = readRoot();
    const result = {
      started,
      notify: root.notify !== false,
      pairCode,
      lastActive: lastActive ? { provider: lastActive.provider, at: lastActive.at } : null,
    };
    for (const provider of PROVIDERS) {
      const entry = readProvider(provider);
      const rt = runtime[provider];
      const links = linksOf(provider);
      const base = {
        enabled: entry.enabled === true,
        running: Boolean(rt?.running),
        paired: Object.keys(links).length,
        botName: rt?.botName || '',
        error: rt?.error || '',
        lastAt: rt?.lastAt || 0,
      };
      if (provider === 'telegram' || provider === 'discord') {
        base.hasToken = Boolean(entry.token);
        base.tokenPreview = maskToken(entry.token);
      } else if (provider === 'slack') {
        base.hasAppToken = Boolean(entry.appToken);
        base.hasBotToken = Boolean(entry.botToken);
        base.appTokenPreview = maskToken(entry.appToken);
        base.botTokenPreview = maskToken(entry.botToken);
      } else {
        const port = Number(entry.port) || 8789;
        base.port = port;
        base.endpoint = `http://127.0.0.1:${port}/message`;
        base.approvalsEndpoint = `http://127.0.0.1:${port}/approvals`;
        base.hasSecret = Boolean(entry.secret);
        base.secret = String(entry.secret || '');
        base.url = String(entry.url || '');
      }
      result[provider] = base;
    }
    return result;
  }

  /* ----------------------------------------------------------- lifecycle */

  function stopProvider(provider) {
    const rt = runtime[provider];
    rt.generation += 1;
    let closing = null;
    if (rt?.stop) {
      try { closing = rt.stop(); } catch {}
      rt.stop = null;
    }
    rt.running = false;
    rt.botName = '';
    rt.startedAt = 0;
    senders[provider] = null;
    approvalSenders[provider] = null;
    return closing;
  }

  function startProvider(provider) {
    if (options.network === false) return;
    const entry = readProvider(provider);
    if (entry.enabled !== true) return;
    try {
      if (provider === 'telegram') {
        if (!entry.token) return;
        startTelegram(entry);
      } else if (provider === 'discord') {
        if (!entry.token) return;
        startDiscord(entry);
      } else if (provider === 'slack') {
        if (!entry.appToken || !entry.botToken) return;
        startSlack(entry);
      } else if (provider === 'webhook') {
        startWebhook(entry);
      }
    } catch (error) {
      setError(provider, error);
    }
  }

  async function restartProvider(provider) {
    const closing = stopProvider(provider);
    if (closing && typeof closing.then === 'function') {
      try { await closing; } catch {}
    }
    startProvider(provider);
  }

  function start() {
    if (started) return status();
    started = true;
    ensurePairCode();
    const root = readRoot();
    const anyEnabled = PROVIDERS.some((provider) => root[provider]?.enabled === true);
    if (anyEnabled && options.network !== false) {
      for (const provider of PROVIDERS) startProvider(provider);
    }
    emitStatus();
    return status();
  }

  function dispose() {
    started = false;
    for (const provider of PROVIDERS) stopProvider(provider);
    for (const set of waiters.values()) {
      for (const resolve of set) {
        try { resolve(null); } catch {}
      }
    }
    waiters.clear();
    sessionOrigins.clear();
    runOrigins.clear();
    approvalTargets.clear();
    emitStatus();
  }

  /* ------------------------------------------------------------- pairing */

  function pairHelp() {
    return 'This chat is not paired. Open blank → Settings → Messengers, copy the pairing code, then send:\n/pair <code>';
  }

  function pairingBlocked() {
    const cutoff = now() - PAIR_WINDOW_MS;
    while (pairFailures.length && pairFailures[0] < cutoff) pairFailures.shift();
    return pairFailures.length >= PAIR_ATTEMPTS;
  }

  function notePairFailure() {
    pairFailures.push(now());
  }

  function handlePair(provider, chatId, code, label) {
    if (String(code || '') !== String(pairCode)) {
      notePairFailure();
      if (pairingBlocked()) return 'Too many pairing attempts. Wait ten minutes and try again.';
      return 'That pairing code is not correct. Copy the current code from blank → Settings → Messengers.';
    }
    addLink(provider, chatId, '', label);
    markActive(provider, chatId);
    rotatePairCode();
    return 'Paired with blank. Send a message to start, or /help for commands.\nUse /sessions to pick an existing session.';
  }

  /* ------------------------------------------------------------ receiving */

  function underRate(provider, chatId) {
    const key = `${provider}:${chatId}`;
    const bucket = chatRate.get(key) || [];
    const cutoff = now() - CHAT_RATE_WINDOW_MS;
    const recent = bucket.filter((at) => at >= cutoff);
    if (recent.length >= CHAT_RATE_LIMIT) {
      chatRate.set(key, recent);
      return false;
    }
    recent.push(now());
    chatRate.set(key, recent);
    if (chatRate.size > 400) {
      for (const [entry, times] of chatRate) {
        if (!times.length || times[times.length - 1] < cutoff) chatRate.delete(entry);
      }
    }
    return true;
  }

  async function receive(provider, chatIdInput, textInput, meta = {}) {
    const chatId = String(chatIdInput || '').slice(0, 200);
    const text = String(textInput || '').replace(/\r/g, '').trim().slice(0, MAX_TEXT);
    if (!chatId || !text) return { reply: '' };
    const entry = readProvider(provider);
    if (entry.enabled !== true) return { reply: '' };
    if (!underRate(provider, chatId)) return { reply: '' };

    const label = String(meta.label || '').slice(0, 120);
    const pairedChat = paired(provider, chatId);

    if (!pairedChat) {
      const command = parseCommand(text);
      if (command.name === 'pair') {
        if (pairingBlocked()) return { reply: 'Too many pairing attempts. Wait ten minutes and try again.' };
        return { reply: handlePair(provider, chatId, command.arg, label) };
      }
      const seen = unpairedReplies.get(`${provider}:${chatId}`) || 0;
      if (now() - seen < UNPAIRED_REPLY_MS) return { reply: '' };
      unpairedReplies.set(`${provider}:${chatId}`, now());
      return { reply: pairHelp() };
    }

    markActive(provider, chatId);
    const handlers = readHandlers();
    if (!handlers) return { reply: 'blank is still starting. Try again in a moment.' };

    const command = parseCommand(text);
    if (command.name !== 'text') {
      return handleCommand(provider, chatId, command, handlers, label);
    }

    const link = linksOf(provider)[chatId] || {};
    let sessionId = String(link.sessionId || '');
    if (sessionId && handlers.getSession && !handlers.getSession(sessionId)) sessionId = '';
    try {
      const result = await handlers.send({ text, sessionId: sessionId || undefined, mode: meta.mode });
      const nextSession = String(result?.sessionId || sessionId || '');
      if (nextSession) {
        updateLink(provider, chatId, { sessionId: nextSession, title: result?.title || link.title || '' });
        sessionOrigins.set(nextSession, { provider, chatId, at: now() });
        finishedSessions.delete(nextSession);
      }
      if (result?.queued) {
        return { reply: `Queued behind the current run · ${result.title || 'session'}`, sessionId: nextSession, queued: true };
      }
      return { reply: `Working on it · ${result?.title || 'new session'}`, sessionId: nextSession, runId: String(result?.runId || '') };
    } catch (error) {
      return { reply: `blank could not start: ${redact(provider, error)}` };
    }
  }

  async function handleCommand(provider, chatId, command, handlers, label) {
    const link = linksOf(provider)[chatId] || {};
    const sessionId = String(link.sessionId || '');

    if (command.name === 'help') {
      return {
        reply: [
          'Commands',
          '/new — start a fresh session',
          '/sessions — list recent sessions',
          '/use <number> — switch session',
          '/stop — stop the current run',
          '/status — model, session and approvals',
          '/approve allow|deny — answer the latest approval',
          '/notify on|off — run and approval messages',
          '/unpair — remove this chat',
          'Anything else is sent to the current session.',
        ].join('\n'),
      };
    }

    if (command.name === 'pair') {
      return { reply: 'This chat is already paired.' };
    }

    if (command.name === 'unpair') {
      updateProvider(provider, (entry) => {
        const links = entry.links && typeof entry.links === 'object' ? entry.links : {};
        delete links[chatId];
        entry.links = links;
        if (String(entry.lastChatId || '') === chatId) entry.lastChatId = '';
      });
      sessionOrigins.forEach((origin, key) => {
        if (origin.provider === provider && origin.chatId === chatId) sessionOrigins.delete(key);
      });
      if (lastActive?.provider === provider && lastActive?.chatId === chatId) lastActive = null;
      return { reply: 'Unpaired. Use /pair with the current code to reconnect.' };
    }

    if (command.name === 'notify') {
      const value = command.arg.toLowerCase();
      if (value === 'on' || value === 'off') {
        updateRoot((root) => { root.notify = value === 'on'; });
        emitStatus();
        return { reply: value === 'on' ? 'Run and approval messages are on.' : 'Run and approval messages are off.' };
      }
      return { reply: `Run and approval messages are ${readRoot().notify !== false ? 'on' : 'off'}. Use /notify on or /notify off.` };
    }

    if (command.name === 'new') {
      if (!handlers.createSession) return { reply: 'blank cannot create a session right now.' };
      try {
        const created = handlers.createSession();
        updateLink(provider, chatId, { sessionId: created.id, title: created.title || 'New session' });
        sessionOrigins.set(created.id, { provider, chatId, at: now() });
        return { reply: `New session · ${created.title || 'New session'}\nSend a message when you are ready.` };
      } catch (error) {
        return { reply: `blank could not create a session: ${redact(provider, error)}` };
      }
    }

    if (command.name === 'sessions') {
      const sessions = (handlers.listSessions?.() || []).slice(0, 10);
      if (!sessions.length) return { reply: 'No sessions yet. Send a message to start one.' };
      const rows = sessions.map((session, index) => {
        const current = session.id === sessionId ? '*' : ' ';
        const running = handlers.isRunning?.(session.id) ? ' · running' : '';
        return `${index + 1}.${current} ${String(session.title || 'New session').slice(0, 60)}${running}`;
      });
      return { reply: `Recent sessions\n${rows.join('\n')}\n\nUse /use <number> to switch.` };
    }

    if (command.name === 'use') {
      const sessions = (handlers.listSessions?.() || []).slice(0, 10);
      const index = Number(command.arg);
      let chosen = null;
      if (Number.isInteger(index) && index >= 1 && index <= sessions.length) chosen = sessions[index - 1];
      else if (command.arg) chosen = sessions.find((session) => String(session.id) === command.arg) || sessions.find((session) => String(session.id).startsWith(command.arg));
      if (!chosen) return { reply: 'Session not found. Use /sessions to see the current list.' };
      updateLink(provider, chatId, { sessionId: chosen.id, title: chosen.title || '' });
      sessionOrigins.set(chosen.id, { provider, chatId, at: now() });
      return { reply: `Switched to ${String(chosen.title || 'session').slice(0, 80)}${handlers.isRunning?.(chosen.id) ? ' · running' : ''}` };
    }

    if (command.name === 'stop') {
      if (!sessionId) return { reply: 'No session is active in this chat.' };
      try {
        const result = await handlers.stop(sessionId);
        return { reply: result?.ok ? 'Stopped.' : 'Nothing is running in this session.' };
      } catch (error) {
        return { reply: `Could not stop: ${redact(provider, error)}` };
      }
    }

    if (command.name === 'status') {
      const session = sessionId ? handlers.getSession?.(sessionId) : null;
      const pending = (handlers.pendingApprovals?.() || []).filter((approval) => approval.sessionId === sessionId);
      const lines = [
        `blank ${handlers.version ? handlers.version() : ''}`.trim(),
        session ? `Session · ${String(session.title || 'New session').slice(0, 80)}` : 'No session yet',
        session ? `Model · ${session.model || 'default'}` : '',
        sessionId && handlers.isRunning?.(sessionId) ? 'Run · working' : 'Run · idle',
        pending.length ? `Approvals · ${pending.length} waiting` : 'Approvals · none',
      ].filter(Boolean);
      return { reply: lines.join('\n') };
    }

    if (command.name === 'approve' || command.name === 'deny') {
      if (!sessionId) return { reply: 'No session is active in this chat.' };
      const parts = command.arg.split(/\s+/).filter(Boolean);
      const decision = command.name === 'deny' ? 'deny' : (parts.find((part) => ['allow', 'deny', 'always'].includes(part.toLowerCase())) || 'allow').toLowerCase();
      const approvalId = parts.length > 1 ? parts[0] : '';
      const pending = (handlers.pendingApprovals?.() || []).filter((approval) => approval.sessionId === sessionId);
      const target = approvalId
        ? pending.find((approval) => approval.approvalId === approvalId)
        : pending[pending.length - 1];
      if (!target) return { reply: 'No approval is waiting for this session.' };
      const result = await handlers.approve({ approvalId: target.approvalId, decision });
      approvalTargets.delete(target.approvalId);
      return { reply: result?.ok ? `${decision === 'deny' ? 'Denied' : 'Allowed'} · ${target.label || target.tool || 'tool'}` : 'That approval already expired.' };
    }

    return { reply: 'Unknown command. Use /help to see what this chat can do.' };
  }

  /* ------------------------------------------------------------- approval */

  function approval(payload = {}) {
    if (!payload.approvalId) return false;
    const handlers = readHandlers();
    if (!handlers) return false;
    const origin = sessionOrigins.get(payload.sessionId);
    const target = origin && paired(origin.provider, origin.chatId)
      ? origin
      : notificationTarget();
    if (!target) return false;
    if (!origin && readRoot().notify === false) return false;
    const text = [
      `Approval needed · ${String(payload.label || payload.tool || 'Tool').slice(0, 100)}`,
      String(payload.summary || '').replace(/\s+/g, ' ').trim().slice(0, 900),
      'Use /approve allow or /approve deny, or press a button.',
    ].filter(Boolean).join('\n');
    const entry = { ...target, approvalId: payload.approvalId, sessionId: payload.sessionId || '', text, at: now() };
    approvalTargets.set(payload.approvalId, entry);
    const cutoff = now() - 60 * 60 * 1000;
    for (const [id, value] of approvalTargets) {
      if (value.at < cutoff) approvalTargets.delete(id);
    }
    if (approvalTargets.size > 120) {
      const oldest = [...approvalTargets.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) approvalTargets.delete(oldest[0]);
    }
    const send = approvalSenders[target.provider];
    if (send) send(target.chatId, entry).catch((error) => setError(target.provider, error));
    return true;
  }

  async function decide(provider, chatId, approvalId, decisionInput) {
    const target = approvalTargets.get(String(approvalId || ''));
    if (!target || target.provider !== provider || String(target.chatId) !== String(chatId)) {
      return { ok: false, error: 'This approval expired.', target: null };
    }
    if (!paired(provider, chatId)) return { ok: false, error: 'This chat is not paired.', target: null };
    const decision = decisionInput === 'deny' ? 'deny' : 'allow';
    const handlers = readHandlers();
    if (!handlers) return { ok: false, error: 'blank is not ready.', target: null };
    const result = await handlers.approve({ approvalId, decision });
    approvalTargets.delete(String(approvalId));
    if (result?.ok) markActive(provider, chatId);
    return { ...result, decision, target };
  }

  /* ----------------------------------------------------------- publishing */

  function notificationTarget() {
    if (lastActive && paired(lastActive.provider, lastActive.chatId)) return { provider: lastActive.provider, chatId: lastActive.chatId };
    for (const provider of PROVIDERS) {
      const entry = readProvider(provider);
      const chatId = String(entry.lastChatId || '');
      if (chatId && paired(provider, chatId)) return { provider, chatId };
    }
    return null;
  }

  function finalText(sessionId, event) {
    const handlers = readHandlers();
    const session = sessionId ? handlers?.getSession?.(sessionId) : null;
    const title = String(session?.title || event?.title || '').slice(0, 80);
    if (event?.outcome?.error) {
      return `Run failed${title ? ` · ${title}` : ''}\n${String(event.outcome.error).replace(/\s+/g, ' ').slice(0, 700)}`;
    }
    if (event?.outcome?.stopped) return `Stopped${title ? ` · ${title}` : ''}`;
    const messages = session?.messages || [];
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message.role !== 'assistant') continue;
      const text = String(message.content || '').trim();
      if (text) return text.length > 3500 ? `${text.slice(0, 3450)}\n\n… open blank for the full answer.` : text;
    }
    return `Finished${title ? ` · ${title}` : ''}`;
  }

  function storeFinished(runId, sessionId, text) {
    if (runId) {
      finishedRuns.set(runId, text);
      while (finishedRuns.size > MAX_SEEN_RUNS) finishedRuns.delete(finishedRuns.keys().next().value);
    }
    if (sessionId) {
      finishedSessions.set(sessionId, text);
      while (finishedSessions.size > MAX_SEEN_RUNS) finishedSessions.delete(finishedSessions.keys().next().value);
    }
    const keys = [runId ? `run:${runId}` : '', sessionId ? `session:${sessionId}` : ''].filter(Boolean);
    for (const key of keys) {
      const set = waiters.get(key);
      if (!set) continue;
      for (const resolve of set) {
        try { resolve(text); } catch {}
      }
      waiters.delete(key);
    }
  }

  function waitForRun(runId, sessionId, timeoutMs = 90000) {
    if (runId && finishedRuns.has(runId)) return Promise.resolve(finishedRuns.get(runId));
    if (!runId && sessionId && finishedSessions.has(sessionId)) return Promise.resolve(finishedSessions.get(sessionId));
    const key = runId ? `run:${runId}` : `session:${sessionId}`;
    if (!runId && !sessionId) return Promise.resolve(null);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => finish(null), Math.max(1000, Math.min(120000, timeoutMs)));
      let set = waiters.get(key);
      if (!set) {
        set = new Set();
        waiters.set(key, set);
      }
      set.add(finish);
    });
  }

  function publish(event = {}) {
    if (!event || !event.type) return;
    if (event.type === 'run:start') {
      const origin = sessionOrigins.get(event.sessionId);
      if (origin) runOrigins.set(event.runId, origin);
      return;
    }
    if (event.type !== 'run:done') return;
    const origin = runOrigins.get(event.runId) || sessionOrigins.get(event.sessionId) || null;
    if (event.runId) runOrigins.delete(event.runId);
    const text = finalText(event.sessionId, event);
    storeFinished(event.runId, event.sessionId, text);
    const fromChat = origin && paired(origin.provider, origin.chatId) ? origin : null;
    if (!fromChat && readRoot().notify === false) return;
    const target = fromChat || notificationTarget();
    if (!target) return;
    const send = senders[target.provider];
    if (!send) return;
    const body = fromChat ? text : `blank · ${String(event.title || 'Run finished').slice(0, 80)}\n\n${text}`;
    send(target.chatId, body, { sessionId: event.sessionId }).catch((error) => setError(target.provider, error));
  }

  /* ------------------------------------------------------------- adapters */

  function loop(provider, task) {
    const controller = new AbortController();
    const rt = runtime[provider];
    const generation = ++rt.generation;
    rt.stop = () => controller.abort();
    rt.running = true;
    rt.startedAt = now();
    (async () => {
      try {
        await task(controller.signal);
      } catch (error) {
        if (!controller.signal.aborted) setError(provider, error);
      } finally {
        if (rt.generation === generation) {
          rt.running = false;
          rt.stop = null;
          emitStatus();
        }
      }
    })();
    emitStatus();
  }

  function telegramBase() {
    if (endpoint) return endpoint;
    const override = String(process.env.BLANK_TELEGRAM_API || '').trim().replace(/\/+$/, '');
    if (!override) return 'https://api.telegram.org';
    try {
      const url = new URL(override);
      if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return override;
    } catch {}
    return 'https://api.telegram.org';
  }

  async function requestJson(url, init, timeoutMs, stopSignal) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('Request timed out.')), timeoutMs);
    const onAbort = () => controller.abort();
    if (stopSignal) {
      if (stopSignal.aborted) controller.abort();
      else stopSignal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      const response = await fetchImpl(url, { ...init, signal: controller.signal });
      const raw = await response.text();
      let data = null;
      try { data = raw ? JSON.parse(raw) : {}; } catch { data = null; }
      if (!response.ok) {
        const detail = data && (data.description || data.message || data.error);
        throw new Error(`HTTP ${response.status}${detail ? ` · ${detail}` : ''}`);
      }
      if (data === null) throw new Error('The service returned an invalid response.');
      return data;
    } finally {
      clearTimeout(timer);
      if (stopSignal) stopSignal.removeEventListener('abort', onAbort);
    }
  }

  function startTelegram(entry) {
    const provider = 'telegram';
    const token = String(entry.token || '');
    const base = telegramBase();
    senders.telegram = async (chatId, text, extra = {}) => {
      const chunks = chunkText(text, 3700);
      for (let i = 0; i < chunks.length; i += 1) {
        await telegramCall('sendMessage', {
          chat_id: chatId,
          text: chunks[i],
          disable_web_page_preview: true,
        });
      }
      if (extra.sessionId) {
        // Sending the final answer keeps the chat linked to the same session.
        sessionOrigins.set(extra.sessionId, { provider, chatId: String(chatId), at: now() });
      }
      return true;
    };
    approvalSenders.telegram = async (chatId, target) => {
      await telegramCall('sendMessage', {
        chat_id: chatId,
        text: target.text,
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [[
            { text: 'Allow', callback_data: `apv:${target.approvalId}:allow` },
            { text: 'Deny', callback_data: `apv:${target.approvalId}:deny` },
          ]],
        },
      });
      return true;
    };

    async function telegramCall(method, params, signal) {
      const data = await requestJson(
        `${base}/bot${token}/${method}`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params || {}) },
        method === 'getUpdates' ? 45000 : 15000,
        signal,
      );
      if (!data.ok) throw new Error(String(data.description || `Telegram ${method} failed.`));
      return data.result;
    }

    loop(provider, async (signal) => {
      let offset = 0;
      let ready = false;
      let backoff = 2000;
      while (!signal.aborted) {
        try {
          if (!ready) {
            const me = await telegramCall('getMe', {}, signal);
            runtime.telegram.botName = String(me?.username || me?.first_name || '');
            ready = true;
            clearError(provider);
          }
          const updates = await telegramCall('getUpdates', {
            offset,
            timeout: 25,
            allowed_updates: ['message', 'callback_query'],
          }, signal);
          backoff = 2000;
          for (const update of updates || []) {
            if (signal.aborted) break;
            const id = Number(update.update_id);
            if (Number.isFinite(id)) offset = Math.max(offset, id + 1);
            if (update.message) {
              const message = update.message;
              const from = message.from || {};
              if (from.is_bot) continue;
              const chatId = String(message.chat?.id || '');
              if (!chatId) continue;
              if (!message.text) {
                if (paired(provider, chatId)) await senders.telegram(chatId, 'Text messages only for now.');
                continue;
              }
              const label = [message.chat?.title, from.username ? `@${from.username}` : from.first_name].filter(Boolean).join(' · ');
              const result = await receive(provider, chatId, message.text, { label });
              if (result.reply) await senders.telegram(chatId, result.reply, { sessionId: result.sessionId });
            } else if (update.callback_query) {
              const query = update.callback_query;
              if (query.from?.is_bot) continue;
              const chatId = String(query.message?.chat?.id || query.from?.id || '');
              const [tag, approvalId, decision] = String(query.data || '').split(':');
              if (tag !== 'apv' || !chatId) continue;
              const result = await decide(provider, chatId, approvalId, decision);
              try {
                await telegramCall('answerCallbackQuery', {
                  callback_query_id: query.id,
                  text: result.ok ? (decision === 'deny' ? 'Denied.' : 'Allowed.') : 'That approval expired.',
                  show_alert: false,
                }, signal);
              } catch {}
              if (result.ok && query.message?.message_id && result.target) {
                try {
                  await telegramCall('editMessageText', {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    text: `${result.target.text}\n\n${decision === 'deny' ? 'Denied' : 'Allowed'}.`,
                    reply_markup: { inline_keyboard: [] },
                  }, signal);
                } catch {}
              }
            }
          }
          if (!updates || !updates.length) await sleep(250);
        } catch (error) {
          if (signal.aborted) return;
          setError(provider, error);
          await sleep(backoff);
          backoff = Math.min(backoff * 2, 30000);
        }
      }
    });
  }

  function startDiscord(entry) {
    const provider = 'discord';
    const token = String(entry.token || '');
    const base = 'https://discord.com/api/v10';
    let botId = '';

    async function discordCall(method, path, body, signal) {
      const response = await requestJson(`${base}${path}`, {
        method,
        headers: {
          authorization: `Bot ${token}`,
          'content-type': 'application/json',
          'user-agent': 'blank (https://github.com/purplemacaron/blank)',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }, 15000, signal);
      return response;
    }

    senders.discord = async (chatId, text, extra = {}) => {
      for (const chunk of chunkText(text, 1900)) {
        await discordCall('POST', `/channels/${encodeURIComponent(chatId)}/messages`, { content: chunk });
      }
      if (extra.sessionId) sessionOrigins.set(extra.sessionId, { provider, chatId: String(chatId), at: now() });
      return true;
    };
    approvalSenders.discord = async (chatId, target) => {
      await discordCall('POST', `/channels/${encodeURIComponent(chatId)}/messages`, {
        content: target.text,
        components: [{
          type: 1,
          components: [
            { type: 2, style: 3, label: 'Allow', custom_id: `apv:${target.approvalId}:allow` },
            { type: 2, style: 4, label: 'Deny', custom_id: `apv:${target.approvalId}:deny` },
          ],
        }],
      });
      return true;
    };

    async function handleMessage(data) {
      if (!data || data.author?.bot) return;
      let text = String(data.content || '');
      if (data.guild_id) {
        if (!Array.isArray(data.mentions) || !data.mentions.some((member) => member.id === botId)) return;
        text = text.replace(new RegExp(`<@!?${botId}>`, 'g'), '').trim();
      }
      if (!text) {
        const chatId = String(data.channel_id || '');
        if (chatId && paired(provider, chatId)) await senders.discord(chatId, 'Text messages only for now.');
        return;
      }
      const chatId = String(data.channel_id || '');
      if (!chatId) return;
      const label = String(data.author?.global_name || data.author?.username || '').slice(0, 120);
      const result = await receive(provider, chatId, text, { label });
      if (result.reply) await senders.discord(chatId, result.reply, { sessionId: result.sessionId });
    }

    async function handleInteraction(data) {
      if (!data || data.type !== 3) return;
      const [tag, decision, approvalId] = String(data.data?.custom_id || '').split(':');
      if (tag !== 'apv' || !approvalId) return;
      const chatId = String(data.channel_id || '');
      const result = await decide(provider, chatId, approvalId, decision);
      const content = result.ok && result.target
        ? `${result.target.text}\n\n${decision === 'deny' ? 'Denied' : 'Allowed'}.`
        : 'This approval expired.';
      await discordCall('POST', `/interactions/${data.id}/${data.token}/callback`, {
        type: 7,
        data: { content, components: [] },
      });
    }

    loop(provider, async (signal) => {
      let backoff = 3000;
      while (!signal.aborted) {
        try {
          if (!botId) {
            const me = await discordCall('GET', '/users/@me', undefined, signal);
            botId = String(me?.id || '');
            runtime.discord.botName = String(me?.username || '');
            clearError(provider);
          }
          const gateway = await discordCall('GET', '/gateway/bot', undefined, signal);
          const url = String(gateway?.url || 'wss://gateway.discord.gg');
          await new Promise((resolve, reject) => {
            const socket = new WebSocketImpl(`${url}/?v=10&encoding=json`);
            let heartbeat = null;
            let sequence = null;
            let settled = false;
            let timer = null;
            const finish = (error) => {
              if (settled) return;
              settled = true;
              if (heartbeat) clearInterval(heartbeat);
              if (timer) clearTimeout(timer);
              try { socket.close(); } catch {}
              if (error) reject(error);
              else resolve();
            };
            const failFatal = (message) => {
              const error = new Error(message);
              error.fatal = true;
              finish(error);
            };
            timer = setTimeout(() => finish(new Error('Discord gateway connection timed out.')), 25000);
            socket.addEventListener('open', () => {
              if (timer) clearTimeout(timer);
              timer = null;
            });
            socket.addEventListener('message', (event) => {
              let payload = null;
              try { payload = JSON.parse(event.data); } catch { return; }
              if (Number.isFinite(payload.s)) sequence = payload.s;
              if (payload.op === 10) {
                const interval = Math.max(5000, Number(payload.d?.heartbeat_interval) || 41250);
                heartbeat = setInterval(() => {
                  try { socket.send(JSON.stringify({ op: 1, d: sequence })); } catch {}
                }, interval);
                try {
                  socket.send(JSON.stringify({
                    op: 2,
                    d: {
                      token,
                      intents: (1 << 0) | (1 << 9) | (1 << 12) | (1 << 15),
                      properties: { os: 'blank', browser: 'blank', device: 'blank' },
                    },
                  }));
                } catch (error) {
                  finish(error);
                }
              } else if (payload.op === 1) {
                try { socket.send(JSON.stringify({ op: 1, d: sequence })); } catch {}
              } else if (payload.op === 7 || payload.op === 9) {
                finish();
              } else if (payload.op === 0) {
                if (payload.t === 'READY') {
                  botId = String(payload.d?.user?.id || botId);
                  runtime.discord.botName = String(payload.d?.user?.username || runtime.discord.botName);
                  clearError(provider);
                } else if (payload.t === 'MESSAGE_CREATE') {
                  handleMessage(payload.d).catch((error) => setError(provider, error));
                } else if (payload.t === 'INTERACTION_CREATE') {
                  handleInteraction(payload.d).catch((error) => setError(provider, error));
                }
              }
            });
            socket.addEventListener('close', (event) => {
              if (event.code === 4004) failFatal('Discord rejected the bot token.');
              else if (event.code === 4014) failFatal('Enable the Message Content Intent in the Discord Developer Portal, then reconnect.');
              else finish();
            });
            socket.addEventListener('error', () => finish(new Error('Discord gateway connection failed.')));
          });
          backoff = 3000;
        } catch (error) {
          if (signal.aborted) return;
          setError(provider, error);
          if (error && error.fatal) return;
          await sleep(backoff);
          backoff = Math.min(Math.round(backoff * 1.7), 30000);
        }
      }
    });
  }

  function startSlack(entry) {
    const provider = 'slack';
    const appToken = String(entry.appToken || '');
    const botToken = String(entry.botToken || '');
    let botId = '';

    async function slackCall(method, body, token, signal) {
      const data = await requestJson(`https://slack.com/api/${method}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify(body || {}),
      }, 15000, signal);
      if (!data.ok) throw new Error(String(data.error || `Slack ${method} failed.`));
      return data;
    }

    function slackEscaped(text) {
      return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    async function slackSend(chatId, text) {
      for (const chunk of chunkText(text, 3700)) {
        await slackCall('chat.postMessage', { channel: chatId, text: slackEscaped(chunk) }, botToken);
      }
    }

    senders.slack = async (chatId, text, extra = {}) => {
      await slackSend(chatId, text);
      if (extra.sessionId) sessionOrigins.set(extra.sessionId, { provider, chatId: String(chatId), at: now() });
      return true;
    };
    approvalSenders.slack = async (chatId, target) => {
      await slackCall('chat.postMessage', {
        channel: chatId,
        text: target.text,
        blocks: [
          { type: 'section', text: { type: 'mrkdwn', text: slackEscaped(target.text).slice(0, 2900) } },
          {
            type: 'actions',
            elements: [
              { type: 'button', text: { type: 'plain_text', text: 'Allow' }, style: 'primary', action_id: 'apv_allow', value: target.approvalId },
              { type: 'button', text: { type: 'plain_text', text: 'Deny' }, style: 'danger', action_id: 'apv_deny', value: target.approvalId },
            ],
          },
        ],
      }, botToken);
      return true;
    };

    async function handleEvent(event) {
      if (!event || event.bot_id || event.subtype === 'bot_message') return;
      if (event.user && event.user === botId) return;
      let text = '';
      const chatId = String(event.channel || '');
      if (event.type === 'app_mention') {
        text = String(event.text || '').replace(/<@[^>]+>/g, '').trim();
      } else if (event.type === 'message' && event.channel_type === 'im') {
        text = String(event.text || '').trim();
      } else {
        return;
      }
      if (!chatId) return;
      if (!text) {
        if (paired(provider, chatId)) await slackSend(chatId, 'Text messages only for now.');
        return;
      }
      const result = await receive(provider, chatId, text, { label: event.user || '' });
      if (result.reply) await senders.slack(chatId, result.reply, { sessionId: result.sessionId });
    }

    async function handleInteractive(payload) {
      if (!payload || payload.type !== 'block_actions') return;
      const action = payload.actions?.[0];
      if (!action) return;
      const decision = action.action_id === 'apv_deny' ? 'deny' : 'allow';
      const approvalId = String(action.value || '');
      const chatId = String(payload.channel?.id || '');
      const result = await decide(provider, chatId, approvalId, decision);
      const text = result.ok && result.target
        ? `${result.target.text}\n\n${decision === 'deny' ? 'Denied' : 'Allowed'}.`
        : 'This approval expired.';
      if (payload.message?.ts) {
        await slackCall('chat.update', { channel: chatId, ts: payload.message.ts, text: slackEscaped(text), blocks: [] }, botToken);
      }
    }

    loop(provider, async (signal) => {
      const auth = await slackCall('auth.test', {}, botToken, signal);
      botId = String(auth.user_id || '');
      runtime.slack.botName = String(auth.user || auth.team || '');
      clearError(provider);
      let backoff = 3000;
      while (!signal.aborted) {
        try {
          const opened = await slackCall('apps.connections.open', {}, appToken, signal);
          const socketUrl = String(opened.url || '');
          if (!socketUrl) throw new Error('Slack did not return a Socket Mode URL.');
          await new Promise((resolve, reject) => {
            const socket = new WebSocketImpl(socketUrl);
            let settled = false;
            const finish = (error) => {
              if (settled) return;
              settled = true;
              try { socket.close(); } catch {}
              if (error) reject(error);
              else resolve();
            };
            socket.addEventListener('message', (event) => {
              let payload = null;
              try { payload = JSON.parse(event.data); } catch { return; }
              if (payload.envelope_id) {
                try { socket.send(JSON.stringify({ envelope_id: payload.envelope_id })); } catch {}
              }
              if (payload.type === 'disconnect') {
                finish();
              } else if (payload.type === 'events_api') {
                handleEvent(payload.payload?.event).catch((error) => setError(provider, error));
              } else if (payload.type === 'interactive') {
                handleInteractive(payload.payload).catch((error) => setError(provider, error));
              }
            });
            socket.addEventListener('close', () => finish());
            socket.addEventListener('error', () => finish(new Error('Slack Socket Mode connection failed.')));
          });
          backoff = 3000;
        } catch (error) {
          if (signal.aborted) return;
          setError(provider, error);
          await sleep(backoff);
          backoff = Math.min(Math.round(backoff * 1.7), 30000);
        }
      }
    });
  }

  function startWebhook(entry) {
    const provider = 'webhook';
    const rt = runtime[provider];
    const generation = ++rt.generation;
    const port = Math.max(1024, Math.min(65535, Number(entry.port) || 8789));
    let secret = String(entry.secret || '');
    if (!secret) {
      secret = crypto.randomBytes(24).toString('hex');
      updateProvider(provider, (target) => { target.secret = secret; });
    }
    if (!entry.links?.local) {
      addLink(provider, 'local', '', 'Local bridge');
    }
    const buckets = new Map();

    function jsonResponse(res, code, payload) {
      const body = JSON.stringify(payload);
      res.writeHead(code, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(body),
        'cache-control': 'no-store',
      });
      res.end(body);
    }

    function authorized(req) {
      const header = String(req.headers.authorization || '');
      const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
      const direct = String(req.headers['x-blank-secret'] || '').trim();
      return safeEqual(bearer || direct, secret);
    }

    function rateOk(req) {
      const key = String(req.socket?.remoteAddress || 'local');
      const bucket = (buckets.get(key) || []).filter((at) => at > now() - 60000);
      if (bucket.length >= 60) return false;
      bucket.push(now());
      buckets.set(key, bucket);
      return true;
    }

    function readBody(req) {
      return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (chunk) => {
          size += chunk.length;
          if (size > 256 * 1024) {
            reject(new Error('Request body is too large.'));
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        req.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
          } catch {
            reject(new Error('Send a JSON body.'));
          }
        });
        req.on('error', reject);
      });
    }

    const server = http.createServer(async (req, res) => {
      res.setHeader('cache-control', 'no-store');
      const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
      if (req.method === 'GET' && url.pathname === '/health') {
        jsonResponse(res, 200, { ok: true, app: 'blank', version: readHandlers()?.version?.() || '' });
        return;
      }
      if (!authorized(req)) {
        jsonResponse(res, 401, { ok: false, error: 'Invalid webhook secret.' });
        return;
      }
      if (!rateOk(req)) {
        jsonResponse(res, 429, { ok: false, error: 'Too many requests.' });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/approvals') {
        const link = linksOf(provider).local || {};
        const pending = (readHandlers()?.pendingApprovals?.() || [])
          .filter((approval) => !link.sessionId || approval.sessionId === link.sessionId)
          .map((approval) => ({
            approvalId: approval.approvalId,
            sessionId: approval.sessionId,
            tool: approval.tool,
            label: approval.label,
            summary: approval.summary,
          }));
        jsonResponse(res, 200, { ok: true, approvals: pending });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/message') {
        try {
          const body = await readBody(req);
          const text = String(body.text || '').slice(0, MAX_TEXT);
          if (!text.trim()) throw new Error('text is required.');
          if (body.sessionId) {
            const session = readHandlers()?.getSession?.(String(body.sessionId));
            if (session) updateLink(provider, 'local', { sessionId: session.id, title: session.title || '' });
          }
          const result = await receive(provider, 'local', text, { label: 'Local bridge' });
          const payload = {
            ok: true,
            sessionId: result.sessionId || '',
            runId: result.runId || '',
            queued: Boolean(result.queued),
            reply: result.reply || '',
          };
          if (result.sessionId) {
            const final = await waitForRun(result.runId, result.sessionId, 90000);
            if (final) payload.reply = final;
            else if (result.runId) payload.pending = true;
          }
          jsonResponse(res, 200, payload);
        } catch (error) {
          jsonResponse(res, 400, { ok: false, error: String(error.message || error) });
        }
        return;
      }
      jsonResponse(res, 404, { ok: false, error: 'Not found.' });
    });

    senders.webhook = async (chatId, text, extra = {}) => {
      const entryNow = readProvider(provider);
      const targetUrl = String(entryNow.url || '');
      if (extra.sessionId) sessionOrigins.set(extra.sessionId, { provider, chatId: 'local', at: now() });
      if (!targetUrl) return false;
      await requestJson(targetUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ app: 'blank', type: 'message', text, sessionId: extra.sessionId || '', at: new Date().toISOString() }),
      }, 12000);
      return true;
    };
    approvalSenders.webhook = async (chatId, target) => {
      const entryNow = readProvider(provider);
      const targetUrl = String(entryNow.url || '');
      if (!targetUrl) return false;
      await requestJson(targetUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          app: 'blank',
          type: 'approval',
          approvalId: target.approvalId,
          label: target.text,
          sessionId: target.sessionId || '',
          at: new Date().toISOString(),
        }),
      }, 12000);
      return true;
    };

    server.on('error', (error) => {
      if (rt.generation !== generation) return;
      setError(provider, error);
      rt.running = false;
      rt.stop = null;
    });
    server.listen(port, '127.0.0.1', () => {
      if (rt.generation !== generation) {
        try { server.close(); } catch {}
        return;
      }
      rt.running = true;
      rt.stop = () => new Promise((resolve) => server.close(() => resolve()));
      rt.startedAt = now();
      clearError(provider);
      emitStatus();
    });
  }

  /* ---------------------------------------------------------------- test */

  async function test(provider) {
    const entry = readProvider(provider);
    if (!PROVIDERS.includes(provider)) throw new Error('Unknown messenger.');
    try {
      if (provider === 'telegram') {
        if (!entry.token) throw new Error('Add a Telegram bot token first.');
        const base = telegramBase();
        const data = await requestJson(`${base}/bot${entry.token}/getMe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, 15000);
        if (!data.ok) throw new Error(String(data.description || 'Telegram rejected the token.'));
        return { ok: true, name: String(data.result?.username || '') };
      }
      if (provider === 'discord') {
        if (!entry.token) throw new Error('Add a Discord bot token first.');
        const data = await requestJson('https://discord.com/api/v10/users/@me', {
          headers: { authorization: `Bot ${entry.token}`, 'user-agent': 'blank (https://github.com/purplemacaron/blank)' },
        }, 15000);
        return { ok: true, name: String(data.username || '') };
      }
      if (provider === 'slack') {
        if (!entry.appToken || !entry.botToken) throw new Error('Add both Slack tokens first.');
        const auth = await requestJson('https://slack.com/api/auth.test', {
          method: 'POST',
          headers: { authorization: `Bearer ${entry.botToken}`, 'content-type': 'application/json; charset=utf-8' },
          body: '{}',
        }, 15000);
        if (!auth.ok) throw new Error(String(auth.error || 'Slack rejected the bot token.'));
        const socket = await requestJson('https://slack.com/api/apps.connections.open', {
          method: 'POST',
          headers: { authorization: `Bearer ${entry.appToken}`, 'content-type': 'application/json; charset=utf-8' },
          body: '{}',
        }, 15000);
        if (!socket.ok) throw new Error(String(socket.error || 'Slack rejected the app token.'));
        return { ok: true, name: String(auth.user || auth.team || '') };
      }
      const server = runtime.webhook;
      return { ok: Boolean(server?.running), name: server?.running ? `127.0.0.1:${Number(entry.port) || 8789}` : 'Webhook is not running.' };
    } catch (error) {
      setError(provider, error);
      return { ok: false, error: redact(provider, error) };
    }
  }

  /* -------------------------------------------------------------- public */

  async function configure(input = {}) {
    const provider = String(input.provider || '');
    if (input.notify !== undefined) {
      updateRoot((root) => { root.notify = Boolean(input.notify); });
    }
    if (!provider) {
      emitStatus();
      return status();
    }
    if (!PROVIDERS.includes(provider)) throw new Error('Unknown messenger.');

    const entry = readProvider(provider);
    const patch = {};
    if (input.enabled !== undefined) patch.enabled = Boolean(input.enabled);
    if (input.unpair) {
      patch.links = {};
      patch.lastChatId = '';
    }
    if (provider === 'telegram' || provider === 'discord') {
      if (input.clearToken) patch.token = '';
      else if (input.token !== undefined && String(input.token).trim()) patch.token = String(input.token).trim().slice(0, 4096);
      const token = patch.token !== undefined ? patch.token : entry.token;
      if (patch.enabled === true && !token) throw new Error('Add a token before turning this messenger on.');
      if (!token) patch.enabled = false;
    }
    if (provider === 'slack') {
      if (input.clearToken) {
        patch.appToken = '';
        patch.botToken = '';
      } else {
        if (input.appToken !== undefined && String(input.appToken).trim()) patch.appToken = String(input.appToken).trim().slice(0, 4096);
        if (input.botToken !== undefined && String(input.botToken).trim()) patch.botToken = String(input.botToken).trim().slice(0, 4096);
      }
      const appToken = patch.appToken !== undefined ? patch.appToken : entry.appToken;
      const botToken = patch.botToken !== undefined ? patch.botToken : entry.botToken;
      if (patch.enabled === true && (!appToken || !botToken)) throw new Error('Add both Slack tokens before turning this messenger on.');
      if (!appToken || !botToken) patch.enabled = false;
    }
    if (provider === 'webhook') {
      if (input.url !== undefined) {
        const url = String(input.url || '').trim();
        if (url) {
          let parsed = null;
          try { parsed = new URL(url); } catch {}
          if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) throw new Error('Use an http or https notification URL.');
        }
        patch.url = url.slice(0, 2048);
      }
      if (input.port !== undefined) {
        const port = Number(input.port);
        if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Use a port between 1024 and 65535.');
        patch.port = port;
      }
      if (!entry.secret) patch.secret = crypto.randomBytes(24).toString('hex');
    }

    updateProvider(provider, (target) => {
      Object.assign(target, patch);
      if (!target.links || typeof target.links !== 'object') target.links = {};
    });
    await restartProvider(provider);
    emitStatus();
    return status();
  }

  ensurePairCode();

  return {
    configure,
    dispose,
    start,
    status,
    test,
    approval,
    publish,
    receive,
    decide,
    waitForRun,
  };
}

module.exports = {
  createMessengerService,
  chunkText,
  maskToken,
  parseCommand,
  PROVIDERS,
};
