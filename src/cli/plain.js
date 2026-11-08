'use strict';

const os = require('os');
const readline = require('readline');
const { summarizeArgs } = require('../core/tools');
const { createStyle } = require('./style');
const pkg = require('../../package.json');

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

function banner(runtime, print, style) {
  const { blue, bold, dim } = style;
  print('');
  print(`  ${blue('■')} ${bold('blank')} ${dim(`v${pkg.version}`)}  ${dim('a quiet agent harness')}`);
  print('');
  print(`  ${dim('workspace')}  ${shortPath(runtime.workspace)}`);
  print(`  ${dim('model    ')}  ${runtime.session.model || dim('not set')}`);
  print(`  ${dim('mode     ')}  ${runtime.session.mode}   ${dim('/help for commands')}`);
  print('');
}

function toolLineStart(print, style, event) {
  const { dim } = style;
  const target = event.summary ? dim(` · ${String(event.summary).replace(/\s+/g, ' ').slice(0, 110)}`) : '';
  print(`  ${dim('◇')} ${event.label || event.name}${target}`);
}

function toolLineEnd(print, style, event) {
  const { dim, green, red } = style;
  if (event.isError) {
    const first = String(event.content || '').split('\n').slice(0, 3).join(' / ').slice(0, 300);
    print(`  ${red('✕')} ${event.name} ${red(first)}`);
    return;
  }
  let extra = '';
  if (event.meta?.count !== undefined) extra = dim(` · ${event.meta.count} result${event.meta.count === 1 ? '' : 's'}`);
  if (event.meta?.path) extra += dim(` · ${event.meta.path}`);
  if (event.meta?.exitCode !== undefined) extra += dim(` · exit ${event.meta.exitCode}`);
  print(`  ${green('✓')} ${event.name}${extra}`);
}

function createEmit({ print, style, verbose }) {
  const { dim, yellow, red } = style;
  let firstText = true;
  let lastWasText = false;
  return {
    get lastWasText() { return lastWasText; },
    write(event) {
      if (event.type === 'assistant:start') {
        firstText = true;
        lastWasText = false;
      } else if (event.type === 'text') {
        if (firstText) {
          print('');
          process.stdout.write(dim('  blank  '));
          firstText = false;
        }
        process.stdout.write(event.delta.replace(/\n/g, '\n         '));
        lastWasText = true;
      } else if (event.type === 'reasoning') {
        if (verbose) process.stdout.write(dim(event.delta));
      } else if (event.type === 'tool:start') {
        if (lastWasText) { print(''); lastWasText = false; }
        toolLineStart(print, style, event);
      } else if (event.type === 'tool:end') {
        toolLineEnd(print, style, event);
        if (verbose && event.content) {
          const clipped = String(event.content).split('\n').slice(0, 20).join('\n');
          print(clipped.split('\n').map((line) => `    ${dim(line)}`).join('\n'));
        }
      } else if (event.type === 'notice') {
        print(`  ${event.level === 'warn' ? yellow('!') : dim('·')} ${dim(event.text)}`);
      } else if (event.type === 'error') {
        print('');
        print(`  ${red('✕')} ${event.message}`);
        if (event.hint) print(`    ${dim(event.hint)}`);
      } else if (event.type === 'compacted') {
        print(`  ${dim('·')} context compacted`);
      }
    },
  };
}

async function askApproval(question, state, style) {
  const { yellow, bold, dim } = style;
  const { event, autoYes } = state;
  if (autoYes) {
    process.stdout.write(`  ${yellow('!')} auto-approved ${event.label || event.tool}\n`);
    return 'allow';
  }
  process.stdout.write('\n');
  process.stdout.write(`  ${yellow('Approval needed')}  ${bold(event.label || event.tool)}${event.reason ? `  ${dim(`(${event.reason})`)}` : ''}\n`);
  const summary = summarizeArgs(event.tool, event.args || {});
  if (summary) process.stdout.write(`  ${dim(summary.slice(0, 200))}\n`);
  const extra = JSON.stringify(event.args || {}, null, 2);
  if (extra && extra !== '{}') {
    const clipped = extra.split('\n').slice(0, 12).join('\n');
    process.stdout.write(`${clipped.split('\n').map((line) => `  ${dim(line)}`).join('\n')}\n`);
  }
  process.stdout.write('\n');
  state.awaiting = true;
  const answer = await question('[y] allow once  [a] always  [n] deny > ', 'n');
  state.awaiting = false;
  const value = String(answer).trim().toLowerCase();
  if (value === 'a' || value === 'always') return 'always';
  if (value === 'y' || value === 'yes') return 'allow';
  return 'deny';
}

