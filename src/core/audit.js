'use strict';

/**
 * Append-only audit trail under ~/.blank/logs/audit.jsonl.
 *
 * Secrets are masked before anything is written, the file never leaves this
 * machine, and segments rotate so a long-lived install stays small.
 */

const fs = require('fs');
const path = require('path');
const { appPaths, ensureHome } = require('./paths');

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_KEEP = 3;
const DEFAULT_RETENTION_DAYS = 30;
const MAX_STRING = 800;
const MAX_DEPTH = 6;

const SECRET_KEY = /^(api_?key|keys?|token|access_?token|refresh_?token|secret|client_?secret|password|passphrase|authorization|cookie)$/i;
const INLINE_SECRETS = [
  [/\b(sk-(?:[a-z]+-)?)[A-Za-z0-9_-]{8,}/gi, '$1***'],
  [/\b(ghp_)[A-Za-z0-9]{20,}/g, '$1***'],
  [/\b(github_pat_)[A-Za-z0-9_]{20,}/g, '$1***'],
  [/\b(xox[bap]-)[A-Za-z0-9-]{10,}/g, '$1***'],
  [/\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi, 'Bearer ***'],
];

function maskText(value) {
  let text = String(value).slice(0, MAX_STRING);
  for (const [pattern, replacement] of INLINE_SECRETS) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

function redact(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return maskText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= MAX_DEPTH) return '[deep]';
  if (Array.isArray(value)) return value.slice(0, 40).map((item) => redact(item, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) out[key] = '***';
      else out[key] = redact(item, depth + 1);
    }
    return out;
  }
  return String(value);
}

function stamp(date) {
  const iso = new Date(date).toISOString();
  return iso.replace(/[-:]/g, '').replace(/\..+$/, '');
}

function createAudit({ root = '', maxBytes = DEFAULT_MAX_BYTES, keep = DEFAULT_KEEP, retentionDays = DEFAULT_RETENTION_DAYS } = {}) {
  const dir = root ? path.join(root, 'logs') : '';
  const filePath = () => {
    if (!dir) {
      ensureHome();
      const fallback = path.join(appPaths().root, 'logs');
      fs.mkdirSync(fallback, { recursive: true });
      return path.join(fallback, 'audit.jsonl');
    }
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, 'audit.jsonl');
  };

  function segments() {
    const target = filePath();
    const base = path.dirname(target);
    return fs.readdirSync(base)
      .filter((name) => /^audit-\d{8}T\d{6}(-\d+)?\.jsonl$/.test(name))
      .sort()
      .map((name) => path.join(base, name));
  }

  function rotateIfNeeded(nextBytes) {
    const target = filePath();
    let size = 0;
    try { size = fs.statSync(target).size; } catch { return; }
    if (!size || size + nextBytes <= maxBytes) return;
    let name = `audit-${stamp(Date.now())}.jsonl`;
    let attempt = 2;
    while (fs.existsSync(path.join(path.dirname(target), name))) {
      name = `audit-${stamp(Date.now())}-${attempt++}.jsonl`;
    }
    try { fs.renameSync(target, path.join(path.dirname(target), name)); } catch { return; }
    const all = segments();
    while (all.length > keep) {
      const oldest = all.shift();
      try { fs.unlinkSync(oldest); } catch {}
    }
  }

  function record(type, data = {}, { at = Date.now() } = {}) {
    try {
      const entry = { ts: new Date(at).toISOString(), ...redact(data), type: String(type).slice(0, 80) };
      const line = `${JSON.stringify(entry)}\n`;
      rotateIfNeeded(Buffer.byteLength(line));
      fs.appendFileSync(filePath(), line);
    } catch {
      // Auditing must never break a run.
    }
  }

  function prune(now = Date.now()) {
    const cutoff = now - Math.max(1, retentionDays) * 24 * 60 * 60 * 1000;
    let removed = 0;
    try {
      const target = filePath();
      const lines = fs.readFileSync(target, 'utf8').split('\n').filter(Boolean);
      const kept = lines.filter((line) => {
        try {
          return new Date(JSON.parse(line).ts).getTime() >= cutoff;
        } catch {
          return false;
        }
      });
      removed = lines.length - kept.length;
      if (removed) {
        const tmp = `${target}.tmp`;
        fs.writeFileSync(tmp, kept.length ? `${kept.join('\n')}\n` : '');
        fs.renameSync(tmp, target);
      }
      for (const segment of segments()) {
        try {
          if (fs.statSync(segment).mtimeMs < cutoff) { fs.unlinkSync(segment); removed += 1; }
        } catch {}
      }
    } catch {}
    return { removed };
  }

  function info() {
    const target = filePath();
    let bytes = 0;
    try { bytes = fs.statSync(target).size; } catch {}
    return { path: target, bytes, segments: segments().length };
  }

  return { record, prune, info, file: filePath, segments };
}

const shared = createAudit();

module.exports = {
  createAudit,
  record: shared.record,
  prune: shared.prune,
  info: shared.info,
  file: shared.file,
  redact,
};
