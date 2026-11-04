'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'blank-schedules-'));
process.env.BLANK_HOME = home;

const schedules = require('../src/core/schedules');

const at = (day, hour, minute = 0) => new Date(2026, 10, day, hour, minute, 0, 0);
// November 2026: the 4th is a Wednesday, the 6th a Friday, the 9th a Monday.

test.after(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

test('saveSchedule fills defaults and computes the next run', () => {
  const created = schedules.saveSchedule({ title: 'Morning brief', prompt: 'Summarize yesterday.' });
  assert.match(created.id, /^sch_/);
  assert.equal(created.title, 'Morning brief');
  assert.equal(created.cadence, 'daily');
  assert.equal(created.time, '09:00');
  assert.equal(created.enabled, true);
  assert.equal(created.mode, 'agent');
  assert.equal(created.reasoningEffort, 'auto');
  assert.equal(created.runCount, 0);
  assert.ok(created.nextRunAt);
  assert.ok(fs.existsSync(path.join(home, 'schedules.json')));
});

test('saveSchedule requires a prompt', () => {
  assert.throws(() => schedules.saveSchedule({ title: 'Empty' }), /prompt is required/i);
});

test('computeNext respects daily, hourly and weekday cadences', () => {
  const daily = (from) => schedules.computeNext({ cadence: 'daily', time: '09:00' }, from);
  assert.equal(daily(at(4, 8, 30)), at(4, 9).toISOString());
  assert.equal(daily(at(4, 10)), at(5, 9).toISOString());
  assert.equal(daily(at(4, 9)), at(5, 9).toISOString());

  const hourly = (from) => schedules.computeNext({ cadence: 'hourly', time: '09:15' }, from);
  assert.equal(hourly(at(4, 8, 30)), at(4, 9, 15).toISOString());
  assert.equal(hourly(at(4, 9, 20)), at(4, 10, 15).toISOString());

  const weekdays = (from) => schedules.computeNext({ cadence: 'weekdays', time: '09:00' }, from);
  assert.equal(weekdays(at(4, 8)), at(4, 9).toISOString());
  assert.equal(weekdays(at(6, 18)), at(9, 9).toISOString());
});

test('updates keep identity while changing enabled state', () => {
  const created = schedules.saveSchedule({ title: 'Watch build', prompt: 'Check CI.', cadence: 'hourly', time: '07:30' });
  const updated = schedules.saveSchedule({ id: created.id, enabled: false, title: 'Watch CI' });
  assert.equal(updated.id, created.id);
  assert.equal(updated.createdAt, created.createdAt);
  assert.equal(updated.nextRunAt, '');
  assert.equal(updated.title, 'Watch CI');
  assert.equal(updated.cadence, 'hourly');
  const listed = schedules.listSchedules();
  assert.equal(listed[listed.length - 1].id, created.id);
  assert.equal(listed[listed.length - 1].enabled, false);
});

test('dueSchedules returns only enabled schedules whose time has passed', () => {
  const file = path.join(home, 'schedules.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  raw.schedules = [
    { ...raw.schedules[0], id: 'sch_due', enabled: true, nextRunAt: '2026-11-03T23:00:00.000Z' },
    { ...raw.schedules[0], id: 'sch_future', enabled: true, nextRunAt: '2099-01-01T00:00:00.000Z' },
    { ...raw.schedules[0], id: 'sch_off', enabled: false, nextRunAt: '2026-11-03T23:00:00.000Z' },
  ];
  fs.writeFileSync(file, JSON.stringify(raw));
  const due = schedules.dueSchedules(new Date('2026-11-04T00:00:00.000Z'));
  assert.deepEqual(due.map((entry) => entry.id), ['sch_due']);
});

test('markRun records status, session, error and recomputes the next run', () => {
  const created = schedules.saveSchedule({ title: 'Nightly', prompt: 'Review the queue.' });
  const ran = schedules.markRun(created.id, { status: 'error', error: 'Model unavailable', sessionId: 's_123', at: '2026-11-04T00:00:00.000Z' });
  assert.equal(ran.lastStatus, 'error');
  assert.equal(ran.lastError, 'Model unavailable');
  assert.equal(ran.lastSessionId, 's_123');
  assert.equal(ran.lastRunAt, '2026-11-04T00:00:00.000Z');
  assert.equal(ran.runCount, 1);
  assert.ok(new Date(ran.nextRunAt).getTime() > Date.now());
  assert.equal(schedules.markRun('sch_missing'), null);
});

test('deleteSchedule removes the entry', () => {
  const created = schedules.saveSchedule({ title: 'Temporary', prompt: 'One run.' });
  assert.equal(schedules.deleteSchedule(created.id), true);
  assert.equal(schedules.deleteSchedule(created.id), false);
  assert.equal(schedules.getSchedule(created.id), null);
});
