'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { withScreenshotImage } = require('../src/core/agent');

function tempShot(bytes = 'fake-jpeg') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blank-shot-'));
  const file = path.join(dir, 'shot.jpg');
  fs.writeFileSync(file, bytes);
  return { dir, file };
}

const toolMessage = (modelPath) => ({
  role: 'tool',
  toolCallId: 'call_1',
  name: 'computer_screenshot',
  content: 'Screenshot saved',
  meta: { screenshot: { path: modelPath, modelPath, mime: 'image/jpeg' } },
});

const memoMessage = (modelPath) => ({
  role: 'user',
  content: 'What should I click here?',
  meta: { screenshot: { path: modelPath, modelPath, mime: 'image/jpeg', source: 'memo' } },
});

test('a fresh screenshot is attached after the trailing tool block', (t) => {
  const shot = tempShot();
  t.after(() => fs.rmSync(shot.dir, { recursive: true, force: true }));
  const messages = [
    { role: 'user', content: 'Open the calculator' },
    toolMessage(shot.file),
    { role: 'tool', toolCallId: 'call_2', name: 'computer_use', content: 'click complete', meta: {} },
  ];
  const withImage = withScreenshotImage(messages, true);
  assert.equal(withImage.length, 4);
  assert.deepEqual(withImage[3].images, [{ mime: 'image/jpeg', data: Buffer.from('fake-jpeg').toString('base64') }]);
  assert.equal(withImage[3].role, 'user');
  assert.equal(messages.length, 3, 'input stays untouched');
});

test('text-only models never receive image payloads', (t) => {
  const shot = tempShot();
  t.after(() => fs.rmSync(shot.dir, { recursive: true, force: true }));
  const messages = [toolMessage(shot.file)];
  assert.equal(withScreenshotImage(messages, false), messages);
});

test('a screenshot from an earlier step is not re-attached', (t) => {
  const shot = tempShot();
  t.after(() => fs.rmSync(shot.dir, { recursive: true, force: true }));
  const messages = [
    toolMessage(shot.file),
    { role: 'assistant', content: 'The calculator is open.', toolCalls: [] },
    { role: 'tool', toolCallId: 'call_3', name: 'run_command', content: 'ok', meta: {} },
  ];
  assert.equal(withScreenshotImage(messages, true), messages);
});

test('a missing screenshot file is skipped safely', () => {
  const messages = [toolMessage(path.join(os.tmpdir(), 'blank-does-not-exist.jpg'))];
  assert.equal(withScreenshotImage(messages, true), messages);
});

test('a memo instruction carries its screenshot on the user message', (t) => {
  const shot = tempShot();
  t.after(() => fs.rmSync(shot.dir, { recursive: true, force: true }));
  const messages = [memoMessage(shot.file)];
  const withImage = withScreenshotImage(messages, true);
  assert.equal(withImage.length, 1);
  assert.equal(withImage[0].role, 'user');
  assert.equal(withImage[0].content, 'What should I click here?');
  assert.deepEqual(withImage[0].images, [{ mime: 'image/jpeg', data: Buffer.from('fake-jpeg').toString('base64') }]);
  assert.equal(messages[0].images, undefined, 'input stays untouched');
});

test('a memo screenshot is not attached to later turns', (t) => {
  const shot = tempShot();
  t.after(() => fs.rmSync(shot.dir, { recursive: true, force: true }));
  const messages = [
    memoMessage(shot.file),
    { role: 'assistant', content: 'Click the blue button.', toolCalls: [] },
  ];
  assert.equal(withScreenshotImage(messages, true), messages);
});
