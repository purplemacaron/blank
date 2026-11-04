'use strict';

/**
 * OAuth 2.1 helpers for remote MCP servers. Tokens live in ~/.blank/oauth.json
 * with user-only permissions and never appear in logs or the interface.
 */

const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { appPaths, readJSON, writeJSON } = require('./paths');

const pendingFlows = new Map();

function tokenFile() {
  return appPaths().oauth;
}

function loadTokens() {
  const raw = readJSON(tokenFile(), { tokens: {} });
  return raw && typeof raw.tokens === 'object' && raw.tokens ? raw.tokens : {};
}

function saveTokens(tokens) {
  const file = tokenFile();
  writeJSON(file, { tokens });
  try { fs.chmodSync(file, 0o600); } catch {}
}

function tokenKey(kind, id) {
  return `${kind}:${id}`;
}

function getEntry(kind, id) {
  return loadTokens()[tokenKey(kind, id)] || null;
}

function setEntry(kind, id, entry) {
  const tokens = loadTokens();
  tokens[tokenKey(kind, id)] = entry;
  saveTokens(tokens);
  return entry;
}

function removeEntry(kind, id) {
  const tokens = loadTokens();
  const key = tokenKey(kind, id);
  if (!(key in tokens)) return false;
  delete tokens[key];
  saveTokens(tokens);
  return true;
}

function status(kind, id) {
  const entry = getEntry(kind, id);
  if (!entry || !entry.accessToken) return { signedIn: false, expiresAt: '', scope: '' };
  return {
    signedIn: true,
    expiresAt: entry.expiresAt || '',
    scope: entry.scope || '',
    account: entry.account || '',
    expired: Boolean(entry.expiresAt && new Date(entry.expiresAt).getTime() <= Date.now()),
  };
}

function base64url(buffer) {
  return Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pkce() {
  const verifier = base64url(crypto.randomBytes(48));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

async function fetchJson(url, options = {}, timeout = 15000) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeout) });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const error = new Error(`${response.status} ${response.statusText}${text ? ` · ${text.slice(0, 240)}` : ''}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function wellKnown(baseUrl, suffix) {
  let url;
  try { url = new URL(baseUrl); } catch { return []; }
  const path = url.pathname.replace(/\/+$/, '');
  return [
    `${url.origin}/.well-known/${suffix}${path}`,
    `${url.origin}/.well-known/${suffix}`,
  ];
}

async function firstJson(urls, options) {
  const errors = [];
  for (const url of urls) {
    try {
      const data = await fetchJson(url, options);
      if (data && typeof data === 'object') return { data, url };
    } catch (err) {
      errors.push(`${url}: ${err.message}`);
    }
  }
  const error = new Error(errors[0] || 'No metadata found.');
  error.attempts = errors;
  throw error;
}

async function discoverAuthServer(server) {
  const resourceUrl = server.url;
  let resourceMetadata = null;
  if (server.oauthResourceMetadataUrl) {
    resourceMetadata = await fetchJson(server.oauthResourceMetadataUrl).catch(() => null);
  } else {
    const found = await firstJson(wellKnown(resourceUrl, 'oauth-protected-resource')).catch(() => null);
    resourceMetadata = found?.data || null;
  }
  const issuer = resourceMetadata?.authorization_servers?.[0] || new URL(resourceUrl).origin;
  const resource = resourceMetadata?.resource || resourceUrl;
  let metadata = null;
  const candidates = [
    ...wellKnown(issuer, 'oauth-authorization-server'),
    ...wellKnown(issuer, 'openid-configuration'),
  ];
  const found = await firstJson(candidates).catch(() => null);
  metadata = found?.data || null;
  if (!metadata?.authorization_endpoint || !metadata?.token_endpoint) {
    metadata = {
      ...(metadata || {}),
      issuer,
      authorization_endpoint: metadata?.authorization_endpoint || `${issuer.replace(/\/$/, '')}/authorize`,
      token_endpoint: metadata?.token_endpoint || `${issuer.replace(/\/$/, '')}/token`,
      registration_endpoint: metadata?.registration_endpoint || `${issuer.replace(/\/$/, '')}/register`,
    };
  }
  return { issuer, resource, metadata, resourceMetadata };
}

function startCallbackServer({ port = 0, path = '/callback', advertisedHost = '127.0.0.1', timeoutMs = 300000 } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    let resolveWait;
    const wait = new Promise((res) => { resolveWait = res; });
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      setTimeout(() => { try { server.close(); } catch {} }, 60);
      resolveWait(value);
    };
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (url.pathname !== path && url.pathname !== '/callback' && url.pathname !== '/oauth/callback' && url.pathname !== '/auth/callback') {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('Not found');
        return;
      }
      const params = Object.fromEntries(url.searchParams.entries());
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><meta charset="utf-8"><title>Blank</title><style>body{font:14px ui-sans-serif,system-ui;display:grid;place-items:center;height:100vh;margin:0;color:#101828;background:#fff}div{text-align:center}p{color:#667085}</style><div><h2>Blank is connected.</h2><p>You can close this tab and return to the app.</p></div><script>setTimeout(function(){window.close()},900)</script>');
      finish(params);
    });
    server.on('error', (err) => {
      if (timer) clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const redirectUri = `http://${advertisedHost}:${address.port}${path}`;
      timer = setTimeout(() => finish({ error: 'timeout', error_description: 'The sign-in window timed out.' }), timeoutMs);
      resolve({
        redirectUri,
        wait,
        cancel: () => finish({ error: 'cancelled', error_description: 'Sign-in cancelled.' }),
      });
    });
  });
}

