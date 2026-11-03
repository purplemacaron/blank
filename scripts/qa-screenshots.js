'use strict';

/* Visual QA harness: loads the renderer against the browser mock and captures
   each primary page to qa/. Run with: npx electron scripts/qa-screenshots.js */

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'qa');
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function capture(win, name) {
  await new Promise((resolve) => {
    win.webContents.once('paint', () => resolve());
    win.webContents.invalidate();
    setTimeout(resolve, 900);
  });
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, `${name}.png`), image.toPNG());
  process.stdout.write(`captured ${name}\n`);
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: true,
    },
  });
  win.setMenuBarVisibility(false);
  await win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
  await sleep(1600);

  const errors = await win.webContents.executeJavaScript(`(() => {
    return window.__blankBootErrors || [];
  })()`).catch(() => []);
  if (errors.length) process.stdout.write(`boot errors: ${JSON.stringify(errors)}\n`);

  await capture(win, '01-chat');

  const pages = [
    ['models', '02-models'],
    ['plugins', '03-plugins'],
    ['studio', '04-studio'],
    ['settings', '05-settings'],
    ['memory', '06-memory'],
    ['mcp', '07-mcp'],
  ];
  for (const [page, name] of pages) {
    await win.webContents.executeJavaScript(`window.App && App.openPage(${JSON.stringify(page)})`).catch((error) => process.stdout.write(`nav ${page}: ${error.message}\n`));
    await sleep(900);
    await capture(win, name);
  }

  await win.webContents.executeJavaScript(`window.App && App.openPage('settings')`).catch(() => {});
  await sleep(400);
  await win.webContents.executeJavaScript(`window.Views && Views.openSettingsSection && Views.openSettingsSection('remote')`).catch(() => {});
  await sleep(700);
  await capture(win, '08-settings-remote');

  await win.webContents.executeJavaScript(`window.App && App.openPage('models')`).catch(() => {});
  await sleep(500);
  const addState = await win.webContents.executeJavaScript(`(() => {
    const btn = document.querySelector('[data-add-provider]');
    if (!btn) return 'button missing';
    try { btn.click(); } catch (error) { return 'click failed: ' + error.message; }
    return document.querySelectorAll('#modal-root .modal-layer').length + ' modal layer(s)';
  })()`).catch((error) => `eval failed: ${error.message}`);
  process.stdout.write(`add provider: ${addState}\n`);
  await win.webContents.executeJavaScript(`document.querySelectorAll('#modal-root .modal-layer').forEach((el) => el.classList.add('in'))`).catch(() => {});
  await sleep(600);
  await capture(win, '09-add-provider');

  await win.webContents.executeJavaScript(`document.querySelector('#modal-root [data-modal-close]')?.click()`).catch(() => {});
  await sleep(400);
  await win.webContents.executeJavaScript(`document.querySelector('[data-provider="anthropic"]')?.click()`).catch(() => {});
  await sleep(600);
  await win.webContents.executeJavaScript(`document.querySelectorAll('#modal-root .modal-layer').forEach((el) => el.classList.add('in'))`).catch(() => {});
  await sleep(400);
  await capture(win, '10-provider-detail');

  win.destroy();
  app.quit();
}).catch((error) => {
  process.stderr.write(`QA failed: ${error.stack || error.message}\n`);
  app.quit();
});
