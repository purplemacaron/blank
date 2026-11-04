#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const configModule = require('../src/core/config');
const catalog = require('../src/core/catalog');
const store = require('../src/core/store');
const { appPaths, uid } = require('../src/core/paths');
const { runAgent, compactSession } = require('../src/core/agent');
const { MCPManager } = require('../src/core/mcp');
const learn = require('../src/core/learn');
const { summarizeArgs } = require('../src/core/tools');

const pkg = require('../package.json');
const colorEnabled = process.stdout.isTTY && !process.env.NO_COLOR;
const style = (code) => (text) => (colorEnabled ? `\x1b[${code}m${text}\x1b[0m` : String(text));
const blue = style('38;2;47;107;255');
const bold = style('1');
const dim = style('2');
const green = style('38;2;27;135;95');
const red = style('38;2;199;61;61');
const yellow = style('38;2;176;115;15');
const underline = style('4');

const mcp = new MCPManager();
let activeController = null;
let rl = null;
let closed = false;

function log(...args) { process.stdout.write(`${args.join(' ')}\n`); }
function blankLine() { process.stdout.write('\n'); }

function shortPath(value) {
  const home = os.homedir();
  if (value && value.startsWith(home)) return `~${value.slice(home.length)}`;
  return value || '';
}

function formatTokens(tokens) {
  if (!tokens) return '0';
  if (tokens < 1000) return String(tokens);
  return `${(tokens / 1000).toFixed(1)}k`;
}

function banner(config, workspace, session) {
  const dot = blue('■');
  log('');
  log(`  ${dot} ${bold('blank')} ${dim(`v${pkg.version}`)}  ${dim('a quiet agent harness')}`);
  log('');
  log(`  ${dim('workspace')}  ${shortPath(workspace)}`);
  log(`  ${dim('model    ')}  ${session.model}`);
  log(`  ${dim('mode     ')}  ${session.mode}   ${dim('/help for commands')}`);
  log('');
}

function providerState(config) {
  const map = {};
  for (const provider of catalog.allProviders(config)) {
    const key = configModule.resolveKey(config, provider.id, provider);
    map[provider.id] = Boolean(key) || provider.kind === 'local';
  }
  return map;
}

function findModelByQuery(query, config) {
  if (!query) return null;
  const models = catalog.allModels(config);
  return models.find((model) => model.fullId === query)
    || models.find((model) => model.id === query)
    || models.find((model) => model.name.toLowerCase() === query.toLowerCase())
    || models.find((model) => model.name.toLowerCase().includes(query.toLowerCase()))
    || null;
}

function printModels(config) {
  const connected = providerState(config);
  const models = catalog.allModels(config);
  let current = '';
  for (const model of models) {
    if (model.providerName !== current) {
      current = model.providerName;
      blankLine();
      log(`  ${bold(model.providerName)} ${connected[model.providerId] ? dim('connected') : dim('needs a key')}`);
    }
    const active = model.fullId === config.defaultModel;
    const mark = active ? blue('●') : dim('○');
    log(`  ${mark} ${model.fullId.padEnd(52)} ${dim(model.name)}`);
  }
  blankLine();
  log(dim(`  default: ${config.defaultModel}`));
  log(dim('  set with: /model <id>'));
  blankLine();
}

function printSkills(workspace, config) {
  const skills = store.listSkills(workspace, config);
  blankLine();
  for (const skill of skills) {
    const badge = skill.source === 'bundled' ? dim('built-in') : dim(skill.source);
    log(`  ${skill.enabled ? blue('●') : dim('○')} ${bold(skill.name)}  ${badge}`);
    log(`    ${dim(skill.id)} · ${skill.description || 'No description'}`);
  }
  if (!skills.length) log(dim('  No skills yet. Add ~/.blank/skills/<name>/SKILL.md'));
  blankLine();
}

