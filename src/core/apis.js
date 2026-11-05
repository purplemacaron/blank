'use strict';

/**
 * Saved HTTP connectors. Users add an API once (base URL, auth, optional key)
 * and the agent can call it through the api_request tool. Keys are stored only
 * in ~/.blank/config.json and are never returned to the renderer.
 */

const { uid } = require('./paths');
const { maskKey } = require('./config');

const AUTH_KINDS = ['bearer', 'header', 'query', 'none'];
const MAX_BODY = 200_000;

function isHttpUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function sanitizeApi(input = {}, existing = null, now = new Date()) {
  const baseUrl = String(input.baseUrl ?? existing?.baseUrl ?? '').trim().replace(/\/+$/, '').slice(0, 600);
  if (!isHttpUrl(baseUrl)) throw new Error('The base URL must start with http:// or https://.');
  const name = String(input.name ?? existing?.name ?? '').trim().slice(0, 60);
  if (!name) throw new Error('Give this API a name.');
  const auth = AUTH_KINDS.includes(input.auth) ? input.auth : AUTH_KINDS.includes(existing?.auth) ? existing.auth : 'bearer';
  let key = String(existing?.key || '');
  if (input.clearKey) key = '';
  else if (typeof input.key === 'string' && input.key.trim()) key = input.key.trim().slice(0, 4000);
  if (auth !== 'none' && auth !== 'query' && auth !== 'header' && auth !== 'bearer') key = '';
  const headerName = String(input.headerName ?? existing?.headerName ?? 'Authorization').replace(/[^a-z0-9_-]/gi, '').slice(0, 60) || 'Authorization';
  return {
    id: existing?.id || uid('api_'),
    name,
    description: String(input.description ?? existing?.description ?? '').trim().slice(0, 300),
    baseUrl,
    auth,
    headerName,
    key,
    enabled: input.enabled === undefined ? existing?.enabled !== false : Boolean(input.enabled),
    createdAt: existing?.createdAt || now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

function listApis(config) {
  return Array.isArray(config?.apis) ? config.apis.filter((api) => api && api.id && api.name && api.baseUrl) : [];
}

function findApi(config, idOrName) {
  const wanted = String(idOrName || '').trim().toLowerCase();
  if (!wanted) return null;
  return listApis(config).find((api) => api.id === idOrName || api.name.toLowerCase() === wanted) || null;
}

/** Public metadata only: a key is never sent to the renderer. */
function publicApis(config) {
  return listApis(config).map((api) => ({
    id: api.id,
    name: api.name,
    description: api.description || '',
    baseUrl: api.baseUrl,
    auth: api.auth || 'bearer',
    headerName: api.headerName || 'Authorization',
    hasKey: Boolean(api.key),
    keyPreview: api.key ? maskKey(api.key) : '',
    enabled: api.enabled !== false,
    createdAt: api.createdAt || '',
    updatedAt: api.updatedAt || '',
  }));
}

function buildUrl(api, pathValue, query) {
  const base = String(api.baseUrl || '').replace(/\/+$/, '');
  const suffix = String(pathValue || '').trim();
  let url;
  if (/^https?:\/\//i.test(suffix)) {
    url = new URL(suffix);
  } else {
    const clean = suffix.replace(/^\/+/, '');
    url = new URL(clean ? `${base}/${clean}` : base);
  }
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  if (api.auth === 'query' && api.key) url.searchParams.set(api.headerName || 'key', api.key);
  return url;
}

/** Request a saved connector. Never includes the secret in its return value. */
async function requestApi(api, { path: requestPath = '/', method = 'GET', query = null, headers = null, body = null, timeout = 30_000 } = {}) {
  if (!api) throw new Error('API connector not found.');
  if (api.enabled === false) throw new Error(`“${api.name}” is disabled.`);
  const verb = String(method || 'GET').toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(verb)) throw new Error('Unsupported HTTP method.');
  const url = buildUrl(api, requestPath, query);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http(s) endpoints are supported.');
  if (url.hostname === '169.254.169.254') throw new Error('Blocked cloud metadata address.');

  const outgoing = {};
  for (const [key, value] of Object.entries(headers || {})) {
    const safe = String(key || '').trim();
    if (!safe || /^(host|content-length|cookie|connection)$/i.test(safe)) continue;
    if (value === undefined || value === null) continue;
    outgoing[safe] = String(value);
  }
  if (api.auth === 'bearer' && api.key && !outgoing.Authorization) outgoing.Authorization = `Bearer ${api.key}`;
  if (api.auth === 'header' && api.key) outgoing[api.headerName || 'X-API-Key'] = api.key;

  let payload;
  if (body !== undefined && body !== null && verb !== 'GET' && verb !== 'HEAD') {
    if (typeof body === 'string') {
      payload = body;
      if (!Object.keys(outgoing).some((key) => key.toLowerCase() === 'content-type')) outgoing['Content-Type'] = 'text/plain; charset=utf-8';
    } else {
      payload = JSON.stringify(body);
      if (!Object.keys(outgoing).some((key) => key.toLowerCase() === 'content-type')) outgoing['Content-Type'] = 'application/json';
    }
  }

  const started = Date.now();
  const response = await fetch(url, {
    method: verb,
    headers: outgoing,
    body: payload,
    redirect: 'follow',
    signal: AbortSignal.timeout(Math.max(2_000, Math.min(120_000, Number(timeout) || 30_000))),
  });
  const contentType = response.headers.get('content-type') || '';
  const raw = await response.text();
  const truncated = raw.length > MAX_BODY;
  const text = truncated ? raw.slice(0, MAX_BODY) : raw;
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    contentType,
    body: text,
    truncated,
    durationMs: Date.now() - started,
    method: verb,
    api: api.name,
    path: String(requestPath || '/'),
  };
}

module.exports = {
  AUTH_KINDS,
  sanitizeApi,
  listApis,
  findApi,
  publicApis,
  buildUrl,
  requestApi,
  isHttpUrl,
  MAX_BODY,
};
