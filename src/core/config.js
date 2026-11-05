'use strict';

const fs = require('fs');
const { appPaths, ensureHome, readJSON, writeJSON, uid } = require('./paths');

const DEFAULTS = {
  version: 1,
  defaultModel: '',
  fallbackModel: '',
  workspace: '',
  theme: 'light',
  language: 'ko',
  onboarded: false,
  providers: {},
  customProviders: [],
  discoveredModels: {},
  permissions: {
    read_file: 'allow',
    list_dir: 'allow',
    glob: 'allow',
    grep: 'allow',
    web_fetch: 'allow',
    todo_write: 'allow',
    memory_search: 'allow',
    remember: 'allow',
    read_skill: 'allow',
    delegate: 'allow',
    web_search: 'allow',
    list_media: 'allow',
    generate_media: 'ask',
    edit_media: 'ask',
    create_paper: 'allow',
    update_paper: 'allow',
    read_paper: 'allow',
    list_papers: 'allow',
    computer_screenshot: 'ask',
    computer_use: 'ask',
    write_file: 'ask',
    edit_file: 'ask',
    deliver_file: 'allow',
    run_command: 'ask',
    ssh_run: 'ask',
    team_delegate: 'allow',
    api_request: 'ask',
    mcp: 'ask',
  },
  approvals: {
    mode: 'important',
  },
  dictation: {
    providerId: '',
    model: '',
    language: '',
    baseUrl: '',
    key: '',
  },
  agent: {
    maxSteps: 32,
    temperature: null,
    autoCompact: true,
    compactAt: 0.82,
    autoMemory: true,
    autoReflect: false,
    showReasoning: true,
    reasoningEffort: 'auto',
  },
  customInstructions: '',
  mcpServers: [],
  disabledSkills: [],
  ui: {
    railOpen: true,
    sidebarOpen: true,
    density: 'comfy',
  },
  media: {
    keys: {},
    endpoints: { comfyui: '', openaiCompatible: '' },
    openaiModels: { image: [], video: [] },
    defaults: {
      image: { engine: '', aspect: '1:1' },
      video: { engine: '', aspect: '16:9', duration: 4 },
      audio: { engine: 'system-voice', duration: 20 },
      model3d: { engine: '' },
    },
  },
  search: {
    provider: 'duckduckgo',
    keys: {},
    baseUrl: '',
    maxResults: 6,
  },
  computer: {
    showCursor: true,
  },
  remote: {
    port: 8787,
    allowLan: false,
    allowApprovals: false,
    autoStart: false,
  },
  notifications: {
    enabled: true,
    onFinish: true,
    onApproval: true,
    schedules: true,
  },
  ssh: {
    hosts: [],
  },
  apis: [],
  team: {
    enabled: false,
    members: [
      { id: 'scout', name: 'Scout', role: 'Map the codebase, gather evidence and return concrete file:line references, constraints and unknowns.', model: '', enabled: true, write: false },
      { id: 'architect', name: 'Architect', role: 'Propose the smallest robust design. Name interfaces, tradeoffs, migration steps and risks.', model: '', enabled: true, write: false },
      { id: 'critic', name: 'Critic', role: 'Find correctness, security, regression and missing-test risks. Be specific and skeptical.', model: '', enabled: true, write: false },
    ],
  },
};