function printMemory(entries) {
  blankLine();
  if (!entries.length) log(dim('  No memories yet. Try: /memory add <text>'));
  for (const entry of entries) {
    log(`  ${entry.pinned ? blue('●') : dim('○')} ${entry.text}`);
    log(`    ${dim(`${entry.id} · ${(entry.tags || []).join(' ') || 'untagged'} · ${entry.source}`)}`);
  }
  blankLine();
}

function printMcp(config) {
  const servers = mcp.statuses(config);
  blankLine();
  if (!servers.length) log(dim('  No MCP servers. Add one: /mcp example'));
  for (const server of servers) {
    const state = server.connected ? green('connected') : server.enabled ? yellow('offline') : dim('disabled');
    log(`  ${server.connected ? blue('●') : dim('○')} ${bold(server.name)}  ${state}  ${dim(`${server.toolCount} tools`)}`);
    log(`    ${dim(server.transport === 'http' ? server.url : server.command)}`);
    if (server.error) log(`    ${red(server.error.split('\n')[0].slice(0, 160))}`);
  }
  blankLine();
}

function helpText() {
  const rows = [
    ['/help', 'Show this help'],
    ['/model [id]', 'List models or switch the session model'],
    ['/mode [agent|coding|design|plan|ask]', 'Switch mode'],
    ['/new', 'Start a new session'],
    ['/sessions', 'List recent sessions'],
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
  blankLine();
  for (const [cmd, text] of rows) log(`  ${blue(cmd.padEnd(26))} ${dim(text)}`);
  blankLine();
  log(dim('  Enter to send · Ctrl+C to stop a run or exit · approvals ask first by default'));
  blankLine();
}

function toolLineStart(event) {
  const target = event.summary ? dim(` · ${String(event.summary).replace(/\s+/g, ' ').slice(0, 110)}`) : '';
  log(`  ${dim('◇')} ${event.label || event.name}${target}`);
}

function toolLineEnd(event) {
  if (event.isError) {
    const first = String(event.content || '').split('\n').slice(0, 3).join(' / ').slice(0, 300);
    log(`  ${red('✕')} ${event.name} ${red(first)}`);
  } else {
    let extra = '';
    if (event.meta?.count !== undefined) extra = dim(` · ${event.meta.count} result${event.meta.count === 1 ? '' : 's'}`);
    if (event.meta?.path) extra += dim(` · ${event.meta.path}`);
    if (event.meta?.exitCode !== undefined) extra += dim(` · exit ${event.meta.exitCode}`);
    log(`  ${green('✓')} ${event.name}${extra}`);
  }
}

async function askApproval(event, config, autoYes) {
  const args = event.args || {};
  if (autoYes) {
    log(`  ${yellow('!')} auto-approved ${event.label || event.tool}`);
    return 'allow';
  }
  blankLine();
  log(`  ${yellow('Approval needed')}  ${bold(event.label || event.tool)}${event.reason ? `  ${dim(`(${event.reason})`)}` : ''}`);
  const summary = summarizeArgs(event.tool, args);
  if (summary) log(`  ${dim(summary.slice(0, 200))}`);
  const extra = JSON.stringify(args, null, 2);
  if (extra && extra !== '{}') {
    const clipped = extra.split('\n').slice(0, 12).join('\n');
    log(clipped.split('\n').map((line) => `  ${dim(line)}`).join('\n'));
  }
  blankLine();
  awaitingApproval = true;
  const answer = await ask('[y] allow once  [a] always  [n] deny > ', 'n');
  awaitingApproval = false;
  const value = answer.trim().toLowerCase();
  if (value === 'a' || value === 'always') return 'always';
  if (value === 'y' || value === 'yes') return 'allow';
  return 'deny';
}

let awaitingApproval = false;

function ask(question, fallback = '') {
  return new Promise((resolve) => {
    if (!rl) return resolve(fallback);
    rl.question(question, (answer) => resolve(answer));
  });
}

async function sendMessage(session, text, { config, autoYes, verbose, onDone }) {
  const message = { id: uid('msg_'), role: 'user', content: text, at: new Date().toISOString() };
  session.messages.push(message);
  if (!session.title || session.title === 'New session') session.title = store.titleFrom(text);
  store.saveSession(session);

  const controller = new AbortController();
  activeController = controller;
  let firstText = true;
  let lastWasText = false;

  const emit = (event) => {
    if (event.type === 'assistant:start') {
      firstText = true;
      lastWasText = false;
    } else if (event.type === 'text') {
      if (firstText) {
        blankLine();
        process.stdout.write(dim('  blank  '));
        firstText = false;
      }
      process.stdout.write(event.delta.replace(/\n/g, '\n         '));
      lastWasText = true;
    } else if (event.type === 'reasoning') {
      if (verbose) process.stdout.write(dim(event.delta));
    } else if (event.type === 'tool:start') {
      if (lastWasText) { blankLine(); lastWasText = false; }
      toolLineStart(event);
    } else if (event.type === 'tool:end') {
      toolLineEnd(event);
      if (verbose && event.content) {
        const clipped = String(event.content).split('\n').slice(0, 20).join('\n');
        log(clipped.split('\n').map((line) => `    ${dim(line)}`).join('\n'));
      }
    } else if (event.type === 'notice') {
      log(`  ${event.level === 'warn' ? yellow('!') : dim('·')} ${dim(event.text)}`);
    } else if (event.type === 'error') {
      blankLine();
      log(`  ${red('✕')} ${event.message}`);
      if (event.hint) log(`    ${dim(event.hint)}`);
    } else if (event.type === 'compacted') {
      log(`  ${dim('·')} context compacted`);
    }
  };

  const requestApproval = (request) => askApproval(request, config, autoYes);

  try {
    const outcome = await runAgent({
      session,
      config,
      emit,
      signal: controller.signal,
      requestApproval,
      mcp,
    });
    if (lastWasText) blankLine();
    if (outcome.ok) {
      log(dim(`  ${formatTokens(session.usage?.input)} in · ${formatTokens(session.usage?.output)} out · ${outcome.steps} step${outcome.steps === 1 ? '' : 's'}`));
    } else if (outcome.stopped) {
      log(dim('  stopped'));
    }
  } catch (err) {
    blankLine();
    log(`  ${red('✕')} ${err.message}`);
  } finally {
    activeController = null;
    store.saveSession(session);
    onDone?.();
  }
}

async function handleCommand(input, context) {
  const { session, config, workspace } = context;
  const [command, ...rest] = input.trim().split(/\s+/);
  const argText = input.trim().slice(command.length).trim();
  switch (command) {
    case '/exit':
    case '/quit':
      context.shutdown();
      return;
    case '/help':
      helpText();
      return;
    case '/model': {
      if (!argText) {
        printModels(config);
        return;
      }
      const model = findModelByQuery(argText, config);
      if (!model) { log(red(`  Unknown model: ${argText}`)); return; }
      session.model = model.fullId;
      store.saveSession(session);
      log(`  ${blue('●')} model → ${bold(model.fullId)}`);
      return;
    }
    case '/mode': {
      if (!argText) { log(`  mode is ${bold(session.mode)}`); return; }
      if (!['agent', 'coding', 'design', 'plan', 'ask'].includes(argText)) { log(red('  mode must be agent, coding, design, plan, or ask')); return; }
      session.mode = argText;
      store.saveSession(session);
      log(`  ${blue('●')} mode → ${bold(argText)}`);
      return;
    }
    case '/new':
      context.newSession();
      return;
    case '/sessions': {
      const sessions = store.listSessions().slice(0, 15);
      blankLine();
      for (const item of sessions) {
        const active = item.id === session.id ? blue('●') : dim('○');
        log(`  ${active} ${item.title}  ${dim(`${item.id} · ${item.model}`)}`);
      }
      blankLine();
      return;
    }
    case '/compact': {
      const result = await compactSession({ session, config });
      if (result.ok) log(`  ${green('✓')} compacted ${result.compacted} messages`);
      else log(`  ${red('✕')} ${result.error}`);
      return;
    }
    case '/memory': {
      if (!argText) { printMemory(store.listMemory().slice(0, 25)); return; }
      if (argText.startsWith('add ')) {
        const entry = store.addMemory({ text: argText.slice(4), source: 'cli' });
        log(`  ${green('✓')} remembered: ${entry.text}`);
        return;
      }
      printMemory(store.searchMemory(argText, 20));
      return;
    }
    case '/skills':
      printSkills(workspace, config);
      return;
    case '/skill': {
      const skill = store.getSkill(argText, workspace);
      if (!skill) { log(red('  Skill not found. Use /skills.')); return; }
      blankLine();
      log(`  ${bold(skill.name)}  ${dim(skill.id)}`);
      log(skill.body.split('\n').map((line) => `  ${line}`).join('\n'));
      blankLine();
      return;
    }
    case '/mcp': {
      if (!argText) {
        await mcp.ensure(config);
        printMcp(config);
        return;
      }
      if (argText === 'refresh') {
        await mcp.ensure(config, { force: true });
        printMcp(config);
        return;
      }
      if (argText === 'example') {
        const fresh = configModule.loadConfig();
        if (!(fresh.mcpServers || []).some((server) => server.example)) {
          const file = path.join(__dirname, '..', 'examples', 'mcp-echo-server.js');
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
        config = fresh;
        context.config = fresh;
        await mcp.ensure(fresh, { force: true });
        printMcp(fresh);
        return;
      }
      log(dim('  /mcp · /mcp example · /mcp refresh'));
      return;
    }
    case '/config': {
      log(`  ${dim('home')}      ${appPaths().root}`);
      log(`  ${dim('workspace')} ${workspace}`);
      log(`  ${dim('model')}     ${session.model}`);
      log(`  ${dim('mode')}      ${session.mode}`);
      log(`  ${dim('permissions')} ${JSON.stringify(config.permissions)}`);
      return;
    }
    case '/workspace': {
      if (!argText) { log(`  ${workspace}`); return; }
      const next = path.resolve(argText);
      if (!fs.existsSync(next) || !fs.statSync(next).isDirectory()) { log(red('  Not a directory.')); return; }
      session.workspace = next;
      store.saveSession(session);
      context.workspace = next;
      log(`  ${blue('●')} workspace → ${next}`);
      return;
    }
    case '/learn': {
      if (!learn.pickReflectionModel(config)) { log(red('  Connect a hosted model first.')); return; }
      log(dim('  reflecting on recent sessions…'));
      try {
        const state = await learn.reflectNow({ config, workspace });
        if (!state.ok) log(red(`  ✕ ${state.error}`));
        else {
          if (state.added.length) {
            for (const insight of state.added) {
              log(`  ${blue('●')} ${bold(insight.title)} ${dim(insight.type)}`);
              log(`    ${insight.content.slice(0, 300)}`);
            }
            log(dim('  Review and apply these in the Blank app → Learning.'));
          } else {
            log(dim('  No new insights.'));
          }
        }
      } catch (err) {
        log(red(`  ✕ ${err.message}`));
      }
      return;
    }
    case '/init': {
      const file = path.join(workspace, 'AGENTS.md');
      if (fs.existsSync(file)) { log(`  ${dim('AGENTS.md already exists')} · ${file}`); return; }
      const content = `# AGENTS.md\n\nGuidance for coding agents working in this repository. Blank reads this file automatically.\n\n## Working agreements\n\n- Read a file before changing it. Keep changes focused.\n- Match the existing style and architecture.\n- Run the relevant checks before claiming work is done.\n- Never commit secrets or unrelated changes.\n\n## Project context\n\n<!-- Add architecture notes and known pitfalls here. -->\n`;
      fs.writeFileSync(file, content, 'utf8');
      log(`  ${green('✓')} created ${file}`);
      return;
    }
    case '/clear':
      process.stdout.write('\x1bc');
      banner(config, workspace, session);
      return;
    default:
      log(dim(`  Unknown command: ${command}. Try /help.`));
  }
}

function createCliSession(workspace, config, mode) {
  return store.createSession({
    workspace,
    model: config.defaultModel,
    mode: mode || 'agent',
    title: 'New session',
  });
}

async function startRepl({ config, workspace, mode, autoYes, verbose, sessionId }) {
  let session = sessionId ? store.getSession(sessionId) : null;
  if (!session) session = createCliSession(workspace, config, mode);
  let currentConfig = config;
  let currentWorkspace = workspace;

  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    historySize: 200,
  });

  banner(currentConfig, currentWorkspace, session);

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    activeController?.abort();
    if (session && !session.messages.length) store.deleteSession(session.id);
    mcp.closeAll().finally(() => {
      closed = true;
      rl.close();
      log(dim('\n  bye.\n'));
      process.exit(0);
    });
  };

  const newSession = () => {
    if (session && !session.messages.length) store.deleteSession(session.id);
    session = createCliSession(currentWorkspace, currentConfig, session?.mode || mode);
    log(`  ${blue('●')} new session ${dim(session.id)}`);
    banner(currentConfig, currentWorkspace, session);
  };

  rl.on('SIGINT', () => {
    if (activeController) {
      activeController.abort();
      log(yellow('\n  stopping…'));
      if (awaitingApproval) {
        awaitingApproval = false;
        rl.write('\n');
      }
      return;
    }
    if (rl.line) {
      rl.write(null, { ctrl: true, name: 'u' });
      return;
    }
    shutdown();
  });

  rl.on('close', () => {
    if (!shuttingDown) shutdown();
  });

  const readInput = () => new Promise((resolve) => {
    if (closed) return resolve(null);
    rl.question(`${blue('›')} `, resolve);
  });

  while (!closed) {
    const raw = await readInput();
    if (raw === null) break;
    const line = raw.trim();
    if (!line) continue;
    currentConfig = configModule.loadConfig();
    currentWorkspace = session.workspace || currentWorkspace;
    if (line.startsWith('/')) {
      await handleCommand(line, {
        session,
        config: currentConfig,
        workspace: currentWorkspace,
        shutdown,
        newSession,
      });
      continue;
    }
    if (activeController) { log(dim('  a run is in progress — Ctrl+C to stop')); continue; }
    await sendMessage(session, line, {
      config: currentConfig,
      autoYes,
      verbose,
      onDone: () => {},
    });
  }
  if (!closed) shutdown();
}

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--model' || value === '-m') args.flags.model = argv[++i];
    else if (value === '--mode') args.flags.mode = argv[++i];
    else if (value === '--workspace' || value === '-w') args.flags.workspace = argv[++i];
    else if (value === '--session') args.flags.session = argv[++i];
    else if (value === '--yes' || value === '-y') args.flags.yes = true;
    else if (value === '--verbose' || value === '-v') args.flags.verbose = true;
    else if (value === '--help' || value === '-h') args.flags.help = true;
    else if (value === '--version' || value === '-V') args.flags.version = true;
    else args._.push(value);
  }
  return args;
}

