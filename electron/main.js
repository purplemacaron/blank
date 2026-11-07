'use strict';

const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const {
  app, BrowserWindow, Menu, shell, nativeTheme, dialog, protocol, net,
} = require('electron');
const { loadConfig, saveConfig } = require('../src/core/config');
const { appPaths } = require('../src/core/paths');
const { MCPManager } = require('../src/core/mcp');
const { mediaPaths, ensureMedia } = require('../src/core/media/util');
const paperStore = require('../src/core/paper');
const { registerIpc, attachWindowEvents } = require('./ipc');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'blank-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false },
  },
  {
    scheme: 'blank-paper',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false },
  },
]);

const isMac = process.platform === 'darwin';
let mainWindow = null;
let ipc = null;
const mcp = new MCPManager();
let quitting = false;

app.setAppUserModelId('dev.blank.harness');

// A dev window runs beside an installed copy instead of fighting its lock.
if (process.argv.includes('--dev')) {
  app.setPath('userData', path.join(app.getPath('appData'), 'blank Dev'));
}

/* Keep the renderer heap honest and avoid a spare renderer process. The cap
   is far above what the UI needs; the exposed GC lets us release hidden-window
   memory when the app is minimized. */
app.commandLine.appendSwitch('js-flags', '--expose-gc --max-old-space-size=512');
app.commandLine.appendSwitch('disable-features', 'SpareRendererForSitePerProcess');

function registerMediaProtocol() {
  ensureMedia();
  const roots = {
    asset: path.resolve(mediaPaths().assets),
    computer: path.resolve(appPaths().root, 'computer'),
  };
  protocol.handle('blank-media', async (request) => {
    const notFound = new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    try {
      const url = new URL(request.url);
      const root = roots[url.hostname];
      if (!root) return notFound;
      let name;
      try {
        name = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
      } catch {
        return notFound;
      }
      if (!name || name.startsWith('.') || name.includes('/') || name.includes('\\') || name.includes('\0')) return notFound;
      if (url.hostname === 'computer' && !/\.(png|jpe?g)$/i.test(name)) return notFound;
      const file = path.resolve(root, name);
      if (!file.startsWith(root + path.sep)) return notFound;
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return notFound;
      return await net.fetch(pathToFileURL(file).toString());
    } catch {
      return notFound;
    }
  });
}

/* Paper previews run in a sandboxed iframe on their own scheme so the app CSP
   never has to allow inline scripts. The response CSP keeps each paper
   self-contained: no same-origin access and no fetch/XHR exfiltration. */
const PAPER_HTML_CSP = [
  "default-src 'none'",
  "img-src data: blob: https:",
  "media-src data: blob: https:",
  "style-src 'unsafe-inline' https:",
  "script-src 'unsafe-inline' https:",
  "font-src data: https:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

const PAPER_SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'";

function registerPaperProtocol() {
  protocol.handle('blank-paper', async (request) => {
    const notFound = () => new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    try {
      const url = new URL(request.url);
      if (url.hostname !== 'view') return notFound();
      let id;
      try {
        id = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
      } catch {
        return notFound();
      }
      const meta = paperStore.readMeta(id);
      if (!meta || !['html', 'svg'].includes(meta.kind)) return notFound();
      const file = paperStore.contentPath(meta);
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return notFound();
      const raw = fs.readFileSync(file, 'utf8');
      const body = meta.kind === 'html' ? paperStore.htmlDocument(raw) : raw;
      return new Response(body, {
        status: 200,
        headers: {
          'content-type': paperStore.paperMime(meta.kind),
          'content-security-policy': meta.kind === 'html' ? PAPER_HTML_CSP : PAPER_SVG_CSP,
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        },
      });
    } catch {
      return notFound();
    }
  });
}

function ensureWorkspace() {
  const config = loadConfig();
  if (config.workspace && fs.existsSync(config.workspace)) return config.workspace;
  const dir = path.join(app.getPath('documents'), 'blank Workspace');
  try {
    fs.mkdirSync(dir, { recursive: true });
    config.workspace = dir;
    saveConfig(config);
  } catch {}
  return config.workspace;
}

function buildMenu() {
  if (!isMac) {
    Menu.setApplicationMenu(null);
    return;
  }
  const template = [
    { role: 'appMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  const config = loadConfig();
  nativeTheme.themeSource = ['light', 'dark', 'system'].includes(config.theme) ? config.theme : 'light';
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
  mainWindow = new BrowserWindow({
    width: 1420,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    frame: isMac,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: isMac ? { x: 18, y: 15 } : undefined,
    backgroundColor: config.theme === 'dark' ? '#0E1014' : '#FFFFFF',
    title: 'blank',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      spellcheck: false,
      backgroundThrottling: true,
    },
  });

  if (!isMac) attachWindowEvents(mainWindow, {});
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const target = new URL(url);
    if (target.protocol === 'file:') return;
    event.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });

  /* The built-in browser is a sandboxed webview. Strip preload access and deny
     anything that is not plain http(s), then keep popups from escaping the app. */
  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload;
    delete webPreferences.preloadURL;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
    if (!/^https?:\/\//i.test(String(params.src || ''))) event.preventDefault();
  });

  mainWindow.webContents.on('did-attach-webview', (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    contents.on('will-navigate', (event, url) => {
      if (!/^https?:\/\//i.test(String(url || ''))) event.preventDefault();
    });
    contents.on('will-redirect', (event, url) => {
      if (!/^https?:\/\//i.test(String(url || ''))) event.preventDefault();
    });
  });

  const allowMediaRequest = (permission, requestingUrl, mediaTypes) => {
    if (permission !== 'media') return false;
    if (!String(requestingUrl || '').startsWith('file://')) return false;
    if (Array.isArray(mediaTypes) && mediaTypes.includes('video')) return false;
    return true;
  };
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(allowMediaRequest(permission, details?.requestingUrl || webContents.getURL(), details?.mediaTypes));
  });
  mainWindow.webContents.session.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => (
    allowMediaRequest(permission, requestingOrigin)
  ));

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const isDev = process.argv.includes('--dev');
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i') || (input.meta && input.alt && input.key.toLowerCase() === 'i')) {
      if (isDev || input.key === 'F12') {
        mainWindow.webContents.toggleDevTools();
        event.preventDefault();
      }
    }
    if (input.key === 'F5' && isDev) {
      mainWindow.webContents.reload();
      event.preventDefault();
    }
  });

  mainWindow.on('closed', () => {
    ipc?.dispose();
    mcp.closeAll();
    mainWindow = null;
    if (!quitting && !isMac) app.quit();
  });

  mainWindow.on('unresponsive', () => {
    dialog.showErrorBox('blank is unresponsive', 'The window stopped responding. You can close it and restart blank.');
  });

  mainWindow.on('minimize', () => {
    setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.executeJavaScript('window.gc && window.gc(); true', true).catch(() => {});
      if (global.gc) global.gc();
    }, 1200);
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    ensureWorkspace();
    registerMediaProtocol();
    registerPaperProtocol();
    buildMenu();
    ipc = registerIpc({ mcp, getWindow: () => mainWindow });
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('before-quit', () => {
  quitting = true;
  ipc?.dispose();
  mcp.closeAll();
});

app.on('window-all-closed', () => {
  app.quit();
});

process.on('uncaughtException', (err) => {
  console.error('[blank] uncaught', err);
});
