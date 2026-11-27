'use strict';

const net = require('net');
const tls = require('tls');
let undici = null;

function undiciModule() {
  if (!undici) undici = require('undici');
  return undici;
}

const dispatchers = new Map();

function validateProviderProxy(input) {
  // Keep existing installations direct unless the user selected a policy.
  // Older manual and enabled records are interpreted without rewriting secrets.
  const mode = input == null
    ? 'direct'
    : (input.mode === 'manual' ? 'force' : input.mode
      || (input.enabled === true ? 'force' : 'direct'));
  if (!['force', 'direct', 'system'].includes(mode)) {
    throw new Error('Choose force, direct, or system proxy mode.');
  }
  if (mode !== 'force') return { mode, type: 'http', url: '' };

  const rawUrl = String(input.url || '').trim();
  if (rawUrl.length > 1000) throw new Error('Proxy URL is too long.');
  if (input.type !== undefined && !['http', 'socks5'].includes(input.type)) {
    throw new Error('Choose HTTP or SOCKS5 proxy type.');
  }
  const type = input.type === 'socks5' || (!input.type && /^socks5h?:\/\//i.test(rawUrl)) ? 'socks5' : 'http';
  let parsed;
  try { parsed = new URL(rawUrl); } catch {
    throw new Error('Enter a valid proxy URL.');
  }
  const allowed = type === 'socks5' ? ['socks5:', 'socks5h:'] : ['http:', 'https:'];
  const authority = /^[a-z][a-z\d+.-]*:\/\/([^/?#]+)/i.exec(rawUrl)?.[1] || '';
  const hostPort = authority.slice(authority.lastIndexOf('@') + 1);
  const explicitPort = /^(?:\[[^\]]+\]|[^:]+):(\d+)$/.exec(hostPort)?.[1];
  if (!allowed.includes(parsed.protocol) || !parsed.hostname || !explicitPort
    || Number(explicitPort) < 1 || Number(explicitPort) > 65535
    || (parsed.pathname && parsed.pathname !== '/') || parsed.search || parsed.hash) {
    throw new Error(type === 'socks5'
      ? 'SOCKS5 proxy must be socks5://host:port.'
      : 'HTTP proxy must be http://host:port or https://host:port.');
  }
  if (parsed.username && !parsed.password) throw new Error('Proxy password is missing.');
  // URL.toString() removes explicit default ports (:80 and :443). Preserve
  // the validated input so the saved policy remains valid on the next load.
  return { mode: 'force', type, url: rawUrl.replace(/\/$/, '') };
}

function maskProxyUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    const authority = /^[a-z][a-z\d+.-]*:\/\/([^/?#]+)/i.exec(String(value))?.[1] || '';
    return `${url.protocol}//${authority.slice(authority.lastIndexOf('@') + 1)}`;
  } catch { return 'Configured'; }
}

function socksConnector(proxyUrl) {
  const proxy = new URL(proxyUrl);
  const username = decodeURIComponent(proxy.username || '');
  const password = decodeURIComponent(proxy.password || '');
  return (opts, callback) => {
    let finished = false;
    let socket;
    const done = (error, connected) => {
      if (finished) {
        if (connected) connected.destroy();
        return;
      }
      finished = true;
      if (socket) socket.setTimeout(0);
      if (error && socket) socket.destroy();
      callback(error, connected);
    };
    socket = net.connect({ host: proxy.hostname.replace(/^\[|\]$/g, ''), port: Number(proxy.port) });
    socket.setNoDelay(true);
    socket.setTimeout(20000);
    socket.once('timeout', () => done(new Error('SOCKS5 proxy timed out.')));
    socket.once('end', () => done(new Error('SOCKS5 proxy closed the connection.')));
    socket.once('close', () => done(new Error('SOCKS5 proxy closed the connection.')));
    socket.once('error', (error) => done(error));
    socket.once('connect', () => {
      const methods = username || password ? [0x00, 0x02] : [0x00];
      socket.write(Buffer.from([0x05, methods.length, ...methods]));
      readBytes(socket, 2, (err, greeting) => {
        if (err) return done(err);
        if (greeting[0] !== 0x05 || greeting[1] === 0xff) return done(new Error('SOCKS5 proxy rejected authentication methods.'));
        const authenticate = (next) => {
          if (greeting[1] === 0x02) {
            const user = Buffer.from(username);
            const pass = Buffer.from(password);
            if (user.length > 255 || pass.length > 255) return done(new Error('SOCKS5 credentials are too long.'));
            socket.write(Buffer.concat([Buffer.from([0x01, user.length]), user, Buffer.from([pass.length]), pass]));
            return readBytes(socket, 2, (authErr, auth) => {
              if (authErr) return done(authErr);
              if (auth[1] !== 0x00) return done(new Error('SOCKS5 proxy authentication failed.'));
              next();
            });
          }
          if (greeting[1] !== 0x00) return done(new Error('SOCKS5 proxy requires unsupported authentication.'));
          next();
        };
        authenticate(() => {
          const host = String(opts.hostname || '').replace(/^\[|\]$/g, '');
          const port = Number(opts.port) || (opts.protocol === 'https:' ? 443 : 80);
          const address = net.isIP(host) === 4
            ? Buffer.concat([Buffer.from([0x01]), Buffer.from(host.split('.').map(Number))])
            : net.isIP(host) === 6
              ? Buffer.concat([Buffer.from([0x04]), ipv6Bytes(host)])
              : Buffer.concat([Buffer.from([0x03, Buffer.byteLength(host)]), Buffer.from(host)]);
          const portBytes = Buffer.from([(port >> 8) & 0xff, port & 0xff]);
          socket.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00]), address, portBytes]));
          readBytes(socket, 4, (replyErr, head) => {
            if (replyErr) return done(replyErr);
            if (head[0] !== 0x05 || head[1] !== 0x00) return done(new Error(`SOCKS5 connection failed (reply ${head[1]}).`));
            const restLength = head[3] === 0x01 ? 4 : head[3] === 0x04 ? 16 : head[3] === 0x03 ? 1 : 0;
            if (!restLength) return done(new Error('SOCKS5 proxy returned an invalid address.'));
            readBytes(socket, restLength, (addrErr, addrHead) => {
              if (addrErr) return done(addrErr);
              const extra = head[3] === 0x03 ? addrHead[0] + 2 : 2;
              readBytes(socket, extra, (portErr) => {
                if (portErr) return done(portErr);
                if (opts.protocol === 'https:') {
                  const secure = tls.connect({
                    socket,
                    servername: opts.servername || (net.isIP(host) ? undefined : host),
                    rejectUnauthorized: true,
                    ALPNProtocols: ['http/1.1'],
                  });
                  secure.once('secureConnect', () => done(null, secure));
                  secure.once('error', (error) => done(error));
                } else {
                  done(null, socket);
                }
              });
            });
          });
        });
      });
    });
    return socket;
  };
}