async function registerClient(metadata, redirectUri, server) {
  const method = metadata.token_endpoint_auth_methods_supported;
  const authMethod = Array.isArray(method) && method.includes('client_secret_post') ? 'client_secret_post' : 'none';
  const body = {
    client_name: 'Blank',
    application_type: 'native',
    redirect_uris: [redirectUri],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: authMethod,
    scope: metadata.scopes_supported?.join?.(' ') || 'openid profile email offline_access',
  };
  if (server.oauthClientId) {
    return { clientId: server.oauthClientId, clientSecret: '', authMethod: 'none' };
  }
  if (!metadata.registration_endpoint) throw new Error('The authorization server does not support dynamic client registration. Add a client ID in the server settings.');
  const data = await fetchJson(metadata.registration_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  }, 20000);
  if (!data.client_id) throw new Error('Dynamic client registration returned no client ID.');
  return {
    clientId: data.client_id,
    clientSecret: data.client_secret || '',
    authMethod: data.token_endpoint_auth_method || authMethod,
  };
}

function tokenRequestBody(entry, extra = {}) {
  const body = new URLSearchParams({ ...extra });
  body.set('client_id', entry.clientId);
  if (entry.clientSecret && entry.authMethod !== 'basic') body.set('client_secret', entry.clientSecret);
  return body;
}

