'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { sanitizeApi, publicApis, requestApi, buildUrl, findApi } = require('../src/core/apis');

test('sanitizeApi validates the base URL and name', () => {
  assert.throws(() => sanitizeApi({ name: 'Bad', baseUrl: 'ftp://example.com' }), /http/i);
  assert.throws(() => sanitizeApi({ name: '', baseUrl: 'https://example.com' }), /name/i);
  const api = sanitizeApi({ name: 'Weather', baseUrl: 'https://example.com/', auth: 'bearer', key: 'secret-key' });
  assert.equal(api.baseUrl, 'https://example.com');
  assert.equal(api.auth, 'bearer');
  assert.equal(api.key, 'secret-key');
  assert.match(api.id, /^api_/);
});

test('publicApis never returns the raw key', () => {
  const api = sanitizeApi({ name: 'Weather', baseUrl: 'https://example.com', key: 'super-secret-value' });
  const publicList = publicApis({ apis: [api] });
  assert.equal(publicList.length, 1);
  assert.equal(publicList[0].hasKey, true);
  assert.ok(publicList[0].keyPreview);
  assert.equal('key' in publicList[0], false);
  assert.equal(JSON.stringify(publicList).includes('super-secret-value'), false);
});

test('sanitizeApi keeps or clears a saved key explicitly', () => {
  const existing = sanitizeApi({ name: 'Weather', baseUrl: 'https://example.com', key: 'saved' });
  const kept = sanitizeApi({ description: 'Updated' }, existing);
  assert.equal(kept.key, 'saved');
  const cleared = sanitizeApi({ clearKey: true }, existing);
  assert.equal(cleared.key, '');
  const replaced = sanitizeApi({ key: 'new-key' }, existing);
  assert.equal(replaced.key, 'new-key');
});

test('buildUrl appends paths, query values and query auth', () => {
  const api = sanitizeApi({ name: 'Q', baseUrl: 'https://example.com/v1', auth: 'query', headerName: 'key', key: 'abc' });
  const url = buildUrl(api, '/weather', { days: 3, empty: '' });
  assert.equal(url.toString(), 'https://example.com/v1/weather?days=3&key=abc');
});

test('findApi matches by id or case-insensitive name', () => {
  const api = sanitizeApi({ name: 'Weather', baseUrl: 'https://example.com' });
  const config = { apis: [api] };
  assert.equal(findApi(config, api.id), api);
  assert.equal(findApi(config, 'weather'), api);
  assert.equal(findApi(config, 'missing'), null);
});

test('requestApi sends the saved credential and parses the response', async () => {
  const received = {};
  const server = http.createServer((req, res) => {
    received.method = req.method;
    received.url = req.url;
    received.auth = req.headers.authorization;
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      received.body = body;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const api = sanitizeApi({ name: 'Local', baseUrl: `http://127.0.0.1:${port}`, auth: 'bearer', key: 'local-secret' });
  try {
    const result = await requestApi(api, { path: '/echo', method: 'POST', body: { hello: 'world' } });
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
    assert.equal(result.api, 'Local');
    assert.equal(received.auth, 'Bearer local-secret');
    assert.equal(received.method, 'POST');
    assert.equal(received.url, '/echo');
    assert.deepEqual(JSON.parse(received.body), { hello: 'world' });
    assert.equal(JSON.stringify(result).includes('local-secret'), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('requestApi refuses cloud metadata addresses', async () => {
  const api = sanitizeApi({ name: 'Meta', baseUrl: 'http://169.254.169.254', auth: 'none' });
  await assert.rejects(() => requestApi(api, { path: '/' }), /metadata/i);
});
