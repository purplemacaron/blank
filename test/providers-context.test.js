'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const providers = require('../src/core/providers');

function listening(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port, origin: `http://127.0.0.1:${port}` });
    });
  });
}

test('openai streaming asks for usage so the context meter has data', async (t) => {
  let seen = null;
  const { server, origin } = await listening((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try { seen = JSON.parse(body); } catch { seen = null; }
      res.setHeader('content-type', 'text/event-stream');
      res.end([
        'data: {"choices":[{"index":0,"delta":{"content":"hello"},"finish_reason":null}]}',
        'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
        'data: {"choices":[],"usage":{"prompt_tokens":53,"completion_tokens":4,"total_tokens":57}}',
        'data: [DONE]',
        '',
      ].join('\n\n'));
    });
  });
  t.after(() => server.close());
  const config = {
    defaultModel: 'ollama/qwen3.8:27b',
    providers: { ollama: { baseUrl: `${origin}/v1` } },
    discoveredModels: {
      ollama: [{ id: 'qwen3.8:27b', name: 'qwen3.8:27b', context: 53248, tags: [] }],
    },
    agent: {},
  };
  const events = [];
  for await (const event of providers.streamChat({
    modelId: 'ollama/qwen3.8:27b',
    config,
    system: 'You are blank.',
    messages: [{ role: 'user', content: 'hi' }],
  })) {
    events.push(event);
  }
  assert.deepEqual(seen.stream_options, { include_usage: true }, 'the request opts into usage reporting');
  const usage = events.find((event) => event.type === 'usage');
  assert.ok(usage, 'a usage-only chunk is surfaced as a usage event');
  assert.deepEqual(usage.usage, { input: 53, output: 4 });
});

test('utility completions cap generation and skip ollama thinking', async (t) => {
  let seen = null;
  const { server, origin } = await listening((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try { seen = JSON.parse(body); } catch { seen = null; }
      res.setHeader('content-type', 'text/event-stream');
      res.end([
        'data: {"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}',
        'data: [DONE]',
        '',
      ].join('\n\n'));
    });
  });
  t.after(() => server.close());
  const config = {
    providers: { ollama: { baseUrl: `${origin}/v1` } },
    discoveredModels: {},
    agent: {},
  };
  const text = await providers.completeText({
    modelId: 'ollama/qwen3.8:27b',
    config,
    system: 'Summarize.',
    messages: [{ role: 'user', content: 'hi' }],
    maxTokens: 1600,
  });
  assert.equal(text, 'ok');
  assert.equal(seen.max_tokens, 1600, 'the requested cap reaches the provider');
  assert.equal(seen.reasoning_effort, 'none', 'ollama skips the thinking pass for utility work');
});

test('utility completions use the lowest effort gpt-oss accepts', async (t) => {
  let seen = null;
  const { server, origin } = await listening((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try { seen = JSON.parse(body); } catch { seen = null; }
      res.setHeader('content-type', 'text/event-stream');
      res.end(['data: {"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}', 'data: [DONE]', ''].join('\n\n'));
    });
  });
  t.after(() => server.close());
  const config = {
    providers: { ollama: { baseUrl: `${origin}/v1` } },
    discoveredModels: {},
    agent: {},
  };
  await providers.completeText({
    modelId: 'ollama/gpt-oss:20b',
    config,
    system: 'Summarize.',
    messages: [{ role: 'user', content: 'hi' }],
    maxTokens: 1600,
  });
  assert.equal(seen.max_tokens, 1600);
  assert.equal(seen.reasoning_effort, 'low', 'gpt-oss rejects none, so utility work uses its lowest stage');
});

test('utility completions send no effort parameter to non-thinking ollama models', async (t) => {
  let seen = null;
  const { server, origin } = await listening((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try { seen = JSON.parse(body); } catch { seen = null; }
      res.setHeader('content-type', 'text/event-stream');
      res.end(['data: {"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}', 'data: [DONE]', ''].join('\n\n'));
    });
  });
  t.after(() => server.close());
  const config = {
    providers: { ollama: { baseUrl: `${origin}/v1` } },
    discoveredModels: {},
    agent: {},
  };
  await providers.completeText({
    modelId: 'ollama/plain:latest',
    config,
    system: 'Summarize.',
    messages: [{ role: 'user', content: 'hi' }],
    maxTokens: 1600,
  });
  assert.equal(seen.max_tokens, 1600);
  assert.equal(seen.reasoning_effort, undefined, 'models without a thinking pass get no effort parameter');
});

