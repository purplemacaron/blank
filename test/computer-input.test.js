'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const computer = require('../src/core/computer');

test('win combos map to virtual-key codes in press order', () => {
  assert.deepEqual(computer.vkCombo('r', ['win']), [0x5B, 0x52]);
  assert.deepEqual(computer.vkCombo('e', ['ctrl', 'win']), [0x11, 0x5B, 0x45]);
  assert.deepEqual(computer.vkCombo('F4', ['win']), [0x5B, 0x73]);
});

test('combos without the win key fall back to SendKeys', () => {
  assert.equal(computer.vkCombo('a', ['ctrl']), null);
  assert.equal(computer.vkCombo('tab', ['alt']), null);
  assert.equal(computer.vkCombo('enter', []), null);
  assert.deepEqual(computer.vkCombo('win', []), [0x5B]);
  assert.throws(() => computer.vkCombo('nope?', ['win']), /Unsupported key/);
});

test('launch normalizes its target and timeout', () => {
  assert.deepEqual(computer.normalizeArgs('launch', { target: '  notepad  ' }), {
    action: 'launch',
    target: 'notepad',
    ms: 4000,
  });
  assert.equal(computer.normalizeArgs('launch', { target: 'calc', ms: 60000 }).ms, 10000);
  assert.throws(() => computer.normalizeArgs('launch', {}), /App name or path is required/);
  assert.throws(() => computer.normalizeArgs('launch', { target: 'x'.repeat(300) }), /too long/);
});

test('known Windows apps resolve to system paths instead of PATH shims', () => {
  if (process.platform !== 'win32') return;
  assert.match(computer.resolveLaunchTarget('notepad'), /System32[\\/]notepad\.exe$/i);
  assert.match(computer.resolveLaunchTarget('메모장'), /System32[\\/]notepad\.exe$/i);
  assert.equal(computer.resolveLaunchTarget('설정'), 'ms-settings:');
  assert.equal(computer.resolveLaunchTarget('C:\\Tools\\custom.exe'), 'C:\\Tools\\custom.exe');
});

test('key actions accept the win modifier', () => {
  assert.deepEqual(computer.normalizeArgs('key', { key: 'e', modifiers: ['win'] }), {
    action: 'key',
    key: 'e',
    modifiers: ['win'],
  });
});

test('window search terms pair English app names with Korean titles', () => {
  assert.deepEqual(computer.windowSearchTerms('KakaoTalk'), ['KakaoTalk', '카카오톡']);
  assert.deepEqual(computer.windowSearchTerms('카카오톡'), ['카카오톡', 'kakaotalk']);
  assert.deepEqual(computer.windowSearchTerms('notepad.exe'), ['notepad', '메모장']);
  assert.deepEqual(computer.windowSearchTerms('Kakao'), ['Kakao']);
  assert.deepEqual(computer.windowSearchTerms('   '), []);
});

test('focus and close accept app names as well as window titles', () => {
  const focus = computer.normalizeArgs('focus', { title: ' KakaoTalk ' });
  assert.equal(focus.title, 'KakaoTalk');
  assert.deepEqual(focus.needles, ['KakaoTalk', '카카오톡']);

  const close = computer.normalizeArgs('close', { title: '메모장' });
  assert.deepEqual(close.needles, ['메모장', 'notepad']);

  assert.throws(() => computer.normalizeArgs('close', {}), /required/i);
  assert.throws(() => computer.normalizeArgs('focus', { title: 'x'.repeat(130) }), /too long/);
});
