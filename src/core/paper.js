'use strict';

/* blank Paper — small, live documents the user or the agent can keep.
   Each paper is a folder under ~/.blank/papers with metadata plus a single
   content file. HTML and SVG papers are served to the sandboxed preview
   through the blank-paper protocol; documents and code render in the app. */

const fs = require('fs');
const path = require('path');
const {
  appPaths, readJSON, writeJSON, atomicWrite, uid,
} = require('./paths');

const KINDS = ['html', 'markdown', 'svg', 'code'];
const KIND_META = {
  html: { label: 'Page', extension: '.html', mime: 'text/html; charset=utf-8' },
  markdown: { label: 'Document', extension: '.md', mime: 'text/markdown; charset=utf-8' },
  svg: { label: 'Graphic', extension: '.svg', mime: 'image/svg+xml; charset=utf-8' },
  code: { label: 'Code', extension: '.txt', mime: 'text/plain; charset=utf-8' },
};

const LANGUAGE_EXTENSIONS = {
  js: '.js', javascript: '.js', mjs: '.mjs', cjs: '.cjs', jsx: '.jsx', ts: '.ts', typescript: '.ts',
  tsx: '.tsx', json: '.json', css: '.css', scss: '.scss', html: '.html', xml: '.xml', svg: '.svg',
  py: '.py', python: '.py', sh: '.sh', bash: '.sh', zsh: '.sh', ps: '.ps1', sql: '.sql', go: '.go',
  rust: '.rs', rs: '.rs', java: '.java', kotlin: '.kt', swift: '.swift', c: '.c', cpp: '.cpp',
  csharp: '.cs', php: '.php', ruby: '.rb', rb: '.rb', yaml: '.yml', yml: '.yml', toml: '.toml',
  md: '.md', markdown: '.md', txt: '.txt', text: '.txt',
};

const MAX_CONTENT = 2 * 1024 * 1024;
const MAX_TITLE = 120;
const MAX_DESCRIPTION = 280;
const MAX_LANGUAGE = 24;
const MAX_PAPERS = 400;
const MAX_VERSIONS = 20;

function papersRoot() {
  return path.join(appPaths().root, 'papers');
}

/* The preview protocol validates ids before calling in, but every store entry
   point repeats the check: an id is never trusted as a path fragment. */
function validId(id) {
  return typeof id === 'string' && /^[a-z0-9_-]{4,64}$/i.test(id);
}

function paperDir(id) {
  if (!validId(id)) throw new Error('Invalid paper id.');
  return path.join(papersRoot(), id);
}

function metaFile(id) {
  return path.join(paperDir(id), 'paper.json');
}

function contentPath(metaOrId) {
  const id = typeof metaOrId === 'string' ? metaOrId : metaOrId?.id;
  if (!validId(id)) throw new Error('Invalid paper id.');
  const meta = typeof metaOrId === 'object' && metaOrId ? metaOrId : readMeta(id);
  if (!meta) throw new Error('Paper not found.');
  const extension = KIND_META[meta.kind]?.extension || '.txt';
  return path.join(paperDir(id), `content${extension}`);
}

function ensurePapers() {
  fs.mkdirSync(papersRoot(), { recursive: true });
}

function readMeta(id) {
  if (!validId(id)) return null;
  const raw = readJSON(metaFile(id), null);
  if (!raw || !raw.id || !KINDS.includes(raw.kind)) return null;
  if (raw.id !== id) return null;
  return raw;
}

function writeMeta(meta) {
  writeJSON(metaFile(meta.id), meta);
  return meta;
}

function cleanTitle(value, fallback = 'Untitled paper') {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  return text.length > MAX_TITLE ? `${text.slice(0, MAX_TITLE - 1).trimEnd()}…` : text;
}

function cleanDescription(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_DESCRIPTION);
}

function cleanLanguage(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9+#.-]+/g, '')
    .replace(/^\.+/, '')
    .slice(0, MAX_LANGUAGE);
}

function cleanContent(value) {
  if (typeof value !== 'string') throw new Error('Paper content must be text.');
  if (!value.trim()) throw new Error('Paper content is empty.');
  if (value.length > MAX_CONTENT) {
    throw new Error(`Paper is too large (${Math.round(value.length / 1024)} KB). Keep it under ${Math.round(MAX_CONTENT / 1024)} KB.`);
  }
  return value;
}

function plainText(content) {
  return String(content || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:nbsp|amp|lt|gt|quot|#\d+);/gi, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function deriveTitle(content, kind) {
  const text = String(content || '');
  if (kind === 'html') {
    const title = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (title && title[1].trim()) return cleanTitle(plainText(title[1]));
    const heading = text.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (heading && heading[1].trim()) return cleanTitle(plainText(heading[1]));
  }
  if (kind === 'svg') {
    const title = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (title && title[1].trim()) return cleanTitle(plainText(title[1]));
  }
  const firstLine = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
  const cleaned = plainText(firstLine.replace(/^#+\s*/, ''));
  return cleanTitle(cleaned ? cleaned.slice(0, 70) : 'Untitled paper');
}

function excerptOf(content) {
  const text = plainText(content);
  return text.length > 220 ? `${text.slice(0, 219).trimEnd()}…` : text;
}

function normalizeKind(kind) {
  const value = String(kind || 'html').toLowerCase();
  if (!KINDS.includes(value)) throw new Error('Paper kind must be html, markdown, svg, or code.');
  return value;
}

function keptHistory(meta) {
  if (!meta || !Array.isArray(meta.history)) return [];
  return meta.history.filter((entry) => entry && entry.file && Number(entry.version));
}

function publicPaper(meta) {
  if (!meta) return null;
  const metaKind = KIND_META[meta.kind] || KIND_META.html;
  return {
    id: meta.id,
    title: meta.title,
    kind: meta.kind,
    kindLabel: metaKind.label,
    language: meta.language || '',
    description: meta.description || '',
    excerpt: meta.excerpt || '',
    source: meta.source === 'user' ? 'user' : 'agent',
    sessionId: meta.sessionId || '',
    favorite: Boolean(meta.favorite),
    version: Number(meta.version) || 1,
    versionCount: keptHistory(meta).length + 1,
    bytes: Number(meta.bytes) || 0,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    previewUrl: meta.kind === 'html' || meta.kind === 'svg'
      ? `blank-paper://view/${encodeURIComponent(meta.id)}?v=${Number(meta.version) || 1}`
      : '',
  };
}

/* Keep the copy that is about to be replaced. Snapshots carry the version
   number and timestamp they were saved with, so history is readable even
   after many edits. The current content file stays the source of truth. */
function snapshotCurrent(meta) {
  const source = contentPath(meta);
  if (!fs.existsSync(source)) return;
  const directory = path.join(paperDir(meta.id), 'versions');
  fs.mkdirSync(directory, { recursive: true });
  const version = Number(meta.version) || 1;
  const name = `v${version}${path.extname(source)}`;
  fs.copyFileSync(source, path.join(directory, name));
  const history = keptHistory(meta).filter((entry) => Number(entry.version) !== version);
  history.push({
    version,
    savedAt: meta.updatedAt || new Date().toISOString(),
    bytes: Number(meta.bytes) || 0,
    excerpt: meta.excerpt || '',
    file: name,
  });
  history.sort((a, b) => b.version - a.version);
  while (history.length > MAX_VERSIONS) {
    const dropped = history.pop();
    try { fs.unlinkSync(path.join(directory, dropped.file)); } catch { /* already gone */ }
  }
  meta.history = history;
}

function listPapers(options = {}) {
  ensurePapers();
  const query = String(options.query || '').trim().toLowerCase();
  const kind = KINDS.includes(options.kind) ? options.kind : '';
  let names = [];
  try {
    names = fs.readdirSync(papersRoot(), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .slice(0, MAX_PAPERS);
  } catch {
    names = [];
  }
  const all = [];
  for (const name of names) {
    const meta = readMeta(name);
    if (meta) all.push(meta);
  }
  const counts = { html: 0, markdown: 0, svg: 0, code: 0, favorite: 0 };
  for (const meta of all) {
    counts[meta.kind] = (counts[meta.kind] || 0) + 1;
    if (meta.favorite) counts.favorite += 1;
  }
  let items = all;
  if (kind) items = items.filter((meta) => meta.kind === kind);
  if (options.favorite) items = items.filter((meta) => meta.favorite);
  if (query) {
    items = items.filter((meta) => `${meta.title} ${meta.description || ''} ${meta.excerpt || ''} ${meta.language || ''}`.toLowerCase().includes(query));
  }
  items.sort((a, b) => {
    if (Boolean(b.favorite) !== Boolean(a.favorite) && options.favorite == null) return Number(Boolean(b.favorite)) - Number(Boolean(a.favorite));
    return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
  });
  const total = items.length;
  const offset = Math.max(0, Number(options.offset) || 0);
  const limit = Math.max(1, Math.min(200, Number(options.limit) || 80));
  return {
    items: items.slice(offset, offset + limit).map(publicPaper),
    total,
    offset,
    limit,
    counts,
  };
}

function getPaper(id) {
  return publicPaper(readMeta(String(id || '')));
}

function getPaperContent(id) {
  const meta = readMeta(String(id || ''));
  if (!meta) throw new Error('Paper not found.');
  const file = contentPath(meta);
  try {
    return { paper: publicPaper(meta), content: fs.readFileSync(file, 'utf8') };
  } catch {
    return { paper: publicPaper(meta), content: '' };
  }
}

function publicVersion(entry, current) {
  return {
    version: Number(entry.version) || 1,
    savedAt: entry.savedAt || '',
    bytes: Number(entry.bytes) || 0,
    excerpt: entry.excerpt || '',
    current: Boolean(current),
  };
}

function listVersions(id) {
  const meta = readMeta(String(id || ''));
  if (!meta) throw new Error('Paper not found.');
  const current = publicVersion({
    version: meta.version,
    savedAt: meta.updatedAt,
    bytes: meta.bytes,
    excerpt: meta.excerpt,
  }, true);
  const history = keptHistory(meta)
    .filter((entry) => Number(entry.version) !== Number(meta.version))
    .map((entry) => publicVersion(entry, false));
  return {
    paper: publicPaper(meta),
    versions: [current, ...history].sort((a, b) => b.version - a.version),
  };
}

function versionFile(meta, version) {
  const entry = keptHistory(meta).find((item) => Number(item.version) === Number(version));
  if (!entry) throw new Error('That version is no longer kept.');
  const file = path.join(paperDir(meta.id), 'versions', entry.file);
  if (!fs.existsSync(file)) throw new Error('That version is no longer on disk.');
  return file;
}

function getVersionContent(id, version) {
  const meta = readMeta(String(id || ''));
  if (!meta) throw new Error('Paper not found.');
  const wanted = Number(version) || 0;
  if (wanted === Number(meta.version)) return getPaperContent(meta.id);
  const content = fs.readFileSync(versionFile(meta, wanted), 'utf8');
  return {
    paper: publicPaper(meta),
    version: wanted,
    content,
  };
}

/* Restoring writes the old content forward as a new version, so the version
   that was current is still reachable from history. */
function restoreVersion(id, version) {
  const meta = readMeta(String(id || ''));
  if (!meta) throw new Error('Paper not found.');
  const wanted = Number(version) || 0;
  if (wanted === Number(meta.version)) return publicPaper(meta);
  const content = fs.readFileSync(versionFile(meta, wanted), 'utf8');
  return updatePaper(meta.id, { content });
}

function createPaper({ title = '', kind = 'html', content = '', language = '', description = '', source = 'agent', sessionId = '' } = {}) {
  ensurePapers();
  const nextKind = normalizeKind(kind);
  const body = cleanContent(content);
  const now = new Date().toISOString();
  const id = uid('p_');
  const meta = {
    id,
    title: cleanTitle(title || deriveTitle(body, nextKind)),
    kind: nextKind,
    language: nextKind === 'code' ? cleanLanguage(language) : '',
    description: cleanDescription(description),
    source: source === 'user' ? 'user' : 'agent',
    sessionId: String(sessionId || ''),
    favorite: false,
    version: 1,
    bytes: Buffer.byteLength(body, 'utf8'),
    excerpt: excerptOf(body),
    createdAt: now,
    updatedAt: now,
  };
  fs.mkdirSync(paperDir(id), { recursive: true });
  atomicWrite(contentPath(meta), body);
  writeMeta(meta);
  return publicPaper(meta);
}

function updatePaper(id, patch = {}) {
  const meta = readMeta(String(id || ''));
  if (!meta) throw new Error('Paper not found.');
  let contentChanged = false;
  if (patch.content !== undefined) {
    const body = cleanContent(patch.content);
    const previous = fs.existsSync(contentPath(meta)) ? fs.readFileSync(contentPath(meta), 'utf8') : null;
    if (body !== previous) {
      snapshotCurrent(meta);
      atomicWrite(contentPath(meta), body);
      meta.version = (Number(meta.version) || 1) + 1;
      contentChanged = true;
    }
    meta.bytes = Buffer.byteLength(body, 'utf8');
    meta.excerpt = excerptOf(body);
    if (!patch.title && !meta.title) meta.title = deriveTitle(body, meta.kind);
  }
  if (typeof patch.title === 'string' && patch.title.trim()) meta.title = cleanTitle(patch.title);
  if (typeof patch.description === 'string') meta.description = cleanDescription(patch.description);
  if (typeof patch.language === 'string' && meta.kind === 'code') meta.language = cleanLanguage(patch.language);
  if (typeof patch.favorite === 'boolean') meta.favorite = patch.favorite;
  if (contentChanged) meta.updatedAt = new Date().toISOString();
  else if (patch.content !== undefined || patch.title !== undefined || patch.description !== undefined || patch.language !== undefined) {
    meta.updatedAt = new Date().toISOString();
  }
  writeMeta(meta);
  return publicPaper(meta);
}

function toggleFavorite(id) {
  const meta = readMeta(String(id || ''));
  if (!meta) throw new Error('Paper not found.');
  const paper = updatePaper(id, { favorite: !meta.favorite });
  return paper;
}

function removePaper(id) {
  const meta = readMeta(String(id || ''));
  if (!meta) return { removed: false };
  try {
    fs.rmSync(paperDir(meta.id), { recursive: true, force: true });
    return { removed: true };
  } catch (error) {
    throw new Error(`Could not delete this paper: ${error.message}`);
  }
}

function paperCount() {
  try {
    return fs.readdirSync(papersRoot(), { withFileTypes: true }).filter((entry) => entry.isDirectory()).length;
  } catch {
    return 0;
  }
}

function exportFileName(paper) {
  const meta = paper || {};
  const kind = KIND_META[meta.kind] || KIND_META.html;
  const extension = meta.kind === 'code'
    ? LANGUAGE_EXTENSIONS[meta.language] || kind.extension
    : kind.extension;
  const base = String(meta.title || 'blank paper')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'blank paper';
  return `${base}${extension}`;
}

function paperMime(kind) {
  return (KIND_META[kind] || KIND_META.html).mime;
}

/* HTML fragments get a minimal document shell so a bare <section> still
   previews with a sane viewport. Full documents pass through untouched. */
function htmlDocument(content) {
  const raw = String(content || '');
  if (/<html[\s>]/i.test(raw)) return raw;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>html{color-scheme:light}body{margin:0;font:14px/1.6 system-ui,sans-serif;color:#1c2430}</style>
</head>
<body>
${raw}
</body>
</html>`;
}

module.exports = {
  KINDS,
  KIND_META,
  MAX_CONTENT,
  MAX_VERSIONS,
  papersRoot,
  ensurePapers,
  validId,
  contentPath,
  readMeta,
  publicPaper,
  listPapers,
  getPaper,
  getPaperContent,
  listVersions,
  getVersionContent,
  restoreVersion,
  createPaper,
  updatePaper,
  toggleFavorite,
  removePaper,
  paperCount,
  exportFileName,
  paperMime,
  htmlDocument,
};
