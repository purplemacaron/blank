'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { app, BrowserWindow, dialog, shell, nativeTheme, ipcMain } = require('electron');
const { appPaths, ensureHome, uid, slugify } = require('../src/core/paths');
const configModule = require('../src/core/config');
const catalog = require('../src/core/catalog');
const store = require('../src/core/store');
const reasoning = require('../src/core/reasoning');
const providers = require('../src/core/providers');
const { runAgent, compactSession } = require('../src/core/agent');
const learn = require('../src/core/learn');
const { summarizeArgs } = require('../src/core/tools');
const search = require('../src/core/search');
const computer = require('../src/core/computer');
const { createRemoteService } = require('../src/core/remote');
const { createComputerOverlay } = require('./computer-overlay');
const plugins = require('../src/core/plugins');
const schedulesModule = require('../src/core/schedules');
const oauthModule = require('../src/core/oauth');
const paperStore = require('../src/core/paper');
const notifications = require('./notifications');
const dictation = require('../src/core/dictation');

const APP_ROOT = path.join(__dirname, '..');
const isWin = process.platform === 'win32';
const ipcMainHandle = ipcMain.handle.bind(ipcMain);

function createState() {
  return {
    runs: new Map(),
    sessionRuns: new Map(),
    approvals: new Map(),
    queues: new Map(),
    scheduleRuns: new Map(),
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
  ensureHome();
  notifications.configure({ getWindow });

  const sendEvent = (win, payload) => {
    if (!win || win.isDestroyed()) return;
    win.webContents.send('blank:event', payload);
  };

  const broadcast = (payload) => {
    for (const win of BrowserWindow.getAllWindows()) sendEvent(win, payload);
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
    const allowed = ['defaultModel', 'fallbackModel', 'theme', 'language', 'onboarded', 'agent', 'ui', 'customInstructions', 'disabledSkills', 'media', 'permissions', 'approvals', 'search', 'computer', 'team', 'notifications', 'dictation'];
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
    if (clean.approvals) {
      clean.approvals = { mode: clean.approvals.mode === 'all' ? 'all' : 'important' };
    }
    if (clean.defaultModel) {
      if (!catalog.findModel(clean.defaultModel, configModule.loadConfig())) throw new Error('Unknown model.');
    }
    if (clean.fallbackModel && clean.fallbackModel !== '') {
      if (!catalog.findModel(clean.fallbackModel, configModule.loadConfig())) throw new Error('Unknown fallback model.');
    }
    if (clean.theme && !['light', 'dark', 'system'].includes(clean.theme)) delete clean.theme;
    if (clean.language && !['ko', 'en'].includes(clean.language)) delete clean.language;
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
          };
        }).filter((member) => member.name);
      }
      clean.team = next;
    }
    if (clean.customInstructions) clean.customInstructions = String(clean.customInstructions).slice(0, 20000);
    if (clean.dictation) {
      const incoming = clean.dictation && typeof clean.dictation === 'object' ? clean.dictation : {};
      const current = configModule.loadConfig().dictation || {};
      clean.dictation = {
        providerId: String(incoming.providerId ?? current.providerId ?? '').trim().slice(0, 80),
        model: String(incoming.model ?? current.model ?? 'whisper-1').trim().slice(0, 120) || 'whisper-1',
        language: String(incoming.language ?? current.language ?? '').trim().slice(0, 20),
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
      providers: catalog.allProviders(config).map((provider) => catalog.publicProvider(provider, config)),
      models: catalog.allModels(config),
      config: configModule.publicConfig(config, catalog),
    };
  });

  async function discoverProviderModels(config, providerId) {
    const provider = catalog.getProvider(providerId, config);
    if (!provider) throw new Error('Unknown provider.');
    const models = await providers.listModels({ providerId, config });
    const entries = models.slice(0, 300).map((model) => ({
      id: String(model.id),
      name: String(model.name || model.id),
      context: Number(model.context) || 128000,
      tags: [],
    }));
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
    broadcast({ type: 'config:updated' });
    return configWithRuntime(config);
  });

  /* ------------------------------------------------------- search & computer */

  ipcMainHandle('dictation:transcribe', async (_event, input = {}) => dictation.transcribeAudio(input));

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
    const queue = (state.queues.get(id) || []).map((item) => ({ queueId: item.id, text: item.text }));
    return { session, running: state.sessionRuns.has(id), queue };
  });

  require('electron').ipcMain.handle('sessions:create', async (_event, input = {}) => {
    const config = configModule.loadConfig();
    const model = input.model && catalog.findModel(input.model, config) ? input.model : config.defaultModel;
    const mode = ['agent', 'coding', 'design', 'plan', 'ask'].includes(input.mode) ? input.mode : 'agent';
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
    if (input.model !== undefined) {
      const config = configModule.loadConfig();
      if (!catalog.findModel(input.model, config)) throw new Error('Unknown model.');
      session.model = input.model;
    }
    if (input.mode !== undefined && ['agent', 'coding', 'design', 'plan', 'ask'].includes(input.mode)) session.mode = input.mode;
    if (input.reasoningEffort !== undefined && reasoning.isEffort(input.reasoningEffort)) {
      session.reasoningEffort = input.reasoningEffort;
    }
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
      remote.publish({ ...payload, type: 'tool:start', summary: payload.summary });
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
    if (next.mode && ['agent', 'coding', 'design', 'plan', 'ask'].includes(next.mode)) session.mode = next.mode;
    if (next.reasoningEffort && reasoning.isEffort(next.reasoningEffort)) {
      session.reasoningEffort = next.reasoningEffort;
    }
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
        reasoningEffort: input.reasoningEffort,
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
      const mode = ['agent', 'coding', 'design', 'plan', 'ask'].includes(input.mode) ? input.mode : 'agent';
      session = store.createSession({ workspace: config.workspace, model, mode, reasoningEffort: input.reasoningEffort });
    } else {
      if (input.model && catalog.findModel(input.model, config)) session.model = input.model;
      if (input.mode && ['agent', 'coding', 'design', 'plan', 'ask'].includes(input.mode)) session.mode = input.mode;
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

  function scheduleSummary(schedule) {
    return {
      ...schedule,
      running: state.scheduleRuns.has(schedule.id),
    };
  }

  function runSchedule(schedule) {
    if (!schedule || state.scheduleRuns.has(schedule.id)) return { started: false, reason: 'running' };
    const config = configModule.loadConfig();
    const model = schedule.model && catalog.findModel(schedule.model, config) ? schedule.model : config.defaultModel;
    const workspace = schedule.workspace && fs.existsSync(schedule.workspace) ? schedule.workspace : config.workspace;
    const session = store.createSession({
      workspace,
      model,
      mode: schedule.mode,
      reasoningEffort: schedule.reasoningEffort,
    });
    session.title = schedule.title;
    session.titleSource = 'manual';
    const message = { id: uid('msg_'), role: 'user', content: schedule.prompt, at: new Date().toISOString(), source: 'schedule' };
    session.messages.push(message);
    store.saveSession(session);
    schedulesModule.markRun(schedule.id, { status: 'running', sessionId: session.id });
    notifySession(session);
    broadcast({ type: 'sessions:refresh' });

    const controller = new AbortController();
    state.scheduleRuns.set(schedule.id, { controller, sessionId: session.id });

    const emit = (payload) => {
      const enriched = { ...payload, sessionId: session.id, runId: `schedule_${schedule.id}` };
      broadcast(enriched);
      try { remote.publish(enriched); } catch {}
    };
    broadcast({ type: 'schedule:started', scheduleId: schedule.id, sessionId: session.id, title: schedule.title });

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
          text: `Scheduled “${schedule.title}” was denied ${request.label || request.tool}. Enable tool use or run it from a chat.`,
        });
        return Promise.resolve('deny');
      },
      mcp,
    }).then((outcome) => {
      const fresh = store.getSession(session.id) || session;
      schedulesModule.markRun(schedule.id, {
        status: outcome.ok ? 'ok' : outcome.stopped ? 'stopped' : 'error',
        sessionId: session.id,
      });
      emit({ type: 'run:done', outcome, usage: fresh.usage, title: fresh.title, tasks: fresh.tasks || [], files: fresh.files || [] });
      broadcast({ type: 'notice', level: outcome.ok ? 'info' : 'warn', text: `Scheduled “${schedule.title}” ${outcome.ok ? 'finished' : outcome.stopped ? 'stopped' : 'ended with an error'}.` });
      notifications.scheduleFinished({
        title: `${outcome.ok ? 'Scheduled run finished' : 'Scheduled run stopped'} · ${schedule.title}`,
        body: runNotificationBody(fresh, outcome),
        sessionId: fresh.id,
        failed: !outcome.ok,
      });
      notifySession(fresh);
      maybeReflect(getWindow(), fresh);
    }).catch((err) => {
      schedulesModule.markRun(schedule.id, { status: 'error', error: err.message, sessionId: session.id });
      emit({ type: 'run:done', outcome: { ok: false, error: err.message } });
      broadcast({ type: 'notice', level: 'warn', text: `Scheduled “${schedule.title}” failed: ${err.message}` });
      notifications.scheduleFinished({
        title: `Scheduled run failed · ${schedule.title}`,
        body: err.message,
        sessionId: session.id,
        failed: true,
      });
    }).finally(() => {
      state.scheduleRuns.delete(schedule.id);
      broadcast({ type: 'schedules:refresh' });
      broadcast({ type: 'sessions:refresh' });
    });
    return { started: true, sessionId: session.id };
  }

  function scheduleTick() {
    if (state.disposed) return;
    for (const schedule of schedulesModule.dueSchedules()) {
      if (state.scheduleRuns.size >= 2) break;
      try { runSchedule(schedule); } catch (err) {
        schedulesModule.markRun(schedule.id, { status: 'error', error: err.message });
      }
    }
  }

  ipcMainHandle('schedules:list', async () => ({
    schedules: schedulesModule.listSchedules().map(scheduleSummary),
    running: [...state.scheduleRuns.keys()],
  }));

  ipcMainHandle('schedules:save', async (event, input = {}) => {
    const schedule = schedulesModule.saveSchedule(input);
    broadcast({ type: 'schedules:refresh' });
    return { schedule: scheduleSummary(schedule) };
  });

  ipcMainHandle('schedules:delete', async (event, input = {}) => {
    const run = state.scheduleRuns.get(input.id);
    if (run) {
      try { run.controller.abort(); } catch {}
      state.scheduleRuns.delete(input.id);
    }
    const deleted = schedulesModule.deleteSchedule(input.id);
    broadcast({ type: 'schedules:refresh' });
    return { deleted };
  });

  ipcMainHandle('schedules:run', async (event, input = {}) => {
    const schedule = schedulesModule.getSchedule(input.id);
    if (!schedule) throw new Error('That schedule no longer exists.');
    return runSchedule(schedule);
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
    if (state.scheduleTimer) clearInterval(state.scheduleTimer);
    for (const run of state.scheduleRuns.values()) {
      try { run.controller.abort(); } catch {}
    }
    state.scheduleRuns.clear();
    try { oauthModule.closeAll(); } catch {}
    for (const run of state.runs.values()) run.controller.abort();
    denyApprovalsFor(() => true);
    state.runs.clear();
    state.sessionRuns.clear();
    state.queues.clear();
    try { remote.stop(); } catch {}
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
