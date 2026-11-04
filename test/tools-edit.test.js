'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'blank-tools-edit-'));
process.env.BLANK_HOME = home;

const { executeTool, getToolDefinition, summarizeArgs } = require('../src/core/tools');

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'blank-workspace-edit-'));

function ctx() {
  return {
    workspace,
    session: { id: 's_edit_test' },
    config: {
      approvals: { mode: 'important' },
      permissions: { edit_file: 'allow', write_file: 'allow', deliver_file: 'allow' },
    },
    mode: 'agent',
  };
}

function read(relative) {
  return fs.readFileSync(path.join(workspace, relative), 'utf8');
}

test('edit_file keeps exact string replacement working', async () => {
  fs.writeFileSync(path.join(workspace, 'exact.txt'), 'alpha\nbeta\ngamma\n', 'utf8');
  const result = await executeTool({
    name: 'edit_file',
    args: { path: 'exact.txt', old_string: 'beta', new_string: 'BETA' },
  }, ctx());
  assert.equal(result.isError, undefined);
  assert.match(result.content, /Edited exact\.txt/);
  assert.equal(read('exact.txt'), 'alpha\nBETA\ngamma\n');
});

test('edit_file replaces only the requested line range', async () => {
  fs.writeFileSync(path.join(workspace, 'range.txt'), 'one\ntwo\nthree\nfour\nfive\n', 'utf8');
  const result = await executeTool({
    name: 'edit_file',
    args: { path: 'range.txt', start_line: 2, end_line: 4, new_string: 'TWO\nTHREE' },
  }, ctx());
  assert.equal(result.isError, undefined);
  assert.match(result.content, /Replaced lines 2–4 with 2 lines/);
  assert.equal(result.meta.startLine, 2);
  assert.equal(read('range.txt'), 'one\nTWO\nTHREE\nfive\n');
});

test('edit_file range defaults end_line to start_line and keeps CRLF', async () => {
  fs.writeFileSync(path.join(workspace, 'crlf.txt'), 'a\r\nb\r\nc\r\n', 'utf8');
  const result = await executeTool({
    name: 'edit_file',
    args: { path: 'crlf.txt', start_line: 2, new_string: 'B2' },
  }, ctx());
  assert.equal(result.isError, undefined);
  assert.equal(read('crlf.txt'), 'a\r\nB2\r\nc\r\n');
});

test('edit_file range with an empty new_string deletes those lines', async () => {
  fs.writeFileSync(path.join(workspace, 'delete.txt'), 'keep\ndrop\nkeep too\n', 'utf8');
  const result = await executeTool({
    name: 'edit_file',
    args: { path: 'delete.txt', start_line: 2, end_line: 2, new_string: '' },
  }, ctx());
  assert.equal(result.isError, undefined);
  assert.equal(read('delete.txt'), 'keep\nkeep too\n');
});

test('edit_file rejects an out-of-range line span', async () => {
  fs.writeFileSync(path.join(workspace, 'short.txt'), 'only\n', 'utf8');
  const result = await executeTool({
    name: 'edit_file',
    args: { path: 'short.txt', start_line: 1, end_line: 9, new_string: 'nope' },
  }, ctx());
  assert.equal(result.isError, true);
  assert.match(result.content, /past the end/);
  assert.equal(read('short.txt'), 'only\n');
});

test('deliver_file returns a downloadable card for a workspace file', async () => {
  fs.writeFileSync(path.join(workspace, 'report.md'), '# Report\n\nDone.\n', 'utf8');
  const result = await executeTool({
    name: 'deliver_file',
    args: { path: 'report.md', title: 'Weekly report', note: 'Summary of the work' },
  }, ctx());
  assert.equal(result.isError, undefined);
  assert.equal(result.meta.deliverable, true);
  assert.equal(result.meta.path, 'report.md');
  assert.equal(result.meta.title, 'Weekly report');
  assert.equal(result.meta.fileName, 'report.md');
  assert.equal(result.meta.note, 'Summary of the work');
  assert.equal(result.meta.bytes, Buffer.byteLength('# Report\n\nDone.\n'));
  assert.equal(getToolDefinition('deliver_file').planSafe, true);
  assert.equal(summarizeArgs('deliver_file', { path: 'report.md', title: 'Weekly report' }), 'Weekly report');
});

test('deliver_file refuses missing paths and folders', async () => {
  const missing = await executeTool({ name: 'deliver_file', args: { path: 'nope.md' } }, ctx());
  assert.equal(missing.isError, true);
  assert.match(missing.content, /File not found/);
  fs.mkdirSync(path.join(workspace, 'folder'), { recursive: true });
  const folder = await executeTool({ name: 'deliver_file', args: { path: 'folder' } }, ctx());
  assert.equal(folder.isError, true);
  assert.match(folder.content, /directory/);
});