test('chat requests without an explicit cap leave max_tokens to the provider', async (t) => {
  let seen = null;
  const { server, origin } = await listening((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try { seen = JSON.parse(body); } catch { seen = null; }
      res.setHeader('content-type', 'text/event-stream');
      res.end(['data: {"choices":[{"index":0,"delta":{"content":"hi"},"finish_reason":"stop"}]}', 'data: [DONE]', ''].join('\n\n'));
    });
  });
  t.after(() => server.close());
  const config = {
    providers: { ollama: { baseUrl: `${origin}/v1` } },
    discoveredModels: {},
    agent: {},
  };
  for await (const _event of providers.streamChat({
    modelId: 'ollama/qwen3.8:27b',
    config,
    system: 'You are blank.',
    messages: [{ role: 'user', content: 'hi' }],
  })) { /* drain */ }
  assert.equal(seen.max_tokens, undefined, 'normal runs keep the provider default');
  assert.equal(seen.reasoning_effort, undefined, 'normal runs keep the model thinking profile');
});

test('custom endpoints are not sent guessed reasoning efforts', async (t) => {
  let seen = null;
  const { server, origin } = await listening((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try { seen = JSON.parse(body); } catch { seen = null; }
      res.setHeader('content-type', 'text/event-stream');
      res.end(['data: {"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}', 'data: [DONE]', ''].join('\n\n'));
    });
  });
  t.after(() => server.close());
  const config = {
    customProviders: [{
      id: 'custom_gateway', name: 'Gateway', protocol: 'openai', kind: 'cloud',
      baseUrl: `${origin}/v1`, models: [{ id: 'gemma-4-31B-it-fp8', name: 'gemma' }],
    }],
    providers: { custom_gateway: { keys: [{ id: 'k1', key: 'test-key', label: 'Default' }] } },
    agent: { reasoningEffort: 'auto' },
  };
  for await (const _event of providers.streamChat({
    modelId: 'custom_gateway/gemma-4-31B-it-fp8',
    config,
    system: 'You are blank.',
    messages: [{ role: 'user', content: 'hi' }],
    tools: [{ name: 'read_file', description: 'read', parameters: { type: 'object', properties: {} } }],
  })) { /* drain */ }
  assert.equal(seen.reasoning_effort, undefined, 'an unverified endpoint gets no effort parameter');
  assert.deepEqual(seen.stream_options, { include_usage: true }, 'the standard OpenAI usage field is still sent');
  assert.equal(seen.tool_choice, 'auto', 'agent tools still travel with the request');
});

test('a stage picked from a guessed ladder never reaches the endpoint', async (t) => {
  const requests = [];
  const { server, origin } = await listening((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let json = null;
      try { json = JSON.parse(body); } catch {}
      requests.push(json);
      if (json?.reasoning_effort === 'medium') {
        res.statusCode = 400;
        res.end('{"error":{"message":"service failure: upstream request failed"}}');
        return;
      }
      res.setHeader('content-type', 'text/event-stream');
      res.end(['data: {"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}', 'data: [DONE]', ''].join('\n\n'));
    });
  });
  t.after(() => server.close());
  const config = {
    customProviders: [{
      id: 'custom_gateway', name: 'Gateway', protocol: 'openai', kind: 'cloud',
      baseUrl: `${origin}/v1`, models: [{ id: 'gemma-4-31B-it-fp8', name: 'gemma' }],
    }],
    providers: { custom_gateway: { keys: [{ id: 'k1', key: 'test-key', label: 'Default' }] } },
    agent: {},
  };
  const events = [];
  for await (const event of providers.streamChat({
    modelId: 'custom_gateway/gemma-4-31B-it-fp8',
    config,
    system: 'You are blank.',
    messages: [{ role: 'user', content: 'hi' }],
    options: { reasoningEffort: 'medium' },
  })) {
    events.push(event);
  }
  assert.equal(requests.length, 1, 'one request answers the turn');
  assert.equal(requests[0].reasoning_effort, undefined, 'the guessed stage stays off the wire');
  assert.ok(events.some((event) => event.type === 'text'), 'the turn still streams');
});

