# Automation Triggers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add seven automation trigger sources (schedule, file, startup, webhook, MCP result change, messenger message, session completion) to blank's existing automation record, runner, history and UI.

**Architecture:** Extend `schedules.json` records with a normalized `trigger` object and keep the existing schedule fields as compatibility mirrors. Pure validation, matching, dedupe and prompt helpers live in `src/core/triggers.js`; transient state lives in `trigger-state.json`. An Electron-side engine owns watchers, pollers and the local webhook server, and dispatches every event through the existing automation runner.

**Tech Stack:** CommonJS, Electron 45, Node test runner (`node --test`), vanilla renderer scripts, no new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-11-07-automation-triggers-design.md`

## Global Constraints

- Do not add runtime or test dependencies.
- Do not commit. The user has not requested any git commits; leave changes in the working tree.
- Run tests with `node --test` from the repository root. `npm test` currently fails on Node 24 because it passes a directory positional; do not change that script in this plan.
- Preserve existing automation behavior and existing `schedules.json` records.
- Keep the renderer sandboxed. No webhook token, MCP credential or other secret may be sent to the renderer, written to logs or included in broadcasts.
- Korean UI strings must be natural, not literal translations.
- Use `clip`-style truncation and explicit caps from the spec; never let external event data grow prompts without a bound.
- Keep all trigger timers and watchers stoppable and idempotent.
- Follow existing code style: two-space indent, single quotes, semicolons, small focused modules.
- Each task ends with a passing focused test run and a diff review. Do not commit.

---

## File map

| Path | Responsibility |
| --- | --- |
| `src/core/triggers.js` | Trigger types, normalization, migration, matching, dedupe keys, cooldowns, canonical JSON, fingerprints, token helpers, redaction, event prompt formatting, resource validation |
| `src/core/trigger-state.js` | `trigger-state.json` persistence, pruning, seen/fired/MCP state helpers |
| `src/core/schedules.js` | Extended record schema, migration on load, schedule-only due selection, trigger-aware run history |
| `src/core/paths.js` | `triggerState` path |
| `src/core/config.js` | `triggers` defaults |
| `src/core/messengers.js` | `onIncoming` hook for paired plain text |
| `electron/trigger-webhook.js` | Local HTTP webhook server and request handling |
| `electron/trigger-engine.js` | Source lifecycle, 15s coordinator, file debounce, MCP polling, startup timers, session/messenger matching, dispatch guards |
| `electron/ipc.js` | Runner extension, engine wiring, redaction, IPC handlers, session/messenger notifications |
| `electron/preload.js` | New renderer methods |
| `renderer/js/views.js` | Trigger editor, runtime status, read-only Settings list |
| `renderer/js/i18n.js` | Korean trigger strings |
| `test/triggers.test.js` | Trigger core tests |
| `test/trigger-state.test.js` | State persistence tests |
| `test/trigger-webhook.test.js` | Webhook server tests |
| `test/trigger-engine.test.js` | Engine polling, debounce and guard tests |
| `test/schedules.test.js` | Extended schedule core tests |
| `test/messengers.test.js` | Hook tests |

---

### Task 1: Trigger normalization, migration, redaction and resource validation

**Files:**
- Create: `src/core/triggers.js`
- Create: `test/triggers.test.js`

**Interfaces:**
- Produces:
  - `TRIGGER_TYPES: string[]`
  - `DEFAULT_COOLDOWNS: Record<string, number>`
  - `CADENCES: string[]`
  - `normalizeTrigger(input, existingRecord, now): { type, config, cooldownSeconds }`
  - `migrateRecord(record, now): record`
  - `createWebhookToken(): string`
  - `tokensEqual(expected, received): boolean`
  - `redactTrigger(trigger, id): trigger`
  - `validateTriggerResources(trigger, { mcpServerIds, mcpToolNames }): void`

- [ ] **Step 1: Write failing tests for normalization and migration**

Create `test/triggers.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const triggers = require('../src/core/triggers');

test('a new automation defaults to a daily schedule trigger', () => {
  const trigger = triggers.normalizeTrigger({}, null, new Date(2026, 10, 7, 10, 0));
  assert.equal(trigger.type, 'schedule');
  assert.deepEqual(trigger.config, {
    cadence: 'daily',
    date: '',
    time: '09:00',
    everyMinutes: 30,
  });
  assert.equal(trigger.cooldownSeconds, 0);
});

test('file, startup, mcp, messenger and session defaults are filled in', () => {
  const file = triggers.normalizeTrigger({ type: 'file', config: { paths: ['C:\\work'] } });
  assert.deepEqual(file.config.events, ['change']);
  assert.equal(file.config.debounceSeconds, 3);
  assert.equal(file.cooldownSeconds, 60);

  const startup = triggers.normalizeTrigger({ type: 'startup', config: {} });
  assert.equal(startup.config.delaySeconds, 15);
  assert.equal(startup.cooldownSeconds, 0);

  const mcp = triggers.normalizeTrigger({ type: 'mcp', config: { serverId: 'github', toolName: 'issues' } });
  assert.deepEqual(mcp.config.args, {});
  assert.equal(mcp.config.intervalSeconds, 300);

  assert.throws(
    () => triggers.normalizeTrigger({ type: 'messenger', config: {} }),
    /provider/i,
  );
  const messenger = triggers.normalizeTrigger({
    type: 'messenger',
    config: { provider: 'telegram', textIncludes: 'deploy' },
  });
  assert.equal(messenger.config.fromIncludes, '');
  assert.equal(messenger.config.textIncludes, 'deploy');
  assert.equal(messenger.cooldownSeconds, 10);

  const session = triggers.normalizeTrigger({ type: 'session', config: {} });
  assert.equal(session.config.on, 'complete');
  assert.equal(session.config.includeAutomationRuns, false);
  assert.equal(session.cooldownSeconds, 30);
});

test('invalid trigger values are rejected', () => {
  assert.throws(() => triggers.normalizeTrigger({ type: 'nope' }), /unknown trigger/i);
  assert.throws(() => triggers.normalizeTrigger({
    type: 'file',
    config: { paths: [] },
  }), /path/i);
  assert.throws(() => triggers.normalizeTrigger({
    type: 'file',
    config: { paths: ['C:\\work'], events: ['explode'] },
  }), /event/i);
  assert.throws(() => triggers.normalizeTrigger({
    type: 'mcp',
    config: { serverId: 's', toolName: 't', intervalSeconds: 5 },
  }), /interval/i);
  assert.throws(() => triggers.normalizeTrigger({
    type: 'mcp',
    config: { serverId: 's', toolName: 't', args: [] },
  }), /args/i);
  assert.throws(() => triggers.normalizeTrigger({
    type: 'session',
    config: { on: 'stopped' },
  }), /session trigger/i);
});

test('webhook tokens are generated, preserved and never taken from input', () => {
  const first = triggers.normalizeTrigger({ type: 'webhook', config: {} });
  assert.match(first.config.token, /^[A-Za-z0-9_-]{40,}$/);
  assert.equal(first.config.allowQueryToken, false);
  assert.equal(first.cooldownSeconds, 5);

  const kept = triggers.normalizeTrigger(
    { type: 'webhook', config: { allowQueryToken: true } },
    { trigger: first },
  );
  assert.equal(kept.config.token, first.config.token);
  assert.equal(kept.config.allowQueryToken, true);

  const attacker = triggers.normalizeTrigger(
    { type: 'webhook', config: { token: 'attacker-token' } },
    { trigger: first },
  );
  assert.notEqual(attacker.config.token, 'attacker-token');
  assert.equal(attacker.config.token, first.config.token);

  const switched = triggers.normalizeTrigger(
    { type: 'mcp', config: { serverId: 's', toolName: 't' } },
    { trigger: first },
  );
  assert.equal(switched.config.token, undefined);
});

