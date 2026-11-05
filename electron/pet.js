'use strict';

/**
 * The blank desktop pets: one quiet paper for the AI currently in use, plus
 * one per blank Team member while the team works. Each pet mirrors the run
 * routed to it, passes clicks through outside the paper, and only takes focus
 * while its inline composer is open.
 */

const path = require('path');
const { BrowserWindow, screen } = require('electron');

const WIDTH = 216;
const HEIGHT = 264;
const MARGIN = 24;
const TEAM_PREFIX = '__team__:';
const DEFAULT_KEY = '__default__';

function createPet({ getConfig, getWindow, getModels, savePosition } = {}) {
  const entries = new Map();
  const senderKeys = new Map();
  const runKeys = new Map();
  const sessionKeys = new Map();
  let disposed = false;

  const readConfig = () => (typeof getConfig === 'function' ? getConfig() : {}) || {};

  function petConfig() {
    const config = readConfig();
    const pet = config.pet && typeof config.pet === 'object' ? config.pet : {};
    const positions = {};
    if (pet.positions && typeof pet.positions === 'object') {
      for (const [key, value] of Object.entries(pet.positions)) {
        const x = Number(value?.x);
        const y = Number(value?.y);
        if (!key || !Number.isFinite(x) || !Number.isFinite(y)) continue;
        positions[key] = { x: Math.round(x), y: Math.round(y) };
      }
    }
    return {
      enabled: pet.enabled !== false,
      x: Number.isFinite(Number(pet.x)) ? Math.round(Number(pet.x)) : null,
      y: Number.isFinite(Number(pet.y)) ? Math.round(Number(pet.y)) : null,
      positions,
      language: config.language === 'en' ? 'en' : 'ko',
      theme: config.theme === 'dark' ? 'dark' : 'light',
      defaultModel: String(config.defaultModel || '').trim(),
    };
  }

  function modelKey() {
    return DEFAULT_KEY;
  }

  /** One paper for the AI in use, not one for every model ever seen. */
  function baseModel() {
    let models = [];
    try {
      models = typeof getModels === 'function' ? getModels() : [];
    } catch {}
    const config = petConfig();
    const recent = models.map((value) => String(value || '').trim()).find(Boolean) || '';
    return recent || String(config.defaultModel || '').trim();
  }

  function primaryKey() {
    return DEFAULT_KEY;
  }

  function primaryArea() {
    try {
      return screen.getPrimaryDisplay().workArea;
    } catch {
      return { x: 0, y: 0, width: 1440, height: 900 };
    }
  }

  function defaultPosition() {
    const area = primaryArea();
    return {
      x: Math.round(area.x + area.width - WIDTH - MARGIN),
      y: Math.round(area.y + area.height - HEIGHT - MARGIN),
    };
  }

  /** Keep a pet on a real display; fall back to the default corner. */
  function clamp(point) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    const target = { x: Math.round(point.x), y: Math.round(point.y) };
    let displays = [];
    try { displays = screen.getAllDisplays(); } catch {}
    const centerX = target.x + WIDTH / 2;
    const centerY = target.y + HEIGHT / 2;
    const display = displays.find((entry) => {
      const area = entry.workArea;
      return centerX >= area.x && centerX < area.x + area.width
        && centerY >= area.y && centerY < area.y + area.height;
    });
    if (!display) return null;
    const area = display.workArea;
    return {
      x: Math.min(Math.max(target.x, area.x), area.x + area.width - WIDTH),
      y: Math.min(Math.max(target.y, area.y), area.y + area.height - HEIGHT),
    };
  }

  function basePosition() {
    const stored = petConfig();
    return clamp({ x: stored.x ?? defaultPosition().x, y: stored.y ?? defaultPosition().y }) || defaultPosition();
  }

  /** Line additional papers up to the left of the primary paper. */
  function slotPosition(index) {
    const base = basePosition();
    const area = primaryArea();
    const step = WIDTH + 6;
    const columns = Math.max(1, Math.floor((base.x - area.x) / step) + 1);
    const column = index % columns;
    const row = Math.floor(index / columns);
    const point = { x: base.x - column * step, y: base.y - row * (HEIGHT + 4) };
    return clamp(point) || base;
  }

  function slotFor(entry) {
    if (entry.kind === 'model' && entry.order === 0) return basePosition();
    return slotPosition(entry.order);
  }

  function startPosition(entry) {
    const saved = petConfig().positions[entry.key];
    const stored = saved ? clamp(saved) : null;
    if (stored) return stored;
    return slotFor(entry);
  }

  function createEntry({ key, kind, model, name, teamName, order }) {
    const entry = {
      key,
      kind,
      model: String(model || ''),
      name: String(name || ''),
      teamName: String(teamName || ''),
      order: Number.isFinite(order) ? order : 0,
      win: null,
      lastPosition: null,
      interactive: false,
      retiring: null,
      runId: '',
    };
    entries.set(key, entry);
    return entry;
  }

  function ensureWindow(entry) {
    if (disposed || !entry) return null;
    if (!petConfig().enabled) return null;
    if (entry.win && !entry.win.isDestroyed()) return entry.win;
    const start = entry.lastPosition || startPosition(entry);
    entry.lastPosition = start;
    const win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      x: start.x,
      y: start.y,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: true,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      show: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, 'pet-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
        backgroundThrottling: true,
      },
    });
    entry.win = win;
    const senderId = win.webContents.id;
    senderKeys.set(senderId, entry.key);
    try { win.setIgnoreMouseEvents(!entry.interactive, { forward: true }); } catch {}
    try { win.setAlwaysOnTop(true, 'screen-saver'); } catch {}
    try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch {}
    win.webContents.on('did-finish-load', () => {
      if (disposed || !entry.win || entry.win.isDestroyed()) return;
      if (!petConfig().enabled) return;
      showEntry(entry);
    });
    win.loadFile(path.join(__dirname, '..', 'renderer', 'pet.html'));
    win.on('closed', () => {
      senderKeys.delete(senderId);
      if (entry.win === win) entry.win = null;
    });
    return win;
  }

  function showEntry(entry) {
    if (!entry || petConfig().enabled === false) return;
    const target = ensureWindow(entry);
    if (!target) return;
    try { target.setAlwaysOnTop(true, 'screen-saver'); } catch {}
    try { target.showInactive(); } catch {}
  }

  function destroyEntry(key) {
    const entry = entries.get(key);
    if (!entry) return;
    clearTimeout(entry.retiring);
    entry.retiring = null;
    entries.delete(key);
    const win = entry.win;
    entry.win = null;
    if (win && !win.isDestroyed()) {
      try { win.destroy(); } catch {}
    }
  }

  function destroyAll() {
    for (const key of [...entries.keys()]) destroyEntry(key);
    senderKeys.clear();
    runKeys.clear();
    sessionKeys.clear();
  }

  function sync() {
    if (disposed) return;
    if (!petConfig().enabled) {
      destroyAll();
      return;
    }
    const entry = ensureBase(baseModel());
    for (const [key, item] of [...entries]) {
      if (item.kind === 'model' && key !== entry.key) destroyEntry(key);
    }
    for (const item of entries.values()) {
      if (item.kind === 'team') showEntry(item);
    }
  }

  function ensureBase(model) {
    const id = String(model || '').trim();
    let entry = entries.get(DEFAULT_KEY);
    if (!entry) entry = createEntry({ key: DEFAULT_KEY, kind: 'model', model: id, order: 0 });
    entry.order = 0;
    entry.model = id;
    if (petConfig().enabled) showEntry(entry);
    return entry;
  }

  function ensureModel(model) {
    if (disposed) return null;
    const entry = ensureBase(model || baseModel());
    if (model) entry.model = String(model);
    return entry.key;
  }

  function teamKey(member) {
    const id = String(member?.id || member?.name || '').trim();
    if (!id) return '';
    return `${TEAM_PREFIX}${id.slice(0, 80)}`;
  }

  function ensureTeam(member = {}) {
    if (disposed) return null;
    const key = teamKey(member);
    if (!key) return null;
    const config = petConfig();
    let entry = entries.get(key);
    if (!entry) {
      const teamCount = [...entries.values()].filter((item) => item.kind === 'team').length;
      entry = createEntry({
        key,
        kind: 'team',
        model: String(member.model || config.defaultModel || ''),
        name: String(member.name || ''),
        teamName: String(member.teamName || 'blank Team'),
        order: Math.min(teamCount + 1, 7),
      });
    }
    entry.model = String(member.model || config.defaultModel || '');
    entry.name = String(member.name || '').slice(0, 60);
    entry.teamName = String(member.teamName || entry.teamName || 'blank Team').slice(0, 60);
    entry.runId = String(member.runId || entry.runId || '');
    clearTimeout(entry.retiring);
    entry.retiring = null;
    if (config.enabled) showEntry(entry);
    return key;
  }

  function retireTeam(key, delay = 6000) {
    const entry = entries.get(key);
    if (!entry || entry.kind !== 'team') return;
    clearTimeout(entry.retiring);
    entry.retiring = setTimeout(() => {
      entry.retiring = null;
      destroyEntry(key);
    }, Math.max(500, Number(delay) || 6000));
  }

  function retireTeamsForRun(runId, delay = 5000) {
    if (!runId) return;
    for (const entry of entries.values()) {
      if (entry.kind !== 'team' || entry.runId !== String(runId)) continue;
      retireTeam(entry.key, delay);
    }
  }

  function sendTo(key, payload) {
    const entry = key ? entries.get(key) : null;
    if (!entry || !entry.win || entry.win.isDestroyed()) return false;
    try {
      entry.win.webContents.send('blank:event', payload);
      return true;
    } catch {
      return false;
    }
  }

  function send(payload = {}) {
    if (disposed) return false;
    let key = null;
    if (payload.model !== undefined && payload.model !== null) {
      const candidate = modelKey(payload.model);
      if (payload.type === 'run:start') key = ensureModel(payload.model);
      else if (entries.has(candidate)) key = candidate;
      if (key) {
        if (payload.runId) runKeys.set(payload.runId, key);
        if (payload.sessionId) sessionKeys.set(payload.sessionId, key);
      }
    }
    if (!key && payload.runId) key = runKeys.get(payload.runId) || null;
    if (!key && payload.sessionId) key = sessionKeys.get(payload.sessionId) || null;
    if (!key) key = primaryKey();
    if (!entries.has(key)) {
      const first = entries.keys().next();
      if (!first.done) key = first.value;
      else if (petConfig().enabled) key = ensureModel('');
      else return false;
    }
    const sent = sendTo(key, payload);
    if (payload.type === 'run:done' && payload.runId) {
      runKeys.delete(payload.runId);
      retireTeamsForRun(payload.runId);
    }
    return sent;
  }

  function sendTeam(member, payload, options = {}) {
    if (disposed) return false;
    const key = options.ensure ? ensureTeam(member) : teamKey(member);
    if (!key) return false;
    const entry = entries.get(key);
    if (!entry) return false;
    const sent = sendTo(key, payload);
    if (options.retire) retireTeam(key, options.retireDelay);
    return sent;
  }

  function identify(sender) {
    if (!sender || disposed) return null;
    const key = senderKeys.get(sender.id);
    if (!key) return null;
    const entry = entries.get(key);
    if (!entry || !entry.win || entry.win.isDestroyed()) return null;
    if (entry.win.webContents !== sender) return null;
    return { key: entry.key, kind: entry.kind, model: entry.model, name: entry.name, teamName: entry.teamName };
  }

  function currentPosition(key) {
    const entry = entries.get(key);
    if (!entry) return basePosition();
    if (entry.win && !entry.win.isDestroyed()) {
      try {
        const [x, y] = entry.win.getPosition();
        return { x, y };
      } catch {}
    }
    if (entry.lastPosition) return { ...entry.lastPosition };
    return startPosition(entry);
  }

  function move(key, point) {
    if (disposed) return currentPosition(key);
    const entry = entries.get(key);
    if (!entry) return null;
    const placed = clamp(point);
    if (!placed) return currentPosition(key);
    entry.lastPosition = placed;
    if (entry.win && !entry.win.isDestroyed()) {
      try { entry.win.setPosition(placed.x, placed.y); } catch {}
    }
    return placed;
  }

  function save(key, point) {
    const entry = entries.get(key);
    if (!entry) return null;
    const placed = move(key, point);
    if (placed && entry.kind === 'model' && typeof savePosition === 'function') {
      try { savePosition(entry.key, placed, entry.key === primaryKey()); } catch {}
    }
    return placed;
  }

  function reset(key) {
    const entry = entries.get(key);
    if (!entry) return null;
    const point = slotFor(entry);
    const placed = move(key, point);
    if (placed && entry.kind === 'model' && typeof savePosition === 'function') {
      try { savePosition(entry.key, placed, entry.key === primaryKey()); } catch {}
    }
    return placed || point;
  }

  function setInteractive(key, value) {
    const entry = entries.get(key);
    if (!entry) return false;
    entry.interactive = Boolean(value);
    if (!entry.win || entry.win.isDestroyed()) return true;
    try { entry.win.setIgnoreMouseEvents(!entry.interactive, { forward: true }); } catch {}
    return true;
  }

  /** Typing needs a focusable surface, but focus is only requested on demand. */
  function focus(key, value) {
    const entry = entries.get(key);
    if (!entry) return false;
    const target = ensureWindow(entry);
    if (!target) return false;
    if (value) {
      try {
        if (!target.isVisible()) target.showInactive();
        target.focus();
      } catch {}
    } else {
      try { target.blur(); } catch {}
    }
    return true;
  }

  function openApp() {
    const main = typeof getWindow === 'function' ? getWindow() : null;
    if (!main || main.isDestroyed()) return false;
    try {
      if (main.isMinimized()) main.restore();
      if (!main.isVisible()) main.show();
      main.focus();
    } catch {}
    return true;
  }

  function dispose() {
    disposed = true;
    destroyAll();
  }

  function keys() {
    return [...entries.values()].map((entry) => ({
      key: entry.key,
      kind: entry.kind,
      model: entry.model,
      name: entry.name,
      visible: Boolean(entry.win && !entry.win.isDestroyed() && entry.win.isVisible()),
      position: currentPosition(entry.key),
    }));
  }

  return {
    sync,
    ensureModel,
    send,
    sendTo,
    sendTeam,
    retireTeamsForRun,
    position: currentPosition,
    move,
    save,
    reset,
    setInteractive,
    focus,
    identify,
    openApp,
    dispose,
    keys,
    primaryKey,
  };
}

module.exports = { createPet, WIDTH, HEIGHT, MARGIN };