function ipv6Bytes(value) {
  // Expand IPv6 (including :: compression) into its 16-byte network form.
  const halves = value.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  const words = [...left, ...Array(Math.max(0, missing)).fill('0'), ...right]
    .map((part) => parseInt(part || '0', 16));
  const bytes = [];
  for (const word of words) bytes.push((word >> 8) & 0xff, word & 0xff);
  return Buffer.from(bytes);
}

function readBytes(socket, length, callback) {
  let buffer = Buffer.alloc(0);
  let settled = false;
  const cleanup = () => {
    socket.removeListener('data', onData);
    socket.removeListener('error', onError);
    socket.removeListener('end', onClose);
    socket.removeListener('close', onClose);
  };
  const onError = (error) => {
    if (settled) return;
    settled = true;
    cleanup();
    callback(error);
  };
  const onClose = () => onError(new Error('SOCKS5 proxy closed the connection.'));
  const onData = (chunk) => {
    if (settled) return;
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length < length) return;
    settled = true;
    socket.pause();
    cleanup();
    const result = buffer.subarray(0, length);
    const rest = buffer.subarray(length);
    if (rest.length) socket.unshift(rest);
    callback(null, result);
    socket.resume();
  };
  socket.on('data', onData);
  socket.once('error', onError);
  socket.once('end', onClose);
  socket.once('close', onClose);
}

function dispatcherFor(rawProxy) {
  const proxy = validateProviderProxy(rawProxy);
  if (proxy.mode !== 'force') return null;
  const key = `${proxy.type}:${proxy.url}`;
  if (dispatchers.has(key)) return dispatchers.get(key);
  const { ProxyAgent, Agent } = undiciModule();
  const dispatcher = proxy.type === 'socks5'
    ? new Agent({ connect: socksConnector(proxy.url) })
    : new ProxyAgent({ uri: proxy.url });
  dispatchers.set(key, dispatcher);
  return dispatcher;
}

function fetchForProvider(config, providerId) {
  const stored = config?.providers?.[providerId]?.proxy;
  const proxy = validateProviderProxy(stored);
  const { fetch: undiciFetch, Agent, EnvHttpProxyAgent } = undiciModule();
  if (proxy.mode === 'direct') {
    if (!dispatchers.has('direct')) dispatchers.set('direct', new Agent());
    return (url, init = {}) => undiciFetch(url, { ...init, dispatcher: dispatchers.get('direct') });
  }
  if (proxy.mode === 'system') {
    // Electron's net.fetch uses Chromium's network stack and follows the
    // operating-system proxy configuration (including PAC/system settings).
    if (process.versions.electron) {
      const { net } = require('electron');
      if (typeof net?.fetch !== 'function') throw new Error('System proxy is unavailable.');
      return net.fetch.bind(net);
    }
    // The CLI follows HTTP_PROXY, HTTPS_PROXY and NO_PROXY through undici.
    const env = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy']
      .map((key) => process.env[key] || '').join('\0');
    const key = `env:${env}`;
    if (!dispatchers.has(key)) dispatchers.set(key, new EnvHttpProxyAgent());
    return (url, init = {}) => undiciFetch(url, { ...init, dispatcher: dispatchers.get(key) });
  }

  const dispatcher = dispatcherFor(proxy);
  return async (url, init = {}) => {
    try {
      return await undiciFetch(url, { ...init, dispatcher });
    } catch (error) {
      const message = String(error?.message || error || 'Network request failed');
      const safeMessage = message.replaceAll(proxy.url, maskProxyUrl(proxy.url));
      const safe = new Error(safeMessage);
      if (error?.code) safe.code = error.code;
      throw safe;
    }
  };
}

module.exports = { validateProviderProxy, maskProxyUrl, fetchForProvider, dispatcherFor };
