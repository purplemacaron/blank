'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { validateProviderProxy, maskProxyUrl, fetchForProvider } = require('../src/core/provider-proxy');

async function startServer(server) {
  const sockets = new Set();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: server.address().port,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function answerTunnel(socket) {
  let request = '';
  socket.on('data', (chunk) => {
    request += chunk.toString('latin1');
    if (request.includes('\r\n\r\n')) {
      socket.end('HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nproxy');
    }
  });
}

test('proxy policy preserves the existing direct default', () => {
  assert.deepEqual(validateProviderProxy(null), { mode: 'direct', type: 'http', url: '' });
  assert.deepEqual(validateProviderProxy({}), { mode: 'direct', type: 'http', url: '' });
});

test('supports forced direct and system policies', () => {
  assert.deepEqual(validateProviderProxy({ mode: 'direct' }), { mode: 'direct', type: 'http', url: '' });
  assert.deepEqual(validateProviderProxy({ mode: 'system' }), { mode: 'system', type: 'http', url: '' });
});

test('migrates legacy enabled and disabled proxy records', () => {
  assert.equal(validateProviderProxy({ enabled: true, type: 'http', url: 'http://127.0.0.1:8080' }).mode, 'force');
  assert.equal(validateProviderProxy({ enabled: false, type: 'http', url: '' }).mode, 'direct');
  assert.deepEqual(validateProviderProxy({ mode: 'manual', url: 'socks5://127.0.0.1:1080' }),
    { mode: 'force', type: 'socks5', url: 'socks5://127.0.0.1:1080' });
});

test('validates HTTP and SOCKS5 URLs for forced proxy mode', () => {
  assert.equal(validateProviderProxy({ mode: 'force', type: 'http', url: 'http://127.0.0.1:8080' }).mode, 'force');
  assert.equal(validateProviderProxy({ mode: 'force', type: 'http', url: 'https://proxy.example:8443' }).mode, 'force');
  const defaultPort = validateProviderProxy({ mode: 'force', type: 'http', url: 'http://proxy.example:80' });
  assert.equal(defaultPort.url, 'http://proxy.example:80');
  assert.deepEqual(validateProviderProxy(defaultPort), defaultPort);
  assert.equal(validateProviderProxy({ mode: 'force', type: 'socks5', url: 'socks5://127.0.0.1:1080' }).mode, 'force');
  assert.equal(validateProviderProxy({ mode: 'force', type: 'socks5', url: 'socks5://user:pass@proxy.example:1080' }).mode, 'force');
});

test('rejects invalid modes, proxy URLs and unsupported schemes', () => {
  assert.throws(() => validateProviderProxy({ mode: 'automatic' }));
  assert.throws(() => validateProviderProxy({ mode: 'force', type: 'unknown', url: 'http://127.0.0.1:8080' }));
  assert.throws(() => validateProviderProxy({ mode: 'force', type: 'http', url: 'socks5://127.0.0.1:1080' }));
  assert.throws(() => validateProviderProxy({ mode: 'force', type: 'socks5', url: 'http://127.0.0.1:8080' }));
  assert.throws(() => validateProviderProxy({ mode: 'force', type: 'socks5', url: 'socks5://127.0.0.1' }));
  assert.throws(() => validateProviderProxy({ mode: 'force', type: 'http', url: 'http://127.0.0.1:8080/path' }));
  assert.throws(() => validateProviderProxy({ mode: 'force', type: 'http', url: '' }));
});

test('masks proxy passwords before exposing configuration', () => {
  assert.equal(maskProxyUrl('socks5://alice:secret@127.0.0.1:1080'), 'socks5://127.0.0.1:1080');
  assert.equal(maskProxyUrl('http://alice:secret@proxy.example:80'), 'http://proxy.example:80');
  assert.doesNotMatch(maskProxyUrl('socks5://alice:secret@127.0.0.1:1080'), /secret/);
});

test('forced HTTP proxy carries credentials and never resolves the destination locally', async (t) => {
  const server = http.createServer();
  let destination = '';
  let authorization = '';
  server.on('connect', (request, socket) => {
    destination = request.url;
    authorization = request.headers['proxy-authorization'] || '';
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    answerTunnel(socket);
  });
  const listener = await startServer(server);
  t.after(listener.close);
  const fetchImpl = fetchForProvider({ providers: { p: { proxy: {
    mode: 'force', type: 'http', url: `http://alice:secret@127.0.0.1:${listener.port}`,
  } } } }, 'p');
  const response = await fetchImpl('http://provider.invalid/models', { signal: AbortSignal.timeout(5000) });
  assert.equal(await response.text(), 'proxy');
  assert.equal(destination, 'provider.invalid:80');
  assert.equal(authorization, `Basic ${Buffer.from('alice:secret').toString('base64')}`);
});

test('forced SOCKS5 proxy sends the destination hostname to the proxy', async (t) => {
  let destination = '';
  const server = net.createServer((socket) => {
    socket.once('data', () => {
      socket.write(Buffer.from([0x05, 0x00]));
      socket.once('data', (request) => {
        const size = request[4];
        destination = request.subarray(5, 5 + size).toString();
        socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0, 80]));
        answerTunnel(socket);
      });
    });
  });
  const listener = await startServer(server);
  t.after(listener.close);
  const fetchImpl = fetchForProvider({ providers: { p: { proxy: {
    mode: 'force', type: 'socks5', url: `socks5://127.0.0.1:${listener.port}`,
  } } } }, 'p');
  const response = await fetchImpl('http://provider.invalid/models', { signal: AbortSignal.timeout(5000) });
  assert.equal(await response.text(), 'proxy');
  assert.equal(destination, 'provider.invalid');
});

