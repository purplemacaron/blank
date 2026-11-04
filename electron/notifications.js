'use strict';

/**
 * Native desktop notifications. Off unless enabled in Settings. Nothing is
 * shown while the main window is focused, so the in-app UI stays the primary
 * surface; notifications exist for background runs and scheduled work.
 */

const path = require('path');
const { Notification } = require('electron');
const configModule = require('../src/core/config');

let getWindow = () => null;
let lastShown = new Map();

function configure(options = {}) {
  if (typeof options.getWindow === 'function') getWindow = options.getWindow;
}

function preferences() {
  const saved = configModule.loadConfig().notifications || {};
  return {
    enabled: saved.enabled !== false,
    onFinish: saved.onFinish !== false,
    onApproval: saved.onApproval !== false,
    schedules: saved.schedules !== false,
  };
}

function supported() {
  try { return Notification.isSupported(); } catch { return false; }
}

function windowFocused() {
  const win = getWindow();
  return Boolean(win && !win.isDestroyed() && win.isFocused());
}

function openSession(sessionId) {
  const win = getWindow();
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
  if (sessionId) {
    win.webContents.send('blank:event', { type: 'notification:open', sessionId });
  }
}

/**
 * Show a notification. Returns false when notifications are disabled,
 * unsupported, the window is focused, or the same key fired moments ago.
 */
function notify({ title = 'Blank', body = '', sessionId = '', key = '', force = false, silent = false } = {}) {
  if (!supported()) return false;
  const prefs = preferences();
  if (!force) {
    if (!prefs.enabled) return false;
    if (windowFocused()) return false;
    if (key) {
      const seen = lastShown.get(key) || 0;
      if (Date.now() - seen < 8000) return false;
      lastShown.set(key, Date.now());
      if (lastShown.size > 60) {
        for (const [entry, at] of lastShown) if (Date.now() - at > 60000) lastShown.delete(entry);
      }
    }
  }
  try {
    const notification = new Notification({
      title: String(title).slice(0, 120),
      body: String(body || '').replace(/\s+/g, ' ').trim().slice(0, 260),
      icon: path.join(__dirname, '..', 'assets', 'icon.png'),
      silent: Boolean(silent),
      timeoutType: 'default',
    });
    notification.on('click', () => openSession(sessionId));
    notification.show();
    return true;
  } catch {
    return false;
  }
}

function notifyTest() {
  return notify({
    title: 'Blank notifications are on',
    body: 'Background runs, approvals and schedules will appear here.',
    force: true,
  });
}

function finished({ title, body, sessionId, failed = false, schedule = false }) {
  const prefs = preferences();
  if (schedule ? !prefs.schedules : !prefs.onFinish) return false;
  return notify({
    title: title || (failed ? 'Blank run stopped' : 'Blank finished'),
    body,
    sessionId,
    key: `run:${sessionId || ''}:${failed ? 'error' : 'ok'}`,
  });
}

function approval({ label, summary, sessionId }) {
  if (!preferences().onApproval) return false;
  return notify({
    title: `Approval needed · ${label || 'Tool'}`,
    body: summary || 'Blank is waiting for you before it continues.',
    sessionId,
    key: `approval:${sessionId || ''}`,
  });
}

function scheduleFinished({ title, body, sessionId, failed = false }) {
  return finished({ title, body, sessionId, failed, schedule: true });
}

module.exports = { approval, configure, finished, notify, notifyTest, preferences, scheduleFinished, supported };
