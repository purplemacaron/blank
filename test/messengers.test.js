'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const net = require('net');

const {
  createMessengerService,
  chunkText,
  maskToken,
  parseCommand,
  PROVIDERS,
} = require('../src/core/messengers');

function memoryConfig(initial = {}) {
  let file = structuredClone(initial);
  return {
    loadConfig: () => structuredClone(file),
    saveConfig(next) {
      file = structuredClone(next);
      return next;
    },
    read: () => structuredClone(file),
  };
}

function baseConfig(patch = {}) {
  return {
    messengers: {
      notify: true,
      telegram: { enabled: false, token: '', links: {}, lastChatId: '', ...(patch.telegram || {}) },
      discord: { enabled: false, token: '', links: {}, lastChatId: '', ...(patch.discord || {}) },
      slack: { enabled: false, appToken: '', botToken: '', links: {}, lastChatId: '', ...(patch.slack || {}) },
      webhook: { enabled: false, port: 8789, secret: '', url: '', links: {}, lastChatId: '', ...(patch.webhook || {}) },
      ...(patch.root || {}),
    },
  };
}

function makeHandlers(overrides = {}) {
  const sessions = overrides.sessions || [
    { id: 's1', title: 'First session', model: 'model-a' },
    { id: 's2', title: 'Second session', model: 'model-b' },
  ];
  const calls = { send: [], stop: [], approve: [], create: 0 };
  const handlers = {
    listSessions: () => sessions,
    getSession: (id) => sessions.find((session) => session.id === id) || null,
    isRunning: () => false,
    send: async (input) => {
      calls.send.push(input);
      return { sessionId: input.sessionId || 's1', runId: 'run1', title: 'First session' };
    },
    stop: async (id) => {
      calls.stop.push(id);
      return { ok: true };
    },
    approve: async (input) => {
      calls.approve.push(input);
      return { ok: true };
    },
    pendingApprovals: () => [],
    version: () => '1.2.3',
    createSession: () => {
      calls.create += 1;
      return { id: 's9', title: 'Fresh session' };
    },
    ...(overrides.handlers || {}),
  };
  return { handlers, calls, sessions };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, timeout = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = check();
    if (value) return value;
    await sleep(25);
  }
  throw new Error('Timed out waiting for messenger event.');
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

test('chunkText keeps short text and splits long text near newlines', () => {
  assert.deepEqual(chunkText('hello', 100), ['hello']);
  assert.deepEqual(chunkText('  ', 100), []);
  const long = `${'a'.repeat(60)}\n${'b'.repeat(60)}`;
  const chunks = chunkText(long, 70);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0], 'a'.repeat(60));
  assert.equal(chunks[1], 'b'.repeat(60));
  assert.ok(chunkText('word '.repeat(100), 30).every((chunk) => chunk.length <= 30));
});

test('parseCommand splits slash commands and strips bot suffixes', () => {
  assert.deepEqual(parseCommand('hello world'), { name: 'text', arg: 'hello world' });
  assert.deepEqual(parseCommand('/sessions'), { name: 'sessions', arg: '' });
  assert.deepEqual(parseCommand('/use 2'), { name: 'use', arg: '2' });
  assert.deepEqual(parseCommand('/help@blank_bot'), { name: 'help', arg: '' });
  assert.deepEqual(parseCommand('/approve allow abc'), { name: 'approve', arg: 'allow abc' });
});

test('maskToken never exposes a full secret', () => {
  assert.equal(maskToken(''), '');
  assert.equal(maskToken('short'), '••••');
  assert.equal(maskToken('123456:ABCdefghijklmnop'), '1234…mnop');
  assert.ok(!maskToken('123456:ABCdefghijklmnop').includes('123456'));
});

