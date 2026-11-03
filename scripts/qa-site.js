'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'qa');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.disableHardwareAcceleration();

async function makeWindow(width, height) {
  const win = new BrowserWindow({
    width,
    height,
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true },
  });
  const errors = [];
  win.webContents.on('console-message', (event, level, message) => {
    if (level >= 2) errors.push(message);
  });
  const live = process.env.SITE_URL;
  const url = live || `file:///${path.join(ROOT, 'docs', 'index.html').replace(/\\/g, '/')}?demo=1`;
  if (live) await win.webContents.session.clearCache();
  await win.loadURL(url);
  await sleep(live ? 3200 : 1400);
  return { win, errors };
}

async function capture(win, name) {
  await new Promise((resolve) => {
    win.webContents.once('paint', resolve);
    win.webContents.invalidate();
    setTimeout(resolve, 700);
  });
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, `${name}.png`), image.toPNG());
  process.stdout.write(`captured ${name}\n`);
}

app.whenReady().then(async () => {
  const desktop = await makeWindow(1440, 1000);
  if (desktop.errors.length) process.stdout.write(`desktop errors: ${desktop.errors.join(' | ')}\n`);
  const info = await desktop.win.webContents.executeJavaScript(`(() => ({
    title: document.title,
    height: document.documentElement.scrollHeight,
    primary: (document.getElementById('primary-label') || {}).textContent,
    sub: (document.getElementById('primary-sub') || {}).textContent,
    pill: (document.getElementById('release-pill-text') || {}).textContent,
    cards: [...document.querySelectorAll('[data-os-card]')].map((card) => ({
      os: card.dataset.osCard,
      recommended: card.classList.contains('is-recommended'),
      tagVisible: !(card.querySelector('.recommended') || {}).hidden,
      button: (card.querySelector('.btn') || {}).className || '',
      href: (card.querySelector('[data-download]') || {}).getAttribute ? card.querySelector('[data-download]').getAttribute('href') : '',
      altVisible: card.dataset.osCard === 'mac' ? !document.querySelector('[data-download="mac-alt"]').hidden : null,
      altLabel: card.dataset.osCard === 'mac' ? document.querySelector('[data-download="mac-alt"]').textContent : null,
    })),
    repoLinksHidden: [...document.querySelectorAll('[data-repo-link]')].every((el) => el.hidden),
  }))()`);
  process.stdout.write(`site: ${JSON.stringify(info)}\n`);
  await capture(desktop.win, 'site-desktop-top');

  await desktop.win.webContents.executeJavaScript(`document.documentElement.style.scrollBehavior = 'auto'; document.getElementById('install').scrollIntoView({block:'start'});`);
  await sleep(300);
  await capture(desktop.win, 'site-desktop-install');

  await desktop.win.webContents.executeJavaScript(`document.getElementById('features').scrollIntoView({block:'start'})`);
  await sleep(300);
  await capture(desktop.win, 'site-desktop-features');

  desktop.win.setSize(390, 844);
  await desktop.win.webContents.executeJavaScript(`window.scrollTo(0, 0); document.querySelector('[data-mobile-nav]').hidden = true;`);
  await sleep(600);
  const mobileInfo = await desktop.win.webContents.executeJavaScript(`(() => ({
    viewport: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll('body *')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && (r.right > document.documentElement.clientWidth + 1 || r.left < -1);
    }).slice(0, 8).map((el) => el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ').join('.') : '')),
  }))()`);
  process.stdout.write(`mobile: ${JSON.stringify(mobileInfo)}\n`);
  await capture(desktop.win, 'site-mobile-top');
  await desktop.win.webContents.executeJavaScript(`document.getElementById('install').scrollIntoView({block:'start'})`);
  await sleep(400);
  await capture(desktop.win, 'site-mobile-install');
  desktop.win.destroy();

  app.quit();
}).catch((error) => {
  process.stderr.write(`Site QA failed: ${error.stack || error.message}\n`);
  app.quit();
});
