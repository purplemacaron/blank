'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  appPaths, ensureHome, readJSON, writeJSON, uid, slugify, atomicWrite,
} = require('./paths');
const { isEffort } = require('./reasoning');

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', '.idea', '.vscode', 'dist', 'build', 'out',
  '.next', '.nuxt', '.cache', 'target', '__pycache__', '.venv', 'venv', '.blank',
]);

const TEXT_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json', '.md', '.mdx', '.txt', '.yml', '.yaml',
  '.css', '.scss', '.sass', '.less', '.html', '.htm', '.vue', '.svelte', '.py', '.rb', '.go',
  '.rs', '.java', '.kt', '.kts', '.swift', '.c', '.h', '.cpp', '.hpp', '.cs', '.php', '.sh',
  '.bash', '.zsh', '.fish', '.ps1', '.toml', '.ini', '.cfg', '.conf', '.env', '.sql', '.graphql',
  '.gql', '.xml', '.svg', '.lua', '.r', '.dart', '.ex', '.exs', '.erl', '.clj', '.scala',
]);

/* ------------------------------------------------------------------ sessions */

function sessionPath(id) {
  return path.join(appPaths().sessions, `${id}.json`);
}

function createSession({ workspace = '', model = '', mode = 'agent', title = 'New session', titleSource = 'auto', reasoningEffort = 'auto' } = {}) {
  ensureHome();
  const now = new Date().toISOString();
  const session = {
    id: uid('s_'),
    title,
    titleSource,
    titleGeneratedAt: '',
    createdAt: now,
    updatedAt: now,
    workspace,
    model,
    mode,
    reasoningEffort: isEffort(reasoningEffort) ? reasoningEffort : 'auto',
    messages: [],
    tasks: [],
    usage: { input: 0, output: 0 },
    contextTokens: 0,
    allowTools: [],
    allowCommands: [],
    allowFiles: [],
    summary: '',
    compactedCount: 0,
    pinned: false,
    archived: false,
    subagents: [],
  };
  saveSession(session);
  return session;
}

function saveSession(session) {
  session.updatedAt = new Date().toISOString();
  writeJSON(sessionPath(session.id), session);
  return session;
}

function getSession(id) {
  if (!id || !/^[a-z0-9_]+$/i.test(id)) return null;
  return readJSON(sessionPath(id), null);
}

function deleteSession(id) {
  try { fs.unlinkSync(sessionPath(id)); return true; } catch { return false; }
}

function sessionPreview(session) {
  const messages = session.messages || [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === 'user' || message.role === 'assistant') {
      const text = String(message.content || '').replace(/```[\s\S]*?```/g, ' ').replace(/\s+/g, ' ').trim();
      if (text) return text.slice(0, 120);
    }
  }
  return '';
}

function listSessions(workspace) {
  ensureHome();
  const dir = appPaths().sessions;
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { files = []; }
  const sessions = [];
  for (const file of files) {
    const session = readJSON(path.join(dir, file), null);
    if (!session || !session.id) continue;
    if (workspace && session.workspace && session.workspace !== workspace) continue;
    sessions.push({
      id: session.id,
      title: session.title || 'New session',
      preview: sessionPreview(session),
      updatedAt: session.updatedAt,
      createdAt: session.createdAt,
      model: session.model,
      mode: session.mode,
      pinned: Boolean(session.pinned),
      archived: Boolean(session.archived),
      messageCount: (session.messages || []).length,
      workspace: session.workspace,
      usage: session.usage || { input: 0, output: 0 },
    });
  }
  sessions.sort((a, b) => {
    if (Boolean(b.pinned) !== Boolean(a.pinned)) return b.pinned ? 1 : -1;
    return new Date(b.updatedAt) - new Date(a.updatedAt);
  });
  return sessions;
}

function titleFrom(text) {
  const clean = String(text || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[#>*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return 'New session';
  return clean.length > 52 ? `${clean.slice(0, 52).trimEnd()}…` : clean;
}

/* -------------------------------------------------------------------- memory */

function memoryFile() {
  return appPaths().memory;
}

function listMemory() {
  const data = readJSON(memoryFile(), []);
  return Array.isArray(data) ? data : [];
}

function saveMemory(entries) {
  writeJSON(memoryFile(), entries.slice(0, 1000));
}

function addMemory({ text, tags = [], pinned = false, source = 'manual', sessionId = '' }) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) throw new Error('Memory text is empty.');
  const entries = listMemory();
  const now = new Date().toISOString();
  const existing = entries.find((e) => e.text.toLowerCase() === clean.toLowerCase());
  if (existing) {
    existing.updatedAt = now;
    existing.tags = [...new Set([...(existing.tags || []), ...tags])];
    if (pinned) existing.pinned = true;
    saveMemory(entries);
    return existing;
  }
  const entry = {
    id: uid('m_'),
    text: clean.slice(0, 2000),
    tags: [...new Set(tags.map((t) => String(t).toLowerCase()).filter(Boolean))].slice(0, 12),
    pinned: Boolean(pinned),
    source,
    sessionId,
    uses: 0,
    createdAt: now,
    updatedAt: now,
  };
  entries.unshift(entry);
  saveMemory(entries);
  return entry;
}