test('unpaired chats are prompted once and pairing validates and rotates the code', async () => {
  const config = memoryConfig(baseConfig({ telegram: { enabled: true, token: 'bot-token', links: {} } }));
  const service = createMessengerService({ configModule: config, network: false, handlers: makeHandlers().handlers });
  test.after(() => service.dispose());

  const code = service.status().pairCode;
  assert.match(code, /^\d{6}$/);

  const first = await service.receive('telegram', 'chat-1', 'hello');
  assert.match(first.reply, /not paired/i);
  assert.match(first.reply, /\/pair <code>/);
  const second = await service.receive('telegram', 'chat-1', 'hello again');
  assert.equal(second.reply, '');

  const wrong = await service.receive('telegram', 'chat-1', '/pair 000000');
  assert.match(wrong.reply, /not correct/i);

  const paired = await service.receive('telegram', 'chat-1', `/pair ${code}`);
  assert.match(paired.reply, /Paired with blank/);
  assert.notEqual(service.status().pairCode, code);
  assert.equal(service.status().telegram.paired, 1);

  const rotate = service.status().pairCode;
  const unpair = await service.receive('telegram', 'chat-1', '/unpair');
  assert.match(unpair.reply, /Unpaired/);
  const oldCode = await service.receive('telegram', 'chat-1', `/pair ${code}`);
  assert.match(oldCode.reply, /not correct/i);
  const newCode = await service.receive('telegram', 'chat-1', `/pair ${rotate}`);
  assert.match(newCode.reply, /Paired with blank/);
});

test('pairing stops after repeated wrong codes', async () => {
  const config = memoryConfig(baseConfig({ telegram: { enabled: true, token: 'bot-token', links: {} } }));
  const service = createMessengerService({ configModule: config, network: false, handlers: makeHandlers().handlers });
  test.after(() => service.dispose());

  let last = null;
  for (let i = 0; i < 21; i += 1) {
    last = await service.receive('telegram', 'brute-force', '/pair 000000');
  }
  assert.match(last.reply, /Too many pairing attempts/i);
});

test('manual pairing remains blocked for other chats', async () => {
  const config = memoryConfig(baseConfig({ telegram: { enabled: true, token: 'bot-token', links: {} } }));
  const service = createMessengerService({ configModule: config, network: false, handlers: makeHandlers().handlers });
  test.after(() => service.dispose());
  const code = service.status().pairCode;

  for (let i = 0; i < 20; i += 1) {
    await service.receive('telegram', 'attacker', '/pair 000000');
  }
  const blocked = await service.receive('telegram', 'chat-fresh', '/pair 000000');
  assert.match(blocked.reply, /Too many pairing attempts/i);
  const valid = await service.receive('telegram', 'chat-fresh', `/pair ${code}`);
  assert.match(valid.reply, /Too many pairing attempts/i);
});

test('paired prompts and session commands reach the handlers', async () => {
  const { handlers, calls, sessions: sessionList } = makeHandlers();
  const config = memoryConfig(baseConfig({ telegram: { enabled: true, token: 'bot-token', links: {} } }));
  const service = createMessengerService({ configModule: config, network: false, handlers });
  test.after(() => service.dispose());
  const code = service.status().pairCode;
  await service.receive('telegram', 'chat-2', `/pair ${code}`);

  const prompt = await service.receive('telegram', 'chat-2', 'hello there');
  assert.equal(prompt.reply, 'Working on it · First session');
  assert.equal(calls.send.length, 1);
  assert.equal(calls.send[0].text, 'hello there');

  const sessions = await service.receive('telegram', 'chat-2', '/sessions');
  assert.match(sessions.reply, /1\.\* First session/);
  assert.match(sessions.reply, /2\.  Second session/);

  const use = await service.receive('telegram', 'chat-2', '/use 2');
  assert.match(use.reply, /Switched to Second session/);
  await service.receive('telegram', 'chat-2', 'second prompt');
  assert.equal(calls.send[1].sessionId, 's2');

  const missing = await service.receive('telegram', 'chat-2', '/use 9');
  assert.match(missing.reply, /Session not found/);

  const fresh = await service.receive('telegram', 'chat-2', '/new');
  assert.match(fresh.reply, /New session · Fresh session/);
  assert.equal(calls.create, 1);
  sessionList.push({ id: 's9', title: 'Fresh session', model: 'model-c' });
  await service.receive('telegram', 'chat-2', 'third prompt');
  assert.equal(calls.send[2].sessionId, 's9');

  const stop = await service.receive('telegram', 'chat-2', '/stop');
  assert.equal(stop.reply, 'Stopped.');
  assert.deepEqual(calls.stop, ['s9']);

  await service.receive('telegram', 'chat-2', '/use 1');
  handlers.pendingApprovals = () => [{ approvalId: 'a9', sessionId: 's1' }];
  handlers.isRunning = () => true;
  const status = await service.receive('telegram', 'chat-2', '/status');
  assert.match(status.reply, /blank 1\.2\.3/);
  assert.match(status.reply, /Model · model-a/);
  assert.match(status.reply, /Run · working/);
  assert.match(status.reply, /Approvals · 1 waiting/);
});

