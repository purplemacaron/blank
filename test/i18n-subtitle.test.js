const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'js', 'i18n.js'), 'utf8');

function extractPatterns(name) {
  const marker = `const ${name} = [`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${name} array exists`);
  const end = source.indexOf('];', start);
  assert.ok(end > start, `${name} array closes`);
  return eval(source.slice(start + marker.length - 1, end + 1));
}

function lookup(key, patterns) {
  for (const [re, replacement] of patterns) {
    if (re.test(key)) return key.replace(re, replacement);
  }
  return null;
}

const PATTERNS = extractPatterns('PATTERNS');
const ATTR_PATTERNS = extractPatterns('ATTR_PATTERNS');

test('session subtitle translates singular message counts', () => {
  assert.equal(lookup('1 message', PATTERNS), '메시지 1개');
  assert.equal(lookup('1 message · Agent', PATTERNS), '메시지 1개 · 에이전트');
  assert.equal(lookup('1 message · Research', PATTERNS), '메시지 1개 · 리서치');
  assert.equal(lookup('21 messages · Research', PATTERNS), '메시지 21개 · 리서치');
});

test('session subtitle translates the compacted suffix', () => {
  assert.equal(lookup('1 message · Context compacted', PATTERNS), '메시지 1개 · 컨텍스트 압축됨');
  assert.equal(lookup('13 messages · Agent · Context compacted', PATTERNS), '메시지 13개 · 에이전트 · 컨텍스트 압축됨');
  assert.equal(lookup('21 messages · Research · Context compacted', PATTERNS), '메시지 21개 · 리서치 · 컨텍스트 압축됨');
});

test('session subtitle title attributes translate singular and compacted forms', () => {
  assert.equal(lookup('1 message · Agent', ATTR_PATTERNS), '메시지 1개 · 에이전트');
  assert.equal(lookup('2026-11-08 · 1 message', ATTR_PATTERNS), '2026-11-08 · 메시지 1개');
});

test('translated subtitles never match again (observer loop guard)', () => {
  for (const output of ['메시지 1개', '메시지 1개 · 에이전트', '메시지 21개 · 리서치', '메시지 13개 · 에이전트 · 컨텍스트 압축됨']) {
    assert.equal(lookup(output, PATTERNS), null);
    assert.equal(lookup(output, ATTR_PATTERNS), null);
  }
});

test('attachment toasts translate the file name and never match again', () => {
  assert.equal(lookup('notes.md is too large (over 160 KB).', PATTERNS), 'notes.md 파일이 너무 큽니다(160 KB 초과).');
  assert.equal(lookup('photo.pdf is not a text file.', PATTERNS), 'photo.pdf 파일은 텍스트 파일이 아닙니다.');
  assert.equal(lookup('Could not read notes.md.', PATTERNS), 'notes.md 파일을 읽지 못했습니다.');
  for (const output of [
    'notes.md 파일이 너무 큽니다(160 KB 초과).',
    'photo.pdf 파일은 텍스트 파일이 아닙니다.',
    'notes.md 파일을 읽지 못했습니다.',
  ]) {
    assert.equal(lookup(output, PATTERNS), null);
  }
});