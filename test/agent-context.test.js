'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'blank-context-home-'));
process.env.BLANK_HOME = home;

const agent = require('../src/core/agent');
const { providerMessages, estimateConversationTokens } = require('../src/core/prompt');

function listening(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, origin: `http://127.0.0.1:${port}` });
    });
  });
}

function conversation(count, content) {
  return Array.from({ length: count }, (_, index) => ({
    id: `m_${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: typeof content === 'function' ? content(index) : content,
    at: new Date().toISOString(),
  }));
}

test('auto-compaction uses the real model window, not the generic fallback', () => {
  const session = { mode: 'agent', messages: conversation(13, 'x'.repeat(14000)), usage: { input: 0, output: 0 } };
  const config = { agent: { autoCompact: true, compactAt: 0.82 } };
  assert.equal(
    agent.shouldCompactContext({ config, session, limit: 53248, system: '' }),
    true,
    'a 27B model with a 53248 token window needs to compact well before 128000',
  );
  assert.equal(
    agent.shouldCompactContext({ config, session, limit: 128000, system: '' }),
    false,
    'the old 128000 assumption left the threshold unreachable',
  );
});

test('auto-compaction trusts the last reported prompt size when it is larger', () => {
  const session = {
    mode: 'agent',
    messages: conversation(13, 'hi'),
    contextTokens: 50000,
    usage: { input: 0, output: 0 },
  };
  const config = { agent: { autoCompact: true, compactAt: 0.82 } };
  assert.equal(agent.shouldCompactContext({ config, session, limit: 53248, system: '' }), true);
});

test('auto-compaction stays out of ask mode and short sessions', () => {
  const config = { agent: { autoCompact: true, compactAt: 0.82 } };
  const ask = { mode: 'ask', messages: conversation(13, 'x'.repeat(14000)), usage: { input: 0, output: 0 } };
  const short = { mode: 'agent', messages: conversation(6, 'x'.repeat(14000)), usage: { input: 0, output: 0 } };
  assert.equal(agent.shouldCompactContext({ config, session: ask, limit: 53248, system: '' }), false);
  assert.equal(agent.shouldCompactContext({ config, session: short, limit: 53248, system: '' }), false);
  assert.equal(agent.shouldCompactContext({
    config: { agent: { autoCompact: false } },
    session: ask,
    limit: 53248,
    system: '',
  }), false);
});

test('compaction records the smaller footprint the next request will use', async (t) => {
  const { server, origin } = await listening((req, res) => {
    res.setHeader('content-type', 'text/event-stream');
    res.end([
      'data: {"choices":[{"index":0,"delta":{"content":"Earlier work covered the setup and the remaining fix."}}]}',
      'data: [DONE]',
      '',
    ].join('\n\n'));
  });
  t.after(() => server.close());
  const config = {
    defaultModel: 'custom_compact/m',
    customProviders: [{
      id: 'custom_compact',
      name: 'Compact',
      protocol: 'openai',
      baseUrl: `${origin}/v1`,
      models: [{ id: 'm', name: 'm', context: 53248 }],
    }],
    providers: {},
    agent: {},
  };
  const session = {
    id: 's_compact_context',
    title: 'Compact test',
    model: 'custom_compact/m',
    mode: 'agent',
    messages: conversation(10, 'x'.repeat(400)),
    usage: { input: 0, output: 0 },
    summary: '',
    compactedCount: 0,
  };
  const before = estimateConversationTokens('', providerMessages(session));
  const result = await agent.compactSession({ session, config });
  assert.equal(result.ok, true);
  assert.ok(session.contextTokens > 0, 'the meter has a footprint after compaction');
  assert.ok(session.contextTokens < before, 'the footprint shrinks with the transcript');
});
