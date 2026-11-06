'use strict';

/* In-place updates from the official GitHub releases.

   electron-updater reads latest.yml next to the release assets, verifies the
   installer checksum and hands the install to NSIS/AppImage on quit. Updates
   are only offered by packaged builds; macOS needs a signed build, so the UI
   sends macOS users to the download page instead of pretending to work.
   Windows copies running from a `win-unpacked` folder or Temp have no
   installed base to update, so they say so rather than downloading an
   installer that cannot replace them. */

const os = require('os');
const { app } = require('electron');
const { isTemporaryBuildPath } = require('../src/core/update-base');

const FIRST_CHECK_DELAY = 12 * 1000;
const CHECK_INTERVAL = 6 * 60 * 60 * 1000;

function createUpdater() {
  let autoUpdater = null;
  let enabled = true;
  let initialTimer = null;
  let repeatTimer = null;
  let listeners = [];
  let onState = () => {};
  let disposed = false;

  const unpacked = app.isPackaged
    && process.platform === 'win32'
    && isTemporaryBuildPath(process.execPath, os.tmpdir());
  const supported = app.isPackaged && !unpacked && (
    process.platform === 'win32'
    || (process.platform === 'linux' && Boolean(process.env.APPIMAGE))
  );

  let state = {
    status: supported ? 'idle' : unpacked ? 'unpacked' : (app.isPackaged ? 'unsupported' : 'dev'),
    current: app.getVersion(),
    version: '',
    percent: 0,
    bytesPerSecond: 0,
    checkedAt: 0,
    error: '',
    supported,
  };

  const snapshot = () => ({
    ...state,
    current: app.getVersion(),
  });

  const emit = (patch) => {
    if (disposed) return;
    const previous = state.status;
    state = { ...state, ...patch };
    try { onState(snapshot(), previous); } catch {}
  };

  const fail = (error) => {
    const message = String((error && error.message) || error || 'Update failed.')
      .replace(/\s+/g, ' ')
      .slice(0, 400);
    emit({ status: 'error', error: message, percent: 0, checkedAt: Date.now() });
  };

  const clearTimers = () => {
    if (initialTimer) clearTimeout(initialTimer);
    if (repeatTimer) clearInterval(repeatTimer);
    initialTimer = null;
    repeatTimer = null;
  };

  function check() {
    if (!supported || disposed) return snapshot();
    if (!autoUpdater) return snapshot();
    if (['checking', 'downloading', 'installing', 'ready'].includes(state.status)) return snapshot();
    emit({ status: 'checking', error: '', percent: 0 });
    Promise.resolve(autoUpdater.checkForUpdates()).catch(fail);
    return snapshot();
  }

  function schedule() {
    clearTimers();
    if (!enabled || !supported || disposed) return;
    initialTimer = setTimeout(() => { check(); }, FIRST_CHECK_DELAY);
    repeatTimer = setInterval(() => { check(); }, CHECK_INTERVAL);
  }

  function start() {
    if (!supported || disposed) return snapshot();
    try {
      ({ autoUpdater } = require('electron-updater'));
    } catch (error) {
      fail(error);
      return snapshot();
    }
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;
    try { autoUpdater.logger = null; } catch {}
    const override = String(process.env.BLANK_UPDATE_URL || '').trim();
    if (override) {
      /* A local feed makes release QA possible without publishing. Packaged
         builds only accept loopback feeds so an environment variable cannot
         redirect a real install to another host. */
      try {
        const target = new URL(override);
        const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname);
        if (loopback || !app.isPackaged) {
          autoUpdater.setFeedURL({ provider: 'generic', url: override });
        }
      } catch (error) {
        fail(error);
        return snapshot();
      }
    }
    listeners = [
      ['checking-for-update', () => emit({ status: 'checking', error: '' })],
      ['update-available', (info) => emit({
        status: 'available',
        version: String(info?.version || ''),
        percent: 0,
        error: '',
      })],
      ['update-not-available', () => emit({
        status: 'current',
        version: '',
        percent: 0,
        error: '',
        checkedAt: Date.now(),
      })],
      ['download-progress', (progress) => {
        const percent = Math.max(0, Math.min(100, Math.round(Number(progress?.percent) || 0)));
        const bytesPerSecond = Math.max(0, Math.round(Number(progress?.bytesPerSecond) || 0));
        if (percent === state.percent && state.status === 'downloading') return;
        emit({ status: 'downloading', percent, bytesPerSecond, error: '' });
      }],
      ['update-downloaded', (info) => emit({
        status: 'ready',
        version: String(info?.version || state.version || ''),
        percent: 100,
        error: '',
        checkedAt: Date.now(),
      })],
      ['error', fail],
    ];
    for (const [name, handler] of listeners) autoUpdater.on(name, handler);
    schedule();
    return snapshot();
  }

  function install() {
    if (!supported || !autoUpdater || state.status !== 'ready') return snapshot();
    emit({ status: 'installing' });
    setTimeout(() => {
      try {
        autoUpdater.quitAndInstall(false, true);
      } catch (error) {
        fail(error);
      }
    }, 120);
    return snapshot();
  }

  function configure(options = {}) {
    if (typeof options.onState === 'function') onState = options.onState;
    if (options.auto !== undefined) {
      enabled = options.auto !== false;
      schedule();
    }
    return snapshot();
  }

  function dispose() {
    disposed = true;
    clearTimers();
    if (autoUpdater) {
      for (const [name, handler] of listeners) {
        try { autoUpdater.removeListener(name, handler); } catch {}
      }
    }
    listeners = [];
  }

  return { configure, start, check, install, dispose, status: snapshot };
}

module.exports = { createUpdater };
