'use strict';

const { appPaths, readJSON, writeJSON, uid } = require('./paths');
const { isEffort } = require('./reasoning');

const CADENCES = ['hourly', 'daily', 'weekdays'];
const MODES = ['agent', 'design', 'plan', 'ask'];

function schedulesFile() {
  return appPaths().schedules;
}

function parseTime(value) {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(value || '').trim());
  if (!match) return { hours: 9, minutes: 0 };
  return { hours: Number(match[1]), minutes: Number(match[2]) };
}

function computeNext(schedule, from = new Date()) {
  const { hours, minutes } = parseTime(schedule.time);
  const base = from instanceof Date ? from : new Date(from);
  const next = new Date(base.getTime());
  next.setSeconds(0, 0);
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
    time: /^([01]?\d|2[0-3]):([0-5]\d)$/.test(String(input.time ?? existing.time ?? '')) ? String(input.time ?? existing.time) : existing.time || '09:00',
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
  };
  if (!schedule.prompt) throw new Error('A prompt is required for a scheduled run.');
  schedule.nextRunAt = schedule.enabled ? computeNext(schedule, now) : '';
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
  schedule.runCount = (Number(schedule.runCount) || 0) + 1;
  schedule.nextRunAt = schedule.enabled ? computeNext(schedule, new Date()) : '';
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
