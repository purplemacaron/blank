'use strict';

const test = require('node:test');
const assert = require('node:assert');

const cloud = require('../src/core/media/cloud');

test('compat base URLs gain /v1 exactly once', () => {
  assert.equal(cloud.normalizeCompatBase('https://integrate.api.nvidia.com/v1'), 'https://integrate.api.nvidia.com/v1');
  assert.equal(cloud.normalizeCompatBase('https://integrate.api.nvidia.com/'), 'https://integrate.api.nvidia.com/v1');
  assert.equal(cloud.normalizeCompatBase('http://127.0.0.1:8000/v1/'), 'http://127.0.0.1:8000/v1');
  assert.equal(cloud.normalizeCompatBase('ftp://example.com'), '');
  assert.equal(cloud.normalizeCompatBase('not a url'), '');
});

test('NVIDIA custom provider supplies the compatible endpoint and key', () => {
  const config = {
    customProviders: [{ id: 'custom_nvidia-nim', baseUrl: 'https://integrate.api.nvidia.com/v1' }],
    providers: {
      'custom_nvidia-nim': {
        activeKeyId: 'key_1',
        keys: [
          { id: 'key_0', key: 'old-key' },
          { id: 'key_1', key: 'active-key' },
        ],
      },
    },
    media: { endpoints: {}, keys: {} },
  };
  assert.equal(cloud.compatEndpoint(config), 'https://integrate.api.nvidia.com/v1');
  const provider = { id: 'openai-compatible', keyProvider: 'openaiCompatible' };
  assert.equal(cloud.resolveCloudKey(config, provider), 'active-key');
  assert.equal(config.media.keys.openaiCompatible, undefined);
});

test('saved media key wins over a reused provider key', () => {
  const config = {
    customProviders: [{ id: 'custom_nvidia-nim', baseUrl: 'https://integrate.api.nvidia.com/v1' }],
    providers: { 'custom_nvidia-nim': { apiKey: 'provider-key' } },
    media: { endpoints: { openaiCompatible: 'https://integrate.api.nvidia.com/v1' }, keys: { openaiCompatible: 'media-key' } },
  };
  const provider = { id: 'openai-compatible', keyProvider: 'openaiCompatible' };
  assert.equal(cloud.resolveCloudKey(config, provider), 'media-key');
});

test('compat providers expose configured image and video models', () => {
  const config = {
    media: {
      endpoints: { openaiCompatible: 'https://media.example.com/v1' },
      keys: { openaiCompatible: 'k' },
      openaiModels: { image: ['qwen/qwen-image-2512'], video: ['wan-ai/wan2.2', ''] },
    },
  };
  const provider = cloud.cloudProviderList(config).find((entry) => entry.id === 'openai-compatible');
  assert.deepEqual(provider.modelsByKind.image, ['qwen/qwen-image-2512']);
  assert.deepEqual(provider.modelsByKind.video, ['wan-ai/wan2.2']);
  assert.equal(provider.baseUrl, 'https://media.example.com/v1');
  assert.equal(provider.keyId, 'openaiCompatible');
});

test('NVIDIA hosted images snap to its supported widths and heights', () => {
  assert.deepEqual(cloud.nvidiaImageSize({ aspect: '16:9' }), { width: 1344, height: 768 });
  assert.deepEqual(cloud.nvidiaImageSize({ aspect: '9:16' }), { width: 768, height: 1344 });
  assert.deepEqual(cloud.nvidiaImageSize({ size: '512x768' }), { width: 768, height: 768 });
  assert.deepEqual(cloud.nvidiaImageSize({}), { width: 1024, height: 1024 });
});

test('model discovery keeps image and video apart and ignores chat models', () => {
  const classified = cloud.classifyCompatModels([
    'black-forest-labs/flux.1-schnell',
    'qwen/qwen-image-2512',
    'wan-ai/wan2.2',
    'meta/llama-3.2-11b-vision-instruct',
    'google/diffusiongemma-26b-a4b-it',
    'nvidia/cosmos-reason2-8b',
    'nvidia/ai-synthetic-video-detector',
  ]);
  assert.deepEqual(classified.image, ['black-forest-labs/flux.1-schnell', 'qwen/qwen-image-2512']);
  assert.deepEqual(classified.video, ['wan-ai/wan2.2']);
});
