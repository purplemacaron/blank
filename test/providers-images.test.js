'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const providers = require('../src/core/providers');

const shot = { mime: 'image/jpeg', data: 'aGVsbG8=' };

test('openai user content attaches images as data URLs', () => {
  const content = providers.openaiUserContent({ role: 'user', content: 'Look here', images: [shot] });
  assert.deepEqual(content, [
    { type: 'text', text: 'Look here' },
    { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,aGVsbG8=' } },
  ]);
});

test('anthropic user content uses base64 image blocks', () => {
  const content = providers.anthropicUserContent({ role: 'user', content: 'Look', images: [shot] });
  assert.deepEqual(content, [
    { type: 'text', text: 'Look' },
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'aGVsbG8=' } },
  ]);
});

test('gemini user parts use inlineData', () => {
  const parts = providers.geminiUserParts({ role: 'user', content: 'Look', images: [shot] });
  assert.deepEqual(parts, [
    { text: 'Look' },
    { inlineData: { mimeType: 'image/jpeg', data: 'aGVsbG8=' } },
  ]);
});

test('messages without images stay plain strings', () => {
  const message = { role: 'user', content: 'Just text' };
  assert.equal(providers.openaiUserContent(message), 'Just text');
  assert.equal(providers.anthropicUserContent(message), 'Just text');
  assert.deepEqual(providers.geminiUserParts(message), [{ text: 'Just text' }]);
});

test('images without data are ignored', () => {
  const message = { role: 'user', content: 'Text', images: [{ mime: 'image/png' }, null] };
  assert.equal(providers.openaiUserContent(message), 'Text');
});
