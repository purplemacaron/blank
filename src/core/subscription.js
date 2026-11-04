'use strict';

/**
 * Subscription sign-in for Claude and ChatGPT. Tokens are stored in the same
 * user-only vault as MCP OAuth tokens. These flows are unofficial and can stop
 * working when a provider changes its login; API keys always remain available.
 */

const oauth = require('./oauth');

const PRESETS = {
  anthropic: {
    mode: 'claude',
    flow: 'paste',
    clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
    authorize: 'https://claude.ai/oauth/authorize',
    token: 'https://console.anthropic.com/v1/oauth/token',
    redirectUri: 'https://console.anthropic.com/oauth/code/callback',
    scope: 'user:profile user:inference org:create_api_key',
  },
  openai: {
    mode: 'chatgpt',
    flow: 'loopback',
    clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
    authorize: 'https://auth.openai.com/oauth/authorize',
    token: 'https://auth.openai.com/oauth/token',
    redirectUri: 'http://localhost:1455/auth/callback',
    scope: 'openid profile email offline_access',
    port: 1455,
    callbackPath: '/auth/callback',
    apiBase: 'https://chatgpt.com/backend-api/codex',
  },
};

const pending = new Map();

function preset(providerId) {
  return PRESETS[providerId] || null;
}

function status(providerId) {
  const entry = oauth.getEntry('provider', providerId);
  const base = oauth.status('provider', providerId);
  return {
    ...base,
    mode: entry?.mode || '',
    email: entry?.email || '',
    accountId: entry?.accountId || '',
    plan: entry?.plan || '',
    experimental: true,
  };
}

function statusAll() {
  return {
    anthropic: status('anthropic'),
    openai: status('openai'),
  };
}

function decodeClaims(token) {
  if (!token || typeof token !== 'string') return {};
  const part = token.split('.')[1];
  if (!part) return {};
  try { return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')); } catch { return {}; }
}

function accountFromTokens(data) {
  const idClaims = decodeClaims(data.id_token);
  const accessClaims = decodeClaims(data.access_token);
  const auth = idClaims['https://api.openai.com/auth'] || accessClaims['https://api.openai.com/auth'] || {};
  const profile = idClaims['https://api.openai.com/profile'] || {};
  return {
    accountId: auth.chatgpt_account_id || auth.organization_id || '',
    plan: auth.chatgpt_plan_type || '',
    email: idClaims.email || profile.email || accessClaims.email || '',
  };
}

async function postToken(url, payload, mode) {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(payload)) if (value !== undefined && value !== null) form.set(key, String(value));
  try {
    return await oauth.fetchJson(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: form.toString(),
    }, 20000);
  } catch (err) {
    if (mode !== 'claude') throw err;
    return oauth.fetchJson(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
    }, 20000);
  }
}

async function claudeStart(openExternal) {
  const config = preset('anthropic');
  const { verifier, challenge } = oauth.pkce();
  const state = Buffer.from(require('crypto').randomBytes(24)).toString('base64url');
  const url = new URL(config.authorize);
  url.searchParams.set('code', 'true');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', config.scope);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  pending.set('anthropic', { verifier, state, at: Date.now() });
  if (openExternal) await openExternal(url.toString());
  return { url: url.toString(), needsCode: true };
}

async function claudeComplete(input = {}) {
  const config = preset('anthropic');
  const flow = pending.get('anthropic');
  if (!flow) throw new Error('Start the Claude sign-in first.');
  const raw = String(input.code || '').trim();
  if (!raw) throw new Error('Paste the code shown after authorizing.');
  const [code, stateFromCode] = raw.split('#');
  if (stateFromCode && stateFromCode !== flow.state) throw new Error('The pasted code does not match this sign-in. Try again.');
  const data = await postToken(config.token, {
    grant_type: 'authorization_code',
    code,
    state: flow.state,
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    code_verifier: flow.verifier,
  }, 'claude');
  if (!data.access_token) throw new Error('Anthropic returned no access token.');
  const expiresIn = Number(data.expires_in);
  const entry = oauth.entryFromTokens(data, {
    mode: 'claude',
    providerId: 'anthropic',
    clientId: config.clientId,
    tokenEndpoint: config.token,
    redirectUri: config.redirectUri,
    scope: data.scope || config.scope,
    accountId: data.account?.uuid || data.organization?.uuid || '',
    plan: data.account?.plan || '',
    email: data.account?.email_address || '',
  });
  entry.expiresAt = expiresIn ? new Date(Date.now() + Math.max(30, expiresIn - 30) * 1000).toISOString() : '';
  oauth.setEntry('provider', 'anthropic', entry);
  pending.delete('anthropic');
  return status('anthropic');
}

