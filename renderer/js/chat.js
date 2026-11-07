/* Chat surface: conversation, streaming, tools, approvals, composer. */
(function () {
  'use strict';

  const TOOL_LABELS = {
    read_file: 'Read file', write_file: 'Write file', edit_file: 'Edit file', deliver_file: 'Deliver file', list_dir: 'List folder',
    glob: 'Find files', grep: 'Search code', run_command: 'Run command', web_fetch: 'Fetch URL',
    web_search: 'Web search', computer_screenshot: 'Screenshot', computer_use: 'Computer',
    todo_write: 'Update plan', remember: 'Save memory', memory_search: 'Search memory',
    read_skill: 'Read skill', delegate: 'Sub-agent',
    list_media: 'Search media', generate_media: 'Generate media', edit_media: 'Edit media',
    create_paper: 'Create Paper', update_paper: 'Update Paper', read_paper: 'Read Paper', list_papers: 'List Papers',
  };

  const MODES = {
    agent: { label: 'Agent', icon: 'bot' },
    coding: { label: 'Coding', icon: 'code' },
    design: { label: 'Design', icon: 'palette' },
    plan: { label: 'Plan', icon: 'checklist' },
    ask: { label: 'Ask', icon: 'message' },
  };

  const Chat = {
    session: null,
    running: false,
    sending: false,
    run: null,
    buffer: [],
    draftModel: '',
    draftMode: 'agent',
    draftReasoning: '',
    attachments: [],
    queue: [],
    pendingApprovals: new Map(),
    slashOpen: false,
    slashIndex: 0,
    loadToken: 0,
    activeSessionId: null,
  };

  /* ------------------------------------------------------------------ markup */

  function currentModel() {
    return Chat.session?.model || Chat.draftModel || App.state.config?.defaultModel || '';
  }
  function currentMode() {
    return Chat.session?.mode || Chat.draftMode || 'agent';
  }
  function reasoningProfile() {
    return U.reasoningProfile(catalog(), currentModel());
  }
  function currentReasoning() {
    const value = Chat.session?.reasoningEffort || Chat.draftReasoning || App.state.config?.agent?.reasoningEffort || '';
    return U.normalizeReasoning(reasoningProfile(), value);
  }
  function catalog() {
    return App.state.catalog || { providers: [], models: [] };
  }
  function modelName(id) {
    return U.modelLabel(catalog(), id || currentModel());
  }
  function providerOf(id) {
    return U.providerOf(catalog(), id || currentModel());
  }
  function modeOf(mode) {
    return MODES[mode] || MODES.agent;
  }

  /* Custom and local endpoints report their stages late (capability probe).
     Share one request per model for the whole app session. */
  const reasoningChecks = new Map();
  function reasoningCheckable(model, profile) {
    return Boolean(model && profile?.source === 'fallback'
      && (String(model.providerId || '').startsWith('custom_')
        || ['ollama', 'lmstudio'].includes(String(model.providerId || ''))));
  }
  function requestReasoningCheck(force = false) {
    const model = U.modelOf(catalog(), currentModel());
    const profile = model ? U.reasoningProfile(catalog(), model.fullId) : null;
    if (!reasoningCheckable(model, profile)) return null;
    if (!force && reasoningChecks.has(model.fullId)) return reasoningChecks.get(model.fullId);
    const promise = API.models.reasoning({ model: model.fullId, force })
      .then((result) => (result?.ok ? result.profile || null : null))
      .catch(() => null);
    reasoningChecks.set(model.fullId, promise);
    promise.finally(() => {
      setTimeout(() => { if (reasoningChecks.get(model.fullId) === promise) reasoningChecks.delete(model.fullId); }, 10 * 60 * 1000);
    });
    return promise;
  }

  function assistantHead(modelId) {
    return `<div class="assistant-head">
      <span class="assistant-name">blank</span>
      <span class="assistant-model">${U.esc(modelName(modelId))}</span>
      <span class="assistant-time"></span>
    </div>`;
  }

  function actionsMarkup(messageId) {
    return `<div class="msg-actions">
      <button class="msg-action" type="button" data-action="copy-assistant" title="Copy response">${icon('copy', 13)}<span>Copy</span></button>
      <button class="msg-action" type="button" data-action="open-session-menu" title="Session options">${icon('more-horizontal', 13)}</button>
    </div>`;
  }

  function toolIconName(name) {
    if (name.startsWith('mcp__')) return 'plug';
    return Icons.TOOL_ICONS[name] || 'wrench';
  }

  function toolLabel(name, label) {
    if (label) return label;
    if (name.startsWith('mcp__')) {
      const parts = name.split('__');
      return parts[parts.length - 1] || 'MCP tool';
    }
    return TOOL_LABELS[name] || name;
  }

  function summarizeTool(name, args) {
    const value = args || {};
    if (name === 'run_command') return value.command || '';
    if (name === 'web_fetch') return value.url || '';
    if (name === 'web_search') return value.query || '';
    if (name === 'computer_use') return value.action === 'type' ? `type “${U.truncate(value.text || '', 60)}”` : value.action === 'focus' ? value.title || 'focus window' : value.action || '';
    if (name === 'computer_screenshot') return 'capture screen';
    if (name === 'glob') return value.pattern || value.glob || '';
    if (name === 'grep') return value.pattern || '';
    if (name === 'memory_search') return value.query || '';
    if (name === 'read_skill') return value.name || value.id || '';
    if (name === 'remember') return value.text || '';
    if (name === 'delegate') return value.task || '';
    if (name === 'generate_media') return `${value.kind || 'image'} · ${value.prompt || ''}`;
    if (name === 'edit_media') return value.prompt || value.id || '';
    if (name === 'list_media') return value.query || value.kind || 'recent assets';
    if (name === 'create_paper') return value.title || U.truncate(value.content || '', 70);
    if (name === 'update_paper') return value.title || value.id || '';
    if (name === 'read_paper') return value.id || '';
    if (name === 'list_papers') return value.query || value.kind || 'recent papers';
    if (name === 'deliver_file') return value.title || value.path || '';
    if (name === 'todo_write') return `${(value.todos || []).length} items`;
    if (name.startsWith('mcp__')) {
      const entries = Object.entries(value).slice(0, 2).map(([key, val]) => `${key}: ${typeof val === 'object' ? JSON.stringify(val) : String(val)}`);
      return entries.join(' · ');
    }
    return value.path || '';
  }

  function clip(text, max = 20000) {
    const value = String(text == null ? '' : text);
    if (value.length <= max) return value;
    return `${value.slice(0, max)}\n\n… ${value.length - max} more characters`;
  }

  function formatArgs(name, args) {
    if (!args || !Object.keys(args).length) return '';
    if (name === 'run_command') return `$ ${args.command || ''}`;
    if (name === 'write_file') return `Path: ${args.path}\n\n${clip(args.content, 1200)}`;
    if (name === 'deliver_file') return `Path: ${args.path}${args.title ? `\nTitle: ${args.title}` : ''}${args.note ? `\n${args.note}` : ''}`;
    if (name === 'edit_file') {
      if (args.start_line != null || args.end_line != null) {
        const start = args.start_line ?? args.end_line;
        const end = args.end_line ?? args.start_line;
        return `Path: ${args.path}\n\nLines ${start}–${end}\n\n${clip(args.new_string || '(delete lines)', 1200)}`;
      }
      return `Path: ${args.path}\n\n- ${clip(args.old_string || '', 700)}\n\n+ ${clip(args.new_string || '', 1200)}`;
    }
    try { return JSON.stringify(args, null, 2); } catch { return String(args); }
  }

  function preBlock(text, className = 'tool-pre') {
    return `<div class="copy-block" data-copy-block><pre class="${className}" data-copy-body>${U.esc(text)}</pre><button class="copy-chip js-copy-block" type="button" title="Copy" aria-label="Copy">${icon('copy', 11)}</button></div>`;
  }

  function terminalMarkup(result, args) {
    const meta = result?.meta || {};
    const code = result?.isError ? (meta.exitCode ?? 'error') : (meta.exitCode ?? 0);
    const cwd = meta.cwd || 'workspace';
    const command = String(args?.command || '');
    return `<div class="tool-terminal" data-copy-block${command ? ` data-copy-command="${U.attr(command)}"` : ''}>
      <div class="tool-terminal-bar"><span class="tool-terminal-dots"><i></i><i></i><i></i></span><span>${U.esc(cwd)} · exit ${U.esc(code)}</span><button class="tool-terminal-copy js-copy-block" type="button" title="Copy command and output" aria-label="Copy command and output">${icon('copy', 11)}</button></div>
      <pre data-copy-body>${U.esc(clip(result?.content || '', 16000))}</pre>
    </div>`;
  }

  function tasksMarkup(tasks) {
    return `<div class="tool-task-list">${(tasks || []).map((task) => `<div class="tool-task ${U.esc(task.status || 'pending')}">
      <span class="tool-task-mark">${task.status === 'completed' ? icon('check', 9) : ''}</span>
      <span>${U.esc(task.content || '')}</span>
    </div>`).join('')}</div>`;
  }

  function mediaThumb(asset) {
    const kind = asset.kind || 'image';
    const src = asset.urls?.thumb || asset.urls?.preview || '';
    const inner = kind === 'audio'
      ? `<img src="${U.attr(src)}" alt="" loading="lazy" /><span class="media-thumb-play">${icon('play', 13)}</span>`
      : `<img src="${U.attr(src)}" alt="" loading="lazy" />`;
    return `<button class="tool-media-card" type="button" data-action="open-media" data-id="${U.attr(asset.id)}">
      <span class="tool-media-thumb ${U.attr(kind)}">${inner}</span>
      <span class="tool-media-copy"><b>${U.esc(asset.title || asset.kindLabel || 'Media')}</b><small>${U.esc(asset.kindLabel || kind)}${asset.width ? ` · ${asset.width}×${asset.height}` : ''}${asset.duration ? ` · ${U.esc(Math.round(asset.duration))}s` : ''}</small></span>
      <span class="tool-media-open">${icon('arrow-up-right', 12)}</span>
    </button>`;
  }

  function generatedMediaMarkup(asset) {
    const meta = [asset.engineLabel || asset.engine, asset.width && asset.height ? `${asset.width}×${asset.height}` : '', asset.duration ? `${Math.round(asset.duration)}s` : '']
      .filter(Boolean).join(' · ');
    return `<div class="msg msg-assistant generated-media-msg" data-media-asset="${U.attr(asset.id)}">
      <div class="assistant-main">
        <div class="generated-media-head">
          <span class="generated-media-label">${icon('sparkles', 13)}<span>${U.esc(asset.kindLabel || 'Media')} created</span></span>
          <span class="generated-media-meta">${U.esc(meta)}</span>
        </div>
        ${mediaThumb(asset)}
        <div class="generated-media-prompt">${U.esc(asset.prompt || asset.title || '')}</div>
        <div class="generated-media-actions">
          <button class="btn btn-secondary btn-xs" type="button" data-action="save-media" data-id="${U.attr(asset.id)}">${icon('download', 12)} Save file</button>
          <button class="btn btn-ghost btn-xs" type="button" data-action="save-media-workspace" data-id="${U.attr(asset.id)}">${icon('folder-open', 12)} To workspace</button>
        </div>
      </div>
    </div>`;
  }

  function deliverableMarkup(meta) {
    const fileName = meta.fileName || String(meta.path || '').split(/[\\/]/).pop();
    const details = [fileName, meta.bytes != null ? U.fmtBytes(meta.bytes) : '', meta.note || ''].filter(Boolean).join(' · ');
    return `<div class="tool-deliverable">
      <span class="tool-deliverable-mark">${icon('file-text', 16)}</span>
      <span class="tool-deliverable-copy"><b>${U.esc(meta.title || fileName)}</b><small>${U.esc(details)}</small></span>
      <button class="btn btn-secondary btn-xs" type="button" data-action="save-workspace-file" data-path="${U.attr(meta.path)}" data-name="${U.attr(fileName)}">${icon('download', 12)} Save file</button>
    </div>`;
  }

  function paperToolCard(paper) {    if (!paper || !paper.id) return '';
    const meta = {
      html: { label: 'Page', icon: 'book' },
      markdown: { label: 'Document', icon: 'file-text' },
      svg: { label: 'Graphic', icon: 'image' },
      code: { label: 'Code', icon: 'file-code' },
    }[paper.kind] || { label: 'Paper', icon: 'book' };
    return `<button class="tool-paper-card" type="button" data-action="open-paper" data-id="${U.attr(paper.id)}">
      <span class="tool-paper-mark">${icon(meta.icon, 15)}</span>
      <span class="tool-paper-copy"><b>${U.esc(paper.title || 'Untitled paper')}</b><small>${U.esc(meta.label)}${paper.version ? ` · v${U.esc(paper.version)}` : ''}${paper.bytes ? ` · ${U.esc(U.fmtBytes(paper.bytes))}` : ''}</small></span>
      <span class="tool-media-open">${icon('arrow-up-right', 12)}</span>
    </button>`;
  }

  function toolDetailsMarkup(name, args, result) {
    const meta = result?.meta || {};
    const content = result?.content || '';
    let html = '';
    if (meta.screenshot && meta.screenshot.url) {
      const shot = meta.screenshot;
      const lines = String(content).split('\n');
      const details = lines.slice(1).join('\n').trim();
      html += `<div class="tool-section-label">Screenshot${shot.width && shot.height ? ` · ${U.esc(shot.width)}×${U.esc(shot.height)}` : ''}</div>
        <button class="tool-screenshot" type="button" data-action="open-screenshot" data-path="${U.attr(shot.path)}" title="Open the full screenshot">
          <img src="${U.attr(shot.url)}" alt="Screen capture" loading="lazy">
          <span class="tool-screenshot-open">${icon('arrow-up-right', 12)}</span>
        </button>`;
      if (details) html += preBlock(clip(details, 2000), 'tool-pre tool-screenshot-note');
    } else if (Array.isArray(meta.media) && meta.media.length) {
      html += `<div class="tool-section-label">${meta.media.length} asset${meta.media.length === 1 ? '' : 's'} in your media library</div><div class="tool-media-grid">${meta.media.map(mediaThumb).join('')}</div>`;
      if (content) html += `<div class="tool-section-label" style="margin-top:8px">Summary</div>${preBlock(clip(content, 3000))}`;
    } else if (meta.paper && meta.paper.id) {
      html += `<div class="tool-section-label">Paper</div>${paperToolCard(meta.paper)}`;
      if (content) html += `<div class="tool-section-label" style="margin-top:8px">Summary</div>${preBlock(clip(content, 2400))}`;
    } else if (Array.isArray(meta.papers) && meta.papers.length) {
      html += `<div class="tool-section-label">${meta.papers.length} paper${meta.papers.length === 1 ? '' : 's'} in the library</div><div class="tool-paper-list">${meta.papers.slice(0, 6).map(paperToolCard).join('')}</div>`;
      if (content) html += `<div class="tool-section-label" style="margin-top:8px">Summary</div>${preBlock(clip(content, 2400))}`;
    } else if (meta.deliverable && meta.path) {
      html += `<div class="tool-section-label">File</div>${deliverableMarkup(meta)}`;
      if (content) html += `<div class="tool-section-label" style="margin-top:8px">Summary</div>${preBlock(clip(content, 2400))}`;
    } else if (name === 'todo_write') {
      const tasks = meta.tasks || args?.todos || [];
      html += `<div class="tool-section-label">Plan</div>${tasksMarkup(tasks)}`;
    } else if (name === 'run_command') {
      html += terminalMarkup(result, args);
    } else if (name === 'web_fetch') {
      const url = meta.url || args?.url || '';
      html += `${url ? `<div class="tool-section-label">URL</div><a class="md-link" href="${U.attr(url)}" target="_blank" rel="noreferrer">${U.esc(url)}</a>` : ''}
        <div class="tool-section-label" style="margin-top:8px">Readable text</div>${preBlock(clip(content, 14000))}`;
    } else {
      if (content) {
        html += `<div class="tool-section-label">${result?.isError ? 'Error' : 'Result'}</div>${preBlock(clip(content, 14000))}`;
      }
      if (name === 'edit_file' || name === 'write_file') {
        const diff = formatArgs(name, args);
        if (diff) html += `<div class="tool-section-label" style="margin-top:8px">Change</div>${preBlock(clip(diff, 4000), 'tool-pre tool-args')}`;
      }
    }
    const badges = [];
    if (meta.path) badges.push(`<span class="tool-badge">${U.esc(meta.path)}</span>`);
    if (meta.count != null) badges.push(`<span class="tool-badge">${U.esc(meta.count)} result${Number(meta.count) === 1 ? '' : 's'}</span>`);
    if (meta.exitCode != null) badges.push(`<span class="tool-badge ${Number(meta.exitCode) === 0 ? 'ok' : 'bad'}">exit ${U.esc(meta.exitCode)}</span>`);
    if (meta.additions || meta.removals) badges.push(`<span class="tool-badge ok">+${U.esc(meta.additions || 0)}</span><span class="tool-badge bad">−${U.esc(meta.removals || 0)}</span>`);
    if (meta.checkpointId) {
      badges.push(`<button class="tool-undo" type="button" data-action="undo-checkpoint" data-checkpoint="${U.attr(meta.checkpointId)}">${icon('undo', 11)} Undo change</button>`);
    }
    if (meta.path) {
      badges.push(`<button class="tool-undo" type="button" data-action="open-file" data-path="${U.attr(meta.path)}">${icon('file-text', 11)} Open</button>`);
    }
    if ((name === 'write_file' || name === 'edit_file') && meta.path) {
      const fileName = String(meta.path).split(/[\\/]/).pop();
      badges.push(`<button class="tool-undo" type="button" data-action="save-workspace-file" data-path="${U.attr(meta.path)}" data-name="${U.attr(fileName)}">${icon('download', 11)} Save file</button>`);
    }
    if (name.startsWith('mcp__')) {
      const [, server] = name.split('__');
      badges.push(`<span class="tool-badge">MCP · ${U.esc(server)}</span>`);
    }
    if (badges.length) html += `<div class="tool-badges">${badges.join('')}</div>`;
    if (!html) html = preBlock(formatArgs(name, args) || 'No details.');
    return html;
  }

  function buildToolCard(call, result, options = {}) {
    const name = call.name || '';
    const label = toolLabel(name, options.label);
    const args = call.args || {};
    const summary = options.summary || summarizeTool(name, args);
    const running = !result && options.running;
    const isError = Boolean(result?.isError);
    const iconName = toolIconName(name);
    const status = running
      ? `<span class="spinner"></span>`
      : isError
        ? icon('alert-circle', 13)
        : icon('check', 13);
    const statusClass = running ? 'run' : isError ? 'bad' : 'ok';
    const duration = options.duration ? `<span>${U.esc(options.duration)}</span>` : '';
    const card = document.createElement('div');
    const delivered = name === 'deliver_file' && result && !result.isError;
    card.className = `tool-card${running ? ' running' : ''}${isError ? ' error open' : delivered ? ' open' : ''}`;
    card.dataset.callId = call.id || '';
    card.innerHTML = `
      <button class="tool-head" type="button" data-action="toggle-tool">
        <span class="tool-icon">${icon(iconName, 12)}</span>
        <span class="tool-label">${U.esc(label)}</span>
        <span class="tool-summary">${U.esc(summary || '')}</span>
        <span class="tool-meta">${duration}</span>
        ${!running && result ? `<span class="tool-status ${statusClass}">${status}</span>` : `<span class="tool-status run"><span class="spinner"></span></span>`}
        <span class="tool-chevron">${icon('chevron-right', 12)}</span>
      </button>
      <div class="tool-details">${toolDetailsMarkup(name, args, result)}</div>`;
    return card;
  }

  function approvalArgs(args) {
    if (!args) return '';
    if (args.command) return `$ ${args.command}`;
    if (args.old_string !== undefined || args.new_string !== undefined) {
      const lines = [];
      if (args.path) lines.push(`Path: ${args.path}`, '');
      if (args.old_string) lines.push(...String(args.old_string).split('\n').map((line) => `- ${line}`));
      if (args.new_string) lines.push(...String(args.new_string).split('\n').map((line) => `+ ${line}`));
      return lines.join('\n');
    }
    try { return JSON.stringify(args, null, 2); } catch { return String(args); }
  }

  const APPROVAL_REASONS = {
    'sensitive-file': 'Sensitive file',
    'sensitive-data': 'Secrets',
    destructive: 'Destructive',
    external: 'External',
    network: 'Network',
    install: 'Installs packages',
    privilege: 'System access',
    system: 'System change',
    write: 'Outside workspace',
    unknown: 'Unfamiliar command',
    remote: 'Remote host',
    policy: 'Your policy',
  };

  function buildApproval(payload) {
    const card = document.createElement('div');
    card.className = 'approval-card';
    card.dataset.approvalCard = payload.approvalId;
    card.dataset.approvalId = payload.approvalId;
    const tool = payload.tool || 'tool';
    const friendly = payload.label || toolLabel(tool);
    const details = approvalArgs(payload.args);
    const reason = APPROVAL_REASONS[payload.reason] || APPROVAL_REASONS.policy;
    const scope = tool === 'run_command' || tool === 'ssh_run'
      ? 'command'
      : payload.reason === 'sensitive-file' ? 'file' : 'tool';
    card.dataset.approvalScope = scope;
    const alwaysLabel = scope === 'command' ? 'Always allow this command' : scope === 'file' ? 'Always allow this file' : 'Always allow';
    const policy = scope === 'command' ? 'This exact command · this session' : scope === 'file' ? 'This exact file · this session' : 'Approval required by your policy';
    card.innerHTML = `
      <div class="approval-head">
        <span class="approval-icon">${icon('shield-alert', 14)}</span>
        <div class="approval-copy">
          <div class="approval-title">blank wants to <b>${U.esc(friendly.toLowerCase())}</b><span class="approval-reason">${U.esc(reason)}</span></div>
          <div class="approval-sub">${U.esc(payload.summary || summarizeTool(tool, payload.args) || tool)}</div>
        </div>
      </div>
      <div class="approval-body">
        ${details ? `<div class="copy-block" data-copy-block><div class="approval-args" data-copy-body>${U.esc(clip(details, 4000))}</div><button class="copy-chip js-copy-block" type="button" title="Copy" aria-label="Copy">${icon('copy', 11)}</button></div>` : ''}
      </div>
      <div class="approval-foot">
        <span class="approval-policy">${U.esc(policy)}</span>
        <button class="btn btn-ghost btn-sm" type="button" data-action="approval" data-decision="deny">Deny</button>
        <button class="btn btn-secondary btn-sm" type="button" data-action="approval" data-decision="always">${alwaysLabel}</button>
        <button class="btn btn-primary btn-sm" type="button" data-action="approval" data-decision="allow">Allow once</button>
      </div>`;
    return card;
  }

  function markApproval(card, decision) {
    if (!card || card.dataset.resolved) return;
    card.dataset.resolved = decision;
    const foot = card.querySelector('.approval-foot');
    if (foot) foot.remove();
    const scope = card.dataset.approvalScope || 'tool';
    const alwaysText = scope === 'command' ? 'Command allowed for this session' : scope === 'file' ? 'File allowed for this session' : 'Allowed for this session';
    const labels = { allow: ['ok', 'Allowed once'], always: ['ok', alwaysText], deny: ['no', 'Denied'], expired: ['no', 'Request expired'] };
    const [tone, text] = labels[decision] || labels.expired;
    const note = document.createElement('div');
    note.className = `approval-resolved ${tone}`;
    note.innerHTML = `${icon(tone === 'ok' ? 'check-circle' : 'alert-circle', 13)}<span>${text}</span>`;
    card.appendChild(note);
  }

  function userMessageMarkup(message) {
    const attachments = (message.attachments || []).map((file) => `<span class="attachment-chip">${icon('file-text', 11)}<span>${U.esc(file.name)}</span></span>`).join('');
    return `<div class="msg msg-user" data-message-id="${U.attr(message.id || '')}">
      <div>
        <div class="user-bubble"><div class="user-text">${U.esc(message.content || '')}</div>${attachments ? `<div class="user-attachments">${attachments}</div>` : ''}</div>
        <div class="msg-user-meta"><span>${U.fmtTime(message.at)}</span><button class="msg-action" type="button" data-action="copy-user" title="Copy message">${icon('copy', 12)}</button></div>
      </div>
    </div>`;
  }

  function reasoningMarkup(text) {
    return `<div class="reasoning">
      <button class="reasoning-toggle" type="button" data-action="toggle-reasoning">
        <span class="chev">${icon('chevron-right', 11)}</span>
        <span class="reasoning-label">Thought for a moment</span>
      </button>
      <div class="reasoning-body">${U.esc(text || '')}</div>
    </div>`;
  }

  function buildAssistantMessage(message, results, options = {}) {
    const element = document.createElement('div');
    element.className = 'msg msg-assistant';
    element.dataset.messageId = message.id || '';
    const reasoning = message.reasoning && App.state.config?.agent?.showReasoning !== false ? reasoningMarkup(message.reasoning) : '';
    const tools = (message.toolCalls || []).map((call) => {
      const result = results.get(call.id) || null;
      return buildToolCard(call, result, {
        label: call.label,
        running: !result,
        duration: result?.duration,
      });
    });
    element.innerHTML = `
      <div class="assistant-main">
        ${assistantHead(message.model)}
        ${reasoning}
        <div class="assistant-text md"></div>
        <div class="tool-stack"></div>
        <div class="approval-host"></div>
        ${message.content ? actionsMarkup(message.id) : ''}
      </div>`;
    const textNode = element.querySelector('.assistant-text');
    textNode.innerHTML = MD.render(message.content || '');
    const timeNode = element.querySelector('.assistant-time');
    if (timeNode) timeNode.textContent = message.at ? U.fmtTime(message.at) : '';
    const stack = element.querySelector('.tool-stack');
    for (const tool of tools) stack.appendChild(tool);
    if (message.content) {
      const actions = element.querySelector('.msg-actions');
      if (actions) {
        const undo = collectCheckpoints(message);
        if (undo.length) {
          const button = document.createElement('button');
          button.className = 'msg-action';
          button.type = 'button';
          button.dataset.action = 'undo-checkpoint';
          button.dataset.checkpoint = undo[0].id;
          button.innerHTML = `${icon('undo', 12)}<span>Undo files</span>`;
          actions.insertBefore(button, actions.querySelector('.msg-action[data-action="open-session-menu"]'));
        }
      }
    }
    return element;
  }

  function collectCheckpoints(message) {
    const results = new Map();
    for (const toolMessage of Chat.session?.messages || []) {
      if (toolMessage.role === 'tool') results.set(toolMessage.toolCallId, toolMessage);
    }
    const out = [];
    for (const call of message.toolCalls || []) {
      const result = results.get(call.id);
      if (result?.meta?.checkpointId) out.push({ id: result.meta.checkpointId, name: result.meta.path || call.name });
    }
    return out;
  }

  function renderHead() {
    const session = Chat.session;
    const mode = currentMode();
    const modelId = currentModel();
    const provider = providerOf(modelId);
    const title = session?.title || 'New session';
    const count = session?.messages?.length || 0;
    const compacted = Boolean(session?.summary);
    const subtitle = [
      `${count} message${count === 1 ? '' : 's'}`,
      modeOf(mode).label,
      ...(compacted ? ['Context compacted'] : []),
    ].join(' · ');
    const headMain = document.getElementById('chat-head-main');
    const headActions = document.getElementById('chat-head-actions');
    if (!headMain || !headActions) return;
    headMain.innerHTML = `<div class="chat-title-line">
        <span class="chat-title" title="${U.attr(title)}">${U.esc(title)}</span>
        <span class="mode-chip ${mode}">${U.esc(modeOf(mode).label)}</span>
      </div>
      <div class="chat-sub"><span class="sub-item">${U.esc(subtitle)}</span></div>`;
    headActions.innerHTML = `
      <button class="chip-button ${modelId ? '' : 'needs-model'}" type="button" data-action="pick-model" title="${modelId ? 'Switch model' : 'Choose a model'}">
        ${provider ? UI.providerMono(provider) : `<span class="chip-empty-icon">${icon('cpu', 11)}</span>`}
        <span class="chip-model-name">${U.esc(modelId ? modelName(modelId) : 'Choose a model')}</span>
        <span class="ws-caret">${icon('chevron-updown', 11)}</span>
      </button>
      <span class="head-sep"></span>
      <button class="head-icon-btn ${App.state.config?.ui?.railOpen ? 'active' : ''}" type="button" data-action="toggle-rail" title="Toggle context panel">${icon('panel-right', 15)}</button>
      <button class="head-icon-btn" type="button" data-action="session-menu" title="Session options">${icon('more-horizontal', 16)}</button>`;
  }

  function usageSnapshot() {
    const modelId = currentModel();
    const model = modelId ? U.modelOf(catalog(), modelId) : null;
    const limit = Number(model?.context) || (modelId ? 128000 : 0);
    const usage = Chat.session?.usage || { input: 0, output: 0 };
    const input = Number(usage.input || 0);
    const output = Number(usage.output || 0);
    const sessionTotal = input + output;
    const contextTokens = Number(Chat.session?.contextTokens) || 0;
    const total = contextTokens > 0 ? contextTokens : sessionTotal;
    const remaining = limit ? Math.max(0, limit - total) : 0;
    const usedPct = limit ? Math.min(100, Math.round((total / limit) * 100)) : 0;
    const leftPct = limit ? Math.max(0, 100 - usedPct) : 0;
    return { modelId, model, limit, input, output, total, sessionTotal, remaining, usedPct, leftPct };
  }

  function contextChip() {
    const snapshot = usageSnapshot();
    const r = 6.6;
    const c = 2 * Math.PI * r;
    const filled = snapshot.limit ? snapshot.total / snapshot.limit : 0;
    const low = snapshot.modelId && snapshot.limit && snapshot.leftPct <= 15;
    const label = snapshot.modelId ? `${snapshot.leftPct}% left` : '—';
    return `<span class="context-ring ${low ? 'low' : ''}">
      <svg width="16" height="16" viewBox="0 0 18 18">
        <circle cx="9" cy="9" r="${r}" fill="none" stroke="var(--border)" stroke-width="1.8"/>
        <circle cx="9" cy="9" r="${r}" fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - Math.max(0.03, Math.min(1, filled)))}" transform="rotate(-90 9 9)" opacity="${filled > 0 ? 0.9 : 0.35}"/>
      </svg>
    </span><span class="context-chip-label ${low ? 'low' : ''}">${U.esc(label)}</span>`;
  }

  function openUsagePanel(anchor) {
    if (!anchor) return;
    const snapshot = usageSnapshot();
    const content = document.createElement('div');
    content.className = 'usage-panel';
    if (!snapshot.modelId) {
      content.innerHTML = `<div class="usage-head"><span class="usage-title">Context usage</span></div>
        <div class="usage-note">Choose a model to see how much context remains.</div>`;
    } else {
      content.innerHTML = `<div class="usage-head">
          <span class="usage-title">Context usage</span>
          <span class="usage-model">${U.esc(snapshot.model?.name || modelName(snapshot.modelId))}</span>
        </div>
        <div class="usage-hero"><span class="usage-value">${U.fmtNumber(snapshot.remaining)}</span><span class="usage-unit">tokens left</span></div>
        <div class="usage-meter ${snapshot.leftPct <= 15 ? 'low' : ''}"><span style="width:${Math.max(snapshot.usedPct ? 2 : 0, snapshot.usedPct)}%"></span></div>
        <div class="usage-rows">
          <div class="usage-row"><span>In context</span><b>${U.fmtNumber(snapshot.total)}</b></div>
          <div class="usage-row"><span>Session total</span><b>${U.fmtNumber(snapshot.sessionTotal)}</b></div>
          <div class="usage-row"><span>Context limit</span><b>${U.fmtNumber(snapshot.limit)}</b></div>
        </div>
        <div class="usage-foot">${icon('info', 10)}<span>blank summarizes earlier turns near the limit.</span></div>`;
    }
    UI.popover(anchor, content, { width: 252, align: 'end', placement: 'top' });
  }

  function updateComposer() {
    const input = document.getElementById('composer-input');
    const modeButton = document.getElementById('composer-mode');
    const reasoningButton = document.getElementById('composer-reasoning');
    const context = document.getElementById('composer-context');
    const hint = document.getElementById('composer-approval-hint');
    const send = document.getElementById('composer-send');
    if (!input || !modeButton) return;
    const mode = currentMode();
    modeButton.innerHTML = `${icon(modeOf(mode).icon, 13)}<span>${U.esc(modeOf(mode).label)}</span><span class="ws-caret">${icon('chevron-updown', 10)}</span>`;
    if (reasoningButton) {
      const profile = reasoningProfile();
      const effort = currentReasoning();
      const label = profile ? U.reasoningLabel(profile, effort) : 'Model decides';
      const adjustable = Boolean(profile && profile.levels.length > 1);
      reasoningButton.hidden = false;
      reasoningButton.disabled = !adjustable;
      reasoningButton.classList.toggle('is-fixed', !adjustable);
      reasoningButton.innerHTML = `${icon('brain', 13)}<span>${U.esc(label)}</span>${adjustable ? `<span class="ws-caret">${icon('chevron-updown', 10)}</span>` : ''}`;
      reasoningButton.title = profile ? `Reasoning · ${label}` : 'Reasoning · this model does not expose stages';
      reasoningButton.classList.toggle('active', adjustable && effort !== 'none');
      if (profile?.source === 'fallback') requestReasoningCheck();
    }
    const approvalButton = document.getElementById('composer-approval');
    if (approvalButton) {
      const preset = approvalPreset();
      const meta = APPROVAL_PRESETS[preset];
      approvalButton.classList.toggle('is-auto', preset === 'auto');
      approvalButton.classList.toggle('is-all', preset === 'all');
      approvalButton.innerHTML = `${icon(meta.icon, 13)}<span class="approval-mode-label">${U.esc(meta.label)}</span>`;
      approvalButton.title = meta.title;
      approvalButton.setAttribute('aria-label', meta.title);
    }
    const modelButton = document.getElementById('composer-model');
    if (modelButton) {
      const modelId = currentModel();
      const provider = providerOf(modelId);
      modelButton.classList.toggle('needs-model', !modelId);
      modelButton.innerHTML = `${provider ? UI.providerMono(provider) : icon('cpu', 12)}<span class="composer-tool-label">${U.esc(modelId ? modelName(modelId) : 'Choose a model')}</span><span class="ws-caret">${icon('chevron-updown', 10)}</span>`;
      modelButton.title = modelId ? `Model · ${modelName(modelId)}` : 'Choose a model';
    }
    input.placeholder = mode === 'plan'
      ? 'Describe what you want planned. Reads only.'
      : mode === 'ask'
        ? 'Ask a question about your codebase…'
        : mode === 'design'
          ? 'Describe the interface you want to design…'
          : mode === 'coding'
            ? 'Describe the code change. blank will read, edit, and run checks…'
            : 'Ask blank to build, debug, or explain…';
    if (context) context.innerHTML = contextChip();
    if (hint) {
      const perms = App.state.config?.permissions || {};
      const guarded = ['write_file', 'edit_file', 'run_command', 'ssh_run', 'mcp', 'computer_use', 'generate_media', 'edit_media']
        .filter((tool) => (perms[tool] || 'ask') !== 'allow');
      const mode = ['all', 'auto'].includes(App.state.config?.approvals?.mode)
        ? App.state.config.approvals.mode
        : 'important';
      hint.innerHTML = mode === 'auto'
        ? `${icon('zap', 11)}<span>No approvals · every action runs</span>`
        : !guarded.length
          ? `${icon('shield', 11)}<span>Auto-approved by your policy</span>`
          : mode === 'all'
            ? `${icon('shield', 11)}<span>Asks before every guarded action</span>`
            : `${icon('shield', 11)}<span>Asks only for important actions</span>`;
      hint.classList.toggle('warn', mode === 'auto' || (guarded.length > 0 && mode === 'all'));
    }
    if (send) {
      if (Chat.running) {
        send.disabled = !input.value.trim() && !Chat.attachments.length;
        send.classList.remove('stop');
        send.innerHTML = icon('arrow-up', 15);
        send.title = Chat.queue.length ? `Queue message · ${Chat.queue.length} waiting` : 'Queue message';
      } else if (Chat.sending) {
        send.disabled = true;
        send.classList.remove('stop');
        send.innerHTML = '<span class="spinner" style="color:var(--text-faint)"></span>';
        send.title = 'Starting…';
      } else {
        send.classList.remove('stop');
        send.innerHTML = icon('arrow-up', 15);
        send.title = 'Send';
        updateSendEnabled();
      }
    }
    const stop = document.getElementById('composer-stop');
    if (stop) {
      stop.hidden = !Chat.running || Chat.sending;
      if (Chat.running) {
        stop.disabled = false;
        stop.innerHTML = icon('stop', 12);
        stop.title = 'Stop run';
      }
    }
    const enterHint = document.getElementById('composer-enter-hint');
    if (enterHint) {
      const sendKey = U.isMac ? '⌘ Enter' : 'Ctrl Enter';
      enterHint.innerHTML = Chat.running
        ? `<kbd>Enter</kbd> <span>queue</span> · <kbd>${sendKey}</kbd> <span>stop &amp; send</span>`
        : `<kbd>Enter</kbd> / <kbd>${sendKey}</kbd> send`;
      window.__blankI18n?.translate?.(enterHint);
    }
    renderQueue();
  }

  function updateSendEnabled() {
    const input = document.getElementById('composer-input');
    const send = document.getElementById('composer-send');
    if (!input || !send || Chat.sending) return;
    send.disabled = !input.value.trim() && !Chat.attachments.length;
  }

  function renderQueue() {
    const tray = document.getElementById('queue-tray');
    if (!tray) return;
    const items = Chat.queue || [];
    tray.hidden = !items.length;
    if (!items.length) { tray.innerHTML = ''; return; }
    const urgent = items.some((item) => item.interrupt);
    tray.innerHTML = `<div class="queue-head">${icon('clock', 11)}<span>${items.length} queued message${items.length === 1 ? '' : 's'}</span><span class="queue-note">${urgent ? 'Sends as soon as this run stops' : 'Sends when this run finishes'}</span></div>
      <div class="queue-list">${items.map((item) => `<div class="queue-item${item.interrupt ? ' is-next' : ''}">
        ${item.interrupt ? '<span class="queue-next">Next</span>' : ''}
        <span class="queue-text">${U.esc(item.text || 'Attachment')}</span>
        <button class="queue-remove" type="button" data-action="queue-remove" data-queue-id="${U.attr(item.queueId)}" title="Remove from queue" aria-label="Remove from queue">${icon('x', 10)}</button>
      </div>`).join('')}</div>`;
    window.__blankI18n?.translate?.(tray);
  }

  function generatedMediaFor() {
    const key = Chat.session?.id || 'draft';
    return (Chat.generatedMedia && Chat.generatedMedia[key]) || [];
  }

  function sessionGeneratedMedia() {
    const seen = new Set();
    const out = [];
    for (const message of Chat.session?.messages || []) {
      if (message.role !== 'tool' || !Array.isArray(message.meta?.media)) continue;
      if (message.name !== 'generate_media' && message.name !== 'edit_media') continue;
      for (const asset of message.meta.media) {
        if (!asset || !asset.id || seen.has(asset.id)) continue;
        seen.add(asset.id);
        out.push(asset);
      }
    }
    return out;
  }

  /* Studio jobs live in memory; agent tool results persist in session messages. */
  function allGeneratedMedia() {
    const seen = new Set();
    const out = [];
    for (const asset of [...sessionGeneratedMedia(), ...generatedMediaFor()]) {
      if (!asset || !asset.id || seen.has(asset.id)) continue;
      seen.add(asset.id);
      out.push(asset);
    }
    return out;
  }

  function hasMediaCard(id) {
    const thread = document.querySelector('.chat-thread');
    if (!thread || !id) return false;
    return [...thread.querySelectorAll('[data-media-asset]')].some((node) => node.dataset.mediaAsset === id);
  }

  function toggleMediaPanel() {
    const panel = document.getElementById('chat-media-panel');
    if (!panel) return;
    if (!panel.hidden) { window.Views?.closeStudio?.(); return; }
    window.Views?.openStudio?.({ container: panel });
  }

  async function saveMediaFile(id, button) {
    if (!id) return;
    if (button) button.disabled = true;
    try {
      const result = await API.media.exportAsset(id);
      if (result && !result.canceled) {
        UI.toast(`Saved to ${result.path}`, 'success', {
          title: 'Media file',
          actionLabel: 'Reveal',
          onAction: () => API.media.reveal(id).catch(() => {}),
          timeout: 9000,
        });
      }
    } catch (error) { UI.toast(error.message, 'error'); }
    finally { if (button) button.disabled = false; }
  }

  async function saveWorkspaceFile(relativePath, name, button) {
    if (!relativePath) return;
    if (button) button.disabled = true;
    try {
      const result = await API.workspace.saveAs({ path: relativePath, name });
      if (result && !result.canceled) UI.toast(`Saved to ${result.path}`, 'success', { title: 'File saved', timeout: 9000 });
    } catch (error) { UI.toast(error.message, 'error'); }
    finally { if (button) button.disabled = false; }
  }

  async function saveMediaToWorkspace(id, button) {
    if (!id) return;
    if (button) button.disabled = true;
    try {
      const result = await API.media.saveToWorkspace({ id, folder: 'media' });
      UI.toast(`Saved as ${result.relative}`, 'success', {
        title: 'Copied into workspace',
        actionLabel: 'Reveal',
        onAction: () => API.workspace.reveal(result.relative).catch(() => {}),
        timeout: 9000,
      });
    } catch (error) { UI.toast(error.message, 'error'); }
    finally { if (button) button.disabled = false; }
  }

  /* --------------------------------------------------------------- dictation */

  function dictationButtonLabel(button, label) {
    const text = button?.querySelector('span');
    if (text) text.textContent = label;
    if (button) {
      const title = label === 'Dictate' ? 'Dictate with your voice' : label;
      button.title = title;
      button.setAttribute('aria-label', title);
    }
  }

  function resetDictationButton(state) {
    const button = state?.button;
    if (!button) return;
    button.classList.remove('recording', 'transcribing');
    button.disabled = false;
    dictationButtonLabel(button, 'Dictate');
  }

  function insertDictation(text) {
    const input = document.getElementById('composer-input');
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!input || !clean) return;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    const before = input.value.slice(0, start);
    const after = input.value.slice(end);
    const pad = before && !/\s$/.test(before) ? ' ' : '';
    const tail = after && !/^\s/.test(after) ? ' ' : '';
    input.value = `${before}${pad}${clean}${tail}${after}`;
    const caret = before.length + pad.length + clean.length + tail.length;
    input.setSelectionRange(caret, caret);
    input.focus();
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const value = String(reader.result || '');
        resolve(value.slice(value.indexOf(',') + 1));
      };
      reader.onerror = () => reject(new Error('Could not read the recording.'));
      reader.readAsDataURL(blob);
    });
  }

  function finishDictation(state) {
    if (Chat.dictation !== state) return;
    Chat.dictation = null;
    clearTimeout(state.timer);
    try { state.stream.getTracks().forEach((track) => track.stop()); } catch {}
    if (state.cancelled) { resetDictationButton(state); return; }
    const blob = new Blob(state.chunks, { type: state.recorder.mimeType || 'audio/webm' });
    if (!blob.size) { resetDictationButton(state); UI.toast('No audio was captured.', 'warn'); return; }
    const button = state.button;
    if (button) {
      button.classList.remove('recording');
      button.classList.add('transcribing');
      button.disabled = true;
      dictationButtonLabel(button, 'Transcribing…');
    }
    blobToBase64(blob)
      .then((audio) => API.dictation.transcribe({ audio, mime: blob.type }))
      .then((result) => {
        if (!result?.text) throw new Error('No speech was detected.');
        insertDictation(result.text);
      })
      .catch((error) => UI.toast(error.message, 'error', { title: 'Dictation' }))
      .finally(() => resetDictationButton(state));
  }

  function stopDictation(cancel = false) {
    const state = Chat.dictation;
    if (!state) return;
    state.cancelled = cancel;
    clearTimeout(state.timer);
    if (state.recorder.state !== 'inactive') {
      try { state.recorder.stop(); } catch { finishDictation(state); }
    } else {
      finishDictation(state);
    }
  }

  async function startDictation(button) {
    if (Chat.dictation) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      UI.toast('This build cannot record audio.', 'error');
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    } catch (error) {
      UI.toast(error?.name === 'NotAllowedError' ? 'Microphone access was denied. Allow it in your system settings and try again.' : error.message, 'error', { title: 'Dictation' });
      return;
    }
    const mime = typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';
    let recorder;
    try { recorder = new MediaRecorder(stream, { mimeType: mime }); }
    catch { recorder = new MediaRecorder(stream); }
    const state = { stream, recorder, chunks: [], button, timer: null, cancelled: false };
    Chat.dictation = state;
    recorder.addEventListener('dataavailable', (event) => { if (event.data?.size) state.chunks.push(event.data); });
    recorder.addEventListener('stop', () => finishDictation(state));
    recorder.addEventListener('error', () => {
      UI.toast('Recording failed. Try again.', 'error', { title: 'Dictation' });
      state.cancelled = true;
      stopDictation(true);
    });
    try {
      recorder.start();
    } catch (error) {
      Chat.dictation = null;
      try { stream.getTracks().forEach((track) => track.stop()); } catch {}
      UI.toast(error.message, 'error', { title: 'Dictation' });
      return;
    }
    if (button) {
      button.classList.add('recording');
      dictationButtonLabel(button, 'Listening…');
    }
    state.timer = setTimeout(() => stopDictation(false), 60000);
    UI.toast('Listening. Click the mic again to stop and transcribe.', 'info', { timeout: 4000 });
  }

  function toggleDictation(button) {
    if (Chat.dictation) stopDictation(false);
    else startDictation(button);
  }

  Chat.showGeneratedMedia = function showGeneratedMedia(asset) {
    if (!asset || !asset.id) return;
    Chat.generatedMedia = Chat.generatedMedia || {};
    const key = Chat.session?.id || 'draft';
    const list = Chat.generatedMedia[key] || (Chat.generatedMedia[key] = []);
    if (!list.some((item) => item.id === asset.id)) list.push(asset);
    const thread = ensureThread();
    if (!thread) return;
    if (!hasMediaCard(asset.id)) thread.insertAdjacentHTML('beforeend', generatedMediaMarkup(asset));
    U.scrollToBottom(document.getElementById('chat-scroll'), true);
  };

  function renderAttachments() {
    const host = document.getElementById('composer-attachments');
    if (!host) return;
    host.innerHTML = Chat.attachments.map((file, index) => `<span class="composer-attach">${icon('file-text', 11)}<span>${U.esc(file.name)}</span><button type="button" data-action="remove-attachment" data-index="${index}" aria-label="Remove">${icon('x', 10)}</button></span>`).join('');
    updateSendEnabled();
  }

  /* --------------------------------------------------------------- empty view */

  function showEmpty() {
    const scroll = document.getElementById('chat-scroll');
    if (!scroll) return;
    const modelId = currentModel();
    const provider = providerOf(modelId);
    const canChooseModel = !modelId && U.selectableModels(catalog(), App.state.config).length > 0;
    scroll.innerHTML = `<div class="chat-empty">
      ${modelId ? '' : `<div class="empty-model-banner">
        <span class="empty-model-icon">${icon('cpu', 14)}</span>
        <span class="empty-model-text">${canChooseModel ? 'Choose a model to start.' : 'No model connected. Add a provider key in Models to start.'}</span>
        <button class="btn btn-secondary btn-xs" type="button" data-action="${canChooseModel ? 'pick-model' : 'open-models'}">${canChooseModel ? 'Choose model' : 'Open Models'}</button>
      </div>`}
      <div class="hero">
        <div class="hero-brand" aria-hidden="true">
          <svg viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#2F6BFF"/><path d="M8.6 4.4h4.6l4 4v9.2c0 .9-.7 1.6-1.6 1.6H8.6c-.9 0-1.6-.7-1.6-1.6V6c0-.9.7-1.6 1.6-1.6Z" fill="#fff"/><path d="M13.2 4.4v4h4Z" fill="#DCE7FF"/></svg>
        </div>
        <h1>What should we build?</h1>
        <div class="suggestion-grid">
          <button class="suggestion" type="button" data-action="suggest" data-suggest="tour">
            <span class="suggestion-icon">${icon('zap', 14)}</span>
            <span class="suggestion-copy"><span class="suggestion-title">Tour the harness</span><span class="suggestion-text">Watch real tools run, end to end.</span></span>
          </button>
          <button class="suggestion" type="button" data-action="suggest" data-suggest="inspect">
            <span class="suggestion-icon">${icon('folder-open', 14)}</span>
            <span class="suggestion-copy"><span class="suggestion-title">Inspect this workspace</span><span class="suggestion-text">Map the project and its conventions.</span></span>
          </button>
          <button class="suggestion" type="button" data-action="suggest" data-suggest="plan">
            <span class="suggestion-icon">${icon('checklist', 14)}</span>
            <span class="suggestion-copy"><span class="suggestion-title">Plan before code</span><span class="suggestion-text">Think in read-only Plan mode.</span></span>
          </button>
          <button class="suggestion" type="button" data-action="suggest" data-suggest="review">
            <span class="suggestion-icon">${icon('shield', 14)}</span>
            <span class="suggestion-copy"><span class="suggestion-title">Review a change</span><span class="suggestion-text">Find correctness and security gaps.</span></span>
          </button>
          <button class="suggestion" type="button" data-action="suggest" data-suggest="design">
            <span class="suggestion-icon">${icon('palette', 14)}</span>
            <span class="suggestion-copy"><span class="suggestion-title">Design a page</span><span class="suggestion-text">Build a clean interface in Design mode.</span></span>
          </button>
          <button class="suggestion" type="button" data-action="suggest" data-suggest="audio">
            <span class="suggestion-icon">${icon('music', 14)}</span>
            <span class="suggestion-copy"><span class="suggestion-title">Compose audio</span><span class="suggestion-text">Make a track or voiceover.</span></span>
          </button>
        </div>
        <div class="hero-foot">
          <span>${modelId ? `${U.esc(provider ? provider.name : 'blank')} · ${U.esc(modelName(modelId))}` : canChooseModel ? 'Choose a model' : 'No model connected'}</span>
          <span>·</span>
          <span><kbd>${U.kbd('Ctrl K')}</kbd> commands</span>
        </div>
      </div>
    </div>`;
  }

  function refreshEmptyState() {
    const scroll = document.getElementById('chat-scroll');
    if (!scroll || Chat.running || Chat.sending) return;
    if (Chat.session?.messages?.length) return;
    if (!scroll.querySelector('.hero')) return;
    showEmpty();
  }

  /* ----------------------------------------------------------------- thread */

  function ensureThread() {
    const scroll = document.getElementById('chat-scroll');
    if (!scroll) return null;
    let thread = scroll.querySelector('.chat-thread');
    if (!thread) {
      scroll.innerHTML = '<div class="chat-thread"></div>';
      thread = scroll.querySelector('.chat-thread');
      if (Chat.session?.summary) {
        const divider = document.createElement('div');
        divider.className = 'compact-divider';
        divider.title = Chat.session.summary;
        divider.textContent = 'Earlier context was summarized';
        thread.appendChild(divider);
      }
    }
    return thread;
  }

  function renderThread(options = {}) {
    const scroll = document.getElementById('chat-scroll');
    if (!scroll) return;
    if ((!Chat.session || !(Chat.session.messages || []).length) && !allGeneratedMedia().length) {
      showEmpty();
      return;
    }
    const messages = Chat.session.messages || [];
    const thread = document.createElement('div');
    thread.className = 'chat-thread';
    if (Chat.session.summary) {
      const divider = document.createElement('div');
      divider.className = 'compact-divider';
      divider.title = Chat.session.summary;
      divider.textContent = 'Earlier context was summarized';
      thread.appendChild(divider);
    }
    const results = new Map();
    for (const message of messages) {
      if (message.role === 'tool') results.set(message.toolCallId, message);
    }
    for (const message of messages) {
      if (message.role === 'user') {
        thread.insertAdjacentHTML('beforeend', userMessageMarkup(message));
      } else if (message.role === 'assistant') {
        if (!message.content && !(message.toolCalls || []).length) continue;
        thread.appendChild(buildAssistantMessage(message, results));
      }
    }
    for (const asset of allGeneratedMedia()) thread.insertAdjacentHTML('beforeend', generatedMediaMarkup(asset));
    if (Chat.running) {
      const status = document.createElement('div');
      status.className = 'notice-inline';
      status.innerHTML = `<span class="spinner" style="color:var(--accent)"></span><span>A run is in progress in this session. Live output will appear when it completes.</span>`;
      status.dataset.runNotice = '1';
      thread.appendChild(status);
    }
    const wasNear = U.isNearBottom(scroll, 160);
    scroll.innerHTML = '';
    scroll.appendChild(thread);
    updateScrollHelpers();
    if (options.keepScroll && !wasNear) return;
    U.scrollToBottom(scroll, options.smooth);
  }

  function updateScrollHelpers() {
    /* placeholder for future jump-to-latest affordance */
  }

  function appendMessageElement(element, smooth) {
    const thread = ensureThread();
    if (!thread) return;
    const notice = thread.querySelector('[data-run-notice]');
    if (notice) thread.insertBefore(element, notice);
    else thread.appendChild(element);
    U.scrollToBottom(document.getElementById('chat-scroll'), smooth);
  }

  function appendDivider(text) {
    const thread = ensureThread();
    if (!thread) return;
    const divider = document.createElement('div');
    divider.className = 'compact-divider';
    divider.textContent = text;
    thread.appendChild(divider);
  }

  function appendError(message, hint) {
    const thread = ensureThread();
    if (!thread) return;
    const card = document.createElement('div');
    card.className = 'error-card';
    card.innerHTML = `<strong>${icon('alert-circle', 13)} The run stopped</strong><p>${U.esc(message || 'Unknown error.')}</p>${hint ? `<div class="error-hint">${U.esc(hint)}</div>` : ''}`;
    thread.appendChild(card);
    U.scrollToBottom(document.getElementById('chat-scroll'), true);
  }

  function appendNotice(text, level) {
    const thread = ensureThread();
    if (!thread) return;
    const notice = document.createElement('div');
    notice.className = `notice-inline ${level || ''}`;
    notice.innerHTML = `${icon(level === 'warn' ? 'alert-triangle' : 'sparkles', 13)}<span>${U.esc(text)}</span>`;
    thread.appendChild(notice);
    U.scrollToBottom(document.getElementById('chat-scroll'), true);
  }

  /* ------------------------------------------------------------------- live */

  function makeLiveBlock() {
    const element = document.createElement('div');
    element.className = 'msg msg-assistant streaming-block';
    element.innerHTML = `
      <div class="assistant-main">
        ${assistantHead(currentModel())}
        <div class="reasoning" hidden>
          <button class="reasoning-toggle" type="button" data-action="toggle-reasoning">
            <span class="chev">${icon('chevron-right', 11)}</span>
            <span class="reasoning-label">Thinking</span>
          </button>
          <div class="reasoning-body"></div>
        </div>
        <div class="assistant-text md"><span class="stream-cursor"></span></div>
        <div class="tool-stack"></div>
        <div class="approval-host"></div>
        <div class="msg-actions" hidden></div>
      </div>`;
    const thread = ensureThread();
    const notice = thread?.querySelector('[data-run-notice]');
    if (notice) thread.insertBefore(element, notice);
    else thread?.appendChild(element);
    const textEl = element.querySelector('.assistant-text');
    const cursor = element.querySelector('.stream-cursor');
    return {
      element,
      textEl,
      cursor,
      reasoning: element.querySelector('.reasoning'),
      reasoningBody: element.querySelector('.reasoning-body'),
      reasoningLabel: element.querySelector('.reasoning-label'),
      toolStack: element.querySelector('.tool-stack'),
      approvalHost: element.querySelector('.approval-host'),
      actions: element.querySelector('.msg-actions'),
      text: '',
      reasoningText: '',
      finalized: false,
    };
  }

  function requestLiveRender(run) {
    if (run.renderQueued) return;
    run.renderQueued = true;
    requestAnimationFrame(() => {
      run.renderQueued = false;
      if (!run.live) return;
      const cursor = `<span class="stream-cursor"></span>`;
      run.live.textEl.innerHTML = `${MD.render(run.live.text || '')}${run.live.finalized ? '' : cursor}`;
      if (U.isNearBottom(document.getElementById('chat-scroll'), 180)) {
        U.scrollToBottom(document.getElementById('chat-scroll'));
      }
    });
  }

  function beginRun(runId) {
    Chat.run = {
      id: runId,
      live: null,
      toolTimes: new Map(),
      toolArgs: new Map(),
      toolCards: new Map(),
      results: new Map(),
      errorShown: false,
    };
    Chat.running = true;
    updateComposer();
  }

  function handleAssistantStart(payload) {
    if (!Chat.run) beginRun(payload.runId);
    const run = Chat.run;
    if (run.live && !run.live.finalized) {
      finishLive(run, null);
    }
    run.currentMessageId = payload.messageId;
    run.live = makeLiveBlock();
    run.toolCards.clear();
    U.scrollToBottom(document.getElementById('chat-scroll'), true);
  }

  function handleText(payload) {
    if (!Chat.run) beginRun(payload.runId);
    const run = Chat.run;
    if (!run.live) handleAssistantStart({ ...payload, runId: run.id });
    run.live.text += payload.delta ?? payload.text ?? '';
    requestLiveRender(run);
  }

  function handleReasoning(payload) {
    if (!Chat.run) beginRun(payload.runId);
    const run = Chat.run;
    if (!run.live) handleAssistantStart({ ...payload, runId: run.id });
    if (App.state.config?.agent?.showReasoning === false) return;
    run.live.reasoning.hidden = false;
    run.live.reasoningText += payload.delta ?? payload.text ?? '';
    run.live.reasoningBody.textContent = run.live.reasoningText;
    run.live.reasoningLabel.textContent = 'Thinking';
    if (U.isNearBottom(document.getElementById('chat-scroll'), 180)) U.scrollToBottom(document.getElementById('chat-scroll'));
  }

  function handleToolStart(payload) {
    if (!Chat.run) beginRun(payload.runId);
    const run = Chat.run;
    if (!run.live) handleAssistantStart({ ...payload, runId: run.id, messageId: 'live' });
    const call = { id: payload.callId, name: payload.name, args: payload.args || {}, label: payload.label };
    run.toolArgs.set(payload.callId, call);
    run.toolTimes.set(payload.callId, Date.now());
    const card = buildToolCard(call, null, { running: true, label: payload.label, summary: payload.summary });
    const existing = run.toolCards.get(payload.callId);
    if (existing) existing.replaceWith(card);
    else run.live.toolStack.appendChild(card);
    run.toolCards.set(payload.callId, card);
    U.scrollToBottom(document.getElementById('chat-scroll'), true);
  }

  function handleToolEnd(payload) {
    if (!Chat.run) beginRun(payload.runId);
    const run = Chat.run;
    if (!run.live) handleAssistantStart({ ...payload, runId: run.id, messageId: 'live' });
    const call = run.toolArgs.get(payload.callId) || { id: payload.callId, name: payload.name, args: {} };
    const started = run.toolTimes.get(payload.callId);
    const duration = started ? (() => {
      const ms = Date.now() - started;
      return ms < 1000 ? `${Math.max(1, Math.round(ms))}ms` : `${(ms / 1000).toFixed(1)}s`;
    })() : '';
    const result = { content: payload.content, isError: Boolean(payload.isError), meta: payload.meta || {}, duration };
    run.results.set(payload.callId, result);
    const card = buildToolCard(call, result, { label: payload.name ? toolLabel(payload.name) : call.label, duration });
    const existing = run.toolCards.get(payload.callId);
    if (existing) existing.replaceWith(card);
    else run.live.toolStack.appendChild(card);
    run.toolCards.set(payload.callId, card);
    if (payload.name === 'todo_write' && payload.meta?.tasks) {
      Chat.session.tasks = payload.meta.tasks;
      App.refreshRail();
    }
    if ((payload.name === 'write_file' || payload.name === 'edit_file' || payload.name === 'deliver_file') && payload.meta?.path) {
      Chat.session.files = [...new Set([...(Chat.session.files || []), payload.meta.path])];
      App.refreshRail();
    }
    if ((payload.name === 'generate_media' || payload.name === 'edit_media') && Array.isArray(payload.meta?.media) && payload.meta.media.length) {
      const thread = ensureThread();
      if (thread) {
        for (const asset of payload.meta.media) {
          if (!asset?.id || hasMediaCard(asset.id)) continue;
          thread.insertAdjacentHTML('beforeend', generatedMediaMarkup(asset));
        }
      }
    }
    if (payload.isError && payload.name !== 'run_command') {
      UI.toast(payload.content ? clip(payload.content, 180) : 'A tool failed.', 'warn', { title: `${toolLabel(payload.name)} failed` });
    }
    if (U.isNearBottom(document.getElementById('chat-scroll'), 180)) U.scrollToBottom(document.getElementById('chat-scroll'));
  }

  function finishLive(run, message) {
    if (!run.live) return;
    const live = run.live;
    live.finalized = true;
    if (message) {
      live.text = message.content || '';
      live.textEl.innerHTML = MD.render(live.text);
    } else {
      live.textEl.innerHTML = MD.render(live.text || '');
    }
    const reasoningLabel = live.reasoning.querySelector('.reasoning-label');
    if (reasoningLabel) reasoningLabel.textContent = 'Thought for a moment';
    if (live.text.trim()) {
      live.actions.hidden = false;
      live.actions.innerHTML = actionsMarkup(run.currentMessageId || '');
      const undo = [];
      for (const result of run.results.values()) {
        if (result.meta?.checkpointId) undo.push({ id: result.meta.checkpointId });
      }
      if (undo.length) {
        const button = document.createElement('button');
        button.className = 'msg-action';
        button.type = 'button';
        button.dataset.action = 'undo-checkpoint';
        button.dataset.checkpoint = undo[0].id;
        button.innerHTML = `${icon('undo', 12)}<span>Undo files</span>`;
        live.actions.insertBefore(button, live.actions.querySelector('[data-action="open-session-menu"]'));
      }
    }
    live.element.classList.remove('streaming-block');
  }

  /* --------------------------------------------------------------- approvals */

  function pendingApprovalCard(approvalId) {
    return document.querySelector(`.approval-card[data-approval-id="${approvalId}"]`);
  }

  function showApproval(payload) {
    const card = buildApproval(payload);
    Chat.pendingApprovals.set(payload.approvalId, card);
    let host = Chat.run?.live?.approvalHost;
    if (!host) {
      const thread = ensureThread();
      host = document.createElement('div');
      host.className = 'approval-host';
      thread?.appendChild(host);
    }
    host.appendChild(card);
    U.scrollToBottom(document.getElementById('chat-scroll'), true);
  }

  async function decideApproval(button) {
    const card = button.closest('.approval-card');
    if (!card || card.dataset.resolved) return;
    const decision = button.dataset.decision;
    const approvalId = card.dataset.approvalId;
    for (const item of card.querySelectorAll('.approval-foot button')) item.disabled = true;
    button.innerHTML = `<span class="spinner" style="width:11px;height:11px"></span>`;
    try {
      const result = await API.chat.approve({ approvalId, decision });
      if (!result?.ok) {
        UI.toast(result?.error || 'This approval has expired.', 'warn');
        markApproval(card, 'expired');
        Chat.pendingApprovals.delete(approvalId);
      }
    } catch (error) {
      UI.toast(error.message, 'error');
      for (const item of card.querySelectorAll('.approval-foot button')) item.disabled = false;
      button.textContent = decision === 'deny' ? 'Deny' : decision === 'always' ? 'Always allow' : 'Allow once';
    }
  }

  /* --------------------------------------------------------------- composer */

  function activeSlashQuery() {
    const input = document.getElementById('composer-input');
    if (!input) return null;
    const value = input.value;
    if (!value.startsWith('/') || value.includes('\n')) return null;
    return value.slice(1).toLowerCase();
  }

  const COMMANDS = [
    { name: 'new', description: 'Start a new session', icon: 'plus' },
    { name: 'media', description: 'Create images, video, audio or 3D', icon: 'wand' },
    { name: 'model', description: 'Switch the model for this session', icon: 'sparkles' },
    { name: 'mode', description: 'Agent, Plan, or Ask', icon: 'bot' },
    { name: 'compact', description: 'Summarize earlier context', icon: 'panel-bottom' },
    { name: 'skills', description: 'Browse skills', icon: 'layers' },
    { name: 'memory', description: 'Open memory', icon: 'brain' },
    { name: 'mcp', description: 'Manage MCP servers', icon: 'plug' },
    { name: 'learning', description: 'Review learned insights', icon: 'zap' },
    { name: 'settings', description: 'Open settings', icon: 'settings' },
    { name: 'clear', description: 'Clear the composer', icon: 'x' },
    { name: 'help', description: 'Show all commands', icon: 'keyboard' },
  ];

  function renderSlashMenu() {
    const composer = document.getElementById('composer');
    if (!composer) return;
    let menu = composer.querySelector('.slash-menu');
    const query = activeSlashQuery();
    if (query == null) {
      if (menu) menu.remove();
      Chat.slashOpen = false;
      return;
    }
    Chat.slashOpen = true;
    const matches = COMMANDS.filter((command) => command.name.startsWith(query) || command.description.toLowerCase().includes(query));
    if (matches.length) Chat.slashIndex = Math.min(Chat.slashIndex, matches.length - 1);
    else Chat.slashIndex = 0;
    if (!menu) {
      menu = document.createElement('div');
      menu.className = 'slash-menu';
      composer.appendChild(menu);
    }
    menu.innerHTML = matches.length
      ? matches.map((command, index) => `<button class="slash-item ${index === Chat.slashIndex ? 'active' : ''}" type="button" data-command="${U.attr(command.name)}">
          <span class="slash-name">/${command.name}</span>
          <span class="slash-desc">${U.esc(command.description)}</span>
        </button>`).join('')
      : `<div class="slash-empty">No matching command. Press Enter to send as a message.</div>`;
  }

  function executeCommand(name) {
    const input = document.getElementById('composer-input');
    input.value = '';
    Chat.slashOpen = false;
    input.dispatchEvent(new Event('input'));
    const command = COMMANDS.find((item) => item.name === name);
    if (!command) return;
    if (name === 'new') App.newSession();
    else if (name === 'media') window.Views?.openStudio?.();
    else if (name === 'model') openModelPicker(document.querySelector('[data-action="pick-model"]') || input);
    else if (name === 'mode') openModePicker(document.getElementById('composer-mode') || input);
    else if (name === 'compact') compactSession();
    else if (name === 'skills') App.openPage('skills');
    else if (name === 'memory') App.openPage('memory');
    else if (name === 'mcp') App.openPage('mcp');
    else if (name === 'learning') App.openPage('learning');
    else if (name === 'settings') App.openPage('settings');
    else if (name === 'clear') { input.value = ''; input.dispatchEvent(new Event('input')); input.focus(); }
    else if (name === 'help') showCommandsHelp();
  }

  function showCommandsHelp() {
    const body = `<div class="command-list">${COMMANDS.map((command) => `<div class="command-help-row"><code>/${command.name}</code><span>${U.esc(command.description)}</span></div>`).join('')}</div>
      <p class="custom-note">Tip: type <code>/</code> in the composer to open this list inline.</p>`;
    UI.modal({ title: 'Commands', description: 'Keyboard-first access to the workspace.', body, size: 'small', footer: '<button class="btn btn-secondary" type="button" data-modal-close>Close</button>' });
  }

  function handleComposerKeydown(event) {
    const input = event.target;
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      Chat.slashOpen = false;
      document.querySelector('.slash-menu')?.remove();
      sendNow();
      return;
    }
    if (Chat.slashOpen) {
      const query = activeSlashQuery() || '';
      const matches = COMMANDS.filter((command) => command.name.startsWith(query) || command.description.toLowerCase().includes(query));
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        Chat.slashIndex = Math.min(Chat.slashIndex + 1, Math.max(0, matches.length - 1));
        renderSlashMenu();
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        Chat.slashIndex = Math.max(0, Chat.slashIndex - 1);
        renderSlashMenu();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        Chat.slashOpen = false;
        document.querySelector('.slash-menu')?.remove();
        return;
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && matches.length) {
        event.preventDefault();
        executeCommand(matches[Chat.slashIndex]?.name || matches[0].name);
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendOrStop();
    }
  }

  function attachFiles(files) {
    const list = [...(files || [])];
    const textFiles = list.slice(0, 8);
    if (!textFiles.length) return;
    let pending = textFiles.length;
    for (const file of textFiles) {
      if (Chat.attachments.length >= 8) { UI.toast('Attach up to 8 text files.', 'warn'); pending -= 1; continue; }
      if (file.size > 160000) {
        UI.toast(`${file.name} is too large (over 160 KB).`, 'warn');
        pending -= 1;
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const content = String(reader.result || '').slice(0, 120000);
        if (content.trim()) {
          Chat.attachments.push({ name: file.name, type: file.type || 'text/plain', size: file.size, content });
          renderAttachments();
        }
        pending -= 1;
      };
      reader.onerror = () => { pending -= 1; UI.toast(`Could not read ${file.name}.`, 'error'); };
      reader.readAsText(file);
    }
  }

  function sendOrStop() {
    if (Chat.sending) return;
    if (Chat.running) { send(null, { queue: true }); return; }
    send();
  }

  function sendNow() {
    if (Chat.sending) return;
    if (Chat.running) { send(null, { queue: true, interrupt: true }); return; }
    send();
  }

  async function stopRun() {
    if (!Chat.session?.id && !Chat.activeSessionId) return;
    const id = Chat.session?.id || Chat.activeSessionId;
    try {
      await API.chat.stop(id);
      Chat.queue = [];
      renderQueue();
      updateComposer();
      UI.toast('Stopping the run…', 'info');
      const stop = document.getElementById('composer-stop');
      if (stop) { stop.disabled = true; stop.innerHTML = '<span class="spinner" style="width:11px;height:11px"></span>'; }
    } catch (error) {
      UI.toast(error.message, 'error');
    }
  }

  async function send(prefill, options = {}) {
    if (Chat.sending) return;
    if (Chat.running && !options.queue) return;
    const input = document.getElementById('composer-input');
    const text = String(prefill != null ? prefill : input?.value || '').trim();
    const attachments = Chat.attachments.slice();
    if (!text && !attachments.length) return;
    if (!currentModel()) {
      openModelPicker(document.getElementById('composer-model'));
      UI.toast('Choose a model first.', 'warn', { title: 'No model' });
      return;
    }
    if (!Chat.session) {
      Chat.session = {
        id: null, title: 'New session', messages: [], tasks: [], files: [], allowTools: [],
        model: Chat.draftModel || App.state.config?.defaultModel, mode: Chat.draftMode || 'agent',
        reasoningEffort: currentReasoning(),
        usage: { input: 0, output: 0 }, summary: '', compactedCount: 0,
      };
    }
    if (input) { input.value = ''; U.autoGrow(input, 224); }
    Chat.attachments = [];
    renderAttachments();
    Chat.slashOpen = false;
    document.querySelector('.slash-menu')?.remove();
    Chat.sending = true;
    Chat.buffer = [];
    updateComposer();
    try {
      const result = await API.chat.send({
        sessionId: Chat.session.id,
        text,
        attachments,
        model: currentModel(),
        mode: currentMode(),
        reasoningEffort: currentReasoning(),
        queue: Boolean(options.queue),
        interrupt: Boolean(options.interrupt),
      });
      Chat.sending = false;
      Chat.session.id = result.sessionId || Chat.session.id;
      Chat.session.title = result.title || Chat.session.title;
      Chat.session.model = result.model || Chat.session.model;
      Chat.session.mode = result.mode || Chat.session.mode;
      Chat.activeSessionId = result.sessionId || Chat.activeSessionId;
      if (result.queued) {
        if (!Chat.queue.some((item) => item.queueId === result.queueId)) {
          Chat.queue.push({ queueId: result.queueId, text, queuedAt: new Date().toISOString(), interrupt: Boolean(result.interrupt) });
        }
        renderQueue();
        updateComposer();
        renderHead();
        UI.toast(
          result.interrupt ? 'Stopping the current run — this message goes next.' : 'Queued. It sends when the current run finishes.',
          'info',
          { timeout: 2600 },
        );
        App.onChatStarted(Chat.session.id, Chat.session);
        const queuedBuffer = Chat.buffer.splice(0);
        for (const payload of queuedBuffer) {
          if (!payload.sessionId || payload.sessionId === Chat.session.id) handleEvent(payload);
        }
        return;
      }
      if (!Chat.session.messages.length) showEmpty();
      const localMessage = {
        id: result.message?.id || U.uid('local'), role: 'user', content: text, attachments,
        at: new Date().toISOString(),
      };
      Chat.session.messages.push(localMessage);
      appendMessageElement(createElementFromHTML(userMessageMarkup(localMessage)), true);
      if (!Chat.session.title || Chat.session.title === 'New session') {
        Chat.session.title = text.replace(/\s+/g, ' ').slice(0, 60) || attachments[0]?.name || 'New session';
      }
      Chat.run = null;
      Chat.pendingApprovals.clear();
      beginRun(result.runId);
      if (Chat.lastRunNotice) Chat.lastRunNotice.remove();
      renderHead();
      updateComposer();
      App.onChatStarted(result.sessionId, Chat.session);
      const buffered = Chat.buffer.splice(0);
      for (const payload of buffered) {
        if (!payload.sessionId || payload.sessionId === Chat.session.id) handleEvent(payload);
      }
    } catch (error) {
      Chat.sending = false;
      Chat.running = false;
      Chat.run = null;
      updateComposer();
      if (Chat.session && !Chat.session.messages.length) showEmpty();
      else appendError(error.message, 'The message was not sent. Check the model and your connection, then try again.');
      UI.toast(error.message, 'error', { title: 'Could not send' });
    }
  }

  function createElementFromHTML(html) {
    const template = document.createElement('template');
    template.innerHTML = html.trim();
    return template.content.firstElementChild;
  }

  /* ------------------------------------------------------------------- models */

  function openModelPicker(anchor) {
    if (!anchor) return;
    App.openModelPicker(anchor, {
      current: currentModel(),
      onSelect(fullId) {
        if (!fullId) return;
        if (Chat.session?.id) {
          Chat.session.model = fullId;
          API.sessions.update({ id: Chat.session.id, model: fullId }).catch((error) => UI.toast(error.message, 'error'));
        } else {
          Chat.draftModel = fullId;
        }
        renderHead();
        updateComposer();
        if (!Chat.session?.messages?.length) showEmpty();
        App.refreshSessions();
        App.setDefaultModel?.(fullId, { quiet: true });
      },
    });
  }

  const APPROVAL_PRESETS = {
    important: { icon: 'shield', label: 'Important only', title: 'Approvals · important actions ask first' },
    all: { icon: 'shield-alert', label: 'Ask for all', title: 'Approvals · every guarded action asks first' },
    auto: { icon: 'zap', label: 'No approvals', title: 'Approvals · every action runs without asking' },
  };

  function approvalPreset() {
    const mode = App.state.config?.approvals?.mode;
    return mode === 'all' || mode === 'auto' ? mode : 'important';
  }

  async function setApprovalPreset(preset) {
    const mode = preset === 'all' || preset === 'auto' ? preset : 'important';
    try {
      await API.config.update({ approvals: { mode } });
      if (App.state.config) App.state.config.approvals = { ...(App.state.config.approvals || {}), mode };
      updateComposer();
      UI.toast(
        mode === 'auto'
          ? 'No approvals. Every action runs until you switch back.'
          : mode === 'all'
            ? 'blank will ask before every guarded action.'
            : 'blank will ask only for important actions.',
        mode === 'auto' ? 'warn' : 'success',
      );
    } catch (error) { UI.toast(error.message, 'error'); }
  }

  function openApprovalPicker(anchor) {
    if (!anchor) return;
    const current = approvalPreset();
    const content = document.createElement('div');
    content.className = 'mode-picker approval-picker';
    content.innerHTML = `<div class="mode-picker-head">Approvals</div>
      <button class="mode-choice ${current === 'important' ? 'selected' : ''}" type="button" data-approval="important">
        <span class="mode-choice-icon">${icon('shield', 15)}</span>
        <span class="mode-choice-name">Important only<span class="mode-choice-hint">Routine work runs. Risky actions ask.</span></span>
        ${current === 'important' ? `<span class="mode-choice-check">${icon('check', 13)}</span>` : ''}
      </button>
      <button class="mode-choice ${current === 'all' ? 'selected' : ''}" type="button" data-approval="all">
        <span class="mode-choice-icon">${icon('shield-alert', 15)}</span>
        <span class="mode-choice-name">Ask for all<span class="mode-choice-hint">Every guarded tool call asks first.</span></span>
        ${current === 'all' ? `<span class="mode-choice-check">${icon('check', 13)}</span>` : ''}
      </button>
      <button class="mode-choice approval-auto ${current === 'auto' ? 'selected' : ''}" type="button" data-approval="auto">
        <span class="mode-choice-icon">${icon('zap', 15)}</span>
        <span class="mode-choice-name">No approvals<span class="mode-choice-hint">Every action runs until you switch back.</span></span>
        ${current === 'auto' ? `<span class="mode-choice-check">${icon('check', 13)}</span>` : ''}
      </button>
      <div class="approval-picker-note">Blocks in Settings and machine-destroying commands still stop.</div>`;
    const pop = UI.popover(anchor, content, { width: 276, align: 'end', placement: 'top' });
    content.addEventListener('click', (event) => {
      const choice = event.target.closest('[data-approval]');
      if (!choice) return;
      pop.close();
      setApprovalPreset(choice.dataset.approval);
    });
  }

  function openModePicker(anchor) {
    if (!anchor) return;
    const current = currentMode();
    const content = document.createElement('div');
    content.className = 'mode-picker';
    content.innerHTML = `<div class="mode-picker-head">Mode</div>${Object.entries(MODES).map(([value, mode]) => `<button class="mode-choice ${value === current ? 'selected' : ''}" type="button" data-mode="${value}">
      <span class="mode-choice-icon">${icon(mode.icon, 15)}</span>
      <span class="mode-choice-name">${U.esc(mode.label)}</span>
      ${value === current ? `<span class="mode-choice-check">${icon('check', 13)}</span>` : ''}
    </button>`).join('')}`;
    const pop = UI.popover(anchor, content, { width: 208 });
    content.addEventListener('click', (event) => {
      const button = event.target.closest('.mode-choice');
      if (!button) return;
      const mode = button.dataset.mode;
      pop.close();
      if (Chat.session?.id) {
        Chat.session.mode = mode;
        API.sessions.update({ id: Chat.session.id, mode }).catch((error) => UI.toast(error.message, 'error'));
      } else {
        Chat.draftMode = mode;
      }
      renderHead();
      updateComposer();
      App.refreshSessions();
    });
  }

  function openReasoningPicker(anchor) {
    if (!anchor) return;
    let profile = reasoningProfile();
    const model = U.modelOf(catalog(), currentModel());
    const checkable = reasoningCheckable(model, profile);
    const content = document.createElement('div');
    content.className = 'mode-picker';
    let checking = checkable;
    let noteExtra = '';

    function noteText() {
      if (checking) return "Checking this endpoint's stages…";
      if (noteExtra) return noteExtra;
      return 'Only the stages this model supports.';
    }

    function render() {
      if (!profile || profile.levels.length <= 1) {
        const reason = !currentModel()
          ? 'Choose a model first.'
          : profile?.fixedLabel
            ? 'This model always reasons; the stage is fixed.'
            : 'This model does not expose reasoning stages.';
        content.innerHTML = `<div class="mode-picker-head">Reasoning</div><div class="mode-picker-note">${U.esc(reason)}</div>
          ${checkable ? `<div class="mode-picker-note">${U.esc(noteText())}</div>` : ''}`;
        return;
      }
      const stored = Chat.session?.reasoningEffort || Chat.draftReasoning || App.state.config?.agent?.reasoningEffort || '';
      const current = U.normalizeReasoning(profile, stored);
      content.innerHTML = `<div class="mode-picker-head">Reasoning</div>${profile.levels.map((value) => {
        const item = U.REASONING_LEVELS[value] || { label: value, hint: '' };
        return `<button class="mode-choice ${value === current ? 'selected' : ''}" type="button" data-reasoning="${value}">
      <span class="mode-choice-icon">${icon(value === 'none' ? 'sparkles' : 'brain', 15)}</span>
      <span class="mode-choice-name">${U.esc(item.label)}<span class="mode-choice-hint">${U.esc(item.hint)}</span></span>
      ${value === current ? `<span class="mode-choice-check">${icon('check', 13)}</span>` : ''}
    </button>`;
      }).join('')}<div class="mode-picker-note">${U.esc(noteText())}</div>`;
    }

    render();
    const pop = UI.popover(anchor, content, { width: 232 });
    content.addEventListener('click', (event) => {
      const button = event.target.closest('[data-reasoning]');
      if (!button) return;
      const value = button.dataset.reasoning;
      pop.close();
      if (Chat.session?.id) {
        Chat.session.reasoningEffort = value;
        API.sessions.update({ id: Chat.session.id, reasoningEffort: value }).catch((error) => UI.toast(error.message, 'error'));
      } else {
        Chat.draftReasoning = value;
      }
      updateComposer();
      renderHead();
      UI.toast(`Reasoning: ${U.reasoningLabel(profile, value)}`, 'success');
    });

    if (checkable) {
      requestReasoningCheck().then((fresh) => {
        checking = false;
        if (fresh) profile = fresh;
        else noteExtra = 'This endpoint did not report its stages; showing the standard set.';
        if (!content.isConnected) return;
        render();
        pop.reposition();
        updateComposer();
      }).catch(() => {
        checking = false;
        noteExtra = 'Could not check this endpoint; showing the standard set.';
        if (content.isConnected) { render(); pop.reposition(); }
      });
    }
  }

  /* ----------------------------------------------------------------- session */

  function transcriptMarkdown(session) {
    const lines = [`# ${session.title || 'blank session'}`, ''];
    lines.push(`- Model: ${session.model || 'unknown'}`);
    lines.push(`- Mode: ${session.mode || 'agent'}`);
    lines.push(`- Created: ${session.createdAt ? new Date(session.createdAt).toLocaleString() : ''}`);
    lines.push('', '---', '');
    for (const message of session.messages || []) {
      if (message.role === 'user') {
        lines.push('## You', '', message.content || '', '');
        if (message.attachments?.length) lines.push(`_Attachments: ${message.attachments.map((file) => file.name).join(', ')}_`, '');
      } else if (message.role === 'assistant') {
        lines.push('## blank', '', message.content || '', '');
        for (const call of message.toolCalls || []) {
          lines.push(`> Tool · ${call.name} — ${summarizeTool(call.name, call.args)}`, '');
        }
      } else if (message.role === 'tool') {
        lines.push(`<details><summary>Tool result · ${message.name}</summary>`, '', '```', clip(message.content || '', 6000), '```', '', '</details>', '');
      }
    }
    return lines.join('\n');
  }

  function openSessionMenu(anchor) {
    const session = Chat.session;
    if (!session?.id) {
      UI.menu(anchor || document.body, [
        { heading: 'Session' },
        { label: 'New session', icon: 'plus', shortcut: U.kbd('Ctrl N'), onClick: () => App.newSession() },
        { label: 'Open settings', icon: 'settings', onClick: () => App.openPage('settings') },
      ]);
      return;
    }
    UI.menu(anchor || document.body, [
      { heading: 'Session' },
      { label: 'Rename', icon: 'edit', onClick: () => renameSession() },
      { label: session.pinned ? 'Unpin session' : 'Pin session', icon: 'pin', onClick: () => togglePin() },
      { label: 'Compact context', icon: 'panel-bottom', disabled: Chat.running || !(session.messages || []).length, onClick: () => compactSession() },
      { separator: true },
      { label: 'Export as Markdown', icon: 'download', onClick: () => exportSession() },
      { label: 'Copy transcript', icon: 'copy', onClick: () => copyTranscript() },
      { separator: true },
      { label: 'Delete session', icon: 'trash', danger: true, onClick: () => deleteSession() },
    ]);
  }

  async function renameSession() {
    if (!Chat.session?.id) return;
    const next = await UI.prompt({
      title: 'Rename session', label: 'Title', value: Chat.session.title || '',
      validate: (value) => (!value ? 'A title is required.' : null),
    });
    if (next == null) return;
    try {
      const result = await API.sessions.update({ id: Chat.session.id, title: next });
      Chat.session.title = result.session.title;
      renderHead();
      App.refreshSessions();
    } catch (error) { UI.toast(error.message, 'error'); }
  }

  async function togglePin() {
    if (!Chat.session?.id) return;
    try {
      const result = await API.sessions.update({ id: Chat.session.id, pinned: !Chat.session.pinned });
      Chat.session.pinned = result.session.pinned;
      App.refreshSessions();
      UI.toast(result.session.pinned ? 'Session pinned.' : 'Session unpinned.', 'success');
    } catch (error) { UI.toast(error.message, 'error'); }
  }

  async function compactSession() {
    if (!Chat.session?.id || Chat.running) return;
    const ok = await UI.confirm({
      title: 'Compact this session?',
      message: 'Earlier turns will be replaced by a summary in the model context. The full transcript stays visible and is never deleted.',
      confirmLabel: 'Compact context',
      detail: `${Chat.session.messages?.length || 0} messages · ${U.fmtNumber((Chat.session.usage?.input || 0) + (Chat.session.usage?.output || 0))} tokens used`,
    });
    if (!ok) return;
    try {
      UI.toast('Summarizing earlier context…', 'info', { timeout: 2500 });
      const result = await API.sessions.compact(Chat.session.id);
      Chat.session = result.session || Chat.session;
      renderThread({ smooth: false });
      renderHead();
      App.refreshRail();
      UI.toast(`Compacted ${result.compacted || 0} messages.`, 'success');
    } catch (error) { UI.toast(error.message, 'error'); }
  }

  function exportSession() {
    if (!Chat.session) return;
    const slug = (Chat.session.title || 'blank-session').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'blank-session';
    U.download(`${slug}.md`, transcriptMarkdown(Chat.session), 'text/markdown;charset=utf-8');
    UI.toast('Transcript downloaded.', 'success');
  }

  async function copyTranscript() {
    if (!Chat.session) return;
    const ok = await U.copyText(transcriptMarkdown(Chat.session));
    UI.toast(ok ? 'Transcript copied.' : 'Could not access the clipboard.', ok ? 'success' : 'error');
  }

  async function deleteSession() {
    if (!Chat.session?.id) return;
    const ok = await UI.confirm({
      title: 'Delete this session?',
      message: 'The transcript will be removed from this machine. Checkpoints for files changed in this session are kept separately.',
      confirmLabel: 'Delete session', danger: true, detail: Chat.session.title,
    });
    if (!ok) return;
    try {
      await API.sessions.delete(Chat.session.id);
      App.newSession();
      App.refreshSessions();
      UI.toast('Session deleted.', 'success');
    } catch (error) { UI.toast(error.message, 'error'); }
  }

  async function undoCheckpoint(button) {
    const id = button.dataset.checkpoint;
    if (!id) return;
    button.disabled = true;
    button.innerHTML = `<span class="spinner" style="width:10px;height:10px"></span> Restoring…`;
    try {
      await API.checkpoint.revert(id);
      button.innerHTML = `${icon('check', 11)} Restored`;
      UI.toast('File restored to the checkpoint.', 'success');
      App.refreshWorkspaceTree();
    } catch (error) {
      button.disabled = false;
      button.innerHTML = `${icon('undo', 11)} Undo change`;
      UI.toast(error.message, 'error');
    }
  }

  /* ------------------------------------------------------------------ events */

  function handleEvent(payload) {
    if (!payload || !payload.type) return;
    if (Chat.sending && !Chat.run && payload.type !== 'config:updated') {
      Chat.buffer.push(payload);
      return;
    }
    const activeSessionId = Chat.session?.id || '';
    if (payload.type === 'approval') {
      if (payload.sessionId && payload.sessionId !== activeSessionId) {
        UI.toast('Approval requested in another session.', 'warn', {
          title: 'blank needs you', timeout: 8000, actionLabel: 'Open session',
          onAction: () => App.loadSession(payload.sessionId),
        });
        return;
      }
      Chat.running = true;
      updateComposer();
      showApproval(payload);
      return;
    }
    /* A draft has no session id. Events from a run that is still finishing in
       another session (or one that started before "New session") must not
       render into it. While the draft's own send is in flight, events are
       buffered above and filtered by the new session id when it arrives. */
    if (payload.sessionId && payload.sessionId !== activeSessionId) {
      if (payload.type === 'run:done') {
        App.refreshSessions();
      }
      return;
    }
    switch (payload.type) {
      case 'run:start':
        if (!Chat.run) beginRun(payload.runId);
        Chat.running = true;
        updateComposer();
        document.getElementById('chat-scroll')?.querySelector('[data-run-notice]')?.remove();
        break;
      case 'title':
        if (Chat.session && payload.title) {
          Chat.session.title = payload.title;
          renderHead();
        }
        break;
      case 'assistant:start':
        handleAssistantStart(payload);
        break;
      case 'text':
        handleText(payload);
        break;
      case 'reasoning':
        handleReasoning(payload);
        break;
      case 'tool:start':
        handleToolStart(payload);
        break;
      case 'tool:end':
        handleToolEnd(payload);
        break;
      case 'assistant:end':
        if (!Chat.run) beginRun(payload.runId);
        if (Chat.run.live && payload.message) {
          Chat.run.live.text = payload.message.content || Chat.run.live.text;
          finishLive(Chat.run, payload.message);
        }
        break;
      case 'assistant:empty':
        appendNotice('The model returned an empty response. Try a different model or add more context.', 'warn');
        break;
      case 'tasks':
        if (Chat.session) Chat.session.tasks = payload.tasks || [];
        App.refreshRail();
        break;
      case 'usage':
        if (Chat.session) {
          Chat.session.usage = payload.usage || Chat.session.usage;
          if (payload.contextTokens) Chat.session.contextTokens = payload.contextTokens;
        }
        updateComposer();
        App.refreshRail();
        break;
      case 'notice':
        if (payload.text) UI.toast(payload.text, payload.level === 'warn' ? 'warn' : 'info', { timeout: 5000 });
        break;
      case 'error':
        if (Chat.run) Chat.run.errorShown = true;
        appendError(payload.message, payload.hint);
        break;
      case 'compacted':
        if (Chat.session) {
          Chat.session.summary = payload.summary || 'Earlier context summarized.';
          Chat.session.compactedCount = (Chat.session.compactedCount || 0) + (payload.compacted || 0);
        }
        appendDivider('Earlier context was summarized');
        App.refreshRail();
        break;
      case 'approval:resolved': {
        const card = pendingApprovalCard(payload.approvalId);
        if (card) markApproval(card, payload.decision === 'deny' ? 'deny' : payload.decision === 'always' ? 'always' : 'allow');
        Chat.pendingApprovals.delete(payload.approvalId);
        if (payload.decision === 'always' && Chat.session) {
          Chat.session.allowTools = [...new Set([...(Chat.session.allowTools || []), payload.tool].filter(Boolean))];
        }
        break;
      }
      case 'approval:expired': {
        const card = pendingApprovalCard(payload.approvalId);
        if (card) markApproval(card, 'expired');
        Chat.pendingApprovals.delete(payload.approvalId);
        break;
      }
      case 'run:done':
        handleRunDone(payload);
        break;
      case 'chat:queued': {
        if (!payload.queueId) break;
        if (payload.sessionId && payload.sessionId !== Chat.session?.id) break;
        if (!Chat.queue.some((item) => item.queueId === payload.queueId)) {
          Chat.queue.push({ queueId: payload.queueId, text: payload.text || '', queuedAt: payload.at || '', interrupt: Boolean(payload.interrupt) });
        }
        renderQueue();
        updateComposer();
        break;
      }
      case 'chat:queue:update':
        Chat.queue = (payload.queue || []).map((item) => ({ queueId: item.queueId, text: item.text || '', queuedAt: item.queuedAt || '', interrupt: Boolean(item.interrupt) }));
        renderQueue();
        updateComposer();
        break;
      case 'chat:queued:sent': {
        Chat.queue = Chat.queue.filter((item) => item.queueId !== payload.queueId);
        if (Chat.session && payload.sessionId === Chat.session.id) {
          if (payload.title) Chat.session.title = payload.title;
          const message = payload.message;
          if (message && !(Chat.session.messages || []).some((entry) => entry.id === message.id)) {
            Chat.session.messages.push(message);
            const thread = ensureThread();
            if (thread) thread.appendChild(createElementFromHTML(userMessageMarkup(message)));
            U.scrollToBottom(document.getElementById('chat-scroll'), true);
          }
          renderHead();
        }
        renderQueue();
        updateComposer();
        App.refreshSessions();
        break;
      }
      default:
        break;
    }
  }

  function handleRunDone(payload) {
    const isActive = Chat.run && payload.runId === Chat.run.id;
    if (!isActive) {
      if (payload.sessionId === Chat.session?.id) {
        Chat.running = false;
        updateComposer();
        // A run finished while this view was detached; re-read the transcript.
        API.sessions.get(payload.sessionId).then((result) => {
          if (result.session && Chat.session?.id === result.session.id) {
            Chat.session = result.session;
            Chat.running = Boolean(result.running);
            Chat.queue = result.queue || [];
            renderThread({ smooth: false });
            renderHead();
            renderQueue();
            updateComposer();
            App.refreshRail();
            App.refreshSessions();
          }
        }).catch(() => {});
      } else {
        App.refreshSessions();
      }
      return;
    }
    const run = Chat.run;
    const finishLiveBlock = run.live && !run.live.finalized;
    if (run.live && !run.live.finalized) {
      finishLive(run, { content: run.live.text });
    }
    if (payload.outcome?.stopped) {
      appendNotice('Stopped by you.', 'warn');
    } else if (payload.outcome?.ok === false && payload.outcome?.error && !run.errorShown) {
      appendError(payload.outcome.error);
    }
    Chat.run = null;
    Chat.running = false;
    Chat.sending = false;
    if (Chat.session && payload.sessionId === Chat.session.id) {
      if (payload.title) Chat.session.title = payload.title;
      if (payload.tasks) Chat.session.tasks = payload.tasks;
      if (payload.files) Chat.session.files = payload.files;
      if (payload.usage) Chat.session.usage = payload.usage;
      if (payload.contextTokens) Chat.session.contextTokens = payload.contextTokens;
    }
    renderHead();
    updateComposer();
    App.refreshSessions();
    App.refreshRail();
    if (payload.sessionId === Chat.session?.id) {
      API.sessions.get(payload.sessionId).then((result) => {
        if (!result.session || Chat.session?.id !== result.session.id || Chat.run) return;
        Chat.session = result.session;
        Chat.running = Boolean(result.running);
        Chat.queue = result.queue || [];
        renderHead();
        renderQueue();
        updateComposer();
        App.refreshRail();
      }).catch(() => {});
    }
  }

  /* ------------------------------------------------------------------- mount */

  Chat.mount = function mount() {
    const host = document.getElementById('chat-view');
    if (!host) return;
    window.Views?.closeStudio?.({ silent: true });
    Chat.draftModel = Chat.draftModel || App.state.config?.defaultModel || '';
    host.innerHTML = `
      <div class="chat-shell" id="chat-shell">
        <div class="chat-head">
          <div class="chat-head-main" id="chat-head-main"></div>
          <div class="chat-head-actions" id="chat-head-actions"></div>
        </div>
        <div class="chat-scroll" id="chat-scroll"></div>
        <div class="chat-media-panel" id="chat-media-panel" hidden></div>
        <div class="composer-wrap">
          <div class="composer-shell">
            <div class="queue-tray" id="queue-tray" hidden></div>
            <div class="composer" id="composer">
              <div class="composer-attachments" id="composer-attachments"></div>
              <div class="composer-input-row">
                <textarea class="composer-input" id="composer-input" rows="1" spellcheck="false" aria-label="Message blank"></textarea>
              </div>
              <div class="composer-tools">
                <button class="composer-tool" type="button" data-action="attach-files" title="Attach text files">${icon('paperclip', 13)}<span>Attach</span></button>
                <button class="composer-tool" type="button" data-action="open-media" title="Create media">${icon('wand', 13)}<span>Media</span></button>
                <span class="composer-divider"></span>
                <button class="composer-tool composer-model" id="composer-model" type="button" data-action="pick-model" title="Switch model"></button>
                <button class="composer-tool" id="composer-reasoning" type="button" data-action="pick-reasoning" title="Reasoning effort"></button>
                <button class="composer-tool" id="composer-mode" type="button" data-action="pick-mode"></button>
                <span class="spacer"></span>
                <button class="context-chip" id="composer-context" type="button" data-action="usage" title="Context usage" aria-label="Context usage"></button>
                <button class="composer-tool composer-dictate" id="composer-dictate" type="button" data-action="dictate" title="Dictate with your voice" aria-label="Dictate with your voice">${icon('mic', 15)}</button>
                <button class="composer-tool composer-approval" id="composer-approval" type="button" data-action="pick-approvals" title="Approvals">${icon('shield', 13)}<span class="approval-mode-label">Important only</span></button>
                <button class="stop-btn" id="composer-stop" type="button" data-action="stop-run" title="Stop run" hidden>${icon('stop', 12)}</button>
                <button class="send-btn" id="composer-send" type="button" data-action="send" disabled title="Send">${icon('arrow-up', 15)}</button>
              </div>
            </div>
            <div class="composer-hints">
              <div class="hints-left">
                <span class="approval-hint" id="composer-approval-hint"></span>
                <span class="hint-item" id="composer-enter-hint"><kbd>Enter</kbd> / <kbd>${U.isMac ? '⌘ Enter' : 'Ctrl Enter'}</kbd> send</span>
                <span class="hint-item"><kbd>Shift Enter</kbd> newline</span>
              </div>
              <span class="hint-item"><kbd>/</kbd> commands</span>
            </div>
          </div>
        </div>
      </div>
      <input type="file" id="chat-file-input" multiple hidden accept=".txt,.md,.markdown,.json,.js,.jsx,.ts,.tsx,.css,.scss,.html,.py,.go,.rs,.java,.rb,.php,.sql,.yml,.yaml,.toml,.xml,.csv,.log,.sh,.ps1">`;
    Icons.hydrate(host);

    const shell = document.getElementById('chat-shell');
    const input = document.getElementById('composer-input');
    shell.addEventListener('click', handleClick);
    input.addEventListener('keydown', handleComposerKeydown);
    input.addEventListener('input', () => {
      U.autoGrow(input, 224);
      updateSendEnabled();
      renderSlashMenu();
    });
    const fileInput = document.getElementById('chat-file-input');
    fileInput.addEventListener('change', () => {
      attachFiles(fileInput.files);
      fileInput.value = '';
    });
    const composer = document.getElementById('composer');
    composer.addEventListener('dragover', (event) => { event.preventDefault(); composer.classList.add('drag-over'); });
    composer.addEventListener('dragleave', () => composer.classList.remove('drag-over'));
    composer.addEventListener('drop', (event) => {
      event.preventDefault();
      composer.classList.remove('drag-over');
      if (event.dataTransfer?.files?.length) attachFiles(event.dataTransfer.files);
    });
    renderHead();
    updateComposer();
    renderAttachments();
    if (Chat.session) renderThread({ smooth: false });
    else showEmpty();
  };

  function handleClick(event) {
    const actionNode = event.target.closest('[data-action]');
    if (actionNode) {
      const action = actionNode.dataset.action;
      if (action === 'send') { sendOrStop(); return; }
      if (action === 'stop-run') { stopRun(); return; }
      if (action === 'queue-remove') {
        const id = Chat.session?.id || Chat.activeSessionId;
        if (!id) return;
        API.chat.removeQueued({ sessionId: id, queueId: actionNode.dataset.queueId })
          .then((result) => { Chat.queue = result.queue || []; renderQueue(); updateComposer(); })
          .catch((error) => UI.toast(error.message, 'error'));
        return;
      }
      if (action === 'attach-files') { document.getElementById('chat-file-input')?.click(); return; }
      if (action === 'dictate') { toggleDictation(actionNode); return; }
      if (action === 'remove-attachment') {
        Chat.attachments.splice(Number(actionNode.dataset.index), 1);
        renderAttachments();
        return;
      }
      if (action === 'pick-model') { openModelPicker(actionNode); return; }
      if (action === 'pick-mode') { openModePicker(actionNode); return; }
      if (action === 'pick-approvals') { openApprovalPicker(actionNode); return; }
      if (action === 'pick-reasoning') { openReasoningPicker(actionNode); return; }
      if (action === 'usage') { openUsagePanel(actionNode); return; }
      if (action === 'session-menu' || action === 'open-session-menu') { openSessionMenu(actionNode); return; }
      if (action === 'toggle-rail') { App.toggleRail(); return; }
      if (action === 'suggest') { handleSuggestion(actionNode.dataset.suggest); return; }
      if (action === 'copy-user') {
        const bubble = actionNode.closest('.msg-user')?.querySelector('.user-text');
        if (bubble) U.copyText(bubble.textContent).then((ok) => UI.toast(ok ? 'Message copied.' : 'Clipboard unavailable.', ok ? 'success' : 'error'));
        return;
      }
      if (action === 'copy-assistant') {
        const text = actionNode.closest('.msg-assistant')?.querySelector('.assistant-text');
        if (text) U.copyText(text.innerText).then((ok) => {
          actionNode.classList.toggle('copied', ok);
          const label = actionNode.querySelector('span');
          if (label) label.textContent = ok ? 'Copied' : 'Failed';
          setTimeout(() => { actionNode.classList.remove('copied'); if (label) label.textContent = 'Copy'; }, 1500);
        });
        return;
      }
      if (action === 'approval') { decideApproval(actionNode); return; }
      if (action === 'undo-checkpoint') { undoCheckpoint(actionNode); return; }
      if (action === 'open-file') { App.openFilePreview(actionNode.dataset.path); return; }
      if (action === 'open-screenshot') {
        window.blank?.computer?.openScreenshot(actionNode.dataset.path)
          .catch((error) => UI.toast(error.message, 'error'));
        return;
      }
      if (action === 'open-media') {
        if (actionNode.dataset.id) { App.openMedia(actionNode.dataset.id); return; }
        toggleMediaPanel();
        return;
      }
      if (action === 'save-media') { saveMediaFile(actionNode.dataset.id, actionNode); return; }
      if (action === 'save-media-workspace') { saveMediaToWorkspace(actionNode.dataset.id, actionNode); return; }
      if (action === 'save-workspace-file') { saveWorkspaceFile(actionNode.dataset.path, actionNode.dataset.name, actionNode); return; }
      if (action === 'open-paper') { if (window.Views?.openPaper) Views.openPaper(actionNode.dataset.id); return; }
      if (action === 'open-models') { App.openPage('models'); return; }
      if (action === 'toggle-reasoning') {
        actionNode.closest('.reasoning')?.classList.toggle('open');
        return;
      }
      if (action === 'toggle-tool') {
        actionNode.closest('.tool-card')?.classList.toggle('open');
        return;
      }
      if (action === 'new-session') { App.newSession(); return; }
    }
    const slash = event.target.closest('[data-command]');
    if (slash) executeCommand(slash.dataset.command);
  }

  function handleSuggestion(kind) {
    if (kind === 'tour') {
      send('Give me a tour of the harness and show real tool calls.');
    } else if (kind === 'inspect') {
      send('Inspect this workspace and explain its structure, key files, and conventions. Then suggest the most useful next step.');
    } else if (kind === 'plan') {
      if (!Chat.session?.id) Chat.draftMode = 'plan'; else {
        Chat.session.mode = 'plan';
        API.sessions.update({ id: Chat.session.id, mode: 'plan' }).catch(() => {});
      }
      renderHead();
      updateComposer();
      Chat.focusComposer('Plan this change: ');
    } else if (kind === 'review') {
      Chat.focusComposer('Review the current changes. Focus on correctness, security, and missing tests.');
    } else if (kind === 'design') {
      if (!Chat.session?.id) Chat.draftMode = 'design'; else {
        Chat.session.mode = 'design';
        API.sessions.update({ id: Chat.session.id, mode: 'design' }).catch(() => {});
      }
      renderHead();
      updateComposer();
      Chat.focusComposer('Design a clean, responsive page for ');
    } else if (kind === 'audio') {
      if (window.Views?.openStudio) {
        Views.openStudio({ kind: 'audio', prompt: 'Warm ambient loop with soft piano, slow tape texture, 40 seconds' });
      }
    }
  }

  Chat.focusComposer = function focusComposer(text) {
    const input = document.getElementById('composer-input');
    if (!input) return;
    if (text != null) {
      input.value = text;
      U.autoGrow(input, 224);
      updateSendEnabled();
    }
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  };

  Chat.loadSession = async function loadSession(id, options = {}) {
    const token = ++Chat.loadToken;
    Chat.sending = false;
    Chat.buffer = [];
    Chat.run = null;
    Chat.running = false;
    Chat.queue = [];
    Chat.pendingApprovals.clear();
    Chat.activeSessionId = id;
    Chat.session = null;
    const headMain = document.getElementById('chat-head-main');
    if (headMain) headMain.innerHTML = '<div class="chat-title-line"><span class="chat-title">Loading session…</span></div>';
    const scroll = document.getElementById('chat-scroll');
    if (scroll) scroll.innerHTML = `<div class="chat-empty"><div class="empty-state"><div class="empty-icon"><span class="spinner"></span></div><p>Reading the transcript…</p></div></div>`;
    try {
      const result = await API.sessions.get(id);
      if (token !== Chat.loadToken) return;
      if (!result.session) {
        UI.toast('That session no longer exists.', 'warn');
        App.newSession();
        return;
      }
      Chat.session = result.session;
      Chat.running = Boolean(result.running);
      Chat.queue = result.queue || [];
      Chat.draftMode = Chat.session.mode || 'agent';
      Chat.draftModel = Chat.session.model || Chat.draftModel;
      Chat.draftReasoning = Chat.session.reasoningEffort || '';
      renderHead();
      updateComposer();
      renderThread({ smooth: false, keepScroll: Boolean(options.keepScroll) });
      App.onChatLoaded(Chat.session);
    } catch (error) {
      if (token !== Chat.loadToken) return;
      UI.toast(error.message, 'error');
      App.newSession();
    }
  };

  Chat.newDraft = function newDraft(options = {}) {
    ++Chat.loadToken;
    Chat.session = null;
    Chat.running = false;
    Chat.sending = false;
    Chat.run = null;
    Chat.buffer = [];
    Chat.queue = [];
    Chat.pendingApprovals.clear();
    Chat.activeSessionId = null;
    Chat.attachments = [];
    Chat.draftModel = App.state.config?.defaultModel || Chat.draftModel || '';
    Chat.draftMode = 'agent';
    Chat.draftReasoning = '';
    const input = document.getElementById('composer-input');
    if (input) { input.value = ''; U.autoGrow(input, 224); }
    renderAttachments();
    renderHead();
    updateComposer();
    showEmpty();
    if (!options.silent) setTimeout(() => input?.focus(), 30);
  };

  Chat.getModel = currentModel;
  Chat.getMode = currentMode;

  Chat.refreshHeader = function refreshHeader() {
    if (!Chat.session && !document.getElementById('chat-head-main')) return;
    renderHead();
    updateComposer();
    if (!Chat.session) Chat.draftModel = App.state.config?.defaultModel || Chat.draftModel;
    refreshEmptyState();
  };

  Chat.onConfigChanged = function onConfigChanged() {
    if (!Chat.session) Chat.draftModel = App.state.config?.defaultModel || Chat.draftModel;
    renderHead();
    updateComposer();
    refreshEmptyState();
  };

  Chat.handleEvent = handleEvent;
  Chat.send = send;
  Chat.stop = stopRun;
  Chat.isBusy = () => Chat.running || Chat.sending;

  window.ChatView = Chat;
})();