function updateMemory(id, patch) {
  const entries = listMemory();
  const entry = entries.find((e) => e.id === id);
  if (!entry) throw new Error('Memory not found.');
  if (typeof patch.text === 'string') entry.text = patch.text.slice(0, 2000);
  if (Array.isArray(patch.tags)) entry.tags = patch.tags.map((t) => String(t).toLowerCase()).slice(0, 12);
  if (typeof patch.pinned === 'boolean') entry.pinned = patch.pinned;
  entry.updatedAt = new Date().toISOString();
  saveMemory(entries);
  return entry;
}

function deleteMemory(id) {
  const entries = listMemory();
  const next = entries.filter((e) => e.id !== id);
  saveMemory(next);
  return entries.length !== next.length;
}

function tokenize(text) {
  return [...new Set(
    String(text || '')
      .toLowerCase()
      .split(/[^a-z0-9\uac00-\ud7af]+/)
      .filter((token) => token.length > 1),
  )].slice(0, 40);
}

function searchMemory(query, limit = 6) {
  const entries = listMemory();
  const tokens = tokenize(query);
  if (!tokens.length) {
    return [...entries].sort((a, b) => Number(b.pinned) - Number(a.pinned)).slice(0, limit);
  }
  const scored = [];
  for (const entry of entries) {
    const haystack = `${entry.text} ${(entry.tags || []).join(' ')}`.toLowerCase();
    let score = 0;
    for (const token of tokens) {
      if (haystack.includes(token)) score += token.length > 4 ? 2 : 1;
    }
    if (entry.pinned) score += 2.5;
    if (score > 0) scored.push({ ...entry, score });
  }
  scored.sort((a, b) => b.score - a.score || new Date(b.updatedAt) - new Date(a.updatedAt));
  return scored.slice(0, limit);
}

/* -------------------------------------------------------------------- skills */

const BUNDLED_SKILLS = path.join(__dirname, '..', '..', 'assets', 'skills');

function parseSkillFile(file, source) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    const meta = {};
    let body = raw;
    if (match) {
      body = match[2];
      for (const line of match[1].split(/\r?\n/)) {
        const idx = line.indexOf(':');
        if (idx > 0) {
          const key = line.slice(0, idx).trim();
          let value = line.slice(idx + 1).trim();
          if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          meta[key] = value;
        }
      }
    }
    const folder = path.basename(path.dirname(file));
    const name = meta.name || folder;
    return {
      id: `${source}/${slugify(folder)}`,
      slug: slugify(folder),
      name,
      description: meta.description || '',
      version: meta.version || '',
      source,
      path: file,
      body: body.trim(),
      updatedAt: (() => { try { return fs.statSync(file).mtime.toISOString(); } catch { return ''; } })(),
    };
  } catch {
    return null;
  }
}

function readSkillDir(dir, source) {
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const entry of names) {
    if (!entry.isDirectory()) continue;
    const file = path.join(dir, entry.name, 'SKILL.md');
    if (fs.existsSync(file)) {
      const skill = parseSkillFile(file, source);
      if (skill) out.push(skill);
    }
  }
  return out;
}

function listSkills(workspace, config = {}) {
  const disabled = new Set(config.disabledSkills || []);
  const all = [
    ...readSkillDir(BUNDLED_SKILLS, 'bundled'),
    ...readSkillDir(appPaths().skills, 'global'),
    ...(workspace ? readSkillDir(path.join(workspace, '.blank', 'skills'), 'project') : []),
  ];
  const seen = new Set();
  return all
    .filter((skill) => {
      if (seen.has(skill.id)) return false;
      seen.add(skill.id);
      return true;
    })
    .map((skill) => ({ ...skill, enabled: !disabled.has(skill.id), body: undefined }));
}

