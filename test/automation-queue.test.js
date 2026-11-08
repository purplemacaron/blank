'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createQueue, retryDelayMs } = require('../src/core/automation-queue');

test('queues events in order per record', () => {
  const queue = createQueue();
  assert.deepEqual(queue.push({ recordId: 'a', event: { n: 1 } }), { ok: true, size: 1, ahead: 0 });
  assert.deepEqual(queue.push({ recordId: 'b', event: { n: 2 } }), { ok: true, size: 2, ahead: 0 });
  assert.deepEqual(queue.push({ recordId: 'a', event: { n: 3 } }), { ok: true, size: 3, ahead: 1 });
  assert.equal(queue.size(), 3);
  assert.deepEqual(queue.shift().event, { n: 1 });
  assert.deepEqual(queue.shift().event, { n: 2 });
  assert.deepEqual(queue.shift().event, { n: 3 });
  assert.equal(queue.shift(), null);
});

test('caps the queue per record and overall', () => {
  const queue = createQueue({ maxPerRecord: 2, maxTotal: 3 });
  assert.equal(queue.push({ recordId: 'a', event: { n: 1 } }).ok, true);
  assert.equal(queue.push({ recordId: 'a', event: { n: 2 } }).ok, true);
  assert.deepEqual(queue.push({ recordId: 'a', event: { n: 3 } }), { ok: false, reason: 'record_full' });
  assert.equal(queue.push({ recordId: 'b', event: { n: 4 } }).ok, true);
  assert.deepEqual(queue.push({ recordId: 'c', event: { n: 5 } }), { ok: false, reason: 'queue_full' });
  assert.equal(queue.countFor('a'), 2);
  queue.clearRecord('a');
  assert.equal(queue.countFor('a'), 0);
  assert.equal(queue.size(), 1);
});

test('retry backoff grows and then stays capped', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 9].map(retryDelayMs), [30000, 120000, 480000, 480000, 480000, 480000]);
});