test('legacy records migrate to a schedule trigger exactly once', () => {
  const legacy = {
    id: 'sch_legacy',
    title: 'Old',
    prompt: 'Run it.',
    cadence: 'weekdays',
    date: '',
    time: '08:30',
    everyMinutes: 15,
    enabled: true,
    history: [{ at: '2026-11-01T00:00:00.000Z', status: 'ok' }],
    runCount: 2,
  };
  const migrated = triggers.migrateRecord(legacy);
  assert.equal(migrated.id, legacy.id);
  assert.equal(migrated.prompt, legacy.prompt);
  assert.equal(migrated.history.length, 1);
  assert.deepEqual(migrated.trigger, {
    type: 'schedule',
    config: { cadence: 'weekdays', date: '', time: '08:30', everyMinutes: 15 },
    cooldownSeconds: 0,
  });

  const again = triggers.migrateRecord(migrated);
  assert.deepEqual(again, migrated);
});

test('redaction removes the token and exposes only a hook hint', () => {
  const redacted = triggers.redactTrigger({
    type: 'webhook',
    config: { token: 'super-secret', allowQueryToken: true },
    cooldownSeconds: 5,
  }, 'sch_hook');
  assert.equal(redacted.config.token, undefined);
  assert.equal(redacted.config.tokenSet, true);
  assert.equal(redacted.config.hookPath, '/hooks/sch_hook');
  assert.equal(redacted.config.allowQueryToken, true);
  assert.ok(!JSON.stringify(redacted).includes('super-secret'));
});

test('tokens compare in constant time and reject length changes', () => {
  assert.equal(triggers.tokensEqual('abc123', 'abc123'), true);
  assert.equal(triggers.tokensEqual('abc123', 'abc124'), false);
  assert.equal(triggers.tokensEqual('abc123', 'abc1234'), false);
  assert.equal(triggers.tokensEqual('', ''), false);
});

