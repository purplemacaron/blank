'use strict';

/**
 * Bounded FIFO for automation events that arrive while the trigger worker
 * pool is full. Events are deferred instead of dropped, and failed runs
 * retry with a growing backoff.
 */

const RETRY_DELAYS_MS = [30_000, 120_000, 480_000];
const DEFAULT_MAX_TOTAL = 40;
const DEFAULT_MAX_PER_RECORD = 4;

function retryDelayMs(attempt) {
  const index = Math.max(0, Math.min(RETRY_DELAYS_MS.length - 1, Math.floor(Number(attempt) || 0)));
  return RETRY_DELAYS_MS[index];
}

function createQueue({ maxTotal = DEFAULT_MAX_TOTAL, maxPerRecord = DEFAULT_MAX_PER_RECORD } = {}) {
  const items = [];
  const countFor = (recordId) => items.filter((item) => item.recordId === recordId).length;

  return {
    push(item) {
      if (!item || !item.recordId) return { ok: false, reason: 'invalid' };
      if (items.length >= maxTotal) return { ok: false, reason: 'queue_full' };
      if (countFor(item.recordId) >= maxPerRecord) return { ok: false, reason: 'record_full' };
      items.push({ ...item, queuedAt: item.queuedAt || new Date().toISOString() });
      return { ok: true, size: items.length, ahead: countFor(item.recordId) - 1 };
    },
    shift() {
      return items.shift() || null;
    },
    peek() {
      return items.length ? { ...items[0] } : null;
    },
    size() {
      return items.length;
    },
    countFor,
    clearRecord(recordId) {
      for (let index = items.length - 1; index >= 0; index -= 1) {
        if (items[index].recordId === recordId) items.splice(index, 1);
      }
    },
    clear() {
      items.length = 0;
    },
  };
}

module.exports = { createQueue, retryDelayMs, RETRY_DELAYS_MS };
