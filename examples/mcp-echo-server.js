#!/usr/bin/env node
'use strict';

/**
 * A tiny, dependency-free MCP server used to verify Blank's MCP loop.
 * Speaks newline-delimited JSON-RPC 2.0 on stdio.
 */

process.stderr.write('[blank-echo-mcp] started\n');

const tools = [
  {
    name: 'echo',
    description: 'Echo text back. Useful for verifying that an MCP connection works.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Text to echo.' } },
      required: ['text'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'add',
    description: 'Add two numbers and return the result.',
    inputSchema: {
      type: 'object',
      properties: { a: { type: 'number' }, b: { type: 'number' } },
      required: ['a', 'b'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'now',
    description: 'Return the current date and time in ISO 8601 format.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
];

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function respond(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function fail(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

function handle(message) {
  if (message.method === 'initialize') {
    respond(message.id, {
      protocolVersion: message.params?.protocolVersion || '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'blank-echo', version: '1.0.0' },
    });
    return;
  }
  if (message.method === 'notifications/initialized') return;
  if (message.method === 'ping') {
    respond(message.id, {});
    return;
  }
  if (message.method === 'tools/list') {
    respond(message.id, { tools });
    return;
  }
  if (message.method === 'tools/call') {
    const { name, arguments: args = {} } = message.params || {};
    if (name === 'echo') {
      respond(message.id, { content: [{ type: 'text', text: String(args.text ?? '') }] });
      return;
    }
    if (name === 'add') {
      const a = Number(args.a);
      const b = Number(args.b);
      if (!Number.isFinite(a) || !Number.isFinite(b)) {
        respond(message.id, { content: [{ type: 'text', text: 'a and b must be numbers.' }], isError: true });
        return;
      }
      respond(message.id, { content: [{ type: 'text', text: String(a + b) }] });
      return;
    }
    if (name === 'now') {
      respond(message.id, { content: [{ type: 'text', text: new Date().toISOString() }] });
      return;
    }
    respond(message.id, { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true });
    return;
  }
  if (message.id != null) fail(message.id, -32601, `Method not found: ${message.method}`);
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    try {
      handle(JSON.parse(line));
    } catch (err) {
      process.stderr.write(`[blank-echo-mcp] ${err.message}\n`);
    }
  }
});
process.stdin.on('end', () => process.exit(0));