test('resource validation checks file paths and MCP names', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blank-trigger-path-'));
  const file = path.join(dir, 'watch.txt');
  fs.writeFileSync(file, 'x');
  try {
    assert.doesNotThrow(() => triggers.validateTriggerResources(
      { type: 'file', config: { paths: [file] } },
      { mcpServerIds: [], mcpToolNames: [] },
    ));
    assert.throws(() => triggers.validateTriggerResources(
      { type: 'file', config: { paths: [path.join(dir, 'missing.txt')] } },
      { mcpServerIds: [], mcpToolNames: [] },
    ), /does not exist/i);
    assert.throws(() => triggers.validateTriggerResources(
      { type: 'mcp', config: { serverId: 'nope', toolName: 'x' } },
      { mcpServerIds: ['other'], mcpToolNames: [] },
    ), /server/i);
    assert.throws(() => triggers.validateTriggerResources(
      { type: 'mcp', config: { serverId: 'other', toolName: 'nope' } },
      { mcpServerIds: ['other'], mcpToolNames: ['watch'] },
    ), /tool/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test test/triggers.test.js`
Expected: FAIL with `Cannot find module '../src/core/triggers'`.

- [ ] **Step 3: Implement `src/core/triggers.js`**

Key implementation requirements:

- Use `crypto.randomBytes(32).toString('base64url')` for tokens.
- `TRIGGER_TYPES = ['schedule', 'file', 'startup', 'webhook', 'mcp', 'messenger', 'session']`.
- `CADENCES = ['interval', 'hourly', 'daily', 'weekdays', 'once']`.
- `DEFAULT_COOLDOWNS = { schedule: 0, file: 60, startup: 0, webhook: 5, mcp: 0, messenger: 10, session: 30 }`.
- `normalizeTrigger` picks the type from `input.type`, then `existingRecord.trigger.type`, then `schedule`; throws on an unknown explicit type.
- For `schedule`, read config from `input.config`, then legacy `input.cadence/time/date/everyMinutes`, then `existingRecord.trigger.config`, then defaults. Validate cadence/time/date/everyMinutes. `date` must match `YYYY-MM-DD` or be empty; `once` must have a valid date (the future check stays in schedules).
- For each non-schedule type, apply the spec defaults and caps. Never read a token from `input`; reuse `existingRecord.trigger.config.token` when the type is unchanged, otherwise generate one.
- `cooldownSeconds` comes from input, then existing, then the type default; clamp to `0..86400`.
- `migrateRecord` returns the same object when `record.trigger` has a valid type; otherwise adds a schedule trigger built from legacy fields (valid cadence/time/everyMinutes, fallback daily/09:00/30).
- `redactTrigger(trigger, id)` returns a deep copy without `config.token`, with `config.tokenSet = Boolean(token)` and `config.hookPath = '/hooks/' + id` for webhook.
- `validateTriggerResources` throws when a file path is not absolute, does not exist or cannot be `realpath`-resolved; when `mcpServerIds` is non-empty and the server is absent; when `mcpToolNames` is non-empty and the tool is absent. It does nothing for other types.
- Export `clipText(value, limit)` for the next task.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `node --test test/triggers.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 5: Review the diff**

Run: `git diff -- src/core/triggers.js test/triggers.test.js`
Expected: only the new files. Do not commit.

---

### Task 2: Event matching, dedupe, cooldown, fingerprints and prompt block

**Files:**
- Modify: `src/core/triggers.js`
- Modify: `test/triggers.test.js`

**Interfaces:**
- Produces:
  - `matchesEvent(trigger, event): boolean`
  - `dedupeKey(trigger, event): string` (event must carry `recordId` for dedupe types)
  - `canonicalJson(value): string`
  - `fingerprint(value): string`
  - `summarizeEvent(trigger, event): string`
  - `formatEventPrompt(trigger, event, prompt): string`
  - `cooldownRemaining(cooldownSeconds, lastFiredAt, now): number`
  - `dedupeWindowMs(trigger): number`

- [ ] **Step 1: Add failing tests**

Append to `test/triggers.test.js`:

```js
test('events match their trigger configuration', () => {
  const file = { type: 'file', config: { events: ['add', 'change'], paths: ['C:\\x'] } };
  assert.equal(triggers.matchesEvent(file, { type: 'file', kind: 'change' }), true);
  assert.equal(triggers.matchesEvent(file, { type: 'file', kind: 'remove' }), false);

  const messenger = {
    type: 'messenger',
    config: { provider: 'telegram', fromIncludes: 'Alice', textIncludes: 'deploy' },
  };
  assert.equal(triggers.matchesEvent(messenger, {
    type: 'messenger', provider: 'telegram', label: 'Alice Kim', text: 'please deploy now',
  }), true);
  assert.equal(triggers.matchesEvent(messenger, {
    type: 'messenger', provider: 'discord', label: 'Alice', text: 'deploy',
  }), false);
  assert.equal(triggers.matchesEvent(messenger, {
    type: 'messenger', provider: 'telegram', label: 'Alice', text: 'hello',
  }), false);

  const session = { type: 'session', config: { on: 'error', includeAutomationRuns: false } };
  assert.equal(triggers.matchesEvent(session, { type: 'session', status: 'error' }), true);
  assert.equal(triggers.matchesEvent(session, { type: 'session', status: 'ok' }), false);
  assert.equal(triggers.matchesEvent(session, { type: 'session', status: 'stopped' }), false);
});

test('dedupe keys are stable for identical events and hide raw text', () => {
  const trigger = { type: 'messenger', config: { provider: 'telegram' } };
  const base = {
    recordId: 'sch_msg',
    type: 'messenger',
    provider: 'telegram',
    chatId: 'chat-9',
    text: 'hello secret',
  };
  const first = triggers.dedupeKey(trigger, base);
  assert.equal(first, triggers.dedupeKey(trigger, { ...base }));
  assert.notEqual(first, triggers.dedupeKey(trigger, { ...base, text: 'other' }));
  assert.ok(!first.includes('hello secret'));
  assert.ok(!first.includes('chat-9'));

  const webhook = { type: 'webhook', config: {} };
  assert.equal(
    triggers.dedupeKey(webhook, { recordId: 'sch_w', type: 'webhook', body: '{"a":1}' }),
    triggers.dedupeKey(webhook, { recordId: 'sch_w', type: 'webhook', body: '{"a":1}' }),
  );
});

test('canonical JSON and fingerprints ignore object key order', () => {
  assert.equal(
    triggers.canonicalJson({ b: 1, a: { d: 4, c: 3 } }),
    triggers.canonicalJson({ a: { c: 3, d: 4 }, b: 1 }),
  );
  assert.equal(
    triggers.fingerprint({ a: 1, b: [{ y: 2, x: 1 }] }),
    triggers.fingerprint({ b: [{ x: 1, y: 2 }], a: 1 }),
  );
  assert.notEqual(triggers.fingerprint({ a: 1 }), triggers.fingerprint({ a: 2 }));
});

test('event prompts are bounded, labeled as data and never include a token', () => {
  const trigger = { type: 'webhook', config: { token: 'super-secret' } };
  const event = {
    type: 'webhook',
    at: '2026-11-07T00:00:00.000Z',
    body: `{"payload":"${'x'.repeat(10000)}"}`,
    token: 'super-secret',
  };
  const output = triggers.formatEventPrompt(trigger, event, 'Summarize.');
  assert.ok(output.length < 4 * 1024 + 'Summarize.'.length + 120);
  assert.match(output, /not instructions/i);
  assert.match(output, /Summarize\.$/);
  assert.ok(!output.includes('super-secret'));
});

test('event summaries are short and readable', () => {
  assert.match(triggers.summarizeEvent(
    { type: 'file', config: {} },
    { type: 'file', kind: 'change', path: 'C:\\work\\report.csv' },
  ), /change.*report\.csv/i);
  assert.match(triggers.summarizeEvent(
    { type: 'mcp', config: {} },
    { type: 'mcp', serverId: 'github', toolName: 'issues' },
  ), /github\/issues/);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test test/triggers.test.js`
Expected: FAIL with `triggers.matchesEvent is not a function`.

- [ ] **Step 3: Implement the helpers**

Implementation notes:

- `matchesEvent` switches on `trigger.type` and requires the same `event.type` except `manual`, which never matches. Messenger filters are case-insensitive substring checks.
- `dedupeKey` returns `''` for types without dedupe. For file: `file:${recordId}:${path}:${mtimeMs}:${size}`. For webhook: `webhook:${recordId}:${sha256(body)}`. For messenger: `messenger:${recordId}:${sha256(provider|chatId|text)}`. For session: `session:${recordId}:${sessionId}:${status}`.
- `dedupeWindowMs` returns 10s for messenger, 60s for webhook, 10s for file, and 0 for others.
- `cooldownRemaining` returns 0 when `lastFiredAt` is empty or unparsable.
- `canonicalJson` recursively sorts object keys and uses `JSON.stringify`.
- `fingerprint` hashes `canonicalJson(value)` with SHA-256 hex.
- `summarizeEvent` uses `path.basename` for files and caps at 300 chars.
- `formatEventPrompt` builds the exact block from the spec with a 4096-byte event-block cap and per-field caps. Use `clipText`; never read a token field. Always append the original prompt unchanged after a blank line.
- Use `crypto.createHash('sha256')`.

- [ ] **Step 4: Run the focused tests**

Run: `node --test test/triggers.test.js`
Expected: PASS, 13 tests.

- [ ] **Step 5: Review the diff**

Run: `git diff -- src/core/triggers.js test/triggers.test.js`
Expected: only helper additions and tests. Do not commit.

---

### Task 3: Trigger state persistence and paths

**Files:**
- Create: `src/core/trigger-state.js`
- Modify: `src/core/paths.js`
- Create: `test/trigger-state.test.js`

**Interfaces:**
- Produces:
  - `loadTriggerState(): state`
  - `saveTriggerState(state): void`
  - `pruneState(state, now): state`
  - `seenRecently(state, key, now, windowMs): boolean`
  - `rememberSeen(state, key, now): void`
  - `lastFiredAt(state, id): number`
  - `markFired(state, id, now): void`
  - `deleteTriggerState(state, id): void`
  - `appPaths().triggerState`

- [ ] **Step 1: Write failing tests**

Create `test/trigger-state.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'blank-trigger-state-'));
process.env.BLANK_HOME = home;

const stateModule = require('../src/core/trigger-state');
const { appPaths } = require('../src/core/paths');

test.after(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

test('missing state loads a clean versioned object', () => {
  const state = stateModule.loadTriggerState();
  assert.deepEqual(state, { version: 1, seen: {}, lastFired: {}, mcp: {} });
  assert.equal(appPaths().triggerState, path.join(home, 'trigger-state.json'));
});

test('seen entries remember, expire and hash the key', () => {
  const state = stateModule.loadTriggerState();
  const now = Date.now();
  assert.equal(stateModule.seenRecently(state, 'raw-key', now, 5000), false);
  stateModule.rememberSeen(state, 'raw-key', now);
  assert.equal(stateModule.seenRecently(state, 'raw-key', now + 1000, 5000), true);
  assert.equal(stateModule.seenRecently(state, 'raw-key', now + 6000, 5000), false);
  assert.ok(!JSON.stringify(state).includes('raw-key'));
});

test('pruning keeps 200 newest seen entries and drops old ones', () => {
  const state = stateModule.loadTriggerState();
  const base = Date.now();
  for (let index = 0; index < 210; index += 1) {
    stateModule.rememberSeen(state, `key-${index}`, base + index);
  }
  state.seen[stateModule.hashKey('old')] = new Date(base - 25 * 60 * 60 * 1000).toISOString();
  stateModule.pruneState(state, new Date(base + 1000));
  assert.equal(Object.keys(state.seen).length, 200);
  assert.equal(state.seen[stateModule.hashKey('old')], undefined);
});

test('fired timestamps and MCP entries round-trip through the file', () => {
  const state = stateModule.loadTriggerState();
  stateModule.markFired(state, 'sch_a', new Date('2026-11-07T00:00:00.000Z'));
  state.mcp.sch_a = { configHash: 'h', fingerprint: 'f', baselineAt: '2026-11-07T00:00:00.000Z', lastError: '' };
  stateModule.saveTriggerState(state);
  const loaded = stateModule.loadTriggerState();
  assert.equal(stateModule.lastFiredAt(loaded, 'sch_a'), Date.parse('2026-11-07T00:00:00.000Z'));
  assert.equal(loaded.mcp.sch_a.fingerprint, 'f');
  stateModule.deleteTriggerState(loaded, 'sch_a');
  assert.equal(loaded.lastFired.sch_a, undefined);
  assert.equal(loaded.mcp.sch_a, undefined);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test test/trigger-state.test.js`
Expected: FAIL with `Cannot find module '../src/core/trigger-state'`.

- [ ] **Step 3: Implement the state module and the path**

- Add `triggerState: path.join(root, 'trigger-state.json')` to `appPaths()`.
- `loadTriggerState()` reads `appPaths().triggerState` with `readJSON` and repairs non-object/missing sections.
- `rememberSeen` stores `hashKey(key)` and prunes values older than 24 hours, then caps to the 200 newest by timestamp.
- `seenRecently` uses the hash and the supplied window.
- `saveTriggerState` calls `pruneState(state, new Date())` and `writeJSON`.
- `deleteTriggerState` removes the record from `lastFired` and `mcp`.
- Export `hashKey` for tests.

- [ ] **Step 4: Run the tests**

Run: `node --test test/trigger-state.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Review the diff**

Run: `git diff -- src/core/trigger-state.js src/core/paths.js test/trigger-state.test.js`
Expected: new module, one path field, tests. Do not commit.

---

### Task 4: Extend schedules core

**Files:**
- Modify: `src/core/schedules.js`
- Modify: `test/schedules.test.js`

**Interfaces:**
- Consumes: `triggers.normalizeTrigger`, `triggers.migrateRecord`, `triggers.createWebhookToken`.
- Produces:
  - `buildSchedule(input, now): record` (sanitize without writing)
  - `saveSchedule(input): record`
  - `rotateWebhookToken(id): record | null`
  - `CADENCES` re-exported
  - `computeNext` accepts legacy fields or a full record

- [ ] **Step 1: Add failing tests**

Append to `test/schedules.test.js` (keep the existing home and cleanup):

```js
test('legacy records migrate on load and keep running', () => {
  const file = path.join(home, 'schedules.json');
  fs.writeFileSync(file, JSON.stringify({
    schedules: [{
      id: 'sch_legacy',
      title: 'Legacy',
      prompt: 'Still here.',
      cadence: 'daily',
      date: '',
      time: '07:15',
      everyMinutes: 30,
      enabled: true,
      runCount: 4,
      history: [],
    }],
  }));
  const records = schedules.listSchedules();
  const legacy = records.find((entry) => entry.id === 'sch_legacy');
  assert.equal(legacy.trigger.type, 'schedule');
  assert.equal(legacy.trigger.config.time, '07:15');
  assert.equal(legacy.runCount, 4);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(raw.schedules[0].trigger);
});

test('non-schedule triggers keep nextRunAt empty and preserve identity on partial saves', () => {
  const created = schedules.saveSchedule({
    title: 'Watch a file',
    prompt: 'Summarize the change.',
    trigger: {
      type: 'file',
      config: { paths: [__filename], events: ['change'], debounceSeconds: 3 },
    },
  });
  assert.equal(created.trigger.type, 'file');
  assert.equal(created.nextRunAt, '');
  assert.equal(created.cadence, 'manual');

  const paused = schedules.saveSchedule({ id: created.id, enabled: false });
  assert.equal(paused.trigger.type, 'file');
  assert.deepEqual(paused.trigger.config.paths, [__filename]);
  assert.equal(paused.enabled, false);
  assert.equal(paused.nextRunAt, '');

  const resumed = schedules.saveSchedule({ id: created.id, enabled: true });
  assert.equal(resumed.trigger.type, 'file');
  assert.equal(resumed.enabled, true);
});

test('only schedule triggers are due', () => {
  schedules.saveSchedule({
    title: 'File not due',
    prompt: 'Nope.',
    trigger: { type: 'file', config: { paths: [__filename] } },
  });
  const file = path.join(home, 'schedules.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const entry = raw.schedules.find((row) => row.title === 'File not due');
  entry.nextRunAt = '2026-11-03T23:00:00.000Z';
  fs.writeFileSync(file, JSON.stringify(raw));
  const due = schedules.dueSchedules(new Date('2026-11-04T00:00:00.000Z'));
  assert.ok(!due.some((row) => row.id === entry.id));
});

test('webhook tokens survive updates and rotate on demand', () => {
  const created = schedules.saveSchedule({
    title: 'Hook',
    prompt: 'Handle it.',
    trigger: { type: 'webhook', config: {} },
  });
  const token = created.trigger.config.token;
  assert.ok(token);
  const updated = schedules.saveSchedule({ id: created.id, title: 'Hook 2' });
  assert.equal(updated.trigger.config.token, token);
  const rotated = schedules.rotateWebhookToken(created.id);
  assert.notEqual(rotated.trigger.config.token, token);
  assert.equal(schedules.rotateWebhookToken('sch_missing'), null);
});

test('markRun stores trigger history and leaves non-schedule nextRunAt empty', () => {
  const created = schedules.saveSchedule({
    title: 'Session watcher',
    prompt: 'React.',
    trigger: { type: 'session', config: { on: 'complete' } },
  });
  const ran = schedules.markRun(created.id, {
    status: 'ok',
    sessionId: 's_trigger',
    at: '2026-11-07T00:00:00.000Z',
    trigger: { type: 'session', summary: 'A chat completed' },
  });
  assert.equal(ran.nextRunAt, '');
  assert.equal(ran.history[0].trigger.type, 'session');
  assert.equal(ran.history[0].trigger.summary, 'A chat completed');
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test test/schedules.test.js`
Expected: FAIL on the new trigger assertions.

- [ ] **Step 3: Refactor `schedules.js`**

- Import `normalizeTrigger`, `migrateRecord`, `createWebhookToken` from `./triggers`; import `CADENCES` and re-export it.
- `loadSchedules` migrates each record; if any changed, save once.
- Add `buildSchedule(input, now)` containing the current `sanitize` logic plus the save-time trigger resolution rules from the spec:
  - input trigger present -> normalize it;
  - no trigger, no legacy fields, existing -> existing trigger;
  - no trigger, no legacy fields, new -> schedule;
  - no trigger, legacy fields, existing non-schedule -> existing trigger;
  - no trigger, legacy fields, existing schedule or new -> schedule from legacy fields.
- `saveSchedule` calls `buildSchedule`, upserts and writes.
- `sanitize` sets `trigger`, writes mirrors for schedule from `trigger.config`, and uses `cadence: 'manual'`, `date: ''`, `time: ''`, `everyMinutes: 30` otherwise.
- `nextRunAt` only for schedule and enabled; keep the once future-date error.
- `computeNext` reads schedule config from `record.trigger.config` when present, otherwise from the legacy top-level fields.
- `dueSchedules` requires `trigger.type === 'schedule'`.
- `markRun` appends `patch.trigger` to history when provided, increments runCount as today, recomputes nextRunAt only for schedule, and does not disable non-schedule records.
- `rotateWebhookToken(id)` generates a new token via `createWebhookToken`, saves, returns the record or null.

- [ ] **Step 4: Run schedule and trigger tests**

Run: `node --test test/schedules.test.js test/triggers.test.js`
Expected: PASS.

- [ ] **Step 5: Review the diff**

Run: `git diff -- src/core/schedules.js test/schedules.test.js`
Expected: schema changes and tests. Do not commit.

---

### Task 5: Local webhook server

**Files:**
- Create: `electron/trigger-webhook.js`
- Create: `test/trigger-webhook.test.js`

**Interfaces:**
- Produces:
  - `createWebhookServer({ getRecords, getConfig, dispatch, onStatus })`
  - `server.start(): Promise<status>`
  - `server.stop(): Promise<void>`
  - `server.reconcile(): Promise<status>`
  - `server.status(): { running, port, configuredPort, allowLan, error }`

- [ ] **Step 1: Write failing tests**

Create `test/trigger-webhook.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createWebhookServer } = require('../electron/trigger-webhook');

const record = {
  id: 'sch_hook',
  enabled: true,
  prompt: 'Handle the hook.',
  trigger: {
    type: 'webhook',
    config: { token: 'test-token', allowQueryToken: false },
    cooldownSeconds: 5,
  },
};

function makeServer(options = {}) {
  const calls = [];
  const server = createWebhookServer({
    getRecords: () => [record],
    getConfig: () => ({ triggers: { webhookPort: 0, webhookAllowLan: false } }),
    dispatch: async (entry, event) => {
      calls.push(event);
      if (options.reply) return options.reply;
      return { started: true, sessionId: 's_hook' };
    },
    onStatus: () => {},
  });
  return { server, calls };
}

test('webhook accepts a bearer token and dispatches the body', async () => {
  const { server, calls } = makeServer();
  test.after(() => server.stop());
  const status = await server.start();
  assert.equal(status.running, true);
  assert.ok(status.port > 0);

  const response = await fetch(`http://127.0.0.1:${status.port}/hooks/sch_hook`, {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify({ build: 42 }),
  });
  assert.equal(response.status, 202);
  const payload = await response.json();
  assert.equal(payload.started, true);
  assert.equal(payload.sessionId, 's_hook');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body, { build: 42 });
  assert.equal(calls[0].type, 'webhook');
  assert.equal(calls[0].recordId, 'sch_hook');
});

test('webhook rejects a bad token, unknown id and wrong method', async () => {
  const { server } = makeServer();
  test.after(() => server.stop());
  const status = await server.start();
  const base = `http://127.0.0.1:${status.port}`;

  const bad = await fetch(`${base}/hooks/sch_hook`, {
    method: 'POST',
    headers: { authorization: 'Bearer wrong' },
    body: '{}',
  });
  assert.equal(bad.status, 401);

  const unknown = await fetch(`${base}/hooks/nope`, {
    method: 'POST',
    headers: { authorization: 'Bearer test-token' },
    body: '{}',
  });
  assert.equal(unknown.status, 401);

  const wrongMethod = await fetch(`${base}/hooks/sch_hook`, {
    method: 'GET',
    headers: { authorization: 'Bearer test-token' },
  });
  assert.equal(wrongMethod.status, 405);
});

test('webhook reports a skipped dispatch without failing', async () => {
  const { server } = makeServer({ reply: { started: false, reason: 'cooldown' } });
  test.after(() => server.stop());
  const status = await server.start();
  const response = await fetch(`http://127.0.0.1:${status.port}/hooks/sch_hook`, {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: '{"ok":true}',
  });
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { ok: true, started: false, reason: 'cooldown' });
});

test('webhook enforces the body limit and query-token policy', async () => {
  const { server } = makeServer();
  test.after(() => server.stop());
  const status = await server.start();
  const base = `http://127.0.0.1:${status.port}`;

  const big = await fetch(`${base}/hooks/sch_hook?token=test-token`, {
    method: 'POST',
    headers: { authorization: 'Bearer test-token' },
    body: 'x'.repeat(70 * 1024),
  });
  assert.equal(big.status, 413);

  const query = await fetch(`${base}/hooks/sch_hook?token=test-token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"a":1}',
  });
  assert.equal(query.status, 401);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test test/trigger-webhook.test.js`
Expected: FAIL with `Cannot find module '../electron/trigger-webhook'`.

- [ ] **Step 3: Implement the server**

Implementation notes:

- Use `http.createServer` and `URL` from `node:url` (or the global `URL`).
- Start only when `getRecords()` has an enabled webhook record; otherwise return `{ running: false, ... }`.
- Bind `127.0.0.1` unless `getConfig().triggers?.webhookAllowLan` is true.
- Port from `getConfig().triggers?.webhookPort`; allow `0` for tests. If bind fails with `EADDRINUSE`, try the next four ports.
- Route `POST /hooks/:id`; unknown id and bad token both return 401 without reading the body.
- Accept `Authorization: Bearer` and `X-Blank-Token`; query token only when `allowQueryToken`.
- Auth failure limit: 60 per minute per remote address.
- Record rate limit: 60 per minute per record id.
- Read the body up to 64 KB. If exceeded, keep discarding input and respond 413 after the request ends so clients receive the status instead of a socket reset.
- Parse JSON only for `application/json`; otherwise pass the text body.
- Build the event `{ type: 'webhook', at, recordId: record.id, body, contentType }`.
- Call `await dispatch(record, event, { chain: [] })`; respond 202 with `started` and optional `sessionId`/`reason`.
- Never log headers or bodies.
- `stop()` closes the listener and resets status.
- `reconcile()` stops when no enabled webhook records remain, otherwise restarts if the port/settings changed.

- [ ] **Step 4: Run the webhook tests**

Run: `node --test test/trigger-webhook.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Review the diff**

Run: `git diff -- electron/trigger-webhook.js test/trigger-webhook.test.js`
Expected: new server and tests. Do not commit.

---

### Task 6: Trigger engine

**Files:**
- Create: `electron/trigger-engine.js`
- Create: `test/trigger-engine.test.js`

**Interfaces:**
- Consumes: `triggers`, `trigger-state`, `createWebhookServer`.
- Produces:
  - `createTriggerEngine({ getSchedules, getConfig, mcp, dispatch, notify, fileDebounceMs })`
  - `start()`, `stop()`, `reconcile()`
  - `noteAutomationSession(sessionId, { recordId, chain })`
  - `notifySession(event)`, `notifyMessenger(event)`
  - `pollNow(record)`, `handleFileEvent(record, event)`
  - `testTrigger(draft)`
  - `status()`

- [ ] **Step 1: Write failing tests**

Create `test/trigger-engine.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'blank-trigger-engine-'));
process.env.BLANK_HOME = home;

const { createTriggerEngine } = require('../electron/trigger-engine');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test.after(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

function mcpRecord() {
  return {
    id: 'sch_mcp',
    enabled: true,
    prompt: 'Check it.',
    trigger: {
      type: 'mcp',
      config: { serverId: 'srv', toolName: 'watch', args: {}, intervalSeconds: 60 },
      cooldownSeconds: 0,
    },
  };
}

test('MCP polling baselines first and dispatches only on change', async () => {
  let result = { content: [{ type: 'text', text: 'one' }] };
  const mcp = {
    callTool: async () => result,
    statuses: () => [{ id: 'srv', connected: true, tools: ['watch'] }],
  };
  const dispatched = [];
  let record = mcpRecord();
  const engine = createTriggerEngine({
    getSchedules: () => [record],
    getConfig: () => ({ mcpServers: [{ id: 'srv', enabled: true }], triggers: {} }),
    mcp,
    dispatch: async (entry, event) => {
      dispatched.push(event);
      return { started: true, sessionId: 's_mcp' };
    },
    notify: () => {},
  });
  await engine.start();
  await engine.pollNow(record);
  assert.equal(dispatched.length, 0);

  result = { content: [{ type: 'text', text: 'two' }] };
  await engine.pollNow(record);
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].type, 'mcp');
  assert.equal(dispatched[0].recordId, 'sch_mcp');

  result = { content: [{ type: 'text', text: 'two' }] };
  await engine.pollNow(record);
  assert.equal(dispatched.length, 1);
  await engine.stop();
});

test('file events debounce and respect the configured kinds', async () => {
  const record = {
    id: 'sch_file',
    enabled: true,
    prompt: 'Summarize.',
    trigger: {
      type: 'file',
      config: { paths: [home], events: ['change'], debounceSeconds: 3 },
      cooldownSeconds: 0,
    },
  };
  const dispatched = [];
  const engine = createTriggerEngine({
    getSchedules: () => [record],
    getConfig: () => ({ triggers: {} }),
    mcp: { callTool: async () => null, statuses: () => [] },
    dispatch: async (entry, event) => {
      dispatched.push(event);
      return { started: true, sessionId: 's_file' };
    },
    notify: () => {},
    fileDebounceMs: 30,
  });
  await engine.start();
  const file = path.join(home, 'watched.txt');
  fs.writeFileSync(file, 'one');
  engine.handleFileEvent(record, { kind: 'change', path: file });
  engine.handleFileEvent(record, { kind: 'change', path: file });
  assert.equal(dispatched.length, 0);
  await sleep(100);
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].type, 'file');

  engine.handleFileEvent(record, { kind: 'remove', path: file });
  await sleep(100);
  assert.equal(dispatched.length, 1);
  await engine.stop();
});

test('cooldown suppresses a second dispatch', async () => {
  const record = mcpRecord();
  record.trigger.cooldownSeconds = 60;
  let result = { content: [{ type: 'text', text: 'one' }] };
  const mcp = { callTool: async () => result, statuses: () => [{ id: 'srv', connected: true, tools: ['watch'] }] };
  let count = 0;
  const engine = createTriggerEngine({
    getSchedules: () => [record],
    getConfig: () => ({ mcpServers: [{ id: 'srv', enabled: true }], triggers: {} }),
    mcp,
    dispatch: async () => {
      count += 1;
      return { started: true, sessionId: `s_${count}` };
    },
    notify: () => {},
  });
  await engine.start();
  await engine.pollNow(record);
  result = { content: [{ type: 'text', text: 'two' }] };
  await engine.pollNow(record);
  result = { content: [{ type: 'text', text: 'three' }] };
  await engine.pollNow(record);
  assert.equal(count, 1);
  await engine.stop();
});

test('startup triggers are armed once per process', async () => {
  const record = {
    id: 'sch_start',
    enabled: true,
    prompt: 'Hello.',
    trigger: { type: 'startup', config: { delaySeconds: 0 }, cooldownSeconds: 0 },
  };
  const dispatched = [];
  const engine = createTriggerEngine({
    getSchedules: () => [record],
    getConfig: () => ({ triggers: {} }),
    mcp: { callTool: async () => null, statuses: () => [] },
    dispatch: async (entry, event) => {
      dispatched.push(event);
      return { started: true, sessionId: 's_start' };
    },
    notify: () => {},
  });
  await engine.start();
  await sleep(50);
  assert.equal(dispatched.length, 1);
  record.enabled = false;
  await engine.reconcile();
  record.enabled = true;
  await engine.reconcile();
  await sleep(50);
  assert.equal(dispatched.length, 1);
  await engine.stop();
});

test('session notifications skip automation-origin sessions by default', async () => {
  const record = {
    id: 'sch_after',
    enabled: true,
    prompt: 'Follow up.',
    trigger: { type: 'session', config: { on: 'complete', includeAutomationRuns: false }, cooldownSeconds: 0 },
  };
  const dispatched = [];
  const engine = createTriggerEngine({
    getSchedules: () => [record],
    getConfig: () => ({ triggers: {} }),
    mcp: { callTool: async () => null, statuses: () => [] },
    dispatch: async (entry, event) => {
      dispatched.push(event);
      return { started: true, sessionId: 's_after' };
    },
    notify: () => {},
  });
  await engine.start();
  engine.noteAutomationSession('s_auto', { recordId: 'sch_other', chain: [] });
  await engine.notifySession({
    sessionId: 's_auto',
    session: { id: 's_auto', title: 'Auto', messages: [] },
    outcome: { ok: true, stopped: false },
  });
  assert.equal(dispatched.length, 0);
  await engine.notifySession({
    sessionId: 's_chat',
    session: { id: 's_chat', title: 'Chat', messages: [] },
    outcome: { ok: true, stopped: false },
  });
  assert.equal(dispatched.length, 1);
  await engine.stop();
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test test/trigger-engine.test.js`
Expected: FAIL with `Cannot find module '../electron/trigger-engine'`.

- [ ] **Step 3: Implement the engine**

Implementation notes:

- Do not require Electron in this file; it must be requireable from Node tests.
- `start()` loads trigger state, sets `state.started = true`, arms startup records once, starts the 15-second interval, runs `reconcile()`, and starts the webhook server if needed.
- `reconcile()` is idempotent: it closes watchers for records/paths that are gone or disabled, creates missing watchers, updates the webhook server, and leaves the startup set untouched after the first arm.
- File watcher implementation:
  - For a directory: `fs.watch(root, { recursive: true }, callback)`.
  - For a file: `fs.watch(path.dirname(file), callback)` and filter `path.join(dir, filename) === file`.
  - On callback, classify `rename` by `fs.existsSync` and `change` as change; call `handleFileEvent(record, { kind, path })`.
  - `handleFileEvent` filters `config.events`, checks enabled, debounces with `fileDebounceMs` or `debounceSeconds * 1000`, and calls the shared dispatch.
  - Keep one debounce timer per record. On fire, call dispatch with the last event and then run the shared guards.
  - On watcher error, close it, record runtime error, and retry at most every 60 seconds from the interval.
- MCP:
  - The interval checks `Date.now() - lastPollAt >= intervalSeconds * 1000`. First poll is allowed after 15 seconds.
  - `pollNow(record)` is public and used by both the interval and tests.
  - If `mcp.statuses(config)` shows the server disconnected, set runtime error and return.
  - Normalize with `require('../src/core/mcp').normalizeContent`, hash with `triggers.fingerprint`, store a baseline when none exists or `configHash` changed, and dispatch only on a changed fingerprint. Update the fingerprint only when `dispatch` returns `started: true`.
- Dispatch guards shared by all sources:
  - Add `recordId` to the event.
  - `matchesEvent` (manual bypasses).
  - Cooldown from `trigger.cooldownSeconds` and trigger state.
  - Dedupe key from `triggers.dedupeKey` and `seenRecently`.
  - Call `dispatch(record, event, { chain })`.
  - On `started: true`, call `markFired`, remember the dedupe key, and write state through a 500 ms debounce.
  - On skip, record `lastSkip` in runtime and do not update state.
- Session:
  - `noteAutomationSession` stores `{ recordId, chain }` in an in-memory Map.
  - `notifySession({ sessionId, session, outcome })` derives `status` (`ok`, `error`, or `stopped`), skips stopped, builds the event with a 1.5 KB last-assistant excerpt and up to ten file/task names, and iterates session-trigger records.
  - Skip if the origin record id equals the current record id; skip automation-origin sessions unless `includeAutomationRuns`; skip when the chain would exceed 3.
  - The chain for a dispatched session trigger is `[...origin.chain, event.sessionId]`.
- Messenger:
  - Match `provider`, `fromIncludes`, `textIncludes`; dedupe via the shared guard. The hook already provides `chatId`.
- Startup:
  - `armStartup()` iterates enabled startup records at `start()` only. Each timer re-reads the record by id and checks it is still enabled before dispatching.
- `testTrigger(draft)` only implements MCP: normalize, call tool once, return `{ ok: true, preview, hash }`; catch and return `{ ok: false, error }`.
- `status()` returns `{ webhook, automations }` with per-record state and last skip/error.
- `stop()` clears timers, closes watchers, stops the webhook server, and writes state once.
- Export `createTriggerEngine` and `createDebouncer` (for reuse/testing).

- [ ] **Step 4: Run the engine tests**

Run: `node --test test/trigger-engine.test.js`
Expected: PASS, 5 tests. If the file watcher test is flaky, keep the test but use `fileDebounceMs: 30` and the 100 ms wait.

- [ ] **Step 5: Review the diff**

Run: `git diff -- electron/trigger-engine.js test/trigger-engine.test.js`
Expected: new engine and tests. Do not commit.

---

### Task 7: Messenger incoming hook

**Files:**
- Modify: `src/core/messengers.js`
- Modify: `test/messengers.test.js`

**Interfaces:**
- Consumes: none.
- Produces: `createMessengerService({ ..., onIncoming })`; hook input `{ provider, chatId, text, label, at }`.

- [ ] **Step 1: Add failing tests**

Append to `test/messengers.test.js`:

```js
test('paired plain text notifies onIncoming before the auto-reply', async () => {
  const seen = [];
  const { handlers, calls } = makeHandlers();
  const config = memoryConfig(baseConfig({ telegram: { enabled: true, token: 'bot-token', links: {} } }));
  const service = createMessengerService({
    configModule: config,
    network: false,
    handlers,
    onIncoming: async (event) => { seen.push(event); },
  });
  test.after(() => service.dispose());
  const code = service.status().pairCode;
  await service.receive('telegram', 'chat-hook', `/pair ${code}`);
  await service.receive('telegram', 'chat-hook', 'deploy now');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].provider, 'telegram');
  assert.equal(seen[0].chatId, 'chat-hook');
  assert.equal(seen[0].text, 'deploy now');
  assert.equal(calls.send.length, 1);
});

test('onIncoming failures never block the auto-reply or fire for commands', async () => {
  const { handlers, calls } = makeHandlers();
  const config = memoryConfig(baseConfig({ telegram: { enabled: true, token: 'bot-token', links: {} } }));
  const service = createMessengerService({
    configModule: config,
    network: false,
    handlers,
    onIncoming: () => { throw new Error('hook failed'); },
  });
  test.after(() => service.dispose());
  const code = service.status().pairCode;
  await service.receive('telegram', 'chat-hook-2', `/pair ${code}`);
  const reply = await service.receive('telegram', 'chat-hook-2', 'hello');
  assert.equal(reply.reply, 'Working on it · First session');
  assert.equal(calls.send.length, 1);
  const command = await service.receive('telegram', 'chat-hook-2', '/sessions');
  assert.match(command.reply, /First session/);
  assert.equal(calls.send.length, 1);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test test/messengers.test.js`
Expected: FAIL because `onIncoming` is never called.

- [ ] **Step 3: Implement the hook**

- Read `onIncoming` from options.
- In `receive`, after the `command.name !== 'text'` early return and before `handlers.send`, wrap:
  `try { await onIncoming?.({ provider, chatId, text, label, at: new Date().toISOString() }); } catch {}`
- Do not call it for pairing, commands, unpaired chats or disabled providers.

- [ ] **Step 4: Run messenger tests**

Run: `node --test test/messengers.test.js`
Expected: PASS, including the two new tests.

- [ ] **Step 5: Review the diff**

Run: `git diff -- src/core/messengers.js test/messengers.test.js`
Expected: one hook and tests. Do not commit.

---

### Task 8: Config, preload and IPC integration

**Files:**
- Modify: `src/core/config.js`
- Modify: `electron/preload.js`
- Modify: `electron/ipc.js`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: engine wiring, `runAutomation`, redacted list/save output, new IPC channels.

- [ ] **Step 1: Add config defaults**

Add to `DEFAULTS` in `src/core/config.js`:

```js
triggers: {
  webhookPort: 47821,
  webhookAllowLan: false,
},
```

Add `'triggers'` to the `config:update` allowlist in `electron/ipc.js`.

- [ ] **Step 2: Wire the engine into `electron/ipc.js`**

- Import `triggers`, `createTriggerEngine`, `clipboard` from Electron, and `createWebhookServer` is used by the engine.
- Declare `let triggerEngine = null;` near the top of `registerIpc`, before the messenger service.
- Pass `onIncoming: (event) => triggerEngine?.notifyMessenger(event)` to `createMessengerService`.
- Rename `runSchedule` to `runAutomation` and extend its signature:
  `function runAutomation(schedule, { event = null, chain = [] } = {})`.
  - Keep the existing guard and global cap, but count only in-flight entries where `entry.triggerStarted` is true.
  - Set the in-flight entry `{ controller, sessionId: session.id, triggerStarted: Boolean(event && event.type !== 'manual') }`.
  - Build the user message content with `triggers.formatEventPrompt(schedule.trigger, event, schedule.prompt)` when an event is present.
  - Call `triggerEngine?.noteAutomationSession(session.id, { recordId: schedule.id, chain })` after `state.scheduleRuns.set`.
  - Call `schedulesModule.markRun` with `trigger: event ? { type: event.type, summary: triggers.summarizeEvent(schedule.trigger, event) } : undefined` on terminal outcomes.
  - In `.then`, call `triggerEngine?.notifySession({ sessionId: fresh.id, session: fresh, outcome })` after `notifySession(fresh)`.
  - Keep the existing notification and broadcast behavior.
- `scheduleTick` calls `runAutomation(schedule, { event: { type: 'schedule', at: new Date().toISOString() }, chain: [] })` and uses the triggered-run cap.
- Create the engine after `runAutomation` is defined:

```js
triggerEngine = createTriggerEngine({
  getSchedules: () => schedulesModule.listSchedules(),
  getConfig: () => configModule.loadConfig(),
  mcp,
  dispatch: async (record, event, meta) => runAutomation(record, { event, chain: meta.chain }),
  notify: (payload) => broadcast(payload),
});
triggerEngine.start();
```

- On shutdown (`state.disposed = true`), call `triggerEngine?.stop()` before clearing runs.
- After `schedules:save`, `schedules:delete`, webhook rotate and config update, call `triggerEngine?.reconcile()`.

- [ ] **Step 3: Redact automation output**

Add:

```js
function publicSchedule(schedule) {
  return {
    ...schedule,
    trigger: triggers.redactTrigger(schedule.trigger, schedule.id),
    running: state.scheduleRuns.has(schedule.id),
  };
}
```

Use it in `schedules:list` and `schedules:save`. Never include the full token in a broadcast. `scheduleSummary` can delegate to it.

- [ ] **Step 4: Add IPC handlers**

- `schedules:runtime` -> `triggerEngine?.status() || { webhook: {}, automations: {} }`
- `schedules:webhook-copy` -> read the record, ensure it is a webhook trigger and the server is running, build:
  `POST <origin>/hooks/<id>` newline `Authorization: Bearer <token>` newline `Content-Type: application/json`
  and write it with `clipboard.writeText`. Return `{ copied: true }`. Throw if the server is stopped.
- `schedules:webhook-rotate` -> `schedulesModule.rotateWebhookToken(input.id)`, reconcile, return `{ schedule: publicSchedule(record) }`.
- `schedules:trigger-test` -> for MCP, call `triggerEngine.testTrigger(input.trigger || existing.trigger)`; for other types, normalize and call `validateTriggerResources`; return `{ ok: true }`.
- `schedules:pick-path` -> `dialog.showOpenDialog` with `openDirectory` or `openFile`, return the first path or `''`.
- Add `schedules:runtime`, `schedules:webhook-copy`, `schedules:webhook-rotate`, `schedules:trigger-test`, `schedules:pick-path` in `electron/preload.js` under `schedules`.

- [ ] **Step 5: Add save-time resource validation**

- In `schedules:save`, build the record with `schedulesModule.buildSchedule(input)` first.
- Build MCP resource lists from `mcp.statuses(config)`.
- Call `triggers.validateTriggerResources(candidate.trigger, resources)`.
- Only then call `schedulesModule.saveSchedule(input)`.
- On validation failure, throw so the renderer shows the toast.

- [ ] **Step 6: Add the chat completion notification**

In the main `runAgent(...).then((outcome) => { ... })` block around `electron/ipc.js:1373`, after `notifySession(fresh)`:

```js
triggerEngine?.notifySession({ sessionId: fresh.id, session: fresh, outcome });
```

Do not add it to the `.catch` path; a failed run without an outcome is not a session completion event.

- [ ] **Step 7: Syntax-check and run the full test suite**

Run:

```bash
node --check electron/ipc.js
node --check electron/preload.js
node --check electron/trigger-engine.js
node --check electron/trigger-webhook.js
node --test
```

Expected: all checks exit 0; the full test suite passes (existing 136 plus new tests).

- [ ] **Step 8: Review the diff**

Run: `git diff -- src/core/config.js electron/preload.js electron/ipc.js`
Expected: engine wiring, redaction, IPC handlers. Do not commit.

---

### Task 9: Automations UI, Settings read-only list and i18n

**Files:**
- Modify: `renderer/js/views.js`
- Modify: `renderer/js/i18n.js`

**Interfaces:**
- Consumes: new preload methods and `trigger` records.
- Produces: trigger editor, runtime status cards, read-only Settings list.

- [ ] **Step 1: Add trigger type labels and editor state**

In `paintAutomations`:

- Add a trigger type selector before the schedule fields:

```html
<select class="setting-inline-input" id="automation-trigger-type">
  <option value="schedule">On a schedule</option>
  <option value="file">When a file changes</option>
  <option value="startup">When blank starts</option>
  <option value="webhook">When a webhook arrives</option>
  <option value="mcp">When an MCP result changes</option>
  <option value="messenger">When a message arrives</option>
  <option value="session">When a chat completes</option>
</select>
```

- Keep the schedule cadence/date/time/every fields in a container shown only for `schedule`.
- Add type-specific containers:
  - file: a `<textarea id="automation-file-paths">` with one path per line, a Browse button, event checkboxes, and a debounce number input.
  - startup: delay number input.
  - webhook: a status line, masked URL display, Copy and Rotate buttons, allow-query-token checkbox, port number input, allow-LAN checkbox with a warning note.
  - mcp: server `<select id="automation-mcp-server">`, tool `<select id="automation-mcp-tool">`, args `<textarea id="automation-mcp-args">`, interval number input, Test button and preview.
  - messenger: provider `<select>`, sender filter input, text filter input, and the note "The normal auto-reply still runs."
  - session: on select and include-automation-runs checkbox.
  - common: cooldown number input for non-schedule types.
- Default a new automation to `schedule`.
- On edit, use `editing.trigger.type` and `editing.trigger.config`.
- Populate MCP servers and tools from `API.mcp.list()`; tools are the selected server's `tools` array.
- Populate messenger providers from `API.messengers.status()`.
- When the type changes, show/hide containers without losing already typed values for the current edit.

- [ ] **Step 2: Build the save payload**

Replace the payload in `data-automation-save` with:

```js
const type = host.querySelector('#automation-trigger-type')?.value || 'schedule';
const trigger = { type, config: {}, cooldownSeconds: Number(host.querySelector('#automation-cooldown')?.value) || 0 };
if (type === 'schedule') {
  trigger.config = {
    cadence: cadence?.value || 'daily',
    date: host.querySelector('#automation-date')?.value || '',
    time: host.querySelector('#automation-time')?.value || '09:00',
    everyMinutes: Number(host.querySelector('#automation-every')?.value) || 30,
  };
  trigger.cooldownSeconds = 0;
} else if (type === 'file') {
  trigger.config = {
    paths: host.querySelector('#automation-file-paths').value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    events: [...host.querySelectorAll('[data-file-event]:checked')].map((input) => input.dataset.fileEvent),
    debounceSeconds: Number(host.querySelector('#automation-file-debounce').value) || 3,
  };
  trigger.cooldownSeconds = Number(host.querySelector('#automation-cooldown').value) || 60;
} else if (type === 'startup') {
  trigger.config = { delaySeconds: Number(host.querySelector('#automation-startup-delay').value) || 0 };
} else if (type === 'webhook') {
  trigger.config = { allowQueryToken: Boolean(host.querySelector('#automation-webhook-query').checked) };
  trigger.cooldownSeconds = Number(host.querySelector('#automation-cooldown').value) || 5;
} else if (type === 'mcp') {
  let args = {};
  try { args = JSON.parse(host.querySelector('#automation-mcp-args').value || '{}'); } catch {}
  trigger.config = {
    serverId: host.querySelector('#automation-mcp-server').value,
    toolName: host.querySelector('#automation-mcp-tool').value,
    args,
    intervalSeconds: Number(host.querySelector('#automation-mcp-interval').value) || 300,
  };
  trigger.cooldownSeconds = 0;
} else if (type === 'messenger') {
  trigger.config = {
    provider: host.querySelector('#automation-messenger-provider').value,
    fromIncludes: host.querySelector('#automation-messenger-from').value.trim(),
    textIncludes: host.querySelector('#automation-messenger-text').value.trim(),
  };
  trigger.cooldownSeconds = Number(host.querySelector('#automation-cooldown').value) || 10;
} else if (type === 'session') {
  trigger.config = {
    on: host.querySelector('#automation-session-on').value,
    includeAutomationRuns: Boolean(host.querySelector('#automation-session-include').checked),
  };
  trigger.cooldownSeconds = Number(host.querySelector('#automation-cooldown').value) || 30;
}

const payload = {
  id: vstate.automations.editing || undefined,
  title: host.querySelector('#automation-title')?.value.trim() || '',
  prompt: host.querySelector('#automation-prompt')?.value.trim() || '',
  trigger,
  allowTools: Boolean(host.querySelector('#automation-tools')?.checked),
};
```

- Do not send `enabled` from the editor.
- On save failure, show the error toast and re-enable the button.

- [ ] **Step 3: Add card summaries and runtime status**

- Fetch `API.schedules.runtime()` alongside `API.schedules.list()` on mount and reload.
- Add a `triggerLabel(trigger)` helper returning a short human string for each type.
- Show the trigger label before the prompt and in the meta line.
- For webhook cards, show the server status from runtime.
- For file/MCP/startup/session/messenger cards, show their runtime state and last error.
- Keep the existing running/status/history rendering.
- On webhook copy, call `API.schedules.copyWebhook(id)` and toast "Webhook URL copied."
- On rotate, confirm, call `API.schedules.rotateWebhook(id)`, toast, reload.
- On Browse, call `API.schedules.pickPath('file' or 'directory')` and append the path to the textarea.
- On MCP Test, call `API.schedules.testTrigger({ trigger })` and show the preview or error.
- On saving the webhook server port/LAN settings, call `API.config.update({ triggers: { webhookPort, webhookAllowLan } })` and reload runtime.

- [ ] **Step 4: Make Settings read-only**

In the `settings-schedules` section and handlers:

- Remove the title/cadence/date/time/prompt/tools form and `data-save-schedule`.
- Render each automation with its trigger label, enabled state, last status and next run when applicable.
- Keep `data-run-schedule` and `data-delete-schedule`.
- Add a button `data-open-automations` that calls `App.openPage('automations')`.
- Remove the save handler block; keep run and delete. Reuse the same confirm and toast behavior.

- [ ] **Step 5: Add Korean strings**

Add dictionary entries for every new visible label, placeholder, warning, status and error. At minimum:

```js
'On a schedule': '일정에 따라',
'When a file changes': '파일이 바뀌면',
'When blank starts': 'blank가 시작되면',
'When a webhook arrives': '웹훅이 오면',
'When an MCP result changes': 'MCP 도구 결과가 바뀌면',
'When a message arrives': '메시지가 오면',
'When a chat completes': '채팅이 끝나면',
'Trigger': '트리거',
'Cooldown (seconds)': '최소 실행 간격(초)',
'Watching paths': '감시 중인 경로',
'Runs at launch': '시작할 때 실행',
'Server ready on port': '서버 대기 중 · 포트',
'Server stopped': '서버 중지됨',
'Every': '주기',
'Copy URL': 'URL 복사',
'Rotate token': '토큰 재발급',
'Allow query token': '쿼리 토큰 허용',
'Allow LAN access': 'LAN 접근 허용',
'LAN access is plaintext. Use a tunnel for internet access.': 'LAN 접근은 암호화되지 않습니다. 인터넷에는 터널을 사용하세요.',
'The normal auto-reply still runs.': '기본 자동 응답은 그대로 실행됩니다.',
'Include automation runs': '자동화 실행도 포함',
'Test': '테스트',
'Webhook URL copied.': '웹훅 URL을 복사했습니다.',
'The webhook server is not running.': '웹훅 서버가 실행 중이 아닙니다.',
```

Use natural Korean in context; do not translate code identifiers.

- [ ] **Step 6: Syntax-check the renderer and run the full suite**

Run:

```bash
node --check renderer/js/views.js
node --check renderer/js/i18n.js
node --test
```

Expected: checks exit 0; tests pass.

- [ ] **Step 7: Review the diff**

Run: `git diff -- renderer/js/views.js renderer/js/i18n.js`
Expected: trigger editor, read-only Settings, translations. Do not commit.

---

### Task 10: Final verification

**Files:**
- No new files.

- [ ] **Step 1: Run the complete test suite**

Run: `node --test`
Expected: existing tests plus new trigger tests pass; record the exact pass/fail counts.

- [ ] **Step 2: Syntax-check every touched JavaScript file**

Run:

```bash
node --check src/core/triggers.js
node --check src/core/trigger-state.js
node --check src/core/schedules.js
node --check src/core/messengers.js
node --check electron/trigger-engine.js
node --check electron/trigger-webhook.js
node --check electron/ipc.js
node --check electron/preload.js
node --check renderer/js/views.js
node --check renderer/js/i18n.js
```

Expected: all exit 0.

- [ ] **Step 3: Verify secret redaction in a scripted check**

Run a Node snippet using a temporary `BLANK_HOME`:

```bash
BLANK_HOME=$(mktemp -d) node -e "
const s = require('./src/core/schedules');
const t = require('./src/core/triggers');
const record = s.saveSchedule({ title: 'hook', prompt: 'x', trigger: { type: 'webhook', config: {} } });
const token = record.trigger.config.token;
const redacted = t.redactTrigger(record.trigger, record.id);
if (JSON.stringify(redacted).includes(token)) process.exit(1);
console.log('redaction ok');
"
```

Expected: `redaction ok`.

- [ ] **Step 4: Manual desktop checks**

If an Electron display is available:

- Launch `npm start`, open Automations, create one automation of each type.
- Change a watched file; send a webhook with the copied URL and header; change an MCP result; pair a messenger chat and send a matching message; finish a chat; restart the app for startup and schedule triggers.
- Confirm disabled automations hold no watchers/server and re-enable works without restart.
- Confirm Settings shows the read-only list and links to Automations.
- Switch to English and back; confirm no missing strings.

If no display is available, state that the UI was not interactively verified and list the syntax checks and unit tests that were run.

- [ ] **Step 5: Final diff review**

Run: `git status --short` and inspect every touched file. Confirm no secrets, no `.env`, no build artifacts and no unrelated changes. Do not commit.

---

## Self-review notes

- Spec sections 5-9 are covered by Tasks 1-8; UI/i18n by Task 9; verification by Task 10.
- The spec's `redactTrigger(trigger)` signature is implemented as `redactTrigger(trigger, id)` because the hook path needs the record id; this is reflected in the tests and UI.
- Commit steps from the standard plan format are intentionally omitted because the user has not requested commits.
- The plan intentionally keeps the existing 30-second schedule tick and adds a separate 15-second engine tick, matching the spec.
- Task 6's cooldown test uses `sch_mcp_cooldown` instead of `sch_mcp` because trigger-state tests share a temporary `BLANK_HOME`; reusing the same id would inherit a fingerprint and last-fired time from an earlier test.
- Manual `schedules:run` now synthesizes `{ type: "manual", at }` before running, per spec section 9. `runAutomation` prepends the trigger block for every run, manual events stay outside the trigger-started cap, and `summarizeEvent` labels them "Manual run". A test covering the manual block was added during Task 10.
- The Electron UI was not launched interactively in this environment because `node_modules` is absent; verification consisted of syntax checks, the Node test suite and static DOM/i18n audits.