test('approvals can be answered from a paired chat', async () => {
  const { handlers, calls } = makeHandlers();
  const config = memoryConfig(baseConfig({ telegram: { enabled: true, token: 'bot-token', links: {} } }));
  const service = createMessengerService({ configModule: config, network: false, handlers });
  test.after(() => service.dispose());
  const code = service.status().pairCode;
  await service.receive('telegram', 'chat-3', `/pair ${code}`);
  await service.receive('telegram', 'chat-3', '/use 1');

  handlers.pendingApprovals = () => (calls.approve.length ? [] : [{ approvalId: 'a1', sessionId: 's1', tool: 'write_file', label: 'Write file' }]);
  const sent = service.approval({
    approvalId: 'a1',
    sessionId: 's1',
    tool: 'write_file',
    label: 'Write file',
    summary: 'Write a file in the workspace.',
  });
  assert.equal(sent, true);

  const approved = await service.receive('telegram', 'chat-3', '/approve allow');
  assert.match(approved.reply, /Allowed · Write file/);
  assert.deepEqual(calls.approve, [{ approvalId: 'a1', decision: 'allow' }]);

  const again = await service.receive('telegram', 'chat-3', '/approve deny');
  assert.match(again.reply, /No approval is waiting/);
});

test('decide rejects approvals aimed at a different chat', async () => {
  const { handlers } = makeHandlers();
  const config = memoryConfig(baseConfig({ telegram: { enabled: true, token: 'bot-token', links: {} } }));
  const service = createMessengerService({ configModule: config, network: false, handlers });
  test.after(() => service.dispose());
  const code = service.status().pairCode;
  await service.receive('telegram', 'owner', `/pair ${code}`);
  await service.receive('telegram', 'owner', '/use 1');
  service.approval({ approvalId: 'a2', sessionId: 's1', tool: 'run_command', label: 'Run command' });

  const stolen = await service.decide('telegram', 'intruder', 'a2', 'allow');
  assert.equal(stolen.ok, false);
  const missing = await service.decide('telegram', 'owner', 'missing', 'allow');
  assert.equal(missing.ok, false);
});

test('chats are rate limited to 24 messages a minute', async () => {
  const config = memoryConfig(baseConfig({ telegram: { enabled: true, token: 'bot-token', links: {} } }));
  const service = createMessengerService({ configModule: config, network: false, handlers: makeHandlers().handlers });
  test.after(() => service.dispose());
  const code = service.status().pairCode;
  await service.receive('telegram', 'chat-rate', `/pair ${code}`);

  // /pair counted as the first message in the one-minute window.
  let replies = 0;
  for (let i = 0; i < 23; i += 1) {
    const result = await service.receive('telegram', 'chat-rate', '/help');
    if (result.reply) replies += 1;
  }
  assert.equal(replies, 23);
  const limited = await service.receive('telegram', 'chat-rate', '/help');
  assert.equal(limited.reply, '');
});

test('disabled messengers ignore incoming messages', async () => {
  const config = memoryConfig(baseConfig());
  const service = createMessengerService({ configModule: config, network: false, handlers: makeHandlers().handlers });
  test.after(() => service.dispose());
  const result = await service.receive('telegram', 'chat-off', 'hello');
  assert.equal(result.reply, '');
  assert.equal(service.status().telegram.paired, 0);
});

test('telegram test() redacts tokens from errors', async () => {
  const token = '555123:AAHsecretTOKEN_abcdefgh';
  const config = memoryConfig(baseConfig({ telegram: { enabled: true, token, links: {} } }));
  const service = createMessengerService({
    configModule: config,
    network: false,
    handlers: makeHandlers().handlers,
    telegramBaseUrl: 'http://127.0.0.1:9',
    fetch: async () => { throw new Error(`connect failed for ${token}`); },
  });
  test.after(() => service.dispose());
  const result = await service.test('telegram');
  assert.equal(result.ok, false);
  assert.ok(!result.error.includes(token));
  assert.match(result.error, /\[redacted\]/);
  assert.ok(!service.status().telegram.error.includes(token));
});