async function chatgptStart(openExternal) {
  const config = preset('openai');
  const { verifier, challenge } = oauth.pkce();
  const state = Buffer.from(require('crypto').randomBytes(24)).toString('base64url');
  const callback = await oauth.startCallbackServer({ port: config.port, advertisedHost: 'localhost', path: config.callbackPath });
  const url = new URL(config.authorize);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', callback.redirectUri);
  url.searchParams.set('scope', config.scope);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  url.searchParams.set('id_token_add_organizations', 'true');
  url.searchParams.set('codex_cli_simplified_flow', 'true');
  pending.set('openai', { verifier, state, at: Date.now(), cancel: callback.cancel });
  if (openExternal) await openExternal(url.toString());
  const params = await callback.wait;
  pending.delete('openai');
  if (params.error) throw new Error(params.error_description || params.error);
  if (!params.code) throw new Error('OpenAI returned no authorization code.');
  if (params.state && params.state !== state) throw new Error('The sign-in state did not match.');
  const data = await postToken(config.token, {
    grant_type: 'authorization_code',
    code: params.code,
    client_id: config.clientId,
    redirect_uri: callback.redirectUri,
    code_verifier: verifier,
  }, 'chatgpt');
  if (!data.access_token) throw new Error('OpenAI returned no access token.');
  const account = accountFromTokens(data);
  const entry = oauth.entryFromTokens(data, {
    mode: 'chatgpt',
    providerId: 'openai',
    clientId: config.clientId,
    tokenEndpoint: config.token,
    scope: config.scope,
    ...account,
  });
  oauth.setEntry('provider', 'openai', entry);
  return status('openai');
}

async function start(providerId, openExternal) {
  if (providerId === 'anthropic') return claudeStart(openExternal);
  if (providerId === 'openai') return chatgptStart(openExternal);
  throw new Error('This provider has no subscription sign-in.');
}

async function complete(providerId, input) {
  if (providerId === 'anthropic') return claudeComplete(input);
  throw new Error('This sign-in finishes in the browser.');
}

async function tokenFor(providerId) {
  const entry = oauth.getEntry('provider', providerId);
  if (!entry || !entry.mode) return '';
  return oauth.accessToken('provider', providerId);
}

function entryFor(providerId) {
  return oauth.getEntry('provider', providerId);
}

async function signOut(providerId) {
  const flow = pending.get(providerId);
  if (flow?.cancel) {
    try { flow.cancel(); } catch {}
  }
  pending.delete(providerId);
  return oauth.removeEntry('provider', providerId);
}

function subscribeHeaders(providerId) {
  const entry = entryFor(providerId);
  if (!entry) return {};
  const headers = { authorization: `Bearer ${entry.accessToken}` };
  if (entry.mode === 'claude') {
    headers['anthropic-beta'] = 'oauth-2025-04-20';
  }
  if (entry.mode === 'chatgpt') {
    if (entry.accountId) headers['chatgpt-account-id'] = entry.accountId;
    headers['OpenAI-Beta'] = 'responses=experimental';
    headers.originator = 'codex_cli_rs';
    headers['openai-alpha'] = 'quicksilver=v2';
    headers.intent = 'quicksilver&architecture=avas';
    headers['x-session-id'] = `blank_${Date.now().toString(36)}`;
  }
  return headers;
}

function codexBase() {
  return PRESETS.openai.apiBase;
}

module.exports = {
  chatgptStart,
  claudeComplete,
  claudeStart,
  codexBase,
  complete,
  entryFor,
  preset,
  signOut,
  start,
  status,
  statusAll,
  subscribeHeaders,
  tokenFor,
};
