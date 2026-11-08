'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { PassThrough } = require('stream');
const { runTui } = require('../src/cli/tui/app');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fakeOutput() {
  const chunks = [];
  return {
    columns: 90,
    rows: 24,
    isTTY: true,
    write(value) { chunks.push(String(value)); return true; },
    on() {},
    off() {},
    text() { return chunks.join(''); },
  };
}

function fakeInput() {
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  input.pause = () => {};
  return input;
}

function fakeRuntime(overrides = {}) {
  const runtime = {
    session: {
      id: 's1',
      title: 'New session',
      model: 'local/qwen',
      mode: 'agent',
      usage: null,
      messages: [],
    },
    workspace: 'C:/work/blank',
    verbose: false,
    autoYes: true,
    active: false,
    commands: [],
    listModels: () => [{ fullId: 'local/qwen', name: 'Qwen' }],
    listSessions: () => [],
    abort() {},
    async close() {},
    async command(line, { print }) {
      this.commands.push(line);
      print(`  ran ${line}`);
      return { action: 'done' };
    },
    async run(text, { emit }) {
      emit({ type: 'assistant:start' });
      emit({ type: 'text', delta: 'hello from model' });
      emit({ type: 'assistant:end', message: { content: 'hello from model' } });
      this.session.usage = { input: 12, output: 5 };
      return { ok: true, steps: 1 };
    },
    ...overrides,
  };
  return runtime;
}

test('a full TUI session streams a reply and restores the terminal', async () => {
  const input = fakeInput();
  const output = fakeOutput();
  const runtime = fakeRuntime();
  const done = runTui(runtime, { color: false, input, output });

  await delay(50);
  assert.match(output.text(), /blank v/);
  assert.match(output.text(), /ready/);

  input.write('/mode design');
  await delay(60);
  assert.match(output.text(), /\/mode design/);

  input.write('\r');
  await delay(80);
  assert.deepStrictEqual(runtime.commands, ['/mode design']);
  assert.match(output.text(), /ran \/mode design/);

  input.write('hi there');
  await delay(60);
  assert.match(output.text(), /hi there/);

  input.write('\r');
  await delay(150);
  assert.match(output.text(), /hello from model/);
  assert.match(output.text(), /12 in · 5 out/);

  input.write('\u0004');
  await done;
  assert.match(output.text(), /\u001b\[\?1049l/);
  assert.match(output.text(), /\u001b\[\?25h/);
});

test('approval keys resolve the pending request', async () => {
  const input = fakeInput();
  const output = fakeOutput();
  let decision = null;
  const runtime = fakeRuntime({
    autoYes: false,
    async run(text, { requestApproval }) {
      decision = await requestApproval({
        tool: 'run_command',
        label: 'Run command',
        reason: 'writes files',
        args: { command: 'npm test' },
      });
      return { ok: false, stopped: true };
    },
  });
  const done = runTui(runtime, { color: false, input, output });

  input.write('run the tests\r');
  await delay(100);
  assert.match(output.text(), /approval needed/);
  assert.match(output.text(), /\[y\] allow/);

  input.write('n');
  await delay(100);
  assert.strictEqual(decision, 'deny');

  input.write('\u0004');
  await done;
});
