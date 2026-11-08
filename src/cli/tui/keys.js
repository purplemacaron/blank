'use strict';

const CSI_FINAL = (code) => code >= 0x40 && code <= 0x7e;

function modifiers(value) {
  const mod = Number(value) || 0;
  return {
    shift: mod === 2 || mod === 4 || mod === 6 || mod === 8,
    alt: mod === 3 || mod === 4 || mod === 7 || mod === 8,
    ctrl: mod === 5 || mod === 6 || mod === 7 || mod === 8,
  };
}

function sequenceEvent(seq, final) {
  const params = seq ? seq.split(';') : [];
  const mod = params.length > 1 ? params[params.length - 1] : '';
  const named = { A: 'up', B: 'down', C: 'right', D: 'left', H: 'home', F: 'end' }[final];
  if (named) {
    if (!mod) return { name: named };
    return { name: named, ...modifiers(mod) };
  }
  if (final === 'Z') return { name: 'tab', shift: true };
  if (final === '~') {
    const code = Number(params[0]);
    const map = { 1: 'home', 7: 'home', 4: 'end', 8: 'end', 3: 'delete', 5: 'pgup', 6: 'pgdown' };
    if (map[code]) return { name: map[code] };
  }
  return { name: 'unknown', sequence: `\u001b[${seq}${final}` };
}

function parseEscape(buffer) {
  if (buffer.length < 2) return null;
  const next = buffer[1];
  if (next === '[') {
    if (buffer.startsWith('\u001b[200~')) {
      const end = buffer.indexOf('\u001b[201~', 6);
      if (end === -1) return null;
      return { consumed: end + 6, event: { name: 'paste', text: buffer.slice(6, end) } };
    }
    for (let i = 2; i < buffer.length; i += 1) {
      if (CSI_FINAL(buffer.charCodeAt(i))) {
        const seq = buffer.slice(2, i);
        if (buffer[i] === 'I' || buffer[i] === 'O') return { consumed: i + 1 };
        const event = sequenceEvent(seq, buffer[i]);
        return { consumed: i + 1, event };
      }
    }
    return null;
  }
  if (next === 'O') {
    if (buffer.length < 3) return null;
    const event = sequenceEvent('', buffer[2]);
    return event.name === 'unknown' ? { consumed: 3 } : { consumed: 3, event };
  }
  if (next === '\r' || next === '\n') return { consumed: 2, event: { name: 'enter', alt: true } };
  const code = next.charCodeAt(0);
  if (code >= 32 && code !== 127) {
    return { consumed: 2, event: { name: next.toLowerCase(), alt: true } };
  }
  return { consumed: 2 };
}

function controlEvent(char) {
  const code = char.charCodeAt(0);
  if (char === '\r') return { name: 'enter', alt: false };
  if (char === '\n') return { name: 'newline', ctrl: true };
  if (char === '\t') return { name: 'tab', shift: false };
  if (char === '\u007f' || char === '\b') return { name: 'backspace' };
  if (code >= 1 && code <= 26) return { name: String.fromCharCode(code + 96), ctrl: true };
  return null;
}

function isControl(char) {
  const code = char.charCodeAt(0);
  return code < 32 || code === 127;
}

function createKeyParser() {
  let buffer = '';
  let pendingEscape = null;

  function drain(force = false) {
    const events = [];
    for (;;) {
      if (!buffer) break;
      const first = buffer[0];
      if (first === '\u001b') {
        const parsed = parseEscape(buffer);
        if (!parsed) {
          if (force) {
            events.push({ name: 'escape' });
            buffer = buffer.slice(1);
            continue;
          }
          break;
        }
        if (parsed.event) events.push(parsed.event);
        buffer = buffer.slice(parsed.consumed);
        pendingEscape = null;
        continue;
      }
      if (isControl(first)) {
        const event = controlEvent(first);
        if (event) events.push(event);
        buffer = buffer.slice(1);
        continue;
      }
      let end = 1;
      while (end < buffer.length && !isControl(buffer[end]) && buffer[end] !== '\u001b') end += 1;
      events.push({ name: 'text', text: buffer.slice(0, end) });
      buffer = buffer.slice(end);
    }
    return events;
  }

  return {
    feed(chunk) {
      buffer += String(chunk ?? '');
      if (buffer === '\u001b') {
        if (pendingEscape) clearTimeout(pendingEscape);
        pendingEscape = null;
      }
      return drain();
    },
    flush() {
      const events = drain(true);
      if (buffer) {
        events.push({ name: 'text', text: buffer });
        buffer = '';
      }
      return events;
    },
    pending() { return buffer; },
  };
}

module.exports = { createKeyParser };
