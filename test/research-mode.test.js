'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const previousHome = process.env.BLANK_HOME;
const temporaryHome = fs.mkdtempSync(path.join(os.tmpdir(), 'blank-research-test-'));
process.env.BLANK_HOME = temporaryHome;
test.after(() => {
  if (previousHome === undefined) delete process.env.BLANK_HOME;
  else process.env.BLANK_HOME = previousHome;
  fs.rmSync(temporaryHome, { recursive: true, force: true });
});

const http = require('node:http');
const { buildSystemPrompt } = require('../src/core/prompt');
const { getToolDefinitions, executeTool } = require('../src/core/tools');
const { runSubagent } = require('../src/core/agent');

function prompt(mode) {
  return buildSystemPrompt({
    workspace: '',
    mode,
    config: {},
    model: 'ollama/qwen3.8:27b',
    skills: [],
    memories: [],
    session: { messages: [] },
  });
}

test('research mode asks for a cited, decision-ready brief', () => {
  const text = prompt('research');
  assert.match(text, /Research mode/);
  assert.match(text, /read_skill/, 'the bundled research procedure should be loaded');
  assert.match(text, /cite|source|URL/i, 'external claims need sources');
});

test('research mode keeps tools read-only and includes web research', () => {
  const names = getToolDefinitions({ mode: 'research', config: {} }).map((tool) => tool.name);
  for (const needed of ['read_file', 'grep', 'web_search', 'web_fetch', 'read_skill', 'create_paper']) {
    assert.ok(names.includes(needed), `research mode should offer ${needed}`);
  }
  for (const blocked of ['write_file', 'edit_file', 'run_command', 'computer_use', 'generate_media']) {
    assert.ok(!names.includes(blocked), `research mode should not offer ${blocked}`);
  }
});

function executionContext() {
  return {
    mode: 'research',
    workspace: fs.mkdtempSync(path.join(temporaryHome, 'workspace-')),
    config: { approvals: { mode: 'all' } },
    session: { id: 'research-test', allowTools: [] },
  };
}

for (const preapproved of [false, true]) {
  test(`research execution prevents file writes ${preapproved ? 'despite existing approval' : 'before requesting approval'}`, async () => {
    const ctx = executionContext();
    const target = path.join(ctx.workspace, 'output.txt');
    if (preapproved) {
      ctx.config.permissions = { write_file: 'allow' };
      ctx.session.allowTools = ['write_file'];
      fs.writeFileSync(target, 'original', 'utf8');
    }
    let approvals = 0;
    ctx.requestApproval = async () => { approvals++; return 'allow'; };

    const result = await executeTool({ name: 'write_file', args: { path: 'output.txt', content: 'changed' } }, ctx);

    if (preapproved) assert.equal(fs.readFileSync(target, 'utf8'), 'original');
    else assert.equal(fs.existsSync(target), false, 'no file should be created');
    assert.equal(approvals, 0, 'mode restrictions must precede approval');
    assert.equal(result.isError, true);
    assert.match(result.content, /Research mode/);
  });
}

for (const name of ['mcp__test__write', 'unknown_tool']) {
  test(`research execution denies ${name} before approval or dispatch`, async () => {
    const ctx = executionContext();
    let approvals = 0;
    let remoteCalls = 0;
    ctx.requestApproval = async () => { approvals++; return 'allow'; };
    ctx.mcp = { callTool: async () => { remoteCalls++; return { content: 'executed' }; } };

    const result = await executeTool({ name, args: {} }, ctx);

    assert.equal(approvals, 0, 'unlisted tools must not request approval');
    assert.equal(remoteCalls, 0, 'unlisted MCP tools must not execute');
    assert.equal(result.isError, true);
    assert.match(result.content, /Research mode/);
  });
}

test('research execution rejects write delegation without invoking the worker', async () => {
  const ctx = executionContext();
  let delegated = 0;
  ctx.delegate = async () => { delegated++; return 'write worker ran'; };

  const result = await executeTool({ name: 'delegate', args: { task: 'Change a file', write: true } }, ctx);

  assert.equal(delegated, 0, 'write work must not reach the delegate callback');
  assert.equal(result.isError, true);
  assert.match(result.content, /Research mode.*read-only/);
});

for (const write of [undefined, false]) {
  test(`research execution allows read-only delegation with write ${write}`, async () => {
    const ctx = executionContext();
    fs.writeFileSync(path.join(ctx.workspace, 'source.txt'), 'research evidence', 'utf8');
    const delegated = [];
    ctx.delegate = async (task, options) => {
      delegated.push({ task, options });
      const result = await executeTool({ name: 'read_file', args: { path: 'source.txt' } }, ctx);
      assert.notEqual(result.isError, true);
      return result.content;
    };
    ctx.requestApproval = async () => 'allow';
    const args = { task: 'Read the evidence', name: 'Reader', steps: 2 };
    if (write !== undefined) args.write = write;

    const result = await executeTool({ name: 'delegate', args }, ctx);

    assert.notEqual(result.isError, true);
    assert.match(result.content, /research evidence/);
    assert.deepEqual(result.meta, { delegated: true, write: false });
    assert.deepEqual(delegated, [{ task: args.task, options: { write: false, name: 'Reader', steps: 2 } }]);
  });
}

test('read-only subagents cannot write even when approvals would allow it', async (t) => {
  const workspace = fs.mkdtempSync(path.join(temporaryHome, 'subagent-'));
  let requests = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      requests += 1;
      const delta = requests === 1
        ? { tool_calls: [{ index: 0, id: 'w1', type: 'function', function: { name: 'write_file', arguments: '{"path":"escaped.txt","content":"owned"}' } }] }
        : { content: 'done' };
      res.setHeader('content-type', 'text/event-stream');
      res.end(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: delta.tool_calls ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const config = {
    providers: { ollama: { baseUrl: `http://127.0.0.1:${server.address().port}/v1` } },
    discoveredModels: {},
    agent: {},
  };
  let approvals = 0;
  const report = await runSubagent({
    task: 'Inspect the workspace.',
    parentSession: { id: 'parent', mode: 'research' },
    config,
    modelId: 'ollama/qwen3.8:27b',
    workspace,
    usageOut: { input: 0, output: 0 },
    requestApproval: async () => { approvals += 1; return 'allow'; },
  });
  assert.equal(fs.existsSync(path.join(workspace, 'escaped.txt')), false, 'a hallucinated write from a read-only subagent must not land');
  assert.equal(approvals, 0, 'the read-only gate rejects before asking approval');
  assert.match(report, /done/);
});
