'use strict';

/* Keeps a bounded tail of a streaming reply for the small memo bubble. */

const MAX_BUFFER = 4000;
const MAX_PREVIEW = 90;

function appendStream(buffer, delta, max = MAX_BUFFER) {
  return (String(buffer || '') + String(delta || '')).slice(-Math.max(1, max));
}

function previewStream(value, max = MAX_PREVIEW) {
  const text = String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/```[\w+.#-]*\s*/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  let tail = text.slice(-max);
  const space = tail.indexOf(' ');
  if (space > 0 && space < max * 0.35) tail = tail.slice(space + 1);
  return `…${tail}`;
}

module.exports = { appendStream, previewStream, MAX_BUFFER, MAX_PREVIEW };
