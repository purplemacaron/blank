'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeProviderKeys,
  normalizeMediaDefaults,
  normalizeModelDefaults,
  keyCandidates,
  addProviderKey,
  removeProviderKey,
  setActiveProviderKey,
  resolveKey,
  maskKey,
  resolveLanguage,
  publicConfig,
  deepMerge,
  DEFAULTS,
} = require('../src/core/config');

function blankConfig() {
  return { providers: {} };
}

test('legacy apiKey migrates into a key entry', () => {
  const config = { providers: { anthropic: { apiKey: 'sk-ant-legacy' } } };
  const changed = normalizeProviderKeys(config);
  const entry = config.providers.anthropic;
  assert.equal(changed, true);
  assert.equal(entry.apiKey, undefined);
  assert.equal(entry.keys.length, 1);
  assert.equal(entry.keys[0].key, 'sk-ant-legacy');
  assert.equal(entry.activeKeyId, entry.keys[0].id);
  assert.equal(entry.autoRotate, true);
});

test('active key sorts first and explicit key id wins', () => {
  const config = blankConfig();
  const first = addProviderKey(config, 'openai', { key: 'sk-first' });
  const second = addProviderKey(config, 'openai', { key: 'sk-second' });
  assert.equal(config.providers.openai.activeKeyId, second.id);

  const ordered = keyCandidates(config, 'openai', {});
  assert.equal(ordered[0].id, second.id);
  assert.equal(resolveKey(config, 'openai', {}), 'sk-second');
  assert.equal(resolveKey(config, 'openai', {}, first.id), 'sk-first');
});

test('duplicate keys are reused, not duplicated', () => {
  const config = blankConfig();
  const first = addProviderKey(config, 'openai', { key: 'sk-same' });
  addProviderKey(config, 'openai', { key: 'sk-other' });
  const again = addProviderKey(config, 'openai', { key: 'sk-same' });
  assert.equal(again.id, first.id);
  assert.equal(config.providers.openai.keys.length, 2);
  assert.equal(config.providers.openai.activeKeyId, first.id);
});

test('removing the active key promotes the next key', () => {
  const config = blankConfig();
  const first = addProviderKey(config, 'openai', { key: 'sk-a' });
  const second = addProviderKey(config, 'openai', { key: 'sk-b' });
  assert.equal(removeProviderKey(config, 'openai', second.id), true);
  assert.equal(config.providers.openai.activeKeyId, first.id);
  assert.equal(removeProviderKey(config, 'openai', second.id), false);
  assert.throws(() => setActiveProviderKey(config, 'openai', second.id), /not found/i);
});

test('environment keys are a fallback after stored keys', () => {
  process.env.BLANK_TEST_PROVIDER_KEY = 'sk-env';
  try {
    const config = blankConfig();
    addProviderKey(config, 'demo', { key: 'sk-stored' });
    const candidates = keyCandidates(config, 'demo', { keyEnv: 'BLANK_TEST_PROVIDER_KEY' });
    assert.equal(candidates.length, 2);
    assert.equal(candidates[0].source, 'stored');
    assert.equal(candidates[1].source, 'env');
  } finally {
    delete process.env.BLANK_TEST_PROVIDER_KEY;
  }
});

test('maskKey keeps only the edges visible', () => {
  assert.equal(maskKey(''), '');
  assert.equal(maskKey('short'), '••••');
  assert.equal(maskKey('sk-1234567890abcdef'), 'sk-1…cdef');
});

test('retired Blank media engines migrate to real engines only', () => {
  const config = {
    providers: {},
    media: {
      defaults: {
        image: { engine: 'blank', aspect: '4:3' },
        video: { engine: 'blank-image', aspect: '16:9', duration: 6, fps: 24, soundtrack: true },
        audio: { engine: 'blank-voice', duration: 12, style: 'auto', quality: 'medium' },
        model3d: { engine: 'blank-3d', quality: 'high' },
      },
    },
  };
  assert.equal(normalizeMediaDefaults(config), true);
  assert.deepEqual(config.media.defaults.image, { engine: '', aspect: '4:3' });
  assert.deepEqual(config.media.defaults.video, { engine: '', aspect: '16:9', duration: 6 });
  assert.deepEqual(config.media.defaults.audio, { engine: 'system-voice', duration: 12 });
  assert.deepEqual(config.media.defaults.model3d, { engine: '' });
  assert.equal(normalizeMediaDefaults(config), false);
});

test('retired preview model migrates to no model', () => {
  const config = { providers: {}, defaultModel: 'sandbox/blank-1', fallbackModel: 'blank-1' };
  assert.equal(normalizeModelDefaults(config), true);
  assert.equal(config.defaultModel, '');
  assert.equal(config.fallbackModel, '');
  config.defaultModel = 'openai/gpt-5';
  assert.equal(normalizeModelDefaults(config), false);
  assert.equal(config.defaultModel, 'openai/gpt-5');
});

test('memo instructions share the screen by default and can be turned off', () => {
  assert.equal(DEFAULTS.pet.shareScreen, true);
  const config = deepMerge(structuredClone(DEFAULTS), { providers: {} });
  assert.equal(publicConfig(config, { allProviders: () => [] }).pet.shareScreen, true);
  config.pet.shareScreen = false;
  assert.equal(publicConfig(config, { allProviders: () => [] }).pet.shareScreen, false);
});

test('the interface follows the system language until the user chooses one', () => {
  assert.equal(DEFAULTS.language, 'auto');
  assert.equal(resolveLanguage('ko', 'en-US'), 'ko');
  assert.equal(resolveLanguage('en', 'ko-KR'), 'en');
  assert.equal(resolveLanguage('auto', 'ko-KR'), 'ko');
  assert.equal(resolveLanguage('auto', 'en-US'), 'en');
  assert.equal(resolveLanguage(undefined, 'ko'), 'ko');
  assert.equal(resolveLanguage('', 'zh-CN'), 'en');
  assert.equal(resolveLanguage('auto', ''), 'en');
});
