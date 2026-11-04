'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');

function blankHome() {
  if (process.env.BLANK_HOME) return path.resolve(process.env.BLANK_HOME);
  return path.join(os.homedir(), '.blank');
}

function appPaths() {
  const root = blankHome();
  return {
    root,
    config: path.join(root, 'config.json'),
    sessions: path.join(root, 'sessions'),
    memory: path.join(root, 'memory.json'),
    insights: path.join(root, 'insights.json'),
    schedules: path.join(root, 'schedules.json'),
    oauth: path.join(root, 'oauth.json'),
    checkpoints: path.join(root, 'checkpoints'),
    skills: path.join(root, 'skills'),
    logs: path.join(root, 'logs'),
  };
}

function ensureHome() {
  const p = appPaths();
  for (const dir of [p.root, p.sessions, p.checkpoints, p.skills, p.logs]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return p;
}

function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data, 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch {}
    fs.writeFileSync(file, data, 'utf8');
  }
}

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJSON(file, value) {
  atomicWrite(file, JSON.stringify(value, null, 2));
}

function uid(prefix = '') {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}${stamp}${rand}`;
}

function slugify(input) {
  return String(input || 'item')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u00c0-\u024f\uac00-\ud7af]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'item';
}

function relativeTime(iso) {
  const then = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - then);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

module.exports = { blankHome, appPaths, ensureHome, atomicWrite, readJSON, writeJSON, uid, slugify, relativeTime };
