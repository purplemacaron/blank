'use strict';

/* Decides what to do with a message aimed at a session that may be running. */
function sendMode({ running = false, queueIfRunning = false, interrupt = false } = {}) {
  if (!running) return 'send';
  if (interrupt) return 'interrupt';
  return queueIfRunning ? 'queue' : 'reject';
}

function enqueueInterrupt(queue, item) {
  queue.unshift(item);
  return queue;
}

module.exports = { sendMode, enqueueInterrupt };
