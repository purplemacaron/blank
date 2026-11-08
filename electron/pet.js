'use strict';

/**
 * blank memo: one quiet paper that follows the most recently used model, plus
 * one paper per blank Team member while the team works. Each pet mirrors the
 * run routed to it, passes clicks through outside the paper, and only takes
 * focus while its inline composer is open.
 */

const path = require('path');
const { BrowserWindow, screen } = require('electron');

const WIDTH = 216;
const HEIGHT = 264;
const MARGIN = 24;
const TEAM_PREFIX = '__team__:';
const RUN_PREFIX = '__run__:';
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
    const savedX = pet.x === null || pet.x === undefined || pet.x === ''
      ? null
      : (Number.isFinite(Number(pet.x)) ? Math.round(Number(pet.x)) : null);
    const savedY = pet.y === null || pet.y === undefined || pet.y === ''
      ? null
      : (Number.isFinite(Number(pet.y)) ? Math.round(Number(pet.y)) : null);
    return {
      enabled: pet.enabled !== false,
      x: savedX,
      y: savedY,
      positions,
      theme: config.theme === 'dark' ? 'dark' : 'light',
      defaultModel: String(config.defaultModel || '').trim(),
    };
  }

  function modelKey() {
    return DEFAULT_KEY;
  }

  /** One paper for the default model; a run may switch it to that model. */
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
      ready: false,
      pending: [],
      lastPosition: null,
      interactive: false,
      retiring: null,
      runId: '',
      sessionId: '',
      followFrom: null,
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
    entry.ready = false;
    const senderId = win.webContents.id;
    senderKeys.set(senderId, entry.key);
    try { win.setIgnoreMouseEvents(!entry.interactive, { forward: true }); } catch {}
    try { win.setAlwaysOnTop(true, 'screen-saver'); } catch {}
    try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch {}
    win.webContents.on('did-finish-load', () => {
      if (disposed || !entry.win || entry.win.isDestroyed()) return;
      if (!petConfig().enabled) return;
      showEntry(entry);
      entry.ready = true;
      const pending = entry.pending.splice(0);
      for (const payload of pending) sendTo(entry.key, payload);
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
      if (item.kind === 'team' || item.kind === 'run') showEntry(item);
    }
  }

  function ensureBase(model) {
    const id = String(model || '').trim();
    let entry = entries.get(DEFAULT_KEY);
    if (!entry) entry = createEntry({ key: DEFAULT_KEY, kind: 'model', model: id, order: 0 });
    entry.order = 0;
    if (id) entry.model = id;
    if (petConfig().enabled) showEntry(entry);
    return entry;
  }

  function ensureModel(model) {
    if (disposed) return null;
    const entry = ensureBase(model || baseModel());
    if (model) entry.model = String(model);
    return entry.key;
  }

  /** Put the base memo back on the configured default when no run is active. */
  function refreshDefault(force = false) {
    if (disposed) return false;
    if (!force && runKeys.size) return false;
    const entry = entries.get(DEFAULT_KEY);
    if (!entry || entry.kind !== 'model' || entry.runId) return false;
    entry.order = 0;
    entry.model = baseModel();
    return true;
  }

  function runKey(runId) {
    return `${RUN_PREFIX}${String(runId || '').slice(0, 64)}`;
  }

  function runOrder() {
    const used = new Set([...entries.values()].filter((item) => item.kind === 'run').map((item) => item.order));
    for (let slot = 1; slot <= 7; slot += 1) {
      if (!used.has(slot)) return slot;
    }
    return 7;
  }

  /** The first active run takes the base memo; concurrent runs get their own paper. */
  function ensureRun(payload = {}) {
    if (disposed) return null;
    const runId = String(payload.runId || '').trim();
    if (!runId) return ensureModel(payload.model);
    const bound = runKeys.get(runId);
    if (bound && entries.has(bound)) {
      const entry = entries.get(bound);
      if (payload.model) entry.model = String(payload.model);
      return bound;
    }
    const base = ensureBase();
    if (!base.runId) {
      base.runId = runId;
      if (payload.model) base.model = String(payload.model);
      return base.key;
    }
    const key = runKey(runId);
    let entry = entries.get(key);
    if (!entry) {
      entry = createEntry({
        key,
        kind: 'run',
        model: String(payload.model || baseModel()),
        order: runOrder(),
        runId,
      });
    }
    entry.runId = runId;
    if (payload.model) entry.model = String(payload.model);
    clearTimeout(entry.retiring);
    entry.retiring = null;
    if (petConfig().enabled) showEntry(entry);
    return key;
  }

  function retireRun(runId, delay = 6000) {
    const entry = entries.get(runKey(runId));
    runKeys.delete(runId);
    if (entry && entry.kind === 'run') {
      if (entry.runId === String(runId)) entry.sessionId = '';
      clearTimeout(entry.retiring);
      entry.retiring = setTimeout(() => {
        entry.retiring = null;
        destroyEntry(entry.key);
      }, Math.max(500, Number(delay) || 6000));
    }
    const base = entries.get(DEFAULT_KEY);
    if (base && base.runId === String(runId)) {
      base.runId = '';
      base.sessionId = '';
      /* The finished memo keeps the model that produced the result; only an
         explicit default-model change in Settings relabels it. */
    }
  }

  function teamKey(member) {
    const id = String(member?.id || member?.name || '').trim();
    if (!id) return '';
    return `${TEAM_PREFIX}${id.slice(0, 80)}`;
  }

  /** A blank Team member gets its own paper while it works. */
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
        teamName: String(member.teamName || 'blank team'),
        order: Math.min(teamCount + 1, 7),
      });
    }
    entry.model = String(member.model || config.defaultModel || '');
    entry.name = String(member.name || '').slice(0, 60);
    entry.teamName = String(member.teamName || entry.teamName || 'blank team').slice(0, 60);
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
    if (!entry.ready) {
      entry.pending.push(payload);
      return true;
    }
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
    if (payload.type === 'run:start') {
      key = ensureRun(payload);
      if (key && payload.runId) runKeys.set(payload.runId, key);
      if (key && payload.sessionId) {
        sessionKeys.set(payload.sessionId, key);
        const entry = entries.get(key);
        if (entry) entry.sessionId = String(payload.sessionId);
      }
    } else if (payload.model !== undefined && payload.model !== null) {
      const candidate = modelKey(payload.model);
      if (entries.has(candidate)) key = candidate;
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
    if (payload.type === 'run:done' && payload.runId) {
      retireTeamsForRun(payload.runId);
      retireRun(payload.runId);
    }
    return sendTo(key, payload);
  }

  function sendTeam(member, payload, options = {}) {
    if (disposed) return false;
    const key = options.ensure ? ensureTeam(member) : teamKey(member);
    if (!key) return false;
    const entry = entries.get(key);
    if (!entry) return false;
    const sent = sendTo(key, payload);
    if (options.retire) {
      const delay = Number(options.retireDelay)
        || (typeof options.retire === 'number' ? options.retire : 6000);
      retireTeam(key, delay);
    }
    return sent;
  }

  function identify(sender) {
    if (!sender || disposed) return null;
    const key = senderKeys.get(sender.id);
    if (!key) return null;
    const entry = entries.get(key);
    if (!entry || !entry.win || entry.win.isDestroyed()) return null;
    if (entry.win.webContents !== sender) return null;
    return {
      key: entry.key,
      kind: entry.kind,
      model: entry.model,
      name: entry.name,
      teamName: entry.teamName,
      runId: entry.runId,
      sessionId: entry.sessionId,
    };
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

  function resolveKey(target) {
    const value = String(target || '');
    if (!value) return entries.has(DEFAULT_KEY) ? DEFAULT_KEY : null;
    if (entries.has(value)) return value;
    const viaRun = runKeys.get(value);
    if (viaRun && entries.has(viaRun)) return viaRun;
    return null;
  }

  /** Park a memo beside the pointer while the agent drives the desktop. */
  function followCursor(target) {
    if (disposed) return null;
    const key = resolveKey(target);
    const entry = key ? entries.get(key) : null;
    if (!entry) return null;
    let cursor;
    let area;
    try {
      cursor = screen.getCursorScreenPoint();
      area = screen.getDisplayNearestPoint(cursor).workArea;
    } catch {
      return null;
    }
    if (!entry.followFrom) entry.followFrom = currentPosition(key);
    const gapX = 26;
    const gapY = 22;
    let x = cursor.x + gapX;
    let y = cursor.y + gapY;
    if (x + WIDTH > area.x + area.width) x = cursor.x - WIDTH - gapY;
    if (y + HEIGHT > area.y + area.height) y = cursor.y - HEIGHT - gapY;
    x = Math.min(Math.max(x, area.x), area.x + area.width - WIDTH);
    y = Math.min(Math.max(y, area.y), area.y + area.height - HEIGHT);
    entry.lastPosition = { x, y };
    if (entry.win && !entry.win.isDestroyed()) {
      try { entry.win.setPosition(x, y); } catch {}
    }
    return { x, y };
  }

  function stopFollow(target) {
    const key = resolveKey(target);
    const entry = key ? entries.get(key) : null;
    if (!entry || !entry.followFrom) return false;
    const point = entry.followFrom;
    entry.followFrom = null;
    move(key, point);
    return true;
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
      teamName: entry.teamName,
      visible: Boolean(entry.win && !entry.win.isDestroyed() && entry.win.isVisible()),
      position: currentPosition(entry.key),
    }));
  }

  return {
    sync,
    ensureModel,
    refreshDefault,
    send,
    sendTo,
    sendTeam,
    position: currentPosition,
    move,
    save,
    reset,
    followCursor,
    stopFollow,
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
