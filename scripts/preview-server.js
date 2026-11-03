#!/usr/bin/env node
'use strict';

/**
 * Zero-dependency static preview for the renderer in a normal browser.
 * The UI runs against renderer/js/mock.js, so nothing touches the real
 * filesystem, API keys or the Electron IPC bridge.
 *
 *   npm run preview
 *   → http://127.0.0.1:4173
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RENDERER = path.join(ROOT, 'renderer');
const ASSETS = path.join(ROOT, 'assets');
const PORT = Math.max(1024, Number(process.env.PORT) || 4173);
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.obj': 'text/plain; charset=utf-8',
  '.stl': 'model/stl',
};

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

function resolveFile(urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath.split('?')[0]); } catch { return null; }
  if (decoded === '/' || decoded === '') decoded = '/index.html';
  const base = decoded.startsWith('/assets/') ? ROOT : RENDERER;
  const target = path.resolve(base, `.${decoded}`);
  if (!target.startsWith(base + path.sep) && target !== path.join(base, 'index.html')) return null;
  if (target.startsWith(ASSETS) || target.startsWith(RENDERER)) return target;
  return null;
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, 'Method not allowed');
    return;
  }
  const file = resolveFile(req.url || '/');
  if (!file) { send(res, 403, 'Forbidden'); return; }
  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) { send(res, 404, 'Not found'); return; }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'content-type': type,
      'content-length': stat.size,
      'cache-control': 'no-store',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`\n  Blank preview\n  http://${HOST}:${PORT}\n\n  Browser-only mock backend. No keys, no IPC, no writes.\n\n`);
});

server.on('error', (error) => {
  process.stderr.write(`Preview server failed: ${error.message}\n`);
  process.exitCode = 1;
});