function getSkill(id, workspace) {
  const skills = listSkills(workspace, {});
  const skill = skills.find((s) => s.id === id || s.slug === id || s.name.toLowerCase() === String(id).toLowerCase());
  if (!skill) return null;
  const full = parseSkillFile(skill.path, skill.source);
  return full ? { ...full, enabled: skill.enabled } : null;
}

function createSkill({ name, description = '', body = '', scope = 'global', workspace = '' }) {
  const slug = slugify(name);
  const base = scope === 'project' && workspace ? path.join(workspace, '.blank', 'skills') : appPaths().skills;
  const dir = path.join(base, slug);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'SKILL.md');
  const safeDescription = String(description).replace(/\r?\n/g, ' ').trim();
  const content = `---\nname: ${String(name).replace(/\r?\n/g, ' ').trim()}\ndescription: ${safeDescription}\n---\n\n${body.trim() || `# ${name}\n\nDescribe the workflow this skill should follow.`}\n`;
  atomicWrite(file, content);
  ensureHome();
  return parseSkillFile(file, scope === 'project' ? 'project' : 'global');
}

function deleteSkill(id, workspace) {
  const skill = getSkill(id, workspace);
  if (!skill || skill.source === 'bundled') return false;
  try {
    fs.rmSync(path.dirname(skill.path), { recursive: true, force: true });
    return true;
  } catch { return false; }
}

/* ------------------------------------------------------------------ insights */

function insightFile() { return appPaths().insights; }

function readInsights() {
  const data = readJSON(insightFile(), { pending: [], applied: [] });
  return {
    pending: Array.isArray(data.pending) ? data.pending : [],
    applied: Array.isArray(data.applied) ? data.applied : [],
    lastReflectionAt: data.lastReflectionAt || '',
    reflections: Number(data.reflections) || 0,
  };
}

function writeInsights(data) {
  writeJSON(insightFile(), {
    pending: data.pending.slice(0, 100),
    applied: data.applied.slice(0, 100),
    lastReflectionAt: data.lastReflectionAt || '',
    reflections: data.reflections || 0,
  });
}

function addInsight(insight) {
  const data = readInsights();
  const fingerprint = String(insight.content || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (data.pending.some((i) => i.fingerprint === fingerprint) || data.applied.some((i) => i.fingerprint === fingerprint)) {
    return null;
  }
  const entry = {
    id: uid('i_'),
    type: insight.type || 'memory',
    title: insight.title || 'Insight',
    content: String(insight.content || '').trim(),
    reason: insight.reason || '',
    confidence: Math.min(1, Math.max(0, Number(insight.confidence) || 0.6)),
    tags: insight.tags || [],
    skillName: insight.skillName || '',
    description: insight.description || '',
    fingerprint,
    createdAt: new Date().toISOString(),
  };
  if (!entry.content) return null;
  data.pending.unshift(entry);
  writeInsights(data);
  return entry;
}

function getInsight(id) {
  return readInsights().pending.find((i) => i.id === id) || null;
}

function dismissInsight(id) {
  const data = readInsights();
  const before = data.pending.length;
  data.pending = data.pending.filter((i) => i.id !== id);
  writeInsights(data);
  return data.pending.length !== before;
}

function markInsightApplied(id) {
  const data = readInsights();
  const insight = data.pending.find((i) => i.id === id);
  if (!insight) return null;
  data.pending = data.pending.filter((i) => i.id !== id);
  data.applied.unshift({ ...insight, appliedAt: new Date().toISOString() });
  writeInsights(data);
  return insight;
}

/* --------------------------------------------------------------- checkpoints */

function createCheckpoint({ sessionId = '', filePath, before }) {
  ensureHome();
  if (typeof before !== 'string' && before !== null) return null;
  if (typeof before === 'string' && before.length > 3_000_000) return null;
  const id = uid('c_');
  const payload = {
    id,
    sessionId,
    path: filePath,
    before,
    createdAt: new Date().toISOString(),
  };
  writeJSON(path.join(appPaths().checkpoints, `${id}.json`), payload);
  pruneCheckpoints();
  return id;
}

function pruneCheckpoints() {
  const dir = appPaths().checkpoints;
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
    while (files.length > 120) {
      const oldest = files.shift();
      try { fs.unlinkSync(path.join(dir, oldest)); } catch {}
    }
  } catch {}
}

