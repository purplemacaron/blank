/* Blank application shell: boot, chrome, sessions, context rail, palette, onboarding. */
(function () {
  'use strict';

  const CHAT_EVENTS = new Set([
    'run:start', 'assistant:start', 'text', 'reasoning', 'tool:start', 'tool:end',
    'assistant:end', 'assistant:empty', 'tasks', 'usage', 'notice', 'error', 'compacted',
    'approval', 'approval:resolved', 'approval:expired', 'run:done', 'title',
    'chat:queued', 'chat:queued:sent', 'chat:queue:update',
  ]);

  const PAGE_META = {
    chat: { label: 'Chat', icon: 'message' },
    studio: { label: 'Studio', icon: 'wand' },
    paper: { label: 'Paper', icon: 'book' },
    models: { label: 'Models', icon: 'sparkles' },
    skills: { label: 'Skills', icon: 'layers' },
    memory: { label: 'Memory', icon: 'brain' },
    mcp: { label: 'MCP', icon: 'plug' },
    plugins: { label: 'Plugins', icon: 'grid' },
    learning: { label: 'Learning', icon: 'zap' },
    settings: { label: 'Settings', icon: 'settings' },
  };

  const App = {
    state: {
      ready: false,
      config: null,
      catalog: { providers: [], models: [] },
      info: null,
      sessions: [],
      workspace: '',
      tree: [],
      page: 'chat',
      currentSessionId: null,
      railTab: 'plan',
      railOpen: true,
      railOverlay: false,
      sidebarOpen: false,
      sessionSearch: '',
      sessionSearchOpen: false,
      fileQuery: '',
      expanded: new Set(),
      memory: [],
      mcpServers: [],
      windowState: { maximized: false },
    },
  };

  const state = App.state;
  const $ = (id) => document.getElementById(id);
  const qs = (selector, root) => (root || document).querySelector(selector);
  const qsa = (selector, root) => [...(root || document).querySelectorAll(selector)];

  let pendingEvents = [];
  let paletteOpen = null;
  let configTimer = null;
  let badgeTimer = null;
  let disposeEvents = null;

  /* ------------------------------------------------------------------ helpers */

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function safe(promise, fallback) {
    try { return await promise; } catch (error) {
      console.warn('[blank]', error && error.message ? error.message : error);
      return fallback;
    }
  }

  function isOverlayRail() { return window.innerWidth <= 1180; }
  function isMobileSidebar() { return window.innerWidth <= 980; }

  function resolvedTheme() {
    const theme = state.config?.theme || 'light';
    if (theme === 'system') {
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return theme === 'dark' ? 'dark' : 'light';
  }

  function currentSession() {
    return window.ChatView?.session || null;
  }

  function currentModelId() {
    return currentSession()?.model || state.config?.defaultModel || 'sandbox/blank-1';
  }

  function filePathOf(entry) {
    if (!entry) return '';
    return typeof entry === 'string' ? entry : String(entry.path || '');
  }

  function modelName(fullId) {
    return U.modelLabel(state.catalog, fullId || currentModelId());
  }

  function providerOf(fullId) {
    return U.providerOf(state.catalog, fullId || currentModelId());
  }

  function setBadge(id, value, options = {}) {
    const node = $(id);
    if (!node) return;
    const count = Number(value) || 0;
    if (!count) {
      node.textContent = '';
      node.hidden = true;
      return;
    }
    node.hidden = false;
    node.textContent = count > 999 ? '999+' : String(count);
    if (options.title) node.title = options.title;
  }

  /* ------------------------------------------------------------------- config */

  function applyTheme(theme) {
    const next = ['light', 'dark', 'system'].includes(theme) ? theme : 'light';
    if (state.config) state.config.theme = next;
    state.theme = next;
    document.documentElement.dataset.theme = resolvedTheme();
  }

  function syncLanguage(config) {
    if (!config || !Object.prototype.hasOwnProperty.call(config, 'language')) return;
    const fromConfig = config.language === 'en' ? 'en' : 'ko';
    let stored = null;
    try { stored = localStorage.getItem('blank.lang'); } catch {}
    if (stored === 'ko' || stored === 'en') {
      /* A choice made in Settings is explicit and always wins. Never let a
         stale or reset config file flip the interface back to Korean. */
      if (stored !== fromConfig) API.config.update({ language: stored }).catch(() => {});
      return;
    }
    try { localStorage.setItem('blank.lang', fromConfig); } catch {}
    if (fromConfig === 'en') location.reload();
  }

  function refreshSidebarModel() {
    const fullId = state.config?.defaultModel || 'sandbox/blank-1';
    const provider = providerOf(fullId);
    const model = U.modelOf(state.catalog, fullId);
    const mono = $('sidebar-model-mono');
    const name = $('sidebar-model-name');
    const label = $('sidebar-model-label');
    const button = $('sidebar-model');
    if (mono) {
      const logo = window.ProviderLogos?.for(provider);
      mono.classList.toggle('has-logo', Boolean(logo));
      if (logo) mono.innerHTML = logo;
      else mono.textContent = provider?.monogram || provider?.name?.slice(0, 1) || 'B';
    }
    if (name) name.textContent = model?.name || U.modelLabel(state.catalog, fullId);
    if (label) label.textContent = provider ? `Default · ${provider.name}` : 'Default model';
    if (button) button.title = `Default model · ${fullId}`;
  }

  function updateRuntimePill() {
    const label = $('runtime-label');
    const dot = $('runtime-dot');
    const pill = $('runtime-pill');
    const preview = Boolean(window.__BLANK_PREVIEW__);
    if (label) label.textContent = preview ? 'Preview' : 'Local';
    if (dot) dot.classList.toggle('off', preview);
    if (pill) {
      const info = state.info || state.config?.runtime || {};
      const parts = ['Local-first agent runtime'];
      if (info.electron) parts.push(`Electron ${info.electron}`);
      if (info.node) parts.push(`Node ${info.node}`);
      pill.title = parts.join(' · ');
    }
    const version = $('sidebar-version');
    if (version) version.textContent = 'Blank';
    const tag = $('preview-tag');
    if (tag) tag.hidden = !preview;
  }

  function setConfig(config, options = {}) {
    if (!config || typeof config !== 'object') return;
    state.config = { ...(state.config || {}), ...config };
    if (config.runtime) state.info = { ...(state.info || {}), ...config.runtime };
    syncLanguage(config);
    applyTheme(state.config.theme);
    refreshSidebarModel();
    updateRuntimePill();
    updateWorkspaceChrome();
    if (window.ChatView?.onConfigChanged) ChatView.onConfigChanged();
    const railVisible = state.page === 'chat' && (isOverlayRail() ? state.railOverlay : state.railOpen);
    if (state.config.ui) state.config.ui = { ...state.config.ui, railOpen: railVisible };
    refreshBadgesSoon();
    if (options.refreshRail) refreshRail();
  }

  App.setConfig = setConfig;
  App.applyTheme = applyTheme;
  App.refreshSidebarModel = refreshSidebarModel;

  function applyCatalog(data) {
    if (!data) return;
    state.catalog = {
      providers: data.providers || [],
      models: data.models || [],
    };
    refreshSidebarModel();
    if (window.ChatView?.refreshHeader) ChatView.refreshHeader();
    updateRuntimePill();
  }

  App.applyCatalog = applyCatalog;

  async function syncConfig() {
    configTimer = null;
    const [config, models] = await Promise.all([
      safe(API.config.get(), null),
      safe(API.models.list(), null),
    ]);
    const previousWorkspace = state.workspace;
    if (models) applyCatalog(models);
    if (config) setConfig(config);
    if (config && config.workspace && config.workspace !== previousWorkspace) {
      state.workspace = config.workspace;
      await refreshWorkspaceTree();
      await refreshSessions();
    }
    if (window.ChatView?.onConfigChanged) ChatView.onConfigChanged();
    applyRailVisibility();
  }

  function scheduleConfigSync() {
    if (configTimer) clearTimeout(configTimer);
    configTimer = setTimeout(() => { syncConfig().catch(() => {}); }, 160);
  }

  /* ------------------------------------------------------------------ badges */

  async function loadBadges() {
    const [skills, memory, mcp, learn, storage, papers] = await Promise.all([
      safe(API.skills.list(), null),
      safe(API.memory.list(), null),
      safe(API.mcp.list(), null),
      safe(API.learn.state(), null),
      safe(API.media.storage(), null),
      safe(API.papers.count(), null),
    ]);
    if (skills?.skills) {
      setBadge('badge-skills', skills.skills.length, { title: `${skills.skills.length} skills` });
    }
    if (memory?.entries) {
      const changed = state.memory.length !== memory.entries.length;
      state.memory = memory.entries;
      setBadge('badge-memory', memory.entries.length, { title: `${memory.entries.length} memories` });
      if (changed) refreshRail();
    }
    if (mcp?.servers) {
      state.mcpServers = mcp.servers;
      const connected = mcp.servers.filter((server) => server.connected).length;
      setBadge('badge-mcp', connected, { title: `${connected} MCP servers connected` });
    }
    if (learn) {
      const pending = (learn.pending || []).length;
      setBadge('badge-learning', pending, { title: `${pending} insights to review` });
    }
    if (storage) {
      setBadge('badge-studio', storage.count || 0, { title: `${storage.count || 0} media assets` });
    }
    if (papers !== null) {
      setBadge('badge-paper', papers, { title: `${papers} papers` });
    }
  }

  function refreshBadgesSoon() {
    if (badgeTimer) clearTimeout(badgeTimer);
    badgeTimer = setTimeout(() => { badgeTimer = null; loadBadges().catch(() => {}); }, 220);
  }

  App.refreshBadges = refreshBadgesSoon;
  App.loadBadges = loadBadges;

  /* ----------------------------------------------------------------- sessions */

  function matchesSearch(session) {
    const query = state.sessionSearch.trim().toLowerCase();
    if (!query) return true;
    const haystack = `${session.title || ''} ${session.preview || ''} ${session.model || ''} ${session.mode || ''}`.toLowerCase();
    return haystack.includes(query);
  }

  function groupSessions(sessions) {
    const groups = new Map();
    const pinned = sessions.filter((session) => session.pinned);
    if (pinned.length) groups.set('Pinned', pinned);
    for (const session of sessions) {
      if (session.pinned) continue;
      const label = U.dayLabel(session.updatedAt || session.createdAt || new Date().toISOString());
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(session);
    }
    const order = ['Pinned', 'Today', 'Yesterday', 'Previous 7 days', 'Previous 30 days', 'Older'];
    return [...groups.entries()].sort((a, b) => {
      const ai = order.indexOf(a[0]); const bi = order.indexOf(b[0]);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });
  }

  function sessionMarkup(session) {
    const active = session.id === state.currentSessionId;
    const pending = active && Boolean(window.ChatView?.running);
    const preview = String(session.preview || '').replace(/\s+/g, ' ').trim();
    const sub = preview || modelName(session.model);
    return `<div class="session-item ${active ? 'active' : ''} ${pending ? 'pending' : ''}" role="button" tabindex="0" data-session-id="${U.attr(session.id)}" title="${U.attr(`${session.title || 'New session'}\n${preview || modelName(session.model)}`)}">
      <span class="session-icon">${icon(session.pinned ? 'pin' : 'message', 13)}</span>
      <span class="session-copy">
        <span class="session-title">${U.esc(session.title || 'New session')}</span>
        <span class="session-sub">${U.esc(sub)}</span>
      </span>
      <span class="session-trail">
        <span class="session-time">${U.relativeTime(session.updatedAt)}</span>
        <button class="session-more" type="button" data-session-menu="${U.attr(session.id)}" aria-label="Session options">${icon('more-horizontal', 13)}</button>
      </span>
    </div>`;
  }

  function renderSessions() {
    const host = $('session-list');
    if (!host) return;
    const filtered = state.sessions.filter(matchesSearch);
    if (!state.sessions.length) {
      host.innerHTML = '<div class="sidebar-empty">Start a conversation to see it here.</div>';
      return;
    }
    if (!filtered.length) {
      host.innerHTML = `<div class="sidebar-empty">No sessions match “${U.esc(state.sessionSearch)}”.</div>`;
      return;
    }
    const groups = groupSessions(filtered);
    host.innerHTML = groups.map(([label, sessions]) => `<div class="session-group-label">${U.esc(label)}</div>${sessions.map(sessionMarkup).join('')}`).join('');
  }

  function findSession(id) {
    return state.sessions.find((session) => session.id === id) || null;
  }

  function upsertSession(summary) {
    if (!summary || !summary.id) return;
    const index = state.sessions.findIndex((session) => session.id === summary.id);
    if (index >= 0) state.sessions[index] = { ...state.sessions[index], ...summary };
    else state.sessions.unshift(summary);
    if (state.currentSessionId === summary.id && currentSession()) {
      if (summary.title) currentSession().title = summary.title;
      if (summary.pinned !== undefined) currentSession().pinned = summary.pinned;
      if (summary.model) currentSession().model = summary.model;
      if (window.ChatView?.refreshHeader) ChatView.refreshHeader();
      updateDocumentTitle();
    }
    renderSessions();
  }

  async function refreshSessions() {
    const result = await safe(API.sessions.list(), null);
    if (!result) return;
    state.sessions = result.sessions || [];
    if (result.workspace) state.workspace = result.workspace;
    updateWorkspaceChrome();
    renderSessions();
  }

  App.refreshSessions = refreshSessions;

  function setSessionSearchOpen(open) {
    state.sessionSearchOpen = Boolean(open);
    const wrap = $('session-search-wrap');
    const button = $('session-filter-btn');
    const input = $('session-search');
    if (wrap) wrap.hidden = !open;
    if (button) button.classList.toggle('active', Boolean(open));
    if (open) {
      setTimeout(() => input?.focus(), 20);
    } else {
      state.sessionSearch = '';
      if (input) input.value = '';
      renderSessions();
    }
  }

  function showSessionMenu(anchor, summary) {
    if (!summary) return;
    UI.menu(anchor, [
      { heading: summary.title || 'Session' },
      { label: 'Rename', icon: 'edit', onClick: () => renameSession(summary) },
      {
        label: summary.pinned ? 'Unpin from top' : 'Pin to top',
        icon: 'pin',
        onClick: () => togglePinnedSession(summary),
      },
      { label: 'Compact context', icon: 'panel-bottom', onClick: () => compactSession(summary) },
      { separator: true },
      { label: 'Delete session', icon: 'trash', danger: true, onClick: () => deleteSession(summary) },
    ], { align: 'end' });
  }

  async function renameSession(summary) {
    const title = await UI.prompt({
      title: 'Rename session',
      label: 'Title',
      value: summary.title || '',
      placeholder: 'What is this session about?',
      confirmLabel: 'Save',
      validate: (value) => (value ? '' : 'A title is required.'),
    });
    if (!title) return;
    try {
      const result = await API.sessions.update({ id: summary.id, title });
      upsertSession({ ...summary, title: result.session?.title || title });
      if (state.currentSessionId === summary.id && currentSession()) {
        currentSession().title = result.session?.title || title;
        ChatView.refreshHeader();
        updateDocumentTitle();
      }
      UI.toast('Session renamed.', 'success');
    } catch (error) { UI.toast(error.message, 'error'); }
  }

  async function togglePinnedSession(summary) {
    try {
      const result = await API.sessions.update({ id: summary.id, pinned: !summary.pinned });
      upsertSession({ ...summary, pinned: Boolean(result.session?.pinned) });
      UI.toast(result.session?.pinned ? 'Pinned to the top.' : 'Unpinned.', 'success');
    } catch (error) { UI.toast(error.message, 'error'); }
  }

  async function compactSession(summary) {
    const confirmed = await UI.confirm({
      title: 'Compact this conversation?',
      message: 'Blank will summarize earlier turns into a short context note. Recent messages stay verbatim.',
      confirmLabel: 'Compact',
      detail: summary.title,
    });
    if (!confirmed) return;
    try {
      const result = await API.sessions.compact(summary.id);
      if (state.currentSessionId === summary.id) {
        await ChatView.loadSession(summary.id, { keepScroll: true });
      }
      await refreshSessions();
      refreshRail();
      const saved = result?.compacted;
      UI.toast(saved ? `Compacted ${saved} earlier messages.` : 'Context compacted.', 'success');
    } catch (error) { UI.toast(error.message, 'error'); }
  }

  async function deleteSession(summary) {
    const confirmed = await UI.confirm({
      title: 'Delete this session?',
      message: 'The transcript and its context are removed from this machine. Media assets are kept.',
      confirmLabel: 'Delete session',
      danger: true,
      detail: summary.title,
    });
    if (!confirmed) return;
    try {
      await API.sessions.delete(summary.id);
      state.sessions = state.sessions.filter((session) => session.id !== summary.id);
      if (state.currentSessionId === summary.id) {
        state.currentSessionId = null;
        ChatView.newDraft({ silent: true });
        updateDocumentTitle();
      }
      renderSessions();
      refreshRail();
      UI.toast('Session deleted.', 'success');
    } catch (error) { UI.toast(error.message, 'error'); }
  }

  function newSession() {
    state.currentSessionId = null;
    openPage('chat');
    ChatView.newDraft();
    renderSessions();
    applyRailVisibility();
    renderRail();
    updateDocumentTitle();
    closeMobilePanels();
  }

  function loadSession(id) {
    if (!id) return;
    if (state.currentSessionId === id && currentSession()) {
      openPage('chat');
      closeMobilePanels();
      return;
    }
    openPage('chat');
    state.currentSessionId = id;
    renderSessions();
    ChatView.loadSession(id);
    closeMobilePanels();
  }

  function onChatStarted(id) {
    state.currentSessionId = id || null;
    if (id && !findSession(id)) {
      state.sessions.unshift({
        id,
        title: currentSession()?.title || 'New session',
        preview: '',
        updatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        model: currentSession()?.model,
        mode: currentSession()?.mode,
        pinned: false,
      });
    }
    renderSessions();
    refreshRail();
    applyRailVisibility();
    updateDocumentTitle();
    refreshSessions();
  }

  function onChatLoaded(session) {
    state.currentSessionId = session?.id || null;
    renderSessions();
    refreshRail();
    applyRailVisibility();
    updateDocumentTitle();
  }

  App.newSession = newSession;
  App.loadSession = loadSession;
  App.onChatStarted = onChatStarted;
  App.onChatLoaded = onChatLoaded;

  /* --------------------------------------------------------------- workspace */

  function updateWorkspaceChrome() {
    const name = $('workspace-name');
    const chip = $('workspace-chip');
    const workspace = state.workspace || state.config?.workspace || '';
    if (name) name.textContent = workspace ? U.baseName(workspace) : 'No folder';
    if (chip) chip.title = workspace || 'Choose a workspace folder';
  }

  async function refreshWorkspaceTree() {
    const result = await safe(API.workspace.tree(), null);
    if (!result) { refreshRail(); return; }
    state.workspace = result.workspace || state.config?.workspace || state.workspace || '';
    state.tree = result.tree || [];
    updateWorkspaceChrome();
    refreshRail();
  }

  App.refreshWorkspaceTree = refreshWorkspaceTree;

  async function onWorkspaceChanged() {
    const [config, tree] = await Promise.all([
      safe(API.config.get(), null),
      safe(API.workspace.tree(), null),
    ]);
    if (config) setConfig(config);
    if (tree) {
      state.workspace = tree.workspace || config?.workspace || '';
      state.tree = tree.tree || [];
    }
    updateWorkspaceChrome();
    await refreshSessions();
    refreshRail();
    applyRailVisibility();
  }

  App.onWorkspaceChanged = onWorkspaceChanged;

  async function chooseWorkspace() {
    try {
      const result = await API.workspace.choose();
      if (!result || result.canceled) return;
      state.workspace = result.workspace || '';
      state.tree = result.tree || [];
      updateWorkspaceChrome();
      await refreshSessions();
      refreshRail();
      applyRailVisibility();
      UI.toast(`Workspace: ${U.baseName(state.workspace)}`, 'success');
    } catch (error) { UI.toast(error.message, 'error'); }
  }

  function openWorkspacePopover(anchor) {
    const workspace = state.workspace || state.config?.workspace || '';
    const node = document.createElement('div');
    node.className = 'workspace-popover';
    node.innerHTML = `
      <div class="workspace-current">
        <span>${icon('folder-open', 15)}</span>
        <div class="workspace-current-copy">
          <div class="workspace-current-label">Current workspace</div>
          <div class="workspace-current-path">${workspace ? U.esc(workspace) : 'No folder selected'}</div>
        </div>
      </div>
      <button class="menu-item" type="button" data-ws-action="choose"><span class="menu-icon">${icon('folder', 14)}</span><span class="menu-label">Open folder…</span></button>
      <button class="menu-item" type="button" data-ws-action="reveal" ${workspace ? '' : 'disabled'}><span class="menu-icon">${icon('folder-open', 14)}</span><span class="menu-label">Reveal in file manager</span></button>
      <button class="menu-item" type="button" data-ws-action="editor" ${workspace ? '' : 'disabled'}><span class="menu-icon">${icon('code', 14)}</span><span class="menu-label">Open in VS Code</span></button>
      <button class="menu-item" type="button" data-ws-action="copy" ${workspace ? '' : 'disabled'}><span class="menu-icon">${icon('copy', 14)}</span><span class="menu-label">Copy path</span></button>
      <div class="menu-sep"></div>
      <button class="menu-item" type="button" data-ws-action="data"><span class="menu-icon">${icon('database', 14)}</span><span class="menu-label">Open data folder</span></button>`;
    const handle = UI.popover(anchor, node, { align: 'start' });
    node.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-ws-action]');
      if (!button || button.disabled) return;
      const action = button.dataset.wsAction;
      handle.close();
      if (action === 'choose') chooseWorkspace();
      else if (action === 'reveal') {
        try { await API.workspace.openPath(''); } catch (error) { UI.toast(error.message, 'error'); }
      } else if (action === 'editor') {
        try {
          const result = await API.workspace.openEditor();
          if (result && result.ok === false) UI.toast(result.error || 'Could not open VS Code.', 'warn');
        } catch (error) { UI.toast(error.message, 'error'); }
      } else if (action === 'copy') {
        const ok = await U.copyText(workspace);
        UI.toast(ok ? 'Workspace path copied.' : 'Clipboard unavailable.', ok ? 'success' : 'error');
      } else if (action === 'data') {
        try { await API.app.openDataFolder(); } catch (error) { UI.toast(error.message, 'error'); }
      }
    });
  }

  /* --------------------------------------------------------------- page / nav */

  function updateNav() {
    for (const button of qsa('[data-page]')) {
      button.classList.toggle('active', button.dataset.page === state.page);
    }
  }

  function updateDocumentTitle() {
    const session = currentSession();
    if (state.page === 'chat') {
      const title = session?.title && session.title !== 'New session' ? session.title : 'Blank';
      document.title = title === 'Blank' ? 'Blank' : `${title} · Blank`;
    } else {
      document.title = `${PAGE_META[state.page]?.label || 'Blank'} · Blank`;
    }
  }

  function openPage(page) {
    const next = PAGE_META[page] ? page : 'chat';
    state.page = next;
    const chatView = $('chat-view');
    const pageView = $('page-view');
    if (next === 'chat') {
      if (chatView) chatView.hidden = false;
      if (pageView) pageView.hidden = true;
    } else {
      if (chatView) chatView.hidden = true;
      if (pageView) {
        pageView.hidden = false;
        pageView.scrollTop = 0;
        window.Views?.render(next, pageView);
      }
    }
    updateNav();
    updateDocumentTitle();
    applyRailVisibility();
    if (next === 'chat') refreshRail();
    closeMobilePanels();
  }

  App.openPage = openPage;

  /* -------------------------------------------------------------------- rail */

  function countTreeFiles(nodes) {
    let count = 0;
    for (const node of nodes || []) {
      if (node.type === 'dir') count += countTreeFiles(node.children || []);
      else count += 1;
    }
    return count;
  }

  function flattenTree(nodes, depth = 0, out = []) {
    for (const node of nodes || []) {
      if (node.type === 'dir') {
        out.push({ node, depth });
        flattenTree(node.children || [], depth + 1, out);
      } else {
        out.push({ node, depth });
      }
    }
    return out;
  }

  function railEmpty(iconName, title) {
    return `<div class="rail-empty"><div class="empty-icon">${icon(iconName, 16)}</div><h4>${U.esc(title)}</h4></div>`;
  }

  function sessionFileEntries() {
    const files = currentSession()?.files || [];
    const seen = new Set();
    const out = [];
    for (const entry of files) {
      const path = filePathOf(entry);
      if (!path || seen.has(path)) continue;
      seen.add(path);
      out.push({ path, action: typeof entry === 'object' ? entry.action : '' });
    }
    return out;
  }

  function railTreeMarkup() {
    const query = state.fileQuery.trim().toLowerCase();
    if (query) {
      const matches = flattenTree(state.tree)
        .filter(({ node }) => node.type !== 'dir' && node.path.toLowerCase().includes(query))
        .slice(0, 60);
      if (!matches.length) return '<div class="tree-hint">No files match that filter.</div>';
      return matches.map(({ node }) => `<button class="tree-row file" type="button" data-rail-file="${U.attr(node.path)}" title="${U.attr(node.path)}">
        <span class="tree-chev"></span>
        <span class="tree-icon">${icon('file-text', 12)}</span>
        <span class="tree-name">${U.esc(node.name)}</span>
      </button>`).join('');
    }
    function render(nodes, depth) {
      return (nodes || []).map((node) => {
        const pad = 5 + depth * 12;
        if (node.type === 'dir') {
          const open = state.expanded.has(node.path);
          return `<button class="tree-row dir ${open ? 'expanded' : ''}" type="button" data-tree-dir="${U.attr(node.path)}" style="padding-left:${pad}px">
              <span class="tree-chev">${icon('chevron-right', 10)}</span>
              <span class="tree-icon">${icon(open ? 'folder-open' : 'folder', 13)}</span>
              <span class="tree-name">${U.esc(node.name)}</span>
            </button>
            <div class="tree-children ${open ? 'open' : ''}">${render(node.children || [], depth + 1)}</div>`;
        }
        return `<button class="tree-row file" type="button" data-rail-file="${U.attr(node.path)}" title="${U.attr(node.path)}" style="padding-left:${pad + 16}px">
            <span class="tree-chev"></span>
            <span class="tree-icon">${icon('file-text', 12)}</span>
            <span class="tree-name">${U.esc(node.name)}</span>
          </button>`;
      }).join('');
    }
    const rows = render(state.tree, 0);
    if (!rows) {
      return `<div class="tree-hint">${state.workspace ? 'This folder is empty.' : 'Open a workspace folder to browse files.'}</div>`;
    }
    return `<div class="file-tree">${rows}</div>`;
  }

  function sessionFilesMarkup() {
    const files = sessionFileEntries();
    if (!files.length) return '';
    return `<div class="rail-section">
      <div class="rail-section-head"><span class="rail-section-title">${icon('file-text', 11)} Touched in session</span><span class="rail-section-meta">${files.length}</span></div>
      <div class="rail-session-files">${files.slice(0, 16).map((file) => `<button class="session-file" type="button" data-rail-file="${U.attr(file.path)}" title="${U.attr(file.path)}">
        ${icon('file-code', 12)}<span>${U.esc(file.path)}</span>
      </button>`).join('')}</div>
    </div>`;
  }

  function planMarkup() {
    const session = currentSession();
    const tasks = (session?.tasks || []).filter((task) => task && task.content);
    const done = tasks.filter((task) => task.status === 'completed').length;
    const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
    return `<div class="rail-section">
        <div class="rail-section-head"><span class="rail-section-title">${icon('checklist', 11)} Plan</span><span class="rail-section-meta">${tasks.length ? `${done}/${tasks.length}` : '—'}</span></div>
        ${tasks.length ? `<div class="plan-summary"><div class="plan-progress"><span style="width:${pct}%"></span></div><span class="plan-summary-label">${pct}%</span></div>
        <div class="plan-items">${tasks.map((task) => `<div class="plan-item ${U.esc(task.status || 'pending')}">
          <span class="plan-mark">${task.status === 'completed' ? icon('check', 9) : ''}</span>
          <span class="plan-text">${U.esc(task.content)}</span>
        </div>`).join('')}</div>` : railEmpty('checklist', 'No plan yet', 'Ask Blank to plan a multi-step task; the checklist appears here while it works.')}
      </div>
      ${sessionFilesMarkup()}`;
  }

  function filesMarkup() {
    return `<div class="rail-section">
      <div class="rail-files-search">${icon('search', 12)}<input type="text" data-rail-search placeholder="Filter files" value="${U.attr(state.fileQuery)}" spellcheck="false" /></div>
      <div data-rail-tree>${railTreeMarkup()}</div>
    </div>`;
  }

  function contextMarkup() {
    const session = currentSession();
    const fullId = currentModelId();
    const provider = providerOf(fullId);
    const model = U.modelOf(state.catalog, fullId);
    const limit = Number(model?.context) || 128000;
    const usage = session?.usage || { input: 0, output: 0 };
    const used = Number(usage.input || 0) + Number(usage.output || 0);
    const pct = Math.min(100, Math.round((used / limit) * 100));
    const messages = session?.messages || [];
    const toolCalls = messages.filter((message) => message.role === 'tool').length;
    const files = sessionFileEntries().length;
    const memories = [...state.memory]
      .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)))
      .slice(0, 3);
    return `<div class="rail-section">
        <div class="context-card">
          <div class="context-card-title">${icon('cpu', 11)} ${U.esc(model?.name || modelName(fullId))}</div>
          <div class="context-card-value">${U.fmtNumber(used)} <span style="font-size:10px;color:var(--text-faint);font-weight:500">/ ${U.fmtNumber(limit)}</span></div>
          <div class="context-card-sub">${U.esc(provider?.name || 'Model')} · ${U.esc(fullId)}</div>
          <div class="context-meter"><span style="width:${Math.max(used ? 2 : 0, pct)}%"></span></div>
          <div class="context-card-sub" style="margin-top:5px">${pct}% of context used${session?.summary ? ' · compacted' : ''}</div>
        </div>
        <div class="context-grid">
          <div class="context-stat"><div class="label">Messages</div><div class="num">${U.fmtNumber(messages.length)}</div></div>
          <div class="context-stat"><div class="label">Tool calls</div><div class="num">${U.fmtNumber(toolCalls)}</div></div>
          <div class="context-stat"><div class="label">Mode</div><div class="num" style="font-size:11px;text-transform:capitalize">${U.esc(session?.mode || 'agent')}</div></div>
          <div class="context-stat"><div class="label">Files touched</div><div class="num">${U.fmtNumber(files)}</div></div>
        </div>
      </div>
      <div class="rail-section">
        <div class="rail-section-head"><span class="rail-section-title">${icon('folder', 11)} Workspace</span></div>
        <div class="context-card">
          <div class="context-card-title">${icon('folder-open', 11)} ${U.esc(state.workspace ? U.baseName(state.workspace) : 'No folder')}</div>
          <div class="context-card-sub" style="overflow-wrap:anywhere;font-family:var(--font-mono);margin-top:4px">${U.esc(state.workspace || 'Choose a folder from the title bar.')}</div>
        </div>
      </div>
      <div class="rail-section">
        <div class="rail-section-head"><span class="rail-section-title">${icon('brain', 11)} Memory</span><span class="rail-section-meta">${state.memory.length || 0}</span></div>
        ${memories.length ? `<div class="memory-chip-list">${memories.map((memory) => `<div class="memory-chip">${icon('circle-dot', 10)}<span>${U.esc(memory.text)}</span></div>`).join('')}</div>` : railEmpty('brain', 'Memory is quiet', 'Saved facts and preferences will surface here as Blank learns them.')}
      </div>
      ${session?.summary ? `<div class="rail-section"><div class="rail-section-head"><span class="rail-section-title">${icon('panel-bottom', 11)} Compacted context</span></div><div class="summary-card"><b>Summary</b>${U.esc(session.summary)}</div></div>` : ''}`;
  }

  function renderRail() {
    const body = $('rail-body');
    if (!body) return;
    const tasks = currentSession()?.tasks || [];
    const planCount = $('rail-plan-count');
    const fileCount = $('rail-files-count');
    if (planCount) planCount.textContent = String(tasks.length);
    if (fileCount) fileCount.textContent = String(countTreeFiles(state.tree));
    for (const tab of qsa('[data-rail]')) tab.classList.toggle('active', tab.dataset.rail === state.railTab);
    const scrollTop = body.scrollTop;
    if (state.railTab === 'files') body.innerHTML = filesMarkup();
    else if (state.railTab === 'context') body.innerHTML = contextMarkup();
    else body.innerHTML = planMarkup();
    body.scrollTop = scrollTop;
  }

  function refreshRail() { renderRail(); }

  App.refreshRail = renderRail;

  function applyRailVisibility() {
    const visible = state.page === 'chat' && (isOverlayRail() ? state.railOverlay : state.railOpen);
    document.body.classList.toggle('rail-off', !visible);
    const rail = $('rail');
    if (rail) rail.classList.toggle('open', visible && isOverlayRail());
    if (state.config?.ui) state.config.ui = { ...state.config.ui, railOpen: visible };
    if (window.ChatView?.refreshHeader) ChatView.refreshHeader();
    updateScrim();
  }

  function toggleRail() {
    if (isOverlayRail()) state.railOverlay = !state.railOverlay;
    else state.railOpen = !state.railOpen;
    applyRailVisibility();
    if (!isOverlayRail()) {
      API.config.update({ ui: { railOpen: state.railOpen } }).then((config) => {
        if (config) setConfig(config);
      }).catch(() => {});
    }
  }

  App.toggleRail = toggleRail;

  /* ------------------------------------------------------------ sidebar shell */

  function toggleSidebar() {
    state.sidebarOpen = !state.sidebarOpen;
    const sidebar = $('sidebar');
    if (sidebar) sidebar.classList.toggle('open', state.sidebarOpen);
    updateScrim();
  }

  function closeMobilePanels() {
    state.sidebarOpen = false;
    state.railOverlay = false;
    const sidebar = $('sidebar');
    if (sidebar) sidebar.classList.remove('open');
    const rail = $('rail');
    if (rail) rail.classList.remove('open');
    applyRailVisibility();
  }

  function updateScrim() {
    const scrim = $('mobile-scrim');
    if (!scrim) return;
    const show = (state.sidebarOpen && isMobileSidebar())
      || (state.railOverlay && isOverlayRail() && state.page === 'chat');
    scrim.hidden = !show;
  }

  function handleResize() {
    state.railOverlay = false;
    if (!isMobileSidebar()) state.sidebarOpen = false;
    const sidebar = $('sidebar');
    if (sidebar) sidebar.classList.toggle('open', state.sidebarOpen);
    applyRailVisibility();
  }

  /* ------------------------------------------------------------------ palette */

  function flattenFiles() {
    const out = [];
    function walk(nodes, prefix) {
      for (const node of nodes || []) {
        if (node.type === 'dir') walk(node.children || [], `${prefix}${node.name}/`);
        else out.push({ path: node.path, name: node.name, dir: prefix.slice(0, -1) });
      }
    }
    walk(state.tree, '');
    return out;
  }

  function paletteActions() {
    return [
      { icon: 'plus', title: 'New session', sub: 'Start with a clean context', kbd: U.kbd('Ctrl N'), run: () => newSession() },
      { icon: 'message', title: 'Go to Chat', sub: 'Conversation with the agent', run: () => openPage('chat') },
      { icon: 'wand', title: 'Open Studio', sub: 'Images, video, music and 3D', run: () => openPage('studio') },
      { icon: 'book', title: 'Open Paper', sub: 'Live pages, documents and graphics', run: () => openPage('paper') },
      { icon: 'sparkles', title: 'Switch default model…', sub: 'Model used by new sessions', kbd: U.kbd('Ctrl M'), run: () => openDefaultModelPicker($('palette-trigger')) },
      { icon: 'sparkles', title: 'Models', sub: 'Providers, keys and discovery', run: () => openPage('models') },
      { icon: 'layers', title: 'Skills', sub: 'Reusable workflows and instructions', run: () => openPage('skills') },
      { icon: 'brain', title: 'Memory', sub: 'Facts and preferences Blank remembers', run: () => openPage('memory') },
      { icon: 'plug', title: 'MCP', sub: 'Connected tool servers', run: () => openPage('mcp') },
      { icon: 'grid', title: 'Plugins', sub: 'One-click MCP servers and skills', run: () => openPage('plugins') },
      { icon: 'globe', title: 'Web search settings', sub: 'Search backend and API keys', run: () => Views.openSettingsSection('search') },
      { icon: 'monitor', title: 'Computer settings', sub: 'Cursor overlay and screen access', run: () => Views.openSettingsSection('computer') },
      { icon: 'link', title: 'Remote control settings', sub: 'Pair a phone over your network', run: () => Views.openSettingsSection('remote') },
      { icon: 'zap', title: 'Learning', sub: 'Review self-improvement insights', run: () => openPage('learning') },
      { icon: 'settings', title: 'Settings', sub: 'Permissions, agent behavior and data', kbd: U.kbd('Ctrl ,'), run: () => openPage('settings') },
      { icon: 'panel-right', title: 'Toggle context panel', sub: 'Plan, files and context', kbd: U.kbd('Ctrl Shift B'), run: () => toggleRail() },
      { icon: resolvedTheme() === 'dark' ? 'sun' : 'moon', title: `Switch to ${resolvedTheme() === 'dark' ? 'light' : 'dark'} theme`, sub: 'Appearance only affects this window', run: toggleTheme },
      { icon: 'folder', title: 'Open workspace folder…', sub: state.workspace || 'No folder selected', run: chooseWorkspace },
      { icon: 'terminal', title: 'Install command line tool', sub: 'Run Blank from any terminal', run: installCli },
      { icon: 'database', title: 'Open data folder', sub: state.info?.home || '~/.blank', run: () => API.app.openDataFolder().catch((error) => UI.toast(error.message, 'error')) },
    ];
  }

  function paletteGroups(query) {
    const q = query.trim().toLowerCase();
    const match = (text) => !q || text.toLowerCase().includes(q);
    const groups = [];
    const actions = paletteActions().filter((item) => match(`${item.title} ${item.sub || ''}`));
    if (actions.length) groups.push({ label: 'Actions', items: actions });
    const sessions = state.sessions
      .filter((session) => match(`${session.title || ''} ${session.preview || ''} ${session.model || ''}`))
      .slice(0, q ? 8 : 4)
      .map((session) => ({
        icon: session.pinned ? 'pin' : 'message',
        title: session.title || 'New session',
        sub: `${modelName(session.model)} · ${U.relativeTime(session.updatedAt)}`,
        run: () => loadSession(session.id),
      }));
    if (sessions.length) groups.push({ label: 'Sessions', items: sessions });
    if (q) {
      const files = flattenFiles()
        .filter((file) => `${file.path}`.toLowerCase().includes(q))
        .slice(0, 20)
        .map((file) => ({
          icon: 'file-text',
          title: file.name,
          sub: file.dir || 'workspace root',
          kbd: 'File',
          run: () => App.openFilePreview(file.path),
        }));
      if (files.length) groups.push({ label: 'Files', items: files });
      const models = (state.catalog.models || [])
        .filter((model) => `${model.name} ${model.id} ${model.providerName}`.toLowerCase().includes(q))
        .slice(0, 6)
        .map((model) => ({
          icon: 'sparkles',
          title: `Use ${model.name}`,
          sub: `${model.providerName} · ${model.fullId}`,
          run: () => setDefaultModel(model.fullId),
        }));
      if (models.length) groups.push({ label: 'Models', items: models });
    }
    return groups;
  }

  function openPalette() {
    if (paletteOpen) return;
    const layer = document.createElement('div');
    layer.className = 'palette-layer';
    layer.innerHTML = `
      <div class="palette-backdrop" data-palette-close></div>
      <div class="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div class="palette-search">${icon('search', 15)}<input type="text" data-palette-input placeholder="Search sessions, files, models and actions" spellcheck="false" autocomplete="off" /><kbd class="kbd">Esc</kbd></div>
        <div class="palette-results" data-palette-results></div>
        <div class="palette-foot">
          <span class="hint-group"><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> open</span><span><kbd>esc</kbd> close</span></span>
          <span>Blank</span>
        </div>
      </div>`;
    document.body.appendChild(layer);
    const input = layer.querySelector('[data-palette-input]');
    const results = layer.querySelector('[data-palette-results]');
    const modal = layer.querySelector('.palette');
    let groups = [];
    let flat = [];
    let active = 0;
    requestAnimationFrame(() => modal.classList.add('in'));

    function close() {
      if (!paletteOpen) return;
      paletteOpen = null;
      layer.remove();
      document.removeEventListener('keydown', onKeydown, true);
    }

    function paint() {
      groups = paletteGroups(input.value);
      flat = groups.flatMap((group) => group.items);
      active = Math.min(active, Math.max(0, flat.length - 1));
      let index = 0;
      results.innerHTML = groups.length ? groups.map((group) => `<div class="palette-section">
          <div class="palette-section-label">${U.esc(group.label)}</div>
          ${group.items.map((item) => {
            const current = index;
            index += 1;
            return `<button class="palette-item ${current === active ? 'active' : ''}" type="button" data-palette-index="${current}">
              <span class="palette-icon">${icon(item.icon || 'circle', 13)}</span>
              <span class="palette-copy"><span class="palette-title">${U.esc(item.title)}</span>${item.sub ? `<span class="palette-sub">${U.esc(item.sub)}</span>` : ''}</span>
              ${item.kbd ? `<kbd class="kbd palette-kbd">${U.esc(item.kbd)}</kbd>` : ''}
            </button>`;
          }).join('')}
        </div>`).join('') : '<div class="palette-empty">Nothing matches that search.</div>';
      const activeRow = results.querySelector('.palette-item.active');
      activeRow?.scrollIntoView({ block: 'nearest' });
    }

    function setActive(next) {
      if (!flat.length) return;
      active = (next + flat.length) % flat.length;
      qsa('.palette-item', results).forEach((row) => row.classList.toggle('active', Number(row.dataset.paletteIndex) === active));
      results.querySelector('.palette-item.active')?.scrollIntoView({ block: 'nearest' });
    }

    function run(item) {
      if (!item) return;
      close();
      try { item.run(); } catch (error) { UI.toast(error.message, 'error'); }
    }

    function onKeydown(event) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
      if (event.key === 'ArrowDown') { event.preventDefault(); setActive(active + 1); return; }
      if (event.key === 'ArrowUp') { event.preventDefault(); setActive(active - 1); return; }
      if (event.key === 'Enter') { event.preventDefault(); run(flat[active]); }
    }

    input.addEventListener('input', () => { active = 0; paint(); });
    results.addEventListener('click', (event) => {
      const row = event.target.closest('[data-palette-index]');
      if (row) run(flat[Number(row.dataset.paletteIndex)]);
    });
    layer.querySelector('[data-palette-close]')?.addEventListener('click', close);
    document.addEventListener('keydown', onKeydown, true);
    paletteOpen = { close };
    paint();
    input.focus();
  }

  function closePalette() {
    paletteOpen?.close();
  }

  /* ------------------------------------------------------------------- theme */

  async function toggleTheme() {
    const next = resolvedTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try {
      const config = await API.config.update({ theme: next });
      if (config) setConfig(config);
    } catch (error) {
      UI.toast(error.message, 'error');
      applyTheme(state.config?.theme || 'light');
    }
  }

  /* ------------------------------------------------------------------- models */

  function openModelPicker(anchor, options) {
    if (window.Views?.openModelPicker) Views.openModelPicker(anchor, options || {});
    else UI.toast('Model picker is unavailable.', 'error');
  }

  function openDefaultModelPicker(anchor) {
    openModelPicker(anchor || $('sidebar-model'), {
      title: 'Default model',
      description: 'New sessions start with this model. Existing sessions keep their own.',
      current: state.config?.defaultModel || '',
      onSelect: (modelId) => setDefaultModel(modelId),
    });
  }

  async function setDefaultModel(modelId) {
    if (!modelId) return;
    try {
      const config = await API.config.update({ defaultModel: modelId });
      if (config) setConfig(config);
      refreshSidebarModel();
      if (window.ChatView?.onConfigChanged) ChatView.onConfigChanged();
      UI.toast(`Default model: ${modelName(modelId)}`, 'success');
    } catch (error) { UI.toast(error.message, 'error'); }
  }

  App.openModelPicker = openModelPicker;

  /* ---------------------------------------------------------------------- CLI */

  async function installCli() {
    try {
      const result = await API.cli.install();
      const body = document.createElement('div');
      body.innerHTML = `<div class="field"><span class="field-label">Launcher</span><div class="data-path"><code>${U.esc(result.path || 'blank')}</code></div></div>
        <p class="setting-desc">${U.esc(result.instructions || 'Add the install folder to PATH.')}</p>
        <div class="command-line" style="margin-top:12px"><span class="prompt-symbol">$</span><span>blank "summarize this repository"</span><button class="copy-inline" type="button" data-copy-command aria-label="Copy command">${icon('copy', 13)}</button></div>`;
      const modal = UI.modal({
        title: 'Command line ready',
        description: 'Drive the same workspace and sessions from your terminal.',
        body,
        size: 'small',
        footer: `<button class="btn btn-ghost" type="button" data-cancel>Close</button><button class="btn btn-primary" type="button" data-copy-done>${icon('copy', 12)} Copy command</button>`,
        onMount(node) {
          const command = 'blank "summarize this repository"';
          node.querySelector('[data-copy-command]')?.addEventListener('click', () => U.copyText(command));
          node.querySelector('[data-copy-done]')?.addEventListener('click', async () => {
            const ok = await U.copyText(command);
            UI.toast(ok ? 'Command copied.' : 'Clipboard unavailable.', ok ? 'success' : 'error');
            modal.close();
          });
          node.querySelector('[data-cancel]')?.addEventListener('click', () => modal.close());
        },
      });
    } catch (error) { UI.toast(error.message, 'error'); }
  }

  /* --------------------------------------------------------------- onboarding */

  function onboardingModelChoices() {
    const preferred = [
      ['sandbox', 'blank-1', 'Offline preview', 'No key. A guided model for trying every surface.'],
      ['anthropic', 'claude-sonnet-4-5', 'Long-horizon agent work', 'Strong tool use and code reasoning.'],
      ['openai', 'gpt-5.1', 'Frontier reasoning', 'Broad capability across coding and analysis.'],
      ['google', 'gemini-2.5-pro', 'Huge context window', 'Useful for large repositories and documents.'],
      ['ollama', '', 'Runs on this machine', 'Point at a local model when Ollama is installed.'],
    ];
    const choices = [];
    for (const [providerId, modelId, tagline, description] of preferred) {
      const provider = state.catalog.providers.find((entry) => entry.id === providerId);
      if (!provider) continue;
      const model = (provider.models || []).find((entry) => entry.id === modelId) || (provider.models || [])[0];
      if (!model) continue;
      choices.push({ fullId: `${provider.id}/${model.id}`, provider, model, tagline, description });
    }
    if (!choices.length) {
      choices.push({
        fullId: 'sandbox/blank-1',
        provider: { id: 'sandbox', name: 'Blank Sandbox', monogram: 'b' },
        model: { name: 'Blank 1' },
        tagline: 'Offline preview',
        description: 'No key required.',
      });
    }
    return choices;
  }

  function openOnboarding() {
    if (!state.config) return;
    let step = 0;
    let saving = false;
    let draftModel = state.config.defaultModel || 'sandbox/blank-1';
    let chosenWorkspace = state.workspace || state.config.workspace || '';
    const choices = onboardingModelChoices();
    if (!choices.some((choice) => choice.fullId === draftModel)) draftModel = choices[0].fullId;

    const body = document.createElement('div');
    body.className = 'onboarding-body';

    function stepsMarkup() {
      return `<div class="onboard-steps"><span class="onboard-step-dot ${step >= 0 ? 'active' : ''}"></span><span class="onboard-step-dot ${step >= 1 ? 'active' : ''}"></span></div>`;
    }

    function modelStep() {
      return `<div class="onboard-step">
        <div class="onboard-hero">
          <span class="onboard-mark"><svg viewBox="0 0 64 64" aria-hidden="true"><rect x="2" y="2" width="60" height="60" rx="15" fill="#2F6BFF"/><path d="M23 13h13l12 12v23a4 4 0 0 1-4 4H23a4 4 0 0 1-4-4V17a4 4 0 0 1 4-4Z" fill="#fff"/><path d="M36 13v12h12Z" fill="#DCE7FF"/></svg></span>
          <div><h2>Meet Blank</h2><p>A local-first agent harness for code, research and media.</p></div>
        </div>
        ${stepsMarkup()}
        <div>
          <div class="field-label" style="font-size:11px;font-weight:600;color:var(--text-secondary);margin-bottom:7px">Choose a starting model</div>
          <div class="onboard-cards">${choices.map((choice) => `<button class="onboard-choice ${choice.fullId === draftModel ? 'selected' : ''}" type="button" data-onboard-model="${U.attr(choice.fullId)}">
            ${UI.providerMono(choice.provider)}
            <span class="onboard-choice-copy"><span class="onboard-choice-name">${U.esc(choice.model.name)}</span><span class="onboard-choice-desc">${U.esc(choice.provider.name)}</span></span>
            <span class="radio-dot"></span>
          </button>`).join('')}</div>
        </div>
        <div class="onboard-note">${icon('lock', 12)}<span>Keys are stored only on this machine. The Sandbox model works fully offline; add provider keys later in Models.</span></div>
        <div class="onboard-actions">
          <button class="btn btn-ghost" type="button" data-onboard-skip>Set up later</button>
          <button class="btn btn-primary" type="button" data-onboard-next>Continue ${icon('arrow-right', 12)}</button>
        </div>
      </div>`;
    }

    function workspaceStep() {
      return `<div class="onboard-step">
        <div class="onboard-hero">
          <span class="onboard-mark">${icon('folder-open', 46)}</span>
          <div><h2>Pick a workspace</h2><p>Blank reads and writes inside this folder — and nowhere else.</p></div>
        </div>
        ${stepsMarkup()}
        <div class="onboard-workspace">${icon('folder', 16)}<span>${U.esc(chosenWorkspace || 'Blank Workspace will be created automatically')}</span><button class="btn btn-secondary btn-sm" type="button" data-onboard-choose>Change</button></div>
        <div class="onboard-note">${icon('shield', 12)}<span>Writes and shell commands ask for approval by default. Sessions, memory and media live in <code>~/.blank</code>, never in your repository.</span></div>
        <div class="onboard-actions">
          <button class="btn btn-ghost" type="button" data-onboard-back>Back</button>
          <button class="btn btn-primary" type="button" data-onboard-finish ${saving ? 'disabled' : ''}>${saving ? '<span class="spinner" style="width:11px;height:11px"></span> Setting up…' : 'Start using Blank'}</button>
        </div>
      </div>`;
    }

    function paint() {
      body.innerHTML = step === 0 ? modelStep() : workspaceStep();
    }

    paint();
    const modal = UI.modal({
      title: 'Welcome to Blank',
      description: 'Two quick choices. Everything stays on this machine.',
      body,
      size: 'large',
      className: 'modal-onboarding',
      dismissible: false,
    });

    async function finish(skip) {
      if (saving) return;
      saving = true;
      if (step === 1) paint();
      try {
        const patch = { onboarded: true };
        if (!skip) patch.defaultModel = draftModel;
        const config = await API.config.update(patch);
        if (config) setConfig(config);
        else setConfig({ ...state.config, onboarded: true });
        modal.close();
        UI.toast(skip ? 'You can finish setup from Settings.' : 'Blank is ready.', 'success');
        if (window.ChatView?.refreshHeader) ChatView.refreshHeader();
      } catch (error) {
        saving = false;
        UI.toast(error.message, 'error');
        if (step === 1) paint();
      }
    }

    body.addEventListener('click', async (event) => {
      const modelButton = event.target.closest('[data-onboard-model]');
      if (modelButton) {
        draftModel = modelButton.dataset.onboardModel;
        qsa('.onboard-choice', body).forEach((button) => button.classList.toggle('selected', button === modelButton));
        return;
      }
      if (event.target.closest('[data-onboard-skip]')) { finish(true); return; }
      if (event.target.closest('[data-onboard-next]')) { step = 1; paint(); return; }
      if (event.target.closest('[data-onboard-back]')) { step = 0; paint(); return; }
      if (event.target.closest('[data-onboard-choose]')) {
        try {
          const result = await API.workspace.choose();
          if (result && !result.canceled) {
            chosenWorkspace = result.workspace || chosenWorkspace;
            state.workspace = chosenWorkspace;
            state.tree = result.tree || state.tree;
            updateWorkspaceChrome();
            refreshSessions();
            refreshRail();
            paint();
          }
        } catch (error) { UI.toast(error.message, 'error'); }
        return;
      }
      if (event.target.closest('[data-onboard-finish]')) finish(false);
    });
  }

  /* ------------------------------------------------------------------- events */

  function handleEvent(event) {
    if (!event || !event.type) return;
    if (!state.ready) { pendingEvents.push(event); return; }

    if (CHAT_EVENTS.has(event.type) && window.ChatView?.handleEvent) ChatView.handleEvent(event);
    if (event.type.startsWith('media:')) window.Views?.handleMediaEvent(event);
    if (event.type.startsWith('paper:')) window.Views?.handlePaperEvent(event);

    switch (event.type) {
      case 'config:updated':
        scheduleConfigSync();
        break;
      case 'sessions:refresh':
        refreshSessions();
        break;
      case 'notification:open':
        if (event.sessionId) {
          refreshSessions().then(() => loadSession(event.sessionId)).catch(() => {});
        }
        break;
      case 'session:updated':
        if (event.session) upsertSession(event.session);
        break;
      case 'workspace:changed':
        refreshWorkspaceTree();
        break;
      case 'skills:updated':
      case 'memory:updated':
      case 'learn:updated':
        refreshBadgesSoon();
        if (event.type === 'memory:updated') {
          safe(API.memory.list(), null).then((memory) => {
            if (memory?.entries) {
              state.memory = memory.entries;
              refreshRail();
            }
          });
        }
        break;
      case 'media:job':
      case 'media:asset':
      case 'media:removed':
      case 'paper:changed':
      case 'paper:removed':
        refreshBadgesSoon();
        break;
      case 'window:state':
        state.windowState = { maximized: Boolean(event.maximized), fullscreen: Boolean(event.fullscreen) };
        updateWindowControls();
        break;
      default:
        break;
    }
  }

  function flushEvents() {
    const events = pendingEvents;
    pendingEvents = [];
    for (const event of events) handleEvent(event);
  }

  /* ------------------------------------------------------------------- chrome */

  function updateWindowControls() {
    const button = qs('[data-win="maximize"]');
    if (!button) return;
    button.title = state.windowState.maximized ? 'Restore' : 'Maximize';
    button.setAttribute('aria-label', button.title);
  }

  function bindChrome() {
    qsa('[data-page]').forEach((button) => {
      button.addEventListener('click', () => openPage(button.dataset.page));
    });
    $('new-session')?.addEventListener('click', newSession);
    $('brand')?.addEventListener('click', () => openPage('chat'));
    qs('.brand')?.addEventListener('click', () => openPage('chat'));
    $('workspace-chip')?.addEventListener('click', () => openWorkspacePopover($('workspace-chip')));
    $('palette-trigger')?.addEventListener('click', openPalette);
    $('mobile-menu')?.addEventListener('click', toggleSidebar);
    $('mobile-scrim')?.addEventListener('click', closeMobilePanels);
    $('sidebar-model')?.addEventListener('click', () => openDefaultModelPicker($('sidebar-model')));

    $('window-controls')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-win]');
      if (!button) return;
      const action = button.dataset.win;
      if (action === 'minimize') API.window.minimize();
      else if (action === 'maximize') API.window.maximize().then((maximized) => {
        state.windowState.maximized = Boolean(maximized);
        updateWindowControls();
      }).catch(() => {});
      else if (action === 'close') API.window.close();
    });

    $('session-filter-btn')?.addEventListener('click', () => setSessionSearchOpen(!state.sessionSearchOpen));
    $('session-search')?.addEventListener('input', (event) => {
      state.sessionSearch = event.target.value;
      renderSessions();
    });
    $('session-search')?.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setSessionSearchOpen(false);
        $('session-filter-btn')?.focus();
      }
    });
    $('session-search-clear')?.addEventListener('click', () => {
      state.sessionSearch = '';
      const input = $('session-search');
      if (input) { input.value = ''; input.focus(); }
      renderSessions();
    });

    $('session-list')?.addEventListener('click', (event) => {
      const menuButton = event.target.closest('[data-session-menu]');
      if (menuButton) {
        event.stopPropagation();
        showSessionMenu(menuButton, findSession(menuButton.dataset.sessionMenu));
        return;
      }
      const item = event.target.closest('[data-session-id]');
      if (item) loadSession(item.dataset.sessionId);
    });
    $('session-list')?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const item = event.target.closest('[data-session-id]');
      if (!item) return;
      event.preventDefault();
      loadSession(item.dataset.sessionId);
    });

    $('rail-tabs')?.addEventListener('click', (event) => {
      const tab = event.target.closest('[data-rail]');
      if (!tab) return;
      state.railTab = tab.dataset.rail;
      renderRail();
    });
    $('rail-close')?.addEventListener('click', toggleRail);
    $('rail-body')?.addEventListener('click', (event) => {
      const dir = event.target.closest('[data-tree-dir]');
      if (dir) {
        const path = dir.dataset.treeDir;
        if (state.expanded.has(path)) state.expanded.delete(path);
        else state.expanded.add(path);
        document.getElementById('rail-body').innerHTML = filesMarkup();
        return;
      }
      const file = event.target.closest('[data-rail-file]');
      if (file) { App.openFilePreview(file.dataset.railFile); return; }
    });
    $('rail-body')?.addEventListener('input', (event) => {
      if (!event.target.matches('[data-rail-search]')) return;
      state.fileQuery = event.target.value;
      const host = $('rail-body')?.querySelector('[data-rail-tree]');
      if (host) host.innerHTML = railTreeMarkup();
    });
    $('rail-body')?.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && event.target.matches('[data-rail-search]')) {
        event.target.value = '';
        state.fileQuery = '';
        const host = $('rail-body')?.querySelector('[data-rail-tree]');
        if (host) host.innerHTML = railTreeMarkup();
      }
    });
    $('rail-open-editor')?.addEventListener('click', async () => {
      try {
        const result = await API.workspace.openEditor();
        if (!result || result.ok === false) UI.toast(result?.error || 'Could not open VS Code.', 'warn');
      } catch (error) { UI.toast(error.message, 'error'); }
    });
    $('rail-open-folder')?.addEventListener('click', async () => {
      try { await API.workspace.openPath(''); } catch (error) { UI.toast(error.message, 'error'); }
    });

    document.addEventListener('keydown', (event) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'k' || (key === 'p' && event.shiftKey)) {
        event.preventDefault();
        openPalette();
      } else if (key === 'n' && !event.shiftKey) {
        event.preventDefault();
        newSession();
      } else if (key === 'm') {
        event.preventDefault();
        openDefaultModelPicker($('sidebar-model'));
      } else if (key === ',') {
        event.preventDefault();
        openPage('settings');
      } else if (key === 'b' && event.shiftKey) {
        event.preventDefault();
        toggleRail();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (paletteOpen) return;
      if (document.body.classList.contains('modal-open')) return;
      if (state.sidebarOpen || state.railOverlay) {
        closeMobilePanels();
      }
    });

    const appOpenExternal = document.addEventListener('click', (event) => {
      const anchor = event.target.closest('[data-open-url]');
      if (!anchor) return;
      event.preventDefault();
      API.app.openExternal(anchor.dataset.openUrl);
    });
    void appOpenExternal;

    const mql = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    mql?.addEventListener?.('change', () => {
      if ((state.config?.theme || 'light') === 'system') applyTheme('system');
    });
    window.addEventListener('resize', U.debounce(handleResize, 80));
  }

  /* -------------------------------------------------------------------- boot */

  async function loadInitial() {
    const [config, models, sessions, tree, info] = await Promise.all([
      safe(API.config.get(), null),
      safe(API.models.list(), null),
      safe(API.sessions.list(), { sessions: [], workspace: '' }),
      safe(API.workspace.tree(), { workspace: '', tree: [] }),
      safe(API.app.info(), null),
    ]);

    const initialConfig = config || models?.config || null;
    if (initialConfig) setConfig(initialConfig);
    else {
      state.config = {
        version: 1,
        defaultModel: 'sandbox/blank-1',
        theme: 'light',
        onboarded: true,
        permissions: {},
        agent: {},
        ui: { railOpen: true },
        providers: {},
      };
    }
    if (models) applyCatalog(models);
    if (info) state.info = { ...(state.info || {}), ...info };
    if (state.config?.runtime) state.info = { ...(state.info || {}), ...state.config.runtime };

    state.sessions = sessions?.sessions || [];
    state.workspace = initialConfig?.workspace || tree?.workspace || '';
    state.tree = tree?.tree || [];
    state.railOpen = state.config?.ui?.railOpen !== false;
    state.railOverlay = false;

    window.ChatView?.mount();
    renderSessions();
    updateWorkspaceChrome();
    updateRuntimePill();
    applyTheme(state.config?.theme || 'light');
    refreshSidebarModel();
    renderRail();
    updateNav();
    applyRailVisibility();
    updateWindowControls();
    await loadBadges();
    state.ready = true;
    flushEvents();

    if (API.models?.discoverAll) {
      API.models.discoverAll().then(() => {
        if (state.page === 'models') window.Views?.render('models', $('page-view'));
      }).catch(() => {});
    }

    if (initialConfig && initialConfig.onboarded === false) {
      setTimeout(openOnboarding, 500);
    }
  }

  async function init() {
    Icons.hydrate(document);
    document.body.classList.add(`platform-${API.platform || 'win32'}`);
    const paletteKbd = $('kbd-palette');
    const newKbd = $('kbd-new');
    if (paletteKbd) paletteKbd.textContent = U.kbd('Ctrl K');
    if (newKbd) newKbd.textContent = U.kbd('Ctrl N');

    bindChrome();
    disposeEvents = API.onEvent(handleEvent);

    const splash = $('boot-splash');
    try {
      await loadInitial();
    } catch (error) {
      console.error('[blank] boot failed', error);
      UI.toast(`Blank could not finish loading: ${error.message}`, 'error', { timeout: 8000 });
      if (!state.ready) {
        window.ChatView?.mount();
        state.ready = true;
      }
    } finally {
      setTimeout(() => {
        splash?.classList.add('hide');
        setTimeout(() => splash?.remove(), 600);
      }, 240);
    }
  }

  App.init = init;
  App.handleEvent = handleEvent;
  App.openFilePreview = (path) => window.Views?.openFilePreview(path);
  App.openMedia = (id) => window.Views?.openMediaDetail(id);
  App.openPaper = (id) => window.Views?.openPaper(id);

  window.App = App;
  window.addEventListener('beforeunload', () => {
    disposeEvents?.();
    closePalette();
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
