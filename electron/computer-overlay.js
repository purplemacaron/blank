'use strict';

/**
 * Click-through, always-on-top cursor markers drawn while an agent controls the
 * computer. Each model in a run gets its own colored arrow; coordinate-free
 * actions track the real pointer instead of guessing where it is.
 */

const { BrowserWindow, screen } = require('electron');
const { petPalette } = require('./pet-palette');
const motion = require('./cursor-motion');

const SIZE = 220;
const MAX_MARKERS = 6;
const IDLE_MS = 2600;
const SCREENSHOT_IDLE_MS = 1200;
const POLL_MS = 60;
const FRAME_MS = 16;
const FADE_MS = 200;

const LABELS = {
  move: 'Cursor',
  click: 'Click',
  drag: 'Drag',
  scroll: 'Scroll',
  type: 'Typing',
  key: 'Key',
  focus: 'Focus',
  wait: 'Wait',
  screenshot: 'Screenshot',
};

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  html,body{margin:0;height:100%;background:transparent;overflow:hidden;font-family:ui-sans-serif,-apple-system,"Segoe UI",sans-serif;user-select:none}
  #stage{position:absolute;left:50%;top:50%;width:26px;height:35px;margin:-2px 0 0 -2px;transform-origin:2px 2px;opacity:0}
  .arrow{display:block;width:26px;height:35px;filter:drop-shadow(0 2px 5px rgba(15,23,42,.4))}
  .arrow path{fill:var(--accent,#2F6BFF);stroke:#fff;stroke-width:1.7;stroke-linejoin:round;paint-order:stroke fill}
  .halo{position:absolute;left:-10px;top:-10px;width:46px;height:46px;border-radius:50%;background:radial-gradient(circle,var(--accent-soft,rgba(47,107,255,.22)),transparent 70%);opacity:0}
  .ripple{position:absolute;left:-11px;top:-11px;width:26px;height:26px;border-radius:50%;border:2px solid var(--accent,#2F6BFF);opacity:0}
  .label{position:absolute;left:22px;top:27px;max-width:170px;padding:2px 7px 2px;border-radius:999px;background:var(--accent,#2F6BFF);color:var(--accent-ink,#fff);font-size:10px;line-height:14px;font-weight:600;letter-spacing:.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:0 4px 12px rgba(15,23,42,.24);opacity:0}
  body.show #stage{animation:pop .2s cubic-bezier(.2,.9,.25,1.2) forwards}
  body.show .halo{animation:halo .85s ease-out forwards}
  body.show .label{animation:fade .16s ease forwards}
  body.click .ripple{animation:ripple .5s cubic-bezier(.2,.8,.2,1) forwards}
  body.idle #stage{animation:none;opacity:0;transition:opacity ${FADE_MS}ms ease}
  @keyframes pop{0%{opacity:0;transform:scale(.7)}100%{opacity:1;transform:scale(1)}}
  @keyframes halo{0%{opacity:0;transform:scale(.5)}40%{opacity:1}100%{opacity:0;transform:scale(1.2)}}
  @keyframes ripple{0%{opacity:.85;transform:scale(.35)}100%{opacity:0;transform:scale(2.2)}}
  @keyframes fade{to{opacity:1}}
  @media (prefers-reduced-motion: reduce){*{animation-duration:.001ms !important;animation-iteration-count:1 !important}}
</style></head><body>
  <div id="stage">
    <span class="halo"></span><span class="ripple"></span>
    <svg class="arrow" viewBox="0 0 24 33" aria-hidden="true">
      <path d="M2 2 L2 26 L8.6 20.2 L12.8 30.6 L17.6 28.6 L13.4 18.4 L22 18.4 Z"></path>
    </svg>
    <span class="label"></span>
  </div>
<script>
  window.__mark = function (data) {
    data = data || {};
    const root = document.documentElement.style;
    root.setProperty('--accent', data.accent || '#2F6BFF');
    root.setProperty('--accent-soft', data.accentSoft || 'rgba(47,107,255,.22)');
    root.setProperty('--accent-ink', data.accentInk || '#fff');
    const label = document.querySelector('.label');
    label.textContent = data.label || '';
    label.style.display = data.label ? '' : 'none';
    document.body.classList.remove('show', 'click', 'idle');
    void document.body.offsetWidth;
    document.body.classList.add('show');
    if (data.kind === 'click' || data.kind === 'drag' || data.kind === 'screenshot') document.body.classList.add('click');
  };
  window.__hide = function () { document.body.classList.add('idle'); };
</script></body></html>`;

function createComputerOverlay({ isEnabled, theme } = {}) {
  const markers = new Map();
  let disposed = false;

  function themeName() {
    const value = typeof theme === 'function' ? theme() : theme;
    return value === 'dark' ? 'dark' : 'light';
  }

  function markerDip(point) {
    if (!point) return null;
    if (process.platform === 'win32' && typeof screen.screenToDipPoint === 'function') {
      try { return screen.screenToDipPoint(point); } catch {}
    }
    return point;
  }

  function pointerDip() {
    try { return screen.getCursorScreenPoint(); } catch { return null; }
  }

  function displayBounds(point) {
    try {
      const display = screen.getDisplayNearestPoint({ x: Math.round(point.x), y: Math.round(point.y) });
      return display.bounds;
    } catch {
      return { x: 0, y: 0, width: 0, height: 0 };
    }
  }

  function ensureWindow(marker) {
    if (disposed) return null;
    if (marker.win && !marker.win.isDestroyed()) return marker.win;
    marker.win = new BrowserWindow({
      width: SIZE,
      height: SIZE,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      show: false,
      backgroundColor: '#00000000',
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    marker.win.setIgnoreMouseEvents(true);
    marker.win.setAlwaysOnTop(true, 'screen-saver');
    try { marker.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch {}
    marker.ready = false;
    marker.win.webContents.on('did-finish-load', () => {
      marker.ready = true;
      if (marker.pending) {
        const pending = marker.pending;
        marker.pending = null;
        call(marker, pending);
      }
    });
    marker.win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`).catch(() => {});
    marker.win.on('closed', () => { marker.win = null; marker.ready = false; });
    return marker.win;
  }

  function call(marker, script) {
    const win = marker.win;
    if (!win || win.isDestroyed()) return;
    if (!marker.ready) { marker.pending = script; return; }
    try { win.webContents.executeJavaScript(script).catch(() => {}); } catch {}
  }

  function show(marker) {
    const win = ensureWindow(marker);
    if (!win) return;
    if (!win.isVisible()) win.showInactive();
  }

  function place(marker, point) {
    const win = marker.win;
    if (!win || win.isDestroyed() || !point) return;
    const wanted = motion.markerWindowPoint(point, SIZE);
    const area = displayBounds(point);
    const at = motion.clampWindowToArea(wanted, area, SIZE);
    try { win.setBounds({ x: at.x, y: at.y, width: SIZE, height: SIZE }); } catch {}
  }

  function stopGlide(marker) {
    if (marker.glide) clearInterval(marker.glide);
    marker.glide = null;
  }

  function glide(marker, target) {
    marker.target = target;
    if (marker.glide) return;
    marker.glide = setInterval(() => {
      if (disposed || !marker.point || !marker.target) { stopGlide(marker); return; }
      const step = motion.glideStep(marker.point, marker.target, 0.32);
      marker.point = step.point;
      place(marker, marker.point);
      if (step.done) stopGlide(marker);
    }, FRAME_MS);
    if (marker.glide.unref) marker.glide.unref();
  }

  function stopPoll(marker) {
    if (marker.poll) clearInterval(marker.poll);
    marker.poll = null;
  }

  /** Follow the real pointer while the agent acts without a coordinate. */
  function poll(marker) {
    if (marker.poll) return;
    marker.poll = setInterval(() => {
      if (disposed) { stopPoll(marker); return; }
      const point = pointerDip();
      if (!point) return;
      marker.point = point;
      marker.target = point;
      stopGlide(marker);
      place(marker, point);
    }, POLL_MS);
    if (marker.poll.unref) marker.poll.unref();
  }

  function mark(marker, activity, palette) {
    const kind = String(activity.kind || 'move');
    const label = [motion.shortActor(activity.actor), LABELS[kind]].filter(Boolean).join(' · ');
    marker.kind = kind;
    marker.label = label;
    call(marker, `window.__mark(${JSON.stringify({
      label,
      kind,
      accent: palette.accent,
      accentSoft: palette.accentSoft,
      accentInk: palette.accentInk,
    })})`);
    show(marker);
  }

  function scheduleIdle(marker) {
    clearTimeout(marker.idle);
    const delay = marker.kind === 'screenshot' ? SCREENSHOT_IDLE_MS : IDLE_MS;
    marker.idle = setTimeout(() => {
      marker.idle = null;
      stopPoll(marker);
      stopGlide(marker);
      marker.point = null;
      marker.target = null;
      call(marker, 'window.__hide()');
      const win = marker.win;
      setTimeout(() => {
        if (!disposed && win && !win.isDestroyed() && !marker.idle) win.hide();
      }, FADE_MS + 60);
    }, delay);
    if (marker.idle.unref) marker.idle.unref();
  }

  function ensureMarker(actor) {
    const key = motion.markerKey(actor);
    let marker = markers.get(key);
    if (marker) return marker;
    if (markers.size >= MAX_MARKERS) {
      let oldest = null;
      for (const item of markers.values()) {
        if (!oldest || item.lastAt < oldest.lastAt) oldest = item;
      }
      if (oldest) drop(oldest.key);
    }
    marker = {
      key,
      win: null,
      ready: false,
      pending: null,
      point: null,
      target: null,
      glide: null,
      poll: null,
      idle: null,
      lastAt: 0,
      kind: 'move',
      label: '',
    };
    markers.set(key, marker);
    return marker;
  }

  function drop(key) {
    const marker = markers.get(key);
    if (!marker) return;
    markers.delete(key);
    clearTimeout(marker.idle);
    stopGlide(marker);
    stopPoll(marker);
    if (marker.win && !marker.win.isDestroyed()) marker.win.destroy();
    marker.win = null;
  }

  function flash(activity = {}) {
    if (disposed) return;
    if (isEnabled && !isEnabled()) return;
    const actor = String(activity.actor || '');
    const marker = ensureMarker(actor);
    if (!ensureWindow(marker)) return;
    marker.lastAt = Date.now();
    const palette = petPalette(actor || 'blank', themeName());
    const hasPoint = Number.isFinite(activity.x) && Number.isFinite(activity.y);
    if (hasPoint) {
      stopPoll(marker);
      const point = markerDip({ x: activity.x, y: activity.y });
      if (!marker.point) {
        marker.point = point;
        marker.target = point;
        place(marker, point);
      } else {
        glide(marker, point);
      }
      if (activity.kind === 'drag' && Number.isFinite(activity.toX) && Number.isFinite(activity.toY)) {
        const end = markerDip({ x: activity.toX, y: activity.toY });
        setTimeout(() => {
          if (!disposed && markers.get(marker.key) === marker) glide(marker, end);
        }, 220);
      }
    } else {
      stopGlide(marker);
      const point = pointerDip();
      if (point) {
        marker.point = point;
        marker.target = point;
        place(marker, point);
      }
      poll(marker);
    }
    mark(marker, activity, palette);
    scheduleIdle(marker);
  }

  function hide() {
    for (const marker of markers.values()) {
      clearTimeout(marker.idle);
      marker.idle = null;
      stopPoll(marker);
      stopGlide(marker);
      marker.point = null;
      marker.target = null;
      call(marker, 'window.__hide()');
      const win = marker.win;
      setTimeout(() => {
        if (!disposed && win && !win.isDestroyed()) win.hide();
      }, FADE_MS + 60);
    }
  }

  function dispose() {
    disposed = true;
    for (const key of [...markers.keys()]) drop(key);
  }

  return { flash, hide, dispose };
}

module.exports = { createComputerOverlay };
