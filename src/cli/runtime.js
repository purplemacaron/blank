'use strict';

const fs = require('fs');
const path = require('path');
const configModule = require('../core/config');
const catalog = require('../core/catalog');
const store = require('../core/store');
const { appPaths, uid } = require('../core/paths');
const { runAgent, compactSession } = require('../core/agent');
const { MCPManager } = require('../core/mcp');
const learn = require('../core/learn');
const { MODES, resolveSession } = require('./support');
const { createStyle } = require('./style');

function findModelByQuery(query, config) {
  if (!query) return null;
  const models = catalog.allModels(config);
  return models.find((model) => model.fullId === query)
    || models.find((model) => model.id === query)
    || models.find((model) => model.name.toLowerCase() === query.toLowerCase())
    || models.find((model) => model.name.toLowerCase().includes(query.toLowerCase()))
    || null;
}

function providerState(config) {
  const map = {};
  for (const provider of catalog.allProviders(config)) {
    const key = configModule.resolveKey(config, provider.id, provider);
    map[provider.id] = Boolean(key) || provider.kind === 'local';
  }
  return map;
}

function createRuntime({
  config,
  workspace,
  mode,
  model,
  sessionId,
  autoYes = false,
  verbose = false,
  color = true,
} = {}) {
  const style = createStyle(color);
  const { blue, bold, dim, green, red, yellow } = style;
  const mcp = new MCPManager();
  let current = config || configModule.loadConfig();
  let session = sessionId ? store.getSession(sessionId) : null;
  if (sessionId && !session) throw new Error(`Session not found: ${sessionId}`);
  if (!session) {
    session = store.createSession({
      workspace,
      model: current.defaultModel,
      mode: mode || 'agent',
      title: 'New session',
    });
  }
  if (model) session.model = model;
  let currentWorkspace = session.workspace || workspace;
  let controller = null;
  let closed = false;

  function printModels(print) {
    const connected = providerState(current);
    const models = catalog.allModels(current);
    let heading = '';
    for (const item of models) {
      if (item.providerName !== heading) {
        heading = item.providerName;
        print('');
        print(`  ${bold(item.providerName)} ${connected[item.providerId] ? dim('connected') : dim('needs a key')}`);
      }
      const active = item.fullId === current.defaultModel;
      print(`  ${active ? blue('●') : dim('○')} ${item.fullId.padEnd(52)} ${dim(item.name)}`);
    }
    print('');
    print(dim(`  default: ${current.defaultModel}`));
    print(dim('  set with: /model <id>'));
    print('');
  }

  function printSkills(print) {
    const skills = store.listSkills(currentWorkspace, current);
    print('');
    for (const skill of skills) {
      const badge = skill.source === 'bundled' ? dim('built-in') : dim(skill.source);
      print(`  ${skill.enabled ? blue('●') : dim('○')} ${bold(skill.name)}  ${badge}`);
      print(`    ${dim(skill.id)} · ${skill.description || 'No description'}`);
    }
    if (!skills.length) print(dim('  No skills yet. Add ~/.blank/skills/<name>/SKILL.md'));
    print('');
  }

  function printMemory(print, entries) {
    print('');
    if (!entries.length) print(dim('  No memories yet. Try: /memory add <text>'));
    for (const entry of entries) {
      print(`  ${entry.pinned ? blue('●') : dim('○')} ${entry.text}`);
      print(`    ${dim(`${entry.id} · ${(entry.tags || []).join(' ') || 'untagged'} · ${entry.source}`)}`);
    }
    print('');
  }

  function printMcp(print) {
    const servers = mcp.statuses(current);
    print('');
    if (!servers.length) print(dim('  No MCP servers. Add one: /mcp example'));
    for (const server of servers) {
      const state = server.connected ? green('connected') : server.enabled ? yellow('offline') : dim('disabled');
      print(`  ${server.connected ? blue('●') : dim('○')} ${bold(server.name)}  ${state}  ${dim(`${server.toolCount} tools`)}`);
      print(`    ${dim(server.transport === 'http' ? server.url : server.command)}`);
      if (server.error) print(`    ${red(server.error.split('\n')[0].slice(0, 160))}`);
    }
    print('');
  }

  function printSessionChoices(print, activeId) {
    const sessions = store.listSessions().slice(0, 15);
    print('');
    if (!sessions.length) {
      print(dim('  No sessions yet.'));
      print('');
      return;
    }
    for (const [index, item] of sessions.entries()) {
      const active = item.id === activeId ? blue('●') : dim('○');
      const folder = item.workspace ? ` · ${path.basename(item.workspace)}` : '';
      print(`  ${String(index + 1).padStart(2)} ${active} ${item.title}  ${dim(`${item.id} · ${item.model}${folder}`)}`);
    }
    print('');
    print(dim('  /resume <n|id> to switch · /rename <title> to name this session'));
    print('');
  }

  function helpText(print) {
    const rows = [
      ['/help', 'Show this help'],
      ['/model [id]', 'List models or switch the session model'],
      ['/mode [agent|coding|design|research|plan|ask]', 'Switch mode'],
      ['/new', 'Start a new session'],
      ['/sessions', 'List recent sessions'],
      ['/resume [n|id]', 'Switch to a session'],
      ['/rename <title>', 'Rename the current session'],
      ['/compact', 'Summarize earlier context'],
      ['/memory [query]', 'List or search memory'],
      ['/memory add <text>', 'Save a memory'],
      ['/skills', 'List skills'],
      ['/skill <name>', 'Print a skill'],
      ['/mcp', 'List MCP servers'],
      ['/mcp example', 'Add the bundled echo server'],
      ['/mcp refresh', 'Reconnect all MCP servers'],
      ['/learn', 'Reflect and propose improvements'],
      ['/workspace [path]', 'Show or change the workspace'],
      ['/config', 'Show paths and settings'],
      ['/init', 'Create AGENTS.md in the workspace'],
      ['/clear', 'Clear the screen'],
      ['/exit', 'Quit'],
    ];
    print('');
    for (const [cmd, text] of rows) print(`  ${blue(cmd.padEnd(46))} ${dim(text)}`);
    print('');
    print(dim('  Enter sends · Tab completes · Ctrl+C stops or exits · approvals ask first'));
    print('');
  }

  function newSession() {
    if (session && Array.isArray(session.messages) && session.messages.length === 0) store.deleteSession(session.id);
    session = store.createSession({
      workspace: currentWorkspace,
      model: current.defaultModel,
      mode: session?.mode || mode || 'agent',
      title: 'New session',
    });
    return session;
  }

  function resumeSession(target) {
    if (!target) return false;
    if (session && Array.isArray(session.messages) && session.messages.length === 0) store.deleteSession(session.id);
    session = target;
    currentWorkspace = session.workspace || currentWorkspace;
    return true;
  }

  async function run(text, { emit, requestApproval } = {}) {
    const message = { id: uid('msg_'), role: 'user', content: text, at: new Date().toISOString() };
    session.messages.push(message);
    if (!session.title || session.title === 'New session') session.title = store.titleFrom(text);
    store.saveSession(session);
    const active = new AbortController();
    controller = active;
    try {
      return await runAgent({
        session,
        config: current,
        emit,
        signal: active.signal,
        requestApproval,
        mcp,
      });
    } catch (error) {
      return { ok: false, error: error.message };
    } finally {
      controller = null;
      store.saveSession(session);
    }
  }

  async function command(input, { print }) {
    const line = String(input || '').trim();
    const [commandName, ...rest] = line.split(/\s+/);
    const argText = line.slice(commandName.length).trim();
    current = configModule.loadConfig();
    switch (commandName) {
      case '/exit':
      case '/quit':
        return { action: 'exit' };
      case '/help':
        helpText(print);
        return { action: 'done' };
      case '/model': {
        if (!argText) { printModels(print); return { action: 'done' }; }
        const found = findModelByQuery(argText, current);
        if (!found) { print(red(`  Unknown model: ${argText}`)); return { action: 'done' }; }
        session.model = found.fullId;
        store.saveSession(session);
        print(`  ${blue('●')} model → ${bold(found.fullId)}`);
        return { action: 'done' };
      }
      case '/mode': {
        if (!argText) { print(`  mode is ${bold(session.mode)}`); return { action: 'done' }; }
        if (!MODES.includes(argText)) { print(red(`  mode must be ${MODES.join(', ')}`)); return { action: 'done' }; }
        session.mode = argText;
        store.saveSession(session);
        print(`  ${blue('●')} mode → ${bold(argText)}`);
        return { action: 'done' };
      }
      case '/new':
        newSession();
        return { action: 'new', session };
      case '/sessions':
        printSessionChoices(print, session.id);
        return { action: 'done' };
      case '/resume': {
        if (!argText) { printSessionChoices(print, session.id); return { action: 'done' }; }
        if (controller) { print(dim('  a run is in progress — Ctrl+C to stop')); return { action: 'done' }; }
        const sessions = store.listSessions();
        const result = resolveSession(sessions, argText);
        if (result.error === 'empty') { print(dim('  Usage: /resume <n|id> · /sessions lists them')); return { action: 'done' }; }
        if (result.error === 'range') { print(red('  No session at that number. Use /sessions.')); return { action: 'done' }; }
        if (result.error === 'ambiguous') { print(red('  That id prefix matches more than one session. Use the full id.')); return { action: 'done' }; }
        if (result.error === 'missing') { print(red(`  No session matches: ${argText}`)); return { action: 'done' }; }
        if (result.session.id === session.id) { print(dim('  already in that session')); return { action: 'done' }; }
        const target = store.getSession(result.session.id);
        if (!target) { print(red('  Could not load that session.')); return { action: 'done' }; }
        resumeSession(target);
        return { action: 'resume', session };
      }
      case '/rename': {
        if (!argText) { print(`  title is ${bold(session.title)}  ${dim('· /rename <title>')}`); return { action: 'done' }; }
        const title = argText.replace(/\s+/g, ' ').trim().slice(0, 80);
        session.title = title;
        session.titleSource = 'manual';
        store.saveSession(session);
        print(`  ${blue('●')} renamed → ${bold(title)}`);
        return { action: 'done' };
      }
      case '/compact': {
        const result = await compactSession({ session, config: current });
        if (result.ok) print(`  ${green('✓')} compacted ${result.compacted} messages`);
        else print(`  ${red('✕')} ${result.error}`);
        return { action: 'done' };
      }
      case '/memory': {
        if (!argText) { printMemory(print, store.listMemory().slice(0, 25)); return { action: 'done' }; }
        if (argText.startsWith('add ')) {
          const entry = store.addMemory({ text: argText.slice(4), source: 'cli' });
          print(`  ${green('✓')} remembered: ${entry.text}`);
          return { action: 'done' };
        }
        printMemory(print, store.searchMemory(argText, 20));
        return { action: 'done' };
      }
      case '/skills':
        printSkills(print);
        return { action: 'done' };
      case '/skill': {
        const skill = store.getSkill(argText, currentWorkspace);
        if (!skill) { print(red('  Skill not found. Use /skills.')); return { action: 'done' }; }
        print('');
        print(`  ${bold(skill.name)}  ${dim(skill.id)}`);
        print(skill.body.split('\n').map((row) => `  ${row}`).join('\n'));
        print('');
        return { action: 'done' };
      }
      case '/mcp': {
        if (!argText) {
          await mcp.ensure(current);
          printMcp(print);
          return { action: 'done' };
        }
        if (argText === 'refresh') {
          await mcp.ensure(current, { force: true });
          printMcp(print);
          return { action: 'done' };
        }
        if (argText === 'example') {
          const fresh = configModule.loadConfig();
          if (!(fresh.mcpServers || []).some((server) => server.example)) {
            const file = path.join(__dirname, '..', '..', 'examples', 'mcp-echo-server.js');
            fresh.mcpServers = [...(fresh.mcpServers || []), {
              id: `mcp_echo_${Math.random().toString(36).slice(2, 6)}`,
              name: 'Echo (example)',
              transport: 'stdio',
              enabled: true,
              command: `node "${file}"`,
              cwd: '',
              url: '',
              env: {},
              headers: {},
              example: true,
            }];
            configModule.saveConfig(fresh);
          }
          current = fresh;
          await mcp.ensure(fresh, { force: true });
          printMcp(print);
          return { action: 'done' };
        }
        print(dim('  /mcp · /mcp example · /mcp refresh'));
        return { action: 'done' };
      }
      case '/config': {
        print(`  ${dim('home')}      ${appPaths().root}`);
        print(`  ${dim('workspace')} ${currentWorkspace}`);
        print(`  ${dim('model')}     ${session.model}`);
        print(`  ${dim('mode')}      ${session.mode}`);
        print(`  ${dim('permissions')} ${JSON.stringify(current.permissions)}`);
        return { action: 'done' };
      }
      case '/workspace': {
        if (!argText) { print(`  ${currentWorkspace}`); return { action: 'done' }; }
        const next = path.resolve(argText);
        if (!fs.existsSync(next) || !fs.statSync(next).isDirectory()) { print(red('  Not a directory.')); return { action: 'done' }; }
        session.workspace = next;
        store.saveSession(session);
        currentWorkspace = next;
        print(`  ${blue('●')} workspace → ${next}`);
        return { action: 'done' };
      }
      case '/learn': {
        if (!learn.pickReflectionModel(current)) { print(red('  Connect a hosted model first.')); return { action: 'done' }; }
        print(dim('  reflecting on recent sessions…'));
        try {
          const state = await learn.reflectNow({ config: current, workspace: currentWorkspace });
          if (!state.ok) print(red(`  ✕ ${state.error}`));
          else if (state.added.length) {
            for (const insight of state.added) {
              print(`  ${blue('●')} ${bold(insight.title)} ${dim(insight.type)}`);
              print(`    ${insight.content.slice(0, 300)}`);
            }
            print(dim('  Review and apply these in the blank app → Learning.'));
          } else print(dim('  No new insights.'));
        } catch (error) {
          print(red(`  ✕ ${error.message}`));
        }
        return { action: 'done' };
      }
      case '/init': {
        const file = path.join(currentWorkspace, 'AGENTS.md');
        if (fs.existsSync(file)) { print(`  ${dim('AGENTS.md already exists')} · ${file}`); return { action: 'done' }; }
        const content = `# AGENTS.md\n\nGuidance for coding agents working in this repository. blank reads this file automatically.\n\n## Working agreements\n\n- Read a file before changing it. Keep changes focused.\n- Match the existing style and architecture.\n- Run the relevant checks before claiming work is done.\n- Never commit secrets or unrelated changes.\n\n## Project context\n\n<!-- Add architecture notes and known pitfalls here. -->\n`;
        fs.writeFileSync(file, content, 'utf8');
        print(`  ${green('✓')} created ${file}`);
        return { action: 'done' };
      }
      case '/clear':
        return { action: 'clear' };
      default:
        print(dim(`  Unknown command: ${commandName}. Try /help.`));
        return { action: 'done' };
    }
  }

  async function close() {
    if (closed) return;
    closed = true;
    controller?.abort();
    if (session && Array.isArray(session.messages) && session.messages.length === 0) store.deleteSession(session.id);
    await mcp.closeAll().catch(() => {});
  }

  return {
    get session() { return session; },
    get config() { return current; },
    get workspace() { return currentWorkspace; },
    get verbose() { return verbose; },
    get autoYes() { return autoYes; },
    get active() { return Boolean(controller); },
    get mcp() { return mcp; },
    abort() { controller?.abort(); },
    run,
    command,
    newSession,
    resumeSession,
    findModel: (query) => findModelByQuery(query, current),
    listSessions: () => store.listSessions(),
    listModels: () => catalog.allModels(current),
    close,
  };
}

module.exports = { createRuntime, findModelByQuery };
