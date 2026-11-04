'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'blank-dictation-'));
process.env.BLANK_HOME = home;

const configModule = require('../src/core/config');
const dictation = require('../src/core/dictation');

function saveConfig(patch = {}) {
  const config = configModule.loadConfig();
  configModule.saveConfig({ ...config, ...patch });
}

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

test('resolveDictation requires a compatible provider with a key', () => {
  saveConfig({ providers: {}, dictation: { providerId: '', model: 'whisper-1', language: '' } });
  assert.throws(() => dictation.resolveDictation(), /OpenAI-compatible API key/);
});

test('transcribeAudio posts the clip to the configured endpoint without exposing the key', async () => {
  let request = null;
  const { server, port } = await listen((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      request = {
        url: req.url,
        authorization: req.headers.authorization,
        contentType: req.headers['content-type'] || '',
        body: Buffer.concat(chunks).toString('utf8'),
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ text: '  hello from dictation  ' }));
    });
  });
  try {
    saveConfig({
      providers: {
        openai: {
          keys: [{ id: 'key1', label: 'Test', key: 'test-dictation-key' }],
          activeKeyId: 'key1',
          baseUrl: `http://127.0.0.1:${port}/v1`,
        },
      },
      dictation: { providerId: 'openai', model: 'whisper-1', language: 'ko' },
    });
    const result = await dictation.transcribeAudio({
      audio: Buffer.from('fake-webm-bytes').toString('base64'),
      mime: 'audio/webm',
    });
    assert.equal(result.text, 'hello from dictation');
    assert.equal(result.model, 'whisper-1');
    assert.ok(request);
    assert.equal(request.url, '/v1/audio/transcriptions');
    assert.equal(request.authorization, 'Bearer test-dictation-key');
    assert.match(request.contentType, /^multipart\/form-data; boundary=/);
    assert.match(request.body, /name="model"[\s\S]*whisper-1/);
    assert.match(request.body, /name="language"[\s\S]*ko/);
    assert.match(request.body, /fake-webm-bytes/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('transcribeAudio surfaces provider errors without leaking the key', async () => {
  const { server, port } = await listen((_req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'bad key' } }));
  });
  try {
    saveConfig({
      providers: {
        openai: {
          keys: [{ id: 'key1', label: 'Test', key: 'secret-dictation-key' }],
          activeKeyId: 'key1',
          baseUrl: `http://127.0.0.1:${port}/v1`,
        },
      },
      dictation: { providerId: 'openai', model: 'gpt-4o-mini-transcribe', language: '' },
    });
    await assert.rejects(
      () => dictation.transcribeAudio({ audio: Buffer.from('x').toString('base64'), mime: 'audio/webm' }),
      (error) => {
        assert.match(error.message, /401/);
        assert.ok(!error.message.includes('secret-dictation-key'));
        return true;
      },
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('transcribeAudio rejects empty audio before calling a provider', async () => {
  await assert.rejects(() => dictation.transcribeAudio({ audio: '', mime: 'audio/webm' }), /No audio/);
});

test('known providers expose transcription model suggestions', () => {
  assert.deepEqual(dictation.transcriptionModels({ id: 'openai', baseUrl: 'https://api.openai.com/v1' }), [
    'whisper-1',
    'gpt-4o-transcribe',
    'gpt-4o-mini-transcribe',
  ]);
  assert.deepEqual(dictation.transcriptionModels({ id: 'groq', baseUrl: 'https://api.groq.com/openai/v1' }), [
    'whisper-large-v3',
    'whisper-large-v3-turbo',
    'distil-whisper-large-v3-en',
  ]);
  assert.deepEqual(dictation.transcriptionModels({ id: 'mistral', baseUrl: 'https://api.mistral.ai/v1' }), ['voxtral-mini-latest']);
});

test('custom endpoints are matched by host', () => {
  assert.deepEqual(
    dictation.transcriptionModels({ id: 'custom_nvidia-nim', baseUrl: 'https://integrate.api.nvidia.com/v1/' }),
    ['whisper-large-v3', 'whisper-large-v3-turbo'],
  );
  assert.deepEqual(
    dictation.transcriptionModels({ id: 'my_together', baseUrl: 'https://api.together.xyz/v1' }),
    ['openai/whisper-large-v3', 'openai/whisper-large-v3-turbo'],
  );
  assert.deepEqual(dictation.transcriptionModels({ id: 'local_whisper', baseUrl: 'http://localhost:8000/v1' }), ['whisper-1']);
});

test('blank models resolve to the provider recommendation', () => {
  assert.equal(dictation.effectiveModel('', { id: 'groq' }), 'whisper-large-v3');
  assert.equal(dictation.effectiveModel('   ', { id: 'openai' }), 'whisper-1');
  assert.equal(dictation.effectiveModel('', { id: 'custom_nvidia-nim', baseUrl: 'https://integrate.api.nvidia.com/v1' }), 'whisper-large-v3');
});

test('the legacy whisper-1 default is replaced only where it is unsupported', () => {
  assert.equal(dictation.effectiveModel('whisper-1', { id: 'openai' }), 'whisper-1');
  assert.equal(dictation.effectiveModel('whisper-1', { id: 'groq' }), 'whisper-large-v3');
  assert.equal(dictation.effectiveModel('whisper-1', { id: 'custom_nvidia-nim', baseUrl: 'https://integrate.api.nvidia.com/v1' }), 'whisper-large-v3');
});

test('explicit custom model ids are preserved', () => {
  assert.equal(dictation.effectiveModel('my-whisper-large-v3', { id: 'groq' }), 'my-whisper-large-v3');
  assert.equal(dictation.effectiveModel('whisper-1', { id: 'local_whisper', baseUrl: 'http://localhost:8000/v1' }), 'whisper-1');
});

test('a custom transcription endpoint works without a key', async () => {
  let request = null;
  const { server, port } = await listen((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      request = {
        url: req.url,
        authorization: req.headers.authorization,
        body: Buffer.concat(chunks).toString('utf8'),
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ text: 'custom hello' }));
    });
  });
  try {
    saveConfig({
      providers: {},
      dictation: {
        providerId: '__custom',
        baseUrl: `http://127.0.0.1:${port}/v1/`,
        key: '',
        model: 'whisper-large-v3',
        language: 'ko',
      },
    });
    const resolved = dictation.resolveDictation();
    assert.equal(resolved.provider, 'Custom endpoint');
    assert.equal(resolved.baseUrl, `http://127.0.0.1:${port}/v1`);
    assert.equal(resolved.key, '');
    const result = await dictation.transcribeAudio({
      audio: Buffer.from('custom-webm-bytes').toString('base64'),
      mime: 'audio/webm',
    });
    assert.equal(result.text, 'custom hello');
    assert.equal(result.provider, 'Custom endpoint');
    assert.ok(request);
    assert.equal(request.url, '/v1/audio/transcriptions');
    assert.equal(request.authorization, undefined);
    assert.match(request.body, /name="model"[\s\S]*whisper-large-v3/);
    assert.match(request.body, /name="language"[\s\S]*ko/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('a custom transcription endpoint sends its own key and default model', async () => {
  let authorization = null;
  const { server, port } = await listen((req, res) => {
    authorization = req.headers.authorization;
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ text: 'keyed hello' }));
    });
  });
  try {
    saveConfig({
      providers: {},
      dictation: {
        providerId: '__custom',
        baseUrl: `http://127.0.0.1:${port}/v1`,
        key: 'custom-transcription-secret',
        model: '',
        language: '',
      },
    });
    const result = await dictation.transcribeAudio({
      audio: Buffer.from('keyed-webm-bytes').toString('base64'),
      mime: 'audio/webm',
    });
    assert.equal(result.text, 'keyed hello');
    assert.equal(result.model, 'whisper-1');
    assert.equal(authorization, 'Bearer custom-transcription-secret');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('custom endpoint configuration is validated and its key stays private', () => {
  saveConfig({
    providers: {},
    dictation: { providerId: '__custom', baseUrl: 'ftp://bad', key: 'private-transcription-secret', model: '', language: '' },
  });
  assert.throws(() => dictation.resolveDictation(), /custom transcription endpoint/);
  saveConfig({
    providers: {},
    dictation: { providerId: '__custom', baseUrl: 'http://127.0.0.1:9/v1/audio/transcriptions', key: 'private-transcription-secret', model: '', language: '' },
  });
  assert.equal(dictation.resolveDictation().baseUrl, 'http://127.0.0.1:9/v1');
  saveConfig({
    providers: {},
    dictation: { providerId: '__custom', baseUrl: 'http://127.0.0.1:9/v1', key: 'private-transcription-secret', model: '', language: '' },
  });
  const catalog = require('../src/core/catalog');
  const publicView = configModule.publicConfig(configModule.loadConfig(), catalog);
  assert.equal(publicView.dictation.baseUrl, 'http://127.0.0.1:9/v1');
  assert.equal(publicView.dictation.hasKey, true);
  assert.ok(!JSON.stringify(publicView).includes('private-transcription-secret'));
});
