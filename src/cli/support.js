'use strict';

const MODES = ['agent', 'coding', 'design', 'research', 'plan', 'ask'];

const SLASH_COMMANDS = [
  '/help',
  '/model',
  '/mode',
  '/new',
  '/sessions',
  '/resume',
  '/rename',
  '/compact',
  '/memory',
  '/skills',
  '/skill',
  '/mcp',
  '/learn',
  '/workspace',
  '/config',
  '/init',
  '/clear',
  '/exit',
  '/quit',
];

const MCP_SUBCOMMANDS = ['example', 'refresh'];
const MEMORY_SUBCOMMANDS = ['add', 'list', 'search', 'rm'];

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--model' || value === '-m') args.flags.model = argv[++i];
    else if (value === '--mode') args.flags.mode = argv[++i];
    else if (value === '--workspace' || value === '-w') args.flags.workspace = argv[++i];
    else if (value === '--session') args.flags.session = argv[++i];
    else if (value === '--continue' || value === '-c') args.flags.continue = true;
    else if (value === '--yes' || value === '-y') args.flags.yes = true;
    else if (value === '--verbose' || value === '-v') args.flags.verbose = true;
    else if (value === '--plain') args.flags.plain = true;
    else if (value === '--help' || value === '-h') args.flags.help = true;
    else if (value === '--version' || value === '-V') args.flags.version = true;
    else if (value === '--no-color') args.flags.noColor = true;
    else args._.push(value);
  }
  return args;
}

function pickContinueSession(sessions, workspace) {
  if (!Array.isArray(sessions) || !sessions.length) return null;
  const ordered = sessions
    .filter((session) => !session.archived)
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  if (workspace) {
    const match = ordered.find((session) => session.workspace === workspace);
    if (match) return match;
  }
  return ordered[0] || null;
}

function resolveSession(sessions, query) {
  const value = String(query || '').trim();
  if (!value) return { error: 'empty' };
  if (/^\d+$/.test(value)) {
    const index = Number(value);
    if (index >= 1 && index <= sessions.length) return { session: sessions[index - 1] };
    return { error: 'range' };
  }
  const exact = sessions.find((session) => session.id === value);
  if (exact) return { session: exact };
  const prefixed = sessions.filter((session) => session.id.startsWith(value));
  if (prefixed.length === 1) return { session: prefixed[0] };
  if (prefixed.length > 1) return { error: 'ambiguous' };
  const titled = sessions.filter((session) => String(session.title || '').toLowerCase() === value.toLowerCase());
  if (titled.length === 1) return { session: titled[0] };
  return { error: 'missing' };
}

function completeLine(line, options = {}) {
  const text = String(line || '');
  if (!text.startsWith('/')) return [[], text];
  const firstSpace = text.indexOf(' ');
  if (firstSpace === -1) {
    return [SLASH_COMMANDS.filter((command) => command.startsWith(text)), text];
  }
  const command = text.slice(0, firstSpace);
  const rest = text.slice(firstSpace + 1);
  const fragment = rest.includes(' ') ? rest.slice(rest.lastIndexOf(' ') + 1) : rest;
  if (rest.includes(' ')) return [[], fragment];

  let pool = [];
  if (command === '/mode') pool = MODES;
  else if (command === '/mcp') pool = MCP_SUBCOMMANDS;
  else if (command === '/memory') pool = MEMORY_SUBCOMMANDS;
  else if (command === '/model') pool = options.models || [];
  else return [[], fragment];

  const needle = fragment.toLowerCase();
  const hits = pool.filter((item) => String(item).toLowerCase().includes(needle)).slice(0, 40);
  return [hits, fragment];
}

function composePrompt(prompt, stdinText) {
  const text = String(prompt || '').trim();
  const piped = String(stdinText || '');
  if (!text || text === '-') {
    if (!piped.trim()) return null;
    return piped.replace(/\s+$/, '');
  }
  return text;
}

module.exports = {
  MODES,
  SLASH_COMMANDS,
  MCP_SUBCOMMANDS,
  MEMORY_SUBCOMMANDS,
  parseArgs,
  pickContinueSession,
  resolveSession,
  completeLine,
  composePrompt,
};
