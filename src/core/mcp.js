'use strict';

const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const { slugify } = require('./paths');

const PROTOCOL = '2025-06-18';
const CLIENT_INFO = { name: 'blank', version: '1.0.0' };

function safeName(value) {
  return String(value || 'tool').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
}

function normalizeContent(result) {
  if (!result) return '';
  if (typeof result === 'string') return result;
  if (Array.isArray(result.content)) {
    return result.content.map((item) => {
      if (item.type === 'text') return item.text || '';
      if (item.type === 'image') return `[image: ${item.mimeType || 'image'}]`;
      if (item.type === 'audio') return `[audio: ${item.mimeType || 'audio'}]`;
      if (item.type === 'resource') {
        if (item.resource?.text) return item.resource.text;
        return `[resource: ${item.resource?.uri || 'unknown'}]`;
      }
      if (item.type === 'resource_link') return `[resource link: ${item.uri || item.name || ''}]`;
      return item.text || JSON.stringify(item).slice(0, 2000);
    }).join('\n').trim();
  }
  if (result.structuredContent) return JSON.stringify(result.structuredContent, null, 2);
  return JSON.stringify(result).slice(0, 4000);
}

class StdioClient {
  constructor(server) {
    this.server = server;
    this.child = null;
    this.buffer = '';
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = '';
    this.connected = false;
    this.tools = [];
    this.error = '';
  }

