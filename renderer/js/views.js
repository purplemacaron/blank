/* Blank pages — Models, Skills, Memory, MCP, Learning, Settings and Studio. */
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
    plugins: { items: [], query: '', filter: 'all', loading: false },
    settings: { remote: null, ssh: null },
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
      compose: {
        kind: 'image',
        prompt: '',
        engine: 'blank',
        model: '',
        aspect: '1:1',
        count: 1,
        duration: 20,
        fps: 24,
        soundtrack: true,
        style: 'auto',
        palette: 'auto',
        quality: 'medium',
        voice: '',
        rate: 0,
      },
    },
  };

  const KIND = {
    image: { label: 'Image', plural: 'Images', icon: 'image', noun: 'image' },
    video: { label: 'Video', plural: 'Video', icon: 'film', noun: 'video' },
    audio: { label: 'Audio', plural: 'Audio', icon: 'music', noun: 'audio' },
    model3d: { label: '3D', plural: '3D', icon: 'cube', noun: 'model' },
  };

  const TOOL_LABELS = {
    read_file: ['Read files', 'Read text files inside the workspace'],
    write_file: ['Create files', 'Create new files inside the workspace'],
    edit_file: ['Edit files', 'Modify existing files with exact replacements'],
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
    const defaultId = config.defaultModel || 'sandbox/blank-1';
    const fallbackId = config.fallbackModel || '';
    const providers = vstate.models.providers;
    const connectedCount = providers.filter(providerConnected).length;
    host.innerHTML = `<div class="page-inner">
      ${UI.pageHeader({
        title: 'Models',
        description: 'Connect frontier, open and local providers. Blank routes each session to the model you pick.',
        actions: `<button class="btn btn-secondary btn-sm" data-refresh-models>${icon('refresh', 12)} Refresh</button>
          <button class="btn btn-primary btn-sm" data-add-provider>${icon('plus', 12)} Add provider</button>`,
        meta: `<span class="badge blue">${providers.length} providers</span>`,
      })}
      <div class="models-banner">
        <div class="models-banner-copy">
          <div class="models-banner-title">Default model</div>
          <div class="models-banner-sub">${connectedCount} of ${providers.length} providers ready · ${vstate.models.models.length} models available${fallbackId ? ` · fallback ${esc(U.modelLabel({ providers }, fallbackId))}` : ''}</div>
        </div>
        <button class="default-model-button" type="button" data-pick-default title="Change the default model">
          ${UI.providerMono(U.providerOf({ providers }, defaultId) || { id: 'sandbox', name: 'Blank', monogram: 'b' })}
          <span class="copy"><span class="name">${esc(U.modelLabel({ providers }, defaultId))}</span><span class="label">${esc((U.providerOf({ providers }, defaultId) || {}).name || 'Sandbox')} · ${U.kbd('Ctrl M')}</span></span>
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
      const kindLabel = provider.kind === 'local' ? 'Local runtime' : provider.kind === 'custom' ? 'Custom endpoint' : (provider.protocol || 'Cloud');
      return `<button class="provider-card ${connected ? 'connected' : ''}" type="button" data-provider="${U.attr(provider.id)}">
        <div class="provider-card-top">
          ${UI.providerMono(provider)}
          <div style="min-width:0;flex:1"><div class="provider-name">${esc(provider.name)}</div><div class="provider-kind">${esc(kindLabel)}</div></div>
          <span class="provider-status"><span class="status-dot ${connected ? 'on' : 'off'}"></span>${connected ? 'Ready' : 'No key'}</span>
        </div>
        <p class="provider-desc">${esc(provider.description || (provider.kind === 'custom' ? 'Custom OpenAI-compatible endpoint.' : 'Connect a key to use this provider.'))}</p>
        <div class="provider-card-foot">
          ${icon('layers', 11)} ${modelCount} model${modelCount === 1 ? '' : 's'}
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
                <div class="key-section-sub">Keep one key per project or several for rotation. Blank moves to the next key when one is rate-limited.</div>
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
              <div class="key-rotate-copy"><b>Rotate on failure</b><span>Retry with the next saved key on 401, 402, 403 or 429 before surfacing an error.</span></div>
              <span id="provider-rotate"></span>
            </div>
            ${provider.keyEnv ? `<div class="setting-note" style="margin-top:8px">${icon('terminal', 11)} <code>${esc(provider.keyEnv)}</code> is used as a final fallback and never stored.</div>` : ''}
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
        <h2 style="font-size:12px;margin-bottom:6px">Available models <span class="badge">${(provider.models || []).length}</span></h2>
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

    function paintModels() {
      const list = body.querySelector('#provider-models');
      const models = provider.models || [];
      const config = currentConfig();
      const activeDefault = config.defaultModel;
      list.innerHTML = models.map((model) => {
        const fullId = `${provider.id}/${model.id}`;
        const isDefault = fullId === activeDefault;
        return `<div class="provider-model-row">
          <div style="min-width:0;flex:1">
            <div class="model-name">${esc(model.name || model.id)}</div>
            <div class="model-id">${esc(fullId)}${model.context ? ` · ${U.fmtNumber(model.context)} ctx` : ''}</div>
          </div>
          <div class="model-tags">${(model.tags || []).slice(0, 3).map((tag) => `<span class="badge">${esc(tag)}</span>`).join('')}</div>
          <button class="model-use-btn" type="button" data-use-model="${U.attr(fullId)}" ${isDefault ? 'disabled' : ''}>${isDefault ? `${icon('check', 10)} Default` : 'Use'}</button>
        </div>`;
      }).join('') || `<div class="setting-note">No models listed. Try Discover models.</div>`;
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
          UI.toast(`${result.models?.length || 0} models discovered.`, 'success');
          onChanged?.();
        } catch (error) { UI.toast(error.message, 'error'); }
        finally {
          button.disabled = false;
          button.innerHTML = `${icon('refresh', 12)} Discover models`;
        }
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
    const modal = UI.modal({ title: 'Add a provider', description: 'Connect a built-in provider in one click or point Blank at any compatible endpoint.', body, footer, size: 'large' });

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
        description: 'Teach Blank repeatable workflows. Skills are plain SKILL.md files stored on this machine or in your project.',
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
        description: 'Facts Blank keeps across sessions. The agent saves durable preferences automatically; you can pin the ones that matter most.',
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
    host.innerHTML = pageLoading('MCP', 'Model Context Protocol servers extend the agent with real tools.');
    try {
      const [data, refreshed, sshData] = await Promise.all([
        API.mcp.list(),
        API.mcp.refresh().catch(() => null),
        API.ssh?.list ? API.ssh.list().catch(() => null) : Promise.resolve(null),
      ]);
      if (!alive(host, 'mcp')) return;
      vstate.mcp.servers = refreshed?.servers || data.servers || [];
      vstate.mcp.catalog = data.catalog || [];
      if (sshData) vstate.settings.ssh = sshData;
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
            ${UI.switchHtml(server.enabled && server.connected, `data-mcp-toggle="${U.attr(server.id)}"`)}
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
    </div>`;
    host.onclick = async (event) => {
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
      const remove = event.target.closest('[data-mcp-remove]');
      if (remove) {
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

  function openMcpComposer(onChanged) {
    let transport = 'stdio';
    const body = document.createElement('div');
    body.innerHTML = `
      <div class="transport-tabs">
        <button class="transport-tab active" type="button" data-transport="stdio">${icon('terminal', 12)} stdio</button>
        <button class="transport-tab" type="button" data-transport="http">${icon('globe', 12)} HTTP</button>
      </div>
      ${UI.field({ label: 'Name', control: '<input class="field-input" id="mcp-name" type="text" maxlength="60" placeholder="linear" />' })}
      <div id="mcp-stdio-fields">
        ${UI.field({ label: 'Command', hint: 'executed with the system shell', control: '<input class="field-input" id="mcp-command" type="text" spellcheck="false" placeholder="npx -y @modelcontextprotocol/server-filesystem C:\\\\Projects" />' })}
        ${UI.field({ label: 'Environment', hint: 'KEY=value per line', control: '<textarea class="field-textarea transport-secret" id="mcp-env" rows="3" placeholder="API_KEY=…"></textarea>' })}
      </div>
      <div id="mcp-http-fields" hidden>
        ${UI.field({ label: 'Endpoint URL', hint: 'https', control: '<input class="field-input" id="mcp-url" type="url" spellcheck="false" placeholder="https://mcp.example.com/sse" />' })}
        ${UI.field({ label: 'Headers', hint: 'KEY=value per line', control: '<textarea class="field-textarea transport-secret" id="mcp-headers" rows="3" placeholder="Authorization=Bearer …"></textarea>' })}
      </div>
      <p class="custom-note">Secrets are stored locally with the server definition and never shown in the agent transcript.</p>
    `;
    const stdioFields = body.querySelector('#mcp-stdio-fields');
    const httpFields = body.querySelector('#mcp-http-fields');
    body.querySelectorAll('[data-transport]').forEach((tab) => {
      tab.addEventListener('click', () => {
        transport = tab.dataset.transport;
        body.querySelectorAll('[data-transport]').forEach((t) => t.classList.toggle('active', t === tab));
        stdioFields.hidden = transport !== 'stdio';
        httpFields.hidden = transport !== 'http';
      });
    });
    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;justify-content:flex-end;gap:6px;width:100%';
    footer.innerHTML = `<button class="btn btn-ghost btn-sm" data-cancel>Cancel</button><button class="btn btn-primary btn-sm" data-save>${icon('plug', 12)} Connect server</button>`;
    const modal = UI.modal({ title: 'Add MCP server', description: 'Blank starts the server, lists its tools and namespaces them for the agent.', size: 'large', body, footer });
    footer.querySelector('[data-cancel]').addEventListener('click', () => modal.close());
    const save = footer.querySelector('[data-save]');
    save.addEventListener('click', async () => {
      const name = body.querySelector('#mcp-name').value.trim();
      if (!name) { UI.toast('Name the server.', 'warn'); return; }
      const payload = { name, transport };
      if (transport === 'stdio') {
        payload.command = body.querySelector('#mcp-command').value.trim();
        payload.env = parseKeyValue(body.querySelector('#mcp-env').value);
        if (!payload.command) { UI.toast('Enter the command to launch the server.', 'warn'); return; }
      } else {
        payload.url = body.querySelector('#mcp-url').value.trim();
        payload.headers = parseKeyValue(body.querySelector('#mcp-headers').value);
        if (!/^https?:\/\//i.test(payload.url)) { UI.toast('Enter a valid URL.', 'warn'); return; }
      }
      save.disabled = true;
      save.innerHTML = `<span class="spinner" style="width:11px;height:11px"></span> Connecting…`;
      try {
        await API.mcp.add(payload);
        modal.close();
        UI.toast(`${name} connected.`, 'success');
        onChanged?.();
      } catch (error) { UI.toast(error.message, 'error'); save.disabled = false; save.innerHTML = `${icon('plug', 12)} Connect server`; }
    });
  }

  /* ----------------------------------------------------------------- learning */

  async function mountLearning(host) {
    vstate.page = 'learning';
    vstate.host = host;
    host.innerHTML = pageLoading('Learning', 'Blank reviews its own sessions and proposes durable improvements.');
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
            <p>${pending.length ? 'Review what Blank noticed. Apply keeps it; dismiss forgets it.' : 'When a reflection pass finds something durable, it lands here for review.'}</p>
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
              <span>Model <b>${esc(modelLabel || 'Connect a hosted model')}</b></span>
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
      <input class="field-input team-model" data-team-field="model" value="${U.attr(member.model || '')}" placeholder="Model id (leave blank for the default)" spellcheck="false" />
    </div>`;
  }

  function paintSettings(host) {
    const config = currentConfig();
    const info = appState().info || {};
    const agent = config.agent || {};
    const permissions = config.permissions || {};
    const providers = appState().catalog?.providers || vstate.models.providers;
    const runtime = appState().config?.runtime || info;
    const defaultModel = config.defaultModel || 'sandbox/blank-1';
    const fallbackModel = config.fallbackModel || '';
    const rows = Object.keys(TOOL_LABELS).filter((key) => key in permissions || ['generate_media', 'edit_media'].includes(key));
    const searchCfg = config.search || {};
    const searchId = SEARCH_BACKENDS.some((backend) => backend.id === searchCfg.provider) ? searchCfg.provider : 'duckduckgo';
    const searchMeta = SEARCH_BACKENDS.find((backend) => backend.id === searchId);
    const searchHasKey = Boolean(searchCfg.hasKey && searchCfg.hasKey[searchId]);
    const searchResults = Math.max(1, Math.min(10, Number(searchCfg.maxResults) || 6));
    const computerCfg = config.computer || {};
    const remoteCfg = config.remote || vstate.settings.remote || {};
    const remoteState = vstate.settings.remote || {};
    const remoteRunning = Boolean(remoteState.running);
    const remotePort = Number(remoteState.port) || Number(remoteCfg.port) || 8787;
    const remoteToken = remoteRunning ? String(remoteState.token || '') : '';
    const remoteUrls = remoteRunning && Array.isArray(remoteState.urls) ? remoteState.urls : [];
    const teamCfg = config.team || { enabled: false, members: [] };
    const teamMembers = Array.isArray(teamCfg.members) ? teamCfg.members : [];
    const language = config.language === 'en' ? 'en' : 'ko';
    host.innerHTML = `<div class="page-inner">
      ${UI.pageHeader({
        title: 'Settings',
        description: 'Tune how Blank thinks, what it may touch, and where your data lives.',
        actions: `<button class="btn btn-secondary btn-sm" data-open-data>${icon('folder-open', 12)} Data folder</button>`,
      })}
      <div class="settings-layout">
        <nav class="settings-nav">
          <button class="settings-nav-item active" type="button" data-settings-go="general">${icon('settings', 13)} General</button>
          <button class="settings-nav-item" type="button" data-settings-go="agent">${icon('bot', 13)} Agent</button>
          <button class="settings-nav-item" type="button" data-settings-go="team">${icon('bot', 13)} Agent team</button>
          <button class="settings-nav-item" type="button" data-settings-go="approvals">${icon('shield', 13)} Approvals</button>
          <button class="settings-nav-item" type="button" data-settings-go="search">${icon('globe', 13)} Web search</button>
          <button class="settings-nav-item" type="button" data-settings-go="computer">${icon('monitor', 13)} Computer</button>
          <button class="settings-nav-item" type="button" data-settings-go="remote">${icon('link', 13)} Remote</button>
          <button class="settings-nav-item" type="button" data-settings-go="data">${icon('database', 13)} Data & CLI</button>
          <button class="settings-nav-item" type="button" data-settings-go="about">${icon('sparkles', 13)} About</button>
        </nav>
        <div class="settings-content">
          <section class="settings-section" id="settings-general">
            <h2>General</h2>
            <p>The canvas, the default model, and how much of the agent's thinking you see.</p>
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

          <section class="settings-section" id="settings-approvals">
            <h2>Approvals</h2>
            <p>Choose what the agent may do on its own. Writes, shell commands and media generation ask by default.</p>
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
            <div class="settings-permission-note">${icon('shield', 12)} Denied tools are removed from the model's tool list entirely. Approvals are per session and expire when the run ends.</div>
          </section>

          <section class="settings-section" id="settings-search">
            <h2>Web search</h2>
            <p>Bundled with every agent. The <code>web_search</code> tool works without an account; add a provider key for faster, cleaner results.</p>
            <div class="settings-group">
              <div class="setting-row">
                <div class="setting-copy"><div class="setting-label">Provider</div><div class="setting-desc">Missing keys fall back to DuckDuckGo automatically.</div><div class="setting-note">${esc(searchMeta ? `${searchMeta.label} · ${searchMeta.note}` : 'Search backend')}</div></div>
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
                <div class="setting-copy"><div class="setting-label">Cursor overlay</div><div class="setting-desc">Draws a blue marker wherever the agent works. It is click-through, never takes focus, and hides itself after each action.</div></div>
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
                <div class="setting-copy"><div class="setting-label">Start with Blank</div><div class="setting-desc">Bring remote control up automatically using the saved port and options.</div></div>
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
            <p>Everything Blank remembers is plain files you can inspect, back up or delete.</p>
            <div class="settings-group">
              <div class="setting-row">
                <div class="setting-copy"><div class="setting-label">Data folder</div><div class="setting-desc">Sessions, config, memory, skills, checkpoints and media live here.</div><div class="data-path">${icon('folder', 11)}<code>${esc(info.home || runtime.home || '~/.blank')}</code></div></div>
                <div class="setting-control"><button class="btn btn-secondary btn-sm" type="button" data-open-data>${icon('folder-open', 12)} Open</button></div>
              </div>
              <div class="setting-row">
                <div class="setting-copy"><div class="setting-label">Command line</div><div class="setting-desc">Install a blank launcher for terminals and editor tasks.</div><div class="setting-note" id="cli-note">The launcher points at this installation.</div></div>
                <div class="setting-control"><button class="btn btn-secondary btn-sm" type="button" data-install-cli>${icon('terminal', 12)} Install CLI</button></div>
              </div>
              <div class="setting-row">
                <div class="setting-copy"><div class="setting-label">Workspace folder</div><div class="setting-desc">Open the folder Blank is allowed to work in.</div><div class="data-path">${icon('folder', 11)}<code>${esc(config.workspace || 'No workspace')}</code></div></div>
                <div class="setting-control"><button class="btn btn-secondary btn-sm" type="button" data-open-workspace>${icon('folder-open', 12)} Open</button></div>
              </div>
              <div class="setting-row">
                <div class="setting-copy"><div class="setting-label">Media storage</div><div class="setting-desc">Generated and imported assets, plus thumbnails and waveforms.</div><div class="setting-note" id="media-storage-note">${vstate.media.storage ? `${vstate.media.storage.count} assets · ${U.fmtBytes(vstate.media.storage.bytes)}` : 'Loading…'}</div></div>
                <div class="setting-control"><button class="btn btn-secondary btn-sm" type="button" data-open-media-studio>${icon('image', 12)} Open Studio</button></div>
              </div>
            </div>
          </section>

          <section class="settings-section" id="settings-about">
            <h2>About</h2>
            <div class="card">
              <div class="about-block">
                <div class="about-copy">
                  <h3>Blank</h3>
                  <p>A quiet, local-first agent harness. Chat, code, plan and create media from one white canvas — with keys, sessions and memory kept on your machine.</p>
                  <div class="about-versions">
                    <span class="badge">Electron ${esc(info.electron || runtime.electron || '—')}</span>
                    <span class="badge">Node ${esc(info.node || runtime.node || '—')}</span>
                    <span class="badge">${esc(info.platform || runtime.platform || '')}</span>
                  </div>
                  <div class="about-link-row">
                    <button class="link-btn" type="button" data-open-data>${icon('folder-open', 12)} Data folder</button>
                    <button class="link-btn" type="button" data-open-media-studio>${icon('image', 12)} Studio</button>
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
          const updated = await API.config.update({ agent: {
            maxSteps: Math.max(1, Math.min(64, Number(host.querySelector('#agent-max-steps').value) || 32)),
            compactAt: Math.max(0.5, Math.min(0.95, (Number(host.querySelector('#agent-compact-at').value) || 82) / 100)),
          } });
          applyConfig(updated);
          UI.toast('Agent limits saved.', 'success');
          paintSettings(host);
        } catch (error) { UI.toast(error.message, 'error'); }
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
          const result = await API.search.test({ query: 'Blank agent harness' });
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
          UI.toast(key === 'autoStart' ? (next ? 'Remote will start with Blank.' : 'Remote will not start automatically.') : 'Remote settings updated.', 'success');
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
        if (window.App?.openPage) App.openPage('studio');
        return;
      }
      if (event.target.closest('[data-open-shortcuts]')) { openShortcuts(); return; }
      if (event.target.closest('[data-install-cli]')) {
        const button = event.target.closest('[data-install-cli]');
        button.disabled = true;
        try {
          const result = await API.cli.install();
          host.querySelector('#cli-note').textContent = result.instructions;
          UI.toast('CLI launcher installed.', 'success', { title: result.path, timeout: 8000 });
        } catch (error) { UI.toast(error.message, 'error'); }
        finally { button.disabled = false; }
      }
    };
    host.onchange = async (event) => {
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
      const [config, storage, remote] = await Promise.all([
        API.config.get(),
        API.media.storage().catch(() => null),
        API.remote?.status ? API.remote.status().catch(() => null) : Promise.resolve(null),
      ]);
      if (!alive(host, 'settings')) return;
      vstate.media.storage = storage || vstate.media.storage;
      vstate.settings.remote = remote;
      vstate.settings.ssh = config?.ssh || null;
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

  const IMAGE_STYLES = [
    ['auto', 'Auto'], ['aurora', 'Aurora'], ['cosmic', 'Cosmic'], ['landscape', 'Landscape'],
    ['portrait', 'Portrait'], ['botanical', 'Botanical'], ['product', 'Still life'],
    ['architecture', 'Architecture'], ['mark', 'Identity'], ['grid', 'Poster'], ['waves', 'Waves'],
  ];
  const PALETTES = [
    ['auto', 'Auto'], ['cobalt', 'Cobalt'], ['ice', 'Ice'], ['sunset', 'Sunset'], ['dawn', 'Dawn'],
    ['violet', 'Violet'], ['mint', 'Mint'], ['forest', 'Forest'], ['sand', 'Sand'], ['mono', 'Mono'], ['noir', 'Noir'],
  ];
  const AUDIO_STYLES = [
    ['auto', 'Auto'], ['ambient', 'Ambient'], ['lofi', 'Lo-fi'], ['cinematic', 'Cinematic'],
    ['synthwave', 'Synthwave'], ['electronic', 'Electronic'], ['jazz', 'Jazz'], ['organic', 'Organic'],
  ];
  const ASPECTS = {
    image: [['1:1', 'Square 1:1'], ['4:3', 'Landscape 4:3'], ['3:4', 'Portrait 3:4'], ['16:9', 'Wide 16:9'], ['9:16', 'Tall 9:16']],
    video: [['16:9', 'Wide 16:9'], ['9:16', 'Tall 9:16'], ['1:1', 'Square 1:1'], ['4:3', 'Classic 4:3']],
  };
  const SUGGESTIONS = {
    image: ['Brutalist poster for a solo exhibition', 'Cobalt gradient study, soft film grain', 'Isometric city at dusk', 'Botanical plate in muted ink'],
    video: ['Slow orbital shot over a glass city', 'Tidal lines in a deep blue sea', 'Neon rain on an empty street', 'Paper shapes drifting in light'],
    audio: ['Warm lo-fi loop for late-night coding', 'Cinematic ambient beneath rain', 'Bright synthwave drive at 110 bpm', 'Airy jazz chords for a studio'],
    model3d: ['Faceted crystal artifact', 'Modular brutalist desk lamp', 'Low-poly mountain diorama', 'Twisted ceramic vase'],
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

  function applyKindDefaults(kind) {
    const defaults = (vstate.media.defaults || {})[kind] || {};
    const compose = vstate.media.compose;
    compose.kind = kind;
    if (defaults.engine) compose.engine = defaults.engine;
    else compose.engine = kind === 'audio' ? 'blank-voice' : 'blank';
    if (defaults.aspect) compose.aspect = defaults.aspect;
    else compose.aspect = kind === 'video' ? '16:9' : '1:1';
    if (defaults.duration) compose.duration = defaults.duration;
    else compose.duration = kind === 'video' ? 4 : 20;
    if (defaults.fps) compose.fps = defaults.fps;
    if (defaults.soundtrack !== undefined) compose.soundtrack = Boolean(defaults.soundtrack);
    else compose.soundtrack = true;
    if (defaults.style) compose.style = defaults.style;
    else compose.style = 'auto';
    if (defaults.quality) compose.quality = defaults.quality;
    else compose.quality = 'medium';
    if (defaults.palette) compose.palette = defaults.palette;
    compose.count = 1;
    const engine = engineInfo(compose.engine);
    if (engine?.vendor === 'cloud') compose.model = engine.models?.[0] || '';
    else compose.model = '';
  }

  async function mountStudio(host) {
    vstate.page = 'studio';
    vstate.host = host;
    if (!vstate.media.loaded) host.innerHTML = pageLoading('Studio', 'Generate and edit images, video, music and 3D objects.');
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
        if (alive(host, 'studio') && vstate.media.compose.kind === 'audio' && vstate.media.compose.engine === 'blank-voice') paintStudio(host);
      }).catch(() => { vstate.media.voices = []; });
      if (!vstate.media._composeReady) {
        applyKindDefaults(vstate.media.compose.kind);
        vstate.media._composeReady = true;
      }
      paintStudio(host);
    } catch (error) { if (alive(host, 'studio')) pageError(host, 'Studio', error); }
  }

  function paintStudio(host) {
    const compose = vstate.media.compose;
    const kind = compose.kind;
    const storage = vstate.media.storage || { counts: vstate.media.counts, bytes: 0, cloudReady: [] };
    const counts = storage.counts || vstate.media.counts;
    const totalCount = counts.image + counts.video + counts.audio + counts.model3d;
    const engines = currentEngineList(kind);
    if (!engines.some((engine) => engine.id === compose.engine)) compose.engine = engines[0]?.id || '';
    const engine = engineInfo(compose.engine);
    const isCloud = engine?.vendor === 'cloud';
    const isSpeech = kind === 'audio' && compose.engine === 'blank-voice';
    const activeJobs = vstate.media.jobs.filter((job) => job.status === 'queued' || job.status === 'running');
    const voices = vstate.media.voices || [];
    const placeholder = isSpeech
      ? 'Type the script to speak…'
      : kind === 'audio' ? 'Describe a track…' : kind === 'model3d' ? 'Describe an object…' : 'Describe the image…';
    host.innerHTML = `<div class="page-inner">
      ${UI.pageHeader({
        title: 'Studio',
        actions: `<button class="btn btn-secondary btn-sm" data-media-engines>${icon('sliders', 12)} Engines</button>
          <button class="btn btn-secondary btn-sm" data-import-media>${icon('upload', 12)} Import</button>`,
        meta: `<span class="badge blue">${totalCount}</span>`,
      })}
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
              ${kind === 'image' || kind === 'video' ? `<div class="studio-row">
                <label class="studio-field"><span>Aspect</span><select class="studio-select" id="compose-aspect">${(ASPECTS[kind] || ASPECTS.image).map(([value, label]) => `<option value="${value}" ${compose.aspect === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
                ${kind === 'image'
                  ? `<label class="studio-field"><span>Count</span><select class="studio-select" id="compose-count">${[1, 2, 3, 4].map((n) => `<option value="${n}" ${Number(compose.count) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>`
                  : `<label class="studio-field"><span>Seconds</span><input class="studio-input" id="compose-duration" type="number" min="2" max="12" step="1" value="${compose.duration}" /></label>`}
              </div>` : ''}
              ${kind === 'video' ? `<div class="studio-row">
                <label class="studio-field"><span>Frame rate</span><select class="studio-select" id="compose-fps">${[12, 18, 24, 30].map((fps) => `<option value="${fps}" ${Number(compose.fps) === fps ? 'selected' : ''}>${fps} fps</option>`).join('')}</select></label>
                <div class="studio-field"><span>Score</span><div class="studio-switch-row" style="padding:4px 7px;min-height:28px"><span class="copy"><b>Soundtrack</b></span>${UI.switchHtml(compose.soundtrack, 'data-compose-toggle="soundtrack"')}</div></div>
              </div>` : ''}
              ${kind === 'audio' ? (isSpeech ? `<div class="studio-row">
                <label class="studio-field"><span>Voice</span><select class="studio-select" id="compose-voice">
                  <option value="">Auto</option>
                  ${voices.map((name) => `<option value="${U.attr(name)}" ${compose.voice === name ? 'selected' : ''}>${esc(name)}</option>`).join('')}
                </select></label>
                <label class="studio-field"><span>Rate</span><select class="studio-select" id="compose-rate">${[-4, -2, 0, 2, 4].map((value) => `<option value="${value}" ${Number(compose.rate) === value ? 'selected' : ''}>${value === 0 ? 'Normal' : value < 0 ? `Slow ${Math.abs(value)}` : `Fast ${value}`}</option>`).join('')}</select></label>
              </div>` : `<div class="studio-row">
                <label class="studio-field"><span>Duration</span><input class="studio-input" id="compose-duration" type="number" min="4" max="180" step="1" value="${compose.duration}" /></label>
                <label class="studio-field"><span>Style</span><select class="studio-select" id="compose-style">${AUDIO_STYLES.map(([value, label]) => `<option value="${value}" ${compose.style === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
              </div>`) : ''}
              ${kind === 'model3d' ? `<div class="studio-row">
                <label class="studio-field"><span>Quality</span><select class="studio-select" id="compose-quality">${['low', 'medium', 'high'].map((value) => `<option value="${value}" ${compose.quality === value ? 'selected' : ''}>${value[0].toUpperCase()}${value.slice(1)}</option>`).join('')}</select></label>
                <div class="studio-field"><span>Export</span><div class="studio-switch-row" style="padding:4px 7px;min-height:28px"><span class="copy"><b>OBJ + MTL</b></span></div></div>
              </div>` : ''}
              ${kind === 'image' || kind === 'video' ? `<div class="studio-row">
                <label class="studio-field"><span>Direction</span><select class="studio-select" id="compose-style">${IMAGE_STYLES.map(([value, label]) => `<option value="${value}" ${compose.style === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
                <label class="studio-field"><span>Palette</span><select class="studio-select" id="compose-palette">${PALETTES.map(([value, label]) => `<option value="${value}" ${compose.palette === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
              </div>` : ''}
              <label class="studio-field">
                <span>Engine</span>
                <select class="studio-select" id="compose-engine">
                  ${engines.length ? engines.map((item) => `<option value="${U.attr(item.id)}" ${compose.engine === item.id ? 'selected' : ''}>${esc(item.label)}${item.id === 'blank-voice' ? ' · TTS' : item.vendor === 'cloud' ? ' · Cloud' : ''}</option>`).join('') : '<option value="">No engine</option>'}
                  ${(vstate.media.engines?.cloud || []).some((e) => e.kinds.includes(kind) && !e.available) ? '<option value="add-key">Add cloud engine…</option>' : ''}
                  ${kind === 'image' && (vstate.media.engines?.local || []).some((e) => e.id === 'comfyui' && !e.available) ? '<option value="add-comfy">Set up ComfyUI…</option>' : ''}
                </select>
              </label>
              ${isCloud ? `<label class="studio-field"><span>Model</span><select class="studio-select" id="compose-model">${(engine.models || []).map((model) => `<option value="${U.attr(model)}" ${compose.model === model ? 'selected' : ''}>${esc(model)}</option>`).join('')}</select></label>` : ''}
              <button class="studio-generate" type="button" data-generate ${engines.length ? '' : 'disabled'}>
                ${activeJobs.length ? `<span class="spinner" style="width:12px;height:12px;border-color:rgba(255,255,255,.35);border-top-color:#fff"></span>` : icon('sparkles', 14)}
                Generate ${isSpeech ? 'speech' : KIND[kind].noun} <span class="kbd">${U.kbd('Ctrl ↵')}</span>
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
        const info = engineInfo(value);
        if (info?.vendor === 'cloud') compose.model = info.models?.[0] || compose.model;
        paintStudio(host);
        return;
      }
      if (id === 'compose-model') { compose.model = value; return; }
      if (id === 'compose-voice') { compose.voice = value; return; }
      if (id === 'compose-rate') { compose.rate = Number(value) || 0; return; }
      if (id === 'compose-aspect') { compose.aspect = value; return; }
      if (id === 'compose-count') { compose.count = Number(value) || 1; paintStudio(host); return; }
      if (id === 'compose-duration') { compose.duration = Math.max(1, Number(value) || compose.duration); return; }
      if (id === 'compose-fps') { compose.fps = Number(value) || 24; return; }
      if (id === 'compose-style') { compose.style = value; return; }
      if (id === 'compose-palette') { compose.palette = value; return; }
      if (id === 'compose-quality') { compose.quality = value; return; }
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
      style: compose.style,
      palette: compose.palette,
      aspect: compose.aspect,
      count: compose.count,
      duration: compose.duration,
      fps: compose.fps,
      soundtrack: compose.soundtrack,
      quality: compose.quality,
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
    if (!engineInfoValue) { UI.toast('Choose an engine in Engines & keys.', 'warn'); return; }
    const payload = {
      kind: compose.kind,
      prompt,
      engine: compose.engine,
      aspect: compose.aspect,
      count: compose.count,
      duration: compose.duration,
      fps: compose.fps,
      soundtrack: compose.soundtrack,
      style: compose.style,
      palette: compose.palette,
      quality: compose.quality,
      voice: compose.voice,
      rate: compose.rate,
    };
    if (engineInfoValue.vendor === 'cloud') payload.model = compose.model || engineInfoValue.models?.[0];
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
        const noun = compose.kind === 'audio' && compose.engine === 'blank-voice' ? 'speech' : KIND[compose.kind].noun;
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

  function handleJobFinished(job) {
    if (notifiedJobs.has(job.id)) return;
    notifiedJobs.add(job.id);
    if (job.status === 'done') {
      const assetId = (job.assetIds || [])[0];
      UI.toast(`${KIND[job.kind]?.label || 'Media'} ready.`, 'success', {
        title: 'Studio',
        actionLabel: assetId ? 'Open' : null,
        onAction: assetId ? () => openMediaDetail(assetId) : undefined,
        timeout: 7000,
      });
    } else if (job.status === 'cancelled') {
      UI.toast('Generation cancelled.', 'info');
    } else {
      UI.toast(job.error || 'Generation failed.', 'error', { title: 'Studio', timeout: 8000 });
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
        <label class="studio-field full"><span>Prompt <b>optional</b></span><input class="studio-input" data-edit-prompt placeholder="Refine the mood, palette or treatment" /></label>
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

  function meshEditMarkup(asset) {
    const format = asset.meta?.format === 'stl' ? 'stl' : 'obj';
    return `<div class="media-edit">
      <div class="media-edit-head">${icon('cube', 13)} Remix model <small>Creates a version · local</small></div>
      <div class="media-edit-grid">
        <label class="studio-field full"><span>Prompt</span><input class="studio-input" data-edit-prompt value="${U.attr(asset.prompt || '')}" placeholder="Describe a variation of this object" /></label>
        <label class="studio-field"><span>Quality</span><select class="studio-select" data-edit-quality>
          ${['low', 'medium', 'high'].map((value) => `<option value="${value}" ${(asset.meta?.quality || 'medium') === value ? 'selected' : ''}>${value[0].toUpperCase()}${value.slice(1)}</option>`).join('')}
        </select></label>
        <label class="studio-field"><span>Seed</span><input class="studio-input" data-edit-seed type="number" min="0" placeholder="${asset.seed ?? 'auto'}" /></label>
        <label class="studio-field"><span>Format</span><select class="studio-select" data-edit-format>
          <option value="obj" ${format === 'obj' ? 'selected' : ''}>OBJ + MTL</option><option value="stl" ${format === 'stl' ? 'selected' : ''}>Binary STL</option>
        </select></label>
        <div class="studio-field full"><span>Note</span><div class="info-line">${icon('alert-circle', 11)} STL versions replace the OBJ/MTL pair with a single binary mesh; previews are generated the same way.</div></div>
      </div>
      ${editActionsHtml('Parametric remix · OBJ/MTL or STL, plus a preview render.')}
    </div>`;
  }

  function editMarkup(asset) {
    if (asset.kind === 'image') return imageEditMarkup(asset);
    if (asset.kind === 'video') return videoEditMarkup(asset);
    if (asset.kind === 'audio') return audioEditMarkup(asset);
    if (asset.kind === 'model3d') return meshEditMarkup(asset);
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
    const prompt = text('prompt');
    if (prompt) payload.prompt = prompt;
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
    } else if (asset.kind === 'model3d') {
      if (prompt) payload.prompt = prompt;
      const quality = text('quality');
      const seed = numeric('seed');
      if (quality) operations.quality = quality;
      if (seed !== null) operations.seed = Math.round(seed);
      operations.format = text('format') === 'stl' ? 'stl' : 'obj';
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
      title: 'Studio asset',
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
          if (result && !result.canceled) UI.toast(`Exported to ${result.path}`, 'success', { title: 'Studio', timeout: 7000 });
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
          message: `“${current.title}” and its files will be removed from the studio library.`,
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
          UI.toast('Edit saved as a new version.', 'success', { title: 'Studio', timeout: 5000 });
          if (!closed) {
            handle.close();
            openMediaDetail(latest.assetIds[0]);
          }
          return;
        }
        if (progress) progress.hidden = true;
        if (latest.status === 'cancelled') UI.toast('Edit cancelled.', 'info');
        else UI.toast(latest.error || 'Edit failed.', 'error', { title: 'Studio', timeout: 8000 });
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
    const ready = [...groups.values()].filter((group) => group.hasKey).length;
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
    const cloudRows = [...groups.values()].map((group) => `<div class="engine-row ${group.hasKey ? 'available' : ''}" data-key-group="${U.attr(group.keyId)}">
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
        if (result && result.engines) vstate.media.engines = result.engines;
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
    const providers = (catalog.providers || []).filter((provider) => (provider.models || []).length);
    const current = options.current || '';
    const allowNone = Boolean(options.allowNone);
    let total = 0;
    for (const provider of providers) total += (provider.models || []).length;
    const body = document.createElement('div');
    body.className = 'model-picker';
    body.innerHTML = `<label class="search-field model-picker-search">${icon('search', 13)}<input type="search" data-model-search placeholder="Search ${U.fmtNumber(total)} models or providers" autocomplete="off" /></label>
      <div class="model-picker-list" data-model-list>
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
              <span class="model-picker-icon">${icon(model.vision ? 'eye' : model.reasoning ? 'brain' : 'cpu', 13)}</span>
              <span class="model-picker-copy"><span class="model-picker-model">${esc(model.name)}</span><span class="model-picker-id">${esc(fullId)}${model.context ? ` · ${U.fmtNumber(model.context)} ctx` : ''}</span></span>
              ${model.local ? '<span class="badge green">Local</span>' : ''}
              <span class="model-picker-check">${selected ? icon('check', 12) : ''}</span>
            </button>`;
          }).join('')}
        </div>`).join('')}
        <div class="model-picker-empty" hidden>No models match that search.</div>
      </div>
      <div class="model-picker-foot">
        <span>${U.fmtNumber(total)} models · ${providers.length} providers</span>
        <span style="flex:1"></span>
        <button class="link-btn" type="button" data-manage-models>Manage models ${icon('arrow-right', 10)}</button>
      </div>`;
    const modal = UI.modal({
      title: options.title || 'Choose a model',
      description: options.description || 'The model this conversation will use.',
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
      if (event.target.closest('[data-manage-models]')) {
        modal.close();
        if (window.App?.openPage) App.openPage('models');
      }
    });
    setTimeout(() => search?.focus(), 60);
  }

  /* ------------------------------------------------------------------ plugins */

  const PLUGIN_ICONS = { github: 'git-branch', smartphone: 'link' };

  async function mountPlugins(host) {
    vstate.page = 'plugins';
    vstate.host = host;
    if (!vstate.plugins.items.length) host.innerHTML = pageLoading('Plugins', 'Add MCP servers, skills and built-in capabilities in one click.');
    try {
      const data = await API.plugins.list();
      if (!alive(host, 'plugins')) return;
      vstate.plugins.items = data.items || [];
      paintPlugins(host);
    } catch (error) { if (alive(host, 'plugins')) pageError(host, 'Plugins', error); }
  }

  function pluginCard(item) {
    const iconName = PLUGIN_ICONS[item.icon] || item.icon || 'plug';
    const isMCP = item.kind === 'mcp';
    const isSkill = item.kind === 'skill';
    const server = item.server;
    const labels = {
      'settings-web': 'Open search settings',
      'settings-computer': 'Open computer settings',
      'settings-remote': 'Open remote settings',
      studio: 'Open Studio',
    };
    return `<article class="plugin-card ${item.installed ? 'installed' : ''}">
      <div class="plugin-card-head">
        <span class="plugin-icon">${icon(iconName, 17)}</span>
        <div class="plugin-card-title"><h3>${esc(item.name)}</h3><span class="plugin-cat">${esc(item.category)}</span></div>
        ${item.installed ? `<span class="badge ${item.kind === 'builtin' ? 'blue' : 'green'}">${item.kind === 'builtin' ? 'Built in' : 'Installed'}</span>` : ''}
      </div>
      <p class="plugin-tagline">${esc(item.tagline)}</p>
      <p class="plugin-description">${esc(item.description)}</p>
      <div class="plugin-tags">${(item.tags || []).map((tag) => `<span class="plugin-tag">${esc(tag)}</span>`).join('')}</div>
      ${isMCP && server ? `<div class="plugin-status">${server.connected ? '<span class="badge green">Connected</span>' : `<span class="badge amber">${esc(server.error ? U.truncate(server.error, 46) : 'Not connected')}</span>`}<span>${server.toolCount || 0} tool${server.toolCount === 1 ? '' : 's'}</span></div>` : ''}
      <div class="plugin-actions">
        ${item.kind === 'builtin'
          ? `<button class="btn btn-secondary btn-sm" type="button" data-plugin-action="${U.attr(item.action || '')}">${icon('arrow-up-right', 11)} ${esc(labels[item.action] || 'Open')}</button>`
          : item.installed
            ? `<button class="btn btn-secondary btn-sm" type="button" data-plugin-manage="${isSkill ? 'skill' : 'mcp'}">${icon(isSkill ? 'layers' : 'plug', 11)} ${isSkill ? 'Open Skills' : 'Open MCP'}</button>${isMCP ? `<button class="btn btn-ghost btn-sm" type="button" data-plugin-remove="${U.attr(item.id)}">${icon('trash', 11)} Remove</button>` : ''}`
            : `<button class="btn btn-primary btn-sm" type="button" data-plugin-install="${U.attr(item.id)}">${icon('plus', 11)} Install</button>`}
      </div>
    </article>`;
  }

  function paintPlugins(host) {
    const items = vstate.plugins.items;
    const counts = { all: items.length, builtin: 0, mcp: 0, skill: 0 };
    for (const item of items) counts[item.kind] = (counts[item.kind] || 0) + 1;
    const installed = items.filter((item) => item.installed).length;
    const query = vstate.plugins.query.trim().toLowerCase();
    const filtered = items.filter((item) => {
      if (vstate.plugins.filter !== 'all' && item.kind !== vstate.plugins.filter) return false;
      if (!query) return true;
      return `${item.name} ${item.tagline} ${item.description} ${(item.tags || []).join(' ')}`.toLowerCase().includes(query);
    });
    const tabs = [
      ['all', 'All'], ['builtin', 'Built in'], ['mcp', 'MCP'], ['skill', 'Skills'],
    ];
    host.innerHTML = `<div class="page-inner">
      ${UI.pageHeader({
        title: 'Plugins',
        description: 'One-click capabilities. MCP servers add tools, skills add focused workflows, and built-ins are always available.',
        actions: `<button class="btn btn-secondary btn-sm" type="button" data-plugin-refresh>${icon('refresh', 12)} Refresh</button>`,
        meta: `<span class="badge blue">${installed} active</span>`,
      })}
      <div class="plugin-toolbar">
        <div class="plugin-filters">
          ${tabs.map(([id, label]) => `<button class="studio-filter ${vstate.plugins.filter === id ? 'active' : ''}" type="button" data-plugin-filter="${id}">${esc(label)} <span class="count">${counts[id] || 0}</span></button>`).join('')}
        </div>
        <div style="flex:1"></div>
        <label class="search-field">${icon('search', 12)}<input id="plugin-search" type="search" placeholder="Search plugins" value="${U.attr(vstate.plugins.query)}" /></label>
      </div>
      ${filtered.length
        ? `<div class="plugin-grid" id="plugin-grid">${filtered.map(pluginCard).join('')}</div>`
        : `<div class="empty-state"><div class="empty-icon">${icon('plug', 22)}</div><h3>No plugins match</h3><p>Try another search or switch filters.</p></div>`}
      <div class="settings-permission-note">${icon('shield', 12)} Installing runs only after you confirm. MCP tools still pass through Approvals on every call, and nothing is installed silently.</div>
    </div>`;

    host.onclick = (event) => {
      const filter = event.target.closest('[data-plugin-filter]');
      if (filter) { vstate.plugins.filter = filter.dataset.pluginFilter; paintPlugins(host); return; }
      if (event.target.closest('[data-plugin-refresh]')) { vstate.plugins.items = []; mountPlugins(host); return; }
      const install = event.target.closest('[data-plugin-install]');
      if (install) {
        const item = items.find((entry) => entry.id === install.dataset.pluginInstall);
        if (item) openPluginInstall(item, host);
        return;
      }
      const action = event.target.closest('[data-plugin-action]');
      if (action) { runPluginAction(action.dataset.pluginAction); return; }
      const manage = event.target.closest('[data-plugin-manage]');
      if (manage) {
        if (window.App?.openPage) App.openPage(manage.dataset.pluginManage === 'skill' ? 'skills' : 'mcp');
        return;
      }
      const remove = event.target.closest('[data-plugin-remove]');
      if (remove) {
        const item = items.find((entry) => entry.id === remove.dataset.pluginRemove);
        if (item) openPluginRemove(item, host);
      }
    };
    host.oninput = (event) => {
      if (event.target.id !== 'plugin-search') return;
      vstate.plugins.query = event.target.value;
      paintPlugins(host);
      const next = host.querySelector('#plugin-search');
      if (next) { next.focus(); next.setSelectionRange(next.value.length, next.value.length); }
    };
  }

  function runPluginAction(action) {
    if (!window.App?.openPage) return;
    if (action === 'studio') { App.openPage('studio'); return; }
    if (action === 'settings-web') { openSettingsSection('search'); return; }
    if (action === 'settings-computer') { openSettingsSection('computer'); return; }
    if (action === 'settings-remote') { openSettingsSection('remote'); return; }
    App.openPage('settings');
  }

  function openPluginInstall(item, host) {
    const needsToken = (item.requires || []).includes('token');
    const needsWorkspace = (item.requires || []).includes('workspace');
    const workspace = currentConfig().workspace || '';
    const body = document.createElement('div');
    body.className = 'plugin-modal';
    body.innerHTML = `
      <div class="plugin-modal-head"><span class="plugin-icon">${icon(PLUGIN_ICONS[item.icon] || item.icon || 'plug', 18)}</span><div><h3>${esc(item.name)}</h3><span class="plugin-cat">${esc(item.category)}</span></div></div>
      <p class="plugin-modal-desc">${esc(item.description)}</p>
      ${item.risk ? `<div class="plugin-risk">${icon('shield-alert', 12)}<span>${esc(item.risk)}</span></div>` : ''}
      ${needsToken ? `<label class="field"><span>${esc(item.tokenLabel || 'Access token')}</span><input class="field-input" id="plugin-token" type="password" autocomplete="off" spellcheck="false" placeholder="Paste token" /><small class="setting-note">Stored locally in ~/.blank/config.json. Sent only to the service above.</small></label>` : ''}
      ${needsWorkspace && !workspace ? `<div class="plugin-risk">${icon('alert-triangle', 12)}<span>Open a workspace first. This plugin is rooted at your current folder.</span></div>` : ''}
      <div class="setting-note">Blank never installs silently. Remove MCP plugins from this page at any time.</div>`;
    const footer = document.createElement('div');
    footer.className = 'modal-actions';
    footer.innerHTML = `<button class="btn btn-ghost" type="button" data-modal-close>Cancel</button><button class="btn btn-primary" type="button" data-confirm-plugin>${icon('download', 12)} Install ${item.kind === 'mcp' ? 'MCP server' : 'skill'}</button>`;
    const modal = UI.modal({
      title: `Install ${item.name}`,
      description: item.kind === 'mcp' ? 'Adds a tool server after your confirmation.' : 'Adds a reusable workflow to your skills.',
      body,
      footer,
      size: 'small',
    });
    const button = footer.querySelector('[data-confirm-plugin]');
    button.addEventListener('click', async () => {
      if (needsWorkspace && !workspace) { UI.toast('Choose a workspace first.', 'error'); return; }
      const tokenInput = body.querySelector('#plugin-token');
      const token = tokenInput ? tokenInput.value.trim() : '';
      if (needsToken && !token) { UI.toast('Paste a token to continue.', 'error'); tokenInput?.focus(); return; }
      button.disabled = true;
      button.innerHTML = '<span class="spinner" style="width:11px;height:11px"></span> Installing…';
      try {
        await API.plugins.install({ id: item.id, token });
        modal.close();
        UI.toast(`${item.name} installed.`, 'success');
        vstate.plugins.items = [];
        mountPlugins(host);
      } catch (error) {
        button.disabled = false;
        button.innerHTML = `${icon('download', 12)} Install ${item.kind === 'mcp' ? 'MCP server' : 'skill'}`;
        UI.toast(error.message, 'error', { timeout: 7000 });
      }
    });
  }

  async function openPluginRemove(item, host) {
    const ok = await UI.confirm({
      title: `Remove ${item.name}?`,
      message: 'The MCP server is removed from Blank and reconnects without its tools.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    try {
      await API.plugins.remove(item.id);
      UI.toast(`${item.name} removed.`, 'success');
      vstate.plugins.items = [];
      mountPlugins(host);
    } catch (error) { UI.toast(error.message, 'error'); }
  }

  /* --------------------------------------------------------------- file preview */

  function languageFor(filePath) {
    const ext = String(filePath || '').split('.').pop().toLowerCase();
    const map = {
      js: 'js', mjs: 'js', cjs: 'js', jsx: 'jsx', ts: 'ts', tsx: 'tsx', json: 'json', md: 'markdown',
      py: 'py', sh: 'bash', bash: 'bash', zsh: 'bash', css: 'css', scss: 'scss', sass: 'scss',
      html: 'html', htm: 'html', svg: 'html', xml: 'html', sql: 'sql', go: 'go', rs: 'rust',
      java: 'java', kt: 'java', swift: 'js', c: 'cpp', h: 'cpp', cpp: 'cpp', hpp: 'cpp', cs: 'java',
      php: 'php', rb: 'ruby', yml: 'yaml', yaml: 'yaml', toml: 'toml', lua: 'lua', env: 'bash', gitignore: 'bash',
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

  function mediaCount() {
    if (!vstate.media.loaded) return null;
    const counts = vstate.media.storage?.counts || vstate.media.counts || {};
    return Object.values(counts).reduce((sum, value) => sum + (Number(value) || 0), 0);
  }

  /* -------------------------------------------------------------------- routing */

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
    if (page === 'plugins') { mountPlugins(host); return; }
    if (page === 'learning') { mountLearning(host); return; }
    if (page === 'settings') { mountSettings(host); return; }
    if (page === 'studio') { mountStudio(host); return; }
    host.innerHTML = `<div class="page-inner">${UI.emptyState({ iconName: 'alert-circle', title: 'Unknown page', description: 'This surface is not part of this build.' })}</div>`;
  }

  window.Views = {
    render,
    handleMediaEvent,
    openMediaDetail,
    openMediaEngines,
    openModelPicker,
    openFilePreview,
    openSettingsSection,
    mediaCount,
  };
})();
