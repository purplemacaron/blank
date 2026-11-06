/* blank pages — Models, Skills, Memory, MCP, Learning and Settings. */
(function () {
  'use strict';

  const vstate = {
    page: '',
    host: null,
    models: { providers: [], models: [], config: {}, filter: 'all', query: '' },
    skills: { items: [], filter: 'all', query: '' },
    memory: { items: [], query: '' },
    mcp: { servers: [], catalog: [], loading: false },
    learn: { data: null, reflecting: false },
    apis: { items: [], loading: false },
    code: { data: null, selected: '', diff: null, running: '', result: null, loading: false },
    console: { history: [], output: null, running: false, command: '' },
    team: { loading: false },
    automations: { schedules: [], running: [], loading: false, editing: '' },
    browserUrl: '',
    settings: { remote: null, ssh: null, schedules: [], dictationOptions: null, updates: null, messengers: null },
    paper: {
      loaded: false,
      items: [],
      counts: { html: 0, markdown: 0, svg: 0, code: 0, favorite: 0 },
      filter: 'all',
      favorite: false,
      query: '',
    },
    media: {
      loaded: false,
      loading: false,
      assets: [],
      total: 0,
      counts: { image: 0, video: 0, audio: 0, model3d: 0 },
      filter: 'all',
      favorite: false,
      query: '',
      view: 'grid',
      jobs: [],
      engines: null,
      storage: null,
      defaults: null,
      pending: null,
      compose: {
        kind: 'image',
        prompt: '',
        engine: '',
        model: '',
        aspect: '1:1',
        duration: 20,
        voice: '',
        rate: 0,
      },
    },
  };

  const KIND = {
    image: { label: 'Image', plural: 'Images', icon: 'image', noun: 'image' },
    video: { label: 'Video', plural: 'Video', icon: 'film', noun: 'video' },
    audio: { label: 'Audio', plural: 'Audio', icon: 'music', noun: 'audio' },
    model3d: { label: '3D', plural: '3D', icon: 'cube', noun: '3D object' },
  };

  const PAPER_KIND = {
    html: { label: 'Page', icon: 'book' },
    markdown: { label: 'Document', icon: 'file-text' },
    svg: { label: 'Graphic', icon: 'image' },
    code: { label: 'Code', icon: 'file-code' },
  };

  const PAPER_TEMPLATES = {
    html: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>A quiet page</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font: 15px/1.6 system-ui, sans-serif; color: #1d2733; background: #fbfbf9; }
    main { width: min(560px, 100%); padding: 48px 32px; }
    h1 { margin: 0 0 10px; font-size: 28px; letter-spacing: -0.02em; }
    p { margin: 0 0 18px; color: #5b6572; }
    a { color: #2f6bff; }
  </style>
</head>
<body>
  <main>
    <h1>A quiet page</h1>
    <p>Edit this paper, or ask the agent to build it out.</p>
  </main>
</body>
</html>`,
    markdown: `# A quiet document

Start writing, or ask the agent to draft it.
`,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 320" role="img" aria-label="A quiet graphic">
  <rect width="480" height="320" fill="#f7f8fb" />
  <circle cx="240" cy="160" r="84" fill="none" stroke="#2f6bff" stroke-width="2" />
  <path d="M156 160h168M240 76v168" stroke="#c9d6f5" stroke-width="1" />
</svg>
`,
    code: 'function greet(name) {\n  return "Hello, " + name + ".";\n}\n',
  };

  const PAPER_PLACEHOLDERS = {
    html: 'Write a page, or paste full HTML…',
    markdown: 'Write Markdown…',
    svg: 'Write an SVG graphic…',
    code: 'Paste a snippet…',
  };

  const TOOL_LABELS = {
    read_file: ['Read files', 'Read text files inside the workspace'],
    write_file: ['Create files', 'Create new files inside the workspace'],
    edit_file: ['Edit files', 'Modify existing files with exact replacements or line ranges'],
    deliver_file: ['Deliver files', 'Show a workspace file as a downloadable card in chat'],
    list_dir: ['List folders', 'Explore the workspace tree'],
    glob: ['Find files', 'Match file names with glob patterns'],
    grep: ['Search contents', 'Search text across the workspace'],
    run_command: ['Run commands', 'Execute shell commands in the workspace'],
    web_fetch: ['Fetch web pages', 'Read public http(s) pages and APIs'],
    web_search: ['Search the web', 'Look up current information with the configured search provider'],
    computer_screenshot: ['See your screen', 'Capture a screenshot for the agent to read'],
    computer_use: ['Control the computer', 'Move the cursor, click and type on your desktop'],
    todo_write: ['Update plans', 'Write the task list shown in the rail'],
    remember: ['Save memory', 'Store durable facts across sessions'],
    memory_search: ['Search memory', 'Recall saved facts and preferences'],
    read_skill: ['Read skills', 'Load a skill instruction file'],
    delegate: ['Delegate work', 'Send independent subtasks to agent workers'],
    team_delegate: ['Run the agent team', 'Fan a task out to specialist sub-agents in parallel'],
    ssh_run: ['Run on SSH hosts', 'Execute commands on saved remote machines'],
    list_media: ['List media', 'Browse the local media library'],
    generate_media: ['Generate media', 'Create images, video, music and 3D locally or in the cloud'],
    edit_media: ['Edit media', 'Transform media assets with deterministic operations'],
    create_paper: ['Create Paper', 'Write a live page, document, graphic or code paper'],
    update_paper: ['Update Paper', 'Revise a paper and raise its version'],
    read_paper: ['Read Paper', 'Open a paper from the library'],
    list_papers: ['List Papers', 'Browse the local Paper library'],
    mcp: ['MCP tools', 'Call tools exposed by connected MCP servers'],
  };

  const SEARCH_BACKENDS = [
    { id: 'duckduckgo', label: 'DuckDuckGo', note: 'No key needed', needsKey: false },
    { id: 'brave', label: 'Brave Search', note: 'API key', needsKey: true },
    { id: 'tavily', label: 'Tavily', note: 'API key', needsKey: true },
    { id: 'exa', label: 'Exa', note: 'API key', needsKey: true },
    { id: 'serper', label: 'Serper', note: 'API key', needsKey: true },
    { id: 'searxng', label: 'SearXNG', note: 'Your own URL', needsKey: false },
  ];

  const ENDPOINT_PRESETS = [
    { id: 'generic', label: 'Generic', name: '', protocol: 'openai', baseUrl: '', models: '' },
    { id: 'litellm', label: 'LiteLLM', name: 'LiteLLM', protocol: 'openai', baseUrl: 'http://localhost:4000/v1', models: '' },
    { id: 'vllm', label: 'vLLM', name: 'vLLM', protocol: 'openai', baseUrl: 'http://localhost:8000/v1', models: '' },
    { id: 'localai', label: 'LocalAI', name: 'LocalAI', protocol: 'openai', baseUrl: 'http://localhost:8080/v1', models: '' },
    { id: 'openwebui', label: 'Open WebUI', name: 'Open WebUI', protocol: 'openai', baseUrl: 'http://localhost:3000/api', models: '' },
    { id: 'jan', label: 'Jan', name: 'Jan', protocol: 'openai', baseUrl: 'http://localhost:1337/v1', models: '' },
  ];

  function appState() { return (window.App && App.state) || {}; }
  function currentConfig() { return appState().config || vstate.models.config || {}; }
  function alive(host, page) { return vstate.host === host && vstate.page === page && host.isConnected !== false; }
  function esc(value) { return U.esc(value); }

  function pageLoading(title, description) {
    return `<div class="page-inner">
      <header class="page-head"><div class="page-head-copy"><div class="page-title-row"><h1>${esc(title)}</h1></div><p>${esc(description || '')}</p></div></header>
      <div class="loading-panel"><span class="spinner"></span><span>Loading…</span></div>
    </div>`;
  }

  function pageError(host, title, error) {
    host.innerHTML = `<div class="page-inner">
      <header class="page-head"><div class="page-head-copy"><div class="page-title-row"><h1>${esc(title)}</h1></div></div></header>
      <div class="empty-state"><div class="empty-icon">${icon('alert-triangle', 22)}</div><h3>Could not load this page</h3><p>${esc(error && error.message ? error.message : String(error))}</p><div class="empty-actions"><button class="btn btn-secondary btn-sm" data-view-retry>${icon('refresh', 12)} Try again</button></div></div>
    </div>`;
    host.querySelector('[data-view-retry]')?.addEventListener('click', () => Views.render(vstate.page, host));
  }

  function applyCatalog(data) {
    if (!data) return;
    if (window.App?.applyCatalog) { App.applyCatalog(data); return; }
    if (window.App) {
      App.state.catalog = { providers: data.providers || [], models: data.models || [] };
      if (data.config) App.state.config = { ...App.state.config, ...data.config };
    }
  }

  function applyConfig(config) {
    if (!config) return;
    if (window.App?.setConfig) { App.setConfig(config); return; }
    if (window.App) App.state.config = { ...App.state.config, ...config };
  }

  function syncMediaBadge() {
    if (window.App?.refreshBadges) App.refreshBadges();
  }

  /* ------------------------------------------------------------------ models */

  function providerConfig(providerId) {
    return (currentConfig().providers || {})[providerId] || {};
  }

  function providerConnected(provider) {
    if (!provider) return false;
    if (provider.kind === 'local') return true;
    return Boolean(providerConfig(provider.id).hasKey);
  }

  function providerUsable(provider) {
    if (!provider) return false;
    if (provider.kind === 'local') return true;
    const config = providerConfig(provider.id);
    if (config.hasKey) return true;
    return provider.kind === 'custom' && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(config.baseUrl || '');
  }

  async function mountModels(host) {
    vstate.page = 'models';
    vstate.host = host;
    host.innerHTML = pageLoading('Models', 'Every provider you can reach from a single prompt.');
    try {
      const data = await API.models.list();
      if (!alive(host, 'models')) return;
      vstate.models.providers = data.providers || [];
      vstate.models.models = data.models || [];
      vstate.models.config = data.config || {};
      applyCatalog(data);
      paintModels(host);
    } catch (error) {
      if (alive(host, 'models')) pageError(host, 'Models', error);
    }
  }

  function paintModels(host) {
    const config = currentConfig();
    const defaultId = config.defaultModel || '';
    const fallbackId = config.fallbackModel || '';
    const providers = vstate.models.providers;
    const connectedCount = providers.filter(providerConnected).length;
    const usableModels = vstate.models.models.filter((model) => providerUsable(providers.find((provider) => provider.id === model.providerId))).length;
    host.innerHTML = `<div class="page-inner">
      ${UI.pageHeader({
        title: 'Models',
        description: 'Connect frontier, open and local providers. blank routes each session to the model you pick.',
        actions: `<button class="btn btn-secondary btn-sm" data-refresh-models>${icon('refresh', 12)} Refresh</button>
          <button class="btn btn-primary btn-sm" data-add-provider>${icon('plus', 12)} Add provider</button>`,
        meta: `<span class="badge blue">${providers.length} providers</span>`,
      })}
      <div class="models-banner">
        <div class="models-banner-copy">
          <div class="models-banner-title">Default model</div>
          <div class="models-banner-sub">${connectedCount} of ${providers.length} providers ready · ${usableModels} models available${fallbackId ? ` · fallback ${esc(U.modelLabel({ providers }, fallbackId))}` : ''}</div>
        </div>
        <button class="default-model-button ${defaultId ? '' : 'needs-model'}" type="button" data-pick-default title="${defaultId ? 'Change the default model' : 'Choose the default model'}">
          ${defaultId ? UI.providerMono(U.providerOf({ providers }, defaultId)) : `<span class="default-model-icon">${icon('cpu', 15)}</span>`}
          <span class="copy"><span class="name">${esc(defaultId ? U.modelLabel({ providers }, defaultId) : 'Choose a model')}</span><span class="label">${defaultId ? `${esc((U.providerOf({ providers }, defaultId) || {}).name || 'Model')} · ${U.kbd('Ctrl M')}` : `<span>No model connected</span> · ${U.kbd('Ctrl M')}`}</span></span>
          ${icon('chevron-updown', 13)}
        </button>
      </div>
      <div class="toolbar-row">
        <div class="filter-chips">
          <button class="filter-chip ${vstate.models.filter === 'all' ? 'active' : ''}" type="button" data-mfilter="all">All <span class="count">${providers.length}</span></button>
          <button class="filter-chip ${vstate.models.filter === 'connected' ? 'active' : ''}" type="button" data-mfilter="connected">Connected <span class="count">${connectedCount}</span></button>
          <button class="filter-chip ${vstate.models.filter === 'local' ? 'active' : ''}" type="button" data-mfilter="local">Local <span class="count">${providers.filter((p) => p.kind === 'local').length}</span></button>
          <button class="filter-chip ${vstate.models.filter === 'custom' ? 'active' : ''}" type="button" data-mfilter="custom">Custom <span class="count">${providers.filter((p) => p.kind === 'custom').length}</span></button>
        </div>
        <div class="toolbar-spacer"></div>
        <label class="search-field">
          ${icon('search', 13)}
          <input id="model-search" class="field-input" type="search" placeholder="Search providers or models" value="${U.attr(vstate.models.query)}" spellcheck="false" />
        </label>
      </div>
      <div id="model-grid" class="provider-grid"></div>
      <p class="custom-note">Keys are stored only on this machine in <code>~/.blank/config.json</code> and are never rendered back in full. Local providers need no key.</p>
    </div>`;
    paintModelGrid(host);
    const search = host.querySelector('#model-search');
    if (search) {
      search.addEventListener('input', () => {
        vstate.models.query = search.value;
        paintModelGrid(host);
      });
    }
    host.onclick = (event) => {
      const filter = event.target.closest('[data-mfilter]');
      if (filter) {
        vstate.models.filter = filter.dataset.mfilter;
        for (const button of host.querySelectorAll('[data-mfilter]')) button.classList.toggle('active', button === filter);
        paintModelGrid(host);
        return;
      }
      const card = event.target.closest('[data-provider]');
      if (card) {
        const provider = vstate.models.providers.find((p) => p.id === card.dataset.provider);
        if (provider) openProviderDetail(provider, () => mountModels(host));
        return;
      }
      if (event.target.closest('[data-pick-default]')) {
        openModelPicker(null, {
          current: currentConfig().defaultModel,
          title: 'Default model',
          onSelect: (fullId) => setDefaultModel(fullId),
        });
        return;
      }
      if (event.target.closest('[data-add-provider]')) { openAddProvider(() => mountModels(host)); return; }
      if (event.target.closest('[data-refresh-models]')) { mountModels(host); return; }
    };
  }

  function paintModelGrid(host) {
    const grid = host.querySelector('#model-grid');
    if (!grid) return;
    const { providers, filters } = vstate.models;
    const query = vstate.models.query.trim().toLowerCase();
    const filter = vstate.models.filter;
    let list = providers.filter((provider) => {
      if (filter === 'connected' && !providerConnected(provider)) return false;
      if (filter === 'local' && provider.kind !== 'local') return false;
      if (filter === 'custom' && provider.kind !== 'custom') return false;
      if (!query) return true;
      if (`${provider.name} ${provider.id} ${provider.description || ''}`.toLowerCase().includes(query)) return true;
      return (provider.models || []).some((model) => `${model.name} ${model.id}`.toLowerCase().includes(query));
    });
    if (!list.length) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">${icon('search', 20)}</div><h3>No matching providers</h3><p>Try a different search or filter.</p></div>`;
      return;
    }
    grid.innerHTML = list.map((provider) => {
      const connected = providerConnected(provider);
      const entry = providerConfig(provider.id);
      const modelCount = (provider.models || []).length;
      const countLabel = modelCount
        ? `${modelCount} model${modelCount === 1 ? '' : 's'}`
        : connected ? 'No models yet' : 'Models via key';
      const kindLabel = provider.kind === 'local' ? 'Local runtime' : provider.kind === 'custom' ? 'Custom endpoint' : (provider.protocol || 'Cloud');
      return `<button class="provider-card ${connected ? 'connected' : ''}" type="button" data-provider="${U.attr(provider.id)}">
        <div class="provider-card-top">
          ${UI.providerMono(provider)}
          <div style="min-width:0;flex:1"><div class="provider-name">${esc(provider.name)}</div><div class="provider-kind">${esc(kindLabel)}</div></div>
          <span class="provider-status"><span class="status-dot ${connected ? 'on' : 'off'}"></span>${connected ? 'Ready' : 'No key'}</span>
        </div>
        <p class="provider-desc">${esc(provider.description || (provider.kind === 'custom' ? 'Custom OpenAI-compatible endpoint.' : 'Connect a key to use this provider.'))}</p>
        <div class="provider-card-foot">
          ${icon('layers', 11)} ${countLabel}
          <span class="sep"></span>
          ${connected
            ? `<span class="key-on">${icon('check-circle', 11)} ${provider.kind === 'local' ? 'Local' : entry.keyCount > 1 ? `${entry.keyCount} keys` : entry.keySource === 'env' ? 'Environment' : 'Key saved'}</span>`
            : `<span class="key-off">${icon('key', 11)} Add a key</span>`}
          <span style="margin-left:auto">${icon('chevron-right', 12)}</span>
        </div>
      </button>`;
    }).join('');
  }

  async function setDefaultModel(fullId) {
    try {
      const config = await API.config.update({ defaultModel: fullId });
      applyConfig(config);
      UI.toast(`Default model set to ${U.modelLabel(appState().catalog, fullId)}.`, 'success');
      if (vstate.page === 'models') paintModels(vstate.host);
      if (window.App?.refreshSidebarModel) App.refreshSidebarModel();
    } catch (error) { UI.toast(error.message, 'error'); }
  }

  function openProviderDetail(provider, onChanged) {
    let entry = providerConfig(provider.id);
    const local = provider.kind === 'local';
    const body = document.createElement('div');
    body.innerHTML = `
      <div class="provider-detail-hero">
        ${UI.providerMono(provider)}
        <div class="provider-detail-copy">
          <h3>${esc(provider.name)}</h3>
          <p>${esc(provider.description || '')}</p>
        </div>
        <span class="badge ${providerConnected(provider) ? 'green' : ''} dot" id="provider-badge">${providerConnected(provider) ? 'Connected' : 'Not connected'}</span>
      </div>
      ${local
        ? `<div class="setting-note" style="margin-bottom:14px">${icon('monitor', 11)} This provider runs on your machine. No key is required.</div>`
        : `<div class="key-section">
            <div class="key-section-head">
              <div>
                <div class="key-section-title">API keys</div>
                <div class="key-section-sub">Stored only on this machine.</div>
              </div>
              <span class="badge" id="provider-key-count"></span>
            </div>
            <div class="key-list" id="provider-key-list"></div>
            <div class="key-add">
              <input class="field-input key-label-input" id="provider-key-label" maxlength="40" placeholder="Label (optional)" />
              <input class="field-input" id="provider-key" type="password" autocomplete="off" spellcheck="false" placeholder="Paste an API key" />
              <button class="btn btn-primary btn-sm" type="button" data-add-key>${icon('plus', 12)} Add key</button>
            </div>
            <div class="key-rotate-row">
              <div class="key-rotate-copy"><b>Rotate on failure</b><span>Retry with the next key on 401, 402, 403 or 429.</span></div>
              <span id="provider-rotate"></span>
            </div>
            ${provider.keyEnv ? `<div class="setting-note" style="margin-top:8px">${icon('terminal', 11)} ${esc(provider.keyEnv)} is used as a final fallback and never stored.</div>` : ''}
          </div>`}
      <div class="field" style="margin-top:14px">
        <span class="field-label">Base URL <small>optional override</small></span>
        <div class="key-row">
          <input class="field-input" id="provider-base" type="url" spellcheck="false" placeholder="${U.attr(provider.baseUrl || 'Provider default')}" value="${U.attr(entry.baseUrl || '')}" />
          <button class="btn btn-secondary btn-sm" type="button" data-save-base>Save</button>
        </div>
      </div>
      <div class="provider-actions" style="margin-top:10px">
        <button class="btn btn-secondary btn-sm" type="button" data-test-provider>${icon('zap', 12)} Test connection</button>
        <button class="btn btn-secondary btn-sm" type="button" data-discover>${icon('refresh', 12)} Discover models</button>
        ${provider.docs ? `<button class="btn btn-ghost btn-sm" type="button" data-open-docs>${icon('external-link', 12)} Get a key</button>` : ''}
      </div>
      <div class="test-result" id="provider-test" hidden></div>
      <div class="settings-section" style="margin-top:18px">
        <h2 style="font-size:12px;margin-bottom:6px">Available models <span class="badge" id="provider-model-count">${(provider.models || []).length || ''}</span></h2>
        <div class="provider-model-list" id="provider-models"></div>
      </div>
      ${provider.kind === 'custom' ? `<div class="provider-actions"><button class="btn btn-danger-soft btn-sm" type="button" data-remove-provider>${icon('trash', 12)} Remove provider</button></div>` : ''}
    `;

    const modal = UI.modal({
      title: provider.name,
      description: providerConnected(provider) ? 'Ready to route requests.' : 'Add a key to start using this provider.',
      size: 'large',
      body,
    });

    let discovering = false;

    function paintModels(status) {
      const list = body.querySelector('#provider-models');
      const models = provider.models || [];
      const config = currentConfig();
      const activeDefault = config.defaultModel;
      const usable = providerUsable(provider);
      const count = body.querySelector('#provider-model-count');
      if (count) count.textContent = models.length ? String(models.length) : '';
      let note = '';
      if (!usable) {
        note = `<div class="setting-note model-key-note">${icon('key', 11)} Add a key above to load models from this provider.</div>`;
      } else if (!models.length) {
        note = status === 'loading'
          ? `<div class="setting-note model-key-note"><span class="spinner" style="width:10px;height:10px"></span> Fetching models from the provider…</div>`
          : `<div class="setting-note model-key-note">${icon('refresh', 11)} No models yet. Try Discover models.</div>`;
      }
      list.innerHTML = note + models.map((model) => {
        const fullId = `${provider.id}/${model.id}`;
        const isDefault = fullId === activeDefault;
        return `<div class="provider-model-row">
          <div style="min-width:0;flex:1">
            <div class="model-name">${esc(model.name || model.id)}</div>
            <div class="model-id">${esc(fullId)}${model.context ? ` · ${U.fmtNumber(model.context)} ctx` : ''}</div>
          </div>
          <div class="model-tags">${(model.tags || []).slice(0, 3).map((tag) => `<span class="badge">${esc(tag)}</span>`).join('')}</div>
          ${usable
            ? `<button class="model-use-btn" type="button" data-use-model="${U.attr(fullId)}" ${isDefault ? 'disabled' : ''}>${isDefault ? `${icon('check', 10)} Default` : 'Use'}</button>`
            : `<button class="model-use-btn" type="button" data-focus-key="1">Add key</button>`}
        </div>`;
      }).join('');
    }

    async function loadModels(options = {}) {
      if (discovering) return;
      discovering = true;
      if (options.loading) paintModels('loading');
      try {
        const result = await API.models.discover(provider.id);
        if (!result.ok) throw new Error(result.error || 'No models returned.');
        const fresh = await API.models.list();
        vstate.models.providers = fresh.providers || [];
        vstate.models.models = fresh.models || [];
        vstate.models.config = fresh.config || {};
        applyCatalog(fresh);
        const updated = vstate.models.providers.find((p) => p.id === provider.id);
        if (updated) provider.models = updated.models;
        await refreshEntry();
        paintModels();
        if (!options.quiet) UI.toast(`${result.models?.length || 0} models discovered.`, 'success');
        onChanged?.();
      } catch (error) {
        paintModels();
        if (!options.quiet) UI.toast(error.message, 'error');
      } finally {
        discovering = false;
      }
    }

    function paintKeys() {
      if (local) return;
      const keys = entry.keys || [];
      const list = body.querySelector('#provider-key-list');
      const count = body.querySelector('#provider-key-count');
      if (count) count.textContent = `${keys.length} key${keys.length === 1 ? '' : 's'}`;
      if (list) {
        list.innerHTML = keys.length ? keys.map((key) => `<div class="key-item ${key.active ? 'active' : ''}">
          <span class="key-active-mark">${key.active ? icon('check', 10) : ''}</span>
          <div class="key-item-copy">
            <div class="key-item-title">
              <b>${esc(key.label || 'API key')}</b>
              <code>${esc(key.preview || '••••')}</code>
              ${key.active ? '<span class="badge blue">Active</span>' : ''}
              <span class="badge">${key.source === 'env' ? 'Environment' : 'Saved'}</span>
            </div>
            <div class="key-item-meta">
              ${key.lastUsedAt ? `Last used ${esc(U.relativeTime(key.lastUsedAt))}` : 'Not used yet'}
              ${key.lastError ? `<span class="key-error">${icon('alert-circle', 9)} ${esc(U.truncate(key.lastError, 80))}</span>` : ''}
            </div>
          </div>
          ${!key.active && key.removable ? `<button class="btn btn-ghost btn-xs" type="button" data-key-use="${U.attr(key.id)}">Use</button>` : ''}
          ${key.removable ? `<button class="mini-icon" type="button" data-key-remove="${U.attr(key.id)}" title="Remove key">${icon('trash', 12)}</button>` : ''}
        </div>`).join('') : `<div class="key-empty">${icon('key', 14)}<span>No key yet. Paste one above — it stays on this machine.</span></div>`;
      }
      const rotate = body.querySelector('#provider-rotate');
      if (rotate) rotate.innerHTML = UI.switchHtml(entry.autoRotate !== false, 'data-auto-rotate');
      const badge = body.querySelector('#provider-badge');
      if (badge) {
        const ready = Boolean((entry.keys || []).length) || keys.length > 0;
        badge.className = `badge ${ready ? 'green' : ''} dot`;
        badge.textContent = ready ? 'Connected' : 'Not connected';
      }
      const meta = modal?.element?.querySelector('.modal-head .modal-desc');
      if (meta) meta.textContent = keys.length ? 'Ready to route requests.' : 'Add a key to start using this provider.';
    }

    async function refreshEntry() {
      const config = await API.config.get();
      applyConfig(config);
      entry = (config.providers || {})[provider.id] || {};
      paintKeys();
    }

    paintModels();
    paintKeys();

    if (providerUsable(provider) && !(provider.models || []).length) {
      setTimeout(() => {
        if (modal.element?.isConnected) loadModels({ quiet: true, loading: true });
      }, 250);
    }

    const testBox = body.querySelector('#provider-test');

    body.addEventListener('click', async (event) => {
      if (event.target.closest('[data-add-key]')) {
        const button = event.target.closest('[data-add-key]');
        const input = body.querySelector('#provider-key');
        const value = input?.value.trim() || '';
        if (!value) { UI.toast('Paste an API key first.', 'warn'); input?.focus(); return; }
        button.disabled = true;
        try {
          const result = await API.models.addKey({
            providerId: provider.id,
            key: value,
            label: body.querySelector('#provider-key-label')?.value.trim() || 'API key',
            makeActive: true,
          });
          applyConfig(result.config);
          entry = (result.config.providers || {})[provider.id] || {};
          if (input) input.value = '';
          const label = body.querySelector('#provider-key-label');
          if (label) label.value = '';
          paintKeys();
          UI.toast('Key added and made active.', 'success');
          onChanged?.();
          void loadModels({ loading: true });
        } catch (error) { UI.toast(error.message, 'error'); }
        finally { button.disabled = false; }
        return;
      }

      const use = event.target.closest('[data-key-use]');
      if (use) {
        use.disabled = true;
        try {
          const config = await API.models.setActiveKey({ providerId: provider.id, keyId: use.dataset.keyUse });
          applyConfig(config);
          entry = (config.providers || {})[provider.id] || {};
          paintKeys();
          UI.toast('Active key changed.', 'success');
        } catch (error) { UI.toast(error.message, 'error'); use.disabled = false; }
        return;
      }

      const remove = event.target.closest('[data-key-remove]');
      if (remove) {
        const ok = await UI.confirm({
          title: 'Remove this key?',
          message: 'Requests will use your next saved key, the environment key, or fail until you add another key.',
          confirmLabel: 'Remove key', danger: true, detail: provider.name,
        });
        if (!ok) return;
        try {
          const config = await API.models.removeKey({ providerId: provider.id, keyId: remove.dataset.keyRemove });
          applyConfig(config);
          entry = (config.providers || {})[provider.id] || {};
          paintKeys();
          UI.toast('Key removed.', 'success');
          onChanged?.();
        } catch (error) { UI.toast(error.message, 'error'); }
        return;
      }

      const rotate = event.target.closest('[data-auto-rotate]');
      if (rotate) {
        const next = !rotate.classList.contains('on');
        rotate.classList.toggle('on', next);
        rotate.setAttribute('aria-checked', String(next));
        try {
          const config = await API.models.setAutoRotate({ providerId: provider.id, autoRotate: next });
          applyConfig(config);
          entry = (config.providers || {})[provider.id] || {};
          UI.toast(next ? 'Key rotation enabled.' : 'Key rotation disabled.', 'success');
        } catch (error) { rotate.classList.toggle('on', !next); UI.toast(error.message, 'error'); }
        return;
      }

      if (event.target.closest('[data-save-base]')) {
        const baseUrl = body.querySelector('#provider-base')?.value.trim() || '';
        try {
          const config = await API.models.setKey({ providerId: provider.id, baseUrl });
          applyConfig(config);
          entry = (config.providers || {})[provider.id] || {};
          UI.toast(baseUrl ? 'Base URL saved.' : 'Using the provider default URL.', 'success');
        } catch (error) { UI.toast(error.message, 'error'); }
        return;
      }

      if (event.target.closest('[data-test-provider]')) {
        const button = event.target.closest('[data-test-provider]');
        button.disabled = true;
        button.innerHTML = `<span class="spinner" style="width:11px;height:11px"></span> Testing…`;
        testBox.hidden = false;
        testBox.className = 'test-result';
        testBox.textContent = 'Contacting the provider…';
        try {
          const typed = body.querySelector('#provider-key')?.value.trim();
          const result = await API.models.test({
            providerId: provider.id,
            apiKey: typed || undefined,
            baseUrl: body.querySelector('#provider-base')?.value.trim() || undefined,
          });
          if (result.ok) {
            testBox.className = 'test-result ok';
            testBox.innerHTML = `${icon('check-circle', 12)} Connected · ${result.count} models reachable${result.models?.length ? `<div class="test-models">${result.models.slice(0, 8).map((m) => `<span class="test-model-chip">${esc(m.name || m.id)}</span>`).join('')}</div>` : ''}`;
          } else {
            testBox.className = 'test-result bad';
            testBox.innerHTML = `${icon('alert-circle', 12)} ${esc(result.error || 'The provider did not respond.')}`;
          }
        } catch (error) {
          testBox.className = 'test-result bad';
          testBox.textContent = error.message;
        } finally {
          button.disabled = false;
          button.innerHTML = `${icon('zap', 12)} Test connection`;
        }
        return;
      }

      if (event.target.closest('[data-discover]')) {
        const button = event.target.closest('[data-discover]');
        button.disabled = true;
        button.innerHTML = `<span class="spinner" style="width:11px;height:11px"></span> Discovering…`;
        await loadModels({ loading: true });
        button.disabled = false;
        button.innerHTML = `${icon('refresh', 12)} Discover models`;
        return;
      }

      if (event.target.closest('[data-open-docs]')) {
        if (provider.docs) API.app.openExternal(provider.docs).catch((error) => UI.toast(error.message, 'error'));
        return;
      }

      if (event.target.closest('[data-remove-provider]')) {
        const ok = await UI.confirm({
          title: 'Remove custom provider?',
          message: 'The provider entry and all of its saved keys will be deleted from this machine.',
          confirmLabel: 'Remove provider',
          danger: true,
          detail: provider.name,
        });
        if (!ok) return;
        try {
          await API.models.removeCustom(provider.id);
          modal.close();
          UI.toast('Provider removed.', 'success');
          onChanged?.();
        } catch (error) { UI.toast(error.message, 'error'); }
        return;
      }

      const focusKey = event.target.closest('[data-focus-key]');
      if (focusKey) {
        body.querySelector('#provider-key')?.focus();
        return;
      }

      const useModel = event.target.closest('[data-use-model]');
      if (useModel && !useModel.disabled) {
        useModel.disabled = true;
        try {
          const config = await API.config.update({ defaultModel: useModel.dataset.useModel });
          applyConfig(config);
          paintModels();
          UI.toast('Default model updated.', 'success');
          if (window.App?.refreshSidebarModel) App.refreshSidebarModel();
        } catch (error) { UI.toast(error.message, 'error'); useModel.disabled = false; }
      }
    });
  }

  function openAddProvider(onChanged) {
    const builtins = (vstate.models.providers || []).filter((provider) => provider.kind !== 'custom');
    const body = document.createElement('div');
    body.innerHTML = `
      <div class="section-mini-label">Quick connect</div>
      <div class="quick-provider-grid">
        ${builtins.map((provider) => {
          const ready = providerConnected(provider);
          return `<button class="quick-provider" type="button" data-quick-provider="${U.attr(provider.id)}">
            ${UI.providerMono(provider)}
            <span class="quick-provider-copy">
              <span class="quick-provider-name">${esc(provider.name)}</span>
              <span class="quick-provider-state ${ready ? 'ready' : ''}">${provider.kind === 'local' ? (ready ? 'Local runtime' : 'Start it, then manage') : ready ? 'Connected' : 'Add a key'}</span>
            </span>
            ${icon(ready ? 'settings' : 'plus', 12)}
          </button>`;
        }).join('')}
      </div>
      <div class="divider-label">or add a custom endpoint</div>
      <div class="preset-chips">
        ${ENDPOINT_PRESETS.map((preset) => `<button class="preset-chip ${preset.id === 'generic' ? 'active' : ''}" type="button" data-preset="${preset.id}">${esc(preset.label)}</button>`).join('')}
      </div>
      <div class="field-grid">
        ${UI.field({ label: 'Display name', control: '<input class="field-input" id="custom-name" type="text" placeholder="Acme Gateway" maxlength="60" />' })}
        ${UI.field({ label: 'Protocol', control: `<select class="field-select" id="custom-protocol">
          <option value="openai">OpenAI compatible</option>
          <option value="anthropic">Anthropic compatible</option>
          <option value="gemini">Gemini compatible</option>
        </select>` })}
      </div>
      ${UI.field({ label: 'Base URL', hint: 'https://', control: '<input class="field-input" id="custom-base" type="url" placeholder="https://api.example.com/v1" spellcheck="false" />' })}
      <div class="field-grid">
        ${UI.field({ label: 'API key', hint: 'optional, add later', control: '<input class="field-input" id="custom-key" type="password" autocomplete="off" placeholder="sk-…" />' })}
        ${UI.field({ label: 'Key label', hint: 'optional', control: '<input class="field-input" id="custom-key-label" type="text" placeholder="Personal" maxlength="40" />' })}
      </div>
      ${UI.field({ label: 'Models', hint: 'one per line or comma separated', control: `<div class="model-fetch-row"><textarea class="field-textarea" id="custom-models" rows="3" placeholder="model-a\nmodel-b"></textarea></div><span class="setting-note" id="fetch-note"></span>` })}
      <div class="provider-actions" style="margin-top:2px">
        <button class="btn btn-secondary btn-sm" type="button" id="fetch-models">${icon('refresh', 12)} Fetch models</button>
        <span class="setting-note" style="margin:0">Queries <code>/models</code> on the endpoint using the values above.</span>
      </div>
      <p class="custom-note">Any OpenAI, Anthropic or Gemini compatible API works. Add several keys per provider later for rotation. Keys stay local, and requests go directly from this machine to your endpoint.</p>
    `;
    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;justify-content:flex-end;gap:6px;width:100%';
    footer.innerHTML = `<button class="btn btn-ghost btn-sm" data-cancel>Cancel</button><button class="btn btn-primary btn-sm" data-create>${icon('plus', 12)} Add provider</button>`;
    const modal = UI.modal({ title: 'Add a provider', description: 'Connect a built-in provider in one click or point blank at any compatible endpoint.', body, footer, size: 'large' });

    const nameInput = body.querySelector('#custom-name');
    const protocolInput = body.querySelector('#custom-protocol');
    const baseInput = body.querySelector('#custom-base');
    const keyInput = body.querySelector('#custom-key');
    const keyLabelInput = body.querySelector('#custom-key-label');
    const modelsInput = body.querySelector('#custom-models');
    const fetchNote = body.querySelector('#fetch-note');

    body.addEventListener('click', (event) => {
      const quick = event.target.closest('[data-quick-provider]');
      if (quick) {
        const provider = builtins.find((entry) => entry.id === quick.dataset.quickProvider);
        if (!provider) return;
        modal.close();
        openProviderDetail(provider, () => onChanged?.());
        return;
      }
      const preset = event.target.closest('[data-preset]');
      if (preset) {
        const config = ENDPOINT_PRESETS.find((entry) => entry.id === preset.dataset.preset);
        if (!config) return;
        for (const chip of body.querySelectorAll('[data-preset]')) chip.classList.toggle('active', chip === preset);
        nameInput.value = config.name;
        protocolInput.value = config.protocol;
        baseInput.value = config.baseUrl;
        modelsInput.value = config.models;
        fetchNote.textContent = '';
        if (!config.name) nameInput.focus();
        return;
      }
      if (event.target.closest('#fetch-models')) {
        probeModels();
      }
    });

    async function probeModels() {
      const baseUrl = baseInput.value.trim();
      if (!/^https?:\/\//i.test(baseUrl)) { UI.toast('Enter a valid http(s) base URL first.', 'warn'); baseInput.focus(); return; }
      const button = body.querySelector('#fetch-models');
      button.disabled = true;
      fetchNote.textContent = 'Fetching…';
      try {
        const result = await API.models.probe({
          protocol: protocolInput.value,
          baseUrl,
          apiKey: keyInput.value.trim(),
        });
        if (!result.ok) throw new Error(result.error || 'Could not list models.');
        const ids = (result.models || []).map((model) => model.id).filter(Boolean);
        if (!ids.length) throw new Error('The endpoint returned no models.');
        modelsInput.value = ids.slice(0, 40).join('\n');
        fetchNote.textContent = `${ids.length} model${ids.length === 1 ? '' : 's'} found. Edit the list before adding.`;
      } catch (error) {
        fetchNote.textContent = '';
        UI.toast(error.message, 'error');
      } finally { button.disabled = false; }
    }

    footer.querySelector('[data-cancel]').addEventListener('click', () => modal.close());
    const create = footer.querySelector('[data-create]');
    create.addEventListener('click', async () => {
      const name = nameInput.value.trim() || 'Custom provider';
      const baseUrl = baseInput.value.trim();
      const apiKey = keyInput.value.trim();
      if (!/^https?:\/\//i.test(baseUrl)) { UI.toast('Enter a valid http(s) base URL.', 'warn'); baseInput.focus(); return; }
      create.disabled = true;
      create.innerHTML = `<span class="spinner" style="width:11px;height:11px"></span> Adding…`;
      try {
        let models = modelsInput.value;
        if (!models.trim() && apiKey) {
          const probe = await API.models.probe({ protocol: protocolInput.value, baseUrl, apiKey }).catch(() => null);
          if (probe?.ok && probe.models?.length) {
            models = probe.models.slice(0, 40).map((model) => model.id).join('\n');
          }
        }
        await API.models.addCustom({
          name,
          protocol: protocolInput.value,
          baseUrl,
          models,
          apiKey,
          keyLabel: keyLabelInput.value.trim() || 'Default',
        });
        modal.close();
        UI.toast(`${name} is ready.`, 'success');
        onChanged?.();
      } catch (error) { UI.toast(error.message, 'error'); create.disabled = false; create.innerHTML = `${icon('plus', 12)} Add provider`; }
    });
  }

  /* ------------------------------------------------------------------- skills */

  function sourceLabel(source) {
    return ({ bundled: 'Bundled', global: 'Global', project: 'Project' })[source] || source;
  }

  async function mountSkills(host) {
    vstate.page = 'skills';
    vstate.host = host;
    host.innerHTML = pageLoading('Skills', 'Reusable instruction packs the agent can load on demand.');
    try {
      const result = await API.skills.list();
      if (!alive(host, 'skills')) return;
      vstate.skills.items = result.skills || [];
      paintSkills(host);
    } catch (error) { if (alive(host, 'skills')) pageError(host, 'Skills', error); }
  }

  function paintSkills(host) {
    const items = vstate.skills.items;
    const enabled = items.filter((s) => s.enabled).length;
    host.innerHTML = `<div class="page-inner">
      ${UI.pageHeader({
        title: 'Skills',
        description: 'Teach blank repeatable workflows. Skills are plain SKILL.md files stored on this machine or in your project.',
        actions: `<button class="btn btn-secondary btn-sm" data-open-skills-folder>${icon('folder-open', 12)} Open folder</button>
          <button class="btn btn-primary btn-sm" data-new-skill>${icon('plus', 12)} New skill</button>`,
        meta: `<span class="badge green">${enabled} active</span>`,
      })}
      <div class="toolbar-row">
        <div class="filter-chips">
          ${['all', 'bundled', 'global', 'project', 'disabled'].map((value) => {
            const count = value === 'all' ? items.length : value === 'disabled' ? items.filter((s) => !s.enabled).length : items.filter((s) => s.source === value).length;
            return `<button class="filter-chip ${vstate.skills.filter === value ? 'active' : ''}" type="button" data-sfilter="${value}">${esc(value === 'all' ? 'All' : value === 'disabled' ? 'Disabled' : sourceLabel(value))} <span class="count">${count}</span></button>`;
          }).join('')}
        </div>
        <div class="toolbar-spacer"></div>
        <label class="search-field">${icon('search', 13)}<input class="field-input" id="skill-search" type="search" placeholder="Search skills" value="${U.attr(vstate.skills.query)}" spellcheck="false" /></label>
      </div>
      <div class="skills-grid" id="skill-grid"></div>
    </div>`;
    paintSkillGrid(host);
    host.querySelector('#skill-search')?.addEventListener('input', (event) => {
      vstate.skills.query = event.target.value;
      paintSkillGrid(host);
    });
    host.onclick = async (event) => {
      const filter = event.target.closest('[data-sfilter]');
      if (filter) {
        vstate.skills.filter = filter.dataset.sfilter;
        for (const b of host.querySelectorAll('[data-sfilter]')) b.classList.toggle('active', b === filter);
        paintSkillGrid(host);
        return;
      }
      if (event.target.closest('[data-new-skill]')) { openSkillComposer(() => mountSkills(host)); return; }
      if (event.target.closest('[data-open-skills-folder]')) {
        API.skills.openFolder().catch((error) => UI.toast(error.message, 'error'));
        return;
      }
      const toggle = event.target.closest('[data-skill-toggle]');
      if (toggle) {
        event.stopPropagation();
        const id = toggle.dataset.skillToggle;
        const next = !toggle.classList.contains('on');
        toggle.classList.toggle('on', next);
        toggle.setAttribute('aria-checked', String(next));
        try {
          const result = await API.skills.toggle({ id, enabled: next });
          vstate.skills.items = result.skills || vstate.skills.items;
          const item = vstate.skills.items.find((s) => s.id === id);
          if (item) item.enabled = next;
          if (window.App?.refreshBadges) App.refreshBadges();
          const card = toggle.closest('.skill-card');
          card?.classList.toggle('disabled', !next);
          UI.toast(next ? 'Skill enabled.' : 'Skill disabled.', 'success');
        } catch (error) { toggle.classList.toggle('on', !next); UI.toast(error.message, 'error'); }
        return;
      }
      const card = event.target.closest('[data-skill]');
      if (card) openSkillDetail(card.dataset.skill, () => mountSkills(host));
    };
  }

  function paintSkillGrid(host) {
    const grid = host.querySelector('#skill-grid');
    if (!grid) return;
    const query = vstate.skills.query.trim().toLowerCase();
    const filter = vstate.skills.filter;
    const items = vstate.skills.items.filter((skill) => {
      if (filter === 'disabled' && skill.enabled) return false;
      if (filter !== 'all' && filter !== 'disabled' && skill.source !== filter) return false;
      if (!query) return true;
      return `${skill.name} ${skill.slug} ${skill.description}`.toLowerCase().includes(query);
    });
    if (!items.length) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">${icon('layers', 20)}</div><h3>No skills here yet</h3><p>Create a skill to capture a workflow you repeat.</p><div class="empty-actions"><button class="btn btn-primary btn-sm" data-new-skill>${icon('plus', 12)} New skill</button></div></div>`;
      grid.querySelector('[data-new-skill]')?.addEventListener('click', () => openSkillComposer(() => mountSkills(host)));
      return;
    }
    grid.innerHTML = items.map((skill, index) => `<div class="skill-card ${skill.enabled ? '' : 'disabled'}" data-skill="${U.attr(skill.id)}" role="button" tabindex="0">
      <div class="skill-card-top">
        <span class="skill-glyph ${index % 3 === 1 ? 'alt' : ''}">${esc((skill.name || 'S').slice(0, 1).toUpperCase())}</span>
        <div style="min-width:0;flex:1">
          <div class="skill-name">${esc(skill.name)}</div>
          <div class="skill-source">${esc(sourceLabel(skill.source))}${skill.version ? ` · v${esc(skill.version)}` : ''}</div>
        </div>
        ${UI.switchHtml(skill.enabled, `data-skill-toggle="${U.attr(skill.id)}"`)}
      </div>
      <p class="skill-desc">${esc(skill.description || 'No description yet.')}</p>
      <div class="skill-foot">
        <span class="badge ${skill.source === 'project' ? 'violet' : skill.source === 'global' ? 'blue' : ''}">${esc(sourceLabel(skill.source))}</span>
        <span class="badge dot ${skill.enabled ? 'green' : ''}">${skill.enabled ? 'Active' : 'Off'}</span>
        <span class="skill-updated">${esc(U.relativeTime(skill.updatedAt))}</span>
      </div>
    </div>`).join('');
  }

  async function openSkillDetail(id, onChanged) {
    try {
      const result = await API.skills.get(id);
      const skill = result.skill;
      if (!skill) { UI.toast('Skill not found.', 'error'); return; }
      const body = document.createElement('div');
      body.innerHTML = `
        <div class="skill-detail-head">
          <span class="skill-glyph">${esc((skill.name || 'S').slice(0, 1).toUpperCase())}</span>
          <div style="flex:1;min-width:0">
            <div class="skill-detail-title">${esc(skill.name)}</div>
            <div class="skill-detail-desc">${esc(skill.description || '')}</div>
          </div>
          <span class="badge ${skill.enabled ? 'green' : ''} dot">${skill.enabled ? 'Active' : 'Disabled'}</span>
        </div>
        <div class="skill-meta-row">
          <span class="badge blue">${esc(sourceLabel(skill.source))}</span>
          <span class="badge">${esc(skill.id)}</span>
          ${skill.version ? `<span class="badge">v${esc(skill.version)}</span>` : ''}
          <span class="badge">${esc(U.relativeTime(skill.updatedAt))}</span>
        </div>
        <div class="skill-body chat-markdown">${MD.render(skill.body || '_This skill has no body yet._')}</div>
      `;
      const footer = document.createElement('div');
      footer.style.cssText = 'display:flex;align-items:center;gap:6px;width:100%';
      footer.innerHTML = `<span class="setting-note" style="flex:1">${U.esc(U.linkifyPath(skill.path || ''))}</span>
        ${skill.source !== 'bundled' ? `<button class="btn btn-danger-soft btn-sm" data-delete-skill>${icon('trash', 12)} Delete</button>` : ''}
        <button class="btn btn-secondary btn-sm" data-close-skill>Close</button>`;
      const modal = UI.modal({ title: 'Skill', description: skill.slug || skill.name, size: 'large', body, footer });
      UI.bindCopyCode(body);
      footer.querySelector('[data-close-skill]').addEventListener('click', () => modal.close());
      footer.querySelector('[data-delete-skill]')?.addEventListener('click', async () => {
        const ok = await UI.confirm({ title: 'Delete this skill?', message: 'The SKILL.md file will be removed from this machine.', confirmLabel: 'Delete skill', danger: true, detail: skill.name });
        if (!ok) return;
        try {
          await API.skills.remove(skill.id);
          modal.close();
          UI.toast('Skill deleted.', 'success');
          onChanged?.();
        } catch (error) { UI.toast(error.message, 'error'); }
      });
    } catch (error) { UI.toast(error.message, 'error'); }
  }

  function openSkillComposer(onChanged) {
    const body = document.createElement('div');
    body.innerHTML = `
      ${UI.field({ label: 'Name', control: '<input class="field-input" id="skill-name" type="text" maxlength="60" placeholder="release-checklist" />' })}
      ${UI.field({ label: 'Description', hint: 'one line, shown to the agent', control: '<input class="field-input" id="skill-description" type="text" maxlength="300" placeholder="Run a calm, complete release checklist." />' })}
      ${UI.field({ label: 'Scope', control: `<select class="field-select" id="skill-scope"><option value="global">Global — every workspace</option><option value="project">Project — this workspace only</option></select>` })}
      ${UI.field({ label: 'Instructions', hint: 'Markdown', control: '<textarea class="field-textarea" id="skill-body" rows="9" placeholder="# Release checklist\n\n1. Run the test suite..."></textarea>' })}
    `;
    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;justify-content:flex-end;gap:6px;width:100%';
    footer.innerHTML = `<button class="btn btn-ghost btn-sm" data-cancel>Cancel</button><button class="btn btn-primary btn-sm" data-create>${icon('plus', 12)} Create skill</button>`;
    const modal = UI.modal({ title: 'New skill', description: 'A skill is a Markdown runbook the agent can load when it applies.', size: 'large', body, footer });
    footer.querySelector('[data-cancel]').addEventListener('click', () => modal.close());
    const create = footer.querySelector('[data-create]');
    create.addEventListener('click', async () => {
      const name = body.querySelector('#skill-name').value.trim();
      if (!name) { UI.toast('Name the skill first.', 'warn'); return; }
      create.disabled = true;
      create.innerHTML = `<span class="spinner" style="width:11px;height:11px"></span> Creating…`;
      try {
        await API.skills.create({
          name,
          description: body.querySelector('#skill-description').value.trim(),
          scope: body.querySelector('#skill-scope').value,
          body: body.querySelector('#skill-body').value,
        });
        modal.close();
        UI.toast(`${name} created.`, 'success');
        onChanged?.();
      } catch (error) { UI.toast(error.message, 'error'); create.disabled = false; create.innerHTML = `${icon('plus', 12)} Create skill`; }
    });
  }

  /* ------------------------------------------------------------------- memory */

  async function mountMemory(host) {
    vstate.page = 'memory';
    vstate.host = host;
    host.innerHTML = pageLoading('Memory', 'Durable facts and preferences the agent can recall in any session.');
    try {
      const result = await API.memory.list();
      if (!alive(host, 'memory')) return;
      vstate.memory.items = result.entries || [];
      paintMemory(host);
    } catch (error) { if (alive(host, 'memory')) pageError(host, 'Memory', error); }
  }

  function paintMemory(host) {
    const items = vstate.memory.items;
    const pinned = items.filter((item) => item.pinned);
    const rest = items.filter((item) => !item.pinned);
    host.innerHTML = `<div class="page-inner">
      ${UI.pageHeader({
        title: 'Memory',
        description: 'Facts blank keeps across sessions. The agent saves durable preferences automatically; you can pin the ones that matter most.',
        actions: `<button class="btn btn-secondary btn-sm" data-memory-refresh>${icon('refresh', 12)} Refresh</button>
          <button class="btn btn-primary btn-sm" data-add-memory>${icon('plus', 12)} Add memory</button>`,
        meta: `<span class="badge blue">${items.length} memories</span>`,
      })}
      <div class="toolbar-row">
        <label class="search-field" style="max-width:320px;flex:1">${icon('search', 13)}<input class="field-input" id="memory-search" type="search" placeholder="Search memory" value="${U.attr(vstate.memory.query)}" spellcheck="false" /></label>
        <div class="toolbar-spacer"></div>
        <span class="setting-note">${pinned.length} pinned</span>
      </div>
      <div class="card" id="memory-card"></div>
      <div id="memory-empty" hidden>
        ${UI.emptyState({ iconName: 'brain', title: 'Nothing remembered yet', description: 'Add a fact manually, or let the agent remember preferences as you work together.', actionHtml: `<button class="btn btn-primary btn-sm" data-add-memory>${icon('plus', 12)} Add memory</button>` })}
        <div class="memory-empty-hint">
          <button class="memory-example" type="button" data-example="I prefer concise answers with short code examples.">I prefer concise answers with short code examples.</button>
          <button class="memory-example" type="button" data-example="Always use TypeScript strict mode in new projects.">Always use TypeScript strict mode in new projects.</button>
          <button class="memory-example" type="button" data-example="Ship Windows builds with the NSIS installer target.">Ship Windows builds with the NSIS installer target.</button>
          <button class="memory-example" type="button" data-example="My design system uses a 4px spacing scale.">My design system uses a 4px spacing scale.</button>
        </div>
      </div>
    </div>`;
    paintMemoryList(host);
    host.querySelector('#memory-search')?.addEventListener('input', (event) => {
      vstate.memory.query = event.target.value;
      paintMemoryList(host);
    });
    host.onclick = async (event) => {
      if (event.target.closest('[data-add-memory]')) { openMemoryComposer(null, () => mountMemory(host)); return; }
      if (event.target.closest('[data-memory-refresh]')) { mountMemory(host); return; }
      const example = event.target.closest('[data-example]');
      if (example) { openMemoryComposer({ text: example.dataset.example }, () => mountMemory(host)); return; }
      const pin = event.target.closest('[data-memory-pin]');
      if (pin) {
        const item = vstate.memory.items.find((m) => m.id === pin.dataset.memoryPin);
        if (!item) return;
        try {
          await API.memory.update({ id: item.id, patch: { pinned: !item.pinned } });
          item.pinned = !item.pinned;
          paintMemoryList(host);
          UI.toast(item.pinned ? 'Pinned.' : 'Unpinned.', 'success');
        } catch (error) { UI.toast(error.message, 'error'); }
        return;
      }
      const edit = event.target.closest('[data-memory-edit]');
      if (edit) {
        const item = vstate.memory.items.find((m) => m.id === edit.dataset.memoryEdit);
        if (item) openMemoryComposer(item, () => mountMemory(host));
        return;
      }
      const remove = event.target.closest('[data-memory-delete]');
      if (remove) {
        const item = vstate.memory.items.find((m) => m.id === remove.dataset.memoryDelete);
        if (!item) return;
        const ok = await UI.confirm({ title: 'Forget this?', message: 'The agent will no longer recall this fact.', confirmLabel: 'Delete memory', danger: true, detail: U.truncate(item.text, 120) });
        if (!ok) return;
        try {
          await API.memory.remove(item.id);
          vstate.memory.items = vstate.memory.items.filter((m) => m.id !== item.id);
          paintMemoryList(host);
          UI.toast('Memory deleted.', 'success');
        } catch (error) { UI.toast(error.message, 'error'); }
      }
    };
  }

  function paintMemoryList(host) {
    const card = host.querySelector('#memory-card');
    const empty = host.querySelector('#memory-empty');
    if (!card || !empty) return;
    const query = vstate.memory.query.trim().toLowerCase();
    const items = vstate.memory.items.filter((item) => !query || `${item.text} ${(item.tags || []).join(' ')}`.toLowerCase().includes(query));
    if (!items.length) {
      card.innerHTML = '';
      card.hidden = true;
      empty.hidden = false;
      const title = empty.querySelector('.empty-state h3');
      if (title) title.textContent = vstate.memory.items.length ? 'No matching memories' : 'Nothing remembered yet';
      const add = empty.querySelector('.empty-actions [data-add-memory]');
      if (add) add.onclick = () => openMemoryComposer(null, () => mountMemory(host));
      return;
    }
    card.hidden = false;
    empty.hidden = true;
    const pinned = items.filter((item) => item.pinned);
    const rest = items.filter((item) => !item.pinned);
    const renderRow = (item) => `<div class="memory-item">
      <button class="memory-pin ${item.pinned ? 'pinned' : ''}" type="button" data-memory-pin="${U.attr(item.id)}" title="${item.pinned ? 'Unpin' : 'Pin'}">${icon('pin', 12)}</button>
      <div class="memory-copy">
        <div class="memory-text">${esc(item.text)}</div>
        <div class="memory-meta">
          ${(item.tags || []).slice(0, 6).map((tag) => `<span class="memory-tag">${esc(tag)}</span>`).join('')}
          <span>${item.source === 'manual' ? 'Manual' : item.source || 'Agent'}</span>
          <span>·</span>
          <span>updated ${esc(U.relativeTime(item.updatedAt))}</span>
          ${item.uses ? `<span>· used ${item.uses}×</span>` : ''}
        </div>
      </div>
      <div class="memory-actions">
        <button class="mini-icon" type="button" data-memory-edit="${U.attr(item.id)}" title="Edit">${icon('edit', 13)}</button>
        <button class="mini-icon" type="button" data-memory-delete="${U.attr(item.id)}" title="Delete">${icon('trash', 13)}</button>
      </div>
    </div>`;
    card.innerHTML = `${pinned.length ? `<div class="memory-section-label">${icon('pin', 10)} Pinned</div>${pinned.map(renderRow).join('')}` : ''}
      ${rest.length ? `<div class="memory-section-label">${icon('brain', 10)} Remembered</div>${rest.map(renderRow).join('')}` : ''}`;
  }

  function openMemoryComposer(existing, onDone) {
    const body = document.createElement('div');
    body.innerHTML = `
      ${UI.field({ label: 'Memory', hint: 'a standalone fact', control: `<textarea class="field-textarea" id="memory-text" rows="4" placeholder="The user prefers…">${esc(existing?.text || '')}</textarea>` })}
      ${UI.field({ label: 'Tags', hint: 'comma separated', control: `<input class="field-input" id="memory-tags" type="text" placeholder="preference, workflow" value="${U.attr((existing?.tags || []).join(', '))}" />` })}
      <label class="setting-row" style="border:none;padding:2px 0;gap:10px;align-items:center">
        <span class="setting-copy"><span class="setting-label">Pin to top</span><span class="setting-desc">Pinned memories are always considered first.</span></span>
        <span class="setting-control">${UI.switchHtml(Boolean(existing?.pinned), 'data-pin-toggle')}</span>
      </label>
    `;
    body.querySelector('[data-pin-toggle]').addEventListener('click', (event) => {
      const button = event.currentTarget;
      button.classList.toggle('on');
      button.setAttribute('aria-checked', String(button.classList.contains('on')));
    });
    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;justify-content:flex-end;gap:6px;width:100%';
    footer.innerHTML = `<button class="btn btn-ghost btn-sm" data-cancel>Cancel</button><button class="btn btn-primary btn-sm" data-save>${existing ? 'Save changes' : 'Remember this'}</button>`;
    const modal = UI.modal({ title: existing ? 'Edit memory' : 'Add memory', description: 'Durable context the agent carries into future sessions.', body, footer });
    footer.querySelector('[data-cancel]').addEventListener('click', () => modal.close());
    const save = footer.querySelector('[data-save]');
    save.addEventListener('click', async () => {
      const text = body.querySelector('#memory-text').value.trim();
      if (!text) { UI.toast('Write the memory first.', 'warn'); return; }
      const payload = {
        text,
        tags: U.parseTags(body.querySelector('#memory-tags').value),
        pinned: body.querySelector('[data-pin-toggle]').classList.contains('on'),
      };
      save.disabled = true;
      try {
        if (existing) await API.memory.update({ id: existing.id, patch: payload });
        else await API.memory.add(payload);
        modal.close();
        UI.toast(existing ? 'Memory updated.' : 'Saved to memory.', 'success');
        onDone?.();
      } catch (error) { UI.toast(error.message, 'error'); save.disabled = false; }
    });
  }

  /* ---------------------------------------------------------------------- MCP */

  async function mountMcp(host) {
    vstate.page = 'mcp';
    vstate.host = host;
    host.innerHTML = pageLoading('MCP', 'Model Context Protocol servers and messengers connected to blank.');
    try {
      const [data, refreshed, sshData, messengers] = await Promise.all([
        API.mcp.list(),
        API.mcp.refresh().catch(() => null),
        API.ssh?.list ? API.ssh.list().catch(() => null) : Promise.resolve(null),
        API.messengers?.status ? API.messengers.status().catch(() => null) : Promise.resolve(null),
      ]);
      if (!alive(host, 'mcp')) return;
      vstate.mcp.servers = refreshed?.servers || data.servers || [];
      vstate.mcp.catalog = data.catalog || [];
      if (sshData) vstate.settings.ssh = sshData;
      if (messengers) vstate.settings.messengers = messengers;
      paintMcp(host);
    } catch (error) { if (alive(host, 'mcp')) pageError(host, 'MCP', error); }
  }

  function sshHosts() {
    return vstate.settings.ssh?.hosts || currentConfig()?.ssh?.hosts || [];
  }

  function paintMcp(host) {
    const servers = vstate.mcp.servers;
    const hosts = sshHosts();
    const connected = servers.filter((s) => s.connected).length + (hosts.length ? 1 : 0);
    const catalog = vstate.mcp.catalog;
    host.innerHTML = `<div class="page-inner">
      ${UI.pageHeader({
        title: 'MCP servers',
        actions: `<button class="btn btn-secondary btn-sm" data-mcp-example>${icon('sparkles', 12)} Add example</button>
          <button class="btn btn-secondary btn-sm" data-mcp-refresh>${icon('refresh', 12)} Refresh</button>
          <button class="btn btn-primary btn-sm" data-add-mcp>${icon('plus', 12)} Add server</button>`,
        meta: connected ? `<span class="badge green">${connected} connected</span>` : '',
      })}
      <div class="mcp-list">
        <div class="mcp-card builtin ${hosts.length ? 'connected' : ''}" data-ssh-card>
          <span class="mcp-icon">${icon('terminal', 15)}</span>
          <div class="mcp-copy">
            <div class="mcp-name-row">
              <span class="mcp-name">SSH</span>
              <span class="mcp-transport">built-in</span>
              <span class="mcp-status ${hosts.length ? 'connected' : ''}">
                <span class="status-dot ${hosts.length ? 'on' : 'off'}"></span>
                ${hosts.length ? `${hosts.length} host${hosts.length === 1 ? '' : 's'}` : 'No hosts'}
              </span>
            </div>
            <div class="mcp-detail">${hosts.length ? hosts.slice(0, 3).map((entry) => `${esc(entry.user)}@${esc(entry.host)}`).join(' · ') + (hosts.length > 3 ? ` +${hosts.length - 3}` : '') : 'Remote shell over saved credentials'}</div>
            <div class="mcp-tools"><span class="mcp-tool-chip">ssh_run</span></div>
          </div>
          <div class="mcp-actions">
            <button class="btn btn-secondary btn-sm" type="button" data-ssh-manage>Manage</button>
          </div>
        </div>
        ${servers.length ? servers.map((server) => `<div class="mcp-card ${server.connected ? 'connected' : ''}">
          <span class="mcp-icon">${icon(server.transport === 'http' ? 'globe' : 'terminal', 15)}</span>
          <div class="mcp-copy">
            <div class="mcp-name-row">
              <span class="mcp-name">${esc(server.name)}</span>
              <span class="mcp-transport">${esc(server.transport)}</span>
              <span class="mcp-status ${server.connected ? 'connected' : server.error ? 'error' : ''}">
                <span class="status-dot ${server.connected ? 'on' : server.error ? 'error' : 'off'}"></span>
                ${server.connected ? `${server.toolCount} tool${server.toolCount === 1 ? '' : 's'}` : server.error ? 'Error' : server.enabled ? 'Offline' : 'Disabled'}
              </span>
            </div>
            <div class="mcp-detail">${esc(server.transport === 'http' ? server.url || 'No URL' : server.command || 'No command')}</div>
            ${(server.tools || []).length ? `<div class="mcp-tools">${server.tools.slice(0, 14).map((tool) => `<span class="mcp-tool-chip">${esc(tool)}</span>`).join('')}${server.tools.length > 14 ? `<span class="mcp-tool-chip">+${server.tools.length - 14}</span>` : ''}</div>` : ''}
            ${server.error ? `<div class="mcp-error">${esc(server.error)}</div>` : ''}
          </div>
          <div class="mcp-actions">
            ${server.transport === 'http' ? (server.oauth?.signedIn
              ? `<button class="btn btn-ghost btn-sm" type="button" data-mcp-signout="${U.attr(server.id)}" title="OAuth token stored">${icon('lock', 11)} Sign out</button>`
              : `<button class="btn btn-secondary btn-sm" type="button" data-mcp-signin="${U.attr(server.id)}">${icon('key', 11)} Sign in</button>`) : ''}
            ${UI.switchHtml(server.enabled && server.connected, `data-mcp-toggle="${U.attr(server.id)}"`)}
            <button class="mini-icon" type="button" data-mcp-edit="${U.attr(server.id)}" title="Edit server">${icon('edit', 13)}</button>
            <button class="mini-icon" type="button" data-mcp-remove="${U.attr(server.id)}" title="Remove server">${icon('trash', 13)}</button>
          </div>
        </div>`).join('') : `<div class="empty-state"><div class="empty-icon">${icon('plug', 22)}</div><h3>No external servers</h3><div class="empty-actions"><button class="btn btn-primary btn-sm" data-add-mcp>${icon('plus', 12)} Add server</button><button class="btn btn-secondary btn-sm" data-mcp-example>Add example</button></div></div>`}
      </div>
      ${catalog.length ? `<div class="section-stack">
        <div class="catalog-section-title">Available tools <span class="badge">${catalog.length}</span></div>
        <div class="tool-catalog">
          <div class="catalog-head"><span>Tool</span><span>Server</span><span>Purpose</span></div>
          ${catalog.map((tool) => `<div class="catalog-row">
            <span class="catalog-name">${esc(tool.name)}</span>
            <span class="catalog-server">${esc(tool.serverName || 'MCP')}</span>
            <span class="catalog-desc">${esc(tool.description || 'No description provided.')}</span>
          </div>`).join('')}
        </div>
      </div>` : ''}
      ${messengerSectionHtml(vstate.settings.messengers, currentConfig().messengers || {})}
    </div>`;
    host.onclick = async (event) => {
      if (await handleMessengerEvent(event, host, () => paintMcp(host))) return;
      if (event.target.closest('[data-ssh-manage]')) { openSshHosts(() => mountMcp(host)); return; }
      if (event.target.closest('[data-add-mcp]')) { openMcpComposer(() => mountMcp(host)); return; }
      if (event.target.closest('[data-mcp-refresh]')) { mountMcp(host); return; }
      const example = event.target.closest('[data-mcp-example]');
      if (example) {
        example.disabled = true;
        try {
          const result = await API.mcp.addExample();
          UI.toast(result.existed ? 'The echo example is already configured.' : 'Echo example added and connected.', result.server?.connected ? 'success' : 'info');
          mountMcp(host);
        } catch (error) { UI.toast(error.message, 'error'); example.disabled = false; }
        return;
      }
      const toggle = event.target.closest('[data-mcp-toggle]');
      if (toggle) {
        const id = toggle.dataset.mcpToggle;
        const next = !toggle.classList.contains('on');
        toggle.classList.toggle('on', next);
        toggle.setAttribute('aria-checked', String(next));
        try {
          const result = await API.mcp.toggle({ id, enabled: next });
          vstate.mcp.servers = result.servers || vstate.mcp.servers;
          paintMcp(host);
          UI.toast(next ? 'Server enabled.' : 'Server disabled.', 'success');
        } catch (error) { toggle.classList.toggle('on', !next); UI.toast(error.message, 'error'); }
        return;
      }
      const signIn = event.target.closest('[data-mcp-signin]');
      if (signIn) {
        const button = signIn;
        button.disabled = true;
        button.innerHTML = `${icon('refresh', 11)} Waiting…`;
        try {
          const result = await API.mcp.oauthStart(button.dataset.mcpSignin);
          if (result.servers) vstate.mcp.servers = result.servers;
          paintMcp(host);
          UI.toast('MCP server signed in.', 'success');
        } catch (error) {
          UI.toast(error.message, 'error');
          button.disabled = false;
          button.innerHTML = `${icon('key', 11)} Sign in`;
        }
        return;
      }
      const signOut = event.target.closest('[data-mcp-signout]');
      if (signOut) {
        const ok = await UI.confirm({ title: 'Sign out of this MCP server?', message: 'The stored OAuth token is deleted. The server will ask again on the next connection.', confirmLabel: 'Sign out', detail: 'OAuth' });
        if (!ok) return;
        try {
          const result = await API.mcp.oauthSignOut(signOut.dataset.mcpSignout);
          if (result.servers) vstate.mcp.servers = result.servers;
          paintMcp(host);
          UI.toast('Signed out.', 'success');
        } catch (error) { UI.toast(error.message, 'error'); }
        return;
      }
      const edit = event.target.closest('[data-mcp-edit]');
      if (edit) {
        const server = vstate.mcp.servers.find((s) => s.id === edit.dataset.mcpEdit);
        if (server) openMcpComposer(() => mountMcp(host), server);
        return;
      }
      const remove = event.target.closest('[data-mcp-remove]');      if (remove) {
        const server = vstate.mcp.servers.find((s) => s.id === remove.dataset.mcpRemove);
        if (!server) return;
        const ok = await UI.confirm({ title: 'Remove this MCP server?', message: 'Its tools will disappear from the agent immediately.', confirmLabel: 'Remove server', danger: true, detail: server.name });
        if (!ok) return;
        try {
          await API.mcp.remove(server.id);
          UI.toast('MCP server removed.', 'success');
          mountMcp(host);
        } catch (error) { UI.toast(error.message, 'error'); }
      }
    };
  }

  function parseKeyValue(text) {
    const out = {};
    for (const line of String(text || '').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const index = trimmed.indexOf('=');
      if (index < 1) continue;
      out[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
    }
    return out;
  }

  function openMcpComposer(onChanged, existing = null) {
    const editing = Boolean(existing && existing.id);
    let transport = existing?.transport === 'http' ? 'http' : 'stdio';
    let envDirty = false;
    let headersDirty = false;
    const savedEnv = (existing?.envKeys || []).join(', ');
    const savedHeaders = (existing?.headerKeys || []).join(', ');
    const envHint = editing
      ? `${savedEnv ? `Saved: ${savedEnv}. ` : ''}Leave blank to keep the saved values.`
      : 'KEY=value per line';
    const headerHint = editing
      ? `${savedHeaders ? `Saved: ${savedHeaders}. ` : ''}Leave blank to keep the saved values.`
      : 'KEY=value per line';
    const body = document.createElement('div');
    body.innerHTML = `
      <div class="transport-tabs">
        <button class="transport-tab ${transport === 'stdio' ? 'active' : ''}" type="button" data-transport="stdio">${icon('terminal', 12)} stdio</button>
        <button class="transport-tab ${transport === 'http' ? 'active' : ''}" type="button" data-transport="http">${icon('globe', 12)} HTTP</button>
        ${editing ? '' : `<button class="transport-tab" type="button" data-transport="ssh">${icon('key', 12)} SSH</button>`}
      </div>
      ${UI.field({ label: 'Name', control: `<input class="field-input" id="mcp-name" type="text" maxlength="60" placeholder="linear" value="${U.attr(existing?.name || '')}" />` })}
      <div id="mcp-stdio-fields" ${transport === 'stdio' ? '' : 'hidden'}>
        ${UI.field({ label: 'Command', control: `<input class="field-input" id="mcp-command" type="text" spellcheck="false" placeholder="npx -y @modelcontextprotocol/server-filesystem C:\\\\Projects" value="${U.attr(existing?.command || '')}" />` })}
        ${UI.field({ label: 'Environment', hint: envHint, control: '<textarea class="field-textarea transport-secret" id="mcp-env" rows="3" placeholder="API_KEY=…"></textarea>' })}
      </div>
      <div id="mcp-http-fields" ${transport === 'http' ? '' : 'hidden'}>
        ${UI.field({ label: 'Endpoint URL', control: `<input class="field-input" id="mcp-url" type="url" spellcheck="false" placeholder="https://mcp.example.com/sse" value="${U.attr(existing?.url || '')}" />` })}
        ${UI.field({ label: 'Headers', hint: headerHint, control: '<textarea class="field-textarea transport-secret" id="mcp-headers" rows="3" placeholder="Authorization=Bearer …"></textarea>' })}
      </div>
      <div id="mcp-ssh-fields" hidden>
        <div class="field-grid">
          ${UI.field({ label: 'Host', control: '<input class="field-input" id="mcp-ssh-host" type="text" spellcheck="false" placeholder="server.example.com" />' })}
          ${UI.field({ label: 'Port', control: '<input class="field-input" id="mcp-ssh-port" type="number" min="1" max="65535" value="22" />' })}
        </div>
        <div class="field-grid">
          ${UI.field({ label: 'User', control: '<input class="field-input" id="mcp-ssh-user" type="text" spellcheck="false" placeholder="deploy" />' })}
          ${UI.field({ label: 'Auth', control: '<select class="field-select" id="mcp-ssh-auth"><option value="key">Private key</option><option value="password">Password</option></select>' })}
        </div>
        <div data-mcp-ssh-key>
          <div class="field-grid">
            ${UI.field({ label: 'Private key path', control: '<input class="field-input" id="mcp-ssh-key" type="text" spellcheck="false" placeholder="~/.ssh/id_ed25519" />' })}
            ${UI.field({ label: 'Key passphrase', control: '<input class="field-input" id="mcp-ssh-passphrase" type="password" autocomplete="off" />' })}
          </div>
        </div>
        <div data-mcp-ssh-password hidden>
          ${UI.field({ label: 'Password', control: '<input class="field-input" id="mcp-ssh-password" type="password" autocomplete="off" />' })}
        </div>
      </div>
    `;
    const stdioFields = body.querySelector('#mcp-stdio-fields');
    const httpFields = body.querySelector('#mcp-http-fields');
    const sshFields = body.querySelector('#mcp-ssh-fields');
    const nameInput = body.querySelector('#mcp-name');
    const sshAuth = body.querySelector('#mcp-ssh-auth');
    sshAuth?.addEventListener('change', () => {
      const password = sshAuth.value === 'password';
      body.querySelector('[data-mcp-ssh-key]').hidden = password;
      body.querySelector('[data-mcp-ssh-password]').hidden = !password;
    });
    body.querySelector('#mcp-env')?.addEventListener('input', () => { envDirty = true; });
    body.querySelector('#mcp-headers')?.addEventListener('input', () => { headersDirty = true; });
    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;justify-content:flex-end;gap:6px;width:100%';
    const saveLabel = () => editing ? `${icon('check', 12)} Save changes` : `${icon('plug', 12)} Connect server`;
    footer.innerHTML = `<button class="btn btn-ghost btn-sm" data-cancel>Cancel</button><button class="btn btn-primary btn-sm" data-save>${saveLabel()}</button>`;
    const modal = UI.modal({ title: editing ? 'Edit MCP server' : 'Add MCP server', size: 'large', body, footer });
    footer.querySelector('[data-cancel]').addEventListener('click', () => modal.close());
    const save = footer.querySelector('[data-save]');
    body.querySelectorAll('[data-transport]').forEach((tab) => {
      tab.addEventListener('click', () => {
        transport = tab.dataset.transport;
        body.querySelectorAll('[data-transport]').forEach((t) => t.classList.toggle('active', t === tab));
        stdioFields.hidden = transport !== 'stdio';
        httpFields.hidden = transport !== 'http';
        sshFields.hidden = transport !== 'ssh';
        nameInput.placeholder = transport === 'ssh' ? 'Production' : 'linear';
        save.innerHTML = transport === 'ssh' ? `${icon('key', 12)} Save host` : saveLabel();
      });
    });
    save.addEventListener('click', async () => {
      const name = body.querySelector('#mcp-name').value.trim();
      if (transport === 'ssh') {
        const host = body.querySelector('#mcp-ssh-host').value.trim();
        const user = body.querySelector('#mcp-ssh-user').value.trim();
        if (!host) { UI.toast('Host is required.', 'warn'); body.querySelector('#mcp-ssh-host').focus(); return; }
        if (!user) { UI.toast('Username is required.', 'warn'); body.querySelector('#mcp-ssh-user').focus(); return; }
        save.disabled = true;
        save.innerHTML = `<span class="spinner" style="width:11px;height:11px"></span> Saving…`;
        try {
          await API.ssh.add({
            name,
            host,
            port: Number(body.querySelector('#mcp-ssh-port').value) || 22,
            user,
            authType: sshAuth.value,
            keyPath: body.querySelector('#mcp-ssh-key').value.trim(),
            passphrase: body.querySelector('#mcp-ssh-passphrase').value,
            password: body.querySelector('#mcp-ssh-password').value,
          });
          modal.close();
          UI.toast('SSH host saved.', 'success');
          onChanged?.();
        } catch (error) {
          UI.toast(error.message, 'error');
          save.disabled = false;
          save.innerHTML = `${icon('key', 12)} Save host`;
        }
        return;
      }
      if (!name) { UI.toast('Name the server.', 'warn'); return; }
      const payload = { name, transport };
      if (transport === 'stdio') {
        payload.command = body.querySelector('#mcp-command').value.trim();
        if (!payload.command) { UI.toast('Enter the command to launch the server.', 'warn'); return; }
        if (!editing || envDirty) payload.env = parseKeyValue(body.querySelector('#mcp-env').value);
      } else {
        payload.url = body.querySelector('#mcp-url').value.trim();
        if (!/^https?:\/\//i.test(payload.url)) { UI.toast('Enter a valid URL.', 'warn'); return; }
        if (!editing || headersDirty) payload.headers = parseKeyValue(body.querySelector('#mcp-headers').value);
      }
      save.disabled = true;
      save.innerHTML = `<span class="spinner" style="width:11px;height:11px"></span> ${editing ? 'Saving…' : 'Connecting…'}`;
      try {
        if (editing) {
          await API.mcp.update({ ...payload, id: existing.id });
          modal.close();
          UI.toast('MCP server updated.', 'success');
        } else {
          await API.mcp.add(payload);
          modal.close();
          UI.toast(`${name} connected.`, 'success');
        }
        onChanged?.();
      } catch (error) { UI.toast(error.message, 'error'); save.disabled = false; save.innerHTML = saveLabel(); }
    });
  }

  /* ----------------------------------------------------------------- learning */

  async function mountLearning(host) {
    vstate.page = 'learning';
    vstate.host = host;
    host.innerHTML = pageLoading('Learning', 'blank reviews its own sessions and proposes durable improvements.');
    try {
      const data = await API.learn.state();
      if (!alive(host, 'learning')) return;
      vstate.learn.data = data;
      paintLearning(host);
    } catch (error) { if (alive(host, 'learning')) pageError(host, 'Learning', error); }
  }

  function insightIcon(type) {
    return ({ memory: 'brain', instruction: 'zap', skill: 'layers' })[type] || 'sparkles';
  }

  function paintLearning(host) {
    const data = vstate.learn.data || {};
    const pending = data.pending || [];
    const applied = data.applied || [];
    const stats = data.stats || {};
    const counts = data.counts || {};
    const activity = stats.activity || [];
    const maxActivity = Math.max(1, ...activity.map((day) => day.count));
    const topTools = stats.topTools || [];
    const maxTool = Math.max(1, ...topTools.map((tool) => tool.count));
    const modelLabel = data.reflectionModel ? U.modelLabel(appState().catalog, data.reflectionModel) : '';
    host.innerHTML = `<div class="page-inner">
      ${UI.pageHeader({
        title: 'Learning',
        description: 'A reflection pass reads recent sessions and proposes memories, standing instructions or skills. Nothing is applied without your review.',
        actions: `<button class="btn btn-secondary btn-sm" data-refresh-learn>${icon('refresh', 12)} Refresh</button>
          <button class="btn btn-primary btn-sm" data-reflect ${vstate.learn.reflecting ? 'disabled' : ''}>${vstate.learn.reflecting ? '<span class="spinner" style="width:11px;height:11px"></span> Reflecting…' : `${icon('sparkles', 12)} Reflect now`}</button>`,
        meta: `<span class="badge amber">${pending.length} pending</span>`,
      })}
      <div class="learning-layout">
        <div class="learning-main">
          <div class="settings-section">
            <h2>Proposed improvements</h2>
            <p>${pending.length ? 'Review what blank noticed. Apply keeps it; dismiss forgets it.' : 'When a reflection pass finds something durable, it lands here for review.'}</p>
            ${pending.length ? pending.map((insight) => `<div class="insight-card">
              <div class="insight-head">
                <span class="insight-type ${esc(insight.type)}">${icon(insightIcon(insight.type), 13)}</span>
                <div class="insight-copy">
                  <div class="insight-title">${esc(insight.title)}</div>
                  <div class="insight-content">${esc(U.truncate(insight.content, 420))}</div>
                  ${insight.reason ? `<div class="insight-reason">${icon('glasses', 11)}<span>${esc(insight.reason)}</span></div>` : ''}
                </div>
              </div>
              <div class="insight-foot">
                <span class="badge ${insight.type === 'memory' ? 'blue' : insight.type === 'skill' ? 'amber' : 'violet'}">${esc(U.typeBadge(insight.type))}</span>
                ${(insight.tags || []).slice(0, 3).map((tag) => `<span class="badge">${esc(tag)}</span>`).join('')}
                <span class="confidence">${icon('check-circle', 10)} ${Math.round((insight.confidence || 0.6) * 100)}%<span class="confidence-bar"><span style="width:${Math.round((insight.confidence || 0.6) * 100)}%"></span></span></span>
                <span class="spacer"></span>
                <button class="btn btn-ghost btn-xs" type="button" data-dismiss-insight="${U.attr(insight.id)}">Dismiss</button>
                <button class="btn btn-primary btn-xs" type="button" data-apply-insight="${U.attr(insight.id)}">${icon('check', 10)} Apply</button>
              </div>
            </div>`).join('') : `<div class="pending-empty">${icon('sparkles', 22)}<div>No proposals waiting. Run a reflection pass after a few substantial sessions.</div></div>`}
          </div>
          <div class="settings-section" style="margin-top:22px">
            <h2>Recently applied</h2>
            ${applied.length ? `<div class="card"><div class="applied-list">
              ${applied.slice(0, 12).map((insight) => `<div class="applied-item">${icon('check-circle', 12)}<span><b>${esc(insight.title)}</b> · ${esc(U.typeBadge(insight.type))} · ${esc(U.relativeTime(insight.appliedAt || insight.createdAt))}${insight.type === 'skill' ? ' · saved as skill' : ''}</span></div>`).join('')}
            </div></div>` : `<div class="setting-note">Applied insights will be listed here.</div>`}
          </div>
        </div>
        <aside class="learning-side">
          <div class="learning-stats">
            <div class="learning-stat"><div class="value">${U.fmtNumber(stats.sessions || 0)}</div><div class="label">Sessions</div></div>
            <div class="learning-stat"><div class="value">${U.fmtNumber(stats.toolCalls || 0)}</div><div class="label">Tool calls</div></div>
            <div class="learning-stat"><div class="value">${U.fmtNumber(counts.memory || 0)}</div><div class="label">Memories</div></div>
            <div class="learning-stat"><div class="value">${U.fmtNumber(counts.activeSkills || counts.enabledSkills || 0)}</div><div class="label">Active skills</div></div>
          </div>
          <div class="card card-pad">
            <div class="card-title" style="margin-bottom:6px">Activity · 14 days</div>
            <div class="activity-chart">
              ${activity.map((day, index) => `<div class="activity-bar ${index === activity.length - 1 ? 'today' : ''}" title="${esc(day.date)} · ${day.count} messages"><span style="height:${Math.max(5, Math.round((day.count / maxActivity) * 100))}%"></span></div>`).join('') || '<div class="setting-note">No activity yet.</div>'}
            </div>
            <div class="activity-days"><span>${activity[0] ? new Date(activity[0].date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}</span><span>Today</span></div>
          </div>
          <div class="card card-pad">
            <div class="card-title" style="margin-bottom:8px">Most used tools</div>
            ${topTools.length ? `<div class="tool-usage">${topTools.map((tool) => `<div class="tool-usage-row"><span class="tool-usage-name">${esc(tool.name)}</span><span class="tool-usage-track"><span style="width:${Math.round((tool.count / maxTool) * 100)}%"></span></span><span class="tool-usage-count">${tool.count}</span></div>`).join('')}</div>` : '<div class="setting-note">Tool usage appears after a few sessions.</div>'}
          </div>
          <div class="card reflection-card">
            <div class="reflection-card-title">${icon('sparkles', 13)} Reflection</div>
            <p>${pending.length || applied.length ? 'Reflection reads the last eight sessions and proposes at most three changes.' : 'Reflection is conservative. It often returns no changes, which is healthy.'}</p>
            <div class="reflection-meta">
              <span>Model <b>${esc(modelLabel || 'Not connected')}</b></span>
              <span>Runs <b>${U.fmtNumber(data.reflections || 0)}</b></span>
              <span>Last <b>${data.lastReflectionAt ? esc(U.relativeTime(data.lastReflectionAt)) : 'never'}</b></span>
            </div>
            <button class="btn btn-secondary btn-sm reflect-button" type="button" data-reflect ${vstate.learn.reflecting ? 'disabled' : ''}>${icon('sparkles', 12)} ${vstate.learn.reflecting ? 'Reflecting…' : 'Reflect now'}</button>
          </div>
        </aside>
      </div>
    </div>`;
    host.onclick = async (event) => {
      if (event.target.closest('[data-refresh-learn]')) { mountLearning(host); return; }
      if (event.target.closest('[data-reflect]')) { reflectNow(host); return; }
      const apply = event.target.closest('[data-apply-insight]');
      if (apply) {
        apply.disabled = true;
        apply.innerHTML = `<span class="spinner" style="width:10px;height:10px"></span> Applying…`;
        try {
          const result = await API.learn.apply(apply.dataset.applyInsight);
          if (result.state) vstate.learn.data = result.state;
          paintLearning(host);
          UI.toast('Insight applied.', 'success');
          if (window.App?.refreshBadges) App.refreshBadges();
        } catch (error) { UI.toast(error.message, 'error'); apply.disabled = false; apply.innerHTML = `${icon('check', 10)} Apply`; }
        return;
      }
      const dismiss = event.target.closest('[data-dismiss-insight]');
      if (dismiss) {
        dismiss.disabled = true;
        try {
          await API.learn.dismiss(dismiss.dataset.dismissInsight);
          mountLearning(host);
        } catch (error) { UI.toast(error.message, 'error'); dismiss.disabled = false; }
      }
    };
  }

  async function reflectNow(host) {
    if (vstate.learn.reflecting) return;
    vstate.learn.reflecting = true;
    for (const button of host.querySelectorAll('[data-reflect]')) {
      button.disabled = true;
      button.innerHTML = `<span class="spinner" style="width:11px;height:11px"></span> Reflecting…`;
    }
    try {
      const result = await API.learn.reflect();
      UI.toast(result.message || 'Reflection complete.', result.added?.length ? 'success' : 'info', { title: 'Learning' });
      vstate.learn.reflecting = false;
      await mountLearning(host);
    } catch (error) {
      vstate.learn.reflecting = false;
      UI.toast(error.message, 'error');
      await mountLearning(host);
    }
  }

  /* ----------------------------------------------------------------- settings */

  function teamMemberRow(member = {}) {
    return `<div class="team-member" data-team-member data-member-id="${U.attr(member.id || '')}">
      <div class="team-member-head">
        <span class="team-member-index">${icon('bot', 13)}</span>
        <input class="field-input team-name" data-team-field="name" value="${U.attr(member.name || '')}" placeholder="Agent name" maxlength="40" spellcheck="false" />
        <label class="team-enabled" title="Enabled">${UI.switchHtml(member.enabled !== false, 'data-team-field="enabled"')}</label>
        <button class="mini-icon" type="button" data-team-remove title="Remove member">${icon('trash', 13)}</button>
      </div>
      <textarea class="settings-textarea team-role" data-team-field="role" rows="2" placeholder="What this specialist should investigate and report">${esc(member.role || '')}</textarea>
      <div class="team-member-foot">
        <input class="field-input team-model" data-team-field="model" value="${U.attr(member.model || '')}" placeholder="Model id (leave blank for the default)" spellcheck="false" />
        <label class="team-write"><span>Can edit files</span>${UI.switchHtml(Boolean(member.write), 'data-team-field="write"')}</label>
      </div>
    </div>`;
  }

  /* ------------------------------------------------------- code / console / team */

  function cadenceLabel(schedule) {
    if (schedule.cadence === 'once') {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(schedule.date || ''));
      if (!match) return `Once at ${schedule.time || '09:00'}`;
      const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
      return `Once · ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${schedule.time || '09:00'}`;
    }
    if (schedule.cadence === 'interval') return `Every ${schedule.everyMinutes || 30} min`;
    if (schedule.cadence === 'hourly') return `Every hour at :${String(schedule.time || '09:00').slice(3, 5)}`;
    if (schedule.cadence === 'weekdays') return `Weekdays at ${schedule.time || '09:00'}`;
    return `Every day at ${schedule.time || '09:00'}`;
  }

  function localDateValue(date = new Date()) {
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function diffMarkup(text) {
    const lines = String(text || 'No changes.').split('\n').slice(0, 4000);
    return lines.map((line) => {
      const cls = line.startsWith('+++') || line.startsWith('---') ? 'meta'
        : line.startsWith('@@') ? 'hunk'
          : line.startsWith('+') ? 'add'
            : line.startsWith('-') ? 'del' : '';
      return `<span class="diff-line ${cls}">${U.esc(line) || ' '}</span>`;
    }).join('');
  }

  async function mountCode(host) {
    vstate.page = 'code';
    vstate.host = host;
    if (!vstate.code.data) host.innerHTML = pageLoading('Code & review', 'Reading the workspace.');
    try {
      const data = await API.code.overview();
      if (!alive(host, 'code')) return;
      vstate.code.data = data;
      paintCode(host);
    } catch (error) { if (alive(host, 'code')) pageError(host, 'Code & review', error); }
  }

  function paintCode(host) {
    const data = vstate.code.data;
    if (!data) return;
    const git = data.git || {};
    const checks = data.checks || [];
    const selected = vstate.code.selected;
    const diff = vstate.code.diff;
    const result = vstate.code.result;
    const changes = git.files || [];
    host.innerHTML = `<div class="page-inner code-page">
      ${UI.pageHeader({
        title: 'Code & review',
        description: 'Review changes and run project checks.',
        actions: `<button class="btn btn-secondary btn-sm" type="button" data-code-refresh>${icon('refresh', 12)} Refresh</button><button class="btn btn-secondary btn-sm" type="button" data-code-editor>${icon('external-link', 12)} Open in VS Code</button>`,
        meta: `<span class="badge ${git.isRepo ? 'blue' : 'gray'}">${esc(git.isRepo ? (git.branch || 'git') : 'No git')}</span>`,
      })}
      <div class="code-stats">
        <div class="code-stat"><span>Files</span><b>${U.fmtNumber(data.files || 0)}</b></div>
        <div class="code-stat"><span>Languages</span><b>${(data.languages || []).length}</b></div>
        <div class="code-stat"><span>Changed</span><b>${(git.counts?.changed || 0) + (git.counts?.untracked || 0)}</b></div>
        <div class="code-stat"><span>Checks</span><b>${checks.length}</b></div>
        <div class="code-stat wide"><span>Workspace</span><b class="mono">${esc(data.workspace || 'None')}</b></div>
      </div>
      <div class="code-grid">
        <section class="code-panel">
          <div class="code-panel-head"><h2>Changes</h2><span class="setting-note">${esc(git.isRepo ? `${git.counts?.staged || 0} staged · ${git.counts?.changed || 0} modified · ${git.counts?.untracked || 0} untracked` : 'Not a repository')}</span></div>
          ${changes.length ? `<div class="change-list">${changes.map((file) => `<button class="change-row ${selected === file.path ? 'active' : ''}" type="button" data-code-file="${U.attr(file.path)}">
            <span class="change-status ${U.esc(file.status || '')}">${esc(file.status === 'untracked' ? '??' : file.status === 'staged' ? 'A' : file.status === 'conflicted' ? '!' : 'M')}</span>
            <span class="change-path">${esc(file.path)}</span>
          </button>`).join('')}</div>` : `<div class="code-empty">${icon('check-circle', 18)}<p>${git.isRepo ? 'The working tree is clean.' : 'Open a workspace with a git repository to review changes.'}</p></div>`}
          ${data.languages?.length ? `<div class="code-langs">${data.languages.map((item) => `<span class="code-lang">${esc(item.name)} <b>${item.count}</b></span>`).join('')}</div>` : ''}
        </section>
        <section class="code-panel">
          <div class="code-panel-head"><h2>Diff</h2>${selected ? `<span class="setting-note mono">${esc(selected)}</span>` : ''}</div>
          ${selected
            ? diff ? `<pre class="diff-view">${diffMarkup(diff.diff)}</pre>` : '<div class="code-empty"><span class="spinner"></span><p>Reading the diff…</p></div>'
            : `<div class="code-empty">${icon('git-branch', 18)}<p>Select a changed file to read its diff.</p></div>`}
        </section>
      </div>
      <section class="code-panel checks-panel">
        <div class="code-panel-head"><h2>Checks</h2><span class="setting-note">${checks.length ? 'Detected from package.json' : 'No package.json scripts detected'}</span></div>
        ${checks.length ? `<div class="check-actions">${checks.map((check) => `<button class="btn btn-secondary btn-sm" type="button" data-code-check="${U.attr(check.id)}" ${vstate.code.running ? 'disabled' : ''}>${vstate.code.running === check.id ? '<span class="spinner"></span>' : icon('play', 11)} ${esc(check.label)}</button>`).join('')}</div>` : `<div class="code-empty"><p>Run a custom command in the Console instead.</p></div>`}
        ${result ? `<div class="check-result ${result.ok ? 'ok' : 'fail'}">
          <div class="check-result-head"><span class="badge ${result.ok ? 'green' : 'red'}">${result.ok ? 'Passed' : `Exit ${result.code}`}</span><span>${esc(result.check?.label || '')} · ${result.durationMs || 0}ms</span><button class="mini-icon" type="button" data-code-copy title="Copy output">${icon('copy', 12)}</button></div>
          <pre>${U.esc([result.stdout, result.stderr].filter(Boolean).join('\n') || 'No output.')}</pre>
        </div>` : ''}
      </section>
      <div class="settings-permission-note">${icon('shield', 12)} Checks run this project's npm scripts locally.</div>
    </div>`;
    host.onclick = async (event) => {
      if (event.target.closest('[data-code-refresh]')) { vstate.code.data = null; vstate.code.diff = null; vstate.code.selected = ''; vstate.code.result = null; mountCode(host); return; }
      if (event.target.closest('[data-code-editor]')) { API.workspace.openEditor().then((res) => { if (res && res.ok === false) UI.toast(res.error || 'Could not open VS Code.', 'warn'); }).catch((error) => UI.toast(error.message, 'error')); return; }
      const file = event.target.closest('[data-code-file]');
      if (file) {
        vstate.code.selected = file.dataset.codeFile;
        vstate.code.diff = null;
        paintCode(host);
        try {
          const diff = await API.code.diff({ file: vstate.code.selected });
          if (!alive(host, 'code')) return;
          vstate.code.diff = diff;
        } catch (error) { vstate.code.diff = { diff: error.message }; }
        paintCode(host);
        return;
      }
      const check = event.target.closest('[data-code-check]');
      if (check) {
        vstate.code.running = check.dataset.codeCheck;
        vstate.code.result = null;
        paintCode(host);
        try {
          const result = await API.code.runCheck({ id: check.dataset.codeCheck });
          if (!alive(host, 'code')) return;
          vstate.code.result = result;
        } catch (error) { UI.toast(error.message, 'error'); }
        vstate.code.running = '';
        paintCode(host);
        return;
      }
      if (event.target.closest('[data-code-copy]')) {
        const text = [vstate.code.result?.stdout, vstate.code.result?.stderr].filter(Boolean).join('\n');
        const ok = await U.copyText(text || '');
        UI.toast(ok ? 'Output copied.' : 'Clipboard unavailable.', ok ? 'success' : 'error');
      }
    };
  }

  /* ------------------------------------------------------------------ console */

  function mountConsole(host) {
    vstate.page = 'console';
    vstate.host = host;
    paintConsole(host);
  }

  function paintConsole(host) {
    const workspace = currentConfig().workspace || '';
    host.innerHTML = `<div class="page-inner console-page">
      ${UI.pageHeader({
        title: 'Console',
        description: 'A local terminal in your workspace.',
        actions: `<button class="btn btn-secondary btn-sm" type="button" data-console-side>${icon('panel-right', 12)} Open beside chat</button>`,
        meta: `<span class="badge blue mono">${esc(workspace ? U.baseName(workspace) : 'No workspace')}</span>`,
      })}
      ${workspace
        ? TerminalView.markup()
        : `<div class="api-empty">${icon('terminal', 16)}<div><h3>Open a workspace</h3><p>A terminal starts in your project folder.</p></div><button class="btn btn-secondary btn-sm" type="button" data-console-workspace>Choose folder</button></div>`}
    </div>`;
    TerminalView.wire(host.querySelector('[data-terminal]'));
    host.querySelector('[data-console-side]')?.addEventListener('click', () => App.showRailTab('terminal'));
    host.querySelector('[data-console-workspace]')?.addEventListener('click', async () => {
      try {
        const result = await API.workspace.choose();
        if (result && result.workspace) {
          applyConfig(await API.config.get());
          paintConsole(host);
        }
      } catch (error) { UI.toast(error.message, 'error'); }
    });
  }

  /* --------------------------------------------------------------------- team */

  async function mountTeam(host) {
    vstate.page = 'team';
    vstate.host = host;
    host.innerHTML = pageLoading('blank Team', 'Parallel specialists.');
    try {
      const config = await API.config.get();
      if (!alive(host, 'team')) return;
      applyConfig(config);
      paintTeam(host);
    } catch (error) { if (alive(host, 'team')) pageError(host, 'blank Team', error); }
  }

  function paintTeam(host) {
    const config = currentConfig();
    const team = config.team || { enabled: false, members: [] };
    const members = Array.isArray(team.members) ? team.members : [];
    const enabled = members.filter((member) => member.enabled !== false && member.name).length;
    host.innerHTML = `<div class="page-inner team-page">
      ${UI.pageHeader({
        title: 'blank Team',
        description: 'One brief, several specialists in parallel.',
        actions: `<button class="btn btn-secondary btn-sm" type="button" data-team-brief>${icon('bot', 12)} New team brief</button>`,
        meta: `<span class="badge ${team.enabled ? 'blue' : 'gray'}">${team.enabled ? `${enabled} active` : 'Disabled'}</span>`,
      })}
      <section class="settings-section team-panel">
        <div class="setting-row">
          <div class="setting-copy"><div class="setting-label">Enable the agent team</div></div>
          <div class="setting-control">${UI.switchHtml(Boolean(team.enabled), 'data-team-page-toggle')}</div>
        </div>
      </section>
      <section class="settings-section">
        <h2>Roster</h2>
        <div class="team-members" data-team-members>${members.map((member) => teamMemberRow(member)).join('') || ''}</div>
        <div class="provider-actions">
          <button class="btn btn-secondary btn-sm" type="button" data-team-add>${icon('plus', 12)} Add member</button>
          <button class="btn btn-primary btn-sm" type="button" data-save-team>Save roster</button>
        </div>
      </section>
    </div>`;
    const save = async () => {
      const nodes = [...host.querySelectorAll('[data-team-member]')];
      const nextMembers = nodes.map((node, index) => {
        const field = (name) => node.querySelector(`[data-team-field="${name}"]`);
        return {
          id: node.dataset.memberId || `member_${Date.now().toString(36)}_${index}`,
          name: field('name')?.value.trim() || '',
          role: field('role')?.value.trim() || '',
          model: field('model')?.value.trim() || '',
          enabled: field('enabled') ? field('enabled').classList.contains('on') : true,
          write: field('write') ? field('write').classList.contains('on') : false,
        };
      }).filter((member) => member.name);
      const enabledNow = host.querySelector('[data-team-page-toggle]')?.classList.contains('on') ?? Boolean(team.enabled);
      try {
        const updated = await API.config.update({ team: { enabled: enabledNow, members: nextMembers } });
        applyConfig(updated);
        paintTeam(host);
        UI.toast(`Roster saved · ${nextMembers.length} member${nextMembers.length === 1 ? '' : 's'}.`, 'success');
      } catch (error) { UI.toast(error.message, 'error'); }
    };
    host.onclick = async (event) => {
      const toggle = event.target.closest('[data-team-page-toggle]');
      if (toggle) {
        const next = !toggle.classList.contains('on');
        toggle.classList.toggle('on', next);
        toggle.setAttribute('aria-checked', String(next));
        try {
          const updated = await API.config.update({ team: { enabled: next } });
          applyConfig(updated);
          UI.toast(next ? 'blank Team enabled.' : 'blank Team disabled.', 'success');
        } catch (error) { toggle.classList.toggle('on', !next); UI.toast(error.message, 'error'); }
        return;
      }
      const fieldToggle = event.target.closest('[data-team-field="enabled"], [data-team-field="write"]');
      if (fieldToggle) {
        const next = !fieldToggle.classList.contains('on');
        fieldToggle.classList.toggle('on', next);
        fieldToggle.setAttribute('aria-checked', String(next));
        return;
      }
      if (event.target.closest('[data-team-add]')) {
        const list = host.querySelector('[data-team-members]');
        if (!list) return;
        list.insertAdjacentHTML('beforeend', teamMemberRow({ name: '', role: '', model: '', enabled: true, write: false }));
        list.lastElementChild?.querySelector('[data-team-field="name"]')?.focus();
        return;
      }
      if (event.target.closest('[data-team-remove]')) {
        event.target.closest('[data-team-member]')?.remove();
        return;
      }
      if (event.target.closest('[data-save-team]')) { await save(); return; }
      if (event.target.closest('[data-team-brief]')) {
        const names = members.filter((member) => member.enabled !== false && member.name).map((member) => member.name);
        App.newSession();
        ChatView.focusComposer(`Team brief: work this as blank Team${names.length ? ` with ${names.join(', ')}` : ''}. Explore in parallel, report concrete findings with file references, then synthesize one answer.\n\n`);
      }
    };
  }

  /* --------------------------------------------------------------- automations */

  async function mountAutomations(host) {
    vstate.page = 'automations';
    vstate.host = host;
    if (!vstate.automations.schedules.length) host.innerHTML = pageLoading('Automations', 'Recurring prompts.');
    try {
      const data = await API.schedules.list();
      if (!alive(host, 'automations')) return;
      vstate.automations.schedules = data.schedules || [];
      vstate.automations.running = data.running || [];
      paintAutomations(host);
    } catch (error) { if (alive(host, 'automations')) pageError(host, 'Automations', error); }
  }

  function paintAutomations(host) {
    const schedules = vstate.automations.schedules;
    const editing = schedules.find((schedule) => schedule.id === vstate.automations.editing) || null;
    host.innerHTML = `<div class="page-inner automations-page">
      ${UI.pageHeader({
        title: 'Automations',
        description: 'Recurring or one-time prompts that run while blank is open.',
        actions: `<button class="btn btn-secondary btn-sm" type="button" data-automation-refresh>${icon('refresh', 12)} Refresh</button>`,
        meta: `<span class="badge blue">${schedules.length} automation${schedules.length === 1 ? '' : 's'}</span>`,
      })}
      <section class="settings-section">
        <h2>${editing ? 'Edit automation' : 'New automation'}</h2>
        <div class="settings-group automation-compose">
          <div class="setting-row schedule-compose-row">
            <input class="field-input" id="automation-title" maxlength="80" placeholder="Name, e.g. Morning brief" spellcheck="false" value="${U.attr(editing?.title || '')}" />
            <select class="setting-inline-input" id="automation-cadence">
              ${[['interval', 'Every N minutes'], ['hourly', 'Every hour'], ['daily', 'Every day'], ['weekdays', 'Weekdays'], ['once', 'Just once']].map(([id, label]) => `<option value="${id}" ${(editing?.cadence || 'daily') === id ? 'selected' : ''}>${label}</option>`).join('')}
            </select>
            <input class="setting-inline-input automation-date" id="automation-date" type="date" value="${U.attr(editing?.date || localDateValue())}" aria-label="One-time run date" />
            <input class="setting-inline-input" id="automation-time" type="time" value="${U.attr(editing?.time || '09:00')}" />
            <input class="setting-inline-input automation-every" id="automation-every" type="number" min="5" max="1440" step="5" value="${Number(editing?.everyMinutes) || 30}" title="Minutes between runs" />
          </div>
          <textarea class="settings-textarea" id="automation-prompt" rows="3" placeholder="What should blank do when this runs?">${esc(editing?.prompt || '')}</textarea>
          <div class="provider-actions">
            <button class="btn btn-primary btn-sm" type="button" data-automation-save>${icon(editing ? 'save' : 'plus', 12)} ${editing ? 'Save automation' : 'Add automation'}</button>
            ${editing ? '<button class="btn btn-ghost btn-sm" type="button" data-automation-cancel>Cancel</button>' : ''}
            <label class="schedule-check"><input type="checkbox" id="automation-tools" ${editing?.allowTools ? 'checked' : ''} /> Allow tools without asking</label>
          </div>
        </div>
      </section>
      <div class="automation-list">
        ${schedules.length ? schedules.map((schedule) => {
          const next = schedule.nextRunAt ? new Date(schedule.nextRunAt) : null;
          const onceDone = schedule.cadence === 'once' && schedule.enabled === false && schedule.lastRunAt;
          const nextText = next && !Number.isNaN(next.getTime()) ? next.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : onceDone ? 'done' : 'Paused';
          const lastText = schedule.lastRunAt ? new Date(schedule.lastRunAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
          return `<article class="automation-card ${schedule.running ? 'running' : ''}" data-automation-id="${U.attr(schedule.id)}">
            <div class="automation-head">
              <div><div class="automation-title">${esc(schedule.title)}</div><div class="automation-meta"><span class="automation-cadence">${esc(cadenceLabel(schedule))}</span> · ${next ? `<span>next ${esc(nextText)}</span>` : `<span>${onceDone ? 'done' : 'paused'}</span>`}${lastText ? ` · <span>last ${esc(lastText)}</span>` : ''}</div></div>
              <span class="badge ${schedule.running ? 'amber' : schedule.lastStatus === 'ok' ? 'green' : schedule.lastStatus === 'error' ? 'red' : 'gray'}">${schedule.running ? 'Running' : schedule.lastStatus === 'ok' ? 'OK' : schedule.lastStatus === 'error' ? 'Error' : 'Idle'}</span>
            </div>
            <p class="automation-prompt">${esc(U.truncate(schedule.prompt, 220))}</p>
            ${schedule.lastError ? `<div class="schedule-error">${esc(U.truncate(schedule.lastError, 180))}</div>` : ''}
            ${schedule.history?.length ? `<div class="automation-history">${schedule.history.slice(0, 5).map((entry) => `<button class="automation-history-row" type="button" ${entry.sessionId ? `data-automation-session="${U.attr(entry.sessionId)}"` : 'disabled'}>
              <span class="badge ${entry.status === 'ok' ? 'green' : entry.status === 'error' ? 'red' : 'gray'}">${esc(entry.status)}</span>
              <span>${esc(new Date(entry.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}</span>
              ${entry.sessionId ? icon('arrow-right', 11) : ''}
            </button>`).join('')}</div>` : ''}
            <div class="automation-actions">
              <button class="btn btn-secondary btn-sm" type="button" data-automation-run="${U.attr(schedule.id)}" ${schedule.running ? 'disabled' : ''}>${icon('play', 11)} Run now</button>
              <button class="btn btn-ghost btn-sm" type="button" data-automation-edit="${U.attr(schedule.id)}">${icon('edit', 11)} Edit</button>
              ${schedule.cadence === 'once' ? '' : `<label class="schedule-check"><input type="checkbox" data-automation-enabled="${U.attr(schedule.id)}" ${schedule.enabled !== false ? 'checked' : ''} /> Enabled</label>`}
              <button class="mini-icon" type="button" data-automation-delete="${U.attr(schedule.id)}" title="Delete automation">${icon('trash', 13)}</button>
            </div>
          </article>`;
        }).join('') : `<div class="empty-state"><div class="empty-icon">${icon('clock', 22)}</div><h3>Nothing scheduled</h3><p>Create a daily brief, an hourly watch, a one-time run or your own interval.</p></div>`}
      </div>
    </div>`;
    const cadence = host.querySelector('#automation-cadence');
    const syncCadence = () => {
      const value = cadence?.value;
      const interval = value === 'interval';
      const once = value === 'once';
      const every = host.querySelector('#automation-every');
      const time = host.querySelector('#automation-time');
      const date = host.querySelector('#automation-date');
      if (every) every.hidden = !interval;
      if (time) time.hidden = interval;
      if (date) date.hidden = !once;
    };
    syncCadence();
    cadence?.addEventListener('change', syncCadence);
    const reload = async () => {
      const data = await API.schedules.list();
      vstate.automations.schedules = data.schedules || [];
      vstate.automations.running = data.running || [];
      paintAutomations(host);
    };
    host.onclick = async (event) => {
      if (event.target.closest('[data-automation-refresh]')) { await reload(); return; }
      if (event.target.closest('[data-automation-cancel]')) { vstate.automations.editing = ''; paintAutomations(host); return; }
      if (event.target.closest('[data-automation-save]')) {
        const button = event.target.closest('[data-automation-save]');
        const payload = {
          id: vstate.automations.editing || undefined,
          title: host.querySelector('#automation-title')?.value.trim() || '',
          prompt: host.querySelector('#automation-prompt')?.value.trim() || '',
          cadence: cadence?.value || 'daily',
          date: host.querySelector('#automation-date')?.value || '',
          time: host.querySelector('#automation-time')?.value || '09:00',
          everyMinutes: Number(host.querySelector('#automation-every')?.value) || 30,
          allowTools: Boolean(host.querySelector('#automation-tools')?.checked),
          enabled: true,
        };
        if (!payload.title) { payload.title = payload.prompt.slice(0, 60) || 'Scheduled run'; }
        button.disabled = true;
        try {
          await API.schedules.save(payload);
          vstate.automations.editing = '';
          UI.toast('Automation saved.', 'success');
          await reload();
        } catch (error) { button.disabled = false; UI.toast(error.message, 'error'); }
        return;
      }
      const edit = event.target.closest('[data-automation-edit]');
      if (edit) { vstate.automations.editing = edit.dataset.automationEdit; paintAutomations(host); return; }
      const run = event.target.closest('[data-automation-run]');
      if (run) {
        run.disabled = true;
        try { await API.schedules.run(run.dataset.automationRun); UI.toast('Automation started.', 'success'); await reload(); }
        catch (error) { run.disabled = false; UI.toast(error.message, 'error'); }
        return;
      }
      const remove = event.target.closest('[data-automation-delete]');
      if (remove) {
        const schedule = schedules.find((entry) => entry.id === remove.dataset.automationDelete);
        const confirmed = await UI.confirm({ title: 'Delete this automation?', message: 'Scheduled runs stop. Sessions it already created are kept.', confirmLabel: 'Delete', danger: true, detail: schedule?.title });
        if (!confirmed) return;
        try { await API.schedules.remove(remove.dataset.automationDelete); await reload(); UI.toast('Automation deleted.', 'success'); }
        catch (error) { UI.toast(error.message, 'error'); }
        return;
      }
      const open = event.target.closest('[data-automation-session]');
      if (open) { App.loadSession(open.dataset.automationSession); }
    };
    host.onchange = async (event) => {
      const toggle = event.target.closest('[data-automation-enabled]');
      if (!toggle) return;
      const schedule = schedules.find((entry) => entry.id === toggle.dataset.automationEnabled);
      if (!schedule) return;
      try {
        await API.schedules.save({ id: schedule.id, enabled: toggle.checked });
        await reload();
      } catch (error) { toggle.checked = !toggle.checked; UI.toast(error.message, 'error'); }
    };
  }

  /* ------------------------------------------------------------------ browser */

  function normalizeBrowserUrl(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (/^https?:\/\//i.test(text)) return text;
    if (/^[\w-]+(\.[\w-]+)+([/?#].*)?$/.test(text)) return `https://${text}`;
    return `https://duckduckgo.com/?q=${encodeURIComponent(text)}`;
  }

  function mountBrowser(host) {
    vstate.page = 'browser';
    vstate.host = host;
    const start = vstate.browserUrl || 'https://purplemacaron.github.io/blank/';
    host.innerHTML = `<div class="page-inner browser-page">
      ${UI.pageHeader({
        title: 'Browser',
        description: 'Read a page and hand it to the agent.',
        actions: `<button class="btn btn-secondary btn-sm" type="button" data-browser-chat>${icon('message', 12)} Ask about this page</button><button class="btn btn-secondary btn-sm" type="button" data-browser-external>${icon('external-link', 12)} Open externally</button>`,
        meta: '<span class="badge gray">Sandboxed</span>',
      })}
      <div class="browser-shell">
        <div class="browser-bar">
          <button class="mini-icon" type="button" data-browser="back" title="Back">${icon('chevron-left', 14)}</button>
          <button class="mini-icon" type="button" data-browser="forward" title="Forward">${icon('chevron-right', 14)}</button>
          <button class="mini-icon" type="button" data-browser="reload" title="Reload">${icon('refresh', 14)}</button>
          <button class="mini-icon" type="button" data-browser="home" title="Home">${icon('globe', 14)}</button>
          <input class="browser-address" id="browser-url" type="text" spellcheck="false" value="${U.attr(start)}" aria-label="Address" />
          <button class="btn btn-secondary btn-sm" type="button" data-browser="go">Open</button>
        </div>
        <div class="browser-frame">
          <webview id="blank-browser" src="${U.attr(start)}" partition="persist:blank-browser"></webview>
        </div>
        <div class="browser-status" id="browser-status"><span class="dot"></span><span data-browser-status-text>Loading…</span></div>
      </div>
      <div class="settings-permission-note">${icon('shield', 12)} Sandboxed. The agent sees a page only when you send it to chat.</div>
    </div>`;
    const view = host.querySelector('#blank-browser');
    const address = host.querySelector('#browser-url');
    const status = host.querySelector('[data-browser-status-text]');
    if (!view) return;
    vstate.browserUrl = start;
    const setStatus = (text, busy) => {
      if (status) status.textContent = text;
      host.querySelector('#browser-status .dot')?.classList.toggle('busy', Boolean(busy));
    };
    const sync = () => {
      try {
        const url = view.getURL();
        if (url && address) address.value = url;
        if (url) vstate.browserUrl = url;
      } catch {}
    };
    view.addEventListener('did-start-loading', () => setStatus('Loading…', true));
    view.addEventListener('did-stop-loading', () => { sync(); setStatus(view.getTitle() || 'Ready', false); });
    view.addEventListener('page-title-updated', (event) => { if (!view.isLoading()) setStatus(event.title || 'Ready', false); });
    view.addEventListener('did-navigate', sync);
    view.addEventListener('did-navigate-in-page', sync);
    view.addEventListener('did-fail-load', (event) => {
      if (event.errorCode === -3) return;
      setStatus(`Could not load the page${event.errorDescription ? ` · ${event.errorDescription}` : ''}`, false);
    });
    const go = () => {
      const url = normalizeBrowserUrl(address?.value);
      if (!url) return;
      if (address) address.value = url;
      vstate.browserUrl = url;
      view.loadURL(url).catch((error) => setStatus(error.message, false));
    };
    host.querySelectorAll('[data-browser]').forEach((button) => {
      button.addEventListener('click', () => {
        const action = button.dataset.browser;
        if (action === 'go') { go(); return; }
        try {
          if (action === 'back' && view.canGoBack()) view.goBack();
          else if (action === 'forward' && view.canGoForward()) view.goForward();
          else if (action === 'reload') view.reload();
          else if (action === 'home') { vstate.browserUrl = 'https://purplemacaron.github.io/blank/'; view.loadURL(vstate.browserUrl); }
        } catch {}
      });
    });
    address?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); go(); }
    });
    host.querySelector('[data-browser-external]')?.addEventListener('click', () => {
      const url = view.getURL() || vstate.browserUrl;
      if (/^https?:/i.test(url)) API.app.openExternal(url).catch((error) => UI.toast(error.message, 'error'));
    });
    host.querySelector('[data-browser-chat]')?.addEventListener('click', async () => {
      let title = '';
      let url = vstate.browserUrl;
      try { title = view.getTitle() || ''; url = view.getURL() || url; } catch {}
      let selection = '';
      try { selection = await view.executeJavaScript('String(window.getSelection ? window.getSelection().toString() : "").slice(0, 4000)'); } catch {}
      App.newSession();
      const lines = [
        'Use this page as context and answer my question.',
        title ? `Title: ${title}` : '',
        url ? `URL: ${url}` : '',
        selection ? `Selection:\n${selection}` : '',
        '',
      ].filter((line) => line !== '').join('\n');
      ChatView.focusComposer(`${lines}\n`);
    });
    setStatus('Loading…', true);
  }

  function dictationSuggestionsHtml(models = []) {
    if (!models.length) return '';
    return `<span class="dictation-suggest-label">Suggested:</span>${models.map((model, index) => `${index ? '<span class="dictation-suggest-sep">·</span>' : ''}<button class="link-btn" type="button" data-use-dictation-model="${U.attr(model)}">${esc(model)}</button>`).join('')}`;
  }

  function applyDictationSuggestions(host, models = []) {
    const fallback = models[0] || 'whisper-1';
    const input = host.querySelector('#dictation-model');
    if (input) {
      input.value = fallback;
      input.placeholder = fallback;
    }
    const list = host.querySelector('#dictation-model-list');
    if (list) list.innerHTML = models.map((model) => `<option value="${U.attr(model)}"></option>`).join('');
    const hint = host.querySelector('[data-dictation-suggest]');
    if (hint) hint.innerHTML = dictationSuggestionsHtml(models);
  }

  function updatePanelHtml(updates = {}) {
    const status = String(updates.status || 'idle');
    const current = String(updates.current || appState().info?.version || '');
    const version = String(updates.version || '');
    const percent = Math.max(0, Math.min(100, Number(updates.percent) || 0));
    const titles = {
      idle: 'Updates are checked automatically',
      dev: 'Automatic updates run in the installed app',
      unpacked: 'This copy cannot update itself',
      unsupported: 'Automatic updates are not available on this platform',
      checking: 'Checking for updates',
      current: 'Up to date',
      available: 'Update available',
      downloading: 'Downloading update',
      ready: 'Ready to install',
      installing: 'Installing update',
      error: 'Update check failed',
    };
    const descriptions = {
      idle: 'blank reads the official GitHub releases at launch and every six hours.',
      dev: 'This development build cannot update itself. Use an installed build to receive updates.',
      unpacked: 'blank is running from a temporary folder. Quit this window completely, then open the installed blank from the Start menu. This copy cannot update itself.',
      unsupported: 'Download the latest build from the release page.',
      checking: 'This only takes a moment.',
      current: 'You are running the latest version.',
      available: 'The new version is downloading in the background.',
      downloading: 'Keep working; the update installs after it finishes.',
      ready: 'Restart blank to finish installing.',
      installing: 'blank will close and reopen when the installer finishes.',
      error: 'Check your connection and try again.',
    };
    const tone = status === 'error'
      ? 'error'
      : status === 'ready'
        ? 'ready'
        : status === 'current'
          ? 'ok'
          : ['available', 'downloading'].includes(status) ? 'busy' : '';
    const canCheck = updates.supported !== false && !['checking', 'downloading', 'installing', 'ready', 'dev', 'unpacked', 'unsupported'].includes(status);
    const hasNewer = Boolean(version && version !== current);
    const badge = hasNewer ? `v${current} → v${version}` : (current ? `v${current}` : '');
    const badgeTitle = hasNewer ? `Current v${current}, available v${version}` : (current ? `Current v${current}` : '');
    const errorDetail = status === 'error' && updates.error ? String(updates.error) : '';
    return `<div class="update-panel" id="update-panel"${errorDetail ? ` title="${U.attr(errorDetail)}"` : ''}>
      <div class="update-head">
        <span class="update-dot ${tone}"></span>
        <div class="update-copy" aria-live="polite">
          <div class="update-title">${esc(titles[status] || titles.idle)}</div>
          <div class="update-desc">${esc(descriptions[status] || descriptions.idle)}</div>
        </div>
        ${badge ? `<span class="badge"${badgeTitle ? ` title="${U.attr(badgeTitle)}"` : ''}>${esc(badge)}</span>` : ''}
      </div>
      ${['available', 'downloading'].includes(status) ? `<progress class="update-progress" max="100" value="${percent}">${percent}%</progress><div class="update-progress-meta"><span>${percent}%</span>${updates.bytesPerSecond ? `<span>${esc(U.fmtBytes(updates.bytesPerSecond))}/s</span>` : ''}</div>` : ''}
      <div class="update-actions">
        <button class="btn btn-secondary btn-sm" type="button" data-update-check ${canCheck ? '' : 'disabled'}>${icon('refresh', 12)} ${esc('Check for updates')}</button>
        ${status === 'ready' ? `<button class="btn btn-primary btn-sm" type="button" data-update-install>${icon('download', 12)} ${esc('Install update')}</button>` : ''}
        <button class="link-btn" type="button" data-update-notes>${icon('external-link', 11)} ${esc('Release notes')}</button>
      </div>
    </div>`;
  }

  function applyUpdateStatus(status) {
    if (!status || typeof status !== 'object') return;
    vstate.settings.updates = status;
    if (vstate.page !== 'settings' || !vstate.host) return;
    const panel = vstate.host.querySelector('#update-panel');
    if (!panel || !document.contains(panel)) return;
    panel.outerHTML = updatePanelHtml(status);
  }

  const MESSENGER_META = [
    {
      id: 'telegram',
      name: 'Telegram',
      icon: 'send',
      desc: 'Create a bot with @BotFather, paste its token, then send /pair <code> from the chat you want to link.',
    },
    {
      id: 'discord',
      name: 'Discord',
      icon: 'message',
      desc: 'Create a bot in the Discord Developer Portal, enable Message Content Intent, then DM it or mention it after pairing.',
    },
    {
      id: 'slack',
      name: 'Slack',
      icon: 'message-square',
      desc: 'Create a Slack app with Socket Mode, then paste the app-level and bot tokens. DM the bot or mention it in a channel.',
    },
    {
      id: 'webhook',
      name: 'Webhook',
      icon: 'plug',
      desc: 'A loopback HTTP bridge for scripts and other apps. Send text to /message and receive runs and approvals as JSON.',
    },
  ];

  function messengerCardHtml(meta, stateInput, cfgInput) {
    const state = stateInput && typeof stateInput === 'object' ? stateInput : {};
    const cfg = cfgInput && typeof cfgInput === 'object' ? cfgInput : {};
    const enabled = state.enabled !== undefined ? Boolean(state.enabled) : cfg.enabled === true;
    const running = Boolean(state.running);
    const error = String(state.error || '');
    const paired = Number(state.paired) || 0;
    const statusLabel = running ? 'Running' : error ? 'Error' : enabled ? 'Ready' : 'Off';
    const badgeClass = running ? 'green' : error ? 'red' : '';
    const id = meta.id;
    const stateLine = id === 'webhook'
      ? (running ? 'Loopback bridge' : 'Bridge is off')
      : running && state.botName
        ? `@${String(state.botName)}`
        : paired ? `${paired} ${paired === 1 ? 'paired chat' : 'paired chats'}` : 'No paired chats yet.';
    let fields = '';

    if (id === 'telegram' || id === 'discord') {
      const hasToken = state.hasToken !== undefined ? Boolean(state.hasToken) : Boolean(cfg.hasToken);
      const preview = String(state.tokenPreview || cfg.tokenPreview || '');
      fields = `<div class="messenger-field">
        <label class="setting-label" for="messenger-${id}-token">Bot token</label>
        <div class="settings-inline-form">
          <input class="field-input settings-input" id="messenger-${id}-token" type="password" autocomplete="off" spellcheck="false" placeholder="${hasToken ? 'Saved — paste a new token to replace it' : 'Paste bot token'}" />
          <button class="btn btn-primary btn-sm" type="button" data-messenger-save="${id}">Save</button>
          ${hasToken ? `<button class="btn btn-ghost btn-sm" type="button" data-messenger-remove="${id}">Remove</button>` : ''}
        </div>
        <div class="setting-note">${hasToken && preview ? `Saved · ${esc(preview)}` : 'Stored only in ~/.blank/config.json and never shown again.'}</div>
      </div>`;
    } else if (id === 'slack') {
      const hasApp = state.hasAppToken !== undefined ? Boolean(state.hasAppToken) : Boolean(cfg.hasAppToken);
      const hasBot = state.hasBotToken !== undefined ? Boolean(state.hasBotToken) : Boolean(cfg.hasBotToken);
      const appPreview = String(state.appTokenPreview || cfg.appTokenPreview || '');
      const botPreview = String(state.botTokenPreview || cfg.botTokenPreview || '');
      fields = `<div class="messenger-field">
        <label class="setting-label" for="messenger-slack-app-token">App token</label>
        <input class="field-input settings-input" id="messenger-slack-app-token" type="password" autocomplete="off" spellcheck="false" placeholder="${hasApp ? 'Saved — paste a new app token to replace it' : 'Paste app-level token (xapp-)'}" />
      </div>
      <div class="messenger-field">
        <label class="setting-label" for="messenger-slack-bot-token">Bot token</label>
        <input class="field-input settings-input" id="messenger-slack-bot-token" type="password" autocomplete="off" spellcheck="false" placeholder="${hasBot ? 'Saved — paste a new bot token to replace it' : 'Paste bot token (xoxb-)'}" />
        <div class="settings-inline-form messenger-save-row">
          <button class="btn btn-primary btn-sm" type="button" data-messenger-save="slack">Save tokens</button>
          ${hasApp || hasBot ? '<button class="btn btn-ghost btn-sm" type="button" data-messenger-remove="slack">Remove</button>' : ''}
        </div>
        <div class="setting-note">${hasApp || hasBot ? `Saved · ${esc(appPreview || '—')} · ${esc(botPreview || '—')}` : 'Stored only in ~/.blank/config.json and never shown again.'}</div>
      </div>`;
    } else if (id === 'webhook') {
      const endpoint = String(state.endpoint || cfg.endpoint || `http://127.0.0.1:${Number(state.port || cfg.port) || 8789}/message`);
      const secret = String(state.secret || '');
      const port = Number(state.port || cfg.port) || 8789;
      const url = String(state.url !== undefined ? state.url : cfg.url || '');
      fields = `<div class="messenger-field">
        <div class="setting-label">Endpoint</div>
        <div class="messenger-code-row"><code>${esc(endpoint)}</code><button class="btn btn-secondary btn-sm" type="button" data-copy-messenger="webhook-endpoint">Copy</button></div>
        <div class="setting-note">Send POST { "text": "…" } with Authorization: Bearer &lt;secret&gt;.</div>
      </div>
      <div class="messenger-field">
        <div class="setting-label">Secret</div>
        <div class="messenger-code-row"><span class="messenger-code-value">${secret ? esc(secret) : 'Not generated yet'}</span><button class="btn btn-secondary btn-sm" type="button" data-copy-messenger="webhook-secret" ${secret ? '' : 'disabled'}>Copy</button></div>
        <div class="setting-note">Requests without this secret are rejected.</div>
      </div>
      <div class="messenger-field">
        <label class="setting-label" for="messenger-webhook-port">Port</label>
        <div class="settings-inline-form">
          <input class="setting-inline-input" id="messenger-webhook-port" type="number" min="1024" max="65535" value="${port}" />
          <button class="btn btn-secondary btn-sm" type="button" data-messenger-port>Apply</button>
        </div>
      </div>
      <div class="messenger-field">
        <label class="setting-label" for="messenger-webhook-url">Notification URL</label>
        <div class="settings-inline-form">
          <input class="field-input settings-input" id="messenger-webhook-url" type="url" placeholder="https://example.com/blank" value="${U.attr(url)}" />
          <button class="btn btn-secondary btn-sm" type="button" data-messenger-url>Save</button>
        </div>
        <div class="setting-note">Used for outbound run and approval notifications. Leave empty to poll the bridge instead.</div>
      </div>`;
    }

    const logo = window.MessengerLogos?.for(id);

    return `<article class="messenger-card" data-messenger-card="${id}">
      <header class="messenger-head">
        <span class="messenger-icon ${logo ? 'has-logo' : ''}">${logo || icon(meta.icon, 15)}</span>
        <div class="messenger-head-copy">
          <div class="messenger-name">${esc(meta.name)}</div>
          <div class="messenger-state">${esc(stateLine)}</div>
        </div>
        <span class="badge ${badgeClass}">${statusLabel}</span>
      </header>
      <p class="messenger-desc">${esc(meta.desc)}</p>
      ${fields}
      <div class="messenger-foot">
        <div class="messenger-switch">${UI.switchHtml(enabled, `data-messenger-enable="${id}"`)}<span>${enabled ? 'Enabled' : 'Disabled'}</span></div>
        <div class="messenger-actions">
          <button class="btn btn-secondary btn-sm" type="button" data-messenger-test="${id}">Test</button>
          ${paired && id !== 'webhook' ? `<button class="btn btn-ghost btn-sm" type="button" data-messenger-unpair="${id}">Unpair all</button>` : ''}
        </div>
      </div>
      <div class="setting-note messenger-note" id="messenger-test-${id}"></div>
      ${error ? `<div class="messenger-error">${icon('shield-alert', 11)}<span>${esc(error)}</span></div>` : ''}
    </article>`;
  }

  async function handleMessengerEvent(event, host, repaint) {
    const copyMessenger = event.target.closest('[data-copy-messenger]');
    if (copyMessenger) {
      const what = copyMessenger.dataset.copyMessenger;
      const state = vstate.settings.messengers || {};
      const value = what === 'pair-code'
        ? String(state.pairCode || '')
        : what === 'webhook-secret'
          ? String(state.webhook?.secret || '')
          : what === 'webhook-endpoint'
            ? String(state.webhook?.endpoint || '')
            : '';
      if (value) {
        const ok = await U.copyText(value);
        UI.toast(ok ? 'Copied.' : 'Could not access the clipboard.', ok ? 'success' : 'error');
      }
      return true;
    }
    const messengerSave = event.target.closest('[data-messenger-save]');
    if (messengerSave) {
      const provider = messengerSave.dataset.messengerSave;
      const payload = { provider };
      if (provider === 'slack') {
        const appToken = host.querySelector('#messenger-slack-app-token')?.value.trim() || '';
        const botToken = host.querySelector('#messenger-slack-bot-token')?.value.trim() || '';
        if (!appToken && !botToken) { UI.toast('Paste at least one token first.', 'error'); return true; }
        if (appToken) payload.appToken = appToken;
        if (botToken) payload.botToken = botToken;
      } else {
        const token = host.querySelector(`#messenger-${provider}-token`)?.value.trim() || '';
        if (!token) { UI.toast('Paste a token first.', 'error'); return true; }
        payload.token = token;
      }
      messengerSave.disabled = true;
      try {
        vstate.settings.messengers = await API.messengers.configure(payload);
        repaint();
        UI.toast('Messenger settings saved.', 'success');
      } catch (error) { messengerSave.disabled = false; UI.toast(error.message, 'error'); }
      return true;
    }
    const messengerRemove = event.target.closest('[data-messenger-remove]');
    if (messengerRemove) {
      const provider = messengerRemove.dataset.messengerRemove;
      const meta = MESSENGER_META.find((entry) => entry.id === provider);
      const ok = await UI.confirm({
        title: 'Remove this token?',
        message: 'This messenger turns off until a new token is saved.',
        confirmLabel: 'Remove token',
        danger: true,
        detail: meta?.name || provider,
      });
      if (ok) {
        try {
          vstate.settings.messengers = await API.messengers.configure({ provider, clearToken: true });
          repaint();
          UI.toast('Token removed.', 'success');
        } catch (error) { UI.toast(error.message, 'error'); }
      }
      return true;
    }
    const messengerToggle = event.target.closest('[data-messenger-enable]');
    if (messengerToggle) {
      const provider = messengerToggle.dataset.messengerEnable;
      const next = !messengerToggle.classList.contains('on');
      messengerToggle.disabled = true;
      try {
        vstate.settings.messengers = await API.messengers.configure({ provider, enabled: next });
        repaint();
        UI.toast(next ? 'Messenger enabled.' : 'Messenger disabled.', next ? 'success' : 'warn');
      } catch (error) { messengerToggle.disabled = false; UI.toast(error.message, 'error'); }
      return true;
    }
    const messengerNotify = event.target.closest('[data-messenger-notify]');
    if (messengerNotify) {
      const next = !messengerNotify.classList.contains('on');
      messengerNotify.classList.toggle('on', next);
      messengerNotify.setAttribute('aria-checked', String(next));
      try {
        vstate.settings.messengers = await API.messengers.configure({ notify: next });
        UI.toast(next ? 'Run updates are on.' : 'Run updates are off.', next ? 'success' : 'warn');
      } catch (error) {
        messengerNotify.classList.toggle('on', !next);
        messengerNotify.setAttribute('aria-checked', String(!next));
        UI.toast(error.message, 'error');
      }
      return true;
    }
    const messengerTest = event.target.closest('[data-messenger-test]');
    if (messengerTest) {
      const provider = messengerTest.dataset.messengerTest;
      const note = host.querySelector(`#messenger-test-${provider}`);
      messengerTest.disabled = true;
      if (note) note.textContent = 'Testing…';
      try {
        const result = await API.messengers.test(provider);
        if (!result.ok) throw new Error(result.error || 'Connection test failed.');
        if (note) note.textContent = provider === 'webhook'
          ? `Webhook is running on ${result.name}.`
          : `Connected as ${result.name}.`;
        UI.toast('Messenger is ready.', 'success');
      } catch (error) {
        if (note) note.textContent = error.message;
        UI.toast(error.message, 'error');
      } finally { messengerTest.disabled = false; }
      return true;
    }
    const messengerUnpair = event.target.closest('[data-messenger-unpair]');
    if (messengerUnpair) {
      const provider = messengerUnpair.dataset.messengerUnpair;
      const meta = MESSENGER_META.find((entry) => entry.id === provider);
      const ok = await UI.confirm({
        title: 'Unpair every chat?',
        message: 'Chats must pair again with the current code.',
        confirmLabel: 'Unpair',
        danger: true,
        detail: meta?.name || provider,
      });
      if (ok) {
        try {
          vstate.settings.messengers = await API.messengers.configure({ provider, unpair: true });
          repaint();
          UI.toast('Paired chats cleared.', 'success');
        } catch (error) { UI.toast(error.message, 'error'); }
      }
      return true;
    }
    if (event.target.closest('[data-messenger-port]')) {
      try {
        const port = Number(host.querySelector('#messenger-webhook-port')?.value) || 8789;
        vstate.settings.messengers = await API.messengers.configure({ provider: 'webhook', port });
        repaint();
        UI.toast('Webhook port saved.', 'success');
      } catch (error) { UI.toast(error.message, 'error'); }
      return true;
    }
    if (event.target.closest('[data-messenger-url]')) {
      try {
        const url = host.querySelector('#messenger-webhook-url')?.value.trim() || '';
        vstate.settings.messengers = await API.messengers.configure({ provider: 'webhook', url });
        repaint();
        UI.toast('Notification URL saved.', 'success');
      } catch (error) { UI.toast(error.message, 'error'); }
      return true;
    }
    return false;
  }

  function messengerSectionHtml(stateInput, cfgInput) {
    const state = stateInput && typeof stateInput === 'object' ? stateInput : {};
    const cfg = cfgInput && typeof cfgInput === 'object' ? cfgInput : {};
    const pairCode = String(state.pairCode || '');
    const notify = state.notify !== undefined ? state.notify !== false : cfg.notify !== false;
    const cards = MESSENGER_META.map((meta) => messengerCardHtml(meta, state[meta.id], cfg[meta.id]));
    const running = MESSENGER_META.filter((meta) => Boolean(state[meta.id]?.running)).length;
    return `<section class="mcp-section" id="mcp-messengers">
      <div class="mcp-section-head">
        <div class="mcp-section-title">Messengers</div>
        <span class="badge ${running ? 'green' : ''}">${running ? `${running} running` : 'Off'}</span>
      </div>
      <div class="messenger-pair">
        <div class="messenger-pair-copy">
          <div class="messenger-pair-head">${icon('key', 12)} Pairing code</div>
          <p>Send /pair &lt;code&gt; from the chat you want to link. The code changes after every pairing.</p>
          <div class="messenger-code-row">
            <code id="messenger-pair-code">${esc(pairCode || '——————')}</code>
            <button class="btn btn-secondary btn-sm" type="button" data-copy-messenger="pair-code" ${pairCode ? '' : 'disabled'}>Copy code</button>
          </div>
        </div>
        <div class="messenger-pair-side">
          <div class="setting-label">Run and approval updates</div>
          <p class="messenger-pair-desc">Send final answers and approval requests to the paired chat. Desktop runs notify the last active chat.</p>
          <div class="setting-control">${UI.switchHtml(notify, 'data-messenger-notify')}</div>
        </div>
      </div>
      <div class="messenger-grid">${cards.join('')}</div>
      <div class="settings-permission-note">${icon('shield', 12)} Only paired chats can start runs or approve tools. Tokens stay in the main process and never reach this window.</div>
    </section>`;
  }

  function paintSettings(host) {
    const config = currentConfig();
    const info = appState().info || {};
    const agent = config.agent || {};
    const permissions = config.permissions || {};
    const approvalMode = ['all', 'auto'].includes(config.approvals?.mode) ? config.approvals.mode : 'important';
    const providers = appState().catalog?.providers || vstate.models.providers;
    const runtime = appState().config?.runtime || info;
    const defaultModel = config.defaultModel || '';
    const fallbackModel = config.fallbackModel || '';
    const rows = Object.keys(TOOL_LABELS).filter((key) => key in permissions || ['generate_media', 'edit_media'].includes(key));
    const searchCfg = config.search || {};
    const searchId = SEARCH_BACKENDS.some((backend) => backend.id === searchCfg.provider) ? searchCfg.provider : 'duckduckgo';
    const searchMeta = SEARCH_BACKENDS.find((backend) => backend.id === searchId);
    const searchHasKey = Boolean(searchCfg.hasKey && searchCfg.hasKey[searchId]);
    const searchResults = Math.max(1, Math.min(10, Number(searchCfg.maxResults) || 6));
    const computerCfg = config.computer || {};
    const updatesCfg = config.updates || {};
    const updates = vstate.settings.updates || {
      status: info.isDev ? 'dev' : 'idle',
      current: info.version || runtime.version || '',
      supported: !info.isDev,
    };
    const remoteCfg = config.remote || vstate.settings.remote || {};
    const remoteState = vstate.settings.remote || {};
    const remoteRunning = Boolean(remoteState.running);
    const remotePort = Number(remoteState.port) || Number(remoteCfg.port) || 8787;
    const remoteToken = remoteRunning ? String(remoteState.token || '') : '';
    const remoteUrls = remoteRunning && Array.isArray(remoteState.urls) ? remoteState.urls : [];
    const teamCfg = config.team || { enabled: false, members: [] };
    const teamMembers = Array.isArray(teamCfg.members) ? teamCfg.members : [];
    const schedules = Array.isArray(vstate.settings.schedules) ? vstate.settings.schedules : [];
    const defaultProfile = U.reasoningProfile({ providers }, defaultModel);
    const defaultEffort = U.normalizeReasoning(defaultProfile, agent.reasoningEffort);
    const notificationsCfg = config.notifications || {};
    const dictationCfg = config.dictation || {};
    const dictationOptions = vstate.settings.dictationOptions;
    const dictationChoices = Array.isArray(dictationOptions?.providers) && dictationOptions.providers.length
      ? dictationOptions.providers
      : (providers || [])
        .filter((provider) => provider.protocol === 'openai' && config.providers?.[provider.id]?.hasKey)
        .map((provider) => ({ id: provider.id, name: provider.name, models: ['whisper-1'] }));
    const customDictation = dictationCfg.providerId === '__custom';
    const dictationSelection = customDictation
      ? null
      : dictationChoices.find((provider) => provider.id === dictationCfg.providerId)
        || dictationChoices.find((provider) => provider.id === 'openai')
        || dictationChoices[0]
        || null;
    const dictationModels = customDictation
      ? []
      : dictationSelection?.models?.length ? dictationSelection.models : ['whisper-1'];
    const savedDictationModel = String(dictationCfg.model || '');
    const dictationModelValue = customDictation
      ? savedDictationModel
      : savedDictationModel && !(savedDictationModel === 'whisper-1' && !dictationModels.includes('whisper-1'))
        ? savedDictationModel
        : dictationModels[0];
    const dictationBaseUrl = String(dictationCfg.baseUrl || '');
    const dictationHasKey = Boolean(dictationCfg.hasKey);
    const dictationLanguages = [
      ['', 'Auto detect'], ['ko', 'Korean'], ['en', 'English'], ['ja', 'Japanese'], ['zh', 'Chinese'],
      ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['pt', 'Portuguese'], ['ru', 'Russian'],
    ];
    const language = config.language === 'en' ? 'en' : 'ko';
    const uiFont = ['noto', 'system', 'mono'].includes(config.ui?.font) ? config.ui.font : 'noto';
    host.innerHTML = `<div class="page-inner">
      ${UI.pageHeader({
        title: 'Settings',
        description: 'Tune how blank thinks, what it may touch, and where your data lives.',
        actions: `<button class="btn btn-secondary btn-sm" data-open-data>${icon('folder-open', 12)} Data folder</button>`,
      })}
      <div class="settings-layout">
        <nav class="settings-nav">
          <button class="settings-nav-item active" type="button" data-settings-go="general">${icon('settings', 13)} General</button>
          <button class="settings-nav-item" type="button" data-settings-go="agent">${icon('bot', 13)} Agent</button>
          <button class="settings-nav-item" type="button" data-settings-go="dictation">${icon('mic', 13)} Dictation</button>
          <button class="settings-nav-item" type="button" data-settings-go="team">${icon('bot', 13)} Agent team</button>
          <button class="settings-nav-item" type="button" data-settings-go="schedules">${icon('clock', 13)} Schedules</button>
          <button class="settings-nav-item" type="button" data-settings-go="notifications">${icon('bell', 13)} Notifications</button>
          <button class="settings-nav-item" type="button" data-settings-go="approvals">${icon('shield', 13)} Approvals</button>
          <button class="settings-nav-item" type="button" data-settings-go="search">${icon('globe', 13)} Web search</button>
          <button class="settings-nav-item" type="button" data-settings-go="computer">${icon('monitor', 13)} Computer</button>
          <button class="settings-nav-item" type="button" data-settings-go="remote">${icon('link', 13)} Remote</button>
          <button class="settings-nav-item" type="button" data-settings-go="data">${icon('database', 13)} Data & CLI</button>
          <button class="settings-nav-item" type="button" data-settings-go="updates">${icon('download-cloud', 13)} Updates</button>
          <button class="settings-nav-item" type="button" data-settings-go="about">${icon('sparkles', 13)} About</button>
        </nav>
        <div class="settings-content">
          <section class="settings-section" id="settings-general">
            <h2>General</h2>
            <p>The workspace, the default model, and how much of the agent's thinking you see.</p>
            <div class="settings-group">
              <div class="setting-row">
                <div class="setting-copy"><div class="setting-label">Theme</div><div class="setting-desc">White is the default. System follows your OS.</div></div>
                <div class="setting-control theme-options">
                  ${['light', 'dark', 'system'].map((theme) => `<button class="theme-option ${config.theme === theme ? 'active' : ''}" type="button" data-theme="${theme}"><span class="theme-preview ${theme === 'light' ? '' : theme}"></span>${theme === 'light' ? 'Light' : theme === 'dark' ? 'Dark' : 'System'}</button>`).join('')}
                </div>
              </div>
              <div class="setting-row">
                <div class="setting-copy"><div class="setting-label">Interface language</div><div class="setting-desc">English or Korean. Switching reloads this window.</div></div>
                <div class="setting-control language-options" data-no-i18n>
                  <button class="theme-option ${language === 'ko' ? 'active' : ''}" type="button" data-language="ko">한국어</button>
                  <button class="theme-option ${language === 'en' ? 'active' : ''}" type="button" data-language="en">English</button>
                </div>
              </div>
              <div class="setting-row">
                <div class="setting-copy"><div class="setting-label">Interface font</div><div class="setting-desc">The typeface used across the app. Changes apply immediately.</div></div>
                <div class="setting-control language-options">
                  ${[['noto', 'Noto Sans KR'], ['system', 'System UI'], ['mono', 'Monospace']].map(([value, label]) => `<button class="theme-option ${uiFont === value ? 'active' : ''}" type="button" data-font="${value}">${label}</button>`).join('')}
                </div>
              </div>
              <div class="setting-row">
                <div class="setting-copy"><div class="setting-label">Desktop pet</div><div class="setting-desc">One paper follows the AI in use, plus one per blank Team member while the team works. Hover to see which AI or team a paper belongs to. Click a paper to type an instruction; drag it anywhere, right-click for more. Turn it off to hide every pet.</div></div>
                <div class="setting-control">${UI.switchHtml(config.pet?.enabled !== false, 'data-pet-toggle')}</div>
              </div>
              <div class="setting-row">
                <div class="setting-copy"><div class="setting-label">Default model</div><div class="setting-desc">Used by new sessions and as the fallback for delegations.</div></div>
                <div class="setting-control"><button class="btn btn-secondary btn-sm" type="button" data-pick-model="default">${esc(U.modelLabel({ providers }, defaultModel))} ${icon('chevron-updown', 11)}</button></div>
              </div>
              <div class="setting-row">
                <div class="setting-copy"><div class="setting-label">Fallback model</div><div class="setting-desc">Tried when the primary model errors or is rate-limited.</div></div>
                <div class="setting-control"><button class="btn btn-secondary btn-sm" type="button" data-pick-model="fallback">${esc(fallbackModel ? U.modelLabel({ providers }, fallbackModel) : 'None')} ${icon('chevron-updown', 11)}</button></div>
              </div>
              <div class="setting-row">
                <div class="setting-copy"><div class="setting-label">Show model reasoning</div><div class="setting-desc">Render thinking blocks when a provider returns them.</div></div>
                <div class="setting-control">${UI.switchHtml(agent.showReasoning !== false, 'data-agent-toggle="showReasoning"')}</div>
              </div>
              <div class="setting-row">
                <div class="setting-copy"><div class="setting-label">Workspace</div><div class="setting-desc">The only folder the agent may read or write without asking.</div></div>
                <div class="setting-control"><button class="btn btn-secondary btn-sm" type="button" data-choose-workspace>${icon('folder', 12)} Change</button></div>
              </div>
              <div class="setting-row" style="display:block">
                <div class="setting-copy" style="padding:0"><div class="setting-label">Standing instructions</div><div class="setting-desc">Appended to every system prompt. Keep it short and durable.</div></div>
                <textarea class="settings-textarea" id="custom-instructions" placeholder="Always answer in Korean. Prefer small, reviewable diffs.">${esc(config.customInstructions || '')}</textarea>
                <div class="provider-actions"><button class="btn btn-secondary btn-sm" type="button" data-save-instructions>Save instructions</button><span class="setting-note" id="instructions-note">Up to 20,000 characters.</span></div>
              </div>
            </div>
          </section>

          <section class="settings-section" id="settings-agent">
            <h2>Agent</h2>
            <p>Limits for the tool loop, context compaction and automatic learning.</p>
            <div class="settings-group">
              <div class="setting-row">
                <div class="setting-copy"><div class="setting-label">Maximum steps</div><div class="setting-desc">Upper bound on model turns per request. Higher means deeper work.</div></div>
                <div class="setting-control"><input class="setting-inline-input" style="width:76px" id="agent-max-steps" type="number" min="1" max="64" value="${Number(agent.maxSteps) || 32}" /></div>
              </div>
              <div class="setting-row">
                <div class="setting-copy"><div class="setting-label">Reasoning effort</div><div class="setting-desc">Starting stage for new chats. Choices follow the default model's supported stages.</div></div>
                <div class="setting-control">${defaultProfile && defaultProfile.levels.length > 1
                  ? `<select class="setting-inline-input" id="agent-reasoning">${defaultProfile.levels.map((value) => `<option value="${value}" ${defaultEffort === value ? 'selected' : ''}>${esc(U.REASONING_LEVELS[value]?.label || value)}</option>`).join('')}</select>`
                  : `<span class="setting-value">${esc(defaultProfile ? U.reasoningLabel(defaultProfile, defaultEffort) : 'Model decides')}</span>`}</div>
              </div>
              <div class="setting-row">
                <div class="setting-copy"><div class="setting-label">Auto-compact context</div><div class="setting-desc">Summarize older turns when the window fills.</div></div>
                <div class="setting-control">${UI.switchHtml(agent.autoCompact !== false, 'data-agent-toggle="autoCompact"')}</div>
              </div>
              <div class="setting-row">
                <div class="setting-copy"><div class="setting-label">Compact threshold</div><div class="setting-desc">Fraction of the context window before summarizing. ${Math.round((agent.compactAt || 0.82) * 100)}%</div></div>
                <div class="setting-control"><input class="setting-inline-input" style="width:76px" id="agent-compact-at" type="number" min="50" max="95" step="1" value="${Math.round((agent.compactAt || 0.82) * 100)}" /> <span class="setting-value">%</span></div>
              </div>
              <div class="setting-row">
                <div class="setting-copy"><div class="setting-label">Automatic memory</div><div class="setting-desc">Let the agent save durable facts while it works.</div></div>
                <div class="setting-control">${UI.switchHtml(agent.autoMemory !== false, 'data-agent-toggle="autoMemory"')}</div>
              </div>
              <div class="setting-row">
                <div class="setting-copy"><div class="setting-label">Background reflection</div><div class="setting-desc">Periodically propose insights after longer sessions.</div></div>
                <div class="setting-control">${UI.switchHtml(Boolean(agent.autoReflect), 'data-agent-toggle="autoReflect"')}</div>
              </div>
            </div>
            <div class="provider-actions"><button class="btn btn-primary btn-sm" type="button" data-save-agent>Save agent settings</button></div>
          </section>

          <section class="settings-section" id="settings-dictation">
            <h2>Dictation</h2>
            <p>Speech-to-text in the chat composer. blank records only while the mic is active, then sends the clip to the provider you choose. The API key comes from Models and never appears here.</p>
            <div class="settings-group">
              <div class="setting-row">
                <div class="setting-copy"><div class="setting-label">Transcription provider</div><div class="setting-desc">Any OpenAI-compatible provider with a saved key and a /audio/transcriptions endpoint. Audio is sent only when you stop a recording.</div></div>
                <div class="setting-control">
                  <select class="settings-select" id="dictation-provider">
                    <option value="" ${dictationCfg.providerId ? '' : 'selected'}>Auto — first connected</option>
                    ${dictationChoices.map((provider) => `<option value="${U.attr(provider.id)}" ${dictationCfg.providerId === provider.id ? 'selected' : ''}>${esc(provider.name)}</option>`).join('')}
                    <option value="__custom" ${customDictation ? 'selected' : ''}>Custom endpoint</option>
                  </select>
                </div>
              </div>
              <div class="setting-row" data-dictation-custom ${customDictation ? '' : 'hidden'}>
                <div class="setting-copy">
                  <div class="setting-label">Endpoint</div>
                  <div class="setting-desc">Any OpenAI-compatible speech server. blank posts the clip to /audio/transcriptions under this URL.</div>
                  <div class="setting-note">Use a local Whisper server or another provider's transcription API.</div>
                </div>
                <div class="setting-control wide">
                  <input class="setting-inline-input" id="dictation-base-url" type="url" spellcheck="false" autocomplete="off" value="${U.attr(dictationBaseUrl)}" placeholder="http://localhost:8000/v1" />
                </div>
              </div>
              <div class="setting-row" data-dictation-custom ${customDictation ? '' : 'hidden'}>
                <div class="setting-copy">
                  <div class="setting-label">API key</div>
                  <div class="setting-desc">Optional. Kept in the main process and stored only in config.json.</div>
                </div>
                <div class="setting-control wide">
                  <input class="setting-inline-input" id="dictation-key" type="password" spellcheck="false" autocomplete="new-password" value="" placeholder="${dictationHasKey ? 'Saved key — leave blank to keep' : 'Optional'}" />
                  ${dictationHasKey ? '<button class="link-btn" type="button" data-clear-dictation-key>Remove saved key</button>' : ''}
                </div>
              </div>
              <div class="setting-row">
                <div class="setting-copy">
                  <div class="setting-label">Transcription model</div>
                  <div class="setting-desc">Pick a suggestion or type any transcription model id your provider offers. blank uses the provider's recommended model.</div>
                  <div class="dictation-suggest" data-dictation-suggest>${dictationSuggestionsHtml(dictationModels)}</div>
                </div>
                <div class="setting-control">
                  <input class="setting-inline-input" id="dictation-model" type="text" spellcheck="false" value="${U.attr(dictationModelValue)}" placeholder="${U.attr(dictationModels[0] || 'whisper-1')}" list="dictation-model-list" />
                  <datalist id="dictation-model-list">${dictationModels.map((model) => `<option value="${U.attr(model)}"></option>`).join('')}</datalist>
                </div>
              </div>
              <div class="setting-row">
                <div class="setting-copy"><div class="setting-label">Spoken language</div><div class="setting-desc">Auto detect works for mixed speech. Naming a language usually improves accuracy.</div></div>
                <div class="setting-control">
                  <select class="settings-select" id="dictation-language">
                    ${dictationLanguages.map(([code, label]) => `<option value="${code}" ${String(dictationCfg.language || '') === code ? 'selected' : ''}>${label}</option>`).join('')}
                  </select>
                </div>
              </div>
            </div>
            <div class="provider-actions">
              <button class="btn btn-primary btn-sm" type="button" data-save-dictation>Save dictation settings</button>
              <span class="setting-note">${customDictation
                ? (dictationBaseUrl ? 'Custom endpoint' : 'Add an endpoint URL')
                : dictationChoices.length ? 'Ready' : 'Add an OpenAI-compatible key or use a custom endpoint'}</span>
            </div>
            <div class="settings-permission-note">${icon('mic', 12)} The microphone is allowed only for this app. Recordings stay in memory, are sent once for transcription, and are never written to disk by blank.</div>
          </section>

          <section class="settings-section" id="settings-team">
            <h2>Agent team</h2>
            <p>Multi-agent mode. Specialists investigate the same brief in parallel, then the main agent synthesizes their reports. Team members are always read-only.</p>
            <div class="settings-group">
              <div class="setting-row">
                <div class="setting-copy"><div class="setting-label">Enable the agent team</div><div class="setting-desc">Adds the team_delegate tool and team guidance to the system prompt.</div></div>
                <div class="setting-control">${UI.switchHtml(Boolean(teamCfg.enabled), 'data-team-toggle')}</div>
              </div>
            </div>
            <div class="team-members" data-team-members>
              ${teamMembers.map((member) => teamMemberRow(member)).join('') || '<div class="setting-note">No members yet. Add one below.</div>'}
            </div>
            <div class="provider-actions">
              <button class="btn btn-secondary btn-sm" type="button" data-team-add>${icon('plus', 12)} Add member</button>
              <button class="btn btn-primary btn-sm" type="button" data-save-team>Save team</button>
              <span class="setting-note">Up to six members. Each may use a different model id.</span>
            </div>
            <div class="settings-permission-note">${icon('bot', 12)} Team runs share this session's workspace and consume tokens in parallel. Reports return to the main agent, not directly to you.</div>
          </section>

          <section class="settings-section" id="settings-schedules">
            <h2>Schedules</h2>
            <p>Run a prompt once or on a timer while blank is open. Each run becomes a normal session you can read and continue.</p>
            <div class="settings-group">
              <div class="setting-row schedule-compose-row">
                <input class="field-input" id="schedule-title" maxlength="80" placeholder="Schedule name" spellcheck="false" />
                <select class="setting-inline-input" id="schedule-cadence">
                  <option value="daily">Every day</option>
                  <option value="weekdays">Weekdays</option>
                  <option value="hourly">Every hour</option>
                  <option value="once">Just once</option>
                </select>
                <input class="setting-inline-input" id="schedule-date" type="date" value="${localDateValue()}" aria-label="One-time run date" hidden />
                <input class="setting-inline-input" id="schedule-time" type="time" value="09:00" />
              </div>
              <textarea class="settings-textarea" id="schedule-prompt" rows="3" placeholder="What should blank do when this runs?"></textarea>
              <div class="provider-actions">
                <button class="btn btn-primary btn-sm" type="button" data-save-schedule>${icon('plus', 12)} Add schedule</button>
                <label class="schedule-check"><input type="checkbox" id="schedule-tools" /> Allow tools without asking</label>
                <span class="setting-note">Off means approval-gated tools are denied automatically.</span>
              </div>
            </div>
            <div class="schedule-list">
              ${schedules.length ? schedules.map((schedule) => {
                const next = schedule.nextRunAt ? new Date(schedule.nextRunAt) : null;
                const onceDone = schedule.cadence === 'once' && schedule.enabled === false && schedule.lastRunAt;
                const nextText = next && !Number.isNaN(next.getTime()) ? next.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : onceDone ? 'done' : 'Paused';
                const cadence = schedule.cadence === 'once' ? cadenceLabel(schedule) : schedule.cadence === 'hourly' ? `Every hour at :${String(schedule.time || '09:00').slice(3, 5)}` : schedule.cadence === 'weekdays' ? `Weekdays at ${schedule.time}` : `Every day at ${schedule.time}`;
                const lastText = schedule.lastRunAt ? new Date(schedule.lastRunAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
                return `<div class="schedule-row ${schedule.running ? 'running' : ''}" data-schedule-id="${U.attr(schedule.id)}">
                  <div class="schedule-copy">
                    <div class="schedule-head"><span class="schedule-title">${esc(schedule.title)}</span>${schedule.running ? '<span class="badge amber">Running</span>' : schedule.lastStatus === 'ok' ? '<span class="badge green">OK</span>' : schedule.lastStatus === 'error' ? '<span class="badge red">Error</span>' : ''}</div>
                    <div class="schedule-meta"><span>${esc(cadence)}</span> · <span>${next ? `next ${esc(nextText)}` : onceDone ? 'done' : 'Paused'}</span>${lastText ? ` · <span>last ${esc(lastText)}</span>` : ''}</div>
                    <div class="schedule-prompt">${esc(U.truncate(schedule.prompt, 140))}</div>
                    ${schedule.lastError ? `<div class="schedule-error">${esc(U.truncate(schedule.lastError, 160))}</div>` : ''}
                  </div>
                  <div class="schedule-actions">
                    <button class="btn btn-secondary btn-sm" type="button" data-run-schedule="${U.attr(schedule.id)}" ${schedule.running ? 'disabled' : ''}>${icon('play', 11)} Run now</button>
                    <button class="mini-icon" type="button" data-delete-schedule="${U.attr(schedule.id)}" title="Delete schedule">${icon('trash', 13)}</button>
                  </div>
                </div>`;
              }).join('') : '<div class="setting-note">No schedules yet.</div>'}
            </div>
          </section>

          <section class="settings-section" id="settings-notifications">
            <h2>Notifications</h2>
            <p>Native desktop notifications for work that finishes while blank is in the background. Focused windows stay quiet.</p>
            <div class="settings-group">
              <div class="setting-row">
                <div class="setting-copy"><div class="setting-label">Desktop notifications</div><div class="setting-desc">Master switch for every notification below.</div></div>
                <div class="setting-control">${UI.switchHtml(notificationsCfg.enabled !== false, 'data-notification-toggle="enabled"')}</div>
              </div>
              <div class="setting-row">
                <div class="setting-copy"><div class="setting-label">Run finished</div><div class="setting-desc">A chat run completes or stops while the window is in the background.</div></div>
                <div class="setting-control">${UI.switchHtml(notificationsCfg.onFinish !== false, 'data-notification-toggle="onFinish"')}</div>
              </div>
              <div class="setting-row">
                <div class="setting-copy"><div class="setting-label">Approval needed</div><div class="setting-desc">A tool is waiting for your decision and blank is not focused.</div></div>
                <div class="setting-control">${UI.switchHtml(notificationsCfg.onApproval !== false, 'data-notification-toggle="onApproval"')}</div>
              </div>
              <div class="setting-row">
                <div class="setting-copy"><div class="setting-label">Scheduled results</div><div class="setting-desc">A schedule finishes, fails or is stopped in the background.</div></div>
                <div class="setting-control">${UI.switchHtml(notificationsCfg.schedules !== false, 'data-notification-toggle="schedules"')}</div>
              </div>
              <div class="setting-row">
                <div class="setting-copy"><div class="setting-label">Test notification</div><div class="setting-desc">Sends one notification now, even while this window is focused.</div><div class="setting-note" id="notification-test-note"></div></div>
                <div class="setting-control"><button class="btn btn-secondary btn-sm" type="button" data-test-notification>${icon('bell', 12)} Send test</button></div>
              </div>
            </div>
            <div class="settings-permission-note">${icon('bell', 12)} Clicking a notification brings blank to the front and opens the related session. Nothing is sent to a server.</div>
          </section>

          <section class="settings-section" id="settings-approvals">
            <h2>Approvals</h2>
            <p>Routine file edits, reads, builds and tests run on their own. Destructive, external, credential-touching and unfamiliar actions stop for your approval.</p>
            <div class="settings-group">
              <div class="setting-row">
                <div class="setting-copy">
                  <div class="setting-label">Confirmation level</div>
                  <div class="setting-desc">Important only lets safe local work proceed. Every guarded action asks for each write, command, SSH call, MCP tool, screenshot and media job. No approvals runs every action without asking.</div>
                </div>
                <div class="setting-control">
                  <select class="settings-select" id="approval-mode">
                    <option value="important" ${approvalMode === 'important' ? 'selected' : ''}>Important actions only</option>
                    <option value="all" ${approvalMode === 'all' ? 'selected' : ''}>Every guarded action</option>
                    <option value="auto" ${approvalMode === 'auto' ? 'selected' : ''}>No approvals (auto-run)</option>
                  </select>
                </div>
              </div>
              <div class="setting-row">
                <div class="setting-copy">
                  <div class="setting-label">Reuse a decision</div>
                  <div class="setting-desc">“Always allow” repeats the exact command or sensitive file for this session. It never grants a blanket permission for every command or file.</div>
                </div>
                <div class="setting-control"><span class="setting-note">Commands and credentials stay scoped</span></div>
              </div>
            </div>
            <div class="settings-group approval-matrix">
              ${rows.map((tool) => {
                const level = permissions[tool] || 'ask';
                const [label, description] = TOOL_LABELS[tool];
                return `<div class="approval-row">
                  <div class="approval-tool" title="${U.attr(description)}">${icon(Icons.TOOL_ICONS[tool] || 'wrench', 12)} ${esc(tool)}</div>
                  <div class="approval-values">
                    ${['allow', 'ask', 'deny'].map((value) => `<button class="permission-option ${level === value ? `active ${value}` : ''}" type="button" data-permission="${U.attr(tool)}" data-level="${value}">${value === 'allow' ? 'Allow' : value === 'ask' ? 'Ask first' : 'Block'}</button>`).join('')}
                  </div>
                </div>`;
              }).join('')}
            </div>
            <div class="settings-permission-note">${icon('shield', 12)} In Important only, “Ask first” still lets routine local work through. No approvals skips every prompt, but Block overrides and machine-destroying commands still stop. Blocked tools are removed from the model's tool list. Session approvals expire when the run ends.</div>
          </section>

          <section class="settings-section" id="settings-search">
            <h2>Web search</h2>
            <p>Bundled with every agent. The <code>web_search</code> tool works without an account; add a provider key for faster, cleaner results.</p>
            <div class="settings-group">
              <div class="setting-row">
                <div class="setting-copy"><div class="setting-label">Provider</div><div class="setting-desc">Missing keys fall back to DuckDuckGo automatically.</div></div>
                <div class="setting-control"><select class="settings-select" id="search-provider">${SEARCH_BACKENDS.map((backend) => `<option value="${backend.id}" ${backend.id === searchId ? 'selected' : ''}>${esc(backend.label)} · ${esc(backend.note)}</option>`).join('')}</select></div>
              </div>
              ${searchMeta?.needsKey ? `<div class="setting-row">
                <div class="setting-copy"><div class="setting-label">${esc(searchMeta.label)} API key</div><div class="setting-desc">${searchHasKey ? 'A key is saved. Paste a new value to replace it.' : 'Stored only in ~/.blank/config.json and never shown again.'}</div></div>
                <div class="setting-control settings-inline-form">
                  <input class="field-input settings-input" id="search-key" type="password" autocomplete="off" spellcheck="false" placeholder="${searchHasKey ? '••••••••  saved' : 'Paste API key'}" />
                  <button class="btn btn-primary btn-sm" type="button" data-save-search-key>Save</button>
                  ${searchHasKey ? '<button class="btn btn-ghost btn-sm" type="button" data-clear-search-key>Remove</button>' : ''}
                </div>
              </div>` : ''}
              ${searchId === 'searxng' ? `<div class="setting-row">
                <div class="setting-copy"><div class="setting-label">SearXNG instance</div><div class="setting-desc">Base URL of your own instance, for example http://localhost:8080.</div></div>
                <div class="setting-control settings-inline-form">
                  <input class="field-input settings-input" id="search-url" type="url" placeholder="https://searx.example.com" value="${U.attr(searchCfg.baseUrl || '')}" />
                  <button class="btn btn-secondary btn-sm" type="button" data-save-search-url>Save</button>
                </div>
              </div>` : ''}
              <div class="setting-row">
                <div class="setting-copy"><div class="setting-label">Results per search</div><div class="setting-desc">How many snippets the agent receives for each query.</div></div>
                <div class="setting-control settings-inline-form">
                  <input class="setting-inline-input" id="search-max-results" style="width:70px" type="number" min="1" max="10" value="${searchResults}" />
                  <button class="btn btn-secondary btn-sm" type="button" data-save-search-results>Save</button>
                </div>
              </div>
              <div class="setting-row">
                <div class="setting-copy"><div class="setting-label">Connection test</div><div class="setting-desc">Runs one real query and reports the backend that answered.</div></div>
                <div class="setting-control settings-inline-form"><button class="btn btn-secondary btn-sm" type="button" data-test-search>${icon('flask', 12)} Test search</button><span class="setting-note" id="search-test-note"></span></div>
              </div>
            </div>
          </section>

          <section class="settings-section" id="settings-computer">
            <h2>Computer use</h2>
            <p>Let the agent see your screen, click, type and scroll when a task needs a desktop app. Every action is still gated by Approvals.</p>
            <div class="settings-group">
              <div class="setting-row">
                <div class="setting-copy"><div class="setting-label">Cursor overlay</div><div class="setting-desc">The paper pet follows the cursor while the agent works. Click-through, never takes focus, and hides after each action.</div></div>
                <div class="setting-control">${UI.switchHtml(computerCfg.showCursor !== false, 'data-computer-toggle="showCursor"')}</div>
              </div>
              <div class="setting-row">
                <div class="setting-copy"><div class="setting-label">Screen test</div><div class="setting-desc">Capture a single screenshot and open it to confirm screen access works.</div><div class="setting-note" id="computer-test-note">Screenshots stay in your local data folder.</div></div>
                <div class="setting-control"><button class="btn btn-secondary btn-sm" type="button" data-test-screenshot>${icon('camera', 12)} Test screenshot</button></div>
              </div>
              <div class="setting-row">
                <div class="setting-copy"><div class="setting-label">Platform support</div><div class="setting-desc">Windows uses native input and DPI-aware coordinates. macOS needs Screen Recording and Accessibility permission. Linux uses xdotool plus a screenshot tool.</div></div>
                <div class="setting-control"><span class="badge">${esc({ win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[info.platform || runtime.platform] || 'Desktop')}</span></div>
              </div>
            </div>
            <div class="settings-permission-note">${icon('shield', 12)} Per-tool permissions for computer_use and computer_screenshot live in Approvals. The stop button ends a run and releases the screen.</div>
          </section>

          <section class="settings-section" id="settings-remote">
            <h2>Remote control</h2>
            <p>A small authenticated web app for your phone or another browser. Off by default; each start issues a fresh pairing token.</p>
            <div class="settings-group">
              <div class="setting-row">
                <div class="setting-copy"><div class="setting-label">Status</div><div class="setting-desc">${remoteRunning ? `Listening on port ${remotePort}.` : 'Not accepting remote connections.'}</div></div>
                <div class="setting-control settings-inline-form">
                  <span class="badge ${remoteRunning ? 'green' : ''}">${remoteRunning ? 'Running' : 'Stopped'}</span>
                  <button class="btn ${remoteRunning ? 'btn-secondary' : 'btn-primary'} btn-sm" type="button" data-remote-toggle>${icon(remoteRunning ? 'stop' : 'play', 12)} ${remoteRunning ? 'Stop' : 'Start'}</button>
                </div>
              </div>
              <div class="setting-row">
                <div class="setting-copy"><div class="setting-label">Port</div><div class="setting-desc">Changing the port restarts remote control and rotates the token.</div></div>
                <div class="setting-control settings-inline-form">
                  <input class="setting-inline-input" id="remote-port" style="width:92px" type="number" min="1024" max="65535" value="${remotePort}" />
                  <button class="btn btn-secondary btn-sm" type="button" data-save-remote-port>Apply</button>
                </div>
              </div>
              <div class="setting-row">
                <div class="setting-copy"><div class="setting-label">Allow LAN access</div><div class="setting-desc">Listen on this network so a phone can connect. Off keeps it loopback-only.</div></div>
                <div class="setting-control">${UI.switchHtml(Boolean(remoteCfg.allowLan), 'data-remote-setting="allowLan"')}</div>
              </div>
              <div class="setting-row">
                <div class="setting-copy"><div class="setting-label">Approve from remote</div><div class="setting-desc">Let the phone approve tool calls. Off means approvals happen only on this desktop.</div></div>
                <div class="setting-control">${UI.switchHtml(Boolean(remoteCfg.allowApprovals), 'data-remote-setting="allowApprovals"')}</div>
              </div>
              <div class="setting-row">
                <div class="setting-copy"><div class="setting-label">Start with blank</div><div class="setting-desc">Bring remote control up automatically using the saved port and options.</div></div>
                <div class="setting-control">${UI.switchHtml(Boolean(remoteState.autoStart ?? remoteCfg.autoStart), 'data-remote-setting="autoStart"')}</div>
              </div>
            </div>
            ${remoteRunning ? `<div class="remote-pair">
              <div class="remote-pair-head">${icon('link', 12)} Pairing</div>
              <p>Open one of these addresses on your phone, then enter the token. Copy link adds the token as a URL fragment.</p>
              <div class="remote-url-list">
                ${remoteUrls.map((entry) => `<div class="remote-url-row"><span>${esc(entry.label)}</span><code>${esc(entry.url)}</code><button class="btn btn-secondary btn-sm" type="button" data-copy-remote="${U.attr(entry.url)}">Copy link</button></div>`).join('') || '<div class="setting-note">No network address available.</div>'}
              </div>
              <div class="remote-token-row"><span>Token</span><code id="remote-token">${esc(remoteToken)}</code><button class="btn btn-secondary btn-sm" type="button" data-copy-token>Copy token</button><button class="btn btn-ghost btn-sm" type="button" data-open-remote>${icon('external-link', 11)} Open</button></div>
              <div class="setting-note">${remoteState.connections || 0} live connection${Number(remoteState.connections) === 1 ? '' : 's'} · token rotates on every start.</div>
            </div>` : `<div class="setting-note" style="margin-top:10px">${icon('lock', 11)} Pairing links and the token appear here after you start remote control.</div>`}
            <div class="settings-permission-note">${icon('shield-alert', 12)} Anyone with the token and network access can talk to this app. Keep LAN off on untrusted Wi-Fi, leave remote approvals off by default, and stop remote control when you are done.</div>
          </section>

          <section class="settings-section" id="settings-data">
            <h2>Data & CLI</h2>
            <p>Everything blank remembers is plain files you can inspect, back up or delete.</p>
            <div class="settings-group">
              <div class="setting-row">
                <div class="setting-copy"><div class="setting-label">Data folder</div><div class="setting-desc">Sessions, config, memory, skills, checkpoints and media live here.</div><div class="data-path">${icon('folder', 11)}<code>${esc(info.home || runtime.home || '~/.blank')}</code></div></div>
                <div class="setting-control"><button class="btn btn-secondary btn-sm" type="button" data-open-data>${icon('folder-open', 12)} Open</button></div>
              </div>
              <div class="setting-row">
                <div class="setting-copy"><div class="setting-label">Command line</div><div class="setting-desc">Run the same sessions and tools headlessly in VS Code’s terminal. Uses far less memory than the window.</div><div class="setting-note" id="cli-note">Adds a blank command for VS Code and other terminals.</div></div>
                <div class="setting-control"><button class="btn btn-secondary btn-sm" type="button" data-install-cli>${icon('terminal', 12)} Install CLI</button></div>
              </div>
              <div class="setting-row">
                <div class="setting-copy"><div class="setting-label">Workspace folder</div><div class="setting-desc">Open the folder blank is allowed to work in.</div><div class="data-path">${icon('folder', 11)}<code>${esc(config.workspace || 'No workspace')}</code></div></div>
                <div class="setting-control"><button class="btn btn-secondary btn-sm" type="button" data-open-workspace>${icon('folder-open', 12)} Open</button></div>
              </div>
              <div class="setting-row">
                <div class="setting-copy"><div class="setting-label">Media storage</div><div class="setting-desc">Generated and imported assets, plus thumbnails and waveforms.</div><div class="setting-note" id="media-storage-note">${vstate.media.storage ? `${vstate.media.storage.count} assets · ${U.fmtBytes(vstate.media.storage.bytes)}` : 'Loading…'}</div></div>
                <div class="setting-control"><button class="btn btn-secondary btn-sm" type="button" data-open-media-studio>${icon('image', 12)} Create media</button></div>
              </div>
            </div>
          </section>

          <section class="settings-section" id="settings-updates">
            <h2>Updates</h2>
            <p>blank updates itself from the official GitHub releases. Updates download in the background and install when you restart.</p>
            <div class="settings-group">
              <div class="setting-row">
                <div class="setting-copy">
                  <div class="setting-label">Automatic updates</div>
                  <div class="setting-desc">Check at launch and every six hours, then download in the background.</div>
                </div>
                <div class="setting-control">${UI.switchHtml(updatesCfg.auto !== false, 'data-update-toggle')}</div>
              </div>
            </div>
            ${updatePanelHtml(updates)}
            <div class="settings-permission-note">${icon('shield', 12)} Downloads come only from github.com/purplemacaron/blank. The installer checksum is verified before blank offers to install it.</div>
          </section>

          <section class="settings-section" id="settings-about">
            <h2>About</h2>
            <div class="card">
              <div class="about-block">
                <div class="about-copy">
                  <h3>blank</h3>
                  <p>A quiet, local-first agent harness. Chat, code, plan and create media from one calm surface — with keys, sessions and memory kept on your machine.</p>
                  <div class="about-versions">
                    <span class="badge">blank ${esc(info.version || runtime.version || '—')}</span>
                    <span class="badge">Electron ${esc(info.electron || runtime.electron || '—')}</span>
                    <span class="badge">Node ${esc(info.node || runtime.node || '—')}</span>
                    <span class="badge">${esc({ win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[info.platform || runtime.platform] || info.platform || runtime.platform || '')}</span>
                  </div>
                  <div class="about-link-row">
                    <button class="link-btn" type="button" data-open-data>${icon('folder-open', 12)} Data folder</button>
                    <button class="link-btn" type="button" data-open-media-studio>${icon('image', 12)} Create media</button>
                    <button class="link-btn" type="button" data-open-shortcuts>${icon('keyboard', 12)} Keyboard shortcuts</button>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>`;

    host.onclick = async (event) => {
      const go = event.target.closest('[data-settings-go]');
      if (go) {
        host.querySelectorAll('.settings-nav-item').forEach((item) => item.classList.toggle('active', item === go));
        host.querySelector(`#settings-${go.dataset.settingsGo}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      const theme = event.target.closest('button[data-theme]');
      if (theme) {
        const value = theme.dataset.theme;
        host.querySelectorAll('[data-theme]').forEach((item) => item.classList.toggle('active', item === theme));
        try {
          const updated = await API.config.update({ theme: value });
          applyConfig(updated);
          if (window.App?.applyTheme) App.applyTheme(value);
          UI.toast('Theme updated.', 'success');
        } catch (error) { UI.toast(error.message, 'error'); }
        return;
      }
      const language = event.target.closest('[data-language]');
      if (language) {
        const value = language.dataset.language === 'en' ? 'en' : 'ko';
        let previous = null;
        try { previous = localStorage.getItem('blank.lang'); } catch {}
        host.querySelectorAll('[data-language]').forEach((item) => item.classList.toggle('active', item === language));
        try {
          try { localStorage.setItem('blank.lang', value); } catch {}
          await API.config.update({ language: value });
          UI.toast(value === 'en' ? 'Switching to English…' : '한국어로 전환합니다…', 'success');
          setTimeout(() => location.reload(), 120);
        } catch (error) {
          try {
            if (previous === null) localStorage.removeItem('blank.lang');
            else localStorage.setItem('blank.lang', previous);
          } catch {}
          const restore = previous === 'en' ? 'en' : previous === 'ko' ? 'ko' : (config.language === 'en' ? 'en' : 'ko');
          host.querySelectorAll('[data-language]').forEach((item) => item.classList.toggle('active', item.dataset.language === restore));
          UI.toast(error.message, 'error');
        }
        return;
      }
      const font = event.target.closest('button[data-font]');
      if (font) {
        const value = ['noto', 'system', 'mono'].includes(font.dataset.font) ? font.dataset.font : 'noto';
        host.querySelectorAll('button[data-font]').forEach((item) => item.classList.toggle('active', item === font));
        try {
          const updated = await API.config.update({ ui: { ...(config.ui || {}), font: value } });
          applyConfig(updated);
          if (window.App?.applyFont) App.applyFont(value);
          UI.toast('Font updated.', 'success');
        } catch (error) { UI.toast(error.message, 'error'); }
        return;
      }
      const updateToggle = event.target.closest('[data-update-toggle]');
      if (updateToggle) {
        const next = !updateToggle.classList.contains('on');
        updateToggle.classList.toggle('on', next);
        updateToggle.setAttribute('aria-checked', String(next));
        try {
          const updated = await API.config.update({ updates: { auto: next } });
          applyConfig(updated);
          UI.toast(next ? 'Automatic updates are on.' : 'Automatic updates are off.', 'success');
        } catch (error) {
          updateToggle.classList.toggle('on', !next);
          updateToggle.setAttribute('aria-checked', String(!next));
          UI.toast(error.message, 'error');
        }
        return;
      }
      const updateCheck = event.target.closest('[data-update-check]');
      if (updateCheck) {
        updateCheck.disabled = true;
        try {
          applyUpdateStatus(await API.updates.check());
        } catch (error) {
          UI.toast(error.message, 'error');
          updateCheck.disabled = false;
        }
        return;
      }
      const updateInstall = event.target.closest('[data-update-install]');
      if (updateInstall) {
        updateInstall.disabled = true;
        try {
          applyUpdateStatus(await API.updates.install());
        } catch (error) {
          UI.toast(error.message, 'error');
          updateInstall.disabled = false;
        }
        return;
      }
      const updateNotes = event.target.closest('[data-update-notes]');
      if (updateNotes) {
        API.app.openExternal('https://github.com/purplemacaron/blank/releases/latest')
          .catch((error) => UI.toast(error.message, 'error'));
        return;
      }
      const petToggle = event.target.closest('[data-pet-toggle]');
      if (petToggle) {
        const next = !petToggle.classList.contains('on');
        petToggle.classList.toggle('on', next);
        petToggle.setAttribute('aria-checked', String(next));
        try {
          const updated = await API.config.update({ pet: { enabled: next } });
          applyConfig(updated);
          UI.toast(next ? 'Desktop pets shown.' : 'Desktop pets hidden.', 'success');
        } catch (error) {
          petToggle.classList.toggle('on', !next);
          petToggle.setAttribute('aria-checked', String(!next));
          UI.toast(error.message, 'error');
        }
        return;
      }
      const teamToggle = event.target.closest('[data-team-toggle]');
      if (teamToggle) {
        const next = !teamToggle.classList.contains('on');
        teamToggle.classList.toggle('on', next);
        teamToggle.setAttribute('aria-checked', String(next));
        try {
          const updated = await API.config.update({ team: { enabled: next } });
          applyConfig(updated);
          UI.toast(next ? 'Agent team enabled.' : 'Agent team disabled.', 'success');
        } catch (error) {
          teamToggle.classList.toggle('on', !next);
          UI.toast(error.message, 'error');
        }
        return;
      }
      const teamEnabled = event.target.closest('[data-team-field="enabled"]');
      if (teamEnabled) {
        const next = !teamEnabled.classList.contains('on');
        teamEnabled.classList.toggle('on', next);
        teamEnabled.setAttribute('aria-checked', String(next));
        return;
      }
      const teamWrite = event.target.closest('[data-team-field="write"]');
      if (teamWrite) {
        const next = !teamWrite.classList.contains('on');
        teamWrite.classList.toggle('on', next);
        teamWrite.setAttribute('aria-checked', String(next));
        return;
      }
      if (event.target.closest('[data-team-add]')) {
        const list = host.querySelector('[data-team-members]');
        if (!list) return;
        if (!list.querySelector('[data-team-member]')) list.innerHTML = '';
        list.insertAdjacentHTML('beforeend', teamMemberRow({ name: '', role: '', model: '', enabled: true }));
        list.lastElementChild?.querySelector('[data-team-field="name"]')?.focus();
        return;
      }
      if (event.target.closest('[data-team-remove]')) {
        event.target.closest('[data-team-member]')?.remove();
        return;
      }
      if (event.target.closest('[data-save-team]')) {
        const members = [...host.querySelectorAll('[data-team-member]')].map((node, index) => {
          const field = (name) => node.querySelector(`[data-team-field="${name}"]`);
          return {
            id: node.dataset.memberId || `member_${Date.now().toString(36)}_${index}`,
            name: field('name')?.value.trim() || '',
            role: field('role')?.value.trim() || '',
            model: field('model')?.value.trim() || '',
            enabled: field('enabled') ? field('enabled').classList.contains('on') : true,
            write: field('write') ? field('write').classList.contains('on') : false,
          };
        }).filter((member) => member.name);
        const enabled = host.querySelector('[data-team-toggle]')?.classList.contains('on') ?? Boolean(teamCfg.enabled);
        try {
          const updated = await API.config.update({ team: { enabled, members } });
          applyConfig(updated);
          paintSettings(host);
          UI.toast(`Agent team saved · ${members.length} member${members.length === 1 ? '' : 's'}.`, 'success');
        } catch (error) { UI.toast(error.message, 'error'); }
        return;
      }
      const model = event.target.closest('[data-pick-model]');
      if (model) {
        const target = model.dataset.pickModel;
        openModelPicker(model, {
          current: target === 'fallback' ? config.fallbackModel : config.defaultModel,
          title: target === 'fallback' ? 'Fallback model' : 'Default model',
          allowNone: target === 'fallback',
          onSelect: async (fullId) => {
            try {
              const updated = await API.config.update(target === 'fallback' ? { fallbackModel: fullId || '' } : { defaultModel: fullId });
              applyConfig(updated);
              paintSettings(host);
              UI.toast('Model preference saved.', 'success');
              if (window.App?.refreshSidebarModel) App.refreshSidebarModel();
            } catch (error) { UI.toast(error.message, 'error'); }
          },
        });
        return;
      }
      const toggle = event.target.closest('[data-agent-toggle]');
      if (toggle) {
        const key = toggle.dataset.agentToggle;
        const next = !toggle.classList.contains('on');
        toggle.classList.toggle('on', next);
        toggle.setAttribute('aria-checked', String(next));
        try {
          const updated = await API.config.update({ agent: { [key]: next } });
          applyConfig(updated);
          UI.toast(next ? 'Enabled.' : 'Disabled.', 'success');
        } catch (error) { toggle.classList.toggle('on', !next); UI.toast(error.message, 'error'); }
        return;
      }
      if (event.target.closest('[data-save-agent]')) {
        try {
          const reasoningSelect = host.querySelector('#agent-reasoning');
          const updated = await API.config.update({ agent: {
            maxSteps: Math.max(1, Math.min(64, Number(host.querySelector('#agent-max-steps').value) || 32)),
            reasoningEffort: reasoningSelect ? reasoningSelect.value : (agent.reasoningEffort || 'auto'),
            compactAt: Math.max(0.5, Math.min(0.95, (Number(host.querySelector('#agent-compact-at').value) || 82) / 100)),
          } });
          applyConfig(updated);
          UI.toast('Agent limits saved.', 'success');
          paintSettings(host);
        } catch (error) { UI.toast(error.message, 'error'); }
        return;
      }
      const dictationModel = event.target.closest('[data-use-dictation-model]');
      if (dictationModel) {
        const input = host.querySelector('#dictation-model');
        if (input) { input.value = dictationModel.dataset.useDictationModel || ''; input.focus(); }
        return;
      }
      const clearDictationKey = event.target.closest('[data-clear-dictation-key]');
      if (clearDictationKey) {
        const input = host.querySelector('#dictation-key');
        if (input) {
          input.value = '';
          input.dataset.clearKey = '1';
          input.placeholder = 'Key will be removed on save';
        }
        clearDictationKey.remove();
        return;
      }
      if (event.target.closest('[data-save-dictation]')) {
        try {
          const providerId = host.querySelector('#dictation-provider')?.value || '';
          const payload = {
            providerId,
            model: (host.querySelector('#dictation-model')?.value || '').trim(),
            language: host.querySelector('#dictation-language')?.value || '',
          };
          const keyInput = host.querySelector('#dictation-key');
          if (providerId === '__custom') {
            const baseUrl = (host.querySelector('#dictation-base-url')?.value || '').trim();
            if (!/^https?:\/\//i.test(baseUrl)) throw new Error('Enter an http(s) endpoint, for example http://localhost:8000/v1.');
            payload.baseUrl = baseUrl;
            const key = (keyInput?.value || '').trim();
            if (key) payload.key = key;
          }
          if (keyInput?.dataset.clearKey === '1') payload.clearKey = true;
          const updated = await API.config.update({ dictation: payload });
          applyConfig(updated);
          vstate.settings.dictationOptions = await API.dictation.options().catch(() => vstate.settings.dictationOptions);
          paintSettings(host);
          UI.toast('Dictation settings saved.', 'success');
        } catch (error) { UI.toast(error.message, 'error'); }
        return;
      }
      if (event.target.closest('[data-save-schedule]')) {
        const prompt = host.querySelector('#schedule-prompt').value.trim();
        if (!prompt) { UI.toast('Write the prompt this schedule should run.', 'error'); return; }
        const button = event.target.closest('[data-save-schedule]');
        button.disabled = true;
        try {
          await API.schedules.save({
            title: host.querySelector('#schedule-title').value.trim() || 'Scheduled run',
            prompt,
            cadence: host.querySelector('#schedule-cadence').value,
            date: host.querySelector('#schedule-date').value || '',
            time: host.querySelector('#schedule-time').value || '09:00',
            allowTools: host.querySelector('#schedule-tools').checked,
          });
          const result = await API.schedules.list();
          vstate.settings.schedules = result.schedules || [];
          paintSettings(host);
          UI.toast('Schedule added.', 'success');
        } catch (error) { UI.toast(error.message, 'error'); button.disabled = false; }
        return;
      }
      const runScheduleButton = event.target.closest('[data-run-schedule]');
      if (runScheduleButton) {
        runScheduleButton.disabled = true;
        try {
          await API.schedules.run(runScheduleButton.dataset.runSchedule);
          const result = await API.schedules.list();
          vstate.settings.schedules = result.schedules || [];
          paintSettings(host);
          UI.toast('Schedule started in a new session.', 'success');
        } catch (error) { UI.toast(error.message, 'error'); runScheduleButton.disabled = false; }
        return;
      }
      const deleteScheduleButton = event.target.closest('[data-delete-schedule]');
      if (deleteScheduleButton) {
        const schedule = schedules.find((entry) => entry.id === deleteScheduleButton.dataset.deleteSchedule);
        if (!schedule) return;
        const ok = await UI.confirm({ title: 'Delete this schedule?', message: 'The timer stops. Past sessions stay.', confirmLabel: 'Delete schedule', danger: true, detail: schedule.title });
        if (!ok) return;
        try {
          await API.schedules.remove(schedule.id);
          const result = await API.schedules.list();
          vstate.settings.schedules = result.schedules || [];
          paintSettings(host);
          UI.toast('Schedule deleted.', 'success');
        } catch (error) { UI.toast(error.message, 'error'); }
        return;
      }
      const notificationToggle = event.target.closest('[data-notification-toggle]');
      if (notificationToggle) {
        const key = notificationToggle.dataset.notificationToggle;
        const next = !notificationToggle.classList.contains('on');
        notificationToggle.classList.toggle('on', next);
        notificationToggle.setAttribute('aria-checked', String(next));
        try {
          const updated = await API.config.update({ notifications: { [key]: next } });
          applyConfig(updated);
          UI.toast(next ? 'Notification enabled.' : 'Notification disabled.', 'success');
        } catch (error) {
          notificationToggle.classList.toggle('on', !next);
          notificationToggle.setAttribute('aria-checked', String(!next));
          UI.toast(error.message, 'error');
        }
        return;
      }
      if (event.target.closest('[data-test-notification]')) {
        const button = event.target.closest('[data-test-notification]');
        const note = host.querySelector('#notification-test-note');
        button.disabled = true;
        try {
          const result = await API.notifications.test();
          if (note) note.textContent = result.shown ? 'Sent. Check your notification center.' : result.reason || 'Could not send a notification.';
          UI.toast(result.shown ? 'Test notification sent.' : result.reason || 'Notifications are unavailable.', result.shown ? 'success' : 'warn');
        } catch (error) {
          if (note) note.textContent = error.message;
          UI.toast(error.message, 'error');
        } finally { button.disabled = false; }
        return;
      }
      if (event.target.closest('[data-save-instructions]')) {
        const text = host.querySelector('#custom-instructions').value;
        try {
          const updated = await API.config.update({ customInstructions: text });
          applyConfig(updated);
          UI.toast('Standing instructions saved.', 'success');
        } catch (error) { UI.toast(error.message, 'error'); }
        return;
      }
      const perm = event.target.closest('[data-permission]');
      if (perm) {
        const tool = perm.dataset.permission;
        const level = perm.dataset.level;
        try {
          const updated = await API.config.update({ permissions: { [tool]: level } });
          applyConfig(updated);
          for (const button of perm.parentElement.querySelectorAll('.permission-option')) {
            button.className = `permission-option ${button === perm ? `active ${level}` : ''}`;
          }
          UI.toast(`${tool} set to ${level === 'deny' ? 'blocked' : level}.`, 'success');
        } catch (error) { UI.toast(error.message, 'error'); }
        return;
      }
      const computerToggle = event.target.closest('[data-computer-toggle]');
      if (computerToggle) {
        const key = computerToggle.dataset.computerToggle;
        const next = !computerToggle.classList.contains('on');
        computerToggle.classList.toggle('on', next);
        computerToggle.setAttribute('aria-checked', String(next));
        try {
          const updated = await API.config.update({ computer: { [key]: next } });
          applyConfig(updated);
          UI.toast(next ? 'Cursor overlay enabled.' : 'Cursor overlay hidden.', 'success');
        } catch (error) { computerToggle.classList.toggle('on', !next); UI.toast(error.message, 'error'); }
        return;
      }
      if (event.target.closest('[data-test-screenshot]')) {
        const button = event.target.closest('[data-test-screenshot]');
        const note = host.querySelector('#computer-test-note');
        button.disabled = true;
        try {
          const shot = await API.computer.testScreenshot();
          if (note) note.textContent = `Saved to ${shot.path}`;
          UI.toast('Screenshot captured.', 'success');
        } catch (error) { UI.toast(error.message, 'error'); }
        finally { button.disabled = false; }
        return;
      }
      if (event.target.closest('[data-save-search-key]')) {
        const input = host.querySelector('#search-key');
        const key = input ? input.value.trim() : '';
        if (!key) { UI.toast('Paste a key first.', 'error'); return; }
        try {
          const updated = await API.search.setKey({ id: searchId, key });
          applyConfig(updated);
          paintSettings(host);
          UI.toast('Search key saved.', 'success');
        } catch (error) { UI.toast(error.message, 'error'); }
        return;
      }
      if (event.target.closest('[data-clear-search-key]')) {
        try {
          const updated = await API.search.setKey({ id: searchId, key: '' });
          applyConfig(updated);
          paintSettings(host);
          UI.toast('Search key removed.', 'success');
        } catch (error) { UI.toast(error.message, 'error'); }
        return;
      }
      if (event.target.closest('[data-save-search-url]')) {
        try {
          const updated = await API.config.update({ search: { baseUrl: host.querySelector('#search-url').value.trim() } });
          applyConfig(updated);
          UI.toast('SearXNG address saved.', 'success');
        } catch (error) { UI.toast(error.message, 'error'); }
        return;
      }
      if (event.target.closest('[data-save-search-results]')) {
        try {
          const updated = await API.config.update({ search: { maxResults: Math.max(1, Math.min(10, Number(host.querySelector('#search-max-results').value) || 6)) } });
          applyConfig(updated);
          UI.toast('Search result count saved.', 'success');
        } catch (error) { UI.toast(error.message, 'error'); }
        return;
      }
      if (event.target.closest('[data-test-search]')) {
        const button = event.target.closest('[data-test-search]');
        const note = host.querySelector('#search-test-note');
        button.disabled = true;
        if (note) note.textContent = 'Searching…';
        try {
          const result = await API.search.test({ query: 'blank agent harness' });
          if (!result.ok) throw new Error(result.error || 'Search failed.');
          if (note) note.textContent = `${result.results.length} result${result.results.length === 1 ? '' : 's'} · ${result.backendLabel}${result.note ? ` · ${result.note}` : ''}`;
          UI.toast('Search backend responded.', 'success');
        } catch (error) {
          if (note) note.textContent = error.message;
          UI.toast(error.message, 'error');
        } finally { button.disabled = false; }
        return;
      }
      if (event.target.closest('[data-remote-toggle]')) {
        const button = event.target.closest('[data-remote-toggle]');
        button.disabled = true;
        try {
          const status = remoteRunning ? await API.remote.stop() : await API.remote.start({});
          vstate.settings.remote = status;
          paintSettings(host);
          UI.toast(remoteRunning ? 'Remote control stopped.' : 'Remote control is live. Copy a pairing link.', 'success');
        } catch (error) { button.disabled = false; UI.toast(error.message, 'error'); }
        return;
      }
      if (event.target.closest('[data-save-remote-port]')) {
        try {
          const port = Math.max(1024, Math.min(65535, Number(host.querySelector('#remote-port').value) || 8787));
          vstate.settings.remote = await API.remote.configure({ port });
          paintSettings(host);
          UI.toast('Remote port saved.', 'success');
        } catch (error) { UI.toast(error.message, 'error'); }
        return;
      }
      const remoteSetting = event.target.closest('[data-remote-setting]');
      if (remoteSetting) {
        const key = remoteSetting.dataset.remoteSetting;
        const next = !remoteSetting.classList.contains('on');
        remoteSetting.classList.toggle('on', next);
        remoteSetting.setAttribute('aria-checked', String(next));
        try {
          vstate.settings.remote = await API.remote.configure({ [key]: next });
          paintSettings(host);
          UI.toast(key === 'autoStart' ? (next ? 'Remote will start with blank.' : 'Remote will not start automatically.') : 'Remote settings updated.', 'success');
        } catch (error) { remoteSetting.classList.toggle('on', !next); UI.toast(error.message, 'error'); }
        return;
      }
      const copyRemote = event.target.closest('[data-copy-remote]');
      if (copyRemote) {
        const link = `${copyRemote.dataset.copyRemote}/#t=${encodeURIComponent(remoteToken)}`;
        const ok = await U.copyText(link);
        UI.toast(ok ? 'Pairing link copied.' : 'Could not access the clipboard.', ok ? 'success' : 'error');
        return;
      }
      if (event.target.closest('[data-copy-token]')) {
        const ok = await U.copyText(remoteToken);
        UI.toast(ok ? 'Token copied.' : 'Could not access the clipboard.', ok ? 'success' : 'error');
        return;
      }
      if (event.target.closest('[data-open-remote]')) {
        const base = remoteUrls[0]?.url || '';
        if (base) API.app.openExternal(`${base}/#t=${encodeURIComponent(remoteToken)}`).catch((error) => UI.toast(error.message, 'error'));
        return;
      }
      if (event.target.closest('[data-choose-workspace]')) {
        try {
          const result = await API.workspace.choose();
          if (result && result.canceled === false) {
            if (window.App?.onWorkspaceChanged) await App.onWorkspaceChanged();
            else mountSettings(host);
          }
        } catch (error) { UI.toast(error.message, 'error'); }
        return;
      }
      if (event.target.closest('[data-open-data]')) {
        API.app.openDataFolder().catch((error) => UI.toast(error.message, 'error'));
        return;
      }
      if (event.target.closest('[data-open-workspace]')) {
        API.workspace.openPath('').catch((error) => UI.toast(error.message, 'error'));
        return;
      }
      if (event.target.closest('[data-open-media-studio]')) {
        openStudio();
        return;
      }
      if (event.target.closest('[data-open-shortcuts]')) { openShortcuts(); return; }
      if (event.target.closest('[data-install-cli]')) {
        const button = event.target.closest('[data-install-cli]');
        button.disabled = true;
        try {
          const result = await API.cli.install();
          const note = host.querySelector('#cli-note');
          if (note) {
            note.textContent = result.onPath
              ? 'blank is ready in new terminals.'
              : `Installed at ${result.path}`;
            window.__blankI18n?.run();
          }
          button.innerHTML = `${icon('terminal', 12)} Reinstall`;
          UI.toast('CLI launcher installed.', 'success', { title: result.path, timeout: 8000 });
        } catch (error) { UI.toast(error.message, 'error'); }
        finally { button.disabled = false; }
      }
    };
    host.onchange = async (event) => {
      if (event.target && event.target.id === 'dictation-provider') {
        const custom = event.target.value === '__custom';
        host.querySelectorAll('[data-dictation-custom]').forEach((row) => { row.hidden = !custom; });
        if (custom) {
          applyDictationSuggestions(host, []);
          host.querySelector('#dictation-base-url')?.focus();
          return;
        }
        const chosen = dictationChoices.find((provider) => provider.id === event.target.value)
          || dictationChoices.find((provider) => provider.id === 'openai')
          || dictationChoices[0]
          || null;
        applyDictationSuggestions(host, chosen?.models?.length ? chosen.models : ['whisper-1']);
        return;
      }
      if (event.target && event.target.id === 'schedule-cadence') {
        const date = host.querySelector('#schedule-date');
        if (date) date.hidden = event.target.value !== 'once';
        return;
      }
      if (event.target && event.target.id === 'approval-mode') {
        try {
          const value = event.target.value;
          const mode = value === 'all' || value === 'auto' ? value : 'important';
          const updated = await API.config.update({ approvals: { mode } });
          applyConfig(updated);
          UI.toast(
            mode === 'auto'
              ? 'No approvals. Every action runs until you switch back.'
              : mode === 'all'
                ? 'blank will ask before every guarded action.'
                : 'blank will ask only for important actions.',
            mode === 'auto' ? 'warn' : 'success',
          );
        } catch (error) { UI.toast(error.message, 'error'); }
        return;
      }
      if (event.target && event.target.id === 'search-provider') {
        try {
          const updated = await API.config.update({ search: { provider: event.target.value } });
          applyConfig(updated);
          paintSettings(host);
          UI.toast('Search provider updated.', 'success');
        } catch (error) { UI.toast(error.message, 'error'); }
      }
    };
    API.media.storage().then((storage) => {
      vstate.media.storage = storage;
      const note = host.querySelector('#media-storage-note');
      if (note) note.textContent = `${storage.count} assets · ${U.fmtBytes(storage.bytes)} · ${storage.root}`;
    }).catch(() => {});
  }

  async function mountSettings(host) {
    vstate.page = 'settings';
    vstate.host = host;
    host.innerHTML = pageLoading('Settings', 'Preferences, approvals and local data.');
    try {
      const [config, storage, remote, schedules, dictationOptions, updates] = await Promise.all([
        API.config.get(),
        API.media.storage().catch(() => null),
        API.remote?.status ? API.remote.status().catch(() => null) : Promise.resolve(null),
        API.schedules?.list ? API.schedules.list().catch(() => null) : Promise.resolve(null),
        API.dictation?.options ? API.dictation.options().catch(() => null) : Promise.resolve(null),
        API.updates?.status ? API.updates.status().catch(() => null) : Promise.resolve(null),
      ]);
      if (!alive(host, 'settings')) return;
      vstate.media.storage = storage || vstate.media.storage;
      vstate.settings.remote = remote;
      vstate.settings.schedules = schedules?.schedules || [];
      vstate.settings.ssh = config?.ssh || null;
      vstate.settings.dictationOptions = Array.isArray(dictationOptions?.providers) ? dictationOptions : null;
      vstate.settings.updates = updates || null;
      applyConfig(config);
      paintSettings(host);
      if (vstate.settings.pending) {
        const section = vstate.settings.pending;
        vstate.settings.pending = '';
        requestAnimationFrame(() => host.querySelector(`#settings-${section}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      }
    } catch (error) { if (alive(host, 'settings')) pageError(host, 'Settings', error); }
  }

  function openSettingsSection(section) {
    vstate.settings.pending = section || '';
    if (window.App?.openPage) App.openPage('settings');
  }

  function openShortcuts() {
    const rows = [
      ['Ctrl K', 'Command palette'],
      ['Ctrl N', 'New session'],
      ['Ctrl M', 'Switch model'],
      ['Ctrl B', 'Toggle context rail'],
      ['Ctrl ,', 'Settings'],
      ['Ctrl 1…7', 'Jump to a page'],
      ['Enter', 'Send message'],
      ['Shift Enter', 'New line'],
      ['Ctrl L', 'Focus composer'],
      ['Esc', 'Close overlay'],
    ];
    const body = document.createElement('div');
    body.innerHTML = `<div class="detail-list">${rows.map(([key, label]) => `<div class="detail-row"><span>${esc(label)}</span><span class="mono-chip">${esc(U.kbd(key))}</span></div>`).join('')}</div>`;
    UI.modal({ title: 'Keyboard shortcuts', description: 'On macOS, Ctrl maps to ⌘.', body, size: 'small' });
  }

  /* ------------------------------------------------------------------- studio */

  const ASPECTS = {
    image: [['1:1', 'Square 1:1'], ['4:3', 'Landscape 4:3'], ['3:4', 'Portrait 3:4'], ['16:9', 'Wide 16:9'], ['9:16', 'Tall 9:16']],
    video: [['16:9', 'Wide 16:9'], ['9:16', 'Tall 9:16'], ['1:1', 'Square 1:1'], ['4:3', 'Classic 4:3']],
  };
  const SUGGESTIONS = {
    image: ['Brutalist poster for a solo exhibition', 'Cobalt gradient study, soft film grain', 'Isometric city at dusk', 'Botanical plate in muted ink'],
    video: ['Slow orbital shot over a glass city', 'Tidal lines in a deep blue sea', 'Neon rain on an empty street', 'Paper shapes drifting in light'],
    audio: ['Warm lo-fi loop for late-night coding', 'Cinematic ambient beneath rain', 'Bright synthwave drive at 110 bpm', 'Airy jazz chords for a studio'],
    model3d: ['Faceted crystal study', 'Modular brutalist desk lamp', 'Low-poly mountain diorama', 'Twisted ceramic vase'],
  };
  const notifiedJobs = new Set();

  function fmtDuration(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  function kindOf(asset) { return KIND[asset.kind] || KIND.image; }

  function currentEngineList(kind) {
    const engines = vstate.media.engines;
    if (!engines) return [];
    const local = (engines.local || []).filter((engine) => engine.kinds.includes(kind) && engine.available);
    const cloud = (engines.cloud || []).filter((engine) => engine.kinds.includes(kind) && engine.available);
    return [...local.map((e) => ({ ...e, vendor: e.vendor === 'comfyui' ? 'comfyui' : 'local' })), ...cloud];
  }

  function engineInfo(id) {
    const engines = vstate.media.engines;
    if (!engines) return null;
    return [...(engines.local || []), ...(engines.cloud || [])].find((engine) => engine.id === id) || null;
  }

  function engineModelsFor(engine, kind) {
    if (!engine) return [];
    const mapped = engine.modelsByKind?.[kind];
    const models = Array.isArray(mapped) && mapped.length ? mapped : engine.models || [];
    return models.filter((model) => model && model !== 'auto' && model !== 'system');
  }

  function preferredEngine(kind, engineId) {
    const available = currentEngineList(kind);
    const match = engineId ? available.find((engine) => engine.id === engineId) : null;
    if (match) return match;
    if (kind === 'audio') return available.find((engine) => !engine.speech) || available[0] || null;
    return available[0] || null;
  }

  function applyKindDefaults(kind) {
    const defaults = (vstate.media.defaults || {})[kind] || {};
    const compose = vstate.media.compose;
    compose.kind = kind;
    const wanted = preferredEngine(kind, defaults.engine);
    compose.engine = wanted?.id || '';
    compose.model = engineModelsFor(wanted, kind)[0] || '';
    if (defaults.aspect) compose.aspect = defaults.aspect;
    else compose.aspect = kind === 'video' ? '16:9' : '1:1';
    if (defaults.duration) compose.duration = defaults.duration;
    else compose.duration = kind === 'video' ? 4 : 20;
    if (defaults.voice) compose.voice = defaults.voice;
    if (defaults.rate !== undefined) compose.rate = Number(defaults.rate) || 0;
    else compose.rate = 0;
  }

  async function mountStudio(host) {
    if (!host || host.isConnected === false) return;
    vstate.page = 'studio';
    vstate.host = host;
    if (!vstate.media.loaded) host.innerHTML = pageLoading('Create media', 'Generate and edit images, video, audio and 3D.');
    try {
      const [assets, jobs, engines, storage] = await Promise.all([
        API.media.list({ limit: 200 }),
        API.media.jobs(),
        API.media.engines(),
        API.media.storage(),
      ]);
      if (!alive(host, 'studio')) return;
      vstate.media.assets = assets.items || [];
      vstate.media.total = assets.total || 0;
      vstate.media.counts = assets.counts || storage.counts || { image: 0, video: 0, audio: 0, model3d: 0 };
      vstate.media.jobs = jobs || [];
      vstate.media.engines = engines;
      vstate.media.storage = storage;
      vstate.media.defaults = engines.defaults || {};
      vstate.media.loaded = true;
      if (!vstate.media.voices) API.media.voices().then((names) => {
        vstate.media.voices = Array.isArray(names) ? names : [];
        if (alive(host, 'studio') && vstate.media.compose.kind === 'audio' && vstate.media.compose.engine === 'system-voice') paintStudio(host);
      }).catch(() => { vstate.media.voices = []; });
      if (!vstate.media._composeReady) {
        applyKindDefaults(vstate.media.compose.kind);
        vstate.media._composeReady = true;
      }
      const pending = vstate.media.pending;
      if (pending) {
        vstate.media.pending = null;
        const pendingKind = pending.kind || vstate.media.compose.kind;
        applyKindDefaults(pendingKind);
        if (pending.prompt != null) vstate.media.compose.prompt = pending.prompt;
        if (pending.engine) {
          const chosen = preferredEngine(pendingKind, pending.engine);
          if (chosen) {
            vstate.media.compose.engine = chosen.id;
            vstate.media.compose.model = engineModelsFor(chosen, pendingKind)[0] || '';
          }
        }
        if (pending.voice) vstate.media.compose.voice = pending.voice;
      }
      paintStudio(host);
    } catch (error) { if (alive(host, 'studio')) pageError(host, 'Create media', error); }
  }

  function paintStudio(host) {
    const compose = vstate.media.compose;
    const kind = compose.kind;
    const storage = vstate.media.storage || { counts: vstate.media.counts, bytes: 0, cloudReady: [] };
    const counts = storage.counts || vstate.media.counts;
    const totalCount = counts.image + counts.video + counts.audio + counts.model3d;
    const engines = currentEngineList(kind);
    if (!engines.some((item) => item.id === compose.engine)) {
      const next = preferredEngine(kind);
      compose.engine = next?.id || '';
      compose.model = engineModelsFor(next, kind)[0] || '';
    } else {
      const choices = engineModelsFor(engineInfo(compose.engine), kind);
      if (!choices.includes(compose.model)) compose.model = choices[0] || '';
    }
    const engine = engineInfo(compose.engine);
    const isSpeech = kind === 'audio' && compose.engine === 'system-voice';
    const modelChoices = engineModelsFor(engine, kind);
    const activeJobs = vstate.media.jobs.filter((job) => job.status === 'queued' || job.status === 'running');
    const voices = vstate.media.voices || [];
    const placeholder = isSpeech
      ? 'Type the script to speak…'
      : kind === 'audio' ? 'Describe a track…' : kind === 'model3d' ? 'Describe an object…' : kind === 'video' ? 'Describe the video…' : 'Describe the image…';
    const noun = isSpeech ? 'speech' : KIND[kind].noun;
    const connectCopy = kind === 'image'
      ? 'Add a provider key or a ComfyUI endpoint to create images.'
      : kind === 'video'
        ? 'Add a provider key to create video.'
        : kind === 'audio'
          ? 'Add a music provider key to create music.'
          : 'Add a provider key to create 3D.';
    const connectMarkup = engines.length ? '' : `<div class="studio-connect">
      <span class="studio-connect-icon">${icon('sliders', 15)}</span>
      <div class="studio-connect-copy">
        <b>Connect an engine</b>
        <span>${connectCopy}</span>
      </div>
      <button class="btn btn-primary btn-sm" type="button" data-media-engines>Open Engines</button>
    </div>`;
    host.innerHTML = `<div class="page-inner">
      <div class="studio-layout">
        <aside class="studio-side">
          <div class="studio-compose">
            <div class="studio-compose-head">
              ${icon('wand', 14)}
              <span class="studio-compose-title">Create</span>
              <span class="studio-compose-sub"><button class="studio-link" type="button" data-save-defaults title="Remember settings">${icon('save', 12)}</button></span>
            </div>
            <div class="studio-compose-body">
              <div class="studio-kind-tabs">
                ${Object.entries(KIND).map(([id, meta]) => `<button class="studio-kind ${kind === id ? 'active' : ''}" type="button" data-kind="${id}">${icon(meta.icon, 16)}<span>${meta.label}</span></button>`).join('')}
              </div>
              <div class="studio-prompt-wrap">
                <textarea class="studio-prompt" id="compose-prompt" placeholder="${U.attr(placeholder)}">${esc(compose.prompt)}</textarea>
              </div>
              ${connectMarkup}
              ${engines.length && (kind === 'image' || kind === 'video') ? `<div class="studio-row">
                <label class="studio-field"><span>Aspect</span><select class="studio-select" id="compose-aspect">${(ASPECTS[kind] || ASPECTS.image).map(([value, label]) => `<option value="${value}" ${compose.aspect === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
                ${kind === 'video' ? `<label class="studio-field"><span>Seconds</span><input class="studio-input" id="compose-duration" type="number" min="2" max="12" step="1" value="${compose.duration}" /></label>` : ''}
              </div>` : ''}
              ${engines.length && kind === 'audio' ? (isSpeech ? `<div class="studio-row">
                <label class="studio-field"><span>Voice</span><select class="studio-select" id="compose-voice">
                  <option value="">Auto</option>
                  ${voices.map((name) => `<option value="${U.attr(name)}" ${compose.voice === name ? 'selected' : ''}>${esc(name)}</option>`).join('')}
                </select></label>
                <label class="studio-field"><span>Rate</span><select class="studio-select" id="compose-rate">${[-4, -2, 0, 2, 4].map((value) => `<option value="${value}" ${Number(compose.rate) === value ? 'selected' : ''}>${value === 0 ? 'Normal' : value < 0 ? `Slow ${Math.abs(value)}` : `Fast ${value}`}</option>`).join('')}</select></label>
              </div>` : `<div class="studio-row">
                <label class="studio-field"><span>Duration</span><input class="studio-input" id="compose-duration" type="number" min="4" max="180" step="1" value="${compose.duration}" /></label>
              </div>`) : ''}
              ${engines.length ? `<label class="studio-field">
                <span>Engine</span>
                <select class="studio-select" id="compose-engine">
                  ${engines.map((item) => `<option value="${U.attr(item.id)}" ${compose.engine === item.id ? 'selected' : ''}>${esc(item.label)}${item.id === 'system-voice' ? ' · TTS' : item.vendor === 'cloud' ? ' · Cloud' : ''}</option>`).join('')}
                  ${(vstate.media.engines?.cloud || []).some((e) => e.kinds.includes(kind) && !e.available) ? '<option value="add-key">Add cloud engine…</option>' : ''}
                  ${kind === 'image' && (vstate.media.engines?.local || []).some((e) => e.id === 'comfyui' && !e.available) ? '<option value="add-comfy">Set up ComfyUI…</option>' : ''}
                </select>
              </label>` : ''}
              ${engines.length && modelChoices.length ? `<label class="studio-field"><span>Model</span><select class="studio-select" id="compose-model">${modelChoices.map((model) => `<option value="${U.attr(model)}" ${compose.model === model ? 'selected' : ''}>${esc(model)}</option>`).join('')}</select></label>` : ''}
              <button class="studio-generate" type="button" data-generate ${engines.length ? '' : 'disabled'}>
                ${activeJobs.length ? `<span class="spinner" style="width:12px;height:12px;border-color:rgba(255,255,255,.35);border-top-color:#fff"></span>` : icon('sparkles', 14)}
                Generate ${noun} <span class="kbd">${U.kbd('Ctrl ↵')}</span>
              </button>
            </div>
          </div>
          <div class="studio-jobs" id="studio-jobs"></div>
        </aside>
        <section class="studio-main">
          <div class="studio-library-head">
            <div class="studio-filters">
              <button class="studio-filter ${vstate.media.filter === 'all' && !vstate.media.favorite ? 'active' : ''}" type="button" data-media-filter="all">All <span class="count">${totalCount}</span></button>
              ${Object.entries(KIND).map(([id, meta]) => `<button class="studio-filter ${vstate.media.filter === id && !vstate.media.favorite ? 'active' : ''}" type="button" data-media-filter="${id}">${icon(meta.icon, 11)} ${meta.label} <span class="count">${counts[id] || 0}</span></button>`).join('')}
              <button class="studio-filter fav ${vstate.media.favorite ? 'active' : ''}" type="button" data-media-fav>${icon('heart', 11)} Favorites</button>
            </div>
            <div style="flex:1"></div>
            <label class="search-field studio-search">${icon('search', 12)}<input id="media-search" type="search" placeholder="Search library" value="${U.attr(vstate.media.query)}" /></label>
            <div class="studio-view-toggle">
              <button class="${vstate.media.view === 'grid' ? 'active' : ''}" type="button" data-media-view="grid" title="Grid">${icon('grid', 12)}</button>
              <button class="${vstate.media.view === 'compact' ? 'active' : ''}" type="button" data-media-view="compact" title="Compact grid">${icon('layout', 12)}</button>
              <button class="${vstate.media.view === 'list' ? 'active' : ''}" type="button" data-media-view="list" title="List">${icon('list', 12)}</button>
            </div>
          </div>
          <div class="media-grid ${vstate.media.view === 'compact' ? 'compact' : vstate.media.view === 'list' ? 'list' : ''}" id="media-grid"></div>
        </section>
      </div>
    </div>`;
    paintLibrary(host);
    paintJobs(host);
    const search = host.querySelector('#media-search');
    search?.addEventListener('input', () => {
      vstate.media.query = search.value;
      paintLibrary(host);
    });
    const prompt = host.querySelector('#compose-prompt');
    prompt?.addEventListener('input', () => { compose.prompt = prompt.value; });
    const main = host.querySelector('.studio-main');
    if (main) bindDropImport(main, host);
    host.onchange = (event) => {
      const id = event.target.id;
      const value = event.target.value;
      if (id === 'compose-engine') {
        if (value === 'add-key' || value === 'add-comfy') { openMediaEngines(() => mountStudio(host)); return; }
        compose.engine = value;
        compose.model = engineModelsFor(engineInfo(value), compose.kind)[0] || '';
        paintStudio(host);
        return;
      }
      if (id === 'compose-model') { compose.model = value; return; }
      if (id === 'compose-voice') { compose.voice = value; return; }
      if (id === 'compose-rate') { compose.rate = Number(value) || 0; return; }
      if (id === 'compose-aspect') { compose.aspect = value; return; }
      if (id === 'compose-duration') { compose.duration = Math.max(1, Number(value) || compose.duration); return; }
    };
    host.onclick = (event) => {
      const kindButton = event.target.closest('[data-kind]');
      if (kindButton) {
        applyKindDefaults(kindButton.dataset.kind);
        vstate.media.filter = 'all';
        vstate.media.favorite = false;
        paintStudio(host);
        setTimeout(() => host.querySelector('#compose-prompt')?.focus(), 20);
        return;
      }
      const suggestion = event.target.closest('[data-suggest]');
      if (suggestion) {
        compose.prompt = suggestion.dataset.suggest;
        const node = host.querySelector('#compose-prompt');
        if (node) { node.value = compose.prompt; node.focus(); U.autoGrow(node, 240); }
        return;
      }
      const toggle = event.target.closest('[data-compose-toggle]');
      if (toggle) {
        const key = toggle.dataset.composeToggle;
        compose[key] = !toggle.classList.contains('on');
        toggle.classList.toggle('on', compose[key]);
        toggle.setAttribute('aria-checked', String(compose[key]));
        return;
      }
      if (event.target.closest('[data-generate]')) { generateFromCompose(host); return; }
      if (event.target.closest('[data-save-defaults]')) { saveComposeDefaults(); return; }
      if (event.target.closest('[data-media-engines]')) { openMediaEngines(() => mountStudio(host)); return; }
      if (event.target.closest('[data-import-media]')) { importMedia(host); return; }
      const filter = event.target.closest('[data-media-filter]');
      if (filter) {
        vstate.media.filter = filter.dataset.mediaFilter;
        vstate.media.favorite = false;
        paintFilters(host);
        paintLibrary(host);
        return;
      }
      if (event.target.closest('[data-media-fav]')) {
        vstate.media.favorite = !vstate.media.favorite;
        paintFilters(host);
        paintLibrary(host);
        return;
      }
      const view = event.target.closest('[data-media-view]');
      if (view) {
        vstate.media.view = view.dataset.mediaView;
        host.querySelectorAll('[data-media-view]').forEach((button) => button.classList.toggle('active', button === view));
        paintLibrary(host);
        return;
      }
      const fav = event.target.closest('[data-fav-id]');
      if (fav) {
        event.stopPropagation();
        toggleFavoriteAsset(fav.dataset.favId, host);
        return;
      }
      const card = event.target.closest('[data-media-id]');
      if (card) { openMediaDetail(card.dataset.mediaId); return; }
      const cancel = event.target.closest('[data-cancel-job]');
      if (cancel) {
        API.media.cancel(cancel.dataset.cancelJob).then(() => {
          UI.toast('Generation cancelled.', 'info');
          refreshJobs(host);
        }).catch((error) => UI.toast(error.message, 'error'));
        return;
      }
      const openJob = event.target.closest('[data-open-job]');
      if (openJob && openJob.dataset.openJob) { openMediaDetail(openJob.dataset.openJob); return; }
    };
  }

  function paintFilters(host) {
    const counts = (vstate.media.storage?.counts) || vstate.media.counts;
    const total = counts.image + counts.video + counts.audio + counts.model3d;
    host.querySelectorAll('[data-media-filter]').forEach((button) => {
      const id = button.dataset.mediaFilter;
      button.classList.toggle('active', vstate.media.filter === id && !vstate.media.favorite);
    });
    host.querySelector('[data-media-fav]')?.classList.toggle('active', vstate.media.favorite);
    const all = host.querySelector('[data-media-filter="all"] .count');
    if (all) all.textContent = total;
  }

  function visibleAssets() {
    const query = vstate.media.query.trim().toLowerCase();
    return vstate.media.assets.filter((asset) => {
      if (vstate.media.filter !== 'all' && asset.kind !== vstate.media.filter) return false;
      if (vstate.media.favorite && !asset.favorite) return false;
      if (!query) return true;
      return `${asset.title} ${asset.prompt} ${asset.engineLabel} ${asset.model}`.toLowerCase().includes(query);
    });
  }

  function paintLibrary(host) {
    const grid = host.querySelector('#media-grid');
    if (!grid) return;
    grid.className = `media-grid ${vstate.media.view === 'compact' ? 'compact' : vstate.media.view === 'list' ? 'list' : ''}`;
    const items = visibleAssets();
    if (!items.length) {
      const empty = vstate.media.assets.length
        ? UI.emptyState({ iconName: 'search', title: 'Nothing matches', description: 'Try another filter or search term.' })
        : `<div class="media-empty">
            <div class="empty-icon">${icon('sparkles', 22)}</div>
            <h3>No media yet</h3>
            <button class="btn btn-primary btn-sm" type="button" data-generate>${icon('wand', 12)} Generate</button>
          </div>`;
      grid.innerHTML = `<div style="grid-column:1/-1">${empty}</div>`;
      return;
    }
    grid.innerHTML = items.map((asset) => mediaCard(asset)).join('');
  }

  function mediaCard(asset) {
    const meta = kindOf(asset);
    const isAudio = asset.kind === 'audio';
    const is3d = asset.kind === 'model3d';
    const isVideo = asset.kind === 'video';
    const thumb = asset.urls.thumb || asset.urls.preview || asset.urls.file;
    return `<button class="media-card" type="button" data-media-id="${U.attr(asset.id)}">
      <div class="media-card-preview ${isAudio ? 'audio' : is3d ? 'model3d' : ''}">
        <div class="media-card-badges">
          <span class="media-kind-badge">${icon(meta.icon, 9)} ${meta.label}</span>
          ${asset.source === 'edited' ? '<span class="media-kind-badge promoted">Edited</span>' : ''}
        </div>
        ${asset.favorite ? `<span class="media-fav on" data-fav-id="${U.attr(asset.id)}" role="button" title="Unfavorite" aria-label="Unfavorite">${icon('heart', 12)}</span>` : `<span class="media-fav" data-fav-id="${U.attr(asset.id)}" role="button" title="Favorite" aria-label="Favorite">${icon('heart', 12)}</span>`}
        ${isAudio ? `<div class="media-wave"><img src="${U.attr(thumb)}" alt="" loading="lazy" /></div>` : is3d ? `<div class="media-3d-grid"></div><img src="${U.attr(thumb)}" alt="" loading="lazy" />` : `<img src="${U.attr(thumb)}" alt="" loading="lazy" />`}
        ${isVideo ? `<span class="media-play">${icon('play', 14)}</span>` : ''}
        ${isVideo || isAudio ? `<span class="media-duration">${fmtDuration(asset.duration)}</span>` : ''}
      </div>
      <div class="media-card-body">
        <div class="media-card-title">${esc(asset.title)}</div>
        <div class="media-card-meta">
          <span>${esc(asset.engineLabel || asset.engine)}</span><span class="sep"></span>
          <span>${asset.width && asset.height ? `${asset.width}×${asset.height}` : esc(asset.meta?.meshLabel || asset.kindLabel)}</span><span class="sep"></span>
          <span>${esc(U.relativeTime(asset.createdAt))}</span>
        </div>
      </div>
    </button>`;
  }

  function paintJobs(host) {
    const wrap = host.querySelector('#studio-jobs');
    if (!wrap) return;
    const jobs = vstate.media.jobs.slice(0, 8);
    if (!jobs.length) { wrap.innerHTML = ''; return; }
    wrap.innerHTML = `<div class="queue-label">${icon('clock', 10)} Queue <span>${jobs.filter((j) => j.status === 'running' || j.status === 'queued').length} active</span></div>` + jobs.map((job) => {
      const meta = KIND[job.kind] || KIND.image;
      const active = job.status === 'running' || job.status === 'queued';
      const percent = Math.max(2, Math.round((Number(job.progress) || 0) * 100));
      return `<div class="media-job ${job.status === 'done' ? 'done' : job.status === 'error' || job.status === 'cancelled' ? 'error' : ''}">
        <div class="media-job-head">
          <span class="media-job-icon">${icon(meta.icon, 12)}</span>
          <div class="media-job-copy">
            <div class="media-job-title">${esc(U.truncate(job.prompt || `${meta.label} job`, 46))}</div>
            <div class="media-job-stage">${esc(job.status === 'error' ? job.error || 'Failed' : job.status === 'cancelled' ? 'Cancelled' : job.status === 'done' ? `${job.engineLabel || 'Done'} · ${U.fmtNumber((job.assetIds || []).length)} asset${(job.assetIds || []).length === 1 ? '' : 's'}` : `${job.engineLabel || 'Working'} · ${esc(job.stage || job.status)}`)}</div>
          </div>
          ${active ? `<button class="mini-icon" type="button" data-cancel-job="${U.attr(job.id)}" title="Cancel">${icon('x', 12)}</button>`
            : job.status === 'done' && (job.assetIds || []).length ? `<button class="mini-icon" type="button" data-open-job="${U.attr(job.assetIds[0])}" title="Open">${icon('arrow-up-right', 12)}</button>` : ''}
        </div>
        ${active ? `<div class="media-job-progress"><span style="width:${percent}%"></span></div>` : ''}
      </div>`;
    }).join('');
  }

  async function refreshJobs(host) {
    try {
      vstate.media.jobs = await API.media.jobs();
      if (vstate.page === 'studio') paintJobs(host || vstate.host);
    } catch {}
  }

  async function refreshLibrary(host) {
    try {
      const [assets, storage] = await Promise.all([API.media.list({ limit: 200 }), API.media.storage()]);
      vstate.media.assets = assets.items || [];
      vstate.media.total = assets.total || 0;
      vstate.media.counts = assets.counts || storage.counts;
      vstate.media.storage = storage;
      if (vstate.page === 'studio') {
        const target = host || vstate.host;
        paintLibrary(target);
        paintFilters(target);
        const engineCard = target.querySelector('.studio-engine-card');
        if (engineCard) paintStudio(target);
      }
      syncMediaBadge();
    } catch {}
  }

  function saveComposeDefaults() {
    const compose = vstate.media.compose;
    const payload = {
      engine: compose.engine,
      aspect: compose.aspect,
      duration: compose.duration,
      voice: compose.voice,
      rate: compose.rate,
    };
    API.media.setDefaults({ [compose.kind]: payload }).then((result) => {
      if (result?.defaults) vstate.media.defaults = result.defaults;
      UI.toast(`${KIND[compose.kind].label} defaults saved.`, 'success');
    }).catch((error) => UI.toast(error.message, 'error'));
  }

  async function generateFromCompose(host) {
    const compose = vstate.media.compose;
    const prompt = compose.prompt.trim();
    if (!prompt) {
      UI.toast('Describe what you want to create first.', 'warn');
      host.querySelector('#compose-prompt')?.focus();
      return;
    }
    const engineInfoValue = engineInfo(compose.engine);
    if (!engineInfoValue) { UI.toast('Connect an engine first.', 'warn'); openMediaEngines(() => mountStudio(host)); return; }
    const payload = {
      kind: compose.kind,
      prompt,
      engine: compose.engine,
      aspect: compose.aspect,
      duration: compose.duration,
      voice: compose.voice,
      rate: compose.rate,
    };
    const models = engineModelsFor(engineInfoValue, compose.kind);
    if (models.length) payload.model = compose.model || models[0];
    const button = host.querySelector('[data-generate]');
    if (button) { button.disabled = true; button.innerHTML = `<span class="spinner" style="width:12px;height:12px;border-color:rgba(255,255,255,.35);border-top-color:#fff"></span> Queuing…`; }
    try {
      const job = await API.media.generate(payload);
      if (job) {
        vstate.media.jobs = [job, ...vstate.media.jobs.filter((item) => item.id !== job.id)];
        paintJobs(host);
        watchJob(job, host);
      }
      saveComposeDefaults();
      UI.toast(`${KIND[compose.kind].label} generation started.`, 'info', { timeout: 2600 });
    } catch (error) {
      UI.toast(error.message, 'error');
    } finally {
      if (button && vstate.page === 'studio') {
        button.disabled = false;
        const noun = compose.kind === 'audio' && compose.engine === 'system-voice' ? 'speech' : KIND[compose.kind].noun;
        button.innerHTML = `${icon('sparkles', 14)} Generate ${noun} <span class="kbd">${U.kbd('Ctrl ↵')}</span>`;
      }
    }
  }

  async function watchJob(job, host) {
    let attempts = 0;
    const tick = async () => {
      attempts += 1;
      try {
        const latest = await API.media.job(job.id);
        if (!latest) return;
        const index = vstate.media.jobs.findIndex((item) => item.id === latest.id);
        if (index >= 0) vstate.media.jobs[index] = latest;
        else vstate.media.jobs.unshift(latest);
        if (vstate.page === 'studio') paintJobs(host);
        if (['done', 'error', 'cancelled'].includes(latest.status)) {
          await refreshJobs(host);
          await refreshLibrary(host);
          handleJobFinished(latest);
          return;
        }
      } catch {}
      if (attempts < 900) setTimeout(tick, 750);
    };
    setTimeout(tick, 600);
  }

  async function handleJobFinished(job) {
    if (notifiedJobs.has(job.id)) return;
    notifiedJobs.add(job.id);
    if (job.status === 'done') {
      const assetId = (job.assetIds || [])[0];
      let asset = assetId ? vstate.media.assets.find((item) => item.id === assetId) || null : null;
      if (assetId && !asset) {
        try { asset = await API.media.get(assetId); } catch {}
        if (asset) vstate.media.assets.unshift(asset);
      }
      if (asset && typeof window.ChatView?.showGeneratedMedia === 'function') {
        window.ChatView.showGeneratedMedia(asset);
      }
      UI.toast(`${KIND[job.kind]?.label || 'Media'} ready.`, 'success', {
        title: 'Media',
        actionLabel: assetId ? 'Open' : null,
        onAction: assetId ? () => openMediaDetail(assetId) : undefined,
        timeout: 7000,
      });
    } else if (job.status === 'cancelled') {
      UI.toast('Generation cancelled.', 'info');
    } else {
      UI.toast(job.error || 'Generation failed.', 'error', { title: 'Media', timeout: 8000 });
    }
  }

  async function toggleFavoriteAsset(id, host) {
    try {
      const asset = await API.media.favorite(id);
      const index = vstate.media.assets.findIndex((item) => item.id === asset.id);
      if (index >= 0) vstate.media.assets[index] = asset;
      paintLibrary(host);
      const card = host.querySelector(`.media-card[data-media-id="${id}"] .media-fav`);
      if (card) card.classList.toggle('on', asset.favorite);
    } catch (error) { UI.toast(error.message, 'error'); }
  }

  async function importMedia(host) {
    try {
      const result = await API.media.importFiles();
      if (!result || result.canceled) return;
      const count = result.items?.length || 0;
      if (count) UI.toast(`${count} file${count === 1 ? '' : 's'} imported.`, 'success');
      for (const error of result.errors || []) UI.toast(error, 'warn', { timeout: 6000 });
      await refreshLibrary(host);
    } catch (error) { UI.toast(error.message, 'error'); }
  }

  function bindDropImport(node, host) {
    let depth = 0;
    node.addEventListener('dragenter', (event) => { event.preventDefault(); depth += 1; node.classList.add('drop-target'); });
    node.addEventListener('dragover', (event) => { event.preventDefault(); });
    node.addEventListener('dragleave', () => { depth -= 1; if (depth <= 0) { depth = 0; node.classList.remove('drop-target'); } });
    node.addEventListener('drop', async (event) => {
      event.preventDefault();
      depth = 0;
      node.classList.remove('drop-target');
      const files = [...(event.dataTransfer?.files || [])].slice(0, 8);
      if (!files.length) return;
      let imported = 0;
      for (const file of files) {
        if (file.size > 80 * 1024 * 1024) { UI.toast(`${file.name} is larger than 80 MB.`, 'warn'); continue; }
        try {
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Could not read the file.'));
            reader.readAsDataURL(file);
          });
          await API.media.importData({ name: file.name, dataUrl });
          imported += 1;
        } catch (error) { UI.toast(`${file.name}: ${error.message}`, 'error'); }
      }
      if (imported) {
        UI.toast(`${imported} file${imported === 1 ? '' : 's'} imported.`, 'success');
        await refreshLibrary(host);
      }
    });
  }

  /* ------------------------------------------------------------- media detail */

  const SOURCE_LABELS = { generated: 'Generated', edited: 'Edited', imported: 'Imported', cloud: 'Cloud' };
  const CLOUD_GROUP_LABELS = {
    openai: 'OpenAI', google: 'Google AI', stability: 'Stability AI',
    elevenlabs: 'ElevenLabs', replicate: 'Replicate', fal: 'fal.ai', higgsfield: 'Higgsfield',
    openaiCompatible: 'OpenAI compatible',
  };

  function detailMetaItem(label, value, mono) {
    if (value == null || value === '') return '';
    return `<div class="media-meta-item"><div class="label">${esc(label)}</div><div class="value ${mono ? 'mono' : ''}">${esc(value)}</div></div>`;
  }

  function editActionsHtml(note) {
    return `<div class="media-edit-actions">
        <button class="btn btn-primary btn-sm" type="button" data-edit-apply>${icon('wand', 11)} Apply edit</button>
        <span class="hint">${esc(note || 'Runs on this machine. The original is kept.')}</span>
      </div>
      <div class="media-edit-progress" data-edit-progress hidden>
        <div class="media-job-progress"><span></span></div>
        <small>Starting…</small>
      </div>`;
  }

  function editChecksHtml(items) {
    return `<div class="media-edit-checks">${items.map(([name, label]) => `<label class="media-edit-check"><input type="checkbox" data-edit-flag="${name}" /> <span>${esc(label)}</span></label>`).join('')}</div>`;
  }

  function imageEditMarkup(asset) {
    const currentFormat = String(asset.fileName || '').split('.').pop().toLowerCase();
    const format = currentFormat === 'jpg' ? 'jpeg' : ['png', 'jpeg', 'webp', 'avif'].includes(currentFormat) ? currentFormat : 'png';
    return `<div class="media-edit">
      <div class="media-edit-head">${icon('sliders', 13)} Edit image <small>Creates a version · local</small></div>
      <div class="media-edit-grid">
        <label class="studio-field"><span>Width</span><input class="studio-input" data-edit-width type="number" min="8" max="4096" placeholder="${asset.width || 'auto'}" /></label>
        <label class="studio-field"><span>Height</span><input class="studio-input" data-edit-height type="number" min="8" max="4096" placeholder="${asset.height || 'auto'}" /></label>
        <label class="studio-field"><span>Brightness</span><input class="studio-input" data-edit-brightness type="number" min="-100" max="100" placeholder="0" /></label>
        <label class="studio-field"><span>Saturation</span><input class="studio-input" data-edit-saturation type="number" min="-100" max="200" placeholder="0" /></label>
        <label class="studio-field"><span>Hue shift</span><input class="studio-input" data-edit-hue type="number" min="-360" max="360" placeholder="0" /></label>
        <label class="studio-field"><span>Contrast</span><input class="studio-input" data-edit-contrast type="number" min="-100" max="100" placeholder="0" /></label>
        <label class="studio-field"><span>Rotate</span><select class="studio-select" data-edit-rotate>
          <option value="0">None</option><option value="90">90° clockwise</option><option value="180">180°</option><option value="270">90° counter-clockwise</option>
        </select></label>
        <label class="studio-field"><span>Format</span><select class="studio-select" data-edit-format>
          ${[['png', 'PNG'], ['jpeg', 'JPEG'], ['webp', 'WebP'], ['avif', 'AVIF']].map(([value, label]) => `<option value="${value}" ${value === format ? 'selected' : ''}>${label}</option>`).join('')}
        </select></label>
        <div class="studio-field full"><span>Effects</span>${editChecksHtml([['flip', 'Flip vertical'], ['flop', 'Mirror horizontal'], ['grayscale', 'Black & white'], ['normalize', 'Normalize']])}</div>
      </div>
      ${editActionsHtml('Sharp pipeline · the original stays untouched.')}
    </div>`;
  }

  function videoEditMarkup(asset) {
    const isGif = asset.mime === 'image/gif' || /\.gif$/i.test(asset.fileName || '');
    return `<div class="media-edit">
      <div class="media-edit-head">${icon('scissors', 13)} Cut video <small>Creates a version · ffmpeg</small></div>
      <div class="media-edit-grid">
        <label class="studio-field"><span>Start <b>s</b></span><input class="studio-input" data-edit-start type="number" min="0" step="0.1" placeholder="0" /></label>
        <label class="studio-field"><span>Length <b>s</b></span><input class="studio-input" data-edit-length type="number" min="0.4" step="0.1" placeholder="${asset.duration ? `up to ${fmtDuration(asset.duration)}` : 'auto'}" /></label>
        <label class="studio-field"><span>Speed</span><input class="studio-input" data-edit-speed type="number" min="0.25" max="4" step="0.05" value="1" /></label>
        <label class="studio-field"><span>Width</span><input class="studio-input" data-edit-width type="number" min="32" max="3840" placeholder="${asset.width || 'keep'}" /></label>
        <label class="studio-field"><span>Format</span><select class="studio-select" data-edit-format>
          <option value="mp4" ${isGif ? '' : 'selected'}>MP4</option><option value="gif" ${isGif ? 'selected' : ''}>Animated GIF</option>
        </select></label>
        <div class="studio-field"><span>Audio</span>${editChecksHtml([['mute', 'Remove audio']])}</div>
      </div>
      ${editActionsHtml('Re-encodes on this machine. Trim ranges are clamped to the clip.')}
    </div>`;
  }

  function audioEditMarkup(asset) {
    const currentFormat = /\.wav$/i.test(asset.fileName || '') ? 'wav' : 'mp3';
    return `<div class="media-edit">
      <div class="media-edit-head">${icon('sliders', 13)} Shape audio <small>Creates a version · ffmpeg</small></div>
      <div class="media-edit-grid">
        <label class="studio-field"><span>Start <b>s</b></span><input class="studio-input" data-edit-start type="number" min="0" step="0.1" placeholder="0" /></label>
        <label class="studio-field"><span>Length <b>s</b></span><input class="studio-input" data-edit-length type="number" min="0.2" step="0.1" placeholder="${asset.duration ? `up to ${fmtDuration(asset.duration)}` : 'auto'}" /></label>
        <label class="studio-field"><span>Speed</span><input class="studio-input" data-edit-speed type="number" min="0.25" max="4" step="0.05" value="1" /></label>
        <label class="studio-field"><span>Volume <b>dB</b></span><input class="studio-input" data-edit-volume type="number" min="-30" max="20" step="1" placeholder="0" /></label>
        <label class="studio-field"><span>Fade in <b>s</b></span><input class="studio-input" data-edit-fadein type="number" min="0" max="12" step="0.5" placeholder="0" /></label>
        <label class="studio-field"><span>Fade out <b>s</b></span><input class="studio-input" data-edit-fadeout type="number" min="0" max="12" step="0.5" placeholder="0" /></label>
        <label class="studio-field"><span>Format</span><select class="studio-select" data-edit-format>
          <option value="mp3" ${currentFormat === 'mp3' ? 'selected' : ''}>MP3</option><option value="wav" ${currentFormat === 'wav' ? 'selected' : ''}>WAV</option>
        </select></label>
        <div class="studio-field"><span>Processing</span>${editChecksHtml([['reverse', 'Reverse'], ['normalize', 'Normalize loudness']])}</div>
      </div>
      ${editActionsHtml('FFmpeg filters · the source track is preserved.')}
    </div>`;
  }

  function editMarkup(asset) {
    if (asset.kind === 'image') return imageEditMarkup(asset);
    if (asset.kind === 'video') return videoEditMarkup(asset);
    if (asset.kind === 'audio') return audioEditMarkup(asset);
    return '';
  }

  function detailMarkup(asset) {
    const meta = kindOf(asset);
    const urls = asset.urls || {};
    const isCloud = Boolean(asset.provider) || engineInfo(asset.engine)?.vendor === 'cloud';
    const isGif = asset.kind === 'video' && (asset.mime === 'image/gif' || /\.gif$/i.test(asset.fileName || ''));
    let preview = '';
    if (asset.kind === 'audio') {
      preview = `<img src="${U.attr(urls.waveform || urls.preview || urls.thumb)}" alt="" /><audio controls preload="metadata" src="${U.attr(urls.file)}"></audio>`;
    } else if (asset.kind === 'video' && !isGif) {
      preview = `<video src="${U.attr(urls.file)}" poster="${U.attr(urls.poster || '')}" controls playsinline preload="metadata"></video>`;
    } else if (asset.kind === 'video') {
      preview = `<img src="${U.attr(urls.file)}" alt="" />`;
    } else if (asset.kind === 'model3d') {
      preview = asset.meta?.format === 'obj'
        ? `<div class="media-detail-3d" data-viewer></div>`
        : `<img src="${U.attr(urls.preview || urls.thumb)}" alt="" />`;
    } else {
      preview = `<img src="${U.attr(urls.file)}" alt="${U.attr(asset.title)}" />`;
    }
    const sourceLabel = SOURCE_LABELS[asset.source] || 'Generated';
    const metaBits = [
      detailMetaItem('Kind', meta.label),
      detailMetaItem('Engine', asset.engineLabel || asset.engine || '—'),
      asset.model ? detailMetaItem('Model', asset.model, true) : '',
      asset.width && asset.height ? detailMetaItem('Dimensions', `${asset.width} × ${asset.height}`, true) : '',
      asset.duration ? detailMetaItem('Duration', fmtDuration(asset.duration), true) : '',
      detailMetaItem('Size', U.fmtBytes(asset.bytes)),
      detailMetaItem('Created', asset.createdAt ? new Date(asset.createdAt).toLocaleString() : ''),
      asset.seed != null ? detailMetaItem('Seed', asset.seed, true) : '',
      asset.kind === 'model3d' && asset.meta?.triangles ? detailMetaItem('Mesh', `${U.fmtNumber(asset.meta.vertices)} v · ${U.fmtNumber(asset.meta.triangles)} tris`, true) : '',
    ].join('');
    const extra = (asset.extraFiles || []).map((file) => `<button class="file-chip" type="button" data-detail-reveal title="Show files in folder">${icon('file-code', 9)} ${esc(file.name)} · ${U.fmtBytes(file.bytes)}</button>`).join('');
    return `<div class="media-detail">
      <div class="media-detail-preview ${asset.kind === 'audio' ? 'audio' : asset.kind === 'model3d' ? 'model3d' : ''}">${preview}</div>
      <div class="media-detail-side">
        <div class="media-detail-title">${esc(asset.title)}</div>
        <div class="media-detail-sub">
          <span class="badge blue">${icon(meta.icon, 9)} ${meta.label}</span>
          <span class="badge">${esc(sourceLabel)}</span>
          <span class="badge ${isCloud ? 'blue' : 'green'}">${isCloud ? 'Cloud' : 'Local'}</span>
          ${asset.favorite ? '<span class="badge amber">Favorite</span>' : ''}
        </div>
        ${asset.prompt ? `<div class="media-detail-prompt">${esc(asset.prompt)}</div>` : ''}
        <div class="media-meta-grid">${metaBits}</div>
        <div class="media-detail-actions">
          <button class="btn btn-secondary btn-sm ${asset.favorite ? 'fav-on' : ''}" type="button" data-detail-action="favorite">${icon('heart', 12)} <span>${asset.favorite ? 'Favorited' : 'Favorite'}</span></button>
          <button class="btn btn-secondary btn-sm" type="button" data-detail-action="open">${icon('external-link', 12)} Open</button>
          <button class="btn btn-secondary btn-sm" type="button" data-detail-action="reveal">${icon('folder-open', 12)} Reveal</button>
          <button class="btn btn-secondary btn-sm" type="button" data-detail-action="save">${icon('save', 12)} To workspace</button>
          <button class="btn btn-secondary btn-sm" type="button" data-detail-action="export">${icon('download', 12)} Export</button>
          <button class="btn btn-danger-soft btn-sm" type="button" data-detail-action="delete" style="margin-left:auto">${icon('trash', 12)}</button>
        </div>
        ${extra ? `<div class="media-detail-extra">${extra}</div>` : ''}
        ${editMarkup(asset)}
        <div class="media-history" data-history hidden>
          <div class="media-history-label">${icon('layers', 11)} Versions <span class="count" data-history-count></span></div>
          <div class="media-history-list"></div>
        </div>
      </div>
    </div>`;
  }

  function collectEditPayload(asset, scope) {
    const field = (name) => scope.querySelector(`[data-edit-${name}]`);
    const text = (name) => { const node = field(name); return node ? String(node.value || '').trim() : ''; };
    const numeric = (name) => {
      const raw = text(name);
      if (!raw) return null;
      const value = Number(raw);
      return Number.isFinite(value) ? value : null;
    };
    const flag = (name) => Boolean(scope.querySelector(`[data-edit-flag="${name}"]`)?.checked);
    const operations = {};
    const payload = { id: asset.id, operations };
    if (asset.kind === 'image') {
      const width = numeric('width');
      const height = numeric('height');
      const brightness = numeric('brightness');
      const saturation = numeric('saturation');
      const hue = numeric('hue');
      const contrast = numeric('contrast');
      const rotate = numeric('rotate');
      if (width) operations.width = Math.round(width);
      if (height) operations.height = Math.round(height);
      if (brightness) operations.brightness = brightness;
      if (saturation) operations.saturation = saturation;
      if (hue) operations.hue = hue;
      if (contrast) operations.contrast = contrast;
      if (rotate) operations.rotate = rotate;
      if (flag('flip')) operations.flip = true;
      if (flag('flop')) operations.flop = true;
      if (flag('grayscale')) operations.grayscale = true;
      if (flag('normalize')) operations.normalize = true;
      const format = text('format');
      if (format) operations.format = format;
    } else if (asset.kind === 'video') {
      const start = numeric('start');
      const length = numeric('length');
      const speed = numeric('speed');
      const width = numeric('width');
      if (start !== null) operations.start = Math.max(0, start);
      if (length) operations.duration = length;
      if (speed && speed !== 1) operations.speed = speed;
      if (width) operations.width = width;
      if (flag('mute')) operations.mute = true;
      operations.format = text('format') || 'mp4';
    } else if (asset.kind === 'audio') {
      const start = numeric('start');
      const length = numeric('length');
      const speed = numeric('speed');
      const volume = numeric('volume');
      const fadeIn = numeric('fadein');
      const fadeOut = numeric('fadeout');
      if (start !== null) operations.start = Math.max(0, start);
      if (length) operations.duration = length;
      if (speed && speed !== 1) operations.speed = speed;
      if (volume) operations.volumeDb = volume;
      if (fadeIn) operations.fadeIn = fadeIn;
      if (fadeOut) operations.fadeOut = fadeOut;
      if (flag('reverse')) operations.reverse = true;
      if (flag('normalize')) operations.normalize = true;
      operations.format = text('format') || 'mp3';
    }
    return payload;
  }

  async function openMediaDetail(id, options = {}) {
    if (!id) return;
    let asset = null;
    try { asset = await API.media.get(id); }
    catch (error) { UI.toast(error.message, 'error'); return; }
    if (!asset) { UI.toast('That asset is no longer in the library.', 'warn'); return; }
    let closed = false;
    let viewer = null;
    let current = asset;

    const body = document.createElement('div');
    body.className = 'media-detail-body';
    body.innerHTML = detailMarkup(current);
    const handle = UI.modal({
      title: 'Media asset',
      description: `${kindOf(current).label} · ${current.engineLabel || current.engine || 'Imported'}`,
      body,
      size: 'wide',
      className: 'media-modal',
      onClose: () => {
        closed = true;
        if (viewer) { try { viewer.dispose(); } catch {} viewer = null; }
        if (options.onClose) options.onClose();
      },
    });

    const preview = body.querySelector('.media-detail-preview');
    if (current.kind === 'model3d' && current.meta?.format === 'obj' && preview && window.Viewer3D) {
      try {
        viewer = Viewer3D.create(preview.querySelector('[data-viewer]') || preview);
        API.media.readText(current.id).then((result) => {
          if (closed || !viewer) return;
          try { viewer.setObj(result.text); }
          catch (error) { showMeshFallback(preview, current, error.message); }
        }).catch((error) => {
          if (!closed) showMeshFallback(preview, current, error.message);
        });
      } catch (error) {
        showMeshFallback(preview, current, error.message);
      }
    }

    function showMeshFallback(container, item, message) {
      if (viewer) { try { viewer.dispose(); } catch {} viewer = null; }
      const fallback = item.urls?.preview || item.urls?.thumb || '';
      if (fallback) {
        container.innerHTML = `<img src="${U.attr(fallback)}" alt="" /><span class="media-mesh-note">${esc(message || 'Preview image')}</span>`;
      } else if (container) {
        container.innerHTML = `<div class="media-mesh-note">${esc(message || 'No preview available')}</div>`;
      }
    }

    async function refreshAsset() {
      try {
        const next = await API.media.get(current.id);
        if (next) current = next;
      } catch {}
      return current;
    }

    body.addEventListener('click', async (event) => {
      const history = event.target.closest('[data-history-id]');
      if (history) {
        const target = history.dataset.historyId;
        if (target === current.id) return;
        handle.close();
        openMediaDetail(target);
        return;
      }
      const revealExtra = event.target.closest('[data-detail-reveal]');
      if (revealExtra) {
        API.media.reveal(current.id).catch((error) => UI.toast(error.message, 'error'));
        return;
      }
      const action = event.target.closest('[data-detail-action]');
      if (!action) return;
      const name = action.dataset.detailAction;
      if (name === 'favorite') {
        try {
          const updated = await API.media.favorite(current.id);
          current = updated;
          const fav = body.querySelector('[data-detail-action="favorite"]');
          if (fav) {
            fav.classList.toggle('fav-on', updated.favorite);
            fav.innerHTML = `${icon('heart', 12)} <span>${updated.favorite ? 'Favorited' : 'Favorite'}</span>`;
          }
          if (vstate.page === 'studio' && vstate.host) paintLibrary(vstate.host);
          syncMediaBadge();
        } catch (error) { UI.toast(error.message, 'error'); }
        return;
      }
      if (name === 'open') {
        API.media.open(current.id).catch((error) => UI.toast(error.message, 'error'));
        return;
      }
      if (name === 'reveal') {
        API.media.reveal(current.id).catch((error) => UI.toast(error.message, 'error'));
        return;
      }
      if (name === 'export') {
        action.disabled = true;
        try {
          const result = await API.media.exportAsset(current.id);
          if (result && !result.canceled) UI.toast(`Exported to ${result.path}`, 'success', { title: 'Media', timeout: 7000 });
        } catch (error) { UI.toast(error.message, 'error'); }
        finally { action.disabled = false; }
        return;
      }
      if (name === 'save') {
        action.disabled = true;
        try {
          const result = await API.media.saveToWorkspace({ id: current.id, folder: 'media' });
          UI.toast(`Saved as ${result.relative}`, 'success', {
            title: 'Copied into workspace',
            actionLabel: 'Reveal',
            onAction: () => API.workspace.reveal(result.relative).catch(() => {}),
            timeout: 8000,
          });
        } catch (error) { UI.toast(error.message, 'error'); }
        finally { action.disabled = false; }
        return;
      }
      if (name === 'delete') {
        const confirmed = await UI.confirm({
          title: 'Delete this asset?',
          message: `“${current.title}” and its files will be removed from the media library.`,
          detail: 'Versions made from it stay in the library. This cannot be undone.',
          confirmLabel: 'Delete',
          danger: true,
        });
        if (!confirmed) return;
        try {
          await API.media.remove(current.id);
          handle.close();
          await refreshLibrary();
          syncMediaBadge();
          UI.toast('Asset deleted.', 'success');
        } catch (error) { UI.toast(error.message, 'error'); }
      }
    });

    const applyButton = body.querySelector('[data-edit-apply]');
    applyButton?.addEventListener('click', async () => {
      const progress = body.querySelector('[data-edit-progress]');
      const bar = progress?.querySelector('.media-job-progress span');
      const label = progress?.querySelector('small');
      const original = applyButton.innerHTML;
      applyButton.disabled = true;
      applyButton.innerHTML = `<span class="spinner" style="width:11px;height:11px;border-color:rgba(255,255,255,.35);border-top-color:#fff"></span> Starting…`;
      if (progress) {
        progress.hidden = false;
        if (bar) bar.style.width = '4%';
        if (label) label.textContent = 'Sending the edit to the engine…';
      }
      let job;
      try {
        job = await API.media.edit(collectEditPayload(current, body));
      } catch (error) {
        UI.toast(error.message, 'error');
        applyButton.disabled = false;
        applyButton.innerHTML = original;
        if (progress) progress.hidden = true;
        return;
      }
      if (label) label.textContent = 'Working…';
      const restore = () => {
        if (!applyButton.isConnected) return;
        applyButton.disabled = false;
        applyButton.innerHTML = original;
      };
      const tick = async () => {
        let latest = null;
        try { latest = await API.media.job(job.id); } catch {}
        if (latest) {
          if (bar) bar.style.width = `${Math.max(4, Math.round((Number(latest.progress) || 0) * 100))}%`;
          if (label) label.textContent = latest.status === 'running' ? `Working · ${latest.stage || 'processing'}` : `${latest.status[0].toUpperCase()}${latest.status.slice(1)}${latest.stage ? ` · ${latest.stage}` : ''}`;
        }
        if (!latest || !['done', 'error', 'cancelled'].includes(latest.status)) {
          setTimeout(tick, 550);
          return;
        }
        restore();
        if (latest.status === 'done' && (latest.assetIds || [])[0]) {
          await refreshLibrary();
          syncMediaBadge();
          UI.toast('Edit saved as a new version.', 'success', { title: 'Media', timeout: 5000 });
          if (!closed) {
            handle.close();
            openMediaDetail(latest.assetIds[0]);
          }
          return;
        }
        if (progress) progress.hidden = true;
        if (latest.status === 'cancelled') UI.toast('Edit cancelled.', 'info');
        else UI.toast(latest.error || 'Edit failed.', 'error', { title: 'Media', timeout: 8000 });
      };
      setTimeout(tick, 400);
    });

    loadMediaVersions(body, current, handle);
  }

  async function loadMediaVersions(body, asset, handle) {
    const host = body.querySelector('[data-history]');
    if (!host) return;
    try {
      const data = await API.media.list({ limit: 200 });
      if (!data || !Array.isArray(data.items)) return;
      const byId = new Map(data.items.map((item) => [item.id, item]));
      let root = asset;
      const seen = new Set();
      while (root.parentId && byId.has(root.parentId) && !seen.has(root.parentId)) {
        seen.add(root.parentId);
        root = byId.get(root.parentId);
      }
      const lineage = new Set([root.id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const item of data.items) {
          if (item.parentId && lineage.has(item.parentId) && !lineage.has(item.id)) {
            lineage.add(item.id);
            grew = true;
          }
        }
      }
      const versions = data.items
        .filter((item) => lineage.has(item.id))
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      if (versions.length < 2) return;
      host.hidden = false;
      const count = host.querySelector('[data-history-count]');
      if (count) count.textContent = String(versions.length);
      const list = host.querySelector('.media-history-list');
      if (!list) return;
      list.innerHTML = versions.map((item) => {
        const thumb = item.urls?.thumb || item.urls?.preview || '';
        const active = item.id === asset.id;
        return `<button class="media-history-thumb ${active ? 'active' : ''}" type="button" data-history-id="${U.attr(item.id)}" title="${U.attr(`${item.title} · ${U.relativeTime(item.createdAt)}`)}">
          ${thumb ? `<img src="${U.attr(thumb)}" alt="" loading="lazy" />` : `<span class="media-history-mono">${icon(KIND[item.kind]?.icon || 'file', 15)}</span>`}
        </button>`;
      }).join('');
    } catch {}
  }

  /* ------------------------------------------------------------- media engines */

  function compatEngineMarkup(group) {
    const engine = group.engines[0] || {};
    const compat = vstate.media.engines?.compat || {};
    const endpoint = compat.endpoint || engine.endpoint || engine.baseUrl || '';
    const models = compat.models || engine.modelsByKind || { image: [], video: [] };
    const imageModels = models.image || [];
    const videoModels = models.video || [];
    const autoDetected = Boolean(compat.autoDetected);
    const ready = Boolean(group.hasKey && endpoint);
    const isNvidia = /integrate\.api\.nvidia\.com/i.test(endpoint);
    const chips = [
      `<span class="engine-chip">Image</span><span class="engine-chip">Video</span>`,
      ...imageModels.slice(0, 3).map((model) => `<span class="engine-chip mono">${esc(model)}</span>`),
      ...videoModels.slice(0, 3).map((model) => `<span class="engine-chip mono">${esc(model)}</span>`),
    ].join('');
    return `<div class="engine-row compat-engine ${ready ? 'available' : ''}" data-key-group="openaiCompatible">
      <div class="engine-head">
        <span class="engine-glyph">${icon('sparkles', 13)}</span>
        <div class="engine-copy">
          <div class="engine-name">${esc(group.label)} <span class="badge ${group.hasKey ? 'green' : ''}">${group.hasKey ? 'Key stored' : 'No key'}</span>${autoDetected ? ' <span class="badge blue">NVIDIA NIM detected</span>' : ''}</div>
          <div class="engine-kinds">${chips}</div>
        </div>
        <span class="engine-status ${ready ? 'on' : ''}">${icon(ready ? 'check-circle' : 'alert-circle', 11)} ${ready ? 'Ready' : 'Needs setup'}</span>
      </div>
      <div class="compat-grid">
        <div class="studio-field full"><span>Base URL</span>
          <div class="engine-key-row compact">
            <input class="studio-input" type="text" spellcheck="false" data-compat-endpoint placeholder="https://integrate.api.nvidia.com/v1" value="${U.attr(endpoint)}" />
            <button class="btn btn-secondary btn-sm" type="button" data-compat-save-endpoint>Save</button>
          </div>
        </div>
        <div class="studio-field full"><span>API key</span>
          <div class="engine-key-row compact">
            <input class="studio-input" type="password" autocomplete="off" spellcheck="false" data-key-input="openaiCompatible" placeholder="${group.hasKey ? '•••••••• stored — enter a new key' : 'Paste the API key for this endpoint'}" />
            <button class="btn btn-secondary btn-sm" type="button" data-key-save="openaiCompatible">${group.hasKey ? 'Replace' : 'Save'}</button>
            ${group.hasKey ? `<button class="btn btn-ghost btn-sm" type="button" data-key-clear="openaiCompatible">Clear</button>` : ''}
          </div>
        </div>
        <div class="studio-field"><span>Image models</span><input class="studio-input" type="text" spellcheck="false" data-compat-image placeholder="qwen/qwen-image" value="${U.attr(imageModels.join(', '))}" /></div>
        <div class="studio-field"><span>Video models</span><input class="studio-input" type="text" spellcheck="false" data-compat-video placeholder="wan-ai/wan2.2" value="${U.attr(videoModels.join(', '))}" /></div>
      </div>
      <div class="compat-actions">
        <button class="btn btn-secondary btn-sm" type="button" data-compat-discover>${icon('refresh', 11)} Discover models</button>${isNvidia ? `
        <button class="btn btn-secondary btn-sm" type="button" data-compat-nvidia>${icon('wand', 11)} Use NVIDIA NIM models</button>` : ''}
        <button class="btn btn-primary btn-sm" type="button" data-compat-save-models>Save models</button>
        <span class="hint">${isNvidia ? 'NVIDIA hosted serves FLUX images through /v1/genai. Video needs a self-hosted NIM base URL.' : 'Comma-separated model IDs. Discover reads /v1/models from this endpoint with the saved key.'}</span>
      </div>
    </div>`;
  }

  function readCompatModels(body) {
    const parse = (selector) => [...new Set(String(body.querySelector(selector)?.value || '')
      .split(/[\n,]+/)
      .map((model) => model.trim())
      .filter(Boolean))];
    return { image: parse('[data-compat-image]'), video: parse('[data-compat-video]') };
  }

  function applyCompatResult(result) {
    if (!vstate.media.engines) return;
    const next = { ...vstate.media.engines };
    if (result?.engines) {
      next.local = result.engines.local || next.local;
      next.cloud = result.engines.cloud || next.cloud;
    }
    if (result?.endpoints) next.endpoints = result.endpoints;
    if (result?.compat) next.compat = result.compat;
    if (result?.models) next.compat = { ...(next.compat || {}), models: result.models };
    vstate.media.engines = next;
  }

  function enginesMarkup() {
    const engines = vstate.media.engines || { local: [], cloud: [] };
    const groups = new Map();
    for (const engine of engines.cloud || []) {
      const group = groups.get(engine.keyId) || {
        keyId: engine.keyId,
        keyLabel: engine.keyLabel || 'API key',
        label: CLOUD_GROUP_LABELS[engine.keyId] || engine.label,
        engines: [],
        hasKey: false,
        note: engine.note || '',
      };
      group.engines.push(engine);
      group.hasKey = group.hasKey || Boolean(engine.hasKey);
      if (!group.note && engine.note) group.note = engine.note;
      groups.set(engine.keyId, group);
    }
    const compatEndpoint = engines.compat?.endpoint
      || (groups.get('openaiCompatible')?.engines || []).find((engine) => engine.endpoint)?.endpoint
      || '';
    const ready = [...groups.values()].filter((group) => group.hasKey && (group.keyId !== 'openaiCompatible' || compatEndpoint)).length;
    const comfyEndpoint = engines.endpoints?.comfyui || (engines.local || []).find((engine) => engine.id === 'comfyui')?.endpoint || '';
    const localRows = (engines.local || []).filter((engine) => engine.id !== 'comfyui').map((engine) => `<div class="engine-row ${engine.available ? 'available' : ''}">
      <div class="engine-head">
        <span class="engine-glyph">${icon('cpu', 13)}</span>
        <div class="engine-copy">
          <div class="engine-name">${esc(engine.label)} <span class="badge green">Local</span></div>
          <div class="engine-kinds">${(engine.kinds || []).map((kind) => `<span class="engine-chip">${esc(KIND[kind]?.label || kind)}</span>`).join('')}${(engine.models || []).map((model) => `<span class="engine-chip mono">${esc(model)}</span>`).join('')}</div>
        </div>
        <span class="engine-status ${engine.available ? 'on' : ''}">${icon(engine.available ? 'check-circle' : 'alert-circle', 11)} ${engine.available ? 'Ready' : 'Unavailable'}</span>
      </div>
    </div>`).join('');
    const cloudRows = [...groups.values()].map((group) => group.keyId === 'openaiCompatible' ? compatEngineMarkup(group) : `<div class="engine-row ${group.hasKey ? 'available' : ''}" data-key-group="${U.attr(group.keyId)}">
      <div class="engine-head">
        <span class="engine-glyph">${icon('globe', 13)}</span>
        <div class="engine-copy">
          <div class="engine-name">${esc(group.label)} <span class="badge ${group.hasKey ? 'green' : ''}">${group.hasKey ? 'Key stored' : 'No key'}</span></div>
          <div class="engine-kinds">${group.engines.flatMap((engine) => (engine.models || []).slice(0, 4).map((model) => `<span class="engine-chip mono">${esc(model)}</span>`)).join('')}</div>
        </div>
        <span class="engine-status ${group.hasKey ? 'on' : ''}">${icon(group.hasKey ? 'key' : 'lock', 11)} ${esc(group.keyLabel)}</span>
      </div>
      <div class="engine-key-row">
        <input class="studio-input" type="password" autocomplete="off" spellcheck="false" data-key-input="${U.attr(group.keyId)}" placeholder="${group.hasKey ? '•••••••• stored — enter a new key' : `Paste ${esc(group.keyLabel)}`}" />
        <button class="btn btn-secondary btn-sm" type="button" data-key-save="${U.attr(group.keyId)}">${group.hasKey ? 'Replace' : 'Save'}</button>
        ${group.hasKey ? `<button class="btn btn-ghost btn-sm" type="button" data-key-clear="${U.attr(group.keyId)}">Clear</button>` : ''}
      </div>
    </div>`).join('');
    return `<div class="engine-list">
      <div class="catalog-section-title">Local</div>
      ${localRows || '<div class="insight-empty-note">No local engines in this build.</div>'}
      <div class="engine-row ${comfyEndpoint ? 'available' : ''}">
        <div class="engine-head">
          <span class="engine-glyph">${icon('terminal', 13)}</span>
          <div class="engine-copy">
            <div class="engine-name">ComfyUI <span class="badge ${comfyEndpoint ? 'green' : ''}">${comfyEndpoint ? 'Connected' : 'Not configured'}</span></div>
            <div class="engine-kinds"><span class="engine-chip">Image</span><span class="engine-chip mono">HTTP API</span></div>
          </div>
          <span class="engine-status ${comfyEndpoint ? 'on' : ''}">${icon('globe', 11)} ${comfyEndpoint ? 'Endpoint saved' : 'Local server'}</span>
        </div>
        <div class="engine-key-row">
          <input class="studio-input" type="text" spellcheck="false" data-comfy-endpoint placeholder="http://127.0.0.1:8188" value="${U.attr(comfyEndpoint)}" />
          <button class="btn btn-secondary btn-sm" type="button" data-comfy-save>Save</button>
          <button class="btn btn-ghost btn-sm" type="button" data-comfy-test>Test</button>
        </div>
      </div>
      <div class="catalog-section-title" style="margin-top:2px">Cloud <span class="engine-ready-count">${ready}/${groups.size}</span></div>
      ${cloudRows || '<div class="insight-empty-note">No cloud engines registered.</div>'}
    </div>`;
  }

  async function openMediaEngines(onDone) {
    let changed = false;
    try {
      const engines = await API.media.engines();
      vstate.media.engines = engines;
    } catch (error) { UI.toast(error.message, 'error'); return; }
    const body = document.createElement('div');
    body.className = 'media-engines-body';
    const paint = () => { body.innerHTML = enginesMarkup(); };
    paint();
    const footer = document.createElement('div');
    footer.className = 'media-engines-foot';
    footer.innerHTML = `<span style="flex:1"></span><button class="btn btn-primary btn-sm" type="button" data-engines-done>Done</button>`;
    const modal = UI.modal({
      title: 'Engines & keys',
      body,
      footer,
      size: 'large',
      className: 'media-engines-modal',
      onClose: () => { if (changed && onDone) onDone(); },
    });
    footer.querySelector('[data-engines-done]')?.addEventListener('click', () => modal.close());

    async function saveKey(keyId, value) {
      const inputs = body.querySelectorAll(`[data-key-input="${keyId}"]`);
      const buttons = body.querySelectorAll(`[data-key-save="${keyId}"], [data-key-clear="${keyId}"]`);
      buttons.forEach((button) => { button.disabled = true; });
      try {
        const result = await API.media.setKey({ id: keyId, key: value });
        if (result?.engines) {
          vstate.media.engines = {
            ...(vstate.media.engines || {}),
            local: result.engines.local || [],
            cloud: result.engines.cloud || [],
          };
        }
        applyCompatResult(result);
        changed = true;
        API.media.storage().then((storage) => { vstate.media.storage = storage; }).catch(() => {});
        paint();
        UI.toast(result?.hasKey ? `${CLOUD_GROUP_LABELS[keyId] || 'Cloud'} key saved.` : 'Key removed.', 'success');
      } catch (error) {
        UI.toast(error.message, 'error');
        buttons.forEach((button) => { button.disabled = false; });
      }
    }

    body.addEventListener('click', async (event) => {
      const comfySave = event.target.closest('[data-comfy-save]');
      if (comfySave) {
        const input = body.querySelector('[data-comfy-endpoint]');
        const endpoint = String(input?.value || '').trim();
        comfySave.disabled = true;
        try {
          const result = await API.media.setEndpoint({ id: 'comfyui', endpoint });
          if (result?.engines) vstate.media.engines = { ...vstate.media.engines, ...result.engines };
          if (vstate.media.engines) vstate.media.engines.endpoints = result?.endpoints || { comfyui: endpoint };
          changed = true;
          paint();
          UI.toast(endpoint ? 'ComfyUI endpoint saved.' : 'ComfyUI endpoint cleared.', 'success');
        } catch (error) {
          UI.toast(error.message, 'error');
          comfySave.disabled = false;
        }
        return;
      }
      const comfyTest = event.target.closest('[data-comfy-test]');
      if (comfyTest) {
        const input = body.querySelector('[data-comfy-endpoint]');
        const endpoint = String(input?.value || '').trim();
        if (!endpoint) { UI.toast('Enter a ComfyUI endpoint first.', 'warn'); input?.focus(); return; }
        comfyTest.disabled = true;
        comfyTest.textContent = 'Testing…';
        try {
          const result = await API.media.testEndpoint({ endpoint });
          if (!result?.ok) throw new Error('ComfyUI did not respond.');
          const count = (result?.checkpoints || []).length;
          UI.toast(`ComfyUI reachable${count ? ` · ${count} checkpoint${count === 1 ? '' : 's'}` : ''}.`, 'success');
        } catch (error) {
          UI.toast(error.message || 'ComfyUI did not respond.', 'error');
        }
        comfyTest.disabled = false;
        comfyTest.textContent = 'Test';
        return;
      }
      const compatEndpointSave = event.target.closest('[data-compat-save-endpoint]');
      if (compatEndpointSave) {
        const endpoint = String(body.querySelector('[data-compat-endpoint]')?.value || '').trim();
        compatEndpointSave.disabled = true;
        try {
          const result = await API.media.setEndpoint({ id: 'openaiCompatible', endpoint });
          applyCompatResult(result);
          changed = true;
          paint();
          const found = (result?.compat?.models?.image || []).length + (result?.compat?.models?.video || []).length;
          UI.toast(endpoint
            ? `OpenAI-compatible endpoint saved${found ? ` · ${found} media models found` : ''}.`
            : 'OpenAI-compatible endpoint cleared.', 'success');
        } catch (error) {
          UI.toast(error.message, 'error');
          compatEndpointSave.disabled = false;
        }
        return;
      }
      const compatModelsSave = event.target.closest('[data-compat-save-models]');
      if (compatModelsSave) {
        const models = readCompatModels(body);
        compatModelsSave.disabled = true;
        try {
          const result = await API.media.setModels(models);
          applyCompatResult(result);
          changed = true;
          paint();
          const count = models.image.length + models.video.length;
          UI.toast(`${count} media model${count === 1 ? '' : 's'} saved.`, 'success');
        } catch (error) {
          UI.toast(error.message, 'error');
          compatModelsSave.disabled = false;
        }
        return;
      }
      const compatNvidia = event.target.closest('[data-compat-nvidia]');
      if (compatNvidia) {
        compatNvidia.disabled = true;
        try {
          const result = await API.media.setModels({
            image: ['black-forest-labs/flux.1-schnell', 'qwen/qwen-image-2512'],
            video: ['wan-ai/wan2.2'],
          });
          applyCompatResult(result);
          changed = true;
          paint();
          UI.toast('NVIDIA NIM model IDs saved. Adjust them if your server uses other names.', 'success', { timeout: 8000 });
        } catch (error) {
          UI.toast(error.message, 'error');
          compatNvidia.disabled = false;
        }
        return;
      }
      const compatDiscover = event.target.closest('[data-compat-discover]');
      if (compatDiscover) {
        const endpoint = String(body.querySelector('[data-compat-endpoint]')?.value || '').trim();
        if (!endpoint) {
          UI.toast('Enter the OpenAI-compatible base URL first.', 'warn');
          body.querySelector('[data-compat-endpoint]')?.focus();
          return;
        }
        const original = compatDiscover.innerHTML;
        compatDiscover.disabled = true;
        compatDiscover.textContent = 'Discovering…';
        try {
          const result = await API.media.discoverModels({ endpoint });
          if (!result?.total) throw new Error('This endpoint returned no models.');
          const image = result.image || [];
          const video = result.video || [];
          if (!image.length && !video.length) {
            UI.toast(`Found ${result.total} models but none look like image or video. Add model IDs manually.`, 'warn', { timeout: 8000 });
            compatDiscover.disabled = false;
            compatDiscover.innerHTML = original;
            return;
          }
          const saved = await API.media.setModels({ image, video });
          applyCompatResult(saved);
          changed = true;
          paint();
          UI.toast(`Found ${result.total} models · ${image.length} image, ${video.length} video.`, 'success', { timeout: 7000 });
        } catch (error) {
          UI.toast(error.message, 'error');
          compatDiscover.disabled = false;
          compatDiscover.innerHTML = original;
        }
        return;
      }
      const save = event.target.closest('[data-key-save]');
      if (save) {
        const keyId = save.dataset.keySave;
        const input = body.querySelector(`[data-key-input="${keyId}"]`);
        const value = String(input?.value || '').trim();
        if (!value) { UI.toast('Paste a key first.', 'warn'); input?.focus(); return; }
        saveKey(keyId, value);
        return;
      }
      const clear = event.target.closest('[data-key-clear]');
      if (clear) {
        const keyId = clear.dataset.keyClear;
        UI.confirm({
          title: 'Remove this key?',
          message: `Cloud engines that use ${CLOUD_GROUP_LABELS[keyId] || 'this key'} will stop working until you add it again.`,
          confirmLabel: 'Remove key',
          danger: true,
        }).then((confirmed) => { if (confirmed) saveKey(keyId, ''); });
      }
    });
    body.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      const input = event.target.closest('[data-key-input]');
      if (!input) return;
      event.preventDefault();
      const keyId = input.dataset.keyInput;
      const value = input.value.trim();
      if (value) saveKey(keyId, value);
    });
  }

  /* ---------------------------------------------------------------- SSH (MCP) */

  function sshManagerMarkup(hosts) {
    return `<div class="settings-group" data-ssh-list>
      ${hosts.length ? hosts.map((entry) => `<div class="ssh-host" data-ssh-host="${U.attr(entry.id)}">
        <div class="ssh-host-copy">
          <div class="ssh-host-name">${icon('terminal', 12)} ${esc(entry.name)}</div>
          <div class="ssh-host-meta">${esc(entry.user)}@${esc(entry.host)}:${Number(entry.port) || 22} · ${entry.authType === 'password' ? 'password' : 'private key'}</div>
        </div>
        <div class="ssh-host-actions">
          <button class="btn btn-secondary btn-sm" type="button" data-ssh-test="${U.attr(entry.id)}">Test</button>
          <button class="mini-icon" type="button" data-ssh-remove="${U.attr(entry.id)}" title="Remove host">${icon('trash', 13)}</button>
        </div>
      </div>`).join('') : `<div class="setting-note">No SSH hosts yet.</div>`}
    </div>
    <div class="settings-group ssh-form">
      <div class="ssh-grid">
        <label class="setting-label">Name<input class="field-input" id="ssh-name" placeholder="Production" maxlength="60" spellcheck="false" /></label>
        <label class="setting-label">Host<input class="field-input" id="ssh-host" placeholder="server.example.com" spellcheck="false" /></label>
        <label class="setting-label">Port<input class="field-input" id="ssh-port" type="number" min="1" max="65535" value="22" /></label>
        <label class="setting-label">User<input class="field-input" id="ssh-user" placeholder="deploy" spellcheck="false" /></label>
        <label class="setting-label">Auth
          <select class="settings-select" id="ssh-auth">
            <option value="key">Private key</option>
            <option value="password">Password</option>
          </select>
        </label>
        <label class="setting-label" data-ssh-key-block>Private key path<input class="field-input" id="ssh-key" placeholder="~/.ssh/id_ed25519" spellcheck="false" /></label>
        <label class="setting-label" data-ssh-key-block>Key passphrase<input class="field-input" id="ssh-passphrase" type="password" autocomplete="off" /></label>
        <label class="setting-label" data-ssh-password-block hidden>Password<input class="field-input" id="ssh-password" type="password" autocomplete="off" /></label>
      </div>
      <div class="provider-actions">
        <button class="btn btn-primary btn-sm" type="button" data-ssh-add>${icon('plus', 12)} Save host</button>
      </div>
    </div>`;
  }

  async function openSshHosts(onDone) {
    let hosts = [];
    try {
      const data = API.ssh?.list ? await API.ssh.list() : { hosts: [] };
      hosts = data.hosts || [];
      vstate.settings.ssh = data;
    } catch (error) { UI.toast(error.message, 'error'); return; }
    let changed = false;
    const body = document.createElement('div');
    body.className = 'ssh-manager';
    const paint = () => { body.innerHTML = sshManagerMarkup(hosts); };
    paint();
    const footer = document.createElement('div');
    footer.className = 'media-engines-foot';
    footer.innerHTML = `<span class="setting-note">ssh_run is approval-gated.</span><span style="flex:1"></span><button class="btn btn-primary btn-sm" type="button" data-ssh-done>Done</button>`;
    const modal = UI.modal({
      title: 'SSH hosts',
      body,
      footer,
      size: 'large',
      className: 'ssh-modal',
      onClose: () => { if (changed && onDone) onDone(); },
    });
    footer.querySelector('[data-ssh-done]')?.addEventListener('click', () => modal.close());

    body.addEventListener('change', (event) => {
      if (event.target && event.target.id === 'ssh-auth') {
        const password = event.target.value === 'password';
        body.querySelectorAll('[data-ssh-key-block]').forEach((node) => { node.hidden = password; });
        body.querySelectorAll('[data-ssh-password-block]').forEach((node) => { node.hidden = !password; });
      }
    });

    body.addEventListener('click', async (event) => {
      const add = event.target.closest('[data-ssh-add]');
      if (add) {
        const authType = body.querySelector('#ssh-auth')?.value === 'password' ? 'password' : 'key';
        add.disabled = true;
        try {
          const result = await API.ssh.add({
            name: body.querySelector('#ssh-name')?.value.trim() || '',
            host: body.querySelector('#ssh-host')?.value.trim() || '',
            port: body.querySelector('#ssh-port')?.value || 22,
            user: body.querySelector('#ssh-user')?.value.trim() || '',
            authType,
            keyPath: body.querySelector('#ssh-key')?.value.trim() || '',
            password: authType === 'password' ? (body.querySelector('#ssh-password')?.value || '') : '',
            passphrase: authType === 'key' ? (body.querySelector('#ssh-passphrase')?.value || '') : '',
          });
          hosts = result.hosts || [];
          vstate.settings.ssh = result;
          changed = true;
          paint();
          UI.toast('SSH host saved.', 'success');
        } catch (error) { UI.toast(error.message, 'error'); add.disabled = false; }
        return;
      }
      const test = event.target.closest('[data-ssh-test]');
      if (test) {
        test.disabled = true;
        test.textContent = 'Testing…';
        try {
          const result = await API.ssh.test({ id: test.dataset.sshTest });
          hosts = result.hosts || hosts;
          vstate.settings.ssh = result;
          changed = true;
          paint();
          UI.toast(result.ok ? `SSH verified · ${result.latencyMs} ms` : `SSH failed · ${result.message || 'unknown error'}`, result.ok ? 'success' : 'error');
        } catch (error) { UI.toast(error.message, 'error'); test.disabled = false; test.textContent = 'Test'; }
        return;
      }
      const remove = event.target.closest('[data-ssh-remove]');
      if (remove) {
        const entry = hosts.find((item) => item.id === remove.dataset.sshRemove);
        const ok = await UI.confirm({ title: 'Remove this host?', message: 'Saved credentials and the pinned host key will be deleted from this device.', confirmLabel: 'Remove host', danger: true, detail: entry ? `${entry.name} · ${entry.user}@${entry.host}` : '' });
        if (!ok) return;
        try {
          const result = await API.ssh.remove(remove.dataset.sshRemove);
          hosts = result.hosts || [];
          vstate.settings.ssh = result;
          changed = true;
          paint();
          UI.toast('SSH host removed.', 'success');
        } catch (error) { UI.toast(error.message, 'error'); }
      }
    });
  }

  /* --------------------------------------------------------------- model picker */

  function modelPickerCatalog() {
    const catalog = appState().catalog;
    if (catalog?.providers?.length) return catalog;
    return { providers: vstate.models.providers || [], models: vstate.models.models || [] };
  }

  function openModelPicker(anchor, options = {}) {
    const catalog = modelPickerCatalog();
    const providers = (catalog.providers || []).filter((provider) => (provider.models || []).length && providerUsable(provider));
    const current = options.current || '';
    const allowNone = Boolean(options.allowNone);
    let total = 0;
    for (const provider of providers) total += (provider.models || []).length;
    const body = document.createElement('div');
    body.className = 'model-picker';
    body.innerHTML = `${total ? `<label class="search-field model-picker-search">${icon('search', 13)}<input type="search" data-model-search placeholder="Search ${U.fmtNumber(total)} models or providers" autocomplete="off" /></label>` : ''}
      <div class="model-picker-list" data-model-list>
        ${total === 0 ? `<div class="model-picker-no-models">
          <div class="model-picker-no-icon">${icon('cpu', 20)}</div>
          <b>Connect a provider</b>
          <p>Add an API key for a hosted provider, or start Ollama or LM Studio locally.</p>
          <button class="btn btn-primary btn-sm" type="button" data-connect-provider>${icon('plus', 12)} Open Models</button>
        </div>` : ''}
        ${allowNone ? `<div class="model-picker-group"><div class="model-picker-group-label">No fallback</div>
          <button class="model-picker-row ${!current ? 'selected' : ''}" type="button" data-model-id="" data-search="none no fallback">
            <span class="model-picker-icon">${icon('circle', 13)}</span>
            <span class="model-picker-copy"><span class="model-picker-model">None</span><span class="model-picker-id">Do not retry with another model</span></span>
            <span class="model-picker-check">${!current ? icon('check', 12) : ''}</span>
          </button></div>` : ''}
        ${providers.map((provider) => `<div class="model-picker-group">
          <div class="model-picker-group-label">${UI.providerMono(provider)} ${esc(provider.name)}${provider.kind === 'local' ? '<span class="badge green">Local</span>' : provider.kind === 'custom' ? '<span class="badge">Custom</span>' : ''}</div>
          ${(provider.models || []).map((model) => {
            const fullId = `${provider.id}/${model.id}`;
            const selected = fullId === current;
            const search = `${provider.name} ${provider.id} ${model.name} ${model.id}`.toLowerCase();
            return `<button class="model-picker-row ${selected ? 'selected' : ''}" type="button" data-model-id="${U.attr(fullId)}" data-search="${U.attr(search)}">
              <span class="model-picker-icon model-picker-logo">${UI.providerMono(provider)}</span>
              <span class="model-picker-copy"><span class="model-picker-model">${esc(model.name)}</span><span class="model-picker-id">${esc(fullId)}${model.context ? ` · ${U.fmtNumber(model.context)} ctx` : ''}</span></span>
              ${model.local ? '<span class="badge green">Local</span>' : ''}
              <span class="model-picker-check">${selected ? icon('check', 12) : ''}</span>
            </button>`;
          }).join('')}
        </div>`).join('')}
        <div class="model-picker-empty" hidden>No models match that search.</div>
      </div>
      <div class="model-picker-foot">
        <span>${total ? `${U.fmtNumber(total)} models · ${providers.length} providers` : 'No models yet'}</span>
        <span style="flex:1"></span>
        <button class="link-btn" type="button" data-manage-models>Manage models ${icon('arrow-right', 10)}</button>
      </div>`;
    const modal = UI.modal({
      title: options.title || 'Choose a model',
      description: options.description || '',
      body,
      className: 'modal-model-picker',
      size: 'large',
    });
    const search = body.querySelector('[data-model-search]');
    const list = body.querySelector('[data-model-list]');
    const empty = body.querySelector('.model-picker-empty');
    const rows = () => [...list.querySelectorAll('[data-model-id]')];

    function setActive(row) {
      rows().forEach((item) => item.classList.toggle('active', item === row));
      if (row) row.scrollIntoView({ block: 'nearest' });
    }

    function choose(row) {
      if (!row) return;
      const value = row.dataset.modelId;
      modal.close();
      options.onSelect?.(value);
    }

    search?.addEventListener('input', () => {
      const query = search.value.trim().toLowerCase();
      let visible = 0;
      rows().forEach((row) => {
        const match = !query || (row.dataset.search || '').includes(query);
        row.hidden = !match;
        if (match) visible += 1;
      });
      for (const group of list.querySelectorAll('.model-picker-group')) {
        const any = [...group.querySelectorAll('[data-model-id]')].some((row) => !row.hidden);
        group.hidden = !any;
      }
      empty.hidden = visible > 0;
      setActive(null);
    });
    search?.addEventListener('keydown', (event) => {
      const candidates = rows().filter((row) => !row.hidden);
      if (!candidates.length) return;
      const index = candidates.findIndex((row) => row.classList.contains('active'));
      if (event.key === 'ArrowDown') { event.preventDefault(); setActive(candidates[Math.min(candidates.length - 1, index + 1)] || candidates[0]); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(candidates[Math.max(0, index - 1)]); }
      else if (event.key === 'Enter') { event.preventDefault(); choose(candidates[Math.max(0, index)]); }
    });
    body.addEventListener('click', (event) => {
      const row = event.target.closest('[data-model-id]');
      if (row) { choose(row); return; }
      if (event.target.closest('[data-connect-provider]')) {
        modal.close();
        if (window.App?.openPage) App.openPage('models');
        return;
      }
      if (event.target.closest('[data-manage-models]')) {
        modal.close();
        if (window.App?.openPage) App.openPage('models');
      }
    });
    setTimeout(() => search?.focus(), 60);
  }

  /* -------------------------------------------------------------------- APIs */

  async function mountApis(host) {
    vstate.page = 'plugins';
    vstate.host = host;
    if (!vstate.apis.items.length) host.innerHTML = pageLoading('APIs', 'Public HTTP services.');
    try {
      const data = await API.apis.list();
      if (!alive(host, 'plugins')) return;
      vstate.apis.items = data.apis || [];
      paintApis(host);
    } catch (error) { if (alive(host, 'plugins')) pageError(host, 'APIs', error); }
  }

  async function refreshApis(host) {
    try {
      const data = await API.apis.list();
      vstate.apis.items = data.apis || [];
    } catch (error) { UI.toast(error.message, 'error'); }
    if (alive(host, 'plugins')) paintApis(host);
  }

  function apiAuthLabel(item) {
    if (item.auth === 'none') return 'No authentication';
    if (item.auth === 'query') return `Query key · ${item.headerName || 'key'}`;
    if (item.auth === 'header') return `Header · ${item.headerName || 'X-API-Key'}`;
    return 'Bearer token';
  }

  function apiConnectorCard(item) {
    return `<article class="api-card ${item.enabled ? '' : 'disabled'}">
      <div class="plugin-card-head">
        <span class="plugin-icon">${icon('link', 17)}</span>
        <div class="plugin-card-title"><h3>${esc(item.name)}</h3><span class="plugin-cat">${esc(apiAuthLabel(item))}</span></div>
        ${item.enabled ? '' : '<span class="badge">Disabled</span>'}
      </div>
      ${item.description ? `<p class="plugin-tagline">${esc(item.description)}</p>` : ''}
      <div class="api-base">${icon('globe', 11)}<code>${esc(item.baseUrl)}</code></div>
      <div class="api-card-meta">
        <span class="badge ${item.hasKey ? 'green' : ''}">${item.hasKey ? `${icon('key', 9)} ${esc(item.keyPreview)}` : item.auth === 'none' ? 'No credentials' : 'No key saved'}</span>
      </div>
      <div class="plugin-actions">
        <button class="btn btn-secondary btn-sm" type="button" data-api-test="${U.attr(item.id)}">${icon('play', 11)} Test</button>
        <button class="btn btn-secondary btn-sm" type="button" data-api-edit="${U.attr(item.id)}">${icon('settings', 11)} Edit</button>
        <button class="btn btn-ghost btn-sm" type="button" data-api-delete="${U.attr(item.id)}">${icon('trash', 11)} Remove</button>
      </div>
    </article>`;
  }

  function paintApis(host) {
    const items = vstate.apis.items;
    const enabled = items.filter((item) => item.enabled !== false).length;
    host.innerHTML = `<div class="page-inner">
      ${UI.pageHeader({
        title: 'APIs',
        description: 'Public HTTP APIs for api_request.',
        actions: `<button class="btn btn-primary btn-sm" type="button" data-api-add>${icon('plus', 12)} Add connector</button><button class="btn btn-secondary btn-sm" type="button" data-api-refresh>${icon('refresh', 12)} Refresh</button>`,
        meta: items.length ? `<span class="badge blue">${enabled} active</span>` : '',
      })}
      <section class="api-section">
        <div class="api-section-head">
          <div><h2>Saved connectors</h2><p>Keys stay in the main process.</p></div>
          <span class="badge">${items.length}</span>
        </div>
        ${items.length
          ? `<div class="api-grid">${items.map(apiConnectorCard).join('')}</div>`
          : `<div class="api-empty">${icon('link', 16)}<div><h3>No public APIs yet</h3><p>Add a base URL and key for any public service.</p></div><button class="btn btn-secondary btn-sm" type="button" data-api-add>Add connector</button></div>`}
      </section>
    </div>`;

    host.onclick = (event) => {
      if (event.target.closest('[data-api-refresh]')) { vstate.apis.items = []; mountApis(host); return; }
      if (event.target.closest('[data-api-add]')) { openApiEditor(null, host); return; }
      const apiEdit = event.target.closest('[data-api-edit]');
      if (apiEdit) {
        const item = vstate.apis.items.find((entry) => entry.id === apiEdit.dataset.apiEdit);
        if (item) openApiEditor(item, host);
        return;
      }
      const apiDelete = event.target.closest('[data-api-delete]');
      if (apiDelete) {
        const item = vstate.apis.items.find((entry) => entry.id === apiDelete.dataset.apiDelete);
        if (item) removeApi(item, host);
        return;
      }
      const apiTest = event.target.closest('[data-api-test]');
      if (apiTest) {
        const item = vstate.apis.items.find((entry) => entry.id === apiTest.dataset.apiTest);
        if (item) openApiTest(item);
      }
    };
  }

  function openApiEditor(item, host) {
    const editing = Boolean(item);
    const auth = item?.auth || 'bearer';
    const authOptions = [
      ['bearer', 'Bearer token'],
      ['header', 'Custom header'],
      ['query', 'Query parameter'],
      ['none', 'No authentication'],
    ];
    const body = document.createElement('div');
    body.className = 'api-editor';
    body.innerHTML = `
      ${UI.field({ label: 'Name', hint: 'How the agent refers to this connector', id: 'api-name', control: `<input class="field-input" id="api-name" maxlength="60" value="${U.attr(item?.name || '')}" placeholder="Weather API" />` })}
      ${UI.field({ label: 'Description', hint: 'Optional, helps the agent choose the right API', id: 'api-description', control: `<input class="field-input" id="api-description" maxlength="300" value="${U.attr(item?.description || '')}" placeholder="Current weather and forecasts" />` })}
      ${UI.field({ label: 'Base URL', hint: 'Paths are appended to this address', id: 'api-base', control: `<input class="field-input" id="api-base" spellcheck="false" value="${U.attr(item?.baseUrl || '')}" placeholder="https://api.example.com" />` })}
      <div class="field-grid">
        ${UI.field({ label: 'Authentication', id: 'api-auth', control: `<select class="field-select" id="api-auth">${authOptions.map(([value, label]) => `<option value="${value}" ${auth === value ? 'selected' : ''}>${label}</option>`).join('')}</select>` })}
        ${UI.field({ label: 'Header or query name', hint: 'Used by custom header and query auth', id: 'api-header', control: `<input class="field-input" id="api-header" spellcheck="false" value="${U.attr(item?.headerName || '')}" placeholder="X-API-Key" />` })}
      </div>
      ${UI.field({ label: 'API key', hint: item?.hasKey ? `A key is saved (${item.keyPreview}). Leave blank to keep it.` : 'Stored under ~/.blank, never shown again after saving', id: 'api-key', control: `<input class="field-input" id="api-key" type="password" autocomplete="off" spellcheck="false" placeholder="${item?.hasKey ? 'Keep the saved key' : 'Paste a key, or leave blank'}" />` })}
      <div class="api-editor-extra">
        <div><b>Enabled</b><span>The agent may call this connector through api_request.</span></div>
        ${UI.switchHtml(item ? item.enabled !== false : true, 'id="api-enabled"')}
      </div>
      ${item?.hasKey ? `<label class="api-clear-key"><input type="checkbox" id="api-clear-key" /> Remove the saved key</label>` : ''}
      <div class="settings-permission-note">${icon('shield', 12)} Requests follow the API permission and appear in chat as tool calls. Keys stay out of the transcript.</div>`;
    const footer = document.createElement('div');
    footer.className = 'api-editor-foot';
    footer.innerHTML = `<span class="modal-foot-error" data-api-error></span><span class="modal-foot-spacer"></span><button class="btn btn-secondary btn-sm" type="button" data-api-cancel>Cancel</button><button class="btn btn-primary btn-sm" type="button" data-api-save>${editing ? 'Save connector' : 'Add connector'}</button>`;
    const modal = UI.modal({
      title: editing ? `Edit ${item.name}` : 'Add an API connector',
      description: 'The agent calls it through api_request without seeing the key.',
      body,
      footer,
      size: 'wide',
    });

    const authSelect = body.querySelector('#api-auth');
    const headerInput = body.querySelector('#api-header');
    const keyInput = body.querySelector('#api-key');
    const enabledSwitch = body.querySelector('#api-enabled');
    const errorNode = footer.querySelector('[data-api-error]');
    const saveButton = footer.querySelector('[data-api-save]');
    const syncAuth = () => {
      const value = authSelect.value;
      headerInput.disabled = value === 'none' || value === 'bearer';
      keyInput.disabled = value === 'none';
      if (!headerInput.value) headerInput.placeholder = value === 'header' ? 'X-API-Key' : value === 'query' ? 'key' : 'Authorization';
    };
    syncAuth();
    authSelect.addEventListener('change', syncAuth);
    enabledSwitch.addEventListener('click', () => {
      enabledSwitch.classList.toggle('on');
      enabledSwitch.setAttribute('aria-checked', String(enabledSwitch.classList.contains('on')));
    });
    footer.querySelector('[data-api-cancel]').addEventListener('click', () => modal.close());
    saveButton.addEventListener('click', async () => {
      errorNode.textContent = '';
      const payload = {
        ...(editing ? { id: item.id } : {}),
        name: body.querySelector('#api-name').value,
        description: body.querySelector('#api-description').value,
        baseUrl: body.querySelector('#api-base').value,
        auth: authSelect.value,
        headerName: headerInput.value,
        enabled: enabledSwitch.classList.contains('on'),
      };
      const keyValue = keyInput.value.trim();
      if (keyValue) payload.key = keyValue;
      const clearKey = body.querySelector('#api-clear-key');
      if (clearKey?.checked) payload.clearKey = true;
      saveButton.disabled = true;
      try {
        await API.apis.save(payload);
        modal.close();
        UI.toast(editing ? `${payload.name} saved.` : `${payload.name} added.`, 'success');
        refreshApis(host);
      } catch (error) {
        errorNode.textContent = error.message;
        saveButton.disabled = false;
      }
    });
  }

  function openApiTest(item) {
    const body = document.createElement('div');
    body.className = 'api-test';
    body.innerHTML = `
      <div class="api-test-target">${icon('globe', 12)}<code>${esc(item.baseUrl)}</code></div>
      <div class="field-grid">
        ${UI.field({ label: 'Method', id: 'api-test-method', control: `<select class="field-select" id="api-test-method"><option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option><option>HEAD</option></select>` })}
        ${UI.field({ label: 'Path', hint: 'Appended to the base URL, or an absolute URL', id: 'api-test-path', control: `<input class="field-input" id="api-test-path" spellcheck="false" value="/" />` })}
      </div>
      ${UI.field({ label: 'Body', hint: 'Optional JSON or text for POST, PUT and PATCH', id: 'api-test-body', control: `<textarea class="field-textarea" id="api-test-body" spellcheck="false" placeholder='{"example": true}'></textarea>` })}
      <div class="api-test-status" data-api-test-status>Requests run from the main process with the saved credentials.</div>
      <pre class="api-test-output" data-api-test-output hidden></pre>`;
    const footer = document.createElement('div');
    footer.className = 'api-editor-foot';
    footer.innerHTML = `<span class="modal-foot-error" data-api-test-error></span><span class="modal-foot-spacer"></span><button class="btn btn-secondary btn-sm" type="button" data-api-test-close>Close</button><button class="btn btn-primary btn-sm" type="button" data-api-test-run>${icon('play', 11)} Send request</button>`;
    const modal = UI.modal({
      title: `Test ${item.name}`,
      description: 'One request with the saved connector. The key stays hidden.',
      body,
      footer,
      size: 'wide',
    });
    const runButton = footer.querySelector('[data-api-test-run]');
    const errorNode = footer.querySelector('[data-api-test-error]');
    const statusNode = body.querySelector('[data-api-test-status]');
    const outputNode = body.querySelector('[data-api-test-output]');
    footer.querySelector('[data-api-test-close]').addEventListener('click', () => modal.close());
    runButton.addEventListener('click', async () => {
      errorNode.textContent = '';
      const method = body.querySelector('#api-test-method').value;
      const path = body.querySelector('#api-test-path').value.trim() || '/';
      const rawBody = body.querySelector('#api-test-body').value.trim();
      const payload = { id: item.id, method, path };
      if (rawBody && method !== 'GET' && method !== 'HEAD') {
        try { payload.body = JSON.parse(rawBody); } catch { payload.body = rawBody; }
      }
      runButton.disabled = true;
      statusNode.textContent = 'Sending…';
      outputNode.hidden = true;
      try {
        const result = await API.apis.test(payload);
        statusNode.innerHTML = `<span class="badge ${result.ok ? 'green' : 'red'}">${esc(String(result.status))} ${esc(result.statusText || '')}</span><span>${U.fmtNumber(result.durationMs)}ms · ${esc(result.contentType || 'no content type')}</span>${result.truncated ? '<span class="badge amber">Truncated</span>' : ''}`;
        outputNode.textContent = result.body || '(empty response)';
        outputNode.hidden = false;
      } catch (error) {
        statusNode.textContent = 'The request failed.';
        errorNode.textContent = error.message;
      } finally {
        runButton.disabled = false;
      }
    });
  }

  async function removeApi(item, host) {
    const ok = await UI.confirm({
      title: `Remove ${item.name}?`,
      message: 'The connector and its saved key are deleted. The agent can no longer call it.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    try {
      await API.apis.remove(item.id);
      UI.toast(`${item.name} removed.`, 'success');
      refreshApis(host);
    } catch (error) { UI.toast(error.message, 'error'); }
  }

  /* --------------------------------------------------------------- file preview */

  function languageFor(filePath) {
    const ext = String(filePath || '').split('.').pop().toLowerCase();
    const base = U.baseName(String(filePath || '')).toLowerCase();
    if (base === 'dockerfile' || base === 'containerfile') return 'dockerfile';
    if (base === 'makefile' || base === 'gnumakefile') return 'make';
    const map = {
      js: 'js', mjs: 'js', cjs: 'js', jsx: 'js', ts: 'ts', tsx: 'ts', mts: 'ts', cts: 'ts',
      json: 'json', jsonc: 'json', md: 'markdown', mdx: 'markdown',
      py: 'py', pyw: 'py', sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash', bat: 'bash', cmd: 'bash',
      ps1: 'ps1', psm1: 'ps1', css: 'css', scss: 'css', sass: 'css', less: 'css',
      html: 'html', htm: 'html', svg: 'html', xml: 'html', vue: 'html', svelte: 'html', astro: 'html',
      sql: 'sql', go: 'go', rs: 'rs', java: 'java', kt: 'kt', kts: 'kt', swift: 'swift',
      c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', hpp: 'cpp', cxx: 'cpp', cs: 'cs', php: 'php',
      rb: 'rb', lua: 'lua', r: 'r', scala: 'scala', dart: 'dart', ex: 'ex', exs: 'ex',
      erl: 'erl', hs: 'hs', clj: 'clj', pl: 'pl', groovy: 'groovy',
      yml: 'yaml', yaml: 'yaml', toml: 'toml', proto: 'proto', graphql: 'graphql', gql: 'graphql',
      mk: 'make', ini: 'bash', conf: 'bash', cfg: 'bash', env: 'bash', gitignore: 'bash',
    };
    return map[ext] || '';
  }

  async function openFilePreview(filePath) {
    if (!filePath) return;
    const name = U.baseName(filePath);
    const dir = U.dirName(filePath);
    const body = document.createElement('div');
    body.className = 'file-preview-body';
    body.innerHTML = `<div class="file-preview-loading"><span class="spinner"></span></div>`;
    const footer = document.createElement('div');
    footer.className = 'file-preview-foot';
    footer.innerHTML = `<span class="setting-note" data-file-meta>Reading…</span><span style="flex:1"></span>
      <button class="btn btn-secondary btn-sm" type="button" data-file-copy disabled>${icon('copy', 12)} Copy</button>
      <button class="btn btn-secondary btn-sm" type="button" data-file-reveal>${icon('folder-open', 12)} Reveal</button>
      <button class="btn btn-secondary btn-sm" type="button" data-file-open>${icon('external-link', 12)} Open</button>`;
    const modal = UI.modal({
      title: name || 'File',
      description: dir || filePath,
      body,
      footer,
      size: 'wide',
      className: 'file-preview-modal',
    });
    let content = '';
    const copyButton = footer.querySelector('[data-file-copy]');
    const meta = footer.querySelector('[data-file-meta]');
    try {
      const result = await API.workspace.read(filePath);
      content = result?.content || '';
      if (!content) {
        body.innerHTML = `<div class="file-preview-empty">${icon('file', 20)}<p>This file is empty.</p></div>`;
      } else {
        const lines = content.split(/\r?\n/).length;
        const bytes = new TextEncoder().encode(content).length;
        body.innerHTML = `<div class="file-preview-path">${icon('file-code', 12)} ${esc(filePath)}<span class="file-preview-stat">${lines} lines · ${U.fmtBytes(bytes)}</span></div>
          <div class="file-preview-code"><pre><code>${MD.highlight(content, languageFor(filePath))}</code></pre></div>`;
        copyButton.disabled = false;
        if (meta) meta.textContent = `${lines} lines · ${U.fmtBytes(bytes)}`;
      }
    } catch (error) {
      body.innerHTML = `<div class="file-preview-empty">${icon('alert-circle', 20)}<p>${esc(error.message || 'Could not open this file.')}</p></div>`;
      if (meta) meta.textContent = 'Preview unavailable';
    }
    copyButton.addEventListener('click', async () => {
      if (!content) return;
      const copied = await U.copyText(content);
      UI.toast(copied ? 'File copied.' : 'Could not copy the file.', copied ? 'success' : 'error');
    });
    footer.querySelector('[data-file-reveal]')?.addEventListener('click', () => {
      API.workspace.reveal(filePath).catch((error) => UI.toast(error.message, 'error'));
    });
    footer.querySelector('[data-file-open]')?.addEventListener('click', () => {
      API.workspace.openPath(filePath).catch((error) => UI.toast(error.message, 'error'));
    });
    return modal;
  }

  /* ---------------------------------------------------------------------- paper */

  function paperKind(kind) { return PAPER_KIND[kind] || PAPER_KIND.html; }

  function paperWords(content) {
    const text = String(content || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[#>*_`~[\]()!-]+/g, ' ');
    const words = text.match(/[A-Za-z0-9가-힣\u3040-\u30ff\u4e00-\u9fff]+/g) || [];
    return words.length;
  }

  function paperLineCount(content) {
    const text = String(content || '');
    if (!text) return 0;
    return text.split('\n').length;
  }

  function markdownHeadings(content) {
    const headings = [];
    let fenced = false;
    String(content || '').split(/\r?\n/).forEach((line) => {
      if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; return; }
      if (fenced) return;
      const match = line.match(/^(#{1,4})\s+(.+?)\s*#*$/);
      if (match) headings.push({ level: match[1].length, text: match[2].replace(/[*_`~]/g, '') });
    });
    return headings;
  }

  function paperTotal() {
    const counts = vstate.paper.counts || {};
    return (counts.html || 0) + (counts.markdown || 0) + (counts.svg || 0) + (counts.code || 0);
  }

  function recountPapers() {
    const counts = { html: 0, markdown: 0, svg: 0, code: 0, favorite: 0 };
    for (const paper of vstate.paper.items) {
      counts[paper.kind] = (counts[paper.kind] || 0) + 1;
      if (paper.favorite) counts.favorite += 1;
    }
    vstate.paper.counts = counts;
  }

  function applyPaperList(data) {
    vstate.paper.items = Array.isArray(data?.items) ? data.items : [];
    vstate.paper.counts = data?.counts || {};
    vstate.paper.loaded = true;
  }

  async function mountPaper(host) {
    vstate.page = 'paper';
    vstate.host = host;
    if (!vstate.paper.loaded) host.innerHTML = pageLoading('Paper', 'Live pages, documents and graphics.');
    else paintPaper(host);
    try {
      const data = await API.papers.list({ limit: 200 });
      if (!alive(host, 'paper')) return;
      applyPaperList(data);
      paintPaper(host);
    } catch (error) {
      if (!alive(host, 'paper')) return;
      if (!vstate.paper.loaded) pageError(host, 'Paper', error);
      else UI.toast(error.message || 'Could not refresh papers.', 'error');
    }
  }

  function paperFilterMarkup() {
    const counts = vstate.paper.counts || {};
    const favorites = vstate.paper.favorite;
    return `<button class="studio-filter paper-filter ${vstate.paper.filter === 'all' && !favorites ? 'active' : ''}" type="button" data-paper-filter="all">All <span class="count">${paperTotal()}</span></button>
      ${Object.entries(PAPER_KIND).map(([id, meta]) => `<button class="studio-filter paper-filter ${vstate.paper.filter === id && !favorites ? 'active' : ''}" type="button" data-paper-filter="${id}">${icon(meta.icon, 11)} ${meta.label} <span class="count">${counts[id] || 0}</span></button>`).join('')}
      <button class="studio-filter paper-filter fav ${favorites ? 'active' : ''}" type="button" data-paper-favorites>${icon('heart', 11)} Favorites <span class="count">${counts.favorite || 0}</span></button>`;
  }

  function paintPaperFilters(host) {
    const total = host.querySelector('#paper-total');
    if (total) total.textContent = String(paperTotal());
    const wrap = host.querySelector('#paper-filters');
    if (wrap) wrap.innerHTML = paperFilterMarkup();
  }

  function paintPaper(host) {
    host.innerHTML = `<div class="page-inner">
      ${UI.pageHeader({
        title: 'Paper',
        actions: `<button class="btn btn-secondary btn-sm" type="button" data-paper-new>${icon('plus', 12)} New paper</button>`,
        meta: `<span class="badge blue" id="paper-total">${paperTotal()}</span>`,
      })}
      <div class="paper-toolbar">
        <div class="paper-filters" id="paper-filters">${paperFilterMarkup()}</div>
        <span class="paper-toolbar-spacer"></span>
        <label class="search-field paper-search">${icon('search', 12)}<input id="paper-search" type="search" placeholder="Search papers" value="${U.attr(vstate.paper.query)}" spellcheck="false" /></label>
      </div>
      <div class="paper-grid" id="paper-grid"></div>
    </div>`;
    paintPaperGrid(host);
    host.oninput = (event) => {
      if (event.target.id !== 'paper-search') return;
      vstate.paper.query = event.target.value;
      paintPaperGrid(host);
    };
    host.onclick = (event) => {
      if (event.target.closest('[data-paper-new]')) { openPaperComposer(); return; }
      if (event.target.closest('[data-paper-clear]')) {
        vstate.paper.query = '';
        vstate.paper.filter = 'all';
        vstate.paper.favorite = false;
        paintPaper(host);
        return;
      }
      const filter = event.target.closest('[data-paper-filter]');
      if (filter) {
        vstate.paper.filter = filter.dataset.paperFilter;
        vstate.paper.favorite = false;
        paintPaperFilters(host);
        paintPaperGrid(host);
        return;
      }
      if (event.target.closest('[data-paper-favorites]')) {
        vstate.paper.favorite = !vstate.paper.favorite;
        paintPaperFilters(host);
        paintPaperGrid(host);
        return;
      }
      const fav = event.target.closest('[data-paper-fav]');
      if (fav) {
        event.stopPropagation();
        togglePaperFavorite(fav.dataset.paperFav);
        return;
      }
      const card = event.target.closest('[data-paper-id]');
      if (card) { openPaper(card.dataset.paperId); return; }
    };
  }

  function visiblePapers() {
    const query = vstate.paper.query.trim().toLowerCase();
    return vstate.paper.items.filter((paper) => {
      if (vstate.paper.filter !== 'all' && paper.kind !== vstate.paper.filter) return false;
      if (vstate.paper.favorite && !paper.favorite) return false;
      if (!query) return true;
      return `${paper.title} ${paper.excerpt} ${paper.kindLabel} ${paper.language || ''}`.toLowerCase().includes(query);
    });
  }

  function paperSheet(paper) {
    if (paper.kind === 'code') {
      return `<div class="paper-facsimile code"><pre>${esc((paper.excerpt || '// Empty paper').slice(0, 170))}</pre></div>`;
    }
    if (paper.kind === 'svg') {
      return `<div class="paper-facsimile art"><span class="pa-ring"></span><span class="pa-bar a"></span><span class="pa-bar b"></span><span class="pa-dot"></span></div>`;
    }
    if (paper.kind === 'markdown') {
      return `<div class="paper-facsimile doc"><span class="pd-heading"></span><span class="pd-line w90"></span><span class="pd-line w76"></span><span class="pd-line w84"></span><span class="pd-gap"></span><span class="pd-line w64"></span><span class="pd-line w88"></span><span class="pd-line w52"></span></div>`;
    }
    return `<div class="paper-facsimile page"><span class="pp-chrome"><i></i><i></i><i></i></span><span class="pp-hero"></span><span class="pp-line w78"></span><span class="pp-line w88"></span><span class="pp-line w56"></span></div>`;
  }

  function paperCard(paper) {
    const meta = paperKind(paper.kind);
    return `<div class="paper-card-wrap">
      <button class="paper-card" type="button" data-paper-id="${U.attr(paper.id)}" aria-labelledby="paper-title-${U.attr(paper.id)}">
        <div class="paper-card-sheet" data-kind="${U.attr(paper.kind)}">
          ${paperSheet(paper)}
          <span class="paper-kind-badge">${icon(meta.icon, 9)} ${meta.label}</span>
        </div>
        <div class="paper-card-body">
          <div class="paper-card-title" id="paper-title-${U.attr(paper.id)}">${esc(paper.title)}</div>
          <div class="paper-card-excerpt">${esc(paper.excerpt || 'No preview text')}</div>
          <div class="paper-card-meta">
            <span class="paper-version">v${paper.version}</span><span class="sep"></span>
            <span>${esc(U.relativeTime(paper.updatedAt))}</span>
            <span class="paper-size">${U.fmtBytes(paper.bytes)}</span>
          </div>
        </div>
      </button>
      <button class="paper-fav ${paper.favorite ? 'on' : ''}" type="button" data-paper-fav="${U.attr(paper.id)}" title="${paper.favorite ? 'Remove from favorites' : 'Add to favorites'}" aria-label="${paper.favorite ? 'Remove from favorites' : 'Add to favorites'}" aria-pressed="${paper.favorite ? 'true' : 'false'}">${icon('heart', 12)}</button>
    </div>`;
  }

  function paintPaperGrid(host) {
    const grid = host.querySelector('#paper-grid');
    if (!grid) return;
    const items = visiblePapers();
    if (!items.length) {
      const empty = vstate.paper.items.length
        ? `<div class="paper-empty">${UI.emptyState({
            iconName: 'search',
            title: 'Nothing matches',
            description: 'Try another kind, clear the favorites filter or search for something else.',
            actionHtml: `<button class="btn btn-secondary btn-sm" type="button" data-paper-clear>${icon('refresh', 12)} Clear filters</button>`,
          })}</div>`
        : `<div class="paper-empty">${UI.emptyState({
            iconName: 'book',
            title: 'No papers yet',
            description: 'Ask the agent for a page, report, diagram or document. Everything it makes lands here.',
            actionHtml: `<button class="btn btn-primary btn-sm" type="button" data-paper-new>${icon('plus', 12)} New paper</button>`,
          })}</div>`;
      grid.innerHTML = empty;
      return;
    }
    grid.innerHTML = items.map((paper) => paperCard(paper)).join('');
  }

  async function refreshPapers(host) {
    try {
      const data = await API.papers.list({ limit: 200 });
      applyPaperList(data);
      if (vstate.page === 'paper') {
        const target = host || vstate.host;
        paintPaperFilters(target);
        paintPaperGrid(target);
      }
    } catch {}
  }

  async function togglePaperFavorite(id) {
    if (!id) return;
    try {
      const updated = await API.papers.favorite(id);
      const index = vstate.paper.items.findIndex((paper) => paper.id === id);
      if (index >= 0 && updated) vstate.paper.items[index] = { ...vstate.paper.items[index], ...updated };
      recountPapers();
      if (vstate.page === 'paper' && vstate.host) {
        paintPaperFilters(vstate.host);
        paintPaperGrid(vstate.host);
      }
    } catch (error) { UI.toast(error.message || 'Could not update this paper.', 'error'); }
  }

  const schedulePaperRefresh = U.debounce(() => {
    if (vstate.page !== 'paper' || !vstate.host) return;
    refreshPapers(vstate.host);
  }, 200);

  function handlePaperEvent(event) {
    if (!event || typeof event.type !== 'string' || !event.type.startsWith('paper:')) return;
    if (event.type === 'paper:changed' || event.type === 'paper:removed') schedulePaperRefresh();
  }

  function openPaperComposer(options = {}) {
    let paper = options.paper || null;
    let content = typeof options.content === 'string' ? options.content : '';
    const startKind = paper?.kind || options.kind || 'html';
    let currentKind = startKind;
    let busy = false;
    let previewOn = startKind === 'markdown' && window.innerWidth >= 900;
    let previewTimer = 0;

    const body = document.createElement('div');
    body.className = 'paper-compose';
    body.innerHTML = `
      <div class="paper-compose-top">
        <label class="field paper-compose-title"><span class="field-label">Title</span><input class="field-input" id="paper-title" type="text" maxlength="120" placeholder="A name for this paper" value="${U.attr(paper?.title || '')}" spellcheck="false" /></label>
        ${paper
          ? `<div class="paper-compose-kind"><span class="field-label">Kind</span><span class="paper-compose-kindchip">${icon(paperKind(currentKind).icon, 12)} ${esc(paperKind(currentKind).label)}</span></div>`
          : `<label class="field paper-compose-kind"><span class="field-label">Kind</span><select class="field-select" id="paper-kind">${Object.entries(PAPER_KIND).map(([id, meta]) => `<option value="${id}" ${currentKind === id ? 'selected' : ''}>${meta.label}</option>`).join('')}</select></label>`}
      </div>
      <div class="field paper-compose-body">
        <label class="field-label" for="paper-content">Content <small>${paper ? 'changes raise the version' : 'under 2 MB'}</small></label>
        <div class="paper-md-tools" data-md-tools ${currentKind === 'markdown' ? '' : 'hidden'}>
          <button class="paper-md-tool" type="button" data-md-action="heading" title="Heading" aria-label="Heading">${icon('type', 13)}</button>
          <button class="paper-md-tool" type="button" data-md-action="bold" title="Bold" aria-label="Bold">${icon('bold', 13)}</button>
          <button class="paper-md-tool" type="button" data-md-action="italic" title="Italic" aria-label="Italic">${icon('italic', 13)}</button>
          <button class="paper-md-tool" type="button" data-md-action="list" title="Bulleted list" aria-label="Bulleted list">${icon('list', 13)}</button>
          <button class="paper-md-tool" type="button" data-md-action="quote" title="Quote" aria-label="Quote">${icon('quote', 13)}</button>
          <button class="paper-md-tool" type="button" data-md-action="code" title="Inline code" aria-label="Inline code">${icon('code', 13)}</button>
          <button class="paper-md-tool" type="button" data-md-action="link" title="Link" aria-label="Link">${icon('link', 13)}</button>
          <span class="paper-md-tools-spacer"></span>
          <button class="paper-md-preview ${previewOn ? 'active' : ''}" type="button" data-md-preview aria-pressed="${previewOn ? 'true' : 'false'}">${icon('eye', 13)}<span>Preview</span></button>
        </div>
        <div class="paper-compose-workspace ${previewOn && currentKind === 'markdown' ? 'split' : ''}" data-md-workspace>
          <textarea class="field-textarea paper-content-input" id="paper-content" spellcheck="false" placeholder="${U.attr(PAPER_PLACEHOLDERS[currentKind])}">${esc(content)}</textarea>
          <div class="paper-compose-preview md" data-md-preview-pane ${previewOn && currentKind === 'markdown' ? '' : 'hidden'}></div>
        </div>
      </div>
      ${paper?.kind === 'code' ? `<label class="field paper-compose-language"><span class="field-label">Language <small>optional</small></span><input class="field-input" id="paper-language" type="text" maxlength="24" placeholder="js, py, sh…" value="${U.attr(paper.language || '')}" spellcheck="false" /></label>` : paper ? '' : `<label class="field paper-compose-language" data-paper-language ${currentKind === 'code' ? '' : 'hidden'}><span class="field-label">Language <small>optional</small></span><input class="field-input" id="paper-language" type="text" maxlength="24" placeholder="js, py, sh…" spellcheck="false" /></label>`}
    `;

    const footer = document.createElement('div');
    footer.className = 'paper-compose-foot';
    footer.innerHTML = `<span class="paper-compose-note">${icon('lock', 11)} Sandboxed preview</span><span style="flex:1"></span>
      <button class="btn btn-secondary btn-sm" type="button" data-modal-close>Cancel</button>
      <button class="btn btn-primary btn-sm" type="button" data-paper-save>${paper ? 'Save changes' : 'Create paper'}</button>`;

    const handle = UI.modal({
      title: paper ? 'Edit paper' : 'New paper',
      description: paper ? 'Changes are saved as a new version.' : 'Pages and documents stay local in your Paper library.',
      body,
      footer,
      size: 'wide',
      className: 'paper-compose-modal',
      onClose: () => { if (options.onClose) options.onClose(); },
    });

    const titleInput = body.querySelector('#paper-title');
    const contentInput = body.querySelector('#paper-content');
    const languageInput = () => body.querySelector('#paper-language');
    const kindSelect = body.querySelector('#paper-kind');
    const saveButton = footer.querySelector('[data-paper-save]');
    const tools = body.querySelector('[data-md-tools]');
    const workspace = body.querySelector('[data-md-workspace]');
    const previewPane = body.querySelector('[data-md-preview-pane]');
    const previewButton = body.querySelector('[data-md-preview]');

    function renderPreview() {
      if (!previewPane || currentKind !== 'markdown') return;
      previewPane.innerHTML = MD.render(contentInput.value);
    }

    function schedulePreview() {
      if (!previewOn || currentKind !== 'markdown') return;
      clearTimeout(previewTimer);
      previewTimer = setTimeout(renderPreview, 80);
    }

    function syncEditorMode() {
      const markdown = currentKind === 'markdown';
      if (!markdown) previewOn = false;
      if (tools) tools.hidden = !markdown;
      if (previewButton) {
        previewButton.classList.toggle('active', markdown && previewOn);
        previewButton.setAttribute('aria-pressed', markdown && previewOn ? 'true' : 'false');
      }
      if (workspace) workspace.classList.toggle('split', markdown && previewOn);
      if (previewPane) previewPane.hidden = !(markdown && previewOn);
      if (markdown && previewOn) renderPreview();
    }

    function wrapSelection(before, after, placeholder) {
      const start = contentInput.selectionStart;
      const end = contentInput.selectionEnd;
      const value = contentInput.value;
      const picked = value.slice(start, end) || placeholder;
      contentInput.value = `${value.slice(0, start)}${before}${picked}${after}${value.slice(end)}`;
      const from = start + before.length;
      contentInput.setSelectionRange(from, from + picked.length);
      contentInput.focus();
      schedulePreview();
    }

    function toggleLinePrefix(prefix) {
      const start = contentInput.selectionStart;
      const end = contentInput.selectionEnd;
      const value = contentInput.value;
      const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
      let lineEnd = value.indexOf('\n', end);
      if (lineEnd < 0) lineEnd = value.length;
      const lines = value.slice(lineStart, lineEnd).split('\n');
      if (lines.length === 1 && !lines[0].trim()) {
        contentInput.value = `${value.slice(0, lineStart)}${prefix}${value.slice(lineEnd)}`;
        contentInput.setSelectionRange(lineStart + prefix.length, lineStart + prefix.length);
        contentInput.focus();
        schedulePreview();
        return;
      }
      const active = lines.every((line) => !line.trim() || line.startsWith(prefix));
      const next = lines.map((line) => {
        if (!line.trim()) return line;
        return active ? line.slice(prefix.length) : `${prefix}${line}`;
      }).join('\n');
      contentInput.value = `${value.slice(0, lineStart)}${next}${value.slice(lineEnd)}`;
      contentInput.setSelectionRange(lineStart, lineStart + next.length);
      contentInput.focus();
      schedulePreview();
    }

    function toggleHeading() {
      const start = contentInput.selectionStart;
      const end = contentInput.selectionEnd;
      const value = contentInput.value;
      const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
      let lineEnd = value.indexOf('\n', end);
      if (lineEnd < 0) lineEnd = value.length;
      const lines = value.slice(lineStart, lineEnd).split('\n');
      if (lines.length === 1 && !lines[0].trim()) {
        contentInput.value = `${value.slice(0, lineStart)}## ${value.slice(lineEnd)}`;
        contentInput.setSelectionRange(lineStart + 3, lineStart + 3);
        contentInput.focus();
        schedulePreview();
        return;
      }
      const active = lines.every((line) => !line.trim() || /^#{1,4}\s+/.test(line));
      const next = lines.map((line) => {
        if (!line.trim()) return line;
        const bare = line.replace(/^#{1,4}\s+/, '');
        return active ? bare : `## ${bare}`;
      }).join('\n');
      contentInput.value = `${value.slice(0, lineStart)}${next}${value.slice(lineEnd)}`;
      contentInput.setSelectionRange(lineStart, lineStart + next.length);
      contentInput.focus();
      schedulePreview();
    }

    function insertLink() {
      const start = contentInput.selectionStart;
      const end = contentInput.selectionEnd;
      const value = contentInput.value;
      const label = value.slice(start, end) || 'Link text';
      const url = 'https://';
      const insertion = `[${label}](${url})`;
      contentInput.value = `${value.slice(0, start)}${insertion}${value.slice(end)}`;
      const urlStart = start + label.length + 3;
      contentInput.setSelectionRange(urlStart, urlStart + url.length);
      contentInput.focus();
      schedulePreview();
    }

    tools?.addEventListener('click', (event) => {
      if (event.target.closest('[data-md-preview]')) {
        previewOn = !previewOn;
        syncEditorMode();
        contentInput.focus();
        return;
      }
      const button = event.target.closest('[data-md-action]');
      if (!button) return;
      const action = button.dataset.mdAction;
      if (action === 'heading') toggleHeading();
      else if (action === 'bold') wrapSelection('**', '**', 'bold text');
      else if (action === 'italic') wrapSelection('*', '*', 'italic text');
      else if (action === 'list') toggleLinePrefix('- ');
      else if (action === 'quote') toggleLinePrefix('> ');
      else if (action === 'code') wrapSelection('`', '`', 'code');
      else if (action === 'link') insertLink();
    });

    contentInput.addEventListener('input', schedulePreview);

    kindSelect?.addEventListener('change', () => {
      const next = kindSelect.value;
      if (!PAPER_KIND[next]) return;
      const previous = currentKind;
      currentKind = next;
      if (!contentInput.value.trim() || contentInput.value === PAPER_TEMPLATES[previous]) {
        contentInput.value = PAPER_TEMPLATES[next] || '';
      }
      contentInput.placeholder = PAPER_PLACEHOLDERS[next];
      const languageField = body.querySelector('[data-paper-language]');
      if (languageField) languageField.hidden = next !== 'code';
      if (next === 'markdown' && previewOn === false && window.innerWidth >= 900) previewOn = true;
      syncEditorMode();
    });

    syncEditorMode();

    async function save() {
      if (busy) return;
      const title = titleInput.value.trim();
      const text = contentInput.value;
      if (!text.trim()) {
        UI.toast('Write some content first.', 'warn');
        contentInput.focus();
        return;
      }
      const language = languageInput()?.value.trim() || '';
      busy = true;
      saveButton.disabled = true;
      const original = saveButton.innerHTML;
      saveButton.innerHTML = `<span class="spinner" style="width:11px;height:11px;border-color:rgba(255,255,255,.4);border-top-color:#fff"></span> Saving…`;
      try {
        const saved = paper
          ? await API.papers.update({ id: paper.id, title, content: text, language })
          : await API.papers.create({ title: title || undefined, kind: currentKind, content: text, language });
        busy = false;
        handle.close();
        await refreshPapers();
        UI.toast(paper ? 'Paper updated.' : 'Paper created.', 'success');
        if (options.onSaved) options.onSaved(saved, text);
        else openPaper(saved.id);
      } catch (error) {
        busy = false;
        saveButton.disabled = false;
        saveButton.innerHTML = original;
        UI.toast(error.message || 'Could not save this paper.', 'error', { timeout: 7000 });
      }
    }

    saveButton.addEventListener('click', save);
    contentInput.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        save();
        return;
      }
      if (currentKind !== 'markdown') return;
      if (event.key === 'Tab') {
        event.preventDefault();
        const start = contentInput.selectionStart;
        contentInput.setRangeText('  ', start, contentInput.selectionEnd, 'end');
        schedulePreview();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        wrapSelection('**', '**', 'bold text');
      } else if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'i') {
        event.preventDefault();
        wrapSelection('*', '*', 'italic text');
      }
    });
    setTimeout(() => { titleInput.focus(); }, 60);
  }

  async function openPaper(id) {
    if (!id) return;
    let paper = null;
    let content = '';
    try {
      const result = await API.papers.get(id);
      if (result && result.paper) { paper = result.paper; content = String(result.content || ''); } else if (result && result.id) { paper = result; content = String(result.content || ''); }
    } catch (error) {
      UI.toast(error.message || 'Could not open this paper.', 'error');
      return;
    }
    if (!paper) { UI.toast('That paper is no longer in the library.', 'warn'); return; }
    let tab = 'preview';
    let device = 'desktop';
    let outlineOpen = true;

    const body = document.createElement('div');
    body.className = 'paper-viewer';

    function metaLabel() { return `${paperKind(paper.kind).label} · v${paper.version}`; }

    function stageMarkup() {
      const hasOutline = paper.kind === 'markdown' && markdownHeadings(content).length > 1;
      const words = paper.kind === 'markdown' ? paperWords(content) : 0;
      const lines = paper.kind === 'code' ? paperLineCount(content) : 0;
      return `<div class="paper-viewer-bar">
        <div class="paper-tabs" role="tablist">
          <button class="paper-tab ${tab === 'preview' ? 'active' : ''}" type="button" role="tab" data-paper-tab="preview">${icon('eye', 12)} Preview</button>
          <button class="paper-tab ${tab === 'code' ? 'active' : ''}" type="button" role="tab" data-paper-tab="code">${icon('code', 12)} Code</button>
        </div>
        ${hasOutline && tab === 'preview' ? `<button class="paper-outline-toggle ${outlineOpen ? 'active' : ''}" type="button" data-paper-outline aria-pressed="${outlineOpen ? 'true' : 'false'}" title="Contents">${icon('list', 12)} Contents</button>` : ''}
        <div class="paper-devices" ${paper.kind === 'html' && tab === 'preview' ? '' : 'hidden'}>
          <button class="paper-device ${device === 'desktop' ? 'active' : ''}" type="button" data-paper-device="desktop" title="Desktop">${icon('monitor', 13)}</button>
          <button class="paper-device ${device === 'tablet' ? 'active' : ''}" type="button" data-paper-device="tablet" title="Tablet">${icon('tablet', 13)}</button>
          <button class="paper-device ${device === 'phone' ? 'active' : ''}" type="button" data-paper-device="phone" title="Phone">${icon('smartphone', 13)}</button>
        </div>
        <span class="paper-bar-spacer"></span>
        <div class="paper-viewer-actions">
          <button class="mini-icon ${paper.favorite ? 'fav-on' : ''}" type="button" data-paper-action="favorite" title="${paper.favorite ? 'Remove from favorites' : 'Add to favorites'}">${icon('heart', 13)}</button>
          <button class="mini-icon" type="button" data-paper-action="history" title="Version history">${icon('history', 13)}</button>
          <button class="mini-icon" type="button" data-paper-action="copy" title="Copy content">${icon('copy', 13)}</button>
          <button class="mini-icon" type="button" data-paper-action="export" title="Export">${icon('download', 13)}</button>
          <button class="mini-icon" type="button" data-paper-action="reveal" title="Show file">${icon('folder-open', 13)}</button>
          <button class="mini-icon" type="button" data-paper-action="edit" title="Edit">${icon('edit', 13)}</button>
          <span class="paper-bar-sep"></span>
          <button class="mini-icon danger" type="button" data-paper-action="delete" title="Delete">${icon('trash', 13)}</button>
        </div>
      </div>
      <div class="paper-stage" data-paper-stage data-kind="${U.attr(paper.kind)}" data-device="${paper.kind === 'html' ? device : 'fluid'}"></div>
      <div class="paper-viewer-foot">
        <span>${esc(paperKind(paper.kind).label)}</span><span class="sep"></span><span>v${paper.version}</span><span class="sep"></span><span>${U.fmtBytes(paper.bytes)}</span>
        ${paper.kind === 'markdown' ? `<span class="sep"></span><span>${words} words</span><span class="sep"></span><span>${Math.max(1, Math.ceil(words / 220))} min read</span>` : ''}
        ${paper.kind === 'code' ? `<span class="sep"></span><span>${lines} lines</span>` : ''}
        <span class="paper-foot-note">${esc(paper.source === 'agent' ? 'Made by the agent' : 'Made by you')}</span>
      </div>`;
    }

    function paintStage() {
      const stage = body.querySelector('[data-paper-stage]');
      if (!stage) return;
      if (tab === 'code' || paper.kind === 'code') {
        stage.innerHTML = `<div class="paper-code"><pre><code>${MD.highlight(content, paper.language || languageFor(paper.title))}</code></pre></div>`;
        return;
      }
      if (paper.kind === 'markdown') {
        stage.innerHTML = `<div class="paper-doc-layout">
          ${outlineOpen ? '<aside class="paper-outline" data-paper-outline-rail></aside>' : ''}
          <article class="paper-doc md">${MD.render(content)}</article>
        </div>`;
        const rail = stage.querySelector('[data-paper-outline-rail]');
        const article = stage.querySelector('.paper-doc');
        if (rail && article) {
          const headings = [...article.querySelectorAll('h3, h4, h5, h6')];
          if (headings.length > 1) {
            headings.forEach((heading, index) => { heading.id = `paper-heading-${index + 1}`; });
            rail.innerHTML = `<div class="paper-outline-title">Contents</div>${headings.map((heading, index) => (
              `<button class="paper-outline-link depth-${Number(heading.tagName.slice(1)) - 3}" type="button" data-outline-target="paper-heading-${index + 1}">${esc(heading.textContent)}</button>`
            )).join('')}`;
          } else {
            rail.remove();
          }
        }
        return;
      }
      const frame = document.createElement('iframe');
      frame.className = 'paper-frame';
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.setAttribute('referrerpolicy', 'no-referrer');
      frame.setAttribute('title', paper.title || 'Paper preview');
      if (paper.previewUrl) frame.src = paper.previewUrl;
      else frame.srcdoc = content;
      stage.innerHTML = '';
      stage.append(frame);
    }

    function paintViewer() {
      body.innerHTML = stageMarkup();
      paintStage();
    }

    paintViewer();
    const handle = UI.modal({
      title: paper.title,
      description: metaLabel(),
      body,
      size: 'large',
      className: 'paper-modal',
    });

    function updateHead() {
      const titleNode = handle.element.querySelector('.modal-head h2');
      const descNode = handle.element.querySelector('.modal-head p');
      if (titleNode) titleNode.textContent = paper.title;
      if (descNode) descNode.textContent = metaLabel();
    }

    async function openHistory() {
      let data;
      try {
        data = await API.papers.versions(paper.id);
      } catch (error) {
        UI.toast(error.message || 'Could not load version history.', 'error');
        return;
      }
      const versions = Array.isArray(data?.versions) ? data.versions : [];
      const list = document.createElement('div');
      list.className = 'paper-history';
      list.innerHTML = versions.map((version) => `<article class="paper-history-row ${version.current ? 'current' : ''}">
        <div class="paper-history-head">
          <span class="paper-history-version">v${version.version}</span>
          ${version.current ? '<span class="paper-history-current">Current</span>' : ''}
          <span class="paper-history-time">${esc(U.relativeTime(version.savedAt))} · ${esc(U.fmtBytes(version.bytes))}</span>
        </div>
        <p class="paper-history-excerpt">${esc(version.excerpt || 'No preview text')}</p>
        ${version.current ? '' : `<button class="btn btn-secondary btn-xs" type="button" data-paper-restore="${version.version}">Restore</button>`}
      </article>`).join('') + (versions.length <= 1
        ? '<p class="paper-history-note">Edits will appear here after you save a change.</p>'
        : '');
      const historyHandle = UI.modal({
        title: 'Version history',
        description: 'Saved content versions for this paper.',
        body: list,
        size: 'wide',
        className: 'paper-history-modal',
      });
      list.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-paper-restore]');
        if (!button) return;
        const version = Number(button.dataset.paperRestore);
        try {
          const snapshot = await API.papers.version(paper.id, version);
          if (String(snapshot?.content ?? '') === String(content)) {
            UI.toast('This version matches the current content.', 'info');
            return;
          }
        } catch { /* the restore call below reports the real error */ }
        const confirmed = await UI.confirm({
          title: `Restore version ${version}?`,
          message: `Version ${version} will replace the current content.`,
          detail: 'The current content is saved to version history. Only the content changes. The title and description stay as they are.',
          confirmLabel: 'Restore',
        });
        if (!confirmed) return;
        button.disabled = true;
        try {
          const updated = await API.papers.restore(paper.id, version);
          const fresh = await API.papers.get(paper.id);
          paper = { ...paper, ...updated };
          content = String(fresh?.content || '');
          updateHead();
          paintViewer();
          await refreshPapers();
          historyHandle.close();
          UI.toast(`Restored version ${version}.`, 'success');
        } catch (error) {
          button.disabled = false;
          UI.toast(error.message || 'Could not restore this version.', 'error');
        }
      });
    }

    body.addEventListener('click', async (event) => {
      const tabButton = event.target.closest('[data-paper-tab]');
      if (tabButton) {
        tab = tabButton.dataset.paperTab === 'code' ? 'code' : 'preview';
        paintViewer();
        return;
      }
      if (event.target.closest('[data-paper-outline]')) {
        outlineOpen = !outlineOpen;
        paintViewer();
        return;
      }
      const outlineLink = event.target.closest('[data-outline-target]');
      if (outlineLink) {
        const heading = body.querySelector(`#${outlineLink.dataset.outlineTarget}`);
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        if (heading) heading.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
        return;
      }
      const deviceButton = event.target.closest('[data-paper-device]');
      if (deviceButton) {
        device = deviceButton.dataset.paperDevice;
        body.querySelectorAll('[data-paper-device]').forEach((button) => button.classList.toggle('active', button === deviceButton));
        body.querySelector('[data-paper-stage]')?.setAttribute('data-device', device);
        return;
      }
      const action = event.target.closest('[data-paper-action]');
      if (!action) return;
      const name = action.dataset.paperAction;
      if (name === 'favorite') {
        try {
          const updated = await API.papers.favorite(paper.id);
          paper = { ...paper, ...updated };
          action.classList.toggle('fav-on', paper.favorite);
          action.title = paper.favorite ? 'Remove from favorites' : 'Add to favorites';
          refreshPapers();
        } catch (error) { UI.toast(error.message, 'error'); }
        return;
      }
      if (name === 'history') {
        await openHistory();
        return;
      }
      if (name === 'copy') {
        const copied = await U.copyText(content);
        UI.toast(copied ? 'Paper copied.' : 'Could not copy this paper.', copied ? 'success' : 'error');
        return;
      }
      if (name === 'export') {
        action.disabled = true;
        try {
          const result = await API.papers.export(paper.id);
          if (result && !result.canceled) UI.toast(`Exported to ${result.path}`, 'success', { title: 'Paper', timeout: 7000 });
        } catch (error) { UI.toast(error.message, 'error'); }
        finally { action.disabled = false; }
        return;
      }
      if (name === 'reveal') {
        API.papers.reveal(paper.id).catch((error) => UI.toast(error.message, 'error'));
        return;
      }
      if (name === 'edit') {
        openPaperComposer({
          paper,
          content,
          onSaved: (updated, nextContent) => {
            paper = updated;
            content = nextContent;
            updateHead();
            paintViewer();
            refreshPapers();
          },
        });
        return;
      }
      if (name === 'delete') {
        const confirmed = await UI.confirm({
          title: 'Delete this paper?',
          message: `“${paper.title}” will be removed from the Paper library.`,
          detail: 'Export it first if you want to keep a copy. This cannot be undone.',
          confirmLabel: 'Delete',
          danger: true,
        });
        if (!confirmed) return;
        try {
          await API.papers.remove(paper.id);
          handle.close();
          await refreshPapers();
          UI.toast('Paper deleted.', 'success');
        } catch (error) { UI.toast(error.message, 'error'); }
      }
    });
  }

  /* --------------------------------------------------------------- media events */

  const scheduleStudioRefresh = U.debounce(async () => {
    if (vstate.page !== 'studio' || !vstate.host) return;
    await refreshJobs(vstate.host);
    await refreshLibrary(vstate.host);
  }, 220);

  function handleMediaEvent(event) {
    if (!event || typeof event.type !== 'string' || !event.type.startsWith('media:')) return;
    if (event.type === 'media:job' && event.job) {
      const job = event.job;
      const index = vstate.media.jobs.findIndex((item) => item.id === job.id);
      if (index >= 0) vstate.media.jobs[index] = job;
      else vstate.media.jobs.unshift(job);
      if (vstate.media.jobs.length > 40) vstate.media.jobs.length = 40;
      if (vstate.page === 'studio' && vstate.host) paintJobs(vstate.host);
      if (['done', 'error', 'cancelled'].includes(job.status)) {
        handleJobFinished(job);
        scheduleStudioRefresh();
        syncMediaBadge();
      }
      return;
    }
    if (event.type === 'media:asset' && event.asset) {
      const asset = event.asset;
      const index = vstate.media.assets.findIndex((item) => item.id === asset.id);
      if (index >= 0) vstate.media.assets[index] = asset;
      else if (vstate.media.loaded) vstate.media.assets.unshift(asset);
      if (vstate.page === 'studio' && vstate.host) paintLibrary(vstate.host);
      scheduleStudioRefresh();
      syncMediaBadge();
      return;
    }
    if (event.type === 'media:removed' && event.id) {
      vstate.media.assets = vstate.media.assets.filter((item) => item.id !== event.id);
      if (vstate.page === 'studio' && vstate.host) {
        paintLibrary(vstate.host);
        paintFilters(vstate.host);
      }
      scheduleStudioRefresh();
      syncMediaBadge();
    }
  }

  function activateChat() {
    const inline = vstate.media.inline;
    if (inline && inline.host.isConnected) {
      vstate.page = 'studio';
      vstate.host = inline.host;
    } else {
      vstate.page = 'chat';
      vstate.host = null;
    }
  }

  function mediaCount() {
    if (!vstate.media.loaded) return null;
    const counts = vstate.media.storage?.counts || vstate.media.counts || {};
    return Object.values(counts).reduce((sum, value) => sum + (Number(value) || 0), 0);
  }

  /* -------------------------------------------------------------------- routing */

  function openStudio(options = {}) {
    const kind = Object.prototype.hasOwnProperty.call(KIND, options.kind) ? options.kind : vstate.media.compose.kind;
    vstate.media.pending = {
      kind,
      prompt: typeof options.prompt === 'string' ? options.prompt : null,
      engine: typeof options.engine === 'string' ? options.engine : '',
      voice: typeof options.voice === 'string' ? options.voice : '',
    };
    const activePage = document.querySelector('[data-page].active')?.dataset.page || 'chat';
    const underlying = { page: activePage, host: activePage === 'chat' ? null : vstate.host };
    const host = document.createElement('div');
    host.className = 'studio-embed';

    const onChat = (document.querySelector('[data-page].active')?.dataset.page || 'chat') === 'chat';
    const inline = options.container || (onChat ? document.getElementById('chat-media-panel') : null);
    if (inline) {
      if (vstate.media.inline) closeStudio({ silent: true });
      inline.hidden = false;
      inline.classList.add('is-open');
      document.getElementById('chat-shell')?.classList.add('media-open');
      const trigger = document.querySelector('.composer-tool[data-action="open-media"]');
      if (trigger) trigger.classList.add('active');
      inline.innerHTML = `
        <div class="chat-media-head">
          <div class="chat-media-title">${icon('wand', 14)}<span>Create media</span></div>
          <div class="chat-media-actions">
            <button class="btn btn-secondary btn-xs" type="button" data-studio-engines>${icon('sliders', 12)} Engines</button>
            <button class="btn btn-secondary btn-xs" type="button" data-studio-import>${icon('upload', 12)} Import</button>
            <button class="icon-btn" type="button" data-studio-close title="Close media" aria-label="Close media">${icon('x', 13)}</button>
          </div>
        </div>`;
      host.innerHTML = pageLoading('Create media', 'Generate images, video, audio and 3D here in the chat.');
      inline.appendChild(host);
      inline.querySelector('[data-studio-engines]')?.addEventListener('click', () => {
        openMediaEngines(() => { if (host.isConnected) mountStudio(host); });
      });
      inline.querySelector('[data-studio-import]')?.addEventListener('click', () => importMedia(host));
      inline.querySelector('[data-studio-close]')?.addEventListener('click', () => closeStudio());
      vstate.media.embedded = true;
      vstate.media.inline = { container: inline, host, underlying };
      mountStudio(host);
      return;
    }

    host.innerHTML = pageLoading('Create media', 'Generate and edit images, video, audio and 3D.');
    vstate.media.embedded = true;
    UI.modal({
      title: 'Create media',
      description: 'Generate and edit media without leaving the chat.',
      size: 'wide',
      className: 'studio-modal',
      headerExtra: `<button class="btn btn-secondary btn-sm" type="button" data-studio-engines>${icon('sliders', 12)} Engines</button>
        <button class="btn btn-secondary btn-sm" type="button" data-studio-import>${icon('upload', 12)} Import</button>`,
      body: host,
      onMount(node) {
        node.querySelector('[data-studio-engines]')?.addEventListener('click', () => {
          openMediaEngines(() => { if (host.isConnected) mountStudio(host); });
        });
        node.querySelector('[data-studio-import]')?.addEventListener('click', () => importMedia(host));
      },
      onClose: () => {
        vstate.media.embedded = false;
        if (vstate.page === 'studio' && vstate.host === host) {
          vstate.page = underlying.page;
          vstate.host = underlying.host;
        }
      },
    });
    mountStudio(host);
  }

  function closeStudio(options = {}) {
    const inline = vstate.media.inline;
    if (!inline) return;
    if (vstate.host === inline.host) {
      vstate.page = inline.underlying.page;
      vstate.host = inline.underlying.host;
    }
    inline.host.remove();
    inline.container.innerHTML = '';
    inline.container.hidden = true;
    inline.container.classList.remove('is-open');
    document.getElementById('chat-shell')?.classList.remove('media-open');
    document.querySelector('.composer-tool[data-action="open-media"]')?.classList.remove('active');
    vstate.media.inline = null;
    vstate.media.embedded = false;
    if (!options.silent) window.ChatView?.focusComposer?.();
  }

  function render(page, host) {
    if (!host) return;
    vstate.page = page;
    vstate.host = host;
    host.onclick = null;
    host.onchange = null;
    host.oninput = null;
    if (page === 'models') { mountModels(host); return; }
    if (page === 'skills') { mountSkills(host); return; }
    if (page === 'memory') { mountMemory(host); return; }
    if (page === 'mcp') { mountMcp(host); return; }
    if (page === 'plugins') { mountApis(host); return; }
    if (page === 'learning') { mountLearning(host); return; }
    if (page === 'settings') { mountSettings(host); return; }
    if (page === 'paper') { mountPaper(host); return; }
    if (page === 'code') { mountCode(host); return; }
    if (page === 'console') { mountConsole(host); return; }
    if (page === 'team') { mountTeam(host); return; }
    if (page === 'automations') { mountAutomations(host); return; }
    if (page === 'browser') { mountBrowser(host); return; }
    host.innerHTML = `<div class="page-inner">${UI.emptyState({ iconName: 'alert-circle', title: 'Unknown page', description: 'This surface is not part of this build.' })}</div>`;
  }

  window.Views = {
    render,
    handleMediaEvent,
    handlePaperEvent,
    openMediaDetail,
    openMediaEngines,
    openStudio,
    closeStudio,
    activateChat,
    openPaper,
    openPaperComposer,
    openModelPicker,
    openFilePreview,
    languageFor,
    openSettingsSection,
    applyUpdateStatus,
    mediaCount,
  };
})();
