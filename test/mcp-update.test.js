'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { MCPManager } = require('../src/core/mcp');

const manager = new MCPManager();

function stdioServer(overrides = {}) {
  return {
    id: 'mcp_files_demo',
    name: 'Files',
    transport: 'stdio',
    enabled: true,
    command: 'npx -y server-filesystem C:\\Projects',
    cwd: '',
    url: '',
    env: { TOKEN: 'secret', MODE: 'read' },
    headers: {},
    ...overrides,
  };
}

test('updateServer renames a server without touching saved secrets', () => {
  const next = manager.updateServer(stdioServer(), { id: 'mcp_files_demo', name: 'Projects', transport: 'stdio', command: 'npx -y server-filesystem D:\\Work' });
  assert.equal(next.name, 'Projects');
  assert.equal(next.command, 'npx -y server-filesystem D:\\Work');
  assert.deepEqual(next.env, { TOKEN: 'secret', MODE: 'read' });
  assert.equal(next.enabled, true);
  assert.equal(next.id, 'mcp_files_demo');
});

test('updateServer replaces or clears environment when provided', () => {
  const replaced = manager.updateServer(stdioServer(), { env: { NEW_KEY: 'value' } });
  assert.deepEqual(replaced.env, { NEW_KEY: 'value' });
  const cleared = manager.updateServer(stdioServer(), { env: {} });
  assert.deepEqual(cleared.env, {});
});

test('updateServer keeps headers for HTTP servers and replaces them on request', () => {
  const before = stdioServer({
    transport: 'http',
    command: '',
    env: {},
    url: 'https://mcp.example.com/sse',
    headers: { Authorization: 'Bearer one' },
  });
  const renamed = manager.updateServer(before, { name: 'Remote', url: 'https://mcp.example.com/mcp' });
  assert.equal(renamed.transport, 'http');
  assert.equal(renamed.url, 'https://mcp.example.com/mcp');
  assert.deepEqual(renamed.headers, { Authorization: 'Bearer one' });
  const replaced = manager.updateServer(before, { headers: { Authorization: 'Bearer two' } });
  assert.deepEqual(replaced.headers, { Authorization: 'Bearer two' });
  const cleared = manager.updateServer(before, { headers: {} });
  assert.deepEqual(cleared.headers, {});
});

test('updateServer switches transports and drops stale fields', () => {
  const toHttp = manager.updateServer(stdioServer(), { transport: 'http', url: 'https://mcp.example.com/sse', headers: { 'X-Key': 'k' } });
  assert.equal(toHttp.transport, 'http');
  assert.equal(toHttp.command, '');
  assert.equal(toHttp.url, 'https://mcp.example.com/sse');
  assert.deepEqual(toHttp.env, {});
  assert.deepEqual(toHttp.headers, { 'X-Key': 'k' });
  const toStdio = manager.updateServer(toHttp, { transport: 'stdio', command: 'node server.js' });
  assert.equal(toStdio.transport, 'stdio');
  assert.equal(toStdio.command, 'node server.js');
  assert.equal(toStdio.url, '');
  assert.deepEqual(toStdio.headers, {});
});

test('updateServer rejects empty commands, bad URLs and malformed maps', () => {
  assert.throws(() => manager.updateServer(stdioServer(), { command: '  ' }), /needs a command/);
  assert.throws(() => manager.updateServer(stdioServer({ transport: 'http', command: '', env: {}, url: 'https://x.test' }), { url: 'ftp://x.test' }), /http\(s\) URL/);
  assert.throws(() => manager.updateServer(stdioServer(), { env: ['A=1'] }), /key\/value/);
  assert.throws(() => manager.updateServer(stdioServer({ transport: 'http', command: '', env: {}, url: 'https://x.test' }), { headers: 'A=1' }), /key\/value/);
});

test('forget closes the live client and allows a clean reconnect', () => {
  let closed = 0;
  manager.clients.set('mcp_files_demo', { close() { closed += 1; } });
  manager.lastAttempt.set('mcp_files_demo', 123);
  manager.forget('mcp_files_demo');
  assert.equal(closed, 1);
  assert.equal(manager.clients.has('mcp_files_demo'), false);
  assert.equal(manager.lastAttempt.has('mcp_files_demo'), false);
});
