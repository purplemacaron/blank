'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

const api = {
  isElectron: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },

  onEvent(callback) {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('blank:event', handler);
    return () => ipcRenderer.removeListener('blank:event', handler);
  },

  app: {
    info: () => invoke('app:info'),
    openExternal: (url) => invoke('app:openExternal', url),
    openDataFolder: () => invoke('config:openDataFolder'),
  },

  config: {
    get: () => invoke('config:get'),
    update: (patch) => invoke('config:update', patch),
  },

  models: {
    list: () => invoke('models:list'),
    setKey: (input) => invoke('providers:setKey', input),
    addKey: (input) => invoke('providers:addKey', input),
    removeKey: (input) => invoke('providers:removeKey', input),
    setActiveKey: (input) => invoke('providers:setActiveKey', input),
    setAutoRotate: (input) => invoke('providers:setAutoRotate', input),
    probe: (input) => invoke('providers:probe', input),
    test: (input) => invoke('providers:test', input),
    discover: (providerId) => invoke('providers:discover', { providerId }),
    addCustom: (input) => invoke('providers:addCustom', input),
    removeCustom: (providerId) => invoke('providers:removeCustom', providerId),
  },

  sessions: {
    list: () => invoke('sessions:list'),
    get: (id) => invoke('sessions:get', id),
    create: (input) => invoke('sessions:create', input),
    update: (input) => invoke('sessions:update', input),
    delete: (id) => invoke('sessions:delete', id),
    compact: (id) => invoke('sessions:compact', id),
  },

  chat: {
    send: (input) => invoke('chat:send', input),
    stop: (sessionId) => invoke('chat:stop', sessionId),
    approve: (input) => invoke('chat:approve', input),
    queue: (sessionId) => invoke('chat:queue', sessionId),
    removeQueued: (input) => invoke('chat:queue:remove', input),
    openWorkspace: () => invoke('chat:openWorkspace'),
  },

  remote: {
    status: () => invoke('remote:status'),
    start: (input) => invoke('remote:start', input),
    stop: () => invoke('remote:stop'),
    configure: (input) => invoke('remote:configure', input),
  },

  search: {
    test: (input) => invoke('search:test', input),
    setKey: (input) => invoke('search:setKey', input),
  },

  computer: {
    testScreenshot: () => invoke('computer:testScreenshot'),
  },

  workspace: {
    choose: () => invoke('workspace:choose'),
    tree: () => invoke('workspace:tree'),
    read: (relativePath) => invoke('workspace:read', relativePath),
    openPath: (relativePath) => invoke('workspace:openPath', relativePath),
    reveal: (relativePath) => invoke('workspace:reveal', relativePath),
    openEditor: () => invoke('workspace:openEditor'),
    writeAgents: (input) => invoke('workspace:writeAgents', input || {}),
  },

  plugins: {
    list: () => invoke('plugins:list'),
    install: (input) => invoke('plugins:install', input),
    remove: (id) => invoke('plugins:remove', id),
  },

  mcp: {
    list: () => invoke('mcp:list'),
    refresh: () => invoke('mcp:refresh'),
    add: (input) => invoke('mcp:add', input),
    addExample: () => invoke('mcp:addExample'),
    remove: (id) => invoke('mcp:remove', id),
    toggle: (input) => invoke('mcp:toggle', input),
  },

  skills: {
    list: () => invoke('skills:list'),
    get: (id) => invoke('skills:get', id),
    create: (input) => invoke('skills:create', input),
    remove: (id) => invoke('skills:delete', id),
    toggle: (input) => invoke('skills:toggle', input),
    openFolder: () => invoke('skills:openFolder'),
  },

  memory: {
    list: () => invoke('memory:list'),
    add: (input) => invoke('memory:add', input),
    update: (input) => invoke('memory:update', input),
    remove: (id) => invoke('memory:delete', id),
    search: (query) => invoke('memory:search', query),
  },

  learn: {
    state: () => invoke('learn:state'),
    reflect: () => invoke('learn:reflect'),
    apply: (id) => invoke('learn:apply', id),
    dismiss: (id) => invoke('learn:dismiss', id),
  },

  media: {
    list: (options) => invoke('media:list', options),
    get: (id) => invoke('media:get', id),
    jobs: () => invoke('media:jobs'),
    job: (id) => invoke('media:job', id),
    engines: () => invoke('media:engines'),
    storage: () => invoke('media:storage'),
    generate: (input) => invoke('media:generate', input),
    edit: (input) => invoke('media:edit', input),
    cancel: (id) => invoke('media:cancel', id),
    remove: (id) => invoke('media:remove', id),
    favorite: (id) => invoke('media:favorite', id),
    importFiles: () => invoke('media:import'),
    importData: (input) => invoke('media:importData', input),
    exportAsset: (id) => invoke('media:export', id),
    saveToWorkspace: (input) => invoke('media:saveToWorkspace', input),
    reveal: (id) => invoke('media:reveal', id),
    open: (id) => invoke('media:open', id),
    readText: (id) => invoke('media:readText', id),
    setKey: (input) => invoke('media:setKey', input),
    setDefaults: (input) => invoke('media:setDefaults', input),
  },

  checkpoint: {
    revert: (id) => invoke('checkpoints:revert', id),
  },

  cli: {
    install: () => invoke('cli:install'),
  },

  window: {
    minimize: () => invoke('window:minimize'),
    maximize: () => invoke('window:maximize'),
    close: () => invoke('window:close'),
    state: () => invoke('window:state'),
  },
};

contextBridge.exposeInMainWorld('blank', api);
