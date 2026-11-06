'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const providers = require('../src/core/providers');

function endpoint(handler) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let json = {};
      try { json = JSON.parse(body); } catch {}
      res.setHeader('content-type', 'application/json');
      handler(json, res);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}/v1` });
    });
  });
}

test('endpoint metadata names the exact efforts', () => {
  const openrouter = providers.reasoningHintFrom({
    id: 'vendor/model',
    supported_parameters: ['tools', 'reasoning'],
    reasoning: {
      supports_effort: true,
      supported_efforts: ['low', 'medium', 'high'],
      default_effort: 'medium',
    },
  });
  assert.deepEqual(openrouter.levels, ['low', 'medium', 'high']);
  assert.equal(openrouter.default, 'medium');
  assert.equal(openrouter.source, 'api');

  const generic = providers.reasoningHintFrom({
    id: 'model',
    capabilities: { reasoning: { supported: true, levels: ['low', 'high'] } },
  });
  assert.deepEqual(generic.levels, ['low', 'high']);

  const boolean = providers.reasoningHintFrom({ id: 'model', supports_reasoning: true });
  assert.equal(boolean.supported, true);
  assert.equal(boolean.levels, undefined);
  assert.equal(providers.reasoningHintFrom({ id: 'plain' }), null);
});

test('vision hints come from endpoint metadata when present', () => {
  assert.equal(providers.visionHintFrom({ architecture: { input_modalities: ['text', 'image'] } }), true);
  assert.equal(providers.visionHintFrom({ architecture: { input_modalities: ['text'] } }), false);
  assert.equal(providers.visionHintFrom({ id: 'plain' }), undefined);
});

test('probe discovers that an endpoint accepts only low, medium and high', async (t) => {
  const accepted = new Set(['low', 'medium', 'high']);
  const { server, baseUrl } = await endpoint((body, res) => {
    if (body.reasoning_effort && !accepted.has(body.reasoning_effort)) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: { message: 'reasoning_effort must be one of low, medium, high' } }));
      return;
    }
    res.end(JSON.stringify({
      choices: [{ message: { content: '4', reasoning_content: body.reasoning_effort ? 'thinking' : '' } }],
      usage: { completion_tokens_details: { reasoning_tokens: body.reasoning_effort ? 4 : 0 } },
    }));
  });
  t.after(() => server.close());
  const hint = await providers.probeReasoningAt({ baseUrl, apiKey: 'test', protocol: 'openai', modelId: 'm' });
  assert.equal(hint.supported, true);
  assert.deepEqual(hint.levels, ['low', 'medium', 'high']);
  assert.equal(hint.default, 'medium');
  assert.equal(hint.source, 'probe');
});

test('probe recognises an always-on reasoner that rejects effort control', async (t) => {
  const { server, baseUrl } = await endpoint((body, res) => {
    if (body.reasoning_effort) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: { message: 'Unknown parameter: reasoning_effort' } }));
      return;
    }
    res.end(JSON.stringify({
      choices: [{ message: { content: '4', reasoning_content: 'two plus two is four' } }],
      usage: { completion_tokens_details: { reasoning_tokens: 12 } },
    }));
  });
  t.after(() => server.close());
  const hint = await providers.probeReasoningAt({ baseUrl, apiKey: 'test', protocol: 'openai', modelId: 'm' });
  assert.equal(hint.supported, false);
  assert.equal(hint.alwaysOn, true);
});

test('probe leaves unknown endpoints alone', async (t) => {
  const { server, baseUrl } = await endpoint((body, res) => {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: { message: 'temporary failure' } }));
  });
  t.after(() => server.close());
  const hint = await providers.probeReasoningAt({ baseUrl, apiKey: 'test', protocol: 'openai', modelId: 'm' });
  assert.equal(hint, null);
});

test('requests keep the stages the endpoint probe discovered', async (t) => {
  let seen = null;
  const { server, baseUrl } = await endpoint((body, res) => {
    seen = body;
    res.setHeader('content-type', 'text/event-stream');
    res.end('data: [DONE]\n\n');
  });
  t.after(() => server.close());
  const config = {
    defaultModel: 'custom_probe/m',
    customProviders: [{
      id: 'custom_probe',
      name: 'Probe',
      protocol: 'openai',
      baseUrl,
      models: [{ id: 'm', name: 'm' }],
    }],
    providers: { custom_probe: { keys: [{ id: 'k1', key: 'test' }] } },
    reasoningHints: {
      'custom_probe/m': {
        supported: true,
        levels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
        default: 'medium',
        source: 'probe',
      },
    },
    agent: {},
  };
  for await (const _ of providers.streamChat({
    modelId: 'custom_probe/m',
    config,
    system: '',
    messages: [{ role: 'user', content: 'hi' }],
    options: { reasoningEffort: 'xhigh' },
  })) { /* consume the stream */ }
  assert.equal(seen.reasoning_effort, 'xhigh');
});