test('a stage travels when the endpoint published its ladder', async (t) => {
  let seen = null;
  const { server, origin } = await listening((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try { seen = JSON.parse(body); } catch { seen = null; }
      res.setHeader('content-type', 'text/event-stream');
      res.end(['data: {"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}', 'data: [DONE]', ''].join('\n\n'));
    });
  });
  t.after(() => server.close());
  const config = {
    customProviders: [{
      id: 'custom_gateway', name: 'Gateway', protocol: 'openai', kind: 'cloud',
      baseUrl: `${origin}/v1`,
      models: [{
        id: 'gemma-4-31B-it-fp8',
        name: 'gemma',
        reasoningHint: { supported: true, levels: ['low', 'medium', 'high'], default: 'medium' },
      }],
    }],
    providers: { custom_gateway: { keys: [{ id: 'k1', key: 'test-key', label: 'Default' }] } },
    agent: { reasoningEffort: 'high' },
  };
  for await (const _event of providers.streamChat({
    modelId: 'custom_gateway/gemma-4-31B-it-fp8',
    config,
    system: 'You are blank.',
    messages: [{ role: 'user', content: 'hi' }],
  })) { /* drain */ }
  assert.equal(seen.reasoning_effort, 'high', 'an advertised stage is not a guess');
});

test('provider errors name the fields blank sent', async (t) => {
  const { server, origin } = await listening((req, res) => {
    req.resume();
    req.on('end', () => {
      res.statusCode = 400;
      res.end('{"error":{"message":"service failure: upstream request failed"}}');
    });
  });
  t.after(() => server.close());
  const config = {
    customProviders: [{
      id: 'custom_gateway', name: 'Gateway', protocol: 'openai', kind: 'cloud',
      baseUrl: `${origin}/v1`, models: [{ id: 'gemma-4-31B-it-fp8', name: 'gemma' }],
    }],
    providers: { custom_gateway: { keys: [{ id: 'k1', key: 'secret-key-value', label: 'Default' }] } },
    agent: {},
  };
  let error = null;
  try {
    for await (const _event of providers.streamChat({
      modelId: 'custom_gateway/gemma-4-31B-it-fp8',
      config,
      system: 'You are blank.',
      messages: [{ role: 'user', content: 'hi' }],
    })) { /* drain */ }
  } catch (err) { error = err; }
  assert.ok(error, 'the 400 is surfaced');
  assert.match(error.message, /400/);
  assert.match(error.message, /\[sent: [^\]]*model[^\]]*\]/, 'the sent field names are reported');
  assert.equal(error.message.includes('secret-key-value'), false, 'keys never leak into errors');
});

test('ollama models report the num_ctx the server actually uses', async (t) => {
  const { server, origin } = await listening((req, res) => {
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        object: 'list',
        data: [
          { id: 'qwen3.8:27b', object: 'model' },
          { id: 'plain:latest', object: 'model' },
        ],
      }));
      return;
    }
    if (req.method === 'POST' && req.url === '/api/show') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        let model = '';
        try { model = JSON.parse(body).model; } catch {}
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          parameters: model === 'qwen3.8:27b' ? 'num_ctx                        53248' : '',
          model_info: {},
        }));
      });
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
  t.after(() => server.close());
  const config = {
    providers: { ollama: { baseUrl: `${origin}/v1` } },
    discoveredModels: {},
    agent: {},
  };
  const models = await providers.listModels({ providerId: 'ollama', config });
  const tuned = models.find((model) => model.id === 'qwen3.8:27b');
  const plain = models.find((model) => model.id === 'plain:latest');
  assert.equal(tuned.context, 53248, 'num_ctx wins over the generic fallback');
  assert.equal(plain.context, 128000, 'models without num_ctx keep the fallback');
});
