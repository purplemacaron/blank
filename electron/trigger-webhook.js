'use strict';

const http = require('http');
const crypto = require('crypto');
const { tokensEqual } = require('../src/core/triggers');

const BODY_LIMIT = 64 * 1024;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 60;
const AUTH_FAILURE_LIMIT = 60;
const DEDUPE_WINDOW_MS = 60_000;
const DEFAULT_PORT = 47821;
const PORT_ATTEMPTS = 5;

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function createWebhookServer(options = {}) {
  const getRecords = typeof options.getRecords === 'function' ? options.getRecords : () => [];
  const getConfig = typeof options.getConfig === 'function' ? options.getConfig : () => ({});
  const dispatch = typeof options.dispatch === 'function' ? options.dispatch : async () => ({ started: false, reason: 'busy' });
  const onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};

  let server = null;
  let running = false;
  let port = 0;
  let configuredPort = DEFAULT_PORT;
  let allowLan = false;
  let error = '';
  const recordHits = new Map();
  const authFailures = new Map();
  const duplicates = new Map();

  function webhookRecords() {
    return getRecords().filter((record) => (
      record
      && record.enabled !== false
      && record.trigger
      && record.trigger.type === 'webhook'
    ));
  }

  function settings() {
    const config = getConfig() || {};
    const triggers = config.triggers && typeof config.triggers === 'object' ? config.triggers : {};
    const rawPort = Number(triggers.webhookPort);
    return {
      configuredPort: Number.isFinite(rawPort) && rawPort >= 0 && rawPort <= 65535
        ? Math.round(rawPort)
        : DEFAULT_PORT,
      allowLan: Boolean(triggers.webhookAllowLan),
    };
  }

  function status() {
    return {
      running,
      port,
      configuredPort,
      allowLan,
      error: error ? String(error).slice(0, 300) : '',
    };
  }

  function emitStatus() {
    try {
      onStatus(status());
    } catch {}
  }

  function pruneBuckets(now = Date.now()) {
    for (const map of [recordHits, authFailures]) {
      for (const [key, entry] of map) {
        if (!entry || now - entry.start >= RATE_WINDOW_MS) map.delete(key);
      }
    }
    for (const [key, at] of duplicates) {
      if (now - at >= DEDUPE_WINDOW_MS) duplicates.delete(key);
    }
  }

  function overRate(map, key, limit, count = false) {
    const now = Date.now();
    const entry = map.get(key);
    if (!entry || now - entry.start >= RATE_WINDOW_MS) {
      if (count) map.set(key, { start: now, count: 1 });
      return false;
    }
    if (entry.count >= limit) return true;
    if (count) entry.count += 1;
    return false;
  }

  function send(response, code, payload, headers = {}) {
    if (response.writableEnded) return;
    const body = JSON.stringify(payload);
    try {
      response.writeHead(code, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(body),
        ...headers,
      });
      response.end(body);
    } catch {
      try { response.destroy(); } catch {}
    }
  }

  async function handle(request, response) {
    const url = new URL(request.url || '/', 'http://localhost');
    const match = /^\/hooks\/([^/]+)$/.exec(url.pathname);
    if (!match) {
      send(response, 404, { ok: false, error: 'not_found' });
      return;
    }
    if (request.method !== 'POST') {
      send(response, 405, { ok: false, error: 'method_not_allowed' });
      return;
    }

    const id = decodeURIComponent(match[1]);
    const record = webhookRecords().find((entry) => entry.id === id);
    const remote = request.socket?.remoteAddress || 'unknown';
    if (!record) {
      overRate(authFailures, remote, AUTH_FAILURE_LIMIT, true);
      send(response, 401, { ok: false, error: 'unauthorized' });
      return;
    }

    if (overRate(authFailures, remote, AUTH_FAILURE_LIMIT)) {
      send(response, 429, { ok: false, error: 'too_many_auth_failures' }, { 'retry-after': '30' });
      return;
    }

    const config = record.trigger.config || {};
    const authorization = String(request.headers.authorization || '');
    const bearer = /^Bearer\s+(.+)$/i.exec(authorization);
    let received = bearer ? bearer[1].trim() : String(request.headers['x-blank-token'] || '').trim();
    if (!received && config.allowQueryToken) received = String(url.searchParams.get('token') || '').trim();

    if (!tokensEqual(config.token, received)) {
      overRate(authFailures, remote, AUTH_FAILURE_LIMIT, true);
      send(response, 401, { ok: false, error: 'unauthorized' });
      return;
    }

    if (overRate(recordHits, record.id, RATE_LIMIT, true)) {
      send(response, 429, { ok: false, error: 'rate_limited' }, { 'retry-after': '30' });
      return;
    }

    const chunks = [];
    let size = 0;
    let tooLarge = false;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    request.on('error', () => {
      if (!response.writableEnded) send(response, 400, { ok: false, error: 'bad_request' });
    });
    request.on('end', () => {
      void finish();
    });

    async function finish() {
      if (tooLarge) {
        send(response, 413, { ok: false, error: 'body_too_large' });
        return;
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      const contentType = String(request.headers['content-type'] || '');
      let body = raw;
      if (!contentType || /application\/json/i.test(contentType)) {
        try {
          body = raw ? JSON.parse(raw) : '';
        } catch {
          body = raw;
        }
      }

      const digest = sha256(raw);
      if (duplicates.has(digest)) {
        send(response, 202, { ok: true, started: false, reason: 'duplicate' });
        return;
      }
      duplicates.set(digest, Date.now());
      pruneBuckets();

      const event = {
        type: 'webhook',
        at: new Date().toISOString(),
        recordId: record.id,
        body,
        contentType: contentType || 'text/plain',
      };
      let result = null;
      try {
        result = await dispatch(record, event, { chain: [] });
      } catch {
        result = { started: false, reason: 'busy' };
      }
      const payload = { ok: true, started: Boolean(result?.started) };
      if (payload.started && result?.sessionId) payload.sessionId = result.sessionId;
      if (!payload.started) payload.reason = result?.reason || 'busy';
      send(response, 202, payload);
    }
  }

  function listenOnce(targetPort, host) {
    return new Promise((resolve) => {
      const cleanup = () => {
        server.off('error', onError);
        server.off('listening', onListening);
      };
      const onError = (err) => {
        cleanup();
        resolve(err);
      };
      const onListening = () => {
        cleanup();
        resolve(null);
      };
      server.once('error', onError);
      server.once('listening', onListening);
      try {
        server.listen(targetPort, host);
      } catch (err) {
        cleanup();
        resolve(err);
      }
    });
  }

  async function start() {
    if (running) return status();
    const wanted = settings();
    configuredPort = wanted.configuredPort;
    allowLan = wanted.allowLan;
    error = '';
    if (!webhookRecords().length) {
      running = false;
      port = 0;
      emitStatus();
      return status();
    }

    if (server) {
      try { server.close(); } catch {}
    }
    server = http.createServer((request, response) => {
      handle(request, response).catch(() => {
        send(response, 500, { ok: false, error: 'internal_error' });
      });
    });
    server.on('clientError', (err, socket) => {
      try { socket.destroy(); } catch {}
    });

    const host = allowLan ? '0.0.0.0' : '127.0.0.1';
    const candidates = configuredPort === 0
      ? [0]
      : Array.from({ length: PORT_ATTEMPTS }, (_, index) => configuredPort + index)
        .filter((candidate) => candidate <= 65535);

    for (const candidate of candidates) {
      const failure = await listenOnce(candidate, host);
      if (!failure) {
        running = true;
        port = server.address().port;
        emitStatus();
        return status();
      }
      if (failure.code !== 'EADDRINUSE') {
        error = failure.message;
        break;
      }
      error = failure.message;
    }

    running = false;
    port = 0;
    const closing = server;
    server = null;
    try { closing.close(); } catch {}
    emitStatus();
    return status();
  }

  async function stop() {
    running = false;
    port = 0;
    const closing = server;
    server = null;
    if (!closing) return;
    try { closing.closeAllConnections?.(); } catch {}
    await new Promise((resolve) => {
      try {
        closing.close(() => resolve());
      } catch {
        resolve();
      }
    });
    emitStatus();
  }

  async function reconcile() {
    const wanted = settings();
    const hasRecords = webhookRecords().length > 0;
    if (!hasRecords) {
      await stop();
      configuredPort = wanted.configuredPort;
      allowLan = wanted.allowLan;
      return status();
    }
    if (running && configuredPort === wanted.configuredPort && allowLan === wanted.allowLan) {
      return status();
    }
    await stop();
    return start();
  }

  return { start, stop, reconcile, status };
}

module.exports = { createWebhookServer };