test('configure validates input and keeps tokens masked in status', async () => {
  const config = memoryConfig(baseConfig());
  const service = createMessengerService({ configModule: config, network: false, handlers: makeHandlers().handlers });
  test.after(() => service.dispose());

  await assert.rejects(() => service.configure({ provider: 'telegram', enabled: true }), /token/i);
  await assert.rejects(() => service.configure({ provider: 'slack', enabled: true }), /Slack tokens/i);
  await assert.rejects(
    () => service.configure({ provider: 'webhook', url: 'ftp://example.com' }),
    /http or https/i,
  );
  await assert.rejects(
    () => service.configure({ provider: 'webhook', port: 80 }),
    /between 1024 and 65535/i,
  );
  await assert.rejects(() => service.configure({ provider: 'carrier-pigeon' }), /Unknown messenger/);

  const status = await service.configure({ provider: 'telegram', token: '123456:ABCDEFGHIJKLMNOP', enabled: true });
  assert.equal(status.telegram.hasToken, true);
  assert.equal(status.telegram.tokenPreview, '1234…MNOP');
  assert.equal(status.telegram.running, false);
  assert.ok(!JSON.stringify(status).includes('123456:ABCDEFGHIJKLMNOP'));
  assert.equal(PROVIDERS.length, 4);
});

test('telegram long polling pairs, runs, answers approvals and posts the result', async () => {
  const updates = [];
  const sent = [];
  const calls = [];
  let messageId = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let payload = {};
      try { payload = body ? JSON.parse(body) : {}; } catch {}
      const method = String(req.url || '').split('/').pop();
      const reply = (data) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      if (method === 'getMe') return reply({ ok: true, result: { username: 'blank_test_bot' } });
      if (method === 'getUpdates') {
        const batch = updates.splice(0, updates.length);
        return reply({ ok: true, result: batch });
      }
      if (method === 'sendMessage') {
        messageId += 1;
        sent.push(payload);
        return reply({ ok: true, result: { message_id: messageId } });
      }
      if (method === 'answerCallbackQuery' || method === 'editMessageText') {
        calls.push({ method, ...payload });
        return reply({ ok: true, result: true });
      }
      return reply({ ok: false, description: 'unknown method' });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const config = memoryConfig(baseConfig({ telegram: { enabled: true, token: '123:ABC', links: {} } }));
  const { handlers, calls: handlerCalls } = makeHandlers();
  const service = createMessengerService({
    configModule: config,
    handlers,
    telegramBaseUrl: base,
  });
  test.after(async () => {
    service.dispose();
    await new Promise((resolve) => server.close(resolve));
  });

  service.start();
  await waitFor(() => service.status().telegram.running);

  const code = service.status().pairCode;
  updates.push({
    update_id: 1,
    message: { chat: { id: 777 }, from: { username: 'tester' }, text: 'hello' },
  });
  const help = await waitFor(() => sent.find((message) => /not paired/i.test(message.text)));
  assert.match(help.text, /\/pair <code>/);

  updates.push({
    update_id: 2,
    message: { chat: { id: 777 }, from: { username: 'tester' }, text: `/pair ${code}` },
  });
  const paired = await waitFor(() => sent.find((message) => /Paired with blank/.test(message.text)));
  assert.equal(paired.chat_id, '777');
  assert.equal(service.status().telegram.botName, 'blank_test_bot');

  updates.push({
    update_id: 3,
    message: { chat: { id: 777 }, from: { username: 'tester' }, text: 'summarize the repo' },
  });
  const working = await waitFor(() => sent.find((message) => /Working on it/.test(message.text)));
  assert.equal(working.chat_id, '777');
  assert.equal(handlerCalls.send[0].text, 'summarize the repo');

  handlers.getSession = (id) => (id === 's1'
    ? { id: 's1', title: 'First session', model: 'model-a', messages: [{ role: 'assistant', content: 'Final answer from blank.' }] }
    : null);
  service.publish({ type: 'run:start', sessionId: 's1', runId: 'run1' });
  service.publish({ type: 'run:done', sessionId: 's1', runId: 'run1', title: 'First session' });
  const final = await waitFor(() => sent.find((message) => message.text === 'Final answer from blank.'));
  assert.equal(final.chat_id, '777');

  service.approval({
    approvalId: 'apr-1',
    sessionId: 's1',
    tool: 'write_file',
    label: 'Write file',
    summary: 'Write notes.md.',
  });
  const approval = await waitFor(() => sent.find((message) => message.reply_markup?.inline_keyboard));
  const buttons = approval.reply_markup.inline_keyboard[0];
  assert.equal(buttons[0].text, 'Allow');
  assert.equal(buttons[0].callback_data, 'apv:apr-1:allow');

  updates.push({
    update_id: 4,
    callback_query: {
      id: 'cb-1',
      from: { id: 777 },
      data: 'apv:apr-1:deny',
      message: { message_id: approval.message_id || 1, chat: { id: 777 } },
    },
  });
  await waitFor(() => calls.find((call) => call.method === 'answerCallbackQuery'));
  assert.deepEqual(handlerCalls.approve, [{ approvalId: 'apr-1', decision: 'deny' }]);
  const answered = calls.find((call) => call.method === 'answerCallbackQuery');
  assert.equal(answered.text, 'Denied.');
  await waitFor(() => calls.find((call) => call.method === 'editMessageText'));
});

