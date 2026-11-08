#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const configModule = require('../src/core/config');
const catalog = require('../src/core/catalog');
const store = require('../src/core/store');
const { appPaths } = require('../src/core/paths');
const { MCPManager } = require('../src/core/mcp');
const learn = require('../src/core/learn');
const { MODES, parseArgs, pickContinueSession, composePrompt } = require('../src/cli/support');
const { createRuntime, findModelByQuery } = require('../src/cli/runtime');
const { runPlain, runOneShot } = require('../src/cli/plain');
const { createStyle } = require('../src/cli/style');

const pkg = require('../package.json');
const colorEnabled = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR && !process.argv.includes('--no-color');
const style = createStyle(colorEnabled);
const { blue, bold, dim, green, red, yellow } = style;

const mcp = new MCPManager();

function log(...args) { process.stdout.write(`${args.join(' ')}\n`); }
function blankLine() { process.stdout.write('\n'); }

function providerState(config) {
  const map = {};
  for (const provider of catalog.allProviders(config)) {
    const key = configModule.resolveKey(config, provider.id, provider);
    map[provider.id] = Boolean(key) || provider.kind === 'local';
  }
  return map;
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

function printSessions() {
  const sessions = store.listSessions().slice(0, 30);
  if (!sessions.length) { log(dim('  No sessions yet.')); return; }
  for (const item of sessions) {
    log(`  ${dim(item.id)}  ${item.title}  ${dim(item.updatedAt?.slice(0, 16).replace('T', ' '))}`);
  }
}

function addExampleServer() {
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
  return fresh;
}

function wantsTui(args) {
  if (args.flags.plain) return false;
  if (process.env.BLANK_NO_TUI || process.env.NO_TUI) return false;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  if ((process.env.TERM || '') === 'dumb') return false;
  return true;
}

function printHelp() {
  log(`
  ${bold('blank')} ${dim(`v${pkg.version}`)} — a quiet agent harness

  ${dim('Usage')}
    blank                          Interactive session (full-screen TUI)
    blank --plain                  Interactive session without the TUI
    blank -c                       Continue the latest session here
    blank run "<prompt>"           One-shot task
    blank run -                    Prompt from stdin
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
        --mode <mode>      agent | coding | design | research | plan | ask
    -w, --workspace <dir>  Workspace for this run
    -c, --continue         Resume the most recent session
        --session <id>     Resume a specific session
    -y, --yes              Auto-approve tools (use carefully)
    -v, --verbose          Show tool output and reasoning
        --plain            Plain readline REPL (no alternate screen)
        --no-color         Disable ANSI colors
`);
}

async function readStdinText() {
  if (process.stdin.isTTY) return '';
  process.stdin.setEncoding('utf8');
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || 'chat';
  const config = configModule.loadConfig();

  if (args.flags.version) { log(`blank ${pkg.version}`); return; }
  if (args.flags.help || command === 'help') { printHelp(); return; }

  const workspace = args.flags.workspace ? path.resolve(args.flags.workspace) : process.cwd();
  if (!fs.existsSync(workspace)) throw new Error(`Workspace not found: ${workspace}`);
  if (config.workspace && fs.existsSync(config.workspace) === false) config.workspace = workspace;

  if (command === 'chat') {
    let model = '';
    if (args.flags.model) {
      const found = findModelByQuery(args.flags.model, config);
      if (!found) throw new Error(`Unknown model: ${args.flags.model}`);
      model = found.fullId;
      config.defaultModel = model;
    }
    let sessionId = args.flags.session;
    if (!sessionId && args.flags.continue) {
      const picked = pickContinueSession(store.listSessions(), workspace);
      if (picked) sessionId = picked.id;
      else log(dim('  no sessions to continue — starting a new one'));
    }
    const mode = MODES.includes(args.flags.mode) ? args.flags.mode : (args.flags.model ? undefined : 'agent');
    const runtime = createRuntime({
      config,
      workspace,
      mode,
      model,
      sessionId,
      autoYes: Boolean(args.flags.yes),
      verbose: Boolean(args.flags.verbose),
      color: colorEnabled,
    });
    if (wantsTui(args)) {
      const { runTui } = require('../src/cli/tui/app');
      await runTui(runtime, { color: colorEnabled });
    } else {
      await runPlain(runtime, { color: colorEnabled });
    }
    return;
  }

  if (command === 'run') {
    let prompt = args._.slice(1).join(' ').trim();
    if (!prompt || prompt === '-') {
      if (!process.stdin.isTTY) prompt = composePrompt(prompt, await readStdinText());
    }
    if (!prompt) throw new Error('Usage: blank run "<prompt>" (or pipe a prompt on stdin)');

    const runtime = createRuntime({
      config,
      workspace,
      mode: MODES.includes(args.flags.mode) ? args.flags.mode : 'agent',
      model: args.flags.model,
      autoYes: Boolean(args.flags.yes),
      verbose: Boolean(args.flags.verbose),
      color: colorEnabled,
    });
    await runOneShot(runtime, prompt, { color: colorEnabled });
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
      const fresh = addExampleServer();
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
      log(dim('\nReview and apply these in the blank app → Learning.'));
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
    fs.writeFileSync(file, `# AGENTS.md\n\nGuidance for coding agents working in this repository. blank reads this file automatically.\n\n## Working agreements\n\n- Read a file before changing it. Keep changes focused.\n- Match the existing style and architecture.\n- Run the relevant checks before claiming work is done.\n- Never commit secrets or unrelated changes.\n\n## Project context\n\n<!-- Add architecture notes and known pitfalls here. -->\n`, 'utf8');
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