test('SOCKS5 handshake rejects when the proxy closes its socket', async (t) => {
  const server = net.createServer((socket) => socket.end());
  const listener = await startServer(server);
  t.after(listener.close);
  const fetchImpl = fetchForProvider({ providers: { p: { proxy: {
    mode: 'force', type: 'socks5', url: `socks5://127.0.0.1:${listener.port}`,
  } } } }, 'p');
  await assert.rejects(Promise.race([
    fetchImpl('http://provider.invalid/models'),
    new Promise((_resolve, reject) => setTimeout(() => reject(new Error('SOCKS5 handshake hung')), 1000)),
  ]), (error) => error.message !== 'SOCKS5 handshake hung');
});

test('SOCKS5 proxy authenticates with saved URL credentials', async (t) => {
  let credentials = '';
  const server = net.createServer((socket) => {
    socket.once('data', () => {
      socket.write(Buffer.from([0x05, 0x02]));
      socket.once('data', (auth) => {
        const usernameEnd = 2 + auth[1];
        const passwordLength = auth[usernameEnd];
        credentials = `${auth.subarray(2, usernameEnd)}:${auth.subarray(usernameEnd + 1, usernameEnd + 1 + passwordLength)}`;
        socket.write(Buffer.from([0x01, 0x00]));
        socket.once('data', () => {
          socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0, 80]));
          answerTunnel(socket);
        });
      });
    });
  });
  const listener = await startServer(server);
  t.after(listener.close);
  const fetchImpl = fetchForProvider({ providers: { p: { proxy: {
    mode: 'force', type: 'socks5', url: `socks5://alice:secret@127.0.0.1:${listener.port}`,
  } } } }, 'p');
  const response = await fetchImpl('http://provider.invalid/models', { signal: AbortSignal.timeout(5000) });
  assert.equal(await response.text(), 'proxy');
  assert.equal(credentials, 'alice:secret');
});

test('CLI system mode uses proxy environment variables while direct mode bypasses them', async (t) => {
  const origin = http.createServer((_request, response) => response.end('direct'));
  const originListener = await startServer(origin);
  t.after(originListener.close);

  const proxy = http.createServer();
  let proxyHits = 0;
  proxy.on('connect', (_request, socket) => {
    proxyHits += 1;
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    answerTunnel(socket);
  });
  const proxyListener = await startServer(proxy);
  t.after(proxyListener.close);

  const keys = ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
  for (const key of keys) process.env[key] = /no_proxy/i.test(key) ? '' : `http://127.0.0.1:${proxyListener.port}`;

  const systemFetch = fetchForProvider({ providers: { p: { proxy: { mode: 'system' } } } }, 'p');
  const viaProxy = await systemFetch('http://provider.invalid/models', { signal: AbortSignal.timeout(5000) });
  assert.equal(await viaProxy.text(), 'proxy');

  const directFetch = fetchForProvider({ providers: { p: { proxy: { mode: 'direct' } } } }, 'p');
  const direct = await directFetch(`http://127.0.0.1:${originListener.port}/models`, { signal: AbortSignal.timeout(5000) });
  assert.equal(await direct.text(), 'direct');
  assert.equal(proxyHits, 1);
});
