'use strict';

/**
 * Authenticated remote control for blank.
 *
 * Safe defaults: off until started, loopback-only unless LAN is explicitly
 * enabled, a fresh random token on every start, no CORS, no static file server,
 * rate limiting, and remote approvals disabled unless explicitly enabled.
 */

const http = require('http');
const os = require('os');
const crypto = require('crypto');
const { remotePage } = require('./remote-page');

const MAX_BODY = 256 * 1024;
const RATE_WINDOW = 60 * 1000;
const RATE_LIMIT = 240;

function lanAddresses() {
  const out = [];
  const interfaces = os.networkInterfaces();
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      out.push({ name, address: entry.address });
    }
  }
  return out;
}

function urlsFor(port, allowLan) {
  const urls = [{ label: 'This computer', url: `http://127.0.0.1:${port}` }];
  if (allowLan) {
    for (const entry of lanAddresses()) {
      urls.push({ label: entry.name, url: `http://${entry.address}:${port}` });
    }
  }
  return urls;
}

function createRemoteService() {
  let server = null;
  let token = '';
  let allowApprovals = false;
  let allowLan = false;
  let port = 8787;
  let startedAt = 0;
  let handlers = null;
  let live = null;
  let connections = 0;
  const rate = new Map();

  function status() {
    const urls = server ? urlsFor(port, allowLan) : [];
    return {
      running: Boolean(server),
      port,
      allowLan,
      allowApprovals,
      token: server ? token : '',
      startedAt,
      connections,
      urls,
      url: urls[0]?.url || '',
    };
  }

  function publish(payload) {
    if (!server || !payload || !payload.type) return;
    if (payload.type === 'run:start') {
      live = {
        runId: payload.runId,
        sessionId: payload.sessionId,
        model: payload.model || '',
        text: '',
        tool: '',
        at: Date.now(),
      };
      return;
    }
    if (!live || (payload.sessionId && payload.sessionId !== live.sessionId)) return;
    if (payload.type === 'text') {
      live.text += String(payload.delta ?? payload.text ?? '');
      if (live.text.length > 40000) live.text = live.text.slice(-40000);
    } else if (payload.type === 'tool:start') {
      live.tool = payload.summary ? `${payload.label || payload.name} · ${payload.summary}` : (payload.label || payload.name || 'Working');
    } else if (payload.type === 'tool:end') {
      live.tool = '';
    } else if (payload.type === 'run:done') {
      live = null;
    }
  }

  function sanitizeSession(session) {
    if (!session) return null;
    const messages = (session.messages || [])
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .slice(-80)
      .map((message) => ({
        id: message.id,
        role: message.role,
        content: String(message.content || '').slice(0, 14000),
        model: message.model || '',
        at: message.at || '',
      }));
    return {
      id: session.id,
      title: session.title || 'Session',
      model: session.model || '',
      mode: session.mode || 'agent',
      updatedAt: session.updatedAt || '',
      messages,
      tasks: Array.isArray(session.tasks) ? session.tasks.slice(0, 20) : [],
    };
  }

  function approvalsFor(sessionId) {
    if (!handlers?.pendingApprovals) return [];
    return handlers.pendingApprovals()
      .filter((approval) => !sessionId || approval.sessionId === sessionId)
      .map((approval) => ({
        approvalId: approval.approvalId,
        sessionId: approval.sessionId,
        tool: approval.tool,
        label: approval.label,
        summary: approval.summary,
        reason: approval.reason,
      }));
  }

  function clientKey(req) {
    return req.socket.remoteAddress || 'unknown';
  }

  function allowedRate(req) {
    const key = clientKey(req);
    const now = Date.now();
    const bucket = rate.get(key) || { start: now, count: 0 };
    if (now - bucket.start > RATE_WINDOW) {
      bucket.start = now;
      bucket.count = 0;
    }
    bucket.count += 1;
    rate.set(key, bucket);
    if (rate.size > 500) {
      for (const [keyName, value] of rate) if (now - value.start > RATE_WINDOW * 2) rate.delete(keyName);
    }
    return bucket.count <= RATE_LIMIT;
  }

  function tokenMatches(value) {
    if (!token || !value) return false;
    const expected = Buffer.from(token);
    const supplied = Buffer.from(String(value));
    if (expected.length !== supplied.length) return false;
    return crypto.timingSafeEqual(expected, supplied);
  }

  function sendJson(res, code, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(code, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body),
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'x-frame-options': 'DENY',
    });
    res.end(body);
  }

  function sendPage(res) {
    const html = remotePage({ appName: 'blank', version: handlers?.version?.() || '1.0.0' });
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': Buffer.byteLength(html),
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'x-frame-options': 'DENY',
    });
    res.end(html);
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY) {
          reject(new Error('Request body is too large.'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(new Error('Invalid JSON body.')); }
      });
      req.on('error', reject);
    });
  }

  async function handleApi(req, res, url) {
    const auth = String(req.headers.authorization || '');
    const supplied = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!tokenMatches(supplied)) {
      sendJson(res, 401, { error: 'Pairing token required.' });
      return;
    }
    const pathname = url.pathname;

    if (req.method === 'GET' && pathname === '/api/ping') {
      sendJson(res, 200, { ok: true, name: 'blank', version: handlers?.version?.() || '1.0.0', allowApprovals });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/state') {
      const sessionId = url.searchParams.get('sessionId') || '';
      const sessions = handlers?.listSessions?.() || [];
      let session = null;
      if (sessionId) {
        try { session = sanitizeSession(await handlers?.getSession?.(sessionId)); } catch { session = null; }
      }
      const running = sessionId ? Boolean(handlers?.isRunning?.(sessionId)) : Boolean(live);
      sendJson(res, 200, {
        ok: true,
        name: 'blank',
        sessions,
        session,
        running,
        live: live && (!sessionId || live.sessionId === sessionId) ? live : null,
        approvals: approvalsFor(sessionId),
        allowApprovals,
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/send') {
      let body;
      try { body = await readBody(req); } catch (err) { sendJson(res, 400, { error: err.message }); return; }
      const text = String(body.text || '').trim();
      if (!text) { sendJson(res, 400, { error: 'Message is empty.' }); return; }
      if (text.length > 20000) { sendJson(res, 400, { error: 'Message is too long (max 20,000 characters).' }); return; }
      const mode = ['agent', 'coding', 'design', 'research', 'plan', 'ask'].includes(body.mode) ? body.mode : undefined;
      try {
        const result = await handlers.send({ text, sessionId: body.sessionId || '', mode, source: 'remote' });
        sendJson(res, 200, { ok: true, ...result });
      } catch (err) {
        sendJson(res, 409, { error: err.message });
      }
      return;
    }

    if (req.method === 'POST' && pathname === '/api/stop') {
      let body;
      try { body = await readBody(req); } catch (err) { sendJson(res, 400, { error: err.message }); return; }
      try {
        const result = await handlers.stop(String(body.sessionId || ''));
        sendJson(res, 200, { ok: Boolean(result?.ok) });
      } catch (err) {
        sendJson(res, 400, { error: err.message });
      }
      return;
    }

    if (req.method === 'POST' && pathname === '/api/approve') {
      if (!allowApprovals) {
        sendJson(res, 403, { error: 'Remote approvals are disabled. Approve in the desktop app.' });
        return;
      }
      let body;
      try { body = await readBody(req); } catch (err) { sendJson(res, 400, { error: err.message }); return; }
      const decision = ['allow', 'deny', 'always'].includes(body.decision) ? body.decision : 'deny';
      try {
        const result = await handlers.approve({ approvalId: String(body.approvalId || ''), decision });
        if (result?.ok === false) sendJson(res, 400, { error: result.error || 'Approval expired.' });
        else sendJson(res, 200, { ok: true });
      } catch (err) {
        sendJson(res, 400, { error: err.message });
      }
      return;
    }

    sendJson(res, 404, { error: 'Not found.' });
  }

  async function handle(req, res) {
    connections += 1;
    try {
      if (!allowedRate(req)) {
        sendJson(res, 429, { error: 'Too many requests. Wait a minute.' });
        return;
      }
      let url;
      try { url = new URL(req.url, 'http://blank.local'); }
      catch { sendJson(res, 400, { error: 'Bad request.' }); return; }

      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        sendPage(res);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/favicon.ico') {
        res.writeHead(204, { 'cache-control': 'no-store' });
        res.end();
        return;
      }
      if (req.method === 'GET' && url.pathname === '/health') {
        sendJson(res, 200, { ok: true, name: 'blank' });
        return;
      }
      if (url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url);
        return;
      }
      sendJson(res, 404, { error: 'Not found.' });
    } catch (err) {
      if (!res.headersSent) sendJson(res, 500, { error: 'Remote control failed.' });
      else try { res.end(); } catch {}
    }
  }

  async function start(options = {}) {
    if (server) await stop();
    handlers = options.handlers || null;
    const requestedPort = Number(options.port ?? 8787);
    if (!Number.isInteger(requestedPort) || requestedPort < 1024 || requestedPort > 65535) {
      throw new Error('Port must be an integer between 1024 and 65535.');
    }
    port = requestedPort;
    allowLan = Boolean(options.allowLan);
    allowApprovals = Boolean(options.allowApprovals);
    token = crypto.randomBytes(24).toString('base64url');
    live = null;
    rate.clear();
    const host = allowLan ? '0.0.0.0' : '127.0.0.1';
    const instance = http.createServer((req, res) => { handle(req, res); });
    instance.requestTimeout = 30000;
    instance.headersTimeout = 15000;
    instance.keepAliveTimeout = 5000;
    await new Promise((resolve, reject) => {
      const onError = (err) => {
        instance.removeListener('listening', onListening);
        reject(err.code === 'EADDRINUSE' ? new Error(`Port ${port} is already in use.`) : err);
      };
      const onListening = () => {
        instance.removeListener('error', onError);
        resolve();
      };
      instance.once('error', onError);
      instance.once('listening', onListening);
      instance.listen(port, host);
    });
    server = instance;
    startedAt = Date.now();
    return status();
  }

  async function stop() {
    const instance = server;
    server = null;
    token = '';
    live = null;
    startedAt = 0;
    connections = 0;
    rate.clear();
    if (!instance) return { ok: true };
    await new Promise((resolve) => {
      instance.close(() => resolve());
      setTimeout(resolve, 1200).unref?.();
    });
    return { ok: true };
  }

  return { start, stop, status, publish };
}

module.exports = { createRemoteService, lanAddresses, urlsFor };