async function oneShot({ prompt, config, workspace, mode, model, autoYes, verbose }) {
  config = configModule.loadConfig();
  if (model) {
    const found = findModelByQuery(model, config);
    if (!found) throw new Error(`Unknown model: ${model}`);
    config.defaultModel = found.fullId;
  }
  const session = createCliSession(workspace, config, mode);
  session.model = config.defaultModel;
  const useApprovals = process.stdin.isTTY && !autoYes;
  if (!process.stdin.isTTY && !autoYes) {
    log(dim('  non-interactive: write/edit/command tools will be denied (pass --yes to allow)'));
  }
  if (useApprovals) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  }
  try {
    await sendMessage(session, prompt, {
      config,
      autoYes,
      verbose,
      onDone: () => {},
    });
  } finally {
    if (rl) { rl.close(); rl = null; }
    await mcp.closeAll();
  }
}

function printSessions() {
  const sessions = store.listSessions().slice(0, 30);
  if (!sessions.length) { log(dim('  No sessions yet.')); return; }
  for (const item of sessions) {
    log(`  ${dim(item.id)}  ${item.title}  ${dim(item.updatedAt?.slice(0, 16).replace('T', ' '))}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || 'chat';
  const config = configModule.loadConfig();

  if (args.flags.version) { log(`Blank ${pkg.version}`); return; }
  if (args.flags.help || command === 'help') {
    log(`
  ${bold('blank')} ${dim(`v${pkg.version}`)} — a quiet agent harness

  ${dim('Usage')}
    blank                          Interactive session
    blank run "<prompt>"           One-shot task
    blank models                   List models
    blank sessions                 List recent sessions
    blank memory [list|add|search] Inspect memory
    blank skills                   List skills
    blank mcp [list|refresh|example]
    blank learn reflect            Propose improvements
    blank init                     Create AGENTS.md
    blank config                   Show configuration
    blank paths                    Show data directories

  ${dim('Options')}
    -m, --model <id>       Override the model
        --mode <mode>      agent | coding | design | plan | ask
    -w, --workspace <dir>  Workspace for this run
        --session <id>     Resume a session
    -y, --yes              Auto-approve tools (use carefully)
    -v, --verbose          Show tool output and reasoning
        --no-color         Disable ANSI colors
`);
    return;
  }

  let workspace = args.flags.workspace ? path.resolve(args.flags.workspace) : process.cwd();
  if (!fs.existsSync(workspace)) throw new Error(`Workspace not found: ${workspace}`);
  if (config.workspace && fs.existsSync(config.workspace) === false) config.workspace = workspace;

  if (command === 'chat') {
    if (args.flags.model) {
      const found = findModelByQuery(args.flags.model, config);
      if (found) { config.defaultModel = found.fullId; }
    }
    const mode = ['agent', 'coding', 'design', 'plan', 'ask'].includes(args.flags.mode) ? args.flags.mode : (args.flags.model ? undefined : 'agent');
    await startRepl({
      config,
      workspace,
      mode,
      autoYes: Boolean(args.flags.yes),
      verbose: Boolean(args.flags.verbose),
      sessionId: args.flags.session,
    });
    return;
  }

  if (command === 'run') {
    const prompt = args._.slice(1).join(' ').trim();
    if (!prompt) throw new Error('Usage: blank run "<prompt>"');
    await oneShot({
      prompt,
      config,
      workspace,
      mode: ['agent', 'coding', 'design', 'plan', 'ask'].includes(args.flags.mode) ? args.flags.mode : 'agent',
      model: args.flags.model,
      autoYes: Boolean(args.flags.yes),
      verbose: Boolean(args.flags.verbose),
    });
    return;
  }

  if (command === 'models') { printModels(config); return; }
  if (command === 'sessions') { printSessions(); return; }
  if (command === 'skills') {
    if (args._[1] === 'show') {
      const skill = store.getSkill(args._.slice(2).join(' '), workspace);
      if (!skill) throw new Error('Skill not found.');
      log(`\n${bold(skill.name)} ${dim(skill.id)}\n\n${skill.body}\n`);
      return;
    }
    printSkills(workspace, config);
    return;
  }
  if (command === 'memory') {
    const sub = args._[1] || 'list';
    if (sub === 'add') {
      const text = args._.slice(2).join(' ');
      if (!text) throw new Error('Usage: blank memory add "<text>"');
      const entry = store.addMemory({ text, source: 'cli' });
      log(`${green('✓')} remembered: ${entry.text}`);
      return;
    }
    if (sub === 'search') { printMemory(store.searchMemory(args._.slice(2).join(' '), 20)); return; }
    if (sub === 'rm' || sub === 'delete') {
      const ok = store.deleteMemory(args._[2]);
      log(ok ? `${green('✓')} deleted` : red('not found'));
      return;
    }
    printMemory(store.listMemory());
    return;
  }
  if (command === 'mcp') {
    const sub = args._[1] || 'list';
    if (sub === 'example') {
      const fresh = configModule.loadConfig();
      if (!(fresh.mcpServers || []).some((server) => server.example)) {
        const file = path.join(__dirname, '..', 'examples', 'mcp-echo-server.js');
        fresh.mcpServers = [...(fresh.mcpServers || []), {
          id: `mcp_echo_${Math.random().toString(36).slice(2, 6)}`,
          name: 'Echo (example)', transport: 'stdio', enabled: true,
          command: `node "${file}"`, cwd: '', url: '', env: {}, headers: {}, example: true,
        }];
        configModule.saveConfig(fresh);
      }
      await mcp.ensure(fresh, { force: true });
      printMcp(fresh);
      await mcp.closeAll();
      return;
    }
    if (sub === 'refresh') {
      await mcp.ensure(config, { force: true });
      printMcp(config);
      await mcp.closeAll();
      return;
    }
    if (sub === 'remove' || sub === 'rm') {
      const id = args._[2];
      const fresh = configModule.loadConfig();
      fresh.mcpServers = (fresh.mcpServers || []).filter((server) => server.id === id ? false : server.name !== id);
      configModule.saveConfig(fresh);
      log(`${green('✓')} removed`);
      return;
    }
    await mcp.ensure(config);
    printMcp(config);
    await mcp.closeAll();
    return;
  }
  if (command === 'learn') {
    const sub = args._[1] || 'reflect';
    if (sub === 'reflect') {
      const project = args.flags.workspace ? path.resolve(args.flags.workspace) : config.workspace || workspace;
      const result = await learn.reflectNow({ config, workspace: project });
      if (!result.ok) throw new Error(result.error);
      if (!result.added.length) { log(dim('No new insights.')); return; }
      for (const insight of result.added) {
        log(`\n${blue('●')} ${bold(insight.title)} ${dim(insight.type)}`);
        log(insight.content);
        if (insight.reason) log(dim(`why: ${insight.reason}`));
      }
      log(dim('\nReview and apply these in the Blank app → Learning.'));
      return;
    }
    if (sub === 'state') {
      const state = learn.getLearnState({ config, workspace });
      log(`  memories ${state.counts.memory} · skills ${state.counts.skills} · pending insights ${state.pending.length} · applied ${state.applied.length}`);
      return;
    }
    throw new Error('Usage: blank learn [reflect|state]');
  }
  if (command === 'init') {
    const file = path.join(workspace, 'AGENTS.md');
    if (fs.existsSync(file)) { log(`AGENTS.md already exists: ${file}`); return; }
    fs.writeFileSync(file, `# AGENTS.md\n\nGuidance for coding agents working in this repository. Blank reads this file automatically.\n\n## Working agreements\n\n- Read a file before changing it. Keep changes focused.\n- Match the existing style and architecture.\n- Run the relevant checks before claiming work is done.\n- Never commit secrets or unrelated changes.\n\n## Project context\n\n<!-- Add architecture notes and known pitfalls here. -->\n`, 'utf8');
    log(`${green('✓')} created ${file}`);
    return;
  }
  if (command === 'config') {
    log(`  home:       ${appPaths().root}`);
    log(`  workspace:  ${config.workspace || '(unset)'}`);
    log(`  model:      ${config.defaultModel}`);
    log(`  fallback:   ${config.fallbackModel || '(none)'}`);
    log(`  providers:  ${Object.entries(providerState(config)).filter(([, ok]) => ok).map(([id]) => id).join(', ')}`);
    log(`  permissions: ${JSON.stringify(config.permissions)}`);
    return;
  }
  if (command === 'paths') {
    log(`  config      ${appPaths().config}`);
    log(`  sessions    ${appPaths().sessions}`);
    log(`  memory      ${appPaths().memory}`);
    log(`  skills      ${appPaths().skills}`);
    log(`  checkpoints ${appPaths().checkpoints}`);
    return;
  }

  throw new Error(`Unknown command: ${command}. Try blank --help.`);
}

main().catch(async (err) => {
  log(red(`\nblank: ${err.message}\n`));
  await mcp.closeAll();
  process.exit(1);
});