async function exchangeCode({ entry, code, redirectUri, verifier }) {
  const body = tokenRequestBody(entry, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
  if (entry.resource) body.set('resource', entry.resource);
  const headers = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' };
  if (entry.clientSecret && entry.authMethod === 'basic') {
    headers.authorization = `Basic ${Buffer.from(`${entry.clientId}:${entry.clientSecret}`).toString('base64')}`;
  }
  return fetchJson(entry.tokenEndpoint, { method: 'POST', headers, body: body.toString() }, 20000);
}

function entryFromTokens(data, base) {
  const expiresIn = Number(data.expires_in);
  return {
    ...base,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || base.refreshToken || '',
    tokenType: data.token_type || 'Bearer',
    scope: data.scope || base.scope || '',
    expiresAt: expiresIn ? new Date(Date.now() + Math.max(30, expiresIn - 30) * 1000).toISOString() : '',
    updatedAt: new Date().toISOString(),
  };
}

async function refreshEntry(kind, id, entry) {
  if (!entry.refreshToken || !entry.tokenEndpoint) throw new Error('Sign in again. The refresh token is missing.');
  const body = tokenRequestBody(entry, { grant_type: 'refresh_token', refresh_token: entry.refreshToken });
  if (entry.resource) body.set('resource', entry.resource);
  const headers = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' };
  if (entry.clientSecret && entry.authMethod === 'basic') {
    headers.authorization = `Basic ${Buffer.from(`${entry.clientId}:${entry.clientSecret}`).toString('base64')}`;
  }
  const data = await fetchJson(entry.tokenEndpoint, { method: 'POST', headers, body: body.toString() }, 20000);
  if (!data.access_token) throw new Error('The token endpoint returned no access token.');
  const next = entryFromTokens(data, entry);
  setEntry(kind, id, next);
  return next;
}

async function accessToken(kind, id, { force = false } = {}) {
  const entry = getEntry(kind, id);
  if (!entry?.accessToken) return '';
  const expires = entry.expiresAt ? new Date(entry.expiresAt).getTime() : 0;
  if (!force && (!expires || expires > Date.now() + 5000)) return entry.accessToken;
  if (!entry.refreshToken) return expires && expires <= Date.now() ? '' : entry.accessToken;
  try {
    const next = await refreshEntry(kind, id, entry);
    return next.accessToken;
  } catch {
    return '';
  }
}

async function authorizeMcpServer({ server, openExternal, onEvent = () => {} }) {
  if (!server?.url) throw new Error('Only remote HTTP MCP servers can use OAuth.');
  if (pendingFlows.has(server.id)) throw new Error('A sign-in is already open for this server.');
  const flow = { cancelled: false };
  pendingFlows.set(server.id, flow);
  try {
    onEvent({ status: 'starting', text: 'Discovering the authorization server…' });
    const discovered = await discoverAuthServer(server);
    const { metadata, resource, issuer } = discovered;
    onEvent({ status: 'starting', text: 'Opening the browser…' });

    const callback = await startCallbackServer();
    const { redirectUri } = callback;
    const client = await registerClient(metadata, redirectUri, server);
    if (flow.cancelled) throw new Error('Sign-in cancelled.');
    const { verifier, challenge } = pkce();
    const state = base64url(crypto.randomBytes(24));
    const scope = metadata.scopes_supported?.join?.(' ') || 'openid profile email offline_access';

    const authorizeUrl = new URL(metadata.authorization_endpoint);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', client.clientId);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('scope', scope);
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('code_challenge', challenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');
    if (resource) authorizeUrl.searchParams.set('resource', resource);

    if (openExternal) await openExternal(authorizeUrl.toString());
    onEvent({ status: 'authorizing', text: 'Finish signing in in your browser.', url: authorizeUrl.toString() });

    flow.cancel = () => callback.cancel?.();
    const params = await callback.wait;
    if (params.error) throw new Error(params.error_description || params.error);
    if (!params.code) throw new Error('The authorization server returned no code.');
    if (params.state && params.state !== state) throw new Error('The sign-in state did not match.');

    onEvent({ status: 'exchanging', text: 'Exchanging the authorization code…' });
    const tokenData = await exchangeCode({
      entry: {
        clientId: client.clientId,
        clientSecret: client.clientSecret,
        authMethod: client.authMethod,
        tokenEndpoint: metadata.token_endpoint,
        resource,
      },
      code: params.code,
      redirectUri,
      verifier,
    });
    if (!tokenData.access_token) throw new Error('The token endpoint returned no access token.');
    const entry = entryFromTokens(tokenData, {
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      authMethod: client.authMethod,
      tokenEndpoint: metadata.token_endpoint,
      issuer,
      resource,
      serverUrl: server.url,
    });
    setEntry('mcp', server.id, entry);
    onEvent({ status: 'done', text: 'Signed in.' });
    return status('mcp', server.id);
  } finally {
    pendingFlows.delete(server.id);
  }
}

function cancelFlow(serverId) {
  const flow = pendingFlows.get(serverId);
  if (flow?.cancel) {
    try { flow.cancel(); } catch {}
  }
  pendingFlows.delete(serverId);
}

function closeAll() {
  for (const flow of pendingFlows.values()) {
    try { flow.cancel?.(); } catch {}
  }
  pendingFlows.clear();
}

module.exports = {
  accessToken,
  authorizeMcpServer,
  cancelFlow,
  closeAll,
  entryFromTokens,
  fetchJson,
  getEntry,
  pkce,
  registerClient,
  removeEntry,
  setEntry,
  startCallbackServer,
  status,
};
