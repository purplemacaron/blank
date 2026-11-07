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
