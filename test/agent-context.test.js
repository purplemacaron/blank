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

test.after(() => fs.rmSync(home, { recursive: true, force: true }));

async function summaryServer(t, receive = () => {}) {
  const { server, origin } = await listening((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      receive(JSON.parse(body));
      res.setHeader('content-type', 'text/event-stream');
      res.end('data: {"choices":[{"delta":{"content":"Summary of the goal and completed checks."},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    });
  });
  t.after(() => server.close());
  return {
    defaultModel: 'ollama/m',
    providers: { ollama: { baseUrl: `${origin}/v1` } },
    discoveredModels: { ollama: [{ id: 'm', context: 32768 }] },
    agent: { autoCompact: true },
  };
}

function toolConversation(count) {
  const messages = [{ role: 'user', content: 'Investigate the build failure.' }];
  for (let index = 0; index < count; index += 1) {
    messages.push({ role: 'assistant', content: '', toolCalls: [{ id: `call_${index}`, name: 'read_file', args: { path: 'build.js' } }] });
    messages.push({ role: 'tool', toolCallId: `call_${index}`, name: 'read_file', content: `Tool evidence ${index} ${'x'.repeat(4000)}` });
  }
  return messages;
}

test('compaction handles one user request followed by a long tool loop', async (t) => {
  const config = await summaryServer(t);
  const messages = toolConversation(10);
  const original = structuredClone(messages);
  const session = { id: 's_single_user', mode: 'agent', messages, contextTokens: 32000 };
  assert.equal(agent.shouldCompactContext({ config, session, limit: 32768, system: '' }), true);
  const result = await agent.compactSession({ session, config });
  assert.equal(result.ok, true, result.error);
  assert.equal(session.compactedCount, 13);
  assert.deepEqual(session.messages, original, 'the visible transcript remains intact');
  const outgoing = providerMessages(session);
  assert.equal(outgoing[0].role, 'user', 'a continuation starts with a user message on every provider');
  const ids = new Set(outgoing.flatMap((message) => (message.toolCalls || []).map((call) => call.id)));
  for (const message of outgoing.filter((message) => message.role === 'tool')) {
    assert.ok(ids.has(message.toolCallId), 'retained tool results keep their calls');
  }
  const saved = JSON.parse(fs.readFileSync(path.join(home, 'sessions', `${session.id}.json`), 'utf8'));
  assert.equal(saved.compactedCount, 13);
  assert.equal(saved.summary, session.summary);
});

test('compaction preserves a multi-tool call when the cutoff falls inside its results', async (t) => {
  const config = await summaryServer(t);
  const messages = toolConversation(5);
  messages[9].toolCalls.push({ id: 'parallel', name: 'read_file', args: {} });
  messages.push({ role: 'tool', toolCallId: 'parallel', content: 'second result' });
  messages.push(...conversation(6, 'Recent conversation.'));
  const session = { id: 's_tool_pair', mode: 'agent', messages };
  const result = await agent.compactSession({ session, config });
  assert.equal(result.ok, true, result.error);
  assert.equal(session.compactedCount, 9);
  assert.equal(messages[session.compactedCount].role, 'assistant');
});

test('short but full sessions can compact rather than waiting for thirteen messages', async (t) => {
  const config = await summaryServer(t);
  const session = { id: 's_short_full', mode: 'agent', messages: toolConversation(2), contextTokens: 32000 };
  assert.equal(agent.shouldCompactContext({ config, session, limit: 32768, system: '' }), true);
  const result = await agent.compactSession({ session, config });
  assert.equal(result.ok, true, result.error);
  assert.equal(session.compactedCount, 3);
});

test('a second compaction carries forward its summary and only newly compacted messages', async (t) => {
  let request;
  const config = await summaryServer(t, (body) => { request = body; });
  const messages = conversation(20, (index) => index < 4 ? 'DO_NOT_REPLAY_ARCHIVED_MESSAGES' : `New evidence ${index}`);
  const session = { id: 's_second_compact', mode: 'agent', messages, compactedCount: 4, summary: 'KEEP_PRIOR_DECISION' };
  const result = await agent.compactSession({ session, config });
  assert.equal(result.ok, true, result.error);
  const content = request.messages.map((message) => message.content).join('\n');
  assert.ok(content.includes('KEEP_PRIOR_DECISION'));
  assert.ok(!content.includes('DO_NOT_REPLAY_ARCHIVED_MESSAGES'));
  assert.ok(content.includes('New evidence 11'));
  assert.equal(session.compactedCount, 12);
});

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

test('auto-compaction can run again when a single run refills the context window', async (t) => {
  let summaries = 0;
  let chats = 0;
  const { server, origin } = await listening((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const body = JSON.parse(raw);
      let delta;
      if (!body.tools?.length) {
        summaries += 1;
        delta = { content: `Summary ${summaries}` };
      } else if (++chats === 1) {
        delta = { tool_calls: [{ index: 0, id: 'todo_1', type: 'function', function: { name: 'todo_write', arguments: '{"todos":[{"content":"Finish review","status":"in_progress"}]}' } }] };
      } else {
        delta = { content: 'Review complete.' };
      }
      res.setHeader('content-type', 'text/event-stream');
      res.end(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: delta.tool_calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 32000, completion_tokens: 10 } })}\n\ndata: [DONE]\n\n`);
    });
  });
  t.after(() => server.close());
  const config = {
    defaultModel: 'ollama/m', workspace: home,
    providers: { ollama: { baseUrl: `${origin}/v1` } },
    discoveredModels: { ollama: [{ id: 'm', context: 32768 }] },
    agent: { autoCompact: true, autoMemory: false, maxSteps: 3 },
    permissions: { todo_write: 'allow' },
  };
  const session = { id: 's_refill', mode: 'agent', messages: toolConversation(10), contextTokens: 32000, usage: { input: 0, output: 0 } };
  const events = [];
  const result = await agent.runAgent({ session, config, emit: (event) => events.push(event) });
  assert.equal(result.ok, true, result.error);
  assert.equal(summaries, 2);
  const compactedEvents = events.filter((event) => event.type === 'compacted');
  assert.equal(compactedEvents.length, 2);
  assert.ok(compactedEvents.every((event) => event.contextTokens > 0 && event.contextTokens < 32000));
});

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

test('auto-compaction stays out of ask mode and sessions with nothing to compact', () => {
  const config = { agent: { autoCompact: true, compactAt: 0.82 } };
  const ask = { mode: 'ask', messages: conversation(13, 'x'.repeat(14000)), usage: { input: 0, output: 0 } };
  const short = { mode: 'agent', messages: conversation(2, 'x'.repeat(14000)), usage: { input: 0, output: 0 } };
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
  let seen = null;
  const { server, origin } = await listening((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try { seen = JSON.parse(body); } catch { seen = null; }
      res.setHeader('content-type', 'text/event-stream');
      res.end([
        'data: {"choices":[{"index":0,"delta":{"content":"Earlier work covered the setup and the remaining fix."}}]}',
        'data: [DONE]',
        '',
      ].join('\n\n'));
    });
  });
  t.after(() => server.close());
  const config = {
    defaultModel: 'ollama/qwen3.8:27b',
    providers: { ollama: { baseUrl: `${origin}/v1` } },
    discoveredModels: { ollama: [{ id: 'qwen3.8:27b', name: 'qwen3.8:27b', context: 53248 }] },
    customProviders: [],
    agent: {},
  };
  const makeSession = () => ({
    id: 's_compact_context',
    title: 'Compact test',
    model: 'ollama/qwen3.8:27b',
    mode: 'agent',
    messages: conversation(10, 'x'.repeat(400)),
    usage: { input: 0, output: 0 },
    summary: '',
    compactedCount: 0,
  });
  const session = makeSession();
  const before = estimateConversationTokens('', providerMessages(session));
  const result = await agent.compactSession({ session, config });
  assert.equal(result.ok, true);
  assert.equal(seen.max_tokens, 1600, 'the summary request is bounded so it cannot stall the run');
  assert.equal(seen.reasoning_effort, 'none', 'local summaries skip the slow thinking pass');
  assert.ok(session.contextTokens > 0, 'the meter has a footprint after compaction');
  assert.ok(session.contextTokens < before, 'the footprint shrinks with the transcript');

  const firstRequest = seen.messages[1].content;
  const second = await agent.compactSession({ session: makeSession(), config });
  assert.equal(second.ok, true);
  assert.notEqual(seen.messages[1].content, firstRequest, 'each summary request is unique so a cached prompt cannot replay an earlier answer');
});

test('a summary that only echoes the request id is retried once', async (t) => {
  let requests = 0;
  const { server, origin } = await listening((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      requests += 1;
      const echo = (JSON.parse(body).messages[1].content.match(/Request (compact_\w+)\./) || [])[1] || '';
      const content = requests === 1 ? echo : 'The user investigated a build failure; the fix is a one-character patch.';
      res.setHeader('content-type', 'text/event-stream');
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  t.after(() => server.close());
  const config = {
    defaultModel: 'ollama/qwen3.8:27b',
    providers: { ollama: { baseUrl: `${origin}/v1` } },
    discoveredModels: { ollama: [{ id: 'qwen3.8:27b', name: 'qwen3.8:27b', context: 53248 }] },
    agent: {},
  };
  const session = {
    id: 's_echo', title: 'Echo test', model: 'ollama/qwen3.8:27b', mode: 'agent',
    messages: conversation(10, 'y'.repeat(400)), usage: { input: 0, output: 0 }, summary: '', compactedCount: 0,
  };
  const result = await agent.compactSession({ session, config });
  assert.equal(result.ok, true);
  assert.equal(requests, 2, 'the degenerate echo triggers one retry with a fresh request id');
  assert.match(result.summary, /build failure/);
});
