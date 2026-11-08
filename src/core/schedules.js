'use strict';

const { appPaths, readJSON, writeJSON, uid } = require('./paths');
const { isEffort } = require('./reasoning');
const { CADENCES, normalizeTrigger, migrateRecord, createWebhookToken } = require('./triggers');
const MODES = ['agent', 'coding', 'design', 'research', 'plan', 'ask'];
const HISTORY_LIMIT = 12;

function schedulesFile() {
  return appPaths().schedules;
}

function parseTime(value) {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(value || '').trim());
  if (!match) return { hours: 9, minutes: 0 };
  return { hours: Number(match[1]), minutes: Number(match[2]) };
}

function onceTarget(schedule) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(schedule.date || ''));
  if (!match) return null;
  const { hours, minutes } = parseTime(schedule.time);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hours, minutes, 0, 0);
}

function computeNext(schedule, from = new Date()) {
  const source = schedule?.trigger?.type === 'schedule' ? schedule.trigger.config : schedule;
  const { hours, minutes } = parseTime(source.time);
  const base = from instanceof Date ? from : new Date(from);
  const next = new Date(base.getTime());
  next.setSeconds(0, 0);
  if (source.cadence === 'once') {
    const target = onceTarget(source);
    if (!target || Number.isNaN(target.getTime()) || target.getTime() <= base.getTime()) return '';
    return target.toISOString();
  }
  if (source.cadence === 'interval') {
    const every = Math.max(5, Math.min(1440, Number(source.everyMinutes) || 30));
    return new Date(base.getTime() + every * 60_000).toISOString();
  }
  if (source.cadence === 'hourly') {
    next.setMinutes(minutes, 0, 0);
    if (next.getTime() <= base.getTime()) next.setHours(next.getHours() + 1);
    return next.toISOString();
  }
  next.setHours(hours, minutes, 0, 0);
  if (source.cadence === 'daily') {
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

function resolveTrigger(input, existing) {
  const hasTrigger = Boolean(input.trigger) && typeof input.trigger === 'object';
  const hasLegacy = ['cadence', 'time', 'date', 'everyMinutes'].some((key) => input[key] !== undefined);
  if (hasTrigger) {
    return normalizeTrigger({
      type: input.trigger.type,
      config: input.trigger.config,
      cooldownSeconds: input.trigger.cooldownSeconds,
    }, existing, new Date());
  }
  if (!hasLegacy) {
    if (existing?.trigger) {
      return normalizeTrigger({
        type: existing.trigger.type,
        config: existing.trigger.config,
        cooldownSeconds: existing.trigger.cooldownSeconds,
      }, existing, new Date());
    }
    return normalizeTrigger({ type: 'schedule' }, existing, new Date());
  }
  if (existing?.trigger && existing.trigger.type !== 'schedule') {
    return normalizeTrigger({
      type: existing.trigger.type,
      config: existing.trigger.config,
      cooldownSeconds: existing.trigger.cooldownSeconds,
    }, existing, new Date());
  }
  return normalizeTrigger({
    type: 'schedule',
    cadence: input.cadence,
    date: input.date,
    time: input.time,
    everyMinutes: input.everyMinutes,
  }, existing, new Date());
}

function sanitize(input, existing = {}, now = new Date()) {
  const trigger = resolveTrigger(input, existing);
  const isSchedule = trigger.type === 'schedule';
  const schedule = {
    id: existing.id || uid('sch_'),
    title: String(input.title ?? existing.title ?? '').trim().slice(0, 80) || 'Scheduled run',
    prompt: String(input.prompt ?? existing.prompt ?? '').trim().slice(0, 4000),
    trigger,
    cadence: isSchedule ? trigger.config.cadence : 'manual',
    date: isSchedule ? trigger.config.date : '',
    time: isSchedule ? trigger.config.time : '',
    everyMinutes: isSchedule ? trigger.config.everyMinutes : 30,
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
    nextRunAt: '',
  };
  if (!schedule.prompt) throw new Error('A prompt is required for a scheduled run.');
  if (isSchedule && schedule.enabled) {
    schedule.nextRunAt = computeNext(schedule, now);
    if (trigger.config.cadence === 'once' && !schedule.nextRunAt) {
      throw new Error('Pick a future date and time for a one-time run.');
    }
  }
  return schedule;
}

function loadSchedules() {
  const raw = readJSON(schedulesFile(), { schedules: [] });
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.schedules) ? raw.schedules : [];
  let migrated = false;
  const records = list.filter((entry) => entry && entry.id).map((entry) => {
    const next = migrateRecord(entry);
    if (next !== entry) migrated = true;
    return { ...next };
  });
  if (migrated) saveSchedules(records);
  return records;
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

function buildSchedule(input = {}, now = new Date()) {
  const list = loadSchedules();
  const existing = input.id ? list.find((entry) => entry.id === input.id) : null;
  return sanitize(input, existing || {}, now);
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

function rotateWebhookToken(id) {
  const list = loadSchedules();
  const schedule = list.find((entry) => entry.id === id);
  if (!schedule || schedule.trigger?.type !== 'webhook') return null;
  schedule.trigger = {
    ...schedule.trigger,
    config: { ...(schedule.trigger.config || {}), token: createWebhookToken() },
  };
  schedule.updatedAt = new Date().toISOString();
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
    const entry = {
      at: schedule.lastRunAt,
      status: patch.status,
      sessionId: patch.sessionId || '',
      error: patch.error ? String(patch.error).slice(0, 300) : '',
    };
    if (patch.trigger && typeof patch.trigger === 'object') {
      entry.trigger = {
        type: String(patch.trigger.type || '').slice(0, 40),
        summary: String(patch.trigger.summary || '').slice(0, 300),
      };
    }
    schedule.history = [entry, ...(Array.isArray(schedule.history) ? schedule.history : [])].slice(0, HISTORY_LIMIT);
  }
  schedule.runCount = (Number(schedule.runCount) || 0) + (patch.status && patch.status !== 'running' ? 1 : 0);
  if (schedule.trigger?.type !== 'schedule') {
    schedule.nextRunAt = '';
  } else if (schedule.trigger.config.cadence === 'once' && patch.status) {
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
    if (schedule.trigger?.type !== 'schedule') return false;
    if (schedule.enabled === false || !schedule.nextRunAt) return false;
    const due = new Date(schedule.nextRunAt).getTime();
    return Number.isFinite(due) && due <= stamp;
  });
}

module.exports = {
  CADENCES,
  buildSchedule,
  computeNext,
  dueSchedules,
  deleteSchedule,
  getSchedule,
  listSchedules,
  markRun,
  rotateWebhookToken,
  saveSchedule,
};
