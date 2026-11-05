'use strict';

// Rasterizes assets/icon.svg into the PNG sizes the app, installer and site use.
// Run with the project's Electron binary:
//   ./node_modules/electron/dist/electron.exe scripts/make-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'assets', 'icon.svg'), 'utf8');
const source = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

const targets = [
  { file: 'assets/icon.png', size: 1024 },
  { file: 'docs/media/icon.png', size: 512 },
  { file: 'docs/media/favicon.png', size: 128 },
];

const page = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}</style><img id="mark" src="${source}">`;

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 64,
    height: 64,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true },
  });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
  for (const target of targets) {
    const dataUrl = await win.webContents.executeJavaScript(`
      new Promise((resolve, reject) => {
        const img = document.getElementById('mark');
        const size = ${target.size};
        const paint = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, size, size);
            resolve(canvas.toDataURL('image/png'));
          } catch (error) {
            reject(error);
          }
        };
        if (img.complete && img.naturalWidth) paint();
        else { img.onload = paint; img.onerror = reject; }
      })
    `);
    if (!dataUrl.startsWith('data:image/png;base64,')) {
      throw new Error(`Unexpected raster for ${target.file}`);
    }
    const out = path.join(root, target.file);
    fs.writeFileSync(out, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
    console.log(`${target.file} ${target.size}x${target.size}`);
  }
  win.destroy();
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
