'use strict';

/**
 * A click-through, always-on-top cursor marker shown while the agent controls
 * the computer. It never receives input and disappears on its own.
 */

const { BrowserWindow, screen } = require('electron');

const SIZE = 210;
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
  html,body{margin:0;height:100%;background:transparent;overflow:hidden;font-family:ui-sans-serif,-apple-system,"Segoe UI",sans-serif}
  #stage{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:34px;height:34px}
  .halo{position:absolute;inset:-16px;border-radius:50%;background:radial-gradient(circle,rgba(47,107,255,.20),rgba(47,107,255,0) 68%);opacity:0;transform:scale(.6)}
  .ring{position:absolute;inset:0;border-radius:50%;border:2px solid #2F6BFF;box-shadow:0 0 0 3px rgba(255,255,255,.88),0 4px 16px rgba(20,45,110,.28);opacity:0;transform:scale(.7)}
  .dot{position:absolute;left:50%;top:50%;width:9px;height:9px;margin:-4.5px 0 0 -4.5px;border-radius:50%;background:#2F6BFF;box-shadow:0 0 0 2px #fff;opacity:0}
  .cross{position:absolute;left:50%;top:50%;width:54px;height:1px;margin:0 0 0 -27px;background:linear-gradient(90deg,transparent,rgba(47,107,255,.55),transparent);opacity:0}
  .cross.v{width:1px;height:54px;margin:-27px 0 0 0;background:linear-gradient(180deg,transparent,rgba(47,107,255,.55),transparent)}
  .ripple{position:absolute;inset:0;border-radius:50%;border:2px solid rgba(47,107,255,.7);opacity:0;transform:scale(.4)}
  #pill{position:absolute;left:50%;top:calc(50% + 42px);transform:translateX(-50%);display:flex;align-items:center;gap:5px;padding:4px 9px 4px 7px;border-radius:999px;background:rgba(16,24,40,.88);color:#fff;font-size:10.5px;font-weight:600;letter-spacing:.01em;white-space:nowrap;opacity:0;box-shadow:0 6px 20px rgba(15,23,42,.25)}
  #pill .mini{width:12px;height:12px;border-radius:4px;background:#2F6BFF;display:inline-flex;align-items:center;justify-content:center}
  #pill .mini i{width:4px;height:4px;border-radius:50%;background:#fff;display:block}
  #pill .sub{font-weight:450;color:rgba(255,255,255,.72)}
  body.show .ring{animation:ring .5s cubic-bezier(.2,.8,.2,1) forwards}
  body.show .dot{animation:fade .18s ease forwards}
  body.show .halo{animation:halo .9s ease-out forwards}
  body.show .cross{animation:fade .15s ease .04s forwards}
  body.show #pill{animation:pill .2s ease .05s forwards}
  body.click .ripple{animation:ripple .55s cubic-bezier(.2,.8,.2,1) forwards}
  @keyframes ring{0%{opacity:0;transform:scale(.55)}55%{opacity:1;transform:scale(1.06)}100%{opacity:1;transform:scale(1)}}
  @keyframes dot{to{opacity:1}}
  @keyframes fade{to{opacity:1}}
  @keyframes halo{0%{opacity:0;transform:scale(.5)}40%{opacity:1}100%{opacity:0;transform:scale(1.25)}}
  @keyframes pill{to{opacity:1}}
  @keyframes ripple{0%{opacity:.85;transform:scale(.4)}100%{opacity:0;transform:scale(2.1)}}
  body.out #stage,body.out #pill{transition:opacity .18s ease;opacity:0}
</style></head><body>
  <div id="stage">
    <span class="halo"></span><span class="cross"></span><span class="cross v"></span>
    <span class="ring"></span><span class="ripple"></span><span class="dot"></span>
  </div>
  <div id="pill"><span class="mini"><i></i></span><span id="label">Blank</span><span class="sub" id="detail"></span></div>
<script>
  window.__mark = function (kind, detail) {
    document.body.classList.remove('show', 'click', 'out');
    document.getElementById('label').textContent = kind || 'Cursor';
    const sub = document.getElementById('detail');
    sub.textContent = detail ? '· ' + String(detail).slice(0, 32) : '';
    void document.body.offsetWidth;
    document.body.classList.add('show');
    if (kind === 'Click' || kind === 'Drag' || kind === 'Screenshot') document.body.classList.add('click');
    clearTimeout(window.__t);
    window.__t = setTimeout(function () { document.body.classList.add('out'); }, kind === 'Screenshot' ? 650 : 1150);
  };
  window.__hide = function () { document.body.classList.remove('show', 'click'); document.body.classList.add('out'); };
</script></body></html>`;

function createComputerOverlay({ isEnabled } = {}) {
  let win = null;
  let lastPoint = null;
  let hideTimer = null;
  let disposed = false;

  function ensure() {
    if (disposed) return null;
    if (win && !win.isDestroyed()) return win;
    win = new BrowserWindow({
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
    win.setIgnoreMouseEvents(true);
    win.setAlwaysOnTop(true, 'screen-saver');
    try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch {}
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`).catch(() => {});
    win.on('closed', () => { win = null; });
    return win;
  }

  function toDip(point) {
    if (!point) return null;
    if (process.platform === 'win32' && typeof screen.screenToDipPoint === 'function') {
      try { return screen.screenToDipPoint(point); } catch {}
    }
    return point;
  }

  function moveTo(point) {
    if (!point) return;
    const dip = toDip(point);
    if (!dip) return;
    lastPoint = dip;
    const target = ensure();
    if (!target) return;
    try {
      target.setBounds({
        x: Math.round(dip.x - SIZE / 2),
        y: Math.round(dip.y - SIZE / 2),
        width: SIZE,
        height: SIZE,
      });
    } catch {}
  }

  function mark(kind, detail) {
    if (isEnabled && !isEnabled()) return;
    const target = ensure();
    if (!target) return;
    const label = LABELS[kind] || 'Blank';
    const run = () => {
      if (target.isDestroyed()) return;
      target.webContents.executeJavaScript(`window.__mark(${JSON.stringify(label)}, ${JSON.stringify(detail || '')})`).catch(() => {});
      if (!target.isVisible()) target.showInactive();
    };
    if (target.webContents.isLoading()) target.webContents.once('did-finish-load', run);
    else run();
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (win && !win.isDestroyed()) {
        try { win.webContents.executeJavaScript('window.__hide()').catch(() => {}); } catch {}
        setTimeout(() => { if (win && !win.isDestroyed()) win.hide(); }, 220);
      }
    }, kind === 'screenshot' ? 900 : 1500);
  }

  function flash(activity = {}) {
    if (isEnabled && !isEnabled()) return;
    const hasPoint = Number.isFinite(activity.x) && Number.isFinite(activity.y);
    if (hasPoint) moveTo({ x: activity.x, y: activity.y });
    else if (!lastPoint) {
      try {
        const cursor = screen.getCursorScreenPoint();
        moveTo(cursor);
      } catch {}
    }
    const detail = activity.kind === 'click'
      ? 'click'
      : activity.kind === 'drag'
        ? 'drag'
        : activity.detail || '';
    mark(activity.kind === 'screenshot' ? 'screenshot' : activity.kind, detail);
    if (activity.kind === 'drag' && Number.isFinite(activity.toX) && Number.isFinite(activity.toY)) {
      setTimeout(() => moveTo({ x: activity.toX, y: activity.toY }), 120);
    }
  }

  function hide() {
    clearTimeout(hideTimer);
    if (win && !win.isDestroyed()) win.hide();
  }

  function dispose() {
    disposed = true;
    clearTimeout(hideTimer);
    if (win && !win.isDestroyed()) win.destroy();
    win = null;
  }

  return { flash, hide, dispose };
}

module.exports = { createComputerOverlay };