function revertCheckpoint(id) {
  if (!/^[a-z0-9_]+$/i.test(id || '')) return { ok: false, error: 'Invalid checkpoint.' };
  const payload = readJSON(path.join(appPaths().checkpoints, `${id}.json`), null);
  if (!payload) return { ok: false, error: 'Checkpoint expired.' };
  try {
    if (payload.before === null) {
      fs.rmSync(payload.path, { force: true });
    } else {
      fs.mkdirSync(path.dirname(payload.path), { recursive: true });
      atomicWrite(payload.path, payload.before);
    }
    return { ok: true, path: payload.path };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/* ------------------------------------------------------------------- files */

function expandHome(value) {
  if (!value) return value;
  if (value === '~') return os.homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(os.homedir(), value.slice(2));
  return value;
}

function safePath(workspace, requested = '.') {
  if (!workspace) throw new Error('No workspace is open.');
  const root = path.resolve(workspace);
  const input = expandHome(String(requested || '.'));
  const full = path.resolve(root, input);
  const rel = path.relative(root, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path escapes the workspace: ${requested}`);
  }
  return full;
}

function isTextFile(file) {
  if (TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())) return true;
  const name = path.basename(file).toLowerCase();
  return ['dockerfile', 'makefile', 'license', 'readme', '.gitignore', '.env.example'].includes(name);
}

function readFileText(file, { maxBytes = 512 * 1024 } = {}) {
  const stat = fs.statSync(file);
  if (stat.isDirectory()) throw new Error('Path is a directory.');
  if (stat.size > maxBytes) throw new Error(`File is too large (${Math.round(stat.size / 1024)} KB).`);
  const buffer = fs.readFileSync(file);
  if (buffer.includes(0)) throw new Error('This looks like a binary file.');
  return buffer.toString('utf8');
}

function fileTree(workspace, { depth = 2, maxNodes = 400 } = {}) {
  if (!workspace) return [];
  const root = path.resolve(workspace);
  let count = 0;
  function walk(dir, level) {
    if (level > depth || count > maxNodes) return [];
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    const out = [];
    for (const entry of entries) {
      if (count > maxNodes) break;
      if (entry.name.startsWith('.') && entry.name !== '.blank') continue;
      if (IGNORE_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).split(path.sep).join('/');
      const isDir = entry.isDirectory();
      count += 1;
      const node = { name: entry.name, path: rel, type: isDir ? 'dir' : 'file' };
      if (isDir) {
        node.children = level < depth ? walk(full, level + 1) : [];
      } else {
        try { node.size = fs.statSync(full).size; } catch { node.size = 0; }
      }
      out.push(node);
    }
    return out;
  }
  return walk(root, 1);
}

/* -------------------------------------------------------------------- stats */

function getStats(workspace) {
  const sessions = listSessions(workspace);
  const full = sessions
    .map((summary) => getSession(summary.id))
    .filter(Boolean);
  let messages = 0;
  let toolCalls = 0;
  let toolErrors = 0;
  let input = 0;
  let output = 0;
  const tools = new Map();
  const days = new Map();
  const today = new Date();
  for (let i = 13; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    days.set(d.toISOString().slice(0, 10), 0);
  }
  for (const session of full) {
    input += Number(session.usage?.input) || 0;
    output += Number(session.usage?.output) || 0;
    for (const message of session.messages || []) {
      messages += 1;
      if (message.role === 'assistant' && Array.isArray(message.toolCalls)) {
        toolCalls += message.toolCalls.length;
        for (const call of message.toolCalls) {
          tools.set(call.name, (tools.get(call.name) || 0) + 1);
        }
      }
      if (message.role === 'tool') {
        if (message.isError) toolErrors += 1;
      }
      const at = message.at ? new Date(message.at) : new Date(session.updatedAt);
      const key = at.toISOString().slice(0, 10);
      if (days.has(key)) days.set(key, days.get(key) + 1);
    }
  }
  const memory = listMemory();
  const insights = readInsights();
  return {
    sessions: sessions.length,
    messages,
    toolCalls,
    toolErrors,
    tokens: { input, output },
    topTools: [...tools.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, count]) => ({ name, count })),
    activity: [...days.entries()].map(([date, count]) => ({ date, count })),
    memory: {
      total: memory.length,
      pinned: memory.filter((m) => m.pinned).length,
    },
    insights: {
      pending: insights.pending.length,
      applied: insights.applied.length,
    },
  };
}

module.exports = {
  createSession, saveSession, getSession, deleteSession, listSessions, sessionPreview, titleFrom,
  listMemory, addMemory, updateMemory, deleteMemory, searchMemory, tokenize,
  listSkills, getSkill, createSkill, deleteSkill, BUNDLED_SKILLS,
  readInsights, writeInsights, addInsight, getInsight, dismissInsight, markInsightApplied,
  createCheckpoint, revertCheckpoint,
  safePath, readFileText, isTextFile, fileTree, expandHome, getStats,
};
