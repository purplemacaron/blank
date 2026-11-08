'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const windows = [];

function fakeElectron() {
  const display = { workArea: { x: 0, y: 0, width: 1920, height: 1080 } };
  class FakeWindow {
    constructor(options = {}) {
      this.options = options;
      this.id = FakeWindow.nextId++;
      windows.push(this);
      this._pos = { x: options.x || 0, y: options.y || 0 };
      this._visible = false;
      this._destroyed = false;
      this._closed = null;
      this.webContents = {
        id: this.id,
        on: () => {},
        send: () => {},
        isLoading: () => false,
        executeJavaScript: () => Promise.resolve(),
      };
    }
    loadFile() {}
    on(event, handler) { if (event === 'closed') this._closed = handler; }
    isDestroyed() { return this._destroyed; }
    setIgnoreMouseEvents() {}
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    showInactive() { this._visible = true; }
    isVisible() { return this._visible; }
    getPosition() { return [this._pos.x, this._pos.y]; }
    setPosition(x, y) { this._pos = { x, y }; }
    focus() {}
    blur() {}
    isMinimized() { return false; }
    show() { this._visible = true; }
    destroy() { this._destroyed = true; if (this._closed) this._closed(); }
  }
  FakeWindow.nextId = 1;
  return {
    BrowserWindow: FakeWindow,
    screen: {
      getPrimaryDisplay: () => display,
      getAllDisplays: () => [display],
      getCursorScreenPoint: () => ({ x: 1000, y: 500 }),
      getDisplayNearestPoint: () => display,
    },
  };
}

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'electron') return fakeElectron();
  return originalLoad.call(this, request, parent, isMain);
};
const { createPet } = require('../electron/pet');
Module._load = originalLoad;

function makePet() {
  const saved = {};
  const pet = createPet({
    getConfig: () => ({ pet: { enabled: true }, defaultModel: 'vendor/model' }),
    getModels: () => ['vendor/model'],
    savePosition: (key, point) => { saved[key] = point; },
  });
  pet.sync();
  return { pet, saved };
}

test('concurrent runs get their own memo while an idle run reuses the base memo', (t) => {
  const { pet } = makePet();
  t.after(() => pet.dispose());

  pet.send({ type: 'run:start', runId: 'run_a', sessionId: 's1', model: 'vendor/model' });
  let keys = pet.keys();
  assert.equal(keys.length, 1);
  assert.equal(keys[0].kind, 'model');

  pet.send({ type: 'run:start', runId: 'run_b', sessionId: 's2', model: 'vendor/other' });
  keys = pet.keys();
  assert.equal(keys.length, 2, 'a second run opens a second memo');
  const base = keys.find((entry) => entry.kind === 'model');
  const extra = keys.find((entry) => entry.kind === 'run');
  assert.ok(base && extra);
  assert.equal(extra.model, 'vendor/other');
  assert.ok(extra.position.x < base.position.x, 'extra memos stand beside the base memo');

  pet.send({ type: 'run:done', runId: 'run_a' });
  keys = pet.keys();
  const stillBase = keys.find((entry) => entry.kind === 'model');
  assert.equal(stillBase.model, 'vendor/model', 'the finished memo keeps the model it ran');
});

test('a finished run keeps its own model on the result memo', (t) => {
  const { pet } = makePet();
  t.after(() => pet.dispose());

  pet.send({ type: 'run:start', runId: 'schedule_auto', sessionId: 's1', model: 'vendor/schedule-model' });
  assert.equal(pet.keys()[0].model, 'vendor/schedule-model');

  pet.send({ type: 'run:done', runId: 'schedule_auto', outcome: { ok: true } });
  assert.equal(pet.keys()[0].model, 'vendor/schedule-model', 'the memo does not fall back to the default model');
});

test('the run memo follows the cursor and returns when the run lets go', (t) => {
  const { pet } = makePet();
  t.after(() => pet.dispose());
  pet.send({ type: 'run:start', runId: 'run_c', model: 'vendor/model' });
  const baseKey = pet.primaryKey();
  const before = pet.position(baseKey);

  const followed = pet.followCursor('run_c');
  assert.deepEqual(followed, { x: 1026, y: 522 }, 'parked just below-right of the pointer');
  assert.deepEqual(pet.position(baseKey), followed);

  pet.followCursor('run_c');
  assert.deepEqual(pet.position(baseKey), followed, 'following is idempotent');

  assert.equal(pet.stopFollow('run_c'), true);
  assert.deepEqual(pet.position(baseKey), before, 'the memo goes back where it was');
  assert.equal(pet.stopFollow('run_c'), false);
});

test('an unknown run id never drags another memo around', (t) => {
  const { pet } = makePet();
  t.after(() => pet.dispose());
  const before = pet.position(pet.primaryKey());
  assert.equal(pet.followCursor('run_missing'), null);
  assert.deepEqual(pet.position(pet.primaryKey()), before);
  assert.equal(pet.stopFollow('run_missing'), false);
});

test('computer activity follows the pointer on the primary memo', (t) => {
  const { pet } = makePet();
  t.after(() => pet.dispose());
  const before = pet.position(pet.primaryKey());
  const followed = pet.followCursor();
  assert.deepEqual(followed, { x: 1026, y: 522 }, 'parked beside the real pointer without a run id');
  assert.deepEqual(pet.position(pet.primaryKey()), followed);
  assert.equal(pet.stopFollow(), true);
  assert.deepEqual(pet.position(pet.primaryKey()), before, 'the memo goes back where it was');
});

test('a memo exposes the session of the run it shows so follow-ups can queue', (t) => {
  const firstWindow = windows.length;
  const { pet } = makePet();
  t.after(() => pet.dispose());

  pet.send({ type: 'run:start', runId: 'run_s', sessionId: 'sess_1', model: 'vendor/model' });
  const base = windows[firstWindow];
  const baseEntry = pet.identify(base.webContents);
  assert.equal(baseEntry.runId, 'run_s');
  assert.equal(baseEntry.sessionId, 'sess_1');

  pet.send({ type: 'run:start', runId: 'run_t', sessionId: 'sess_2', model: 'vendor/model' });
  const extra = windows[firstWindow + 1];
  const extraEntry = pet.identify(extra.webContents);
  assert.equal(extraEntry.runId, 'run_t');
  assert.equal(extraEntry.sessionId, 'sess_2');

  pet.send({ type: 'run:done', runId: 'run_s' });
  assert.equal(pet.identify(base.webContents).sessionId, '', 'a finished memo no longer queues');
  assert.equal(pet.identify(extra.webContents).sessionId, 'sess_2', 'other memos keep their own run');
});
