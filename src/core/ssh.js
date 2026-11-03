'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client } = require('ssh2');
const { uid } = require('./paths');

const MAX_OUTPUT = 200000;

function safeStorage() {
  try {
    const electron = require('electron');
    if (electron && electron.safeStorage) return electron.safeStorage;
  } catch {}
  return null;
}

function seal(value) {
  if (!value) return '';
  const storage = safeStorage();
  try {
    if (storage && storage.isEncryptionAvailable()) {
      return `ss:${storage.encryptString(String(value)).toString('base64')}`;
    }
  } catch {}
  return `b64:${Buffer.from(String(value), 'utf8').toString('base64')}`;
}

function unseal(value) {
  if (!value) return '';
  try {
    if (value.startsWith('ss:')) {
      const storage = safeStorage();
      if (!storage) throw new Error('OS encryption is unavailable.');
      return storage.decryptString(Buffer.from(value.slice(3), 'base64'));
    }
    if (value.startsWith('b64:')) return Buffer.from(value.slice(4), 'base64').toString('utf8');
  } catch (err) {
    throw new Error(`Could not decrypt the saved SSH secret: ${err.message}`);
  }
  return value;
}

function expandHome(input) {
  const value = String(input || '').trim();
  if (!value) return '';
  if (value === '~') return os.homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(os.homedir(), value.slice(2));
  return value;
}

function normalizeHost(input = {}) {
  const host = String(input.host || '').trim();
  if (!host) throw new Error('Host is required.');
  if (!/^[A-Za-z0-9._:[\]-]{1,255}$/.test(host)) throw new Error('Enter a valid hostname or IP address.');
  const user = String(input.user || '').trim();
  if (!user) throw new Error('Username is required.');
  if (!/^[A-Za-z0-9._@-]{1,80}$/.test(user)) throw new Error('Enter a valid SSH username.');
  const port = Math.max(1, Math.min(65535, Number(input.port) || 22));
  const authType = input.authType === 'password' ? 'password' : 'key';
  const keyPath = expandHome(input.keyPath);
  if (authType === 'key' && !keyPath) throw new Error('Private key path is required.');
  const name = String(input.name || '').trim().slice(0, 60) || `${user}@${host}`;
  return {
    id: String(input.id || '').trim() || uid('ssh_'),
    name,
    host,
    port,
    user,
    authType,
    keyPath,
    fingerprint: String(input.fingerprint || '').trim(),
    createdAt: input.createdAt || new Date().toISOString(),
  };
}

function listHosts(config) {
  return (config?.ssh?.hosts || []).map(({ password, passphrase, ...rest }) => ({
    ...rest,
    passwordSet: Boolean(password),
    passphraseSet: Boolean(passphrase),
  }));
}

function findHost(config, idOrName) {
  const key = String(idOrName || '').trim();
  if (!key) throw new Error('Choose an SSH host.');
  const hosts = config?.ssh?.hosts || [];
  const host = hosts.find((item) => item.id === key)
    || hosts.find((item) => item.name === key)
    || hosts.find((item) => `${item.user}@${item.host}` === key);
  if (!host) throw new Error(`Unknown SSH host: ${key}`);
  return host;
}

function resolveKeyFile(host) {
  const file = expandHome(host.keyPath);
  if (!file) throw new Error('No private key path saved for this host.');
  if (!fs.existsSync(file)) throw new Error(`Private key not found: ${file}`);
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error(`Private key is not a file: ${file}`);
  return fs.readFileSync(file);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function connect(host, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const client = new Client();
    let fingerprint = '';
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      try { client.end(); } catch {}
      reject(err);
    };
    const options = {
      host: host.host,
      port: host.port || 22,
      username: host.user,
      readyTimeout: timeoutMs,
      keepaliveInterval: 10000,
      keepaliveCountMax: 3,
      hostHash: 'sha256',
      hostVerifier: (hashedKey) => {
        fingerprint = hashedKey;
        if (!host.fingerprint) return true;
        const expected = String(host.fingerprint).replace(/^sha256:/i, '');
        return hashedKey === expected;
      },
    };
    if (host.authType === 'password') {
      const password = unseal(host.password);
      if (!password) return fail(new Error('No password saved for this host.'));
      options.password = password;
    } else {
      try {
        options.privateKey = resolveKeyFile(host);
      } catch (err) {
        return fail(err);
      }
      if (host.passphrase) {
        try { options.passphrase = unseal(host.passphrase); } catch (err) { return fail(err); }
      }
      if (host.password) {
        try { options.passphrase = options.passphrase || unseal(host.password); } catch {}
      }
    }
    client.once('ready', () => {
      if (settled) return;
      settled = true;
      resolve({ client, fingerprint });
    });
    client.once('error', fail);
    try {
      client.connect(options);
    } catch (err) {
      fail(err);
    }
  });
}

function runCommand(host, command, { timeoutMs = 120000, cwd = '' } = {}) {
  const text = String(command || '');
  if (!text.trim()) return Promise.reject(new Error('Command is required.'));
  if (text.length > 20000) return Promise.reject(new Error('Command is too long.'));
  return new Promise(async (resolve, reject) => {
    let connected;
    try {
      connected = await connect(host);
    } catch (err) {
      reject(err);
      return;
    }
    const { client, fingerprint } = connected;
    let stdout = '';
    let stderr = '';
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { client.end(); } catch {}
      reject(new Error(`SSH command timed out after ${Math.round(timeoutMs / 1000)}s.`));
    }, Math.max(5000, Math.min(600000, Number(timeoutMs) || 120000)));
    const finish = (err, code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { client.end(); } catch {}
      if (err) reject(err);
      else resolve({
        stdout: stdout.slice(0, MAX_OUTPUT),
        stderr: stderr.slice(0, MAX_OUTPUT),
        code,
        truncated: stdout.length > MAX_OUTPUT || stderr.length > MAX_OUTPUT,
        host: host.name,
        fingerprint,
      });
    };
    const full = cwd ? `cd ${shellQuote(cwd)} && ${text}` : text;
    client.exec(full, (err, stream) => {
      if (err) return finish(err);
      stream.on('data', (chunk) => {
        if (stdout.length < MAX_OUTPUT * 1.2) stdout += chunk.toString('utf8');
      });
      stream.stderr.on('data', (chunk) => {
        if (stderr.length < MAX_OUTPUT * 1.2) stderr += chunk.toString('utf8');
      });
      stream.on('close', (code, signal) => {
        if (signal && !code) return finish(new Error(`SSH command ended with signal ${signal}.`));
        finish(null, Number(code) || 0);
      });
      stream.on('error', finish);
    });
  });
}

async function testHost(host) {
  const started = Date.now();
  const result = await runCommand(host, 'printf "blank-ssh-ok\\n"; uname -a 2>/dev/null || true', { timeoutMs: 20000 });
  return {
    ok: result.code === 0,
    code: result.code,
    latencyMs: Date.now() - started,
    fingerprint: result.fingerprint,
    output: (result.stdout || result.stderr || '').trim().slice(0, 2000),
  };
}

module.exports = {
  listHosts, normalizeHost, findHost, runCommand, testHost, seal, unseal, expandHome,
};
