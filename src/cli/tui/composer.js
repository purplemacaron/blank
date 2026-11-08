'use strict';

const { completeLine } = require('../support');

function lineStart(text, index) {
  return text.lastIndexOf('\n', Math.max(0, index - 1)) + 1;
}

function lineEnd(text, index) {
  const found = text.indexOf('\n', index);
  return found === -1 ? text.length : found;
}

function prevBoundary(text, index) {
  if (index <= 0) return 0;
  let next = index - 1;
  const code = text.charCodeAt(next);
  if (code >= 0xdc00 && code <= 0xdfff && next > 0) next -= 1;
  return next;
}

function nextBoundary(text, index) {
  if (index >= text.length) return text.length;
  const code = text.codePointAt(index);
  return index + (code > 0xffff ? 2 : 1);
}

function createComposer({ historySize = 200 } = {}) {
  let text = '';
  let cursor = 0;
  let history = [];
  let historyIndex = -1;
  let draft = '';

  const moveTo = (index) => { cursor = Math.max(0, Math.min(text.length, index)); };

  return {
    get text() { return text; },
    get cursor() { return cursor; },
    get history() { return history.slice(); },

    insert(value) {
      const chunk = String(value ?? '').replace(/\r\n?/g, '\n');
      text = text.slice(0, cursor) + chunk + text.slice(cursor);
      cursor += chunk.length;
    },

    newline() { this.insert('\n'); },

    backspace() {
      if (cursor === 0) return;
      const start = prevBoundary(text, cursor);
      text = text.slice(0, start) + text.slice(cursor);
      cursor = start;
    },

    deleteForward() {
      if (cursor >= text.length) return;
      const end = nextBoundary(text, cursor);
      text = text.slice(0, cursor) + text.slice(end);
    },

    left() { moveTo(prevBoundary(text, cursor)); },
    right() { moveTo(nextBoundary(text, cursor)); },
    home() { moveTo(lineStart(text, cursor)); },
    end() { moveTo(lineEnd(text, cursor)); },

    up() {
      const start = lineStart(text, cursor);
      if (start === 0) return false;
      const column = cursor - start;
      const prevStart = lineStart(text, start - 1);
      const prevEnd = start - 1;
      moveTo(Math.min(prevStart + column, prevEnd));
      return true;
    },

    down() {
      const end = lineEnd(text, cursor);
      if (end >= text.length) return false;
      const column = cursor - lineStart(text, cursor);
      const nextStart = end + 1;
      const nextEnd = lineEnd(text, nextStart);
      moveTo(Math.min(nextStart + column, nextEnd));
      return true;
    },

    clear() {
      text = '';
      cursor = 0;
      historyIndex = -1;
      draft = '';
    },

    remember(value) {
      const entry = String(value ?? '').trim();
      if (!entry) return;
      if (history[history.length - 1] === entry) { historyIndex = -1; return; }
      history.push(entry);
      while (history.length > historySize) history.shift();
      historyIndex = -1;
      draft = '';
    },

    historyPrev() {
      if (!history.length) return false;
      if (historyIndex === -1) {
        draft = text;
        historyIndex = history.length - 1;
      } else if (historyIndex > 0) {
        historyIndex -= 1;
      }
      text = history[historyIndex];
      cursor = text.length;
      return true;
    },

    historyNext() {
      if (historyIndex === -1) return false;
      if (historyIndex < history.length - 1) {
        historyIndex += 1;
        text = history[historyIndex];
      } else {
        historyIndex = -1;
        text = draft;
      }
      cursor = text.length;
      return true;
    },

    completions(models = []) {
      const [hits] = completeLine(text, { models });
      return hits;
    },

    lines() { return text.split('\n'); },
  };
}

module.exports = { createComposer };
