'use strict';

const { uid } = require('./paths');

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_OPTIONS = 6;
const MAX_CUSTOM = 2000;

/**
 * Tracks choice questions that an agent asked the user. Each question pauses
 * the run until it is answered, cancelled or times out.
 */
function createQuestionBroker({ onEvent = () => {}, timeoutMs = DEFAULT_TIMEOUT_MS, makeId = () => uid('q_') } = {}) {
  const pending = new Map();

  function ask(request = {}, meta = {}) {
    const questionId = makeId();
    const entry = {
      questionId,
      sessionId: meta.sessionId || '',
      runId: meta.runId || '',
      win: meta.win || null,
      question: String(request.question || '').trim(),
      options: (Array.isArray(request.options) ? request.options : [])
        .map((option) => String(option || '').trim())
        .filter(Boolean)
        .slice(0, MAX_OPTIONS),
      multiple: Boolean(request.multiple),
    };
    return new Promise((resolve) => {
      entry.resolve = resolve;
      entry.timer = setTimeout(() => {
        pending.delete(questionId);
        onEvent({ type: 'question:expired', questionId, sessionId: entry.sessionId, runId: entry.runId, reason: 'timeout' });
        resolve({ cancelled: true });
      }, timeoutMs);
      pending.set(questionId, entry);
      onEvent({
        type: 'question',
        questionId,
        sessionId: entry.sessionId,
        runId: entry.runId,
        question: entry.question,
        options: entry.options,
        multiple: entry.multiple,
      });
    });
  }

  function answer(questionId, input = {}) {
    const entry = pending.get(questionId);
    if (!entry) return { ok: false, error: 'This question is no longer waiting for an answer.' };

    const wanted = Array.isArray(input.selected) ? input.selected.map((label) => String(label)) : [];
    let selected = [...new Set(wanted.filter((label) => entry.options.includes(label)))];
    if (!entry.multiple) selected = selected.slice(0, 1);
    const custom = typeof input.custom === 'string' ? input.custom.trim().slice(0, MAX_CUSTOM) : '';
    if (!selected.length && !custom) return { ok: false, error: 'Choose an option or type an answer.' };

    clearTimeout(entry.timer);
    pending.delete(questionId);
    entry.resolve({ selected, custom });
    onEvent({
      type: 'question:resolved',
      questionId,
      sessionId: entry.sessionId,
      runId: entry.runId,
      selected,
      custom,
    });
    return { ok: true, selected, custom };
  }

  function cancel(predicate, reason = 'expired') {
    let count = 0;
    for (const [questionId, entry] of pending.entries()) {
      if (predicate && !predicate(entry)) continue;
      clearTimeout(entry.timer);
      pending.delete(questionId);
      entry.resolve({ cancelled: true });
      onEvent({
        type: 'question:expired',
        questionId,
        sessionId: entry.sessionId,
        runId: entry.runId,
        reason,
      });
      count += 1;
    }
    return count;
  }

  function list(predicate) {
    return [...pending.values()]
      .filter((entry) => (predicate ? predicate(entry) : true))
      .map((entry) => ({
        questionId: entry.questionId,
        sessionId: entry.sessionId,
        runId: entry.runId,
        question: entry.question,
        options: entry.options,
        multiple: entry.multiple,
      }));
  }

  return { ask, answer, cancel, list };
}

module.exports = { createQuestionBroker };
