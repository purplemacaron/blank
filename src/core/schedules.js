'use strict';

const { appPaths, readJSON, writeJSON, uid } = require('./paths');
const { isEffort } = require('./reasoning');

const CADENCES = ['interval', 'hourly', 'daily', 'weekdays', 'once'];
const MODES = ['agent', 'coding', 'design', 'plan', 'ask'];
const HISTORY_LIMIT = 12;

function schedulesFile() {
  return appPaths().schedules;
}

function parseTime(value) {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(value || '').trim());
  if (!match) return { hours: 9, minutes: 0 };
  return { hours: Number(match[1]), minutes: Number(match[2]) };
}

function localDate(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function onceTarget(schedule) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(schedule.date || ''));
  if (!match) return null;
  const { hours, minutes } = parseTime(schedule.time);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hours, minutes, 0, 0);
}

function computeNext(schedule, from = new Date()) {
  const { hours, minutes } = parseTime(schedule.time);
  const base = from instanceof Date ? from : new Date(from);
  const next = new Date(base.getTime());
  next.setSeconds(0, 0);
  if (schedule.cadence === 'once') {
    const target = onceTarget(schedule);
    if (!target || Number.isNaN(target.getTime()) || target.getTime() <= base.getTime()) return '';
    return target.toISOString();
  }
  if (schedule.cadence === 'interval') {
    const every = Math.max(5, Math.min(1440, Number(schedule.everyMinutes) || 30));
    return new Date(base.getTime() + every * 60_000).toISOString();
  }
  if (schedule.cadence === 'hourly') {
    next.setMinutes(minutes, 0, 0);
    if (next.getTime() <= base.getTime()) next.setHours(next.getHours() + 1);
    return next.toISOString();
  }
  next.setHours(hours, minutes, 0, 0);
  if (schedule.cadence === 'daily') {
    if (next.getTime() <= base.getTime()) next.setDate(next.getDate() + 1);
    return next.toISOString();
  }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const day = next.getDay();
    if (next.getTime() > base.getTime() && day >= 1 && day <= 5) return next.toISOString();
    next.setDate(next.getDate() + 1);
    next.setHours(hours, minutes, 0, 0);
  }
  return next.toISOString();
}

function sanitize(input, existing = {}, now = new Date()) {
  const cadence = CADENCES.includes(input.cadence) ? input.cadence : existing.cadence || 'daily';
  const schedule = {
    id: existing.id || uid('sch_'),
    title: String(input.title ?? existing.title ?? '').trim().slice(0, 80) || 'Scheduled run',
    prompt: String(input.prompt ?? existing.prompt ?? '').trim().slice(0, 4000),
    cadence,
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(input.date ?? existing.date ?? ''))
      ? String(input.date ?? existing.date)
      : cadence === 'once' ? localDate(now) : '',
    time: /^([01]?\d|2[0-3]):([0-5]\d)$/.test(String(input.time ?? existing.time ?? '')) ? String(input.time ?? existing.time) : existing.time || '09:00',
    everyMinutes: Math.max(5, Math.min(1440, Number(input.everyMinutes ?? existing.everyMinutes) || 30)),
    enabled: input.enabled === undefined ? existing.enabled !== false : Boolean(input.enabled),
    model: String(input.model ?? existing.model ?? '').trim().slice(0, 160),
    mode: MODES.includes(input.mode) ? input.mode : MODES.includes(existing.mode) ? existing.mode : 'agent',
    reasoningEffort: isEffort(input.reasoningEffort)
      ? input.reasoningEffort
      : isEffort(existing.reasoningEffort) ? existing.reasoningEffort : 'auto',
    allowTools: input.allowTools === undefined ? Boolean(existing.allowTools) : Boolean(input.allowTools),
    workspace: String(input.workspace ?? existing.workspace ?? '').trim().slice(0, 400),
    createdAt: existing.createdAt || now.toISOString(),
    updatedAt: now.toISOString(),
    lastRunAt: existing.lastRunAt || '',
    lastStatus: existing.lastStatus || '',
    lastError: existing.lastError || '',
    lastSessionId: existing.lastSessionId || '',
    runCount: Number(existing.runCount) || 0,
    history: Array.isArray(existing.history) ? existing.history.slice(0, HISTORY_LIMIT) : [],
  };
  if (!schedule.prompt) throw new Error('A prompt is required for a scheduled run.');
  schedule.nextRunAt = schedule.enabled ? computeNext(schedule, now) : '';
  if (cadence === 'once' && schedule.enabled && !schedule.nextRunAt) {
    throw new Error('Pick a future date and time for a one-time run.');
  }
  return schedule;
}

function loadSchedules() {
  const raw = readJSON(schedulesFile(), { schedules: [] });
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.schedules) ? raw.schedules : [];
  return list.filter((entry) => entry && entry.id).map((entry) => ({ ...entry }));
}

function saveSchedules(list) {
  writeJSON(schedulesFile(), { schedules: list });
}

function listSchedules() {
  return loadSchedules().sort((a, b) => {
    if ((a.enabled !== false) !== (b.enabled !== false)) return a.enabled === false ? 1 : -1;
    return String(a.nextRunAt || '9999').localeCompare(String(b.nextRunAt || '9999'));
  });
}

function getSchedule(id) {
  return loadSchedules().find((entry) => entry.id === id) || null;
}

function saveSchedule(input = {}) {
  const list = loadSchedules();
  const existing = input.id ? list.find((entry) => entry.id === input.id) : null;
  const schedule = sanitize(input, existing || {});
  const index = list.findIndex((entry) => entry.id === schedule.id);
  if (index >= 0) list[index] = schedule;
  else list.push(schedule);
  saveSchedules(list);
  return schedule;
}

function deleteSchedule(id) {
  const list = loadSchedules();
  const next = list.filter((entry) => entry.id !== id);
  if (next.length === list.length) return false;
  saveSchedules(next);
  return true;
}

function markRun(id, patch = {}) {
  const list = loadSchedules();
  const schedule = list.find((entry) => entry.id === id);
  if (!schedule) return null;
  schedule.lastRunAt = patch.at || new Date().toISOString();
  schedule.lastStatus = patch.status || schedule.lastStatus;
  schedule.lastError = patch.error ? String(patch.error).slice(0, 800) : '';
  if (patch.sessionId) schedule.lastSessionId = patch.sessionId;
  if (patch.status && patch.status !== 'running') {
    schedule.history = [
      {
        at: schedule.lastRunAt,
        status: patch.status,
        sessionId: patch.sessionId || '',
        error: patch.error ? String(patch.error).slice(0, 300) : '',
      },
      ...(Array.isArray(schedule.history) ? schedule.history : []),
    ].slice(0, HISTORY_LIMIT);
  }
  schedule.runCount = (Number(schedule.runCount) || 0) + (patch.status && patch.status !== 'running' ? 1 : 0);
  if (schedule.cadence === 'once' && patch.status) {
    schedule.enabled = false;
    schedule.nextRunAt = '';
  } else {
    schedule.nextRunAt = schedule.enabled ? computeNext(schedule, new Date()) : '';
  }
  saveSchedules(list);
  return schedule;
}

function dueSchedules(now = new Date()) {
  const stamp = now.getTime();
  return loadSchedules().filter((schedule) => {
    if (schedule.enabled === false || !schedule.nextRunAt) return false;
    const due = new Date(schedule.nextRunAt).getTime();
    return Number.isFinite(due) && due <= stamp;
  });
}

module.exports = {
  CADENCES,
  computeNext,
  dueSchedules,
  deleteSchedule,
  getSchedule,
  listSchedules,
  markRun,
  saveSchedule,
};
