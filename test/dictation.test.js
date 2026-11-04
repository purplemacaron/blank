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