test('webhook bridge authenticates, answers and reports approvals', async () => {
  const port = await freePort();
  const secret = 'test-secret-1234567890';
  const config = memoryConfig(baseConfig({
    webhook: { enabled: true, port, secret, url: '', links: {} },
  }));
  const { handlers } = makeHandlers();
  let service = null;
  const originalSend = handlers.send;
  handlers.send = async (input) => {
    const result = await originalSend(input);
    setTimeout(() => {
      service.publish({ type: 'run:done', sessionId: result.sessionId, runId: result.runId, title: result.title });
    }, 25);
    return result;
  };
  handlers.getSession = (id) => ({
    id,
    title: 'Hook session',
    messages: [{ role: 'assistant', content: 'Hook answer.' }],
  });
  handlers.pendingApprovals = () => [{ approvalId: 'wa1', sessionId: 's1', tool: 'run_command', label: 'Run command' }];

  service = createMessengerService({ configModule: config, handlers, network: true });
  test.after(() => service.dispose());
  service.start();
  await waitFor(() => service.status().webhook.running);

  const health = await fetch(`http://127.0.0.1:${port}/health`);
  const healthJson = await health.json();
  assert.equal(healthJson.ok, true);
  assert.equal(healthJson.app, 'blank');

  const unauthorized = await fetch(`http://127.0.0.1:${port}/approvals`);
  assert.equal(unauthorized.status, 401);

  const approved = await fetch(`http://127.0.0.1:${port}/approvals`, {
    headers: { authorization: `Bearer ${secret}` },
  });
  const approvalsJson = await approved.json();
  assert.equal(approvalsJson.approvals[0].approvalId, 'wa1');

  const response = await fetch(`http://127.0.0.1:${port}/message`, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'hello from the bridge' }),
  });
  const result = await response.json();
  assert.equal(result.ok, true);
  assert.equal(result.reply, 'Hook answer.');
  assert.equal(result.sessionId, 's1');
  assert.equal(service.status().webhook.paired, 1);

  const badBody = await fetch(`http://127.0.0.1:${port}/message`, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    body: JSON.stringify({ text: '' }),
  });
  assert.equal(badBody.status, 400);
});

test('paired plain text notifies onIncoming before the auto-reply', async () => {
  const seen = [];
  const { handlers, calls } = makeHandlers();
  const config = memoryConfig(baseConfig({ telegram: { enabled: true, token: 'bot-token', links: {} } }));
  const service = createMessengerService({
    configModule: config,
    network: false,
    handlers,
    onIncoming: async (event) => { seen.push(event); },
  });
  test.after(() => service.dispose());
  const code = service.status().pairCode;
  await service.receive('telegram', 'chat-hook', `/pair ${code}`);
  await service.receive('telegram', 'chat-hook', 'deploy now');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].provider, 'telegram');
  assert.equal(seen[0].chatId, 'chat-hook');
  assert.equal(seen[0].text, 'deploy now');
  assert.equal(calls.send.length, 1);
});

test('onIncoming failures never block the auto-reply or fire for commands', async () => {
  const { handlers, calls } = makeHandlers();
  const config = memoryConfig(baseConfig({ telegram: { enabled: true, token: 'bot-token', links: {} } }));
  const service = createMessengerService({
    configModule: config,
    network: false,
    handlers,
    onIncoming: () => { throw new Error('hook failed'); },
  });
  test.after(() => service.dispose());
  const code = service.status().pairCode;
  await service.receive('telegram', 'chat-hook-2', `/pair ${code}`);
  const reply = await service.receive('telegram', 'chat-hook-2', 'hello');
  assert.equal(reply.reply, 'Working on it · First session');
  assert.equal(calls.send.length, 1);
  const command = await service.receive('telegram', 'chat-hook-2', '/sessions');
  assert.match(command.reply, /First session/);
  assert.equal(calls.send.length, 1);
});
