'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { sendMode, enqueueInterrupt } = require('../src/core/turn-queue');

test('an idle session sends normally even when interrupt is requested', () => {
  assert.equal(sendMode({ running: false, interrupt: true }), 'send');
});

test('a running session with interrupt stops and sends now', () => {
  assert.equal(sendMode({ running: true, interrupt: true }), 'interrupt');
  assert.equal(sendMode({ running: true, queueIfRunning: true, interrupt: true }), 'interrupt');
});

test('a running session queues only when queueing was requested', () => {
  assert.equal(sendMode({ running: true, queueIfRunning: true }), 'queue');
  assert.equal(sendMode({ running: true }), 'reject');
});

test('an interrupt jumps ahead of messages already waiting', () => {
  const queue = [{ id: 'old-1' }, { id: 'old-2' }];
  enqueueInterrupt(queue, { id: 'now' });
  assert.deepEqual(queue.map((item) => item.id), ['now', 'old-1', 'old-2']);
});