async function runPlain(runtime, { color = true } = {}) {
  const style = createStyle(color);
  const { blue, dim, bold } = style;
  const print = (...args) => process.stdout.write(`${args.join(' ')}\n`);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: Boolean(process.stdin.isTTY),
    historySize: 200,
  });
  const approvalState = { awaiting: false, autoYes: runtime.autoYes, event: null };
  const question = (prompt, fallback = '') => new Promise((resolve) => {
    if (rl.closed) return resolve(fallback);
    rl.question(prompt, (answer) => resolve(answer));
  });

  const queue = [];
  let waiting = null;
  let inputClosed = false;
  rl.on('line', (line) => {
    if (waiting) { const resolve = waiting; waiting = null; resolve(line); }
    else queue.push(line);
  });
  const nextLine = () => {
    if (queue.length) return Promise.resolve(queue.shift());
    if (inputClosed) return Promise.resolve(null);
    return new Promise((resolve) => { waiting = resolve; });
  };

  banner(runtime, print, style);

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const bye = () => print(dim('\n  bye.\n'));
    try {
      await runtime.close();
    } finally {
      rl.close();
      bye();
      process.exit(0);
    }
  };

  rl.on('SIGINT', () => {
    if (runtime.active) {
      runtime.abort();
      print(style.yellow('\n  stopping…'));
      if (approvalState.awaiting) {
        approvalState.awaiting = false;
        rl.write('\n');
      }
      return;
    }
    if (rl.line) { rl.write(null, { ctrl: true, name: 'u' }); return; }
    shutdown();
  });
  rl.on('close', () => {
    inputClosed = true;
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      resolve(null);
      return;
    }
    if (!queue.length && !shuttingDown) shutdown();
  });

  const nonInteractive = !process.stdin.isTTY;
  let warnedDenied = false;

  while (!shuttingDown) {
    rl.setPrompt(`${blue('›')} `);
    rl.prompt();
    const raw = await nextLine();
    if (raw === null || shuttingDown) break;
    const line = String(raw || '').trim();
    if (!line) continue;
    if (line.startsWith('/')) {
      const result = await runtime.command(line, { print });
      if (result.action === 'exit') { await shutdown(); break; }
      if (result.action === 'clear') {
        process.stdout.write('\x1bc');
        banner(runtime, print, style);
        continue;
      }
      if (result.action === 'new' || result.action === 'resume') {
        banner(runtime, print, style);
        print(`  ${dim(result.action === 'new' ? 'new session' : 'resumed')} ${bold(runtime.session.title)}  ${dim(runtime.session.id)}`);
      }
      continue;
    }
    if (runtime.active) { print(dim('  a run is in progress — Ctrl+C to stop')); continue; }
    const emit = createEmit({ print, style, verbose: runtime.verbose });
    const outcome = await runtime.run(line, {
      emit: (event) => emit.write(event),
      requestApproval: async (event) => {
        if (nonInteractive) {
          if (!warnedDenied) {
            warnedDenied = true;
            print(dim('  non-interactive: write/edit/command tools are denied (pass --yes to allow)'));
          }
          return 'deny';
        }
        approvalState.event = event;
        return askApproval(question, approvalState, style);
      },
    });
    if (emit.lastWasText) print('');
    if (outcome?.ok) {
      print(dim(`  ${formatTokens(runtime.session.usage?.input)} in · ${formatTokens(runtime.session.usage?.output)} out · ${outcome.steps} step${outcome.steps === 1 ? '' : 's'}`));
    } else if (outcome?.stopped) {
      print(dim('  stopped'));
    } else if (outcome && !outcome.ok) {
      print(`  ${style.red('✕')} ${outcome.error || 'run failed'}`);
    }
  }
  if (!shuttingDown) await shutdown();
}

async function runOneShot(runtime, prompt, { color = true } = {}) {
  const style = createStyle(color);
  const print = (...args) => process.stdout.write(`${args.join(' ')}\n`);
  const useApprovals = process.stdin.isTTY && !runtime.autoYes;
  if (!process.stdin.isTTY && !runtime.autoYes) {
    print(style.dim('  non-interactive: write/edit/command tools will be denied (pass --yes to allow)'));
  }
  const rl = useApprovals
    ? readline.createInterface({ input: process.stdin, output: process.stdout })
    : null;
  const question = (text, fallback = '') => new Promise((resolve) => {
    if (!rl) return resolve(fallback);
    rl.question(text, resolve);
  });
  const approvalState = { awaiting: false, autoYes: runtime.autoYes, event: null };
  const emit = createEmit({ print, style, verbose: runtime.verbose });
  try {
    const outcome = await runtime.run(prompt, {
      emit: (event) => emit.write(event),
      requestApproval: async (event) => {
        approvalState.event = event;
        return askApproval(question, approvalState, style);
      },
    });
    if (emit.lastWasText) print('');
    print(style.dim(`  session ${runtime.session.id} · resume with blank --session ${runtime.session.id}`));
    if (outcome && !outcome.ok && !outcome.stopped) process.exitCode = 1;
    return outcome;
  } finally {
    if (rl) rl.close();
    await runtime.close();
  }
}

module.exports = { runPlain, runOneShot };
