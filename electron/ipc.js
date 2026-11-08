'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { app, BrowserWindow, dialog, shell, nativeTheme, ipcMain, clipboard } = require('electron');
const { appPaths, ensureHome, uid, slugify } = require('../src/core/paths');
const configModule = require('../src/core/config');
const catalog = require('../src/core/catalog');
const store = require('../src/core/store');
const reasoning = require('../src/core/reasoning');
const providers = require('../src/core/providers');
const { runAgent, compactSession } = require('../src/core/agent');
const learn = require('../src/core/learn');
const { summarizeArgs, prepareScreenshot } = require('../src/core/tools');
const search = require('../src/core/search');
const computer = require('../src/core/computer');
const { createRemoteService } = require('../src/core/remote');
const { createMessengerService } = require('../src/core/messengers');
const { createComputerOverlay } = require('./computer-overlay');
const { createPet } = require('./pet');
const { petPalette } = require('./pet-palette');
const { createUpdater } = require('./updater');
const plugins = require('../src/core/plugins');
const schedulesModule = require('../src/core/schedules');
const triggers = require('../src/core/triggers');
const { createTriggerEngine } = require('./trigger-engine');
const oauthModule = require('../src/core/oauth');
const paperStore = require('../src/core/paper');
const notifications = require('./notifications');
const dictation = require('../src/core/dictation');
const codeModule = require('../src/core/code');
const apisModule = require('../src/core/apis');
const { runConsoleCommand, createTerminal } = require('../src/core/console');
const auditModule = require('../src/core/audit');
const worktreeModule = require('../src/core/worktree');
const { createQueue, retryDelayMs } = require('../src/core/automation-queue');
const { sendMode, enqueueInterrupt } = require('../src/core/turn-queue');
const { appendStream, previewStream } = require('../src/core/stream-preview');

const APP_ROOT = path.join(__dirname, '..');
const isWin = process.platform === 'win32';
const ipcMainHandle = ipcMain.handle.bind(ipcMain);

function createState() {
  return {
    runs: new Map(),
    sessionRuns: new Map(),
    compacting: new Set(),
    approvals: new Map(),
    queues: new Map(),
    scheduleRuns: new Map(),
    scheduleQueue: createQueue(),
    scheduleRetries: new Map(),
    scheduleTimer: null,
    reflectionInFlight: false,
    disposed: false,
  };
}

function attachWindowEvents(win, state) {
  const emitState = () => {
    if (win.isDestroyed()) return;
    win.webContents.send('blank:event', { type: 'window:state', maximized: win.isMaximized() });
  };
  win.on('maximize', emitState);
  win.on('unmaximize', emitState);
  win.on('enter-full-screen', emitState);
  win.on('leave-full-screen', emitState);
}

function registerIpc({ mcp, getWindow }) {
  const state = createState();
  let triggerEngine = null;
  ensureHome();
  notifications.configure({ getWindow });

  const sendEvent = (win, payload) => {
    if (!win || win.isDestroyed()) return;
    win.webContents.send('blank:event', payload);
  };

  const broadcast = (payload) => {
    for (const win of BrowserWindow.getAllWindows()) sendEvent(win, payload);
  };

  const updater = createUpdater();
  updater.configure({
    auto: configModule.loadConfig().updates?.auto !== false,
    onState: (status, previous) => {
      broadcast({ type: 'update:status', status });
      if (status.status === 'ready' && previous !== 'ready') {
        notifications.notify({
          title: `blank ${status.version || ''}`.trim(),
          body: 'An update is ready. Open Settings → Updates to install it.',
          key: `update:${status.version || status.current}`,
        });
      }
    },
  });
  updater.start();

  const petModels = () => {
    try {
      const model = String(configModule.loadConfig().defaultModel || '').trim();
      return model ? [model] : [];
    } catch {
      return [];
    }
  };

  /** Resolve the display name and provider that color the blank memo. */
  const describePetModel = (model, config = configModule.loadConfig()) => {
    const id = String(model || '').trim();
    if (!id) return { id: '', name: '', providerId: '', providerName: '' };
    let found = null;
    try {
      found = catalog.findModel(id, config);
      if (!found) {
        const bare = id.includes('/') ? id.slice(id.indexOf('/') + 1) : id;
        found = catalog.allModels(config).find(
          (item) => item.fullId === id || item.id === id || item.id === bare,
        ) || null;
      }
    } catch {}
    const name = found?.name || (id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id);
    return {
      id,
      name,
      providerId: found?.providerId || '',
      providerName: found?.providerName || '',
    };
  };

  const pet = createPet({
    getConfig: () => configModule.loadConfig(),
    getWindow: () => getWindow(),
    getModels: petModels,
    savePosition: (key, point, isPrimary) => {
      const config = configModule.loadConfig();
      const current = config.pet && typeof config.pet === 'object' ? config.pet : {};
      const positions = { ...(current.positions && typeof current.positions === 'object' ? current.positions : {}) };
      positions[key] = { x: point.x, y: point.y };
      config.pet = { ...current, positions };
      if (isPrimary) {
        config.pet.x = point.x;
        config.pet.y = point.y;
      }
      configModule.saveConfig(config);
    },
  });
  setImmediate(() => {
    try { pet.sync(); } catch {}
  });

  const sendPet = (payload) => {
    try { pet.send(payload); } catch {}
  };

  /* While any agent drives the desktop, the primary memo rides beside the real
     pointer and drifts back a moment after the last computer action. Computer
     activity is the trigger because sub-agents never surface tool events here. */
  let petFollowTimer = null;
  let petFollowRelease = null;
  const holdPetFollow = () => {
    clearTimeout(petFollowRelease);
    petFollowRelease = null;
    if (petFollowTimer) return;
    petFollowTimer = setInterval(() => {
      try { pet.followCursor(); } catch {}
    }, 120);
    try { pet.followCursor(); } catch {}
  };
  const releasePetFollow = (immediate = false) => {
    if (!petFollowTimer) return;
    clearTimeout(petFollowRelease);
    petFollowRelease = setTimeout(() => {
      petFollowRelease = null;
      clearInterval(petFollowTimer);
      petFollowTimer = null;
      try { pet.stopFollow(); } catch {}
    }, immediate ? 0 : 2500);
  };
  const stopAllPetFollow = () => {
    clearTimeout(petFollowRelease);
    petFollowRelease = null;
    if (petFollowTimer) clearInterval(petFollowTimer);
    petFollowTimer = null;
    try { pet.stopFollow(); } catch {}
  };

  const petStreams = new Map();

  /** A short live excerpt of what the model is thinking or saying. */
  const sendPetStream = (payload = {}) => {
    const runId = String(payload.runId || '');
    if (!runId) return;
    let stream = petStreams.get(runId);
    if (!stream) {
      stream = { messageId: '', reasoning: '', text: '' };
      petStreams.set(runId, stream);
    }
    const messageId = String(payload.messageId || '');
    if (messageId && messageId !== stream.messageId) {
      stream.messageId = messageId;
      stream.reasoning = '';
      stream.text = '';
    }
    const thinking = payload.type === 'reasoning';
    if (thinking) stream.reasoning = appendStream(stream.reasoning, payload.delta);
    else stream.text = appendStream(stream.text, payload.delta);
    const text = previewStream(thinking ? stream.reasoning : stream.text);
    if (!text) return;
    sendPet({
      type: 'stream',
      runId,
      sessionId: payload.sessionId,
      mode: thinking ? 'reasoning' : 'reply',
      messageId: stream.messageId,
      text,
    });
  };

  /** The pets only need the shape of a run, never transcript or tool payloads. */
  const sendPetEvent = (payload = {}) => {
    const common = { runId: payload.runId, sessionId: payload.sessionId };
    switch (payload.type) {
      case 'run:start':
        petStreams.delete(String(payload.runId || ''));
        sendPet({ type: 'run:start', ...common, model: payload.model });
        break;
      case 'text':
      case 'reasoning':
        sendPetStream(payload);
        break;
      case 'tool:start':
        sendPet({ type: 'tool:start', ...common, name: payload.name });
        break;
      case 'tool:end':
        sendPet({ type: 'tool:end', ...common, name: payload.name });
        break;
      case 'agent:start': {
        const agent = payload.agent && typeof payload.agent === 'object' ? payload.agent : {};
        if (agent.team) {
          pet.sendTeam(
            {
              id: agent.memberId,
              name: agent.name,
              teamName: 'blank team',
              model: agent.model,
              runId: payload.runId,
            },
            { type: 'agent:start', ...common, team: true, name: agent.name, model: agent.model },
            { ensure: true },
          );
        }
        sendPet({ type: 'agent:start', ...common });
        break;
      }
      case 'agent:end': {
        const agent = payload.agent && typeof payload.agent === 'object' ? payload.agent : {};
        if (agent.team) {
          pet.sendTeam(
            {
              id: agent.memberId,
              name: agent.name,
              teamName: 'blank team',
              model: agent.model,
              runId: payload.runId,
            },
            {
              type: 'run:done',
              ...common,
              outcome: agent.status === 'error' ? { ok: false, error: true } : { ok: true },
            },
            { retire: 6500 },
          );
        }
        break;
      }
      case 'approval':
        sendPet({ type: 'approval', ...common, approvalId: payload.approvalId });
        break;
      case 'approval:resolved':
        sendPet({ type: 'approval:resolved', ...common, approvalId: payload.approvalId, decision: payload.decision });
        break;
      case 'approval:expired':
        sendPet({ type: 'approval:expired', ...common, approvalId: payload.approvalId });
        break;
      case 'error':
        sendPet({ type: 'error', ...common });
        break;
      case 'run:done': {
        const outcome = payload.outcome || {};
        petStreams.delete(String(payload.runId || ''));
        releasePetFollow(true);
        sendPet({
          type: 'run:done',
          ...common,
          outcome: { ok: Boolean(outcome.ok), stopped: Boolean(outcome.stopped), error: Boolean(outcome.error) },
        });
        break;
      }
      default:
        break;
    }
  };

  let mediaModule = null;
  const getMedia = () => {
    if (!mediaModule) {
      mediaModule = require('../src/core/media');
      mediaModule.configureMedia({
        getConfig: () => configModule.loadConfig(),
        emit: (event, payload) => broadcast({ type: event, ...payload }),
        patchConfig: (patch) => configModule.patchConfig(patch),
      });
    }
    return mediaModule;
  };

  let sshModule = null;
  const getSsh = () => (sshModule || (sshModule = require('../src/core/ssh')));

  let terminalSession = null;
  const stopTerminal = () => {
    if (!terminalSession) return;
    try { terminalSession.stop(); } catch {}
    terminalSession = null;
  };
  const startTerminal = () => {
    const config = configModule.loadConfig();
    if (!config.workspace) throw new Error('Open a workspace folder before opening a terminal.');
    if (terminalSession) {
      const current = terminalSession.state();
      if (current.workspace === config.workspace) return current;
      stopTerminal();
    }
    terminalSession = createTerminal({
      workspace: config.workspace,
      onData: (text) => broadcast({ type: 'console:data', text }),
      onState: (payload) => broadcast({ type: 'console:state', ...payload }),
      onExit: (payload) => broadcast({ type: 'console:exit', ...payload }),
    });
    return terminalSession.state();
  };

  const configWithRuntime = (config) => {
    const publicConfig = configModule.publicConfig(config, catalog);
    return {
      ...publicConfig,
      runtime: {
        version: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        home: appPaths().root,
        dataDir: appPaths().root,
        appRoot: APP_ROOT,
        electron: process.versions.electron,
        node: process.versions.node,
        isDev: !app.isPackaged,
      },
    };
  };

  const summaryOf = (session) => ({
    id: session.id,
    title: session.title,
    preview: store.sessionPreview(session),
    updatedAt: session.updatedAt,
    createdAt: session.createdAt,
    model: session.model,
    mode: session.mode,
    pinned: Boolean(session.pinned),
    archived: Boolean(session.archived),
    subagents: (session.subagents || []).slice(-12),
    workspace: session.workspace,
  });

  const notifySession = (session) => broadcast({ type: 'session:updated', session: summaryOf(session) });

  const winFromEvent = (event) => BrowserWindow.fromWebContents(event.sender) || getWindow();

  /* ------------------------------------------------------- remote & overlay */

  const remote = createRemoteService();
  const messengers = createMessengerService({
    handlers: () => messengerHandlers(),
    onStatus: (status) => broadcast({ type: 'messengers:status', status }),
    onIncoming: (event) => triggerEngine?.notifyMessenger(event),
  });
  try { messengers.start(); } catch {}
  const overlay = createComputerOverlay({
    isEnabled: () => configModule.loadConfig().computer?.showCursor !== false,
    theme: () => configModule.loadConfig().theme,
  });
  computer.onActivity((activity) => {
    overlay.flash(activity);
    holdPetFollow();
    releasePetFollow();
  });

  function pendingApprovals() {
    return [...state.approvals.entries()].map(([approvalId, approval]) => ({
      approvalId,
      sessionId: approval.sessionId,
      runId: approval.runId,
      tool: approval.tool,
      label: approval.label,
      summary: approval.summary,
      reason: approval.reason,
    }));
  }

  function approveApproval(approvalId, decision) {
    const approval = state.approvals.get(approvalId);
    if (!approval) return { ok: false, error: 'Approval expired.' };
    const safeDecision = ['allow', 'deny', 'always'].includes(decision) ? decision : 'deny';
    clearTimeout(approval.timer);
    state.approvals.delete(approvalId);
    approval.resolve(safeDecision);
    const payload = {
      type: 'approval:resolved',
      approvalId,
      decision: safeDecision,
      tool: approval.tool,
      sessionId: approval.sessionId,
      runId: approval.runId,
    };
    sendEvent(approval.win, payload);
    if (getWindow() && getWindow() !== approval.win) sendEvent(getWindow(), payload);
    sendPetEvent(payload);
    return { ok: true };
  }

  function remoteHandlers() {
    return {
      version: () => app.getVersion(),
      listSessions: () => {
        const config = configModule.loadConfig();
        return store.listSessions(config.workspace).slice(0, 60).map((session) => ({
          id: session.id,
          title: session.title,
          updatedAt: session.updatedAt,
          model: session.model,
          pinned: Boolean(session.pinned),
          preview: String(session.preview || '').slice(0, 120),
        }));
      },
      getSession: (id) => store.getSession(id),
      isRunning: (id) => state.sessionRuns.has(id),
      send: async ({ text, sessionId, mode }) => {
        const result = await startChatRun({
          win: getWindow(),
          input: { sessionId, text, mode },
          queueIfRunning: true,
          source: 'remote',
        });
        return {
          sessionId: result.sessionId,
          runId: result.runId || null,
          queued: Boolean(result.queued),
          title: result.title || '',
        };
      },
      stop: async (sessionId) => stopSessionRun(sessionId),
      approve: async ({ approvalId, decision }) => approveApproval(approvalId, decision),
      pendingApprovals,
    };
  }

  function messengerHandlers() {
    return {
      ...remoteHandlers(),
      send: async ({ text, sessionId, mode }) => {
        const result = await startChatRun({
          win: getWindow(),
          input: { sessionId, text, mode },
          queueIfRunning: true,
          source: 'messenger',
        });
        return {
          sessionId: result.sessionId,
          runId: result.runId || null,
          queued: Boolean(result.queued),
          title: result.title || '',
        };
      },
      createSession: () => {
        const config = configModule.loadConfig();
        const session = store.createSession({
          workspace: config.workspace,
          model: config.defaultModel,
          mode: 'agent',
        });
        notifySession(session);
        broadcast({ type: 'sessions:refresh' });
        return { id: session.id, title: session.title, model: session.model };
      },
    };
  }

  function remoteStatus() {
    return { ...remote.status(), autoStart: Boolean(configModule.loadConfig().remote?.autoStart) };
  }

  function denyApprovalsFor(predicate) {
    for (const [id, approval] of state.approvals.entries()) {
      if (predicate(approval)) {
        clearTimeout(approval.timer);
        approval.resolve('deny');
        state.approvals.delete(id);
        const expired = { type: 'approval:expired', approvalId: id, sessionId: approval.sessionId, runId: approval.runId };
        sendEvent(approval.win, expired);
        sendPetEvent(expired);
      }
    }
  }

  function sanitizeAttachments(list) {
    if (!Array.isArray(list)) return [];
    const out = [];
    let total = 0;
    for (const file of list.slice(0, 10)) {
      const name = String(file?.name || 'attachment.txt').slice(0, 180);
      const content = String(file?.content || '').slice(0, 120000);
      if (!content) continue;
      total += content.length;
      if (total > 360000) break;
      out.push({
        name,
        type: String(file?.type || 'text/plain').slice(0, 80),
        size: Number(file?.size) || content.length,
        content,
      });
    }
    return out;
  }

  async function maybeReflect(win, session) {
    try {
      const config = configModule.loadConfig();
      if (!config.agent?.autoReflect) return;
      if (state.reflectionInFlight) return;
      if (!session.model) return;
      const assistantTurns = (session.messages || []).filter((message) => message.role === 'assistant').length;
      if (assistantTurns < 4 || assistantTurns % 6 !== 0) return;
      state.reflectionInFlight = true;
      const result = await learn.reflectNow({ config, workspace: session.workspace || config.workspace });
      if (result.ok && result.added?.length) {
        sendEvent(win, { type: 'learn:updated', added: result.added.length, message: result.message });
        broadcast({ type: 'sessions:refresh' });
      }
    } catch (err) {
      sendEvent(win, { type: 'notice', level: 'warn', text: `Background reflection failed: ${err.message}` });
    } finally {
      state.reflectionInFlight = false;
    }
  }

  /* ---------------------------------------------------------------- app/config */

  require('electron').ipcMain.handle('app:info', async () => ({
    name: 'blank',
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    home: appPaths().root,
    dataDir: appPaths().root,
    electron: process.versions.electron,
    node: process.versions.node,
    isDev: !app.isPackaged,
    workspace: configModule.loadConfig().workspace,
  }));

  require('electron').ipcMain.handle('config:get', async () => configWithRuntime(configModule.loadConfig()));

  require('electron').ipcMain.handle('updates:status', async () => updater.status());
  require('electron').ipcMain.handle('updates:check', async () => updater.check());
  require('electron').ipcMain.handle('updates:install', async () => updater.install());

  require('electron').ipcMain.handle('messengers:status', async () => messengers.status());
  require('electron').ipcMain.handle('messengers:configure', async (_event, input = {}) => messengers.configure(input));
  require('electron').ipcMain.handle('messengers:test', async (_event, provider) => messengers.test(provider));

  require('electron').ipcMain.handle('config:update', async (_event, patch = {}) => {
    const allowed = ['defaultModel', 'fallbackModel', 'theme', 'language', 'onboarded', 'agent', 'audit', 'ui', 'customInstructions', 'disabledSkills', 'media', 'permissions', 'approvals', 'search', 'computer', 'pet', 'team', 'notifications', 'dictation', 'updates', 'triggers'];
    const clean = {};
    for (const key of allowed) {
      if (patch[key] === undefined) continue;
      clean[key] = patch[key];
    }
    if (clean.search) {
      const providers = ['duckduckgo', 'brave', 'tavily', 'exa', 'serper', 'searxng'];
      const search = clean.search && typeof clean.search === 'object' ? clean.search : {};
      const current = configModule.loadConfig().search || {};
      const merged = { ...current, ...search };
      clean.search = {
        provider: providers.includes(merged.provider) ? merged.provider : (current.provider || 'duckduckgo'),
        baseUrl: String(merged.baseUrl ?? current.baseUrl ?? '').slice(0, 500),
        maxResults: Math.max(1, Math.min(10, Number(merged.maxResults) || current.maxResults || 6)),
      };
    }
    if (clean.computer) {
      clean.computer = { showCursor: clean.computer.showCursor !== false };
    }
    if (clean.pet) {
      const incoming = clean.pet && typeof clean.pet === 'object' ? clean.pet : {};
      const current = configModule.loadConfig().pet || {};
      const coord = (value, fallback) => {
        if (value === null) return null;
        if (value === undefined) return Number.isFinite(fallback) ? fallback : null;
        const number = Number(value);
        if (!Number.isFinite(number)) return Number.isFinite(fallback) ? fallback : null;
        return Math.max(-100000, Math.min(100000, Math.round(number)));
      };
      const positions = {};
      const source = incoming.positions !== undefined ? incoming.positions : current.positions;
      if (source && typeof source === 'object') {
        for (const [key, value] of Object.entries(source).slice(0, 24)) {
          if (typeof key !== 'string' || !key || key.length > 160) continue;
          const x = coord(value?.x, null);
          const y = coord(value?.y, null);
          if (x === null || y === null) continue;
          positions[key] = { x, y };
        }
      }
      clean.pet = {
        enabled: incoming.enabled === undefined ? current.enabled !== false : Boolean(incoming.enabled),
        shareScreen: incoming.shareScreen === undefined ? current.shareScreen !== false : Boolean(incoming.shareScreen),
        x: coord(incoming.x, current.x),
        y: coord(incoming.y, current.y),
        positions,
      };
    }
    if (clean.agent) {
      const incoming = clean.agent && typeof clean.agent === 'object' ? clean.agent : {};
      const current = configModule.loadConfig().agent || {};
      const next = { ...current, ...incoming };
      next.isolateWrites = Boolean(next.isolateWrites);
      next.maxSteps = Math.max(1, Math.min(64, Number(next.maxSteps) || 32));
      clean.agent = next;
    }
    if (clean.audit) {
      const incoming = clean.audit && typeof clean.audit === 'object' ? clean.audit : {};
      const current = configModule.loadConfig().audit || {};
      clean.audit = {
        enabled: incoming.enabled === undefined ? current.enabled !== false : Boolean(incoming.enabled),
        retentionDays: Math.max(1, Math.min(365, Number(incoming.retentionDays ?? current.retentionDays) || 30)),
      };
    }
    if (clean.approvals) {
      const mode = clean.approvals.mode;
      clean.approvals = { mode: mode === 'all' || mode === 'auto' ? mode : 'important' };
    }
    if (clean.defaultModel) {
      if (!catalog.findModel(clean.defaultModel, configModule.loadConfig())) throw new Error('Unknown model.');
    }
    if (clean.fallbackModel && clean.fallbackModel !== '') {
      if (!catalog.findModel(clean.fallbackModel, configModule.loadConfig())) throw new Error('Unknown fallback model.');
    }
    if (clean.theme && !['light', 'dark', 'system'].includes(clean.theme)) delete clean.theme;
    if (clean.language && !['ko', 'en', 'auto'].includes(clean.language)) delete clean.language;
    if (clean.ui) {
      const incoming = clean.ui && typeof clean.ui === 'object' ? clean.ui : {};
      const current = configModule.loadConfig().ui || {};
      const next = { ...current, ...incoming };
      if (incoming.railOpen !== undefined) next.railOpen = Boolean(incoming.railOpen);
      if (incoming.sidebarOpen !== undefined) next.sidebarOpen = Boolean(incoming.sidebarOpen);
      if (incoming.density !== undefined) next.density = ['comfy', 'compact'].includes(incoming.density) ? incoming.density : current.density;
      if (incoming.font !== undefined) next.font = ['noto', 'system', 'mono'].includes(incoming.font) ? incoming.font : 'noto';
      clean.ui = next;
    }
    if (clean.team) {
      const team = clean.team && typeof clean.team === 'object' ? clean.team : {};
      const next = { enabled: Boolean(team.enabled) };
      if (Array.isArray(team.members)) {
        const seen = new Set();
        next.members = team.members.slice(0, 6).map((member, index) => {
          const id = String(member?.id || `member_${index + 1}`).replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || `member_${index + 1}`;
          const unique = seen.has(id) ? `${id}_${index + 1}` : id;
          seen.add(unique);
          return {
            id: unique,
            name: String(member?.name || '').trim().slice(0, 40) || `Agent ${index + 1}`,
            role: String(member?.role || '').trim().slice(0, 600),
            model: String(member?.model || '').trim().slice(0, 160),
            enabled: member?.enabled !== false,
            write: Boolean(member?.write),
          };
        }).filter((member) => member.name);
      }
      clean.team = next;
    }
    if (clean.customInstructions) clean.customInstructions = String(clean.customInstructions).slice(0, 20000);
    if (clean.dictation) {
      const incoming = clean.dictation && typeof clean.dictation === 'object' ? clean.dictation : {};
      const current = configModule.loadConfig().dictation || {};
      const baseUrl = String(incoming.baseUrl ?? current.baseUrl ?? '').trim()
        .replace(/\/+$/, '')
        .replace(/\/audio\/transcriptions$/i, '')
        .slice(0, 300);
      if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
        throw new Error('The transcription endpoint must start with http:// or https://.');
      }
      let key = String(current.key || '');
      if (incoming.clearKey) key = '';
      else if (typeof incoming.key === 'string' && incoming.key.trim()) key = incoming.key.trim().slice(0, 400);
      clean.dictation = {
        providerId: String(incoming.providerId ?? current.providerId ?? '').trim().slice(0, 80),
        model: String(incoming.model ?? current.model ?? '').trim().slice(0, 120),
        language: String(incoming.language ?? current.language ?? '').trim().slice(0, 20),
        baseUrl,
        key,
      };
    }
    if (clean.agent) {
      clean.agent = {
        ...clean.agent,
        maxSteps: Math.max(1, Math.min(64, Number(clean.agent.maxSteps) || 32)),
        compactAt: Math.max(0.5, Math.min(0.95, Number(clean.agent.compactAt) || 0.82)),
        reasoningEffort: reasoning.isEffort(clean.agent.reasoningEffort)
          ? clean.agent.reasoningEffort
          : undefined,
      };
      if (!clean.agent.reasoningEffort) delete clean.agent.reasoningEffort;
    }
    if (clean.media) {
      // Never accept raw keys through the general config channel.
      clean.media = { defaults: clean.media.defaults || {} };
    }
    if (clean.notifications) {
      const incoming = clean.notifications && typeof clean.notifications === 'object' ? clean.notifications : {};
      const current = configModule.loadConfig().notifications || {};
      clean.notifications = {
        enabled: incoming.enabled === undefined ? current.enabled !== false : Boolean(incoming.enabled),
        onFinish: incoming.onFinish === undefined ? current.onFinish !== false : Boolean(incoming.onFinish),
        onApproval: incoming.onApproval === undefined ? current.onApproval !== false : Boolean(incoming.onApproval),
        schedules: incoming.schedules === undefined ? current.schedules !== false : Boolean(incoming.schedules),
      };
    }
    if (clean.updates) {
      const incoming = clean.updates && typeof clean.updates === 'object' ? clean.updates : {};
      const current = configModule.loadConfig().updates || {};
      clean.updates = {
        auto: incoming.auto === undefined ? current.auto !== false : Boolean(incoming.auto),
      };
    }
    if (clean.triggers) {
      const incoming = clean.triggers && typeof clean.triggers === 'object' ? clean.triggers : {};
      const current = configModule.loadConfig().triggers || {};
      const port = Number(incoming.webhookPort ?? current.webhookPort);
      clean.triggers = {
        webhookPort: Number.isFinite(port) ? Math.max(1024, Math.min(65535, Math.round(port))) : 47821,
        webhookAllowLan: incoming.webhookAllowLan === undefined
          ? Boolean(current.webhookAllowLan)
          : Boolean(incoming.webhookAllowLan),
      };
    }
    if (clean.permissions) {
      const levels = ['allow', 'ask', 'deny'];
      const safe = {};
      for (const [tool, level] of Object.entries(clean.permissions)) {
        if (/^[a-z][a-z0-9_]{0,48}$/.test(tool) && levels.includes(level)) safe[tool] = level;
      }
      clean.permissions = safe;
    }
    const next = configModule.patchConfig(clean);
    if (clean.theme) nativeTheme.themeSource = clean.theme;
    if (clean.pet) pet.sync();
    if (Object.prototype.hasOwnProperty.call(clean, 'defaultModel')) pet.refreshDefault();
    if (clean.updates) updater.configure({ auto: next.updates?.auto !== false });
    if (clean.triggers) void triggerEngine?.reconcile().catch(() => {});
    broadcast({ type: 'config:updated' });
    return configWithRuntime(next);
  });

  /* ------------------------------------------------------------------- pet */

  const fromPet = (event) => pet.identify(event.sender);

  ipcMainHandle('pet:init', async (event) => {
    const entry = fromPet(event);
    if (!entry) throw new Error('Only a blank memo can call this.');
    const config = configModule.loadConfig();
    const theme = config.theme === 'dark' ? 'dark' : 'light';
    const model = describePetModel(entry.model, config);
    return {
      language: configModule.resolveLanguage(config.language, app.getLocale()),
      theme,
      enabled: config.pet?.enabled !== false,
      position: pet.position(entry.key),
      key: entry.key,
      kind: entry.kind,
      model: model.id,
      modelName: model.name,
      providerName: model.providerName,
      name: entry.name,
      teamName: entry.teamName || '',
      palette: petPalette(model.providerId || model.providerName || model.id, theme),
    };
  });

  ipcMainHandle('pet:palette', async (event, model, theme) => {
    if (!fromPet(event)) throw new Error('Only a blank memo can call this.');
    const config = configModule.loadConfig();
    const info = describePetModel(String(model || '').slice(0, 200), config);
    return petPalette(info.providerId || info.providerName || info.id, theme === 'dark' ? 'dark' : 'light');
  });

  ipcMainHandle('pet:focus', async (event, value) => {
    const entry = fromPet(event);
    if (!entry) throw new Error('Only a blank memo can call this.');
    return pet.focus(entry.key, Boolean(value));
  });

  const captureMemoScreen = async (model, config) => {
    if (config.pet?.shareScreen === false) return { status: 'off' };
    if (!catalog.findModel(model, config)?.vision) return { status: 'unsupported' };
    try {
      const shot = await computer.screenshot();
      const prepared = prepareScreenshot(shot);
      return {
        status: 'shared',
        meta: {
          screenshot: {
            path: shot.path,
            url: screenshotUrl(shot.path),
            modelPath: prepared.path,
            mime: prepared.mime,
            width: shot.width,
            height: shot.height,
            fileName: path.basename(shot.path),
            source: 'memo',
          },
        },
      };
    } catch {
      return { status: 'failed' };
    }
  };

  ipcMainHandle('pet:prompt', async (event, raw) => {
    const entry = fromPet(event);
    if (!entry) throw new Error('Only a blank memo can call this.');
    const text = String(raw || '').replace(/\r/g, '').trim().slice(0, 4000);
    if (!text) throw new Error('Instruction is empty.');
    const config = configModule.loadConfig();
    const model = entry.model || config.defaultModel;
    if (!model || !catalog.findModel(model, config)) {
      return { ok: false, code: 'no-model' };
    }
    const screen = await captureMemoScreen(model, config);
    const main = getWindow();
    const activeSession = entry.sessionId && entry.runId
      && state.sessionRuns.get(entry.sessionId) === entry.runId
      ? entry.sessionId
      : '';
    try {
      const input = { text, model };
      if (activeSession) input.sessionId = activeSession;
      const result = startChatRun({
        win: main || event.sender,
        input,
        queueIfRunning: Boolean(activeSession),
        source: 'pet',
        meta: screen.meta,
      });
      if (result.queued) {
        return {
          ok: true,
          queued: true,
          screen: screen.status,
          sessionId: result.sessionId,
          queueId: result.queueId,
          queueLength: result.queueLength,
          title: result.title,
        };
      }
      return { ok: true, screen: screen.status, sessionId: result.sessionId, runId: result.runId, title: result.title };
    } catch {
      return { ok: false, code: 'failed' };
    }
  });

  ipcMainHandle('pet:position', async (event) => {
    const entry = fromPet(event);
    if (!entry) throw new Error('Only a blank memo can call this.');
    return pet.position(entry.key);
  });

  ipcMainHandle('pet:move', async (event, point = {}) => {
    const entry = fromPet(event);
    if (!entry) throw new Error('Only a blank memo can call this.');
    return pet.move(entry.key, point);
  });

  ipcMainHandle('pet:save', async (event, point = {}) => {
    const entry = fromPet(event);
    if (!entry) throw new Error('Only a blank memo can call this.');
    return pet.save(entry.key, point);
  });

  ipcMainHandle('pet:reset', async (event) => {
    const entry = fromPet(event);
    if (!entry) throw new Error('Only a blank memo can call this.');
    return pet.reset(entry.key);
  });

  ipcMainHandle('pet:interactive', async (event, value) => {
    const entry = fromPet(event);
    if (!entry) throw new Error('Only a blank memo can call this.');
    pet.setInteractive(entry.key, Boolean(value));
    return true;
  });

  ipcMainHandle('pet:open', async (event) => {
    if (!fromPet(event)) throw new Error('Only a blank memo can call this.');
    return pet.openApp();
  });

  ipcMainHandle('pet:hide', async (event) => {
    if (!fromPet(event)) throw new Error('Only a blank memo can call this.');
    const config = configModule.loadConfig();
    config.pet = { ...(config.pet || {}), enabled: false };
    configModule.saveConfig(config);
    pet.sync();
    broadcast({ type: 'config:updated' });
    return { ok: true };
  });

  require('electron').ipcMain.handle('config:openDataFolder', async () => {
    await shell.openPath(appPaths().root);
    return true;
  });

  require('electron').ipcMain.handle('app:openExternal', async (_event, url) => {
    if (!/^https?:\/\//i.test(String(url || ''))) throw new Error('Only http(s) links can open externally.');
    await shell.openExternal(String(url));
    return true;
  });

  /* --------------------------------------------------------------- remote */

  require('electron').ipcMain.handle('remote:status', async () => remoteStatus());

  require('electron').ipcMain.handle('remote:start', async (_event, input = {}) => {
    const config = configModule.loadConfig();
    const port = Math.max(1024, Math.min(65535, Number(input.port) || config.remote?.port || 8787));
    const allowLan = input.allowLan !== undefined ? Boolean(input.allowLan) : Boolean(config.remote?.allowLan);
    const allowApprovals = input.allowApprovals !== undefined ? Boolean(input.allowApprovals) : Boolean(config.remote?.allowApprovals);
    const status = await remote.start({ port, allowLan, allowApprovals, handlers: remoteHandlers() });
    config.remote = { ...config.remote, port, allowLan, allowApprovals };
    configModule.saveConfig(config);
    broadcast({ type: 'config:updated' });
    return { ...status, autoStart: Boolean(config.remote.autoStart) };
  });

  require('electron').ipcMain.handle('remote:stop', async () => {
    await remote.stop();
    return remoteStatus();
  });

  require('electron').ipcMain.handle('remote:configure', async (_event, input = {}) => {
    const config = configModule.loadConfig();
    const next = { ...(config.remote || {}) };
    if (input.port !== undefined) next.port = Math.max(1024, Math.min(65535, Number(input.port) || next.port || 8787));
    if (input.allowLan !== undefined) next.allowLan = Boolean(input.allowLan);
    if (input.allowApprovals !== undefined) next.allowApprovals = Boolean(input.allowApprovals);
    if (input.autoStart !== undefined) next.autoStart = Boolean(input.autoStart);
    config.remote = next;
    configModule.saveConfig(config);
    broadcast({ type: 'config:updated' });
    if (remote.status().running) {
      await remote.stop();
      await remote.start({
        port: next.port, allowLan: next.allowLan, allowApprovals: next.allowApprovals, handlers: remoteHandlers(),
      });
    }
    return remoteStatus();
  });

  /* ------------------------------------------------------------------- models */

  require('electron').ipcMain.handle('models:list', async () => {
    const config = configModule.loadConfig();
    return {
      providers: catalog.allProviders(config).map((provider) => catalog.publicProvider(provider, config)),
      models: catalog.allModels(config),
      config: configModule.publicConfig(config, catalog),
    };
  });

  async function discoverProviderModels(config, providerId) {
    const provider = catalog.getProvider(providerId, config);
    if (!provider) throw new Error('Unknown provider.');
    const models = await providers.listModels({ providerId, config });
    const entries = models.slice(0, 300).map((model) => {
      const entry = {
        id: String(model.id),
        name: String(model.name || model.id),
        context: Number(model.context) || 128000,
        tags: [],
      };
      if (model.reasoningHint) entry.reasoningHint = model.reasoningHint;
      if (typeof model.vision === 'boolean') entry.vision = model.vision;
      return entry;
    });
    config.discoveredModels = config.discoveredModels || {};
    config.discoveredModels[providerId] = entries;
    return entries;
  }

  require('electron').ipcMain.handle('models:discoverAll', async () => {
    const config = configModule.loadConfig();
    const results = {};
    await Promise.all(catalog.allProviders(config).map(async (provider) => {
      try {
        if (provider.keyEnv && provider.kind !== 'local'
          && !configModule.resolveKey(config, provider.id, provider)) {
          return;
        }
        results[provider.id] = await discoverProviderModels(config, provider.id);
      } catch (error) {
        results[provider.id] = { error: error.message };
      }
    }));
    configModule.saveConfig(config);
    broadcast({ type: 'config:updated' });
    return { ok: true, results };
  });

  require('electron').ipcMain.handle('models:reasoning', async (_event, input = {}) => {
    const config = configModule.loadConfig();
    const fullId = String(input.model || input.fullId || '');
    const resolved = catalog.findModel(fullId, config);
    if (!resolved) return { ok: false, error: 'Unknown model.' };
    const provider = catalog.getProvider(resolved.providerId, config);
    const probeable = provider && provider.protocol === 'openai'
      && (String(provider.id).startsWith('custom_') || ['ollama', 'lmstudio'].includes(provider.id));
    if (!probeable) return { ok: true, profile: resolved.reasoning, cached: true };
    const cached = config.reasoningHints?.[fullId];
    const age = Date.now() - Date.parse(cached?.checkedAt || 0);
    if (!input.force && cached && age < 7 * 24 * 60 * 60 * 1000) {
      return { ok: true, profile: resolved.reasoning, cached: true };
    }
    try {
      const hint = await providers.probeModelReasoning({
        providerId: resolved.providerId,
        modelId: resolved.modelId || fullId.slice(resolved.providerId.length + 1),
        config,
      });
      if (!hint) return { ok: true, profile: resolved.reasoning, cached: false, unknown: true };
      config.reasoningHints = config.reasoningHints || {};
      config.reasoningHints[fullId] = hint;
      configModule.saveConfig(config);
      broadcast({ type: 'config:updated' });
      const fresh = catalog.findModel(fullId, config);
      return { ok: true, profile: fresh?.reasoning || resolved.reasoning, cached: false };
    } catch (error) {
      return { ok: false, error: error.message, profile: resolved.reasoning };
    }
  });

  require('electron').ipcMain.handle('providers:setKey', async (_event, input = {}) => {
    const config = configModule.loadConfig();
    const provider = catalog.getProvider(input.providerId, config);
    if (!provider) throw new Error('Unknown provider.');
    if (input.baseUrl !== undefined) {
      configModule.setProvider(config, input.providerId, { baseUrl: String(input.baseUrl).trim().slice(0, 500) });
    }
    if (input.apiKey !== undefined) {
      const value = String(input.apiKey).trim();
      if (value) {
        configModule.addProviderKey(config, input.providerId, {
          key: value,
          label: input.label || 'Default',
          makeActive: true,
        });
      }
    }
    if (input.autoRotate !== undefined) {
      configModule.setProvider(config, input.providerId, { autoRotate: Boolean(input.autoRotate) });
    }
    configModule.saveConfig(config);
    broadcast({ type: 'config:updated' });
    return configWithRuntime(config);
  });

  require('electron').ipcMain.handle('providers:addKey', async (_event, input = {}) => {
    const config = configModule.loadConfig();
    const provider = catalog.getProvider(input.providerId, config);
    if (!provider) throw new Error('Unknown provider.');
    configModule.addProviderKey(config, input.providerId, {
      key: input.key,
      label: input.label,
      makeActive: input.makeActive !== false,
    });
    configModule.saveConfig(config);
    broadcast({ type: 'config:updated' });
    return { config: configWithRuntime(config), providers: catalog.allProviders(config).map((provider) => catalog.publicProvider(provider, config)) };
  });

  require('electron').ipcMain.handle('providers:removeKey', async (_event, input = {}) => {
    const config = configModule.loadConfig();
    const provider = catalog.getProvider(input.providerId, config);
    if (!provider) throw new Error('Unknown provider.');
    const removed = configModule.removeProviderKey(config, input.providerId, input.keyId);
    if (!removed) throw new Error('Key not found.');
    configModule.saveConfig(config);
    broadcast({ type: 'config:updated' });
    return configWithRuntime(config);
  });

  require('electron').ipcMain.handle('providers:setActiveKey', async (_event, input = {}) => {
    const config = configModule.loadConfig();
    const provider = catalog.getProvider(input.providerId, config);
    if (!provider) throw new Error('Unknown provider.');
    configModule.setActiveProviderKey(config, input.providerId, input.keyId);
    configModule.saveConfig(config);
    broadcast({ type: 'config:updated' });
    return configWithRuntime(config);
  });

  require('electron').ipcMain.handle('providers:setAutoRotate', async (_event, input = {}) => {
    const config = configModule.loadConfig();
    const provider = catalog.getProvider(input.providerId, config);
    if (!provider) throw new Error('Unknown provider.');
    configModule.setProvider(config, input.providerId, { autoRotate: Boolean(input.autoRotate) });
    configModule.saveConfig(config);
    broadcast({ type: 'config:updated' });
    return configWithRuntime(config);
  });

  require('electron').ipcMain.handle('providers:test', async (_event, input = {}) => {
    const config = configModule.loadConfig();
    const provider = catalog.getProvider(input.providerId, config);
    if (!provider) return { ok: false, error: 'Unknown provider.' };
    try {
      const baseUrl = input.baseUrl !== undefined
        ? String(input.baseUrl).trim()
        : config.providers?.[input.providerId]?.baseUrl || provider.baseUrl;
      const apiKey = input.apiKey !== undefined
        ? String(input.apiKey).trim()
        : undefined;
      const models = await providers.listModelsAt({
        baseUrl,
        apiKey: apiKey || configModule.resolveKey(config, input.providerId, provider, input.keyId),
        protocol: provider.protocol,
      });
      return { ok: true, count: models.length, models: models.slice(0, 40).map((model) => ({ id: model.id, name: model.name })) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  require('electron').ipcMain.handle('providers:probe', async (_event, input = {}) => {
    try {
      const protocol = ['openai', 'anthropic', 'gemini'].includes(input.protocol) ? input.protocol : 'openai';
      const models = await providers.listModelsAt({
        baseUrl: input.baseUrl,
        apiKey: String(input.apiKey || '').trim(),
        protocol,
      });
      return { ok: true, models: models.slice(0, 100) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  require('electron').ipcMain.handle('providers:discover', async (_event, input = {}) => {
    const config = configModule.loadConfig();
    try {
      const models = await discoverProviderModels(config, input.providerId);
      configModule.saveConfig(config);
      broadcast({ type: 'config:updated' });
      return { ok: true, models };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  require('electron').ipcMain.handle('providers:addCustom', async (_event, input = {}) => {
    const config = configModule.loadConfig();
    const protocol = ['openai', 'anthropic', 'gemini'].includes(input.protocol) ? input.protocol : 'openai';
    const baseId = `custom_${slugify(input.name || 'provider')}`;
    let id = baseId;
    let counter = 2;
    while (catalog.getProvider(id, config)) { id = `${baseId}_${counter}`; counter += 1; }
    const modelIds = String(input.models || '')
      .split(/[\n,]/)
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 40);
    const models = (modelIds.length ? modelIds : ['default']).map((modelId) => ({
      id: modelId,
      name: modelId,
      context: 128000,
      tags: ['Custom'],
    }));
    const provider = {
      id,
      name: String(input.name || 'Custom provider').slice(0, 60),
      monogram: String(input.name || 'C').slice(0, 1).toUpperCase(),
      protocol,
      kind: 'custom',
      description: 'Custom OpenAI-compatible endpoint.',
      baseUrl: String(input.baseUrl || '').trim(),
      keyEnv: '',
      docs: '',
      models,
    };
    if (!/^https?:\/\//i.test(provider.baseUrl)) throw new Error('A valid http(s) base URL is required.');
    config.customProviders = [...(config.customProviders || []), provider];
    if (input.apiKey) {
      configModule.addProviderKey(config, id, {
        key: String(input.apiKey).trim(),
        label: input.keyLabel || 'Default',
        makeActive: true,
      });
    }
    configModule.saveConfig(config);
    broadcast({ type: 'config:updated' });
    return configWithRuntime(config);
  });

  require('electron').ipcMain.handle('providers:removeCustom', async (_event, providerId) => {
    const config = configModule.loadConfig();
    const provider = (config.customProviders || []).find((entry) => entry.id === providerId);
    if (!provider) throw new Error('Only custom providers can be removed.');
    config.customProviders = config.customProviders.filter((entry) => entry.id !== providerId);
    if (config.providers) delete config.providers[providerId];
    if (config.discoveredModels) delete config.discoveredModels[providerId];
    if (String(config.defaultModel).startsWith(`${providerId}/`)) config.defaultModel = '';
    configModule.saveConfig(config);
    pet.refreshDefault();
    broadcast({ type: 'config:updated' });
    return configWithRuntime(config);
  });

  /* ------------------------------------------------------- search & computer */

  ipcMainHandle('dictation:options', async () => {
    const config = configModule.loadConfig();
    return {
      providers: dictation.dictationProviders(config)
        .filter((provider) => provider.hasKey)
        .map(({ id, name, baseUrl, models }) => ({ id, name, baseUrl, models })),
      model: String(config.dictation?.model || ''),
    };
  });

  ipcMainHandle('dictation:transcribe', async (_event, input = {}) => dictation.transcribeAudio(input));

  require('electron').ipcMain.handle('search:test', async (_event, input = {}) => {
    const config = configModule.loadConfig();
    try {
      const payload = await search.searchWeb(input.query || 'blank agent harness', {
        config,
        count: 5,
      });
      return { ok: true, ...payload };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  require('electron').ipcMain.handle('search:setKey', async (_event, input = {}) => {
    const id = String(input.id || '');
    if (!search.BACKENDS.some((backend) => backend.id === id)) throw new Error('Unknown search backend.');
    const config = configModule.loadConfig();
    config.search = config.search || { keys: {} };
    if (!config.search.keys) config.search.keys = {};
    const value = String(input.key || '').trim();
    if (value) config.search.keys[id] = value.slice(0, 4096);
    else delete config.search.keys[id];
    configModule.saveConfig(config);
    broadcast({ type: 'config:updated' });
    return configWithRuntime(config);
  });

  let computerShotInFlight = false;
  const screenshotUrl = (filePath) => {
    const dir = path.resolve(computer.computerDir());
    const file = path.resolve(String(filePath || ''));
    if (!file.startsWith(dir + path.sep)) return '';
    return `blank-media://computer/${encodeURIComponent(path.basename(file))}`;
  };
  require('electron').ipcMain.handle('computer:testScreenshot', async () => {
    if (computerShotInFlight) throw new Error('A screenshot is already being captured.');
    computerShotInFlight = true;
    try {
      const shot = await computer.screenshot();
      return { ok: true, url: screenshotUrl(shot.path), ...shot };
    } finally {
      computerShotInFlight = false;
    }
  });

  require('electron').ipcMain.handle('computer:openScreenshot', async (_event, filePath = '') => {
    const dir = path.resolve(computer.computerDir());
    const file = path.resolve(String(filePath || ''));
    if (!file.startsWith(dir + path.sep)) throw new Error('That file is not a blank screenshot.');
    if (!/\.(png|jpe?g)$/i.test(file)) throw new Error('That file is not a screenshot.');
    const stat = await fs.promises.stat(file).catch(() => null);
    if (!stat?.isFile()) throw new Error('The screenshot no longer exists.');
    const error = await shell.openPath(file);
    if (error) throw new Error(error);
    return { ok: true };
  });

  /* -------------------------------------------------------------------- ssh */

  const sshPublic = () => ({ hosts: getSsh().listHosts(configModule.loadConfig()) });

  require('electron').ipcMain.handle('ssh:list', async () => sshPublic());

  require('electron').ipcMain.handle('ssh:add', async (_event, input = {}) => {
    const config = configModule.loadConfig();
    const hosts = config.ssh?.hosts || [];
    if (hosts.length >= 24) throw new Error('You can save up to 24 SSH hosts.');
    let host;
    try {
      host = getSsh().normalizeHost(input);
    } catch (err) {
      throw new Error(err.message);
    }
    const password = String(input.password || '');
    const passphrase = String(input.passphrase || '');
    if (host.authType === 'password' && !password) throw new Error('Enter the SSH password.');
    if (host.authType === 'key' && !host.keyPath) throw new Error('Enter the private key path.');
    host.password = password ? getSsh().seal(password) : '';
    host.passphrase = passphrase ? getSsh().seal(passphrase) : '';
    const next = { ...config, ssh: { ...(config.ssh || {}), hosts: [...hosts, host] } };
    configModule.saveConfig(next);
    broadcast({ type: 'config:updated' });
    return sshPublic();
  });

  require('electron').ipcMain.handle('ssh:remove', async (_event, id) => {
    const config = configModule.loadConfig();
    const hosts = (config.ssh?.hosts || []).filter((host) => host.id !== id);
    configModule.saveConfig({ ...config, ssh: { ...(config.ssh || {}), hosts } });
    broadcast({ type: 'config:updated' });
    return sshPublic();
  });

  require('electron').ipcMain.handle('ssh:test', async (_event, input = {}) => {
    const config = configModule.loadConfig();
    const host = getSsh().findHost(config, input.id || input.host);
    try {
      const result = await getSsh().testHost(host);
      if (result.fingerprint && result.fingerprint !== host.fingerprint) {
        const hosts = (config.ssh?.hosts || []).map((item) => item.id === host.id ? { ...item, fingerprint: result.fingerprint } : item);
        configModule.saveConfig({ ...config, ssh: { ...(config.ssh || {}), hosts } });
        broadcast({ type: 'config:updated' });
      }
      return { ...result, hosts: getSsh().listHosts(configModule.loadConfig()) };
    } catch (error) {
      return {
        ok: false,
        code: -1,
        message: String(error?.message || error || 'SSH connection failed').replace(/^Error:\s*/, ''),
        hosts: getSsh().listHosts(configModule.loadConfig()),
      };
    }
  });

  /* ----------------------------------------------------------------- sessions */

  require('electron').ipcMain.handle('sessions:list', async () => {
    const config = configModule.loadConfig();
    const sessions = store.listSessions(config.workspace).map((session) => ({
      ...session,
      running: state.sessionRuns.has(session.id),
    }));
    return { sessions, workspace: config.workspace };
  });

  require('electron').ipcMain.handle('sessions:get', async (_event, id) => {
    const session = store.getSession(id);
    if (!session) return { session: null };
    for (const message of session.messages || []) delete message.providerItems;
    const queue = (state.queues.get(id) || []).map((item) => ({ queueId: item.id, text: item.text, interrupt: Boolean(item.interrupt) }));
    return { session, running: state.sessionRuns.has(id), queue };
  });

  require('electron').ipcMain.handle('sessions:create', async (_event, input = {}) => {
    const config = configModule.loadConfig();
    const model = input.model && catalog.findModel(input.model, config) ? input.model : config.defaultModel;
    const mode = ['agent', 'coding', 'design', 'research', 'plan', 'ask'].includes(input.mode) ? input.mode : 'agent';
    const customTitle = String(input.title || '').trim();
    const session = store.createSession({
      workspace: config.workspace,
      model,
      mode,
      title: (customTitle || 'New session').slice(0, 120),
      titleSource: customTitle ? 'manual' : 'auto',
      reasoningEffort: input.reasoningEffort,
    });
    notifySession(session);
    return { session };
  });

  require('electron').ipcMain.handle('sessions:update', async (_event, input = {}) => {
    const session = store.getSession(input.id);
    if (!session) throw new Error('Session not found.');
    if (input.title !== undefined) {
      session.title = String(input.title).trim().slice(0, 120) || 'New session';
      session.titleSource = 'manual';
    }
    if (input.pinned !== undefined) session.pinned = Boolean(input.pinned);
    if (input.archived !== undefined) {
      session.archived = Boolean(input.archived);
      if (session.archived) session.pinned = false;
    }
    if (input.model !== undefined) {
      const config = configModule.loadConfig();
      if (!catalog.findModel(input.model, config)) throw new Error('Unknown model.');
      session.model = input.model;
    }
    if (input.mode !== undefined && ['agent', 'coding', 'design', 'research', 'plan', 'ask'].includes(input.mode)) session.mode = input.mode;
    if (input.reasoningEffort !== undefined && reasoning.isEffort(input.reasoningEffort)) {
      session.reasoningEffort = input.reasoningEffort;
    }
    store.saveSession(session);
    notifySession(session);
    return { session };
  });

  require('electron').ipcMain.handle('sessions:delete', async (_event, id) => {
    if (state.compacting.has(id)) throw new Error('Wait for context compaction to finish before deleting.');
    const runId = state.sessionRuns.get(id);
    if (runId) {
      const run = state.runs.get(runId);
      run?.controller.abort();
      denyApprovalsFor((approval) => approval.sessionId === id);
    }
    store.deleteSession(id);
    broadcast({ type: 'sessions:refresh' });
    return { ok: true };
  });

  require('electron').ipcMain.handle('sessions:compact', async (_event, id) => {
    const session = store.getSession(id);
    if (!session) throw new Error('Session not found.');
    if (state.sessionRuns.has(id)) throw new Error('Stop the run before compacting.');
    if (state.compacting.has(id)) throw new Error('Compaction is already running.');
    const config = configModule.loadConfig();
    const before = Number(session.compactedCount) || 0;
    state.compacting.add(id);
    try {
      const result = await compactSession({ session, config });
      if (result.ok) {
        broadcast({ type: 'session:updated', session: summaryOf(store.getSession(id)) });
        return { ...result, archived: Math.max(0, result.compacted - before), session: store.getSession(id) };
      }
      throw new Error(result.error);
    } finally {
      state.compacting.delete(id);
      setTimeout(() => {
        try { drainQueue(id); } catch {}
      }, 60);
    }
  });

  /* --------------------------------------------------------------------- chat */

  function queueFor(sessionId) {
    if (!state.queues.has(sessionId)) state.queues.set(sessionId, []);
    return state.queues.get(sessionId);
  }

  function queueUpdateEvent(sessionId, win) {
    const queue = (state.queues.get(sessionId) || []).map((item) => ({ queueId: item.id, text: item.text, queuedAt: item.queuedAt, interrupt: Boolean(item.interrupt) }));
    const payload = { type: 'chat:queue:update', sessionId, queue };
    sendEvent(win, payload);
    const main = getWindow();
    if (main && main !== win) sendEvent(main, payload);
    return queue;
  }

  function runNotificationBody(session, outcome) {
    if (outcome?.error) return String(outcome.error);
    if (outcome?.stopped) return 'Stopped before finishing.';
    const messages = session?.messages || [];
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message.role !== 'assistant') continue;
      const text = String(message.content || '').replace(/```[\s\S]*?```/g, ' ').replace(/\s+/g, ' ').trim();
      if (text) return text.slice(0, 180);
    }
    return 'The run is finished.';
  }

  function launchRun({ session, config, win }) {
    const runId = uid('run_');
    const controller = new AbortController();
    const model = catalog.findModel(session.model || config.defaultModel, config);
    try { computer.setActor(model?.id || model?.name || ''); } catch {}
    state.runs.set(runId, { controller, win, sessionId: session.id });
    state.sessionRuns.set(session.id, runId);

    const emit = (payload) => {
      const enriched = { ...payload, sessionId: session.id, runId };
      sendEvent(win, enriched);
      const main = getWindow();
      if (main && main !== win) sendEvent(main, enriched);
      sendPetEvent(enriched);
      remote.publish(enriched);
      messengers.publish(enriched);
    };

    const requestApproval = (request) => new Promise((resolve) => {
      const approvalId = request.approvalId;
      const timer = setTimeout(() => {
        state.approvals.delete(approvalId);
        const expired = { type: 'approval:expired', approvalId, sessionId: session.id, runId };
        sendEvent(win, expired);
        const main = getWindow();
        if (main && main !== win) sendEvent(main, expired);
        sendPetEvent(expired);
        resolve('deny');
      }, 300000);
      state.approvals.set(approvalId, {
        resolve,
        timer,
        win,
        sessionId: session.id,
        runId,
        tool: request.tool,
        label: request.label || request.tool,
        summary: summarizeArgs(request.tool, request.args),
        reason: request.reason || 'policy',
      });
      const payload = {
        type: 'approval',
        approvalId,
        sessionId: session.id,
        runId,
        tool: request.tool,
        label: request.label || request.tool,
        args: request.args,
        summary: summarizeArgs(request.tool, request.args),
        reason: request.reason || 'policy',
      };
      sendEvent(win, payload);
      const main = getWindow();
      if (main && main !== win) sendEvent(main, payload);
      sendPetEvent(payload);
      remote.publish({ ...payload, type: 'tool:start', summary: payload.summary });
      messengers.approval(payload);
      notifications.approval({ label: payload.label, summary: payload.summary, sessionId: session.id });
    });

    runAgent({
      session,
      config,
      emit,
      signal: controller.signal,
      requestApproval,
      mcp,
    }).then((outcome) => {
      const fresh = store.getSession(session.id) || session;
      emit({
        type: 'run:done',
        outcome,
        usage: fresh.usage,
        title: fresh.title,
        tasks: fresh.tasks || [],
        files: fresh.files || [],
        summary: Boolean(fresh.summary),
      });
      notifySession(fresh);
      triggerEngine?.notifySession({ sessionId: fresh.id, session: fresh, outcome });
      broadcast({ type: 'sessions:refresh' });
      notifications.finished({
        title: fresh.title ? `Finished · ${fresh.title}` : 'Run finished',
        body: runNotificationBody(fresh, outcome),
        sessionId: fresh.id,
        failed: !outcome.ok,
      });
      maybeReflect(win, fresh);
    }).catch((err) => {
      emit({ type: 'run:done', outcome: { ok: false, error: err.message } });
    }).finally(() => {
      if (state.sessionRuns.get(session.id) === runId) state.sessionRuns.delete(session.id);
      state.runs.delete(runId);
      denyApprovalsFor((approval) => approval.runId === runId);
      setTimeout(() => {
        try { drainQueue(session.id); } catch {}
        broadcast({ type: 'sessions:refresh' });
      }, 60);
    });

    return { runId };
  }

  function drainQueue(sessionId) {
    if (state.sessionRuns.has(sessionId)) return null;
    if (state.compacting.has(sessionId)) return null;
    const queue = state.queues.get(sessionId);
    if (!queue || !queue.length) return null;
    const next = queue.shift();
    const session = store.getSession(sessionId);
    if (!session) {
      state.queues.delete(sessionId);
      return null;
    }
    const config = configModule.loadConfig();
    if (next.model && catalog.findModel(next.model, config)) session.model = next.model;
    if (next.mode && ['agent', 'coding', 'design', 'research', 'plan', 'ask'].includes(next.mode)) session.mode = next.mode;
    if (next.reasoningEffort && reasoning.isEffort(next.reasoningEffort)) {
      session.reasoningEffort = next.reasoningEffort;
    }
    const message = {
      id: uid('msg_'),
      role: 'user',
      content: next.text,
      attachments: next.attachments || [],
      ...(next.meta ? { meta: next.meta } : {}),
      at: new Date().toISOString(),
      source: next.source || 'desktop',
    };
    session.messages.push(message);
    if (!session.title || session.title === 'New session') {
      session.title = store.titleFrom(next.text || (next.attachments?.[0]?.name ?? 'Attachment'));
    }
    store.saveSession(session);
    notifySession(session);
    const win = next.win && !next.win.isDestroyed() ? next.win : getWindow();
    const payload = {
      type: 'chat:queued:sent',
      sessionId,
      queueId: next.id,
      interrupt: Boolean(next.interrupt),
      message,
      title: session.title,
      queueLength: queue.length,
      source: next.source || 'desktop',
    };
    sendEvent(win, payload);
    const main = getWindow();
    if (main && main !== win) sendEvent(main, payload);
    if (!queue.length) state.queues.delete(sessionId);
    const run = launchRun({ session, config, win });
    return { ...run, message, title: session.title };
  }

  function abortSessionRun(sessionId) {
    const runId = state.sessionRuns.get(sessionId);
    const run = runId ? state.runs.get(runId) : null;
    if (run) {
      run.controller.abort();
      denyApprovalsFor((approval) => approval.sessionId === sessionId);
    }
    return run;
  }

  function stopSessionRun(sessionId) {
    const hadQueue = state.queues.delete(sessionId);
    const run = abortSessionRun(sessionId);
    if (run) queueUpdateEvent(sessionId, run.win);
    return { ok: Boolean(run), clearedQueue: Boolean(hadQueue) };
  }

  function startChatRun({ win, input = {}, queueIfRunning = false, interrupt = false, source = 'desktop', meta = null }) {
    ensureHome();
    const config = configModule.loadConfig();
    const text = String(input.text || '').slice(0, 200000);
    const attachments = sanitizeAttachments(input.attachments);
    if (!text.trim() && !attachments.length) throw new Error('Message is empty.');
    if (state.compacting.has(input.sessionId)) throw new Error('Wait for context compaction to finish before sending.');
    let session = input.sessionId ? store.getSession(input.sessionId) : null;

    if (session && state.sessionRuns.has(session.id)) {
      const action = sendMode({ running: true, queueIfRunning, interrupt });
      if (action === 'reject') throw new Error('This session is already running. Stop it or queue this message.');
      const urgent = action === 'interrupt';
      const item = {
        id: uid('q_'),
        text,
        attachments,
        ...(meta ? { meta } : {}),
        model: input.model,
        mode: input.mode,
        reasoningEffort: input.reasoningEffort,
        win,
        source,
        queuedAt: new Date().toISOString(),
        ...(urgent ? { interrupt: true } : {}),
      };
      const queue = queueFor(session.id);
      if (urgent) enqueueInterrupt(queue, item);
      else queue.push(item);
      const payload = {
        type: 'chat:queued',
        sessionId: session.id,
        queueId: item.id,
        text,
        interrupt: urgent,
        queueLength: queue.length,
        at: item.queuedAt,
        title: session.title,
      };
      sendEvent(win, payload);
      const main = getWindow();
      if (main && main !== win) sendEvent(main, payload);
      if (urgent) abortSessionRun(session.id);
      return { sessionId: session.id, queued: true, interrupt: urgent, queueId: item.id, queueLength: queue.length, title: session.title, model: session.model, mode: session.mode };
    }

    if (!session) {
      const model = input.model && catalog.findModel(input.model, config) ? input.model : config.defaultModel;
      const mode = ['agent', 'coding', 'design', 'research', 'plan', 'ask'].includes(input.mode) ? input.mode : 'agent';
      session = store.createSession({ workspace: config.workspace, model, mode, reasoningEffort: input.reasoningEffort });
    } else {
      if (input.model && catalog.findModel(input.model, config)) session.model = input.model;
      if (input.mode && ['agent', 'coding', 'design', 'research', 'plan', 'ask'].includes(input.mode)) session.mode = input.mode;
      if (input.reasoningEffort && reasoning.isEffort(input.reasoningEffort)) {
        session.reasoningEffort = input.reasoningEffort;
      }
      session.workspace = session.workspace || config.workspace;
    }

    const message = {
      id: uid('msg_'),
      role: 'user',
      content: text,
      attachments,
      ...(meta ? { meta } : {}),
      at: new Date().toISOString(),
      source,
    };
    session.messages.push(message);
    if (!session.title || session.title === 'New session') {
      session.title = store.titleFrom(text || (attachments[0]?.name ?? 'Attachment'));
    }
    store.saveSession(session);
    notifySession(session);

    const { runId } = launchRun({ session, config, win });
    return {
      sessionId: session.id,
      runId,
      title: session.title,
      message,
      model: session.model,
      mode: session.mode,
      queued: false,
    };
  }

  require('electron').ipcMain.handle('chat:send', async (event, input = {}) => {
    const win = winFromEvent(event);
    return startChatRun({
      win,
      input,
      queueIfRunning: Boolean(input.queue),
      interrupt: Boolean(input.interrupt),
      source: 'desktop',
    });
  });

  require('electron').ipcMain.handle('chat:approve', async (_event, input = {}) => approveApproval(input.approvalId, input.decision));

  require('electron').ipcMain.handle('chat:stop', async (_event, sessionId) => stopSessionRun(sessionId));

  require('electron').ipcMain.handle('chat:queue', async (_event, sessionId) => {
    return { queue: (state.queues.get(sessionId) || []).map((item) => ({ queueId: item.id, text: item.text, queuedAt: item.queuedAt, interrupt: Boolean(item.interrupt) })) };
  });

  require('electron').ipcMain.handle('chat:queue:remove', async (_event, input = {}) => {
    const queue = state.queues.get(input.sessionId) || [];
    const index = queue.findIndex((item) => item.id === input.queueId);
    if (index >= 0) queue.splice(index, 1);
    if (!queue.length) state.queues.delete(input.sessionId);
    const win = getWindow();
    return { queue: queueUpdateEvent(input.sessionId, win) };
  });

  require('electron').ipcMain.handle('chat:openWorkspace', async () => {
    const config = configModule.loadConfig();
    if (!config.workspace) throw new Error('No workspace open.');
    await shell.openPath(config.workspace);
    return true;
  });

  /* ---------------------------------------------------------------- workspace */

  require('electron').ipcMain.handle('workspace:choose', async (event) => {
    const win = winFromEvent(event);
    const result = await dialog.showOpenDialog(win, {
      title: 'Open workspace',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true };
    const config = configModule.loadConfig();
    config.workspace = result.filePaths[0];
    configModule.saveConfig(config);
    broadcast({ type: 'config:updated' });
    return { workspace: config.workspace, tree: store.fileTree(config.workspace, { depth: 2 }) };
  });

  require('electron').ipcMain.handle('workspace:tree', async () => {
    const config = configModule.loadConfig();
    return { workspace: config.workspace, tree: store.fileTree(config.workspace || '', { depth: 2 }) };
  });

  require('electron').ipcMain.handle('workspace:read', async (_event, relativePath) => {
    const config = configModule.loadConfig();
    const full = store.safePath(config.workspace, relativePath);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) throw new Error('That is a directory.');
    if (!store.isTextFile(full)) throw new Error('Binary or unsupported file type.');
    if (stat.size > 200000) throw new Error('File is too large to preview.');
    return { path: relativePath, content: fs.readFileSync(full, 'utf8') };
  });

  require('electron').ipcMain.handle('workspace:openPath', async (_event, relativePath) => {
    const config = configModule.loadConfig();
    const full = relativePath ? store.safePath(config.workspace, relativePath) : config.workspace;
    const error = await shell.openPath(full);
    if (error) throw new Error(error);
    return true;
  });

  require('electron').ipcMain.handle('workspace:reveal', async (_event, relativePath) => {
    const config = configModule.loadConfig();
    shell.showItemInFolder(store.safePath(config.workspace, relativePath));
    return true;
  });

  require('electron').ipcMain.handle('workspace:saveAs', async (event, input = {}) => {
    const config = configModule.loadConfig();
    if (!config.workspace) throw new Error('No workspace open.');
    const relativePath = String(input.path || '');
    const full = store.safePath(config.workspace, relativePath);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) throw new Error('That is a directory.');
    const fileName = String(input.name || path.basename(full)).replace(/[\\/:*?"<>|]+/g, '-').slice(0, 140) || path.basename(full);
    const win = winFromEvent(event);
    const result = await dialog.showSaveDialog(win, {
      title: 'Save file',
      defaultPath: path.join(app.getPath('downloads'), fileName),
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    fs.copyFileSync(full, result.filePath);
    return { canceled: false, path: result.filePath, bytes: stat.size };
  });

  require('electron').ipcMain.handle('workspace:openEditor', async () => {
    const config = configModule.loadConfig();
    if (!config.workspace) throw new Error('No workspace open.');
    return await new Promise((resolve) => {
      const bin = isWin ? 'code.cmd' : 'code';
      const child = spawn(bin, ['.'], { cwd: config.workspace, detached: true, stdio: 'ignore', shell: isWin });
      let settled = false;
      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        resolve({ ok: false, error: `Could not launch VS Code: ${err.message}` });
      });
      child.unref();
      setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({ ok: true });
      }, 700);
    });
  });

  require('electron').ipcMain.handle('workspace:writeAgents', async (_event, input = {}) => {
    const config = configModule.loadConfig();
    if (!config.workspace) throw new Error('No workspace open.');
    const file = path.join(config.workspace, 'AGENTS.md');
    if (fs.existsSync(file) && !input.overwrite) return { exists: true, path: file };
    let commands = '';
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(config.workspace, 'package.json'), 'utf8'));
      const scripts = pkg.scripts || {};
      const lines = [];
      if (scripts.install || pkg.packageManager) lines.push(`- Install: \`${pkg.packageManager || 'npm'} install\``);
      for (const key of ['dev', 'build', 'test', 'lint', 'typecheck']) {
        if (scripts[key]) lines.push(`- ${key[0].toUpperCase() + key.slice(1)}: \`npm run ${key}\``);
      }
      if (lines.length) commands = `\n## Commands\n\n${lines.join('\n')}\n`;
    } catch {}
    const content = `# AGENTS.md

Guidance for coding agents working in this repository. blank reads this file automatically.

## Working agreements

- Read a file before changing it. Keep changes focused on the request.
- Match the existing style and architecture; do not introduce a new framework without discussing it.
- Run the relevant checks before claiming work is done.
- Never commit secrets or unrelated changes.
${commands}
## Project context

<!-- Add architecture notes, invariants, and known pitfalls here. -->
`;
    fs.writeFileSync(file, content, 'utf8');
    return { exists: false, path: file };
  });

  /* --------------------------------------------------------------------- MCP */

  require('electron').ipcMain.handle('mcp:list', async () => {
    const config = configModule.loadConfig();
    return {
      servers: mcp.statuses(config),
      catalog: mcp.tools().map(({ name, originalName, serverName, description }) => ({ name, originalName, serverName, description })),
    };
  });

  require('electron').ipcMain.handle('mcp:refresh', async () => {
    const config = configModule.loadConfig();
    await mcp.ensure(config, { force: true });
    return { servers: mcp.statuses(config), catalog: mcp.tools() };
  });

  require('electron').ipcMain.handle('mcp:add', async (_event, input = {}) => {
    const config = configModule.loadConfig();
    const server = mcp.makeServer(input);
    server.transport = input.transport === 'http' ? 'http' : 'stdio';
    config.mcpServers = [...(config.mcpServers || []), server];
    configModule.saveConfig(config);
    await mcp.ensure(config, { force: true });
    broadcast({ type: 'config:updated' });
    return { server: mcp.statuses(config).find((status) => status.id === server.id) };
  });

  require('electron').ipcMain.handle('mcp:update', async (_event, input = {}) => {
    const config = configModule.loadConfig();
    const index = (config.mcpServers || []).findIndex((entry) => entry.id === input.id);
    if (index < 0) throw new Error('Server not found.');
    const before = config.mcpServers[index];
    const updated = mcp.updateServer(before, input);
    const urlChanged = String(before.url || '') !== String(updated.url || '');
    config.mcpServers[index] = updated;
    configModule.saveConfig(config);
    if (urlChanged) oauthModule.removeEntry('mcp', updated.id);
    mcp.forget(updated.id);
    await mcp.ensure(config, { force: true });
    broadcast({ type: 'config:updated' });
    const servers = mcp.statuses(config);
    return { server: servers.find((status) => status.id === updated.id), servers };
  });

  require('electron').ipcMain.handle('mcp:addExample', async () => {
    const config = configModule.loadConfig();
    const existing = (config.mcpServers || []).find((server) => server.example);
    if (existing) {
      await mcp.ensure(config, { force: true });
      return { server: mcp.statuses(config).find((status) => status.id === existing.id), existed: true };
    }
    const file = path.join(APP_ROOT, 'examples', 'mcp-echo-server.js');
    const server = {
      id: `mcp_echo_${Math.random().toString(36).slice(2, 6)}`,
      name: 'Echo (example)',
      transport: 'stdio',
      enabled: true,
      command: `node "${file}"`,
      cwd: '',
      url: '',
      env: {},
      headers: {},
      example: true,
    };
    config.mcpServers = [...(config.mcpServers || []), server];
    configModule.saveConfig(config);
    await mcp.ensure(config, { force: true });
    broadcast({ type: 'config:updated' });
    return { server: mcp.statuses(config).find((status) => status.id === server.id) };
  });

  require('electron').ipcMain.handle('mcp:remove', async (_event, id) => {
    const config = configModule.loadConfig();
    config.mcpServers = (config.mcpServers || []).filter((server) => server.id !== id);
    configModule.saveConfig(config);
    await mcp.ensure(config, { force: true });
    broadcast({ type: 'config:updated' });
    return { servers: mcp.statuses(config) };
  });

  require('electron').ipcMain.handle('mcp:toggle', async (_event, input = {}) => {
    const config = configModule.loadConfig();
    const server = (config.mcpServers || []).find((entry) => entry.id === input.id);
    if (!server) throw new Error('Server not found.');
    server.enabled = Boolean(input.enabled);
    configModule.saveConfig(config);
    await mcp.ensure(config, { force: true });
    broadcast({ type: 'config:updated' });
    return { servers: mcp.statuses(config) };
  });

  ipcMainHandle('mcp:oauthStart', async (_event, input = {}) => {
    const config = configModule.loadConfig();
    const server = (config.mcpServers || []).find((entry) => entry.id === input.id);
    if (!server) throw new Error('Server not found.');
    if (server.transport !== 'http') throw new Error('OAuth applies to remote HTTP MCP servers.');
    const status = await oauthModule.authorizeMcpServer({
      server,
      openExternal: (url) => shell.openExternal(url),
      onEvent: (event) => broadcast({ type: 'mcp:oauth', serverId: server.id, ...event }),
    });
    await mcp.ensure(configModule.loadConfig(), { force: true });
    broadcast({ type: 'config:updated' });
    return { status, servers: mcp.statuses(configModule.loadConfig()) };
  });

  ipcMainHandle('mcp:oauthSignOut', async (_event, input = {}) => {
    oauthModule.cancelFlow(input.id);
    const removed = oauthModule.removeEntry('mcp', input.id);
    const config = configModule.loadConfig();
    await mcp.ensure(config, { force: true });
    broadcast({ type: 'config:updated' });
    return { removed, servers: mcp.statuses(config) };
  });

  /* ------------------------------------------------------------ console & code */

  ipcMainHandle('console:run', async (_event, input = {}) => {
    const config = configModule.loadConfig();
    if (!config.workspace) throw new Error('Open a workspace folder before running commands.');
    const command = String(input.command || '').slice(0, 4000);
    if (!command.trim()) throw new Error('Enter a command to run.');
    return runConsoleCommand({
      workspace: config.workspace,
      command,
      timeout: Number(input.timeout) || undefined,
    });
  });

  ipcMainHandle('console:terminalStart', async () => startTerminal());

  ipcMainHandle('console:terminalState', async () => {
    if (!terminalSession) return { running: false, buffer: '', cwd: '', workspace: '', busy: false };
    return terminalSession.state();
  });

  ipcMainHandle('console:terminalWrite', async (_event, input = {}) => {
    if (!terminalSession) startTerminal();
    if (!terminalSession) throw new Error('The terminal is not running.');
    const text = String(input.data || '');
    if (!text.trim()) return { ok: true, skipped: true };
    return { ok: terminalSession.write(text) };
  });

  ipcMainHandle('console:terminalStop', async () => {
    stopTerminal();
    return { ok: true };
  });

  ipcMainHandle('console:terminalRestart', async () => {
    stopTerminal();
    return startTerminal();
  });

  ipcMainHandle('console:terminalClear', async () => {
    if (terminalSession) terminalSession.clear();
    return { ok: true };
  });

  ipcMainHandle('code:overview', async () => {
    const config = configModule.loadConfig();
    return codeModule.overview(config.workspace);
  });

  ipcMainHandle('code:diff', async (_event, input = {}) => {
    const config = configModule.loadConfig();
    if (!config.workspace) throw new Error('Open a workspace folder first.');
    return codeModule.gitDiff(config.workspace, {
      file: String(input.file || ''),
      staged: Boolean(input.staged),
    });
  });

  ipcMainHandle('code:checks', async () => {
    const config = configModule.loadConfig();
    return { checks: codeModule.detectChecks(config.workspace) };
  });

  ipcMainHandle('code:runCheck', async (_event, input = {}) => {
    const config = configModule.loadConfig();
    if (!config.workspace) throw new Error('Open a workspace folder first.');
    return codeModule.runCheck(config.workspace, String(input.id || ''));
  });

  /* ------------------------------------------------------------------- APIs */

  ipcMainHandle('apis:list', async () => {
    const config = configModule.loadConfig();
    return { apis: apisModule.publicApis(config) };
  });

  ipcMainHandle('apis:save', async (_event, input = {}) => {
    const config = configModule.loadConfig();
    const existing = input.id ? (config.apis || []).find((api) => api.id === input.id) || null : null;
    if (input.id && !existing) throw new Error('That API connector no longer exists.');
    const api = apisModule.sanitizeApi(input, existing);
    config.apis = [...(config.apis || []).filter((entry) => entry.id !== api.id), api];
    configModule.saveConfig(config);
    broadcast({ type: 'config:updated' });
    return { apis: apisModule.publicApis(config) };
  });

  ipcMainHandle('apis:delete', async (_event, input = {}) => {
    const config = configModule.loadConfig();
    const before = (config.apis || []).length;
    config.apis = (config.apis || []).filter((api) => api.id !== input.id);
    if (config.apis.length !== before) {
      configModule.saveConfig(config);
      broadcast({ type: 'config:updated' });
    }
    return { deleted: config.apis.length !== before, apis: apisModule.publicApis(config) };
  });

  ipcMainHandle('apis:test', async (_event, input = {}) => {
    const config = configModule.loadConfig();
    const api = apisModule.findApi(config, input.id || input.name);
    if (!api) throw new Error('API connector not found.');
    try {
      const result = await apisModule.requestApi(api, {
        path: String(input.path || '/').slice(0, 2000),
        method: input.method || 'GET',
        timeout: 20_000,
      });
      return {
        ok: result.ok,
        status: result.status,
        statusText: result.statusText,
        contentType: result.contentType,
        durationMs: result.durationMs,
        body: String(result.body || '').slice(0, 4000),
        truncated: result.truncated || String(result.body || '').length > 4000,
      };
    } catch (err) {
      const secret = String(api.key || '');
      const message = secret ? String(err.message || err).split(secret).join('••••') : String(err.message || err);
      throw new Error(message);
    }
  });

  /* ----------------------------------------------------------------- plugins */

  function pluginInstallState() {
    const config = configModule.loadConfig();
    const statuses = new Map(mcp.statuses(config).map((server) => [server.id, server]));
    const serverPlugins = new Map();
    for (const server of config.mcpServers || []) {
      if (!server.pluginId) continue;
      serverPlugins.set(server.pluginId, {
        serverId: server.id,
        connected: Boolean(statuses.get(server.id)?.connected),
        error: statuses.get(server.id)?.error || '',
        toolCount: statuses.get(server.id)?.toolCount || 0,
      });
    }
    const skillSlugs = new Set(store.listSkills(config.workspace, config).map((skill) => skill.slug));
    return { serverPlugins, skillSlugs };
  }

  require('electron').ipcMain.handle('plugins:list', async () => {
    const { serverPlugins, skillSlugs } = pluginInstallState();
    const items = plugins.catalogItems().map((item) => {
      const server = serverPlugins.get(item.id);
      const installedSkill = item.kind === 'skill' && skillSlugs.has(plugins.slugForSkill(item));
      return {
        ...item,
        installed: item.kind === 'builtin' || Boolean(server) || Boolean(installedSkill),
        server: server || null,
      };
    });
    return { items };
  });

  require('electron').ipcMain.handle('plugins:install', async (_event, input = {}) => {
    const item = plugins.getPlugin(input.id);
    if (!item) throw new Error('Unknown plugin.');
    if (item.kind === 'builtin') return { builtin: true, id: item.id };
    const config = configModule.loadConfig();

    if (item.kind === 'skill') {
      const slug = plugins.slugForSkill(item);
      const existing = store.listSkills(config.workspace, config).find((skill) => skill.slug === slug);
      if (existing) return { already: true, skill: existing };
      const skill = store.createSkill({
        name: item.skill.name,
        description: item.skill.description,
        body: item.skill.body,
        scope: 'global',
        workspace: config.workspace,
      });
      broadcast({ type: 'skills:updated' });
      broadcast({ type: 'config:updated' });
      return { skill, installed: true };
    }

    if (item.kind === 'mcp') {
      const existing = (config.mcpServers || []).find((server) => server.pluginId === item.id);
      if (existing) {
        await mcp.ensure(config, { force: true });
        return { already: true, server: mcp.statuses(config).find((server) => server.id === existing.id) };
      }
      const token = String(input.token || '').trim();
      if (item.requires?.includes('token') && !token) throw new Error('This plugin needs a token.');
      if (token.length > 800) throw new Error('That token is too long.');
      const preset = plugins.pluginServer(item, { workspace: config.workspace });
      const server = mcp.makeServer(preset);
      server.pluginId = item.id;
      server.pluginName = item.name;
      if (token) {
        if (server.transport === 'http') {
          server.headers = { [item.tokenHeader || 'authorization']: `${item.tokenPrefix || ''}${token}` };
        } else {
          server.env = { [item.tokenEnv || 'TOKEN']: token };
        }
      }
      config.mcpServers = [...(config.mcpServers || []), server];
      configModule.saveConfig(config);
      await mcp.ensure(config, { force: true });
      broadcast({ type: 'config:updated' });
      return { installed: true, server: mcp.statuses(config).find((status) => status.id === server.id) };
    }

    throw new Error('Unsupported plugin kind.');
  });

  require('electron').ipcMain.handle('plugins:remove', async (_event, id) => {
    const config = configModule.loadConfig();
    const server = (config.mcpServers || []).find((entry) => entry.pluginId === id);
    if (!server) throw new Error('This plugin is not installed as an MCP server.');
    config.mcpServers = (config.mcpServers || []).filter((entry) => entry !== server);
    configModule.saveConfig(config);
    await mcp.ensure(config, { force: true });
    broadcast({ type: 'config:updated' });
    return { servers: mcp.statuses(config) };
  });

  /* ------------------------------------------------------------------ skills */

  require('electron').ipcMain.handle('skills:list', async () => {
    const config = configModule.loadConfig();
    return { skills: store.listSkills(config.workspace, config) };
  });

  require('electron').ipcMain.handle('skills:get', async (_event, id) => {
    const config = configModule.loadConfig();
    return { skill: store.getSkill(id, config.workspace) };
  });

  require('electron').ipcMain.handle('skills:create', async (_event, input = {}) => {
    const config = configModule.loadConfig();
    if (!input.name || !String(input.name).trim()) throw new Error('A skill name is required.');
    const skill = store.createSkill({
      name: String(input.name).slice(0, 60),
      description: String(input.description || '').slice(0, 300),
      body: String(input.body || '').slice(0, 30000),
      scope: input.scope === 'project' ? 'project' : 'global',
      workspace: config.workspace,
    });
    broadcast({ type: 'skills:updated' });
    return { skill, skills: store.listSkills(config.workspace, config) };
  });

  require('electron').ipcMain.handle('skills:delete', async (_event, id) => {
    const config = configModule.loadConfig();
    const ok = store.deleteSkill(id, config.workspace);
    if (!ok) throw new Error('Bundled skills cannot be deleted.');
    broadcast({ type: 'skills:updated' });
    return { skills: store.listSkills(config.workspace, config) };
  });

  require('electron').ipcMain.handle('skills:toggle', async (_event, input = {}) => {
    const config = configModule.loadConfig();
    const disabled = new Set(config.disabledSkills || []);
    if (input.enabled) disabled.delete(input.id);
    else disabled.add(input.id);
    config.disabledSkills = [...disabled];
    configModule.saveConfig(config);
    broadcast({ type: 'config:updated' });
    return { skills: store.listSkills(config.workspace, config) };
  });

  require('electron').ipcMain.handle('skills:openFolder', async () => {
    ensureHome();
    await shell.openPath(appPaths().skills);
    return appPaths().skills;
  });

  /* ------------------------------------------------------------------ memory */

  require('electron').ipcMain.handle('memory:list', async () => {
    const entries = store.listMemory();
    entries.sort((a, b) => Number(b.pinned) - Number(a.pinned) || new Date(b.updatedAt) - new Date(a.updatedAt));
    return { entries };
  });

  require('electron').ipcMain.handle('memory:add', async (_event, input = {}) => {
    const entry = store.addMemory({
      text: String(input.text || ''),
      tags: Array.isArray(input.tags) ? input.tags.map(String) : [],
      pinned: Boolean(input.pinned),
      source: 'manual',
    });
    broadcast({ type: 'memory:updated' });
    return { entry, entries: store.listMemory() };
  });

  require('electron').ipcMain.handle('memory:update', async (_event, input = {}) => {
    const entry = store.updateMemory(input.id, input.patch || {});
    broadcast({ type: 'memory:updated' });
    return { entry };
  });

  require('electron').ipcMain.handle('memory:delete', async (_event, id) => {
    const ok = store.deleteMemory(id);
    broadcast({ type: 'memory:updated' });
    return { ok };
  });

  require('electron').ipcMain.handle('memory:search', async (_event, query) => {
    return { entries: store.searchMemory(String(query || ''), 20) };
  });

  /* ------------------------------------------------------------------- learn */

  require('electron').ipcMain.handle('learn:state', async () => {
    const config = configModule.loadConfig();
    return learn.getLearnState({ config, workspace: config.workspace });
  });

  require('electron').ipcMain.handle('learn:reflect', async () => {
    const config = configModule.loadConfig();
    if (state.reflectionInFlight) throw new Error('A reflection is already running.');
    state.reflectionInFlight = true;
    try {
      const result = await learn.reflectNow({ config, workspace: config.workspace });
      if (!result.ok) throw new Error(result.error);
      broadcast({ type: 'learn:updated', added: result.added?.length || 0, message: result.message });
      return result;
    } finally {
      state.reflectionInFlight = false;
    }
  });

  require('electron').ipcMain.handle('learn:apply', async (_event, id) => {
    const config = configModule.loadConfig();
    const result = await learn.applyInsight({ id, config, workspace: config.workspace });
    if (!result.ok) throw new Error(result.error);
    broadcast({ type: 'learn:updated' });
    broadcast({ type: 'memory:updated' });
    broadcast({ type: 'skills:updated' });
    return { state: learn.getLearnState({ config: configModule.loadConfig(), workspace: config.workspace }) };
  });

  require('electron').ipcMain.handle('learn:dismiss', async (_event, id) => {
    const ok = learn.dismissInsight(id);
    broadcast({ type: 'learn:updated' });
    return { ok };
  });

  /* ------------------------------------------------------------- checkpoints */

  require('electron').ipcMain.handle('checkpoints:revert', async (_event, id) => {
    const result = store.revertCheckpoint(id);
    if (!result.ok) throw new Error(result.error || 'Could not revert.');
    broadcast({ type: 'workspace:changed' });
    return result;
  });

  /* ---------------------------------------------------------------------- cli */

  const cliMarker = 'rem blank launcher';
  const cliTargets = () => {
    const name = isWin ? 'blank.cmd' : 'blank';
    const list = [path.join(appPaths().root, 'bin', name)];
    if (isWin && process.env.LOCALAPPDATA) {
      list.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', name));
    } else if (!isWin) {
      list.push(path.join(app.getPath('home'), '.local', 'bin', name));
    }
    return list;
  };

  const cliStatus = () => {
    const targets = cliTargets();
    const installed = targets.find((file) => {
      try { return fs.readFileSync(file, 'utf8').includes(cliMarker); } catch { return false; }
    });
    const onPath = targets.length > 1 && installed === targets[1];
    return {
      installed: Boolean(installed),
      path: installed || targets[0],
      onPath,
      instructions: installed
        ? onPath
          ? 'Open a new terminal and run “blank”.'
          : `Add ${path.dirname(installed)} to PATH, then run “blank”.`
        : 'Install a launcher for VS Code and other terminals.',
    };
  };

  require('electron').ipcMain.handle('cli:status', async () => cliStatus());

  require('electron').ipcMain.handle('cli:install', async () => {
    const script = path.join(APP_ROOT, 'bin', 'blank.js');
    const runtime = process.execPath;
    const content = isWin
      ? `@echo off\r\n${cliMarker}\r\nsetlocal\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"${runtime}" "${script}" %*\r\n`
      : `#!/bin/sh\n# ${cliMarker}\nELECTRON_RUN_AS_NODE=1 "${runtime}" "${script}" "$@"\n`;
    const written = [];
    for (const file of cliTargets()) {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        if (fs.existsSync(file)) {
          const current = fs.readFileSync(file, 'utf8');
          if (!current.includes(cliMarker)) continue;
        }
        fs.writeFileSync(file, content, { encoding: 'utf8', mode: 0o755 });
        written.push(file);
      } catch {}
    }
    if (!written.length) throw new Error('Could not write a launcher. Check folder permissions.');
    const status = cliStatus();
    return {
      ...status,
      written,
      instructions: status.onPath
        ? 'Open a new terminal and run “blank” — no Node.js install needed.'
        : `Launcher written to ${written[0]}. Add ${path.dirname(written[0])} to PATH, then run “blank”.`,
    };
  });

  require('electron').ipcMain.handle('cli:remove', async () => {
    for (const file of cliTargets()) {
      try {
        if (fs.readFileSync(file, 'utf8').includes(cliMarker)) fs.unlinkSync(file);
      } catch {}
    }
    return cliStatus();
  });

  /* -------------------------------------------------------------------- media */

  const MEDIA_KEY_IDS = new Set(['openai', 'google', 'stability', 'elevenlabs', 'replicate', 'fal', 'higgsfield', 'openaiCompatible']);
  const MEDIA_KEY_LABELS = {
    openai: 'OpenAI', google: 'Google AI', stability: 'Stability AI',
    elevenlabs: 'ElevenLabs', replicate: 'Replicate', fal: 'fal.ai', higgsfield: 'Higgsfield',
    openaiCompatible: 'OpenAI compatible',
  };

  function compatMediaConfig(config) {
    const endpoints = config.media?.endpoints || {};
    const savedEndpoint = String(endpoints.openaiCompatible || '').trim();
    const endpoint = getMedia().compatEndpoint(config);
    return {
      endpoint,
      savedEndpoint,
      autoDetected: !savedEndpoint && Boolean(endpoint),
      models: {
        image: [...(config.media?.openaiModels?.image || [])],
        video: [...(config.media?.openaiModels?.video || [])],
      },
    };
  }

  async function autoFillCompatModels(config) {
    const current = config.media?.openaiModels || {};
    if ((current.image || []).length || (current.video || []).length) return null;
    const endpoint = getMedia().compatEndpoint(config);
    if (!endpoint) return null;
    const key = getMedia().resolveCloudKey(config, 'openai-compatible');
    if (!key) return null;
    try {
      const ids = await getMedia().discoverCompatModels({ baseUrl: endpoint, apiKey: key });
      const classified = getMedia().classifyCompatModels(ids);
      if (!classified.image.length && !classified.video.length) return null;
      configModule.patchConfig({ media: { openaiModels: classified } });
      return classified;
    } catch {
      return null;
    }
  }

  ipcMainHandle('media:list', async (_event, options = {}) => getMedia().listAssets(options));
  ipcMainHandle('media:get', async (_event, id) => getMedia().getAsset(String(id || '')));
  ipcMainHandle('media:jobs', async () => getMedia().listJobs());
  ipcMainHandle('media:job', async (_event, id) => getMedia().getJob(String(id || '')));
  ipcMainHandle('media:storage', async () => getMedia().storageInfo());
  ipcMainHandle('media:engines', async () => {
    const config = configModule.loadConfig();
    return {
      ...getMedia().engineAvailability(),
      defaults: config.media?.defaults || getMedia().MEDIA_DEFAULTS,
      endpoints: config.media?.endpoints || { comfyui: '', openaiCompatible: '' },
      compat: compatMediaConfig(config),
      storage: getMedia().storageInfo(),
    };
  });
  ipcMainHandle('media:voices', async () => getMedia().listVoices());
  ipcMainHandle('media:setEndpoint', async (_event, input = {}) => {
    const id = String(input.id || '');
    if (id !== 'comfyui' && id !== 'openaiCompatible') throw new Error('Unknown media endpoint');
    const raw = String(input.endpoint || '').trim().slice(0, 300);
    if (raw) {
      let parsed;
      try { parsed = new URL(raw); } catch { throw new Error(id === 'comfyui' ? 'Enter a valid ComfyUI URL.' : 'Enter a valid OpenAI-compatible base URL.'); }
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Endpoint must start with http:// or https://.');
    }
    const config = configModule.loadConfig();
    const endpoints = { ...(config.media?.endpoints || {}), [id]: raw };
    configModule.patchConfig({ media: { endpoints } });
    if (id === 'openaiCompatible' && raw) {
      const next = configModule.loadConfig();
      await autoFillCompatModels(next);
    }
    broadcast({ type: 'config:updated' });
    const next = configModule.loadConfig();
    return {
      endpoints: next.media?.endpoints || endpoints,
      compat: compatMediaConfig(next),
      engines: getMedia().engineAvailability(),
    };
  });
  ipcMainHandle('media:setModels', async (_event, input = {}) => {
    const clean = {};
    for (const kind of ['image', 'video']) {
      const raw = Array.isArray(input[kind]) ? input[kind] : String(input[kind] || '').split(/[\n,]+/);
      const models = [...new Set(raw.map((model) => String(model || '').trim()).filter(Boolean))].slice(0, 60);
      clean[kind] = models.map((model) => model.slice(0, 160));
    }
    configModule.patchConfig({ media: { openaiModels: clean } });
    broadcast({ type: 'config:updated' });
    const config = configModule.loadConfig();
    return { models: clean, engines: getMedia().engineAvailability() };
  });
  ipcMainHandle('media:discoverModels', async (_event, input = {}) => {
    const config = configModule.loadConfig();
    const endpoint = String(input.endpoint || '').trim() || getMedia().compatEndpoint(config);
    const key = getMedia().resolveCloudKey(config, 'openai-compatible');
    if (!key) throw new Error('Add the OpenAI-compatible API key first.');
    const ids = await getMedia().discoverCompatModels({ baseUrl: endpoint, apiKey: key });
    const classified = getMedia().classifyCompatModels(ids);
    return { endpoint, total: ids.length, all: ids, ...classified };
  });
  ipcMainHandle('media:testEndpoint', async (_event, input = {}) => getMedia().testEndpoint(String(input.endpoint || '')));

  ipcMainHandle('media:generate', async (_event, input = {}) => getMedia().generate(input));
  ipcMainHandle('media:edit', async (_event, input = {}) => getMedia().edit(input));
  ipcMainHandle('media:cancel', async (_event, id) => getMedia().cancelJob(String(id || '')));
  ipcMainHandle('media:remove', async (_event, id) => getMedia().removeAsset(String(id || '')));
  ipcMainHandle('media:favorite', async (_event, id) => getMedia().toggleFavorite(String(id || '')));
  ipcMainHandle('media:readText', async (_event, id) => getMedia().readText(String(id || '')));

  ipcMainHandle('media:importData', async (_event, input = {}) => getMedia().importData(input));

  ipcMainHandle('media:import', async (event) => {
    const win = winFromEvent(event);
    const picked = await dialog.showOpenDialog(win, {
      title: 'Import media into blank',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Media', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'svg', 'mp4', 'webm', 'mov', 'm4v', 'mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'obj', 'stl', 'glb', 'gltf', 'mtl'] },
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'svg'] },
        { name: 'Video', extensions: ['mp4', 'webm', 'mov', 'm4v'] },
        { name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'] },
        { name: '3D', extensions: ['obj', 'stl', 'glb', 'gltf'] },
      ],
    });
    if (picked.canceled || !picked.filePaths.length) return { canceled: true, items: [] };
    const items = [];
    const errors = [];
    for (const file of picked.filePaths.slice(0, 20)) {
      try {
        items.push(await getMedia().importFile(file));
      } catch (err) {
        errors.push(`${path.basename(file)}: ${err.message}`);
      }
    }
    return { canceled: false, items, errors };
  });

  ipcMainHandle('media:export', async (event, id) => {
    const asset = getMedia().getAsset(String(id || ''));
    if (!asset) throw new Error('Media asset not found');
    const win = winFromEvent(event);
    const ext = path.extname(asset.fileName) || '.bin';
    const safeTitle = String(asset.title || 'blank-media').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);
    const result = await dialog.showSaveDialog(win, {
      title: 'Export media',
      defaultPath: path.join(app.getPath('downloads'), `${safeTitle}${ext}`),
      filters: [{ name: ext.replace('.', '').toUpperCase() || 'Media', extensions: [ext.replace('.', '')] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    return { canceled: false, ...(await getMedia().copyTo(asset.id, result.filePath)) };
  });

  ipcMainHandle('media:saveToWorkspace', async (_event, input = {}) => {
    const config = configModule.loadConfig();
    if (!config.workspace) throw new Error('Open a workspace first');
    const folder = String(input.folder || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').slice(0, 160);
    if (folder.split('/').some((part) => part === '..')) throw new Error('Folder must stay inside the workspace');
    const saved = await getMedia().saveToWorkspace(String(input.id || ''), config.workspace, folder);
    return { ...saved, folder, workspace: config.workspace };
  });

  ipcMainHandle('media:reveal', async (_event, id) => {
    const file = getMedia().assetFilePath(String(id || ''));
    if (!file || !fs.existsSync(file)) throw new Error('Asset file is missing');
    shell.showItemInFolder(file);
    return true;
  });

  ipcMainHandle('media:open', async (_event, id) => {
    const file = getMedia().assetFilePath(String(id || ''));
    if (!file || !fs.existsSync(file)) throw new Error('Asset file is missing');
    const error = await shell.openPath(file);
    if (error) throw new Error(error);
    return true;
  });

  ipcMainHandle('media:setKey', async (_event, input = {}) => {
    const id = String(input.id || '');
    if (!MEDIA_KEY_IDS.has(id)) throw new Error('Unknown media provider key');
    const key = String(input.key || '').trim().slice(0, 400);
    const config = configModule.loadConfig();
    config.media = config.media || {};
    config.media.keys = { ...(config.media.keys || {}) };
    if (key) config.media.keys[id] = key;
    else delete config.media.keys[id];
    configModule.saveConfig(config);
    if (id === 'openaiCompatible' && key) {
      await autoFillCompatModels(configModule.loadConfig());
    }
    broadcast({ type: 'config:updated' });
    const next = configModule.loadConfig();
    return {
      id,
      hasKey: Boolean(key),
      label: MEDIA_KEY_LABELS[id] || id,
      compat: compatMediaConfig(next),
      engines: getMedia().engineAvailability(),
    };
  });

  ipcMainHandle('media:setDefaults', async (_event, input = {}) => {
    const allowed = ['image', 'video', 'audio', 'model3d'];
    const clean = {};
    for (const kind of allowed) {
      const raw = input && input[kind];
      if (!raw || typeof raw !== 'object') continue;
      const entry = {};
      if (raw.engine) entry.engine = String(raw.engine).slice(0, 60);
      if (raw.model) entry.model = String(raw.model).slice(0, 120);
      if (raw.aspect) entry.aspect = String(raw.aspect).slice(0, 12);
      if (raw.voice) entry.voice = String(raw.voice).slice(0, 120);
      if (raw.rate !== undefined) entry.rate = Math.min(10, Math.max(-10, Number(raw.rate) || 0));
      if (Number(raw.duration) > 0) entry.duration = Math.min(600, Math.max(1, Number(raw.duration)));
      if (Object.keys(entry).length) clean[kind] = entry;
    }
    if (!Object.keys(clean).length) return { defaults: configModule.loadConfig().media?.defaults || {} };
    const config = configModule.patchConfig({ media: { defaults: clean } });
    broadcast({ type: 'config:updated' });
    return { defaults: config.media?.defaults || {} };
  });

  /* -------------------------------------------------------------------- paper */

  ipcMainHandle('papers:list', async (_event, options = {}) => paperStore.listPapers(options));
  ipcMainHandle('papers:count', async () => paperStore.paperCount());
  ipcMainHandle('papers:get', async (_event, id) => paperStore.getPaperContent(String(id || '')));
  ipcMainHandle('papers:versions', async (_event, id) => paperStore.listVersions(String(id || '')));
  ipcMainHandle('papers:version', async (_event, input = {}) => (
    paperStore.getVersionContent(String(input.id || ''), Number(input.version))
  ));

  ipcMainHandle('papers:create', async (_event, input = {}) => {
    const paper = paperStore.createPaper({
      title: input.title,
      kind: input.kind,
      content: input.content,
      language: input.language,
      description: input.description,
      source: 'user',
      sessionId: input.sessionId || '',
    });
    broadcast({ type: 'paper:changed', action: 'created', paper });
    return paper;
  });

  ipcMainHandle('papers:update', async (_event, input = {}) => {
    const paper = paperStore.updatePaper(String(input.id || ''), {
      title: input.title,
      content: input.content,
      description: input.description,
      language: input.language,
    });
    broadcast({ type: 'paper:changed', action: 'updated', paper });
    return paper;
  });

  ipcMainHandle('papers:restore', async (_event, input = {}) => {
    const paper = paperStore.restoreVersion(String(input.id || ''), Number(input.version));
    broadcast({ type: 'paper:changed', action: 'restored', paper });
    return paper;
  });

  ipcMainHandle('papers:favorite', async (_event, id) => {
    const paper = paperStore.toggleFavorite(String(id || ''));
    broadcast({ type: 'paper:changed', action: 'favorited', paper });
    return paper;
  });

  ipcMainHandle('papers:remove', async (_event, id) => {
    const result = paperStore.removePaper(String(id || ''));
    if (result.removed) broadcast({ type: 'paper:removed', id: String(id || '') });
    return result;
  });

  ipcMainHandle('papers:export', async (event, id) => {
    const result = paperStore.getPaperContent(String(id || ''));
    const win = winFromEvent(event);
    const dialogResult = await dialog.showSaveDialog(win, {
      title: 'Export paper',
      defaultPath: path.join(app.getPath('downloads'), paperStore.exportFileName(result.paper)),
    });
    if (dialogResult.canceled || !dialogResult.filePath) return { canceled: true };
    fs.writeFileSync(dialogResult.filePath, result.content, 'utf8');
    return { canceled: false, path: dialogResult.filePath };
  });

  ipcMainHandle('papers:reveal', async (_event, id) => {
    const meta = paperStore.readMeta(String(id || ''));
    if (!meta) throw new Error('Paper not found');
    const file = paperStore.contentPath(meta);
    if (!fs.existsSync(file)) throw new Error('Paper content is missing');
    shell.showItemInFolder(file);
    return true;
  });

  /* ------------------------------------------------------------------- window */

  require('electron').ipcMain.handle('window:minimize', async (event) => {
    winFromEvent(event)?.minimize();
  });
  require('electron').ipcMain.handle('window:maximize', async (event) => {
    const win = winFromEvent(event);
    if (!win) return false;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return win.isMaximized();
  });
  require('electron').ipcMain.handle('window:close', async (event) => {
    winFromEvent(event)?.close();
  });
  require('electron').ipcMain.handle('window:state', async (event) => {
    const win = winFromEvent(event);
    return { maximized: Boolean(win?.isMaximized()), fullscreen: Boolean(win?.isFullScreen()) };
  });

  function auditAutomation(config, type, data) {
    if (config?.audit?.enabled === false) return;
    try { auditModule.record(type, data); } catch {}
  }

  function publicSchedule(schedule) {
    const retry = state.scheduleRetries.get(schedule.id);
    return {
      ...schedule,
      trigger: triggers.redactTrigger(schedule.trigger, schedule.id),
      running: state.scheduleRuns.has(schedule.id),
      queued: state.scheduleQueue.countFor(schedule.id),
      queuedTotal: state.scheduleQueue.size(),
      retry: retry ? { attempt: retry.attempt, at: retry.at } : null,
    };
  }

  function clearRetry(id) {
    const retry = state.scheduleRetries.get(id);
    if (!retry) return false;
    clearTimeout(retry.timer);
    state.scheduleRetries.delete(id);
    return true;
  }

  function scheduleRetry(schedule, event, chain, triggerSummary) {
    const attempt = (Number(event.retryAttempt) || 0) + 1;
    if (attempt > 3 || schedule.enabled === false) return;
    const delay = retryDelayMs(attempt - 1);
    const at = new Date(Date.now() + delay).toISOString();
    const timer = setTimeout(() => {
      state.scheduleRetries.delete(schedule.id);
      const fresh = schedulesModule.getSchedule(schedule.id);
      if (!fresh || fresh.enabled === false || state.disposed) return;
      runAutomation(fresh, { event: { ...event, retryAttempt: attempt }, chain, fromQueue: false });
    }, delay);
    timer.unref?.();
    state.scheduleRetries.set(schedule.id, { timer, attempt, at, event });
    const minutes = Math.max(1, Math.round(delay / 60000));
    broadcast({
      type: 'notice',
      level: 'warn',
      text: `Automation “${schedule.title}” failed; retrying in ${minutes} min (attempt ${attempt} of 3).`,
    });
    broadcast({ type: 'schedules:refresh' });
  }

  function drainQueue() {
    if (state.disposed) return;
    while (state.scheduleQueue.size()) {
      const active = [...state.scheduleRuns.values()].filter((entry) => entry.triggerStarted).length;
      if (active >= 2) break;
      const next = state.scheduleQueue.shift();
      const record = schedulesModule.getSchedule(next.recordId);
      if (!record || record.enabled === false) continue;
      try {
        runAutomation(record, { event: next.event, chain: next.chain, fromQueue: true });
      } catch (err) {
        schedulesModule.markRun(record.id, { status: 'error', error: err.message });
      }
    }
    broadcast({ type: 'schedules:refresh' });
  }

  function runAutomation(schedule, { event = null, chain = [], fromQueue = false } = {}) {
    if (!schedule) return { started: false, reason: 'invalid' };
    if (state.scheduleRuns.has(schedule.id)) {
      if (fromQueue) return { started: false, reason: 'running' };
      return { started: false, reason: 'running' };
    }
    if (!event) event = { type: 'manual', at: new Date().toISOString() };
    const triggerStarted = event.type !== 'manual';
    if (triggerStarted) {
      const active = [...state.scheduleRuns.values()].filter((entry) => entry.triggerStarted).length;
      if (active >= 2) {
        const queued = state.scheduleQueue.push({ recordId: schedule.id, event, chain });
        if (!queued.ok) {
          auditAutomation(configModule.loadConfig(), 'automation.queue_full', { scheduleId: schedule.id, reason: queued.reason });
          broadcast({ type: 'notice', level: 'warn', text: `Automation “${schedule.title}” was skipped: the queue is full.` });
          broadcast({ type: 'schedules:refresh' });
          return { started: false, reason: 'queue_full' };
        }
        auditAutomation(configModule.loadConfig(), 'automation.queued', { scheduleId: schedule.id, ahead: queued.ahead });
        broadcast({ type: 'schedules:refresh' });
        return { started: false, reason: 'queued', ahead: queued.ahead };
      }
    }
    if (!fromQueue) clearRetry(schedule.id);
    const config = configModule.loadConfig();
    const model = schedule.model && catalog.findModel(schedule.model, config) ? schedule.model : config.defaultModel;
    const workspace = schedule.workspace && fs.existsSync(schedule.workspace) ? schedule.workspace : config.workspace;
    const session = store.createSession({
      workspace,
      model,
      mode: schedule.mode,
      reasoningEffort: schedule.reasoningEffort,
    });
    const scheduleModel = catalog.findModel(model, config);
    try { computer.setActor(scheduleModel?.id || scheduleModel?.name || ''); } catch {}
    session.title = schedule.title;
    session.titleSource = 'manual';
    const content = triggers.formatEventPrompt(schedule.trigger, event, schedule.prompt);
    const message = { id: uid('msg_'), role: 'user', content, at: new Date().toISOString(), source: 'schedule' };
    session.messages.push(message);
    store.saveSession(session);
    schedulesModule.markRun(schedule.id, { status: 'running', sessionId: session.id });
    notifySession(session);
    broadcast({ type: 'sessions:refresh' });

    const controller = new AbortController();
    state.scheduleRuns.set(schedule.id, { controller, sessionId: session.id, triggerStarted });
    triggerEngine?.noteAutomationSession(session.id, { recordId: schedule.id, chain });

    const triggerSummary = { type: event.type, summary: triggers.summarizeEvent(schedule.trigger, event) };
    const emit = (payload) => {
      const enriched = { ...payload, sessionId: session.id, runId: `schedule_${schedule.id}` };
      broadcast(enriched);
      try { remote.publish(enriched); } catch {}
    };
    broadcast({ type: 'schedule:started', scheduleId: schedule.id, sessionId: session.id, title: schedule.title });
    if (fromQueue) triggerEngine?.markQueuedRunStarted?.(schedule.id);
    const startedAt = Date.now();
    auditAutomation(config, 'automation.start', {
      scheduleId: schedule.id,
      sessionId: session.id,
      trigger: triggerSummary,
      queued: Boolean(fromQueue),
      retry: Number(event.retryAttempt) || 0,
    });

    runAgent({
      session,
      config,
      emit,
      signal: controller.signal,
      requestApproval: (request) => {
        if (schedule.allowTools) return Promise.resolve('always');
        broadcast({
          type: 'notice',
          level: 'warn',
          text: `Automation “${schedule.title}” was denied ${request.label || request.tool}. Enable tool use or run it from a chat.`,
        });
        return Promise.resolve('deny');
      },
      mcp,
    }).then((outcome) => {
      const fresh = store.getSession(session.id) || session;
      const status = outcome.ok ? 'ok' : outcome.stopped ? 'stopped' : 'error';
      schedulesModule.markRun(schedule.id, {
        status,
        sessionId: session.id,
        trigger: triggerSummary,
      });
      auditAutomation(config, 'automation.end', {
        scheduleId: schedule.id,
        sessionId: session.id,
        status,
        steps: outcome.steps || 0,
        durationMs: Date.now() - startedAt,
        error: outcome.error || '',
      });
      emit({ type: 'run:done', outcome, usage: fresh.usage, contextTokens: fresh.contextTokens, title: fresh.title, tasks: fresh.tasks || [], files: fresh.files || [] });
      broadcast({ type: 'notice', level: outcome.ok ? 'info' : 'warn', text: `Automation “${schedule.title}” ${outcome.ok ? 'finished' : outcome.stopped ? 'stopped' : 'ended with an error'}.` });
      notifications.scheduleFinished({
        title: `${outcome.ok ? 'Automation finished' : 'Automation stopped'} · ${schedule.title}`,
        body: runNotificationBody(fresh, outcome),
        sessionId: fresh.id,
        failed: !outcome.ok,
      });
      notifySession(fresh);
      triggerEngine?.notifySession({ sessionId: fresh.id, session: fresh, outcome });
      maybeReflect(getWindow(), fresh);
      if (status === 'error' && triggerStarted) scheduleRetry(schedule, event, chain, triggerSummary);
    }).catch((err) => {
      schedulesModule.markRun(schedule.id, { status: 'error', error: err.message, sessionId: session.id, trigger: triggerSummary });
      auditAutomation(config, 'automation.end', {
        scheduleId: schedule.id,
        sessionId: session.id,
        status: 'error',
        durationMs: Date.now() - startedAt,
        error: err.message,
      });
      emit({ type: 'run:done', outcome: { ok: false, error: err.message } });
      broadcast({ type: 'notice', level: 'warn', text: `Automation “${schedule.title}” failed: ${err.message}` });
      notifications.scheduleFinished({
        title: `Automation failed · ${schedule.title}`,
        body: err.message,
        sessionId: session.id,
        failed: true,
      });
      if (triggerStarted) scheduleRetry(schedule, event, chain, triggerSummary);
    }).finally(() => {
      state.scheduleRuns.delete(schedule.id);
      drainQueue();
      broadcast({ type: 'schedules:refresh' });
      broadcast({ type: 'sessions:refresh' });
    });
    return { started: true, sessionId: session.id };
  }

  function scheduleTick() {
    if (state.disposed) return;
    for (const schedule of schedulesModule.dueSchedules()) {
      const event = { type: 'schedule', at: new Date().toISOString() };
      try {
        const result = runAutomation(schedule, { event, chain: [] });
        if (result.reason === 'queue_full') break;
      } catch (err) {
        schedulesModule.markRun(schedule.id, { status: 'error', error: err.message });
      }
    }
  }

  triggerEngine = createTriggerEngine({
    getSchedules: () => schedulesModule.listSchedules(),
    getConfig: () => configModule.loadConfig(),
    mcp,
    dispatch: async (record, event, meta) => runAutomation(record, { event, chain: meta.chain }),
    notify: (payload) => broadcast(payload),
  });
  triggerEngine.start().catch((err) => {
    broadcast({ type: 'notice', level: 'warn', text: `Automation triggers could not start: ${err.message}` });
  });

  ipcMainHandle('schedules:list', async () => ({
    schedules: schedulesModule.listSchedules().map(publicSchedule),
    running: [...state.scheduleRuns.keys()],
    queued: state.scheduleQueue.size(),
  }));

  ipcMainHandle('schedules:save', async (event, input = {}) => {
    const candidate = schedulesModule.buildSchedule(input);
    const config = configModule.loadConfig();
    let statuses = [];
    try { statuses = mcp.statuses(config); } catch {}
    const servers = Array.isArray(statuses) ? statuses.filter((entry) => entry.connected !== false).map((entry) => entry.id) : [];
    const tools = Array.isArray(statuses)
      ? [...new Set(statuses.flatMap((entry) => Array.isArray(entry.tools) ? entry.tools : []))]
      : [];
    triggers.validateTriggerResources(candidate.trigger, { mcpServerIds: servers, mcpToolNames: tools });
    const schedule = schedulesModule.saveSchedule(input);
    void triggerEngine?.reconcile().catch(() => {});
    broadcast({ type: 'schedules:refresh' });
    return { schedule: publicSchedule(schedule) };
  });

  ipcMainHandle('schedules:delete', async (event, input = {}) => {
    const run = state.scheduleRuns.get(input.id);
    if (run) {
      try { run.controller.abort(); } catch {}
      state.scheduleRuns.delete(input.id);
    }
    clearRetry(input.id);
    state.scheduleQueue.clearRecord(input.id);
    const deleted = schedulesModule.deleteSchedule(input.id);
    void triggerEngine?.reconcile().catch(() => {});
    broadcast({ type: 'schedules:refresh' });
    return { deleted };
  });

  ipcMainHandle('schedules:run', async (event, input = {}) => {
    const schedule = schedulesModule.getSchedule(input.id);
    if (!schedule) throw new Error('That automation no longer exists.');
    return runAutomation(schedule);
  });

  ipcMainHandle('schedules:runtime', async () => (
    triggerEngine?.status() || { webhook: {}, automations: {} }
  ));

  ipcMainHandle('audit:info', async () => {
    const config = configModule.loadConfig();
    const info = auditModule.info();
    return {
      ...info,
      enabled: config.audit?.enabled !== false,
      retentionDays: Math.max(1, Math.min(365, Number(config.audit?.retentionDays) || 30)),
    };
  });

  ipcMainHandle('audit:export', async (event) => {
    const win = winFromEvent(event) || getWindow();
    const day = new Date().toISOString().slice(0, 10);
    const result = await dialog.showSaveDialog(win, {
      title: 'Export audit log',
      defaultPath: path.join(app.getPath('documents'), `blank-audit-${day}.jsonl`),
      filters: [{ name: 'Audit log', extensions: ['jsonl'] }],
    });
    if (result.canceled || !result.filePath) return { saved: false };
    fs.copyFileSync(auditModule.file(), result.filePath);
    return { saved: true, path: result.filePath };
  });

  ipcMainHandle('worktree:list', async () => {
    const config = configModule.loadConfig();
    const worktrees = await worktreeModule.scan();
    let repo = { isRepo: false, root: '', branch: '' };
    if (config.workspace) {
      try {
        const info = await worktreeModule.context(config.workspace);
        repo = { isRepo: info.isRepo, root: info.root, branch: info.branch };
      } catch {}
    }
    return { worktrees, repo, root: worktreeModule.worktreeRoot() };
  });

  ipcMainHandle('worktree:prune', async () => {
    const config = configModule.loadConfig();
    if (!config.workspace) return { removed: 0, kept: 0 };
    const result = await worktreeModule.pruneEmpty(config.workspace);
    broadcast({ type: 'notice', level: 'info', text: `Removed ${result.removed} empty worktree${result.removed === 1 ? '' : 's'}; kept ${result.kept} with changes.` });
    return result;
  });

  try {
    const auditConfig = configModule.loadConfig().audit || {};
    if (auditConfig.enabled !== false) {
      auditModule.record('app.start', { version: app.getVersion(), platform: process.platform });
    }
    auditModule.createAudit({
      retentionDays: Math.max(1, Math.min(365, Number(auditConfig.retentionDays) || 30)),
    }).prune();
  } catch {}

  ipcMainHandle('schedules:webhook-copy', async (event, input = {}) => {
    const schedule = schedulesModule.getSchedule(input.id);
    if (!schedule || schedule.trigger?.type !== 'webhook') throw new Error('That automation is not a webhook.');
    const webhook = triggerEngine?.status()?.webhook || {};
    if (!webhook.running) throw new Error('The webhook server is not running.');
    const token = String(schedule.trigger.config?.token || '');
    if (!token) throw new Error('This webhook has no token. Rotate it first.');
    clipboard.writeText([
      `POST http://127.0.0.1:${webhook.port}/hooks/${schedule.id}`,
      `Authorization: Bearer ${token}`,
      'Content-Type: application/json',
    ].join('\n'));
    return { copied: true };
  });

  ipcMainHandle('schedules:webhook-rotate', async (event, input = {}) => {
    const schedule = schedulesModule.rotateWebhookToken(input.id);
    if (!schedule) throw new Error('That webhook no longer exists.');
    void triggerEngine?.reconcile().catch(() => {});
    broadcast({ type: 'schedules:refresh' });
    return { schedule: publicSchedule(schedule) };
  });

  ipcMainHandle('schedules:trigger-test', async (event, input = {}) => {
    const existing = input.id ? schedulesModule.getSchedule(input.id) : null;
    const draft = input.trigger || existing?.trigger;
    if (!draft) throw new Error('Nothing to test yet.');
    if (draft.type === 'mcp') {
      return triggerEngine?.testTrigger(draft) || { ok: false, error: 'Triggers are not ready.' };
    }
    const trigger = triggers.normalizeTrigger(draft, existing, new Date());
    const config = configModule.loadConfig();
    let statuses = [];
    try { statuses = mcp.statuses(config); } catch {}
    const servers = Array.isArray(statuses) ? statuses.filter((entry) => entry.connected !== false).map((entry) => entry.id) : [];
    const tools = Array.isArray(statuses)
      ? [...new Set(statuses.flatMap((entry) => Array.isArray(entry.tools) ? entry.tools : []))]
      : [];
    triggers.validateTriggerResources(trigger, { mcpServerIds: servers, mcpToolNames: tools });
    return { ok: true };
  });

  ipcMainHandle('schedules:pick-path', async (event, input = {}) => {
    const win = winFromEvent(event);
    const directory = input.kind === 'directory';
    const result = await dialog.showOpenDialog(win, {
      properties: [directory ? 'openDirectory' : 'openFile'],
    });
    return { path: result.canceled ? '' : String(result.filePaths?.[0] || '') };
  });

  ipcMainHandle('notifications:status', async () => ({
    supported: notifications.supported(),
    preferences: notifications.preferences(),
  }));

  ipcMainHandle('notifications:test', async () => {
    const shown = notifications.notifyTest();
    return {
      shown,
      supported: notifications.supported(),
      reason: shown ? '' : notifications.supported() ? 'Desktop notifications are disabled in Settings.' : 'This system does not support desktop notifications.',
    };
  });

  state.scheduleTimer = setInterval(scheduleTick, 30000);
  if (state.scheduleTimer.unref) state.scheduleTimer.unref();
  setTimeout(scheduleTick, 12000).unref?.();

  const savedRemote = configModule.loadConfig().remote || {};
  if (savedRemote.autoStart) {
    setTimeout(() => {
      remote.start({
        port: savedRemote.port,
        allowLan: savedRemote.allowLan,
        allowApprovals: savedRemote.allowApprovals,
        handlers: remoteHandlers(),
      }).then(() => {
        broadcast({ type: 'notice', level: 'info', text: `Remote control is listening on port ${remote.status().port}.` });
        broadcast({ type: 'remote:status', status: remoteStatus() });
      }).catch((err) => {
        broadcast({ type: 'notice', level: 'warn', text: `Remote control could not start: ${err.message}` });
      });
    }, 900);
  }

  function dispose() {
    state.disposed = true;
    try { updater.dispose(); } catch {}
    try { messengers.dispose(); } catch {}
    try { void triggerEngine?.stop().catch(() => {}); } catch {}
    stopTerminal();
    if (state.scheduleTimer) clearInterval(state.scheduleTimer);
    for (const run of state.scheduleRuns.values()) {
      try { run.controller.abort(); } catch {}
    }
    state.scheduleRuns.clear();
    for (const retry of state.scheduleRetries.values()) clearTimeout(retry.timer);
    state.scheduleRetries.clear();
    state.scheduleQueue.clear();
    try { oauthModule.closeAll(); } catch {}
    for (const run of state.runs.values()) run.controller.abort();
    denyApprovalsFor(() => true);
    state.runs.clear();
    state.sessionRuns.clear();
    state.queues.clear();
    stopAllPetFollow();
    try { remote.stop(); } catch {}
    try { pet.dispose(); } catch {}
    try { overlay.dispose(); } catch {}
    try { computer.onActivity(null); } catch {}
    for (const job of getMedia().listJobs()) {
      if (job.status === 'queued' || job.status === 'running') {
        try { getMedia().cancelJob(job.id); } catch {}
      }
    }
  }

  return { dispose, attachWindowEvents };
}

module.exports = { registerIpc, attachWindowEvents };
