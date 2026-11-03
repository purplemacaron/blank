'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { app, BrowserWindow, dialog, shell, nativeTheme, ipcMain } = require('electron');
const { appPaths, ensureHome, uid, slugify } = require('../src/core/paths');
const configModule = require('../src/core/config');
const catalog = require('../src/core/catalog');
const store = require('../src/core/store');
const providers = require('../src/core/providers');
const { runAgent, compactSession } = require('../src/core/agent');
const learn = require('../src/core/learn');
const { summarizeArgs } = require('../src/core/tools');
const mediaLibrary = require('../src/core/media');
const search = require('../src/core/search');
const computer = require('../src/core/computer');
const { createRemoteService } = require('../src/core/remote');
const { createComputerOverlay } = require('./computer-overlay');
const plugins = require('../src/core/plugins');

const APP_ROOT = path.join(__dirname, '..');
const isWin = process.platform === 'win32';
const ipcMainHandle = ipcMain.handle.bind(ipcMain);

function createState() {
  return {
    runs: new Map(),
    sessionRuns: new Map(),
    approvals: new Map(),
    queues: new Map(),
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
  ensureHome();

  const sendEvent = (win, payload) => {
    if (!win || win.isDestroyed()) return;
    win.webContents.send('blank:event', payload);
  };

  const broadcast = (payload) => {
    for (const win of BrowserWindow.getAllWindows()) sendEvent(win, payload);
  };

  mediaLibrary.configureMedia({
    getConfig: () => configModule.loadConfig(),
    emit: (event, payload) => broadcast({ type: event, ...payload }),
    patchConfig: (patch) => configModule.patchConfig(patch),
  });

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
    workspace: session.workspace,
  });

  const notifySession = (session) => broadcast({ type: 'session:updated', session: summaryOf(session) });

  const winFromEvent = (event) => BrowserWindow.fromWebContents(event.sender) || getWindow();

  /* ------------------------------------------------------- remote & overlay */

  const remote = createRemoteService();
  const overlay = createComputerOverlay({
    isEnabled: () => configModule.loadConfig().computer?.showCursor !== false,
  });
  computer.onActivity((activity) => overlay.flash(activity));

  function pendingApprovals() {
    return [...state.approvals.entries()].map(([approvalId, approval]) => ({
      approvalId,
      sessionId: approval.sessionId,
      runId: approval.runId,
      tool: approval.tool,
      label: approval.label,
      summary: approval.summary,
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

  function remoteStatus() {
    return { ...remote.status(), autoStart: Boolean(configModule.loadConfig().remote?.autoStart) };
  }

  function denyApprovalsFor(predicate) {
    for (const [id, approval] of state.approvals.entries()) {
      if (predicate(approval)) {
        clearTimeout(approval.timer);
        approval.resolve('deny');
        state.approvals.delete(id);
        sendEvent(approval.win, { type: 'approval:expired', approvalId: id, sessionId: approval.sessionId, runId: approval.runId });
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
      if (!session.model || session.model.startsWith('sandbox/')) return;
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
    name: 'Blank',
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

  require('electron').ipcMain.handle('config:update', async (_event, patch = {}) => {
    const allowed = ['defaultModel', 'fallbackModel', 'theme', 'onboarded', 'agent', 'ui', 'customInstructions', 'disabledSkills', 'media', 'permissions', 'search', 'computer'];
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
    if (clean.defaultModel) {
      if (!catalog.findModel(clean.defaultModel, configModule.loadConfig())) throw new Error('Unknown model.');
    }
    if (clean.fallbackModel && clean.fallbackModel !== '') {
      if (!catalog.findModel(clean.fallbackModel, configModule.loadConfig())) throw new Error('Unknown fallback model.');
    }
    if (clean.theme && !['light', 'dark', 'system'].includes(clean.theme)) delete clean.theme;
    if (clean.customInstructions) clean.customInstructions = String(clean.customInstructions).slice(0, 20000);
    if (clean.agent) {
      clean.agent = {
        ...clean.agent,
        maxSteps: Math.max(1, Math.min(64, Number(clean.agent.maxSteps) || 32)),
        compactAt: Math.max(0.5, Math.min(0.95, Number(clean.agent.compactAt) || 0.82)),
      };
    }
    if (clean.media) {
      // Never accept raw keys through the general config channel.
      clean.media = { defaults: clean.media.defaults || {} };
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
    broadcast({ type: 'config:updated' });
    return configWithRuntime(next);
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
      providers: catalog.allProviders(config).map(catalog.publicProvider),
      models: catalog.allModels(config),
      config: configModule.publicConfig(config, catalog),
    };
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
    return { config: configWithRuntime(config), providers: catalog.allProviders(config).map(catalog.publicProvider) };
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
      const models = await providers.listModels({ providerId: input.providerId, config });
      config.discoveredModels = config.discoveredModels || {};
      config.discoveredModels[input.providerId] = models.slice(0, 300).map((model) => ({
        id: String(model.id),
        name: String(model.name || model.id),
        context: Number(model.context) || 128000,
        tags: ['Detected'],
      }));
      configModule.saveConfig(config);
      broadcast({ type: 'config:updated' });
      return { ok: true, models: config.discoveredModels[input.providerId] };
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
    if (String(config.defaultModel).startsWith(`${providerId}/`)) config.defaultModel = 'sandbox/blank-1';
    configModule.saveConfig(config);
    broadcast({ type: 'config:updated' });
    return configWithRuntime(config);
  });

  /* ------------------------------------------------------- search & computer */

  require('electron').ipcMain.handle('search:test', async (_event, input = {}) => {
    const config = configModule.loadConfig();
    try {
      const payload = await search.searchWeb(input.query || 'Blank agent harness', {
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
  require('electron').ipcMain.handle('computer:testScreenshot', async () => {
    if (computerShotInFlight) throw new Error('A screenshot is already being captured.');
    computerShotInFlight = true;
    try {
      const shot = await computer.screenshot();
      await shell.openPath(shot.path);
      return { ok: true, ...shot };
    } finally {
      computerShotInFlight = false;
    }
  });

  /* ----------------------------------------------------------------- sessions */

  require('electron').ipcMain.handle('sessions:list', async () => {
    const config = configModule.loadConfig();
    return { sessions: store.listSessions(config.workspace), workspace: config.workspace };
  });

  require('electron').ipcMain.handle('sessions:get', async (_event, id) => {
    const session = store.getSession(id);
    if (!session) return { session: null };
    const queue = (state.queues.get(id) || []).map((item) => ({ queueId: item.id, text: item.text }));
    return { session, running: state.sessionRuns.has(id), queue };
  });

  require('electron').ipcMain.handle('sessions:create', async (_event, input = {}) => {
    const config = configModule.loadConfig();
    const model = input.model && catalog.findModel(input.model, config) ? input.model : config.defaultModel;
    const mode = ['agent', 'plan', 'ask'].includes(input.mode) ? input.mode : 'agent';
    const session = store.createSession({
      workspace: config.workspace,
      model,
      mode,
      title: String(input.title || 'New session').slice(0, 120),
    });
    notifySession(session);
    return { session };
  });

  require('electron').ipcMain.handle('sessions:update', async (_event, input = {}) => {
    const session = store.getSession(input.id);
    if (!session) throw new Error('Session not found.');
    if (input.title !== undefined) session.title = String(input.title).trim().slice(0, 120) || 'New session';
    if (input.pinned !== undefined) session.pinned = Boolean(input.pinned);
    if (input.model !== undefined) {
      const config = configModule.loadConfig();
      if (!catalog.findModel(input.model, config)) throw new Error('Unknown model.');
      session.model = input.model;
    }
    if (input.mode !== undefined && ['agent', 'plan', 'ask'].includes(input.mode)) session.mode = input.mode;
    store.saveSession(session);
    notifySession(session);
    return { session };
  });

  require('electron').ipcMain.handle('sessions:delete', async (_event, id) => {
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
    const config = configModule.loadConfig();
    const result = await compactSession({ session, config });
    if (result.ok) {
      broadcast({ type: 'session:updated', session: summaryOf(store.getSession(id)) });
      return { ...result, session: store.getSession(id) };
    }
    throw new Error(result.error);
  });

  /* --------------------------------------------------------------------- chat */

  function queueFor(sessionId) {
    if (!state.queues.has(sessionId)) state.queues.set(sessionId, []);
    return state.queues.get(sessionId);
  }

  function queueUpdateEvent(sessionId, win) {
    const queue = (state.queues.get(sessionId) || []).map((item) => ({ queueId: item.id, text: item.text, queuedAt: item.queuedAt }));
    const payload = { type: 'chat:queue:update', sessionId, queue };
    sendEvent(win, payload);
    const main = getWindow();
    if (main && main !== win) sendEvent(main, payload);
    return queue;
  }

  function launchRun({ session, config, win }) {
    const runId = uid('run_');
    const controller = new AbortController();
    state.runs.set(runId, { controller, win, sessionId: session.id });
    state.sessionRuns.set(session.id, runId);

    const emit = (payload) => {
      const enriched = { ...payload, sessionId: session.id, runId };
      sendEvent(win, enriched);
      const main = getWindow();
      if (main && main !== win) sendEvent(main, enriched);
      remote.publish(enriched);
    };

    const requestApproval = (request) => new Promise((resolve) => {
      const approvalId = request.approvalId;
      const timer = setTimeout(() => {
        state.approvals.delete(approvalId);
        const expired = { type: 'approval:expired', approvalId, sessionId: session.id, runId };
        sendEvent(win, expired);
        const main = getWindow();
        if (main && main !== win) sendEvent(main, expired);
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
      };
      sendEvent(win, payload);
      const main = getWindow();
      if (main && main !== win) sendEvent(main, payload);
      remote.publish({ ...payload, type: 'tool:start', summary: payload.summary });
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
      broadcast({ type: 'sessions:refresh' });
      maybeReflect(win, fresh);
    }).catch((err) => {
      emit({ type: 'run:done', outcome: { ok: false, error: err.message } });
    }).finally(() => {
      if (state.sessionRuns.get(session.id) === runId) state.sessionRuns.delete(session.id);
      state.runs.delete(runId);
      denyApprovalsFor((approval) => approval.runId === runId);
      setTimeout(() => {
        try { drainQueue(session.id); } catch {}
      }, 60);
    });

    return { runId };
  }

  function drainQueue(sessionId) {
    if (state.sessionRuns.has(sessionId)) return null;
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
    if (next.mode && ['agent', 'plan', 'ask'].includes(next.mode)) session.mode = next.mode;
    const message = {
      id: uid('msg_'),
      role: 'user',
      content: next.text,
      attachments: next.attachments || [],
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

  function stopSessionRun(sessionId) {
    const runId = state.sessionRuns.get(sessionId);
    const run = runId ? state.runs.get(runId) : null;
    const hadQueue = state.queues.delete(sessionId);
    if (run) {
      run.controller.abort();
      denyApprovalsFor((approval) => approval.sessionId === sessionId);
      queueUpdateEvent(sessionId, run.win);
    }
    return { ok: Boolean(run), clearedQueue: Boolean(hadQueue) };
  }

  function startChatRun({ win, input = {}, queueIfRunning = false, source = 'desktop' }) {
    ensureHome();
    const config = configModule.loadConfig();
    const text = String(input.text || '').slice(0, 200000);
    const attachments = sanitizeAttachments(input.attachments);
    if (!text.trim() && !attachments.length) throw new Error('Message is empty.');
    let session = input.sessionId ? store.getSession(input.sessionId) : null;

    if (session && state.sessionRuns.has(session.id)) {
      if (!queueIfRunning) throw new Error('This session is already running. Stop it or queue this message.');
      const item = {
        id: uid('q_'),
        text,
        attachments,
        model: input.model,
        mode: input.mode,
        win,
        source,
        queuedAt: new Date().toISOString(),
      };
      const queue = queueFor(session.id);
      queue.push(item);
      const payload = {
        type: 'chat:queued',
        sessionId: session.id,
        queueId: item.id,
        text,
        queueLength: queue.length,
        at: item.queuedAt,
        title: session.title,
      };
      sendEvent(win, payload);
      const main = getWindow();
      if (main && main !== win) sendEvent(main, payload);
      return { sessionId: session.id, queued: true, queueId: item.id, queueLength: queue.length, title: session.title, model: session.model, mode: session.mode };
    }

    if (!session) {
      const model = input.model && catalog.findModel(input.model, config) ? input.model : config.defaultModel;
      const mode = ['agent', 'plan', 'ask'].includes(input.mode) ? input.mode : 'agent';
      session = store.createSession({ workspace: config.workspace, model, mode });
    } else {
      if (input.model && catalog.findModel(input.model, config)) session.model = input.model;
      if (input.mode && ['agent', 'plan', 'ask'].includes(input.mode)) session.mode = input.mode;
      session.workspace = session.workspace || config.workspace;
    }

    const message = {
      id: uid('msg_'),
      role: 'user',
      content: text,
      attachments,
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
      source: 'desktop',
    });
  });

  require('electron').ipcMain.handle('chat:approve', async (_event, input = {}) => approveApproval(input.approvalId, input.decision));

  require('electron').ipcMain.handle('chat:stop', async (_event, sessionId) => stopSessionRun(sessionId));

  require('electron').ipcMain.handle('chat:queue', async (_event, sessionId) => {
    return { queue: (state.queues.get(sessionId) || []).map((item) => ({ queueId: item.id, text: item.text, queuedAt: item.queuedAt })) };
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

Guidance for coding agents working in this repository. Blank reads this file automatically.

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

  require('electron').ipcMain.handle('cli:install', async () => {
    const binDir = path.join(appPaths().root, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    const target = path.join(APP_ROOT, 'bin', 'blank.js');
    const cmd = path.join(binDir, isWin ? 'blank.cmd' : 'blank');
    let content;
    if (isWin) {
      content = `@echo off\r\nnode "${target}" %*\r\n`;
    } else {
      content = `#!/bin/sh\nexec node "${target}" "$@"\n`;
    }
    fs.writeFileSync(cmd, content, { encoding: 'utf8', mode: 0o755 });
    return {
      path: cmd,
      dir: binDir,
      instructions: `Add ${binDir} to PATH, then run "blank" from any terminal.`,
    };
  });

  /* -------------------------------------------------------------------- media */

  const MEDIA_KEY_IDS = new Set(['openai', 'google', 'stability', 'elevenlabs', 'replicate', 'fal']);
  const MEDIA_KEY_LABELS = {
    openai: 'OpenAI', google: 'Google AI', stability: 'Stability AI',
    elevenlabs: 'ElevenLabs', replicate: 'Replicate', fal: 'fal.ai',
  };

  ipcMainHandle('media:list', async (_event, options = {}) => mediaLibrary.listAssets(options));
  ipcMainHandle('media:get', async (_event, id) => mediaLibrary.getAsset(String(id || '')));
  ipcMainHandle('media:jobs', async () => mediaLibrary.listJobs());
  ipcMainHandle('media:job', async (_event, id) => mediaLibrary.getJob(String(id || '')));
  ipcMainHandle('media:storage', async () => mediaLibrary.storageInfo());
  ipcMainHandle('media:engines', async () => {
    const config = configModule.loadConfig();
    return {
      ...mediaLibrary.engineAvailability(),
      defaults: config.media?.defaults || mediaLibrary.MEDIA_DEFAULTS,
      storage: mediaLibrary.storageInfo(),
    };
  });

  ipcMainHandle('media:generate', async (_event, input = {}) => mediaLibrary.generate(input));
  ipcMainHandle('media:edit', async (_event, input = {}) => mediaLibrary.edit(input));
  ipcMainHandle('media:cancel', async (_event, id) => mediaLibrary.cancelJob(String(id || '')));
  ipcMainHandle('media:remove', async (_event, id) => mediaLibrary.removeAsset(String(id || '')));
  ipcMainHandle('media:favorite', async (_event, id) => mediaLibrary.toggleFavorite(String(id || '')));
  ipcMainHandle('media:readText', async (_event, id) => mediaLibrary.readText(String(id || '')));

  ipcMainHandle('media:importData', async (_event, input = {}) => mediaLibrary.importData(input));

  ipcMainHandle('media:import', async (event) => {
    const win = winFromEvent(event);
    const picked = await dialog.showOpenDialog(win, {
      title: 'Import media into Blank',
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
        items.push(await mediaLibrary.importFile(file));
      } catch (err) {
        errors.push(`${path.basename(file)}: ${err.message}`);
      }
    }
    return { canceled: false, items, errors };
  });

  ipcMainHandle('media:export', async (event, id) => {
    const asset = mediaLibrary.getAsset(String(id || ''));
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
    return { canceled: false, ...(await mediaLibrary.copyTo(asset.id, result.filePath)) };
  });

  ipcMainHandle('media:saveToWorkspace', async (_event, input = {}) => {
    const config = configModule.loadConfig();
    if (!config.workspace) throw new Error('Open a workspace first');
    const folder = String(input.folder || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').slice(0, 160);
    if (folder.split('/').some((part) => part === '..')) throw new Error('Folder must stay inside the workspace');
    const saved = await mediaLibrary.saveToWorkspace(String(input.id || ''), config.workspace, folder);
    return { ...saved, folder, workspace: config.workspace };
  });

  ipcMainHandle('media:reveal', async (_event, id) => {
    const file = mediaLibrary.assetFilePath(String(id || ''));
    if (!file || !fs.existsSync(file)) throw new Error('Asset file is missing');
    shell.showItemInFolder(file);
    return true;
  });

  ipcMainHandle('media:open', async (_event, id) => {
    const file = mediaLibrary.assetFilePath(String(id || ''));
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
    const keys = { ...(config.media?.keys || {}) };
    if (key) keys[id] = key;
    else delete keys[id];
    configModule.patchConfig({ media: { keys } });
    broadcast({ type: 'config:updated' });
    return {
      id,
      hasKey: Boolean(key),
      label: MEDIA_KEY_LABELS[id] || id,
      engines: mediaLibrary.engineAvailability(),
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
      if (raw.aspect) entry.aspect = String(raw.aspect).slice(0, 12);
      if (raw.quality) entry.quality = String(raw.quality).slice(0, 12);
      if (raw.style) entry.style = String(raw.style).slice(0, 40);
      if (Number(raw.duration) > 0) entry.duration = Math.min(600, Math.max(1, Number(raw.duration)));
      if (Number(raw.fps) > 0) entry.fps = Math.min(30, Math.max(8, Math.round(Number(raw.fps))));
      if (raw.soundtrack !== undefined) entry.soundtrack = Boolean(raw.soundtrack);
      if (Object.keys(entry).length) clean[kind] = entry;
    }
    if (!Object.keys(clean).length) return { defaults: configModule.loadConfig().media?.defaults || {} };
    const config = configModule.patchConfig({ media: { defaults: clean } });
    broadcast({ type: 'config:updated' });
    return { defaults: config.media?.defaults || {} };
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
    for (const run of state.runs.values()) run.controller.abort();
    denyApprovalsFor(() => true);
    state.runs.clear();
    state.sessionRuns.clear();
    state.queues.clear();
    try { remote.stop(); } catch {}
    try { overlay.dispose(); } catch {}
    try { computer.onActivity(null); } catch {}
    for (const job of mediaLibrary.listJobs()) {
      if (job.status === 'queued' || job.status === 'running') {
        try { mediaLibrary.cancelJob(job.id); } catch {}
      }
    }
  }

  return { dispose, attachWindowEvents };
}

module.exports = { registerIpc, attachWindowEvents };