function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch === undefined ? base : patch;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && base && typeof base[key] === 'object' && !Array.isArray(base[key])) {
      out[key] = deepMerge(base[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function loadConfig() {
  ensureHome();
  const file = appPaths().config;
  let raw = readJSON(file, null);
  if (!raw || typeof raw !== 'object') {
    raw = {};
    writeJSON(file, DEFAULTS);
  }
  const config = deepMerge(DEFAULTS, raw);
  const keysMigrated = normalizeProviderKeys(config);
  const mediaMigrated = normalizeMediaDefaults(config);
  const modelsMigrated = normalizeModelDefaults(config);
  if (!fs.existsSync(file) || keysMigrated || mediaMigrated || modelsMigrated) writeJSON(file, config);
  return config;
}

function saveConfig(config) {
  ensureHome();
  writeJSON(appPaths().config, config);
  return config;
}

function patchConfig(patch) {
  const config = loadConfig();
  const next = deepMerge(config, patch);
  saveConfig(next);
  return next;
}

/**
 * Earlier builds shipped an offline demo model. It is retired: a missing or
 * sandbox model becomes "not configured" so the app asks for a real provider.
 */
function normalizeModelDefaults(config) {
  let changed = false;
  const retired = (value) => {
    const id = String(value || '');
    return id === 'blank-1' || id === 'sandbox' || id.startsWith('sandbox/');
  };
  if (retired(config.defaultModel)) {
    config.defaultModel = '';
    changed = true;
  }
  if (retired(config.fallbackModel)) {
    config.fallbackModel = '';
    changed = true;
  }
  return changed;
}

/**
 * Earlier builds shipped local "blank" media engines. Those ids are retired;
 * map them to no engine (or System voice for speech) and drop options that no
 * real provider accepts, so generated requests only use connected engines.
 */
function normalizeMediaDefaults(config) {
  const media = config.media && typeof config.media === 'object' ? config.media : (config.media = {});
  const defaults = media.defaults && typeof media.defaults === 'object' ? media.defaults : (media.defaults = {});
  const legacy = new Set(['blank', 'blank-image', 'blank-audio', 'blank-3d']);
  let changed = false;
  const kinds = {
    image: { aspect: true },
    video: { aspect: true, duration: true },
    audio: { duration: true, voice: true, rate: true },
    model3d: {},
  };
  for (const [kind, fields] of Object.entries(kinds)) {
    const current = defaults[kind] && typeof defaults[kind] === 'object' ? defaults[kind] : {};
    let engine = String(current.engine || '').trim();
    if (engine === 'blank-voice') engine = 'system-voice';
    else if (legacy.has(engine)) engine = '';
    if (kind === 'audio' && !engine) engine = 'system-voice';
    const next = { engine };
    if (fields.aspect) next.aspect = String(current.aspect || (kind === 'image' ? '1:1' : '16:9')).slice(0, 12);
    if (fields.duration) next.duration = Number(current.duration) > 0 ? Number(current.duration) : (kind === 'audio' ? 20 : 4);
    if (fields.voice && current.voice) next.voice = String(current.voice).slice(0, 80);
    if (fields.rate && Number.isFinite(Number(current.rate))) next.rate = Number(current.rate);
    if (JSON.stringify(defaults[kind]) !== JSON.stringify(next)) {
      defaults[kind] = next;
      changed = true;
    }
  }
  return changed;
}

/**
 * Providers can hold several credentials. The active key is tried first, then
 * the remaining saved keys (and finally the environment variable) when the
 * provider reports an authentication or rate-limit error.
 */
function normalizeProviderKeys(config) {
  let changed = false;
  if (!config.providers || typeof config.providers !== 'object') {
    config.providers = {};
    changed = true;
  }
  for (const [providerId, raw] of Object.entries(config.providers)) {
    if (!raw || typeof raw !== 'object') {
      delete config.providers[providerId];
      changed = true;
      continue;
    }
    const entry = raw;
    const before = JSON.stringify(entry);
    if (!Array.isArray(entry.keys)) entry.keys = [];
    if (entry.apiKey) {
      const legacy = String(entry.apiKey).trim();
      if (legacy && !entry.keys.some((key) => key.key === legacy)) {
        entry.keys.unshift({
          id: uid('key_'),
          label: 'Default',
          key: legacy,
          createdAt: new Date().toISOString(),
        });
      }
      delete entry.apiKey;
    }
    const seen = new Set();
    entry.keys = entry.keys
      .filter((key) => key && typeof key === 'object')
      .map((key) => {
        const value = String(key.key || '').trim().slice(0, 4096);
        let id = String(key.id || '') || uid('key_');
        if (seen.has(id)) id = uid('key_');
        seen.add(id);
        return {
          id,
          label: String(key.label || 'API key').slice(0, 60),
          key: value,
          createdAt: key.createdAt || new Date().toISOString(),
          lastUsedAt: key.lastUsedAt || '',
          lastError: String(key.lastError || '').slice(0, 300),
          lastErrorAt: key.lastErrorAt || '',
        };
      })
      .filter((key) => key.key);
    if (entry.keys.length && !entry.keys.some((key) => key.id === entry.activeKeyId)) {
      entry.activeKeyId = entry.keys[0].id;
    }
    if (!entry.keys.length) entry.activeKeyId = '';
    if (entry.autoRotate === undefined) entry.autoRotate = true;
    if (JSON.stringify(entry) !== before) changed = true;
  }
  return changed;
}

function keyCandidates(config, providerId, provider, keyId) {
  const entry = config.providers?.[providerId] || {};
  const stored = (Array.isArray(entry.keys) ? entry.keys : [])
    .filter((key) => key && typeof key.key === 'string' && key.key)
    .map((key) => ({
      id: key.id,
      label: key.label || 'API key',
      key: key.key,
      source: 'stored',
      active: key.id === entry.activeKeyId,
      createdAt: key.createdAt || '',
      lastUsedAt: key.lastUsedAt || '',
      lastError: key.lastError || '',
    }))
    .sort((a, b) => Number(b.active) - Number(a.active));
  if (keyId) {
    const chosen = stored.filter((key) => key.id === keyId);
    if (chosen.length) return chosen;
  }
  if (provider && provider.keyEnv && process.env[provider.keyEnv]) {
    stored.push({
      id: 'env',
      label: provider.keyEnv,
      key: process.env[provider.keyEnv],
      source: 'env',
      active: !stored.length,
    });
  }
  return stored;
}

function resolveKey(config, providerId, provider, keyId) {
  return keyCandidates(config, providerId, provider, keyId)[0]?.key || '';
}

function setProvider(config, providerId, patch) {
  config.providers = config.providers || {};
  config.providers[providerId] = { ...(config.providers[providerId] || {}), ...patch };
  return config.providers[providerId];
}

function addProviderKey(config, providerId, { key, label, makeActive = true } = {}) {
  const value = String(key || '').trim().slice(0, 4096);
  if (!value) throw new Error('API key is empty.');
  const entry = config.providers?.[providerId] || {};
  if (!Array.isArray(entry.keys)) entry.keys = [];
  const duplicate = entry.keys.find((item) => item.key === value);
  if (duplicate) {
    if (makeActive) entry.activeKeyId = duplicate.id;
    config.providers[providerId] = entry;
    return duplicate;
  }
  const item = {
    id: uid('key_'),
    label: String(label || `Key ${entry.keys.length + 1}`).slice(0, 60),
    key: value,
    createdAt: new Date().toISOString(),
    lastUsedAt: '',
    lastError: '',
    lastErrorAt: '',
  };
  entry.keys.push(item);
  if (makeActive || !entry.activeKeyId) entry.activeKeyId = item.id;
  if (entry.autoRotate === undefined) entry.autoRotate = true;
  config.providers[providerId] = entry;
  return item;
}

function removeProviderKey(config, providerId, keyId) {
  const entry = config.providers?.[providerId];
  if (!entry || !Array.isArray(entry.keys)) return false;
  const before = entry.keys.length;
  entry.keys = entry.keys.filter((key) => key.id !== keyId);
  if (entry.activeKeyId === keyId) entry.activeKeyId = entry.keys[0]?.id || '';
  return entry.keys.length !== before;
}

function setActiveProviderKey(config, providerId, keyId) {
  const entry = config.providers?.[providerId];
  if (!entry || !Array.isArray(entry.keys)) throw new Error('No saved keys for this provider.');
  if (!entry.keys.some((key) => key.id === keyId)) throw new Error('Key not found.');
  entry.activeKeyId = keyId;
  return entry.keys.find((key) => key.id === keyId);
}

const keyUsageWrites = new Map();
function noteKeyUsage(providerId, keyId, { ok = false, error = '' } = {}) {
  if (!providerId || !keyId || keyId === 'env') return;
  const bucket = `${providerId}:${keyId}:${ok ? 'ok' : 'err'}`;
  const now = Date.now();
  if (keyUsageWrites.has(bucket) && now - keyUsageWrites.get(bucket) < 5000) return;
  keyUsageWrites.set(bucket, now);
  try {
    const config = loadConfig();
    const entry = config.providers?.[providerId];
    const key = entry?.keys?.find((item) => item.id === keyId);
    if (!key) return;
    if (ok) {
      key.lastUsedAt = new Date().toISOString();
      key.lastError = '';
      key.lastErrorAt = '';
    } else {
      key.lastError = String(error || 'Request failed').slice(0, 300);
      key.lastErrorAt = new Date().toISOString();
    }
    saveConfig(config);
  } catch {}
}

function maskKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

function publicConfig(config, catalog) {
  const mediaKeys = Object.keys(config.media?.keys || {}).filter((id) => config.media.keys[id]);
  const media = {
    defaults: config.media?.defaults || {},
    keyIds: mediaKeys,
    hasKey: Object.fromEntries(mediaKeys.map((id) => [id, true])),
  };
  const providers = {};
  for (const provider of catalog.allProviders(config)) {
    const stored = config.providers?.[provider.id] || {};
    const candidates = keyCandidates(config, provider.id, provider);
    const active = candidates.find((key) => key.source === 'stored' && key.active) || candidates[0] || null;
    providers[provider.id] = {
      baseUrl: stored.baseUrl || '',
      hasKey: candidates.length > 0,
      keyPreview: active ? maskKey(active.key) : '',
      keySource: active?.source || null,
      activeKeyId: active?.id || '',
      keyCount: candidates.length,
      autoRotate: stored.autoRotate !== false,
      keys: candidates.map((key) => ({
        id: key.id,
        label: key.label,
        preview: maskKey(key.key),
        active: key.id === active?.id,
        source: key.source,
        removable: key.source === 'stored',
        createdAt: key.createdAt || '',
        lastUsedAt: key.lastUsedAt || '',
        lastError: key.lastError || '',
      })),
      connected: Boolean(candidates.length) || provider.kind === 'local',
    };
  }
  const searchKeys = Object.keys(config.search?.keys || {}).filter((id) => config.search.keys[id]);
  const search = {
    provider: config.search?.provider || 'duckduckgo',
    baseUrl: config.search?.baseUrl || '',
    maxResults: Number(config.search?.maxResults) || 6,
    hasKey: Object.fromEntries(searchKeys.map((id) => [id, true])),
    keyIds: searchKeys,
  };
  const sshHosts = (config.ssh?.hosts || []).map(({ password, passphrase, ...rest }) => ({
    ...rest,
    passwordSet: Boolean(password),
    passphraseSet: Boolean(passphrase),
  }));
  const team = {
    enabled: Boolean(config.team?.enabled),
    members: (config.team?.members || []).map((member) => ({
      id: String(member.id || ''),
      name: String(member.name || ''),
      role: String(member.role || ''),
      model: String(member.model || ''),
      enabled: member.enabled !== false,
      write: Boolean(member.write),
    })),
  };
  return {
    version: config.version,
    defaultModel: config.defaultModel,
    fallbackModel: config.fallbackModel,
    workspace: config.workspace,
    theme: config.theme,
    language: config.language === 'en' ? 'en' : 'ko',
    onboarded: config.onboarded,
    providers,
    customProviders: config.customProviders,
    discoveredModels: config.discoveredModels,
    permissions: config.permissions,
    approvals: {
      mode: config.approvals?.mode === 'all' ? 'all' : 'important',
    },
    agent: config.agent,
    dictation: {
      providerId: config.dictation?.providerId || '',
      model: config.dictation?.model || '',
      language: config.dictation?.language || '',
      baseUrl: config.dictation?.baseUrl || '',
      hasKey: Boolean(config.dictation?.key),
    },
    customInstructions: config.customInstructions,
    mcpServers: config.mcpServers.map(({ env, headers, ...rest }) => ({
      ...rest,
      envKeys: env ? Object.keys(env) : [],
      headerKeys: headers ? Object.keys(headers) : [],
    })),
    disabledSkills: config.disabledSkills,
    ui: config.ui,
    media,
    search,
    computer: {
      showCursor: config.computer?.showCursor !== false,
    },
    remote: {
      port: Number(config.remote?.port) || 8787,
      allowLan: Boolean(config.remote?.allowLan),
      allowApprovals: Boolean(config.remote?.allowApprovals),
      autoStart: Boolean(config.remote?.autoStart),
    },
    notifications: {
      enabled: config.notifications?.enabled !== false,
      onFinish: config.notifications?.onFinish !== false,
      onApproval: config.notifications?.onApproval !== false,
      schedules: config.notifications?.schedules !== false,
    },
    ssh: {
      hosts: sshHosts,
    },
    apis: Array.isArray(config.apis) ? config.apis.map((api) => ({
      id: api.id,
      name: api.name,
      description: api.description || '',
      baseUrl: api.baseUrl,
      auth: api.auth || 'bearer',
      headerName: api.headerName || 'Authorization',
      hasKey: Boolean(api.key),
      keyPreview: api.key ? maskKey(api.key) : '',
      enabled: api.enabled !== false,
    })) : [],
    team,
  };
}

module.exports = {
  DEFAULTS, loadConfig, saveConfig, patchConfig, resolveKey, setProvider, maskKey,
  publicConfig, deepMerge, normalizeProviderKeys, normalizeMediaDefaults, normalizeModelDefaults,
  keyCandidates, addProviderKey, removeProviderKey, setActiveProviderKey, noteKeyUsage,
};
