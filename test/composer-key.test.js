'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const ComposerKey = require('../renderer/js/composer-key.js');

const ev = (over = {}) => ({
  key: '', code: '', keyCode: 0, ctrlKey: false, metaKey: false, shiftKey: false, isComposing: false,
  ...over,
});

test('plain Enter sends or stops', () => {
  assert.equal(ComposerKey.action(ev({ key: 'Enter', code: 'Enter', keyCode: 13 })), 'send-or-stop');
});

test('Shift+Enter is a newline, not a send', () => {
  assert.equal(ComposerKey.action(ev({ key: 'Enter', code: 'Enter', keyCode: 13, shiftKey: true })), 'none');
});

test('Ctrl+Enter sends now', () => {
  assert.equal(ComposerKey.action(ev({ key: 'Enter', code: 'Enter', keyCode: 13, ctrlKey: true })), 'send-now');
});

test('Meta+Enter sends now', () => {
  assert.equal(ComposerKey.action(ev({ key: 'Enter', code: 'Enter', keyCode: 13, metaKey: true })), 'send-now');
});

test('Ctrl+NumpadEnter sends now', () => {
  assert.equal(ComposerKey.action(ev({ key: 'Enter', code: 'NumpadEnter', keyCode: 13, ctrlKey: true })), 'send-now');
});

test('Korean IME Process/229 with Enter code and Ctrl sends now', () => {
  assert.equal(ComposerKey.action(ev({ key: 'Process', code: 'Enter', keyCode: 229, ctrlKey: true })), 'send-now');
});

test('IME-shaped Enter (key Enter, keyCode 229) with Ctrl sends now', () => {
  assert.equal(ComposerKey.action(ev({ key: 'Enter', code: 'Enter', keyCode: 229, ctrlKey: true, isComposing: true })), 'send-now');
});

test('IME commit Enter without Ctrl never sends', () => {
  assert.equal(ComposerKey.action(ev({ key: 'Enter', code: 'Enter', keyCode: 229, isComposing: true })), 'none');
  assert.equal(ComposerKey.action(ev({ key: 'Process', code: 'Enter', keyCode: 229 })), 'none');
  assert.equal(ComposerKey.action(ev({ key: 'Enter', code: 'Enter', keyCode: 13, isComposing: true })), 'none');
});

test('Ctrl with a non-Enter key is ignored', () => {
  assert.equal(ComposerKey.action(ev({ key: 'a', code: 'KeyA', keyCode: 65, ctrlKey: true })), 'none');
  assert.equal(ComposerKey.action(ev({ key: 'Process', code: 'KeyA', keyCode: 229, ctrlKey: true })), 'none');
});

test('ambiguous IME Process without a physical Enter code is ignored', () => {
  assert.equal(ComposerKey.action(ev({ key: 'Process', code: '', keyCode: 229, ctrlKey: true })), 'none');
});

test('unrelated keys are ignored', () => {
  assert.equal(ComposerKey.action(ev({ key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 })), 'none');
});