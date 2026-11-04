'use strict';

/* Paper visual QA: drives the Paper page, viewer, composer and filters against
   the browser mock and captures each state to qa/. Run with:
   npx electron scripts/qa-paper.js */

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'qa');
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const problems = [];

async function capture(win, name) {
  await new Promise((resolve) => {
    win.webContents.once('paint', () => resolve());
    win.webContents.invalidate();
    setTimeout(resolve, 700);
  });
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, `${name}.png`), image.toPNG());
  process.stdout.write(`captured ${name}\n`);
}

async function evaluate(win, source) {
  return win.webContents.executeJavaScript(source, true);
}

async function setLanguage(win, lang) {
  await evaluate(win, `localStorage.setItem('blank.lang', ${JSON.stringify(lang)}); location.reload(); true`);
  await sleep(1800);
}

async function openPaperPage(win) {
  await evaluate(win, `window.App && App.openPage('paper')`);
  await sleep(800);
}

async function layoutAudit(win, label) {
  const report = await evaluate(win, `(() => {
    const issues = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) {
      issues.push('document scrollWidth ' + doc.scrollWidth + ' > ' + doc.clientWidth);
    }
    const stage = document.querySelector('.paper-stage');
    for (const node of document.querySelectorAll('.paper-toolbar, .paper-grid, .paper-card, .paper-viewer-bar, .paper-tabs, .paper-devices, .paper-viewer-actions, .paper-composer')) {
      const rect = node.getBoundingClientRect();
      if (rect.width && rect.right > window.innerWidth + 1) {
        issues.push((node.className || node.tagName) + ' right ' + Math.round(rect.right) + ' > ' + window.innerWidth);
      }
      if (node.scrollWidth > node.clientWidth + 1 && getComputedStyle(node).overflowX !== 'auto' && getComputedStyle(node).overflowX !== 'scroll') {
        issues.push((node.className || node.tagName) + ' internal scroll ' + node.scrollWidth + ' > ' + node.clientWidth);
      }
    }
    return { issues, stage: stage ? stage.getBoundingClientRect().width : 0 };
  })()`);
  if (report.issues.length) problems.push(`${label}: ${report.issues.join('; ')}`);
  process.stdout.write(`${label} layout ${report.issues.length ? 'ISSUES ' + report.issues.join(' | ') : 'ok'}\n`);
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
  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2 && !/Autofill|DevTools/.test(message)) problems.push(`console: ${message}`);
  });
  await win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
  await sleep(1600);

  await setLanguage(win, 'en');
  await openPaperPage(win);

  const grid = await evaluate(win, `(() => ({
    cards: document.querySelectorAll('.paper-card').length,
    favorites: document.querySelectorAll('.paper-fav.on').length,
    filters: [...document.querySelectorAll('[data-paper-filter]')].map((node) => node.textContent.trim()),
    title: document.querySelector('.page-title, h1')?.textContent,
    nestedButtons: document.querySelectorAll('.paper-card button').length,
  }))()`);
  process.stdout.write(`grid ${JSON.stringify(grid)}\n`);
  if (grid.cards !== 4) problems.push(`grid expected 4 cards, saw ${grid.cards}`);
  if (grid.nestedButtons) problems.push(`nested buttons inside card: ${grid.nestedButtons}`);
  await layoutAudit(win, 'grid');
  await capture(win, 'paper-en-grid');

  /* viewer: preview, device widths, code */
  await evaluate(win, `document.querySelector('.paper-card').click()`);
  await sleep(700);
  const viewer = await evaluate(win, `(() => ({
    title: document.querySelector('.paper-modal .modal-head h2')?.textContent,
    tabs: [...document.querySelectorAll('.paper-tab')].map((node) => node.textContent.trim()),
    devices: [...document.querySelectorAll('.paper-device')].map((node) => node.dataset.paperDevice),
    frame: Boolean(document.querySelector('.paper-frame')),
    device: document.querySelector('.paper-stage')?.dataset.device,
  }))()`);
  process.stdout.write(`viewer ${JSON.stringify(viewer)}\n`);
  if (!viewer.frame) problems.push('viewer iframe missing for html paper');
  await layoutAudit(win, 'viewer-desktop');
  await capture(win, 'paper-en-viewer');

  await evaluate(win, `document.querySelector('[data-paper-device="phone"]').click()`);
  await sleep(500);
  const phoneWidth = await evaluate(win, `document.querySelector('.paper-frame')?.getBoundingClientRect().width`);
  process.stdout.write(`phone frame ${Math.round(phoneWidth || 0)}px\n`);
  if (!phoneWidth || phoneWidth > 420) problems.push(`phone width not applied: ${phoneWidth}`);
  await capture(win, 'paper-en-phone');

  await evaluate(win, `document.querySelector('[data-paper-tab="code"]').click()`);
  await sleep(400);
  const codeVisible = await evaluate(win, `Boolean(document.querySelector('.paper-code')) && !document.querySelector('.paper-frame')`);
  if (!codeVisible) problems.push('code tab did not switch to source');
  await capture(win, 'paper-en-code');

  await evaluate(win, `document.querySelector('.paper-modal [data-modal-close]').click()`);
  await sleep(400);

  /* composer: create then verify the card */
  await evaluate(win, `document.querySelector('[data-paper-new]').click()`);
  await sleep(400);
  const composer = await evaluate(win, `(() => ({
    kinds: [...document.querySelectorAll('#paper-kind option')].map((node) => node.value),
    languageHidden: document.querySelector('[data-paper-language]')?.hidden,
    save: Boolean(document.querySelector('[data-paper-save]')),
  }))()`);
  process.stdout.write(`composer ${JSON.stringify(composer)}\n`);
  if (composer.kinds.length !== 4) problems.push(`composer kinds: ${JSON.stringify(composer.kinds)}`);
  await layoutAudit(win, 'composer');
  await capture(win, 'paper-en-composer');

  await evaluate(win, `(() => {
    const title = document.querySelector('#paper-title');
    const body = document.querySelector('#paper-content');
    title.value = 'QA note';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    body.value = '<h1>QA note</h1><p>Created by the visual harness.</p>';
    body.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-paper-save]').click();
  })()`);
  await sleep(2600);
  const created = await evaluate(win, `(() => ({
    cards: document.querySelectorAll('.paper-card').length,
    first: document.querySelector('.paper-card-title')?.textContent,
    viewerOpen: Boolean(document.querySelector('.paper-modal')),
    headerTotal: document.querySelector('#paper-total')?.textContent,
  }))()`);
  process.stdout.write(`created ${JSON.stringify(created)}\n`);
  if (created.cards !== 5) problems.push(`created paper missing: ${created.cards} cards`);
  if (created.headerTotal !== '5') problems.push(`header total stale: ${created.headerTotal}`);
  await capture(win, 'paper-en-created');
  if (created.viewerOpen) {
    await evaluate(win, `document.querySelector('.paper-modal [data-modal-close]').click()`);
    await sleep(300);
  }

  /* filters and search */
  await evaluate(win, `document.querySelector('[data-paper-filter="code"]').click()`);
  await sleep(300);
  const filtered = await evaluate(win, `document.querySelectorAll('.paper-card').length`);
  if (filtered !== 1) problems.push(`code filter expected 1, saw ${filtered}`);
  await evaluate(win, `document.querySelector('[data-paper-filter="all"]').click()`);
  await evaluate(win, `(() => {
    const input = document.getElementById('paper-search');
    input.value = 'visual harness';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(300);
  const searched = await evaluate(win, `[...document.querySelectorAll('.paper-card-title')].map((node) => node.textContent)`);
  process.stdout.write(`search ${JSON.stringify(searched)}\n`);
  if (searched.length !== 1) problems.push(`search expected 1, saw ${JSON.stringify(searched)}`);
  await evaluate(win, `(() => {
    const input = document.getElementById('paper-search');
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-paper-favorites]').click();
  })()`);
  await sleep(300);
  const favorites = await evaluate(win, `document.querySelectorAll('.paper-card').length`);
  if (favorites !== 2) problems.push(`favorites expected 2, saw ${favorites}`);
  await evaluate(win, `document.querySelector('[data-paper-favorites]').click()`);
  await sleep(200);

  /* chat tool card */
  await evaluate(win, `App.openPage('chat')`);
  await sleep(600);
  await evaluate(win, `document.querySelector('[data-session-id="s_atlas_webhooks"]')?.click()`);
  await sleep(1200);
  const chatCard = await evaluate(win, `(() => {
    const cards = [...document.querySelectorAll('.tool-card')];
    const card = cards.find((node) => /Create Paper/.test(node.querySelector('.tool-label')?.textContent || ''));
    if (!card) return { found: false, labels: cards.map((node) => node.querySelector('.tool-label')?.textContent) };
    card.classList.add('open');
    card.scrollIntoView({ block: 'center' });
    return { found: true, paper: card.querySelector('.tool-paper-card b')?.textContent, action: card.querySelector('.tool-paper-card')?.dataset.action };
  })()`);
  process.stdout.write(`chat card ${JSON.stringify(chatCard)}\n`);
  if (!chatCard.found || !chatCard.paper) problems.push(`chat paper card missing: ${JSON.stringify(chatCard)}`);
  await sleep(500);
  await capture(win, 'paper-en-chat-card');
  const openedFromChat = await evaluate(win, `(async () => {
    document.querySelector('.tool-paper-card')?.click();
    await new Promise((resolve) => setTimeout(resolve, 900));
    return document.querySelector('.paper-modal .modal-head h2')?.textContent || '';
  })()`);
  if (openedFromChat !== 'Billing idempotency notes') problems.push(`chat card did not open viewer: ${openedFromChat}`);
  await evaluate(win, `document.querySelector('.paper-modal [data-modal-close]')?.click()`);
  await sleep(300);

  /* Korean surface */
  await setLanguage(win, 'ko');
  await openPaperPage(win);
  await layoutAudit(win, 'grid-ko');
  await capture(win, 'paper-ko-grid');
  await evaluate(win, `document.querySelector('.paper-card').click()`);
  await sleep(600);
  const koViewer = await evaluate(win, `(() => ({
    title: document.querySelector('.paper-modal .modal-head h2')?.textContent,
    meta: document.querySelector('.paper-modal .modal-head p')?.textContent,
    tabs: [...document.querySelectorAll('.paper-tab')].map((node) => node.textContent.trim()),
    devices: [...document.querySelectorAll('.paper-device')].map((node) => node.title || node.textContent.trim()),
  }))()`);
  process.stdout.write(`ko viewer ${JSON.stringify(koViewer)}\n`);
  if (!/^페이지 · v\d+$/.test(koViewer.meta || '')) problems.push(`korean viewer meta not localized: ${koViewer.meta}`);
  await layoutAudit(win, 'viewer-ko');
  await capture(win, 'paper-ko-viewer');
  await evaluate(win, `document.querySelector('.paper-modal [data-modal-close]').click()`);
  await sleep(300);
  await evaluate(win, `document.querySelector('[data-paper-new]').click()`);
  await sleep(400);
  await layoutAudit(win, 'composer-ko');
  await capture(win, 'paper-ko-composer');

  const leaks = await evaluate(win, `(() => {
    const text = document.body.innerText;
    return ['Canvas', 'Artifact', 'artifact', 'canvas'].filter((word) => new RegExp(word).test(text));
  })()`);
  if (leaks.length) problems.push(`legacy terms in UI: ${leaks.join(', ')}`);

  process.stdout.write(problems.length ? `PROBLEMS\n- ${problems.join('\n- ')}\n` : 'PAPER_QA_OK\n');
  app.exit(problems.length ? 1 : 0);
}).catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  app.exit(2);
});
