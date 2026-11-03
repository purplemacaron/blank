'use strict';

const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const {
  app, BrowserWindow, Menu, shell, nativeTheme, dialog, protocol, net,
} = require('electron');
const { loadConfig, saveConfig } = require('../src/core/config');
const { MCPManager } = require('../src/core/mcp');
const { mediaPaths, ensureMedia } = require('../src/core/media/util');
const { registerIpc, attachWindowEvents } = require('./ipc');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'blank-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false },
  },
]);

const isMac = process.platform === 'darwin';
let mainWindow = null;
let ipc = null;
const mcp = new MCPManager();
let quitting = false;

app.setAppUserModelId('dev.blank.harness');

function registerMediaProtocol() {
  ensureMedia();
  const root = path.resolve(mediaPaths().assets);
  protocol.handle('blank-media', async (request) => {
    const notFound = new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    try {
      const url = new URL(request.url);
      if (url.hostname !== 'asset') return notFound;
      let name;
      try {
        name = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
      } catch {
        return notFound;
      }
      if (!name || name.startsWith('.') || name.includes('/') || name.includes('\\') || name.includes('\0')) return notFound;
      const file = path.resolve(root, name);
      if (!file.startsWith(root + path.sep)) return notFound;
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return notFound;
      return await net.fetch(pathToFileURL(file).toString());
    } catch {
      return notFound;
    }
  });
}

function ensureWorkspace() {
  const config = loadConfig();
  if (config.workspace && fs.existsSync(config.workspace)) return config.workspace;
  const dir = path.join(app.getPath('documents'), 'Blank Workspace');
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
    title: 'Blank',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      backgroundThrottling: false,
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

  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

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
    dialog.showErrorBox('Blank is unresponsive', 'The window stopped responding. You can close it and restart Blank.');
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