  async connect() {
    if (this.connected) return;
    this.error = '';
    const command = this.server.command || '';
    if (!command.trim()) throw new Error('No command configured.');
    this.child = spawn(command, {
      shell: true,
      cwd: this.server.cwd || process.cwd(),
      env: { ...process.env, ...(this.server.env || {}) },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stdout.on('data', (chunk) => this.onData(chunk));
    this.child.stderr.on('data', (chunk) => {
      this.stderr = (this.stderr + chunk.toString()).slice(-6000);
    });
    this.child.on('error', (err) => this.fail(err));
    this.child.on('exit', (code) => {
      if (this.connected) {
        this.fail(new Error(`MCP server exited${code != null ? ` (code ${code})` : ''}.${this.stderr ? `\n${this.stderr.slice(-1200)}` : ''}`));
      }
    });

    const init = await this.request('initialize', {
      protocolVersion: PROTOCOL,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    }, 25000);
    if (!init) throw new Error('No initialize response.');
    this.notify('notifications/initialized', {});
    this.tools = await this.listTools();
    this.connected = true;
  }

  async listTools() {
    const all = [];
    let cursor;
    for (let page = 0; page < 5; page += 1) {
      const result = await this.request('tools/list', cursor ? { cursor } : {}, 20000);
      if (Array.isArray(result?.tools)) all.push(...result.tools);
      if (!result?.nextCursor) break;
      cursor = result.nextCursor;
    }
    return all;
  }

  notify(method, params) {
    if (!this.child || this.child.killed) return;
    const payload = { jsonrpc: '2.0', method, params };
    try { this.child.stdin.write(`${JSON.stringify(payload)}\n`); } catch {}
  }

  request(method, params, timeout = 30000) {
    if (!this.child) return Promise.reject(new Error('MCP server is not running.'));
    const id = this.nextId++;
    const payload = { jsonrpc: '2.0', id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timed out: ${method}`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer, method });
      try {
        this.child.stdin.write(`${JSON.stringify(payload)}\n`);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  onData(chunk) {
    this.buffer += chunk.toString('utf8');
    let index;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      if (message.id != null && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
        else pending.resolve(message.result);
      }
    }
  }

  fail(err) {
    if (this.error === err.message) return;
    this.error = err.message;
    this.connected = false;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pending.clear();
  }

  async callTool(name, args = {}) {
    if (!this.connected) throw new Error(this.error || 'MCP server is not connected.');
    const result = await this.request('tools/call', { name, arguments: args }, 180000);
    return {
      content: normalizeContent(result) || '(no output)',
      isError: Boolean(result?.isError),
      meta: { mcp: this.server.id, tool: name },
    };
  }

  close() {
    this.connected = false;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('MCP server closed.'));
    }
    this.pending.clear();
    if (this.child && !this.child.killed) {
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(this.child.pid), '/T', '/F'], { windowsHide: true });
        } else {
          this.child.kill('SIGTERM');
        }
      } catch {}
    }
    this.child = null;
  }
}

class HttpClient {
  constructor(server) {
    this.server = server;
    this.nextId = 1;
    this.sessionId = '';
    this.connected = false;
    this.tools = [];
    this.error = '';
  }

  headers() {
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(this.server.headers || {}),
    };
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
    return headers;
  }

  async post(payload, timeout = 30000) {
    const response = await fetch(this.server.url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeout),
    });
    const session = response.headers.get('mcp-session-id');
    if (session) this.sessionId = session;
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`MCP HTTP ${response.status}: ${text.slice(0, 400) || response.statusText}`);
    }
    if (response.status === 202) return null;
    const type = response.headers.get('content-type') || '';
    if (type.includes('text/event-stream')) {
      const raw = await response.text();
      const messages = [];
      for (const block of raw.split(/\r?\n\r?\n/)) {
        const data = block.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
        if (!data) continue;
        try { messages.push(JSON.parse(data)); } catch {}
      }
      const match = messages.find((message) => message.id === payload.id);
      if (!match) throw new Error('MCP stream ended without a response.');
      return match;
    }
    const json = await response.json();
    return json;
  }

  async request(method, params, timeout = 30000) {
    const id = this.nextId++;
    const message = await this.post({ jsonrpc: '2.0', id, method, params }, timeout);
    if (message?.error) throw new Error(message.error.message || JSON.stringify(message.error));
    return message?.result;
  }

  async notify(method, params) {
    try {
      await this.post({ jsonrpc: '2.0', method, params }, 15000);
    } catch {}
  }

  async connect() {
    if (this.connected) return;
    this.error = '';
    if (!this.server.url) throw new Error('No MCP URL configured.');
    await this.request('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: CLIENT_INFO }, 25000);
    await this.notify('notifications/initialized', {});
    const all = [];
    let cursor;
    for (let page = 0; page < 5; page += 1) {
      const result = await this.request('tools/list', cursor ? { cursor } : {}, 20000);
      if (Array.isArray(result?.tools)) all.push(...result.tools);
      if (!result?.nextCursor) break;
      cursor = result.nextCursor;
    }
    this.tools = all;
    this.connected = true;
  }

  async callTool(name, args = {}) {
    if (!this.connected) throw new Error(this.error || 'MCP server is not connected.');
    const result = await this.request('tools/call', { name, arguments: args }, 180000);
    return {
      content: normalizeContent(result) || '(no output)',
      isError: Boolean(result?.isError),
      meta: { mcp: this.server.id, tool: name },
    };
  }

  close() {
    this.connected = false;
  }
}

class MCPManager extends EventEmitter {
  constructor() {
    super();
    this.clients = new Map();
    this.catalog = new Map();
    this.lastAttempt = new Map();
  }

  clientFor(server) {
    if (this.clients.has(server.id)) return this.clients.get(server.id);
    const client = server.transport === 'http' ? new HttpClient(server) : new StdioClient(server);
    this.clients.set(server.id, client);
    return client;
  }

  async ensure(config, { force = false } = {}) {
    const servers = (config.mcpServers || []).filter((server) => server.enabled !== false);
    const ids = new Set(servers.map((server) => server.id));
    for (const [id, client] of this.clients.entries()) {
      if (!ids.has(id)) {
        client.close();
        this.clients.delete(id);
      }
    }
    this.catalog.clear();
    await Promise.all(servers.map(async (server) => {
      let client = this.clientFor(server);
      const last = this.lastAttempt.get(server.id) || 0;
      if ((!client.connected || client.error) && !force && Date.now() - last < 15000) {
        // Avoid hammering a broken server on every model step.
      } else if (!client.connected) {
        this.lastAttempt.set(server.id, Date.now());
        try {
          client.close();
          client = this.clientFor(server);
          await client.connect();
        } catch (err) {
          client.error = err.message;
          client.connected = false;
        }
      }
      if (client.connected) {
        for (const tool of client.tools || []) {
          const fullName = `mcp__${safeName(server.id)}__${safeName(tool.name)}`;
          this.catalog.set(fullName, {
            name: fullName,
            originalName: tool.name,
            serverId: server.id,
            serverName: server.name,
            description: tool.description || '',
            inputSchema: tool.inputSchema || { type: 'object', properties: {} },
            annotations: tool.annotations || {},
          });
        }
      }
    }));
    return this.tools();
  }

  tools() {
    return [...this.catalog.values()];
  }

  find(fullName) {
    return this.catalog.get(fullName) || null;
  }

  async callTool(serverId, toolName, args) {
    const client = this.clients.get(serverId);
    if (!client) throw new Error('MCP server is not connected.');
    const info = [...this.catalog.values()].find((tool) => tool.serverId === serverId && (tool.name === toolName || tool.originalName === toolName));
    const actualName = info?.originalName || toolName;
    return await client.callTool(actualName, args);
  }

  statuses(config) {
    return (config.mcpServers || []).map((server) => {
      const client = this.clients.get(server.id);
      return {
        id: server.id,
        name: server.name,
        transport: server.transport || 'stdio',
        command: server.command || '',
        url: server.url || '',
        enabled: server.enabled !== false,
        connected: Boolean(client?.connected),
        toolCount: client?.connected ? (client.tools || []).length : 0,
        tools: client?.connected ? (client.tools || []).map((tool) => tool.name) : [],
        error: client?.error || '',
      };
    });
  }

  async closeAll() {
    for (const client of this.clients.values()) client.close();
    this.clients.clear();
    this.catalog.clear();
  }

  makeServer(input) {
    const transport = input.transport === 'http' ? 'http' : 'stdio';
    const base = slugify(input.name || 'mcp');
    const id = `mcp_${base}_${Math.random().toString(36).slice(2, 6)}`;
    const server = {
      id,
      name: String(input.name || '').trim() || 'MCP server',
      transport,
      enabled: input.enabled !== false,
      command: transport === 'stdio' ? String(input.command || '').trim() : '',
      cwd: input.cwd ? String(input.cwd) : '',
      url: transport === 'http' ? String(input.url || '').trim() : '',
      env: input.env && typeof input.env === 'object' ? input.env : {},
      headers: input.headers && typeof input.headers === 'object' ? input.headers : {},
    };
    if (transport === 'stdio' && !server.command) throw new Error('A stdio MCP server needs a command.');
    if (transport === 'http' && !/^https?:\/\//i.test(server.url)) throw new Error('HTTP MCP servers need an http(s) URL.');
    return server;
  }
}

module.exports = { MCPManager, normalizeContent, safeName };
