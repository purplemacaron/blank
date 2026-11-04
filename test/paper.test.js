'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'blank-paper-'));
process.env.BLANK_HOME = home;

const paper = require('../src/core/paper');

test.after(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

test('create stores a page and returns a sandbox preview url', () => {
  const created = paper.createPaper({
    title: 'Release notes',
    kind: 'html',
    content: '<html><body><h1>Release notes</h1></body></html>',
    description: 'What shipped.',
  });
  assert.equal(created.kindLabel, 'Page');
  assert.equal(created.version, 1);
  assert.equal(created.favorite, false);
  assert.match(created.previewUrl, /^blank-paper:\/\/view\/p_[a-z0-9]+\?v=1$/i);
  assert.ok(created.excerpt.includes('Release notes'));
  assert.ok(fs.existsSync(path.join(home, 'papers', created.id, 'paper.json')));
});

test('update bumps the version and keeps the same paper', () => {
  const created = paper.createPaper({ title: 'Draft', kind: 'markdown', content: '# Draft\n\nFirst.' });
  const updated = paper.updatePaper(created.id, { title: 'Draft two', content: '# Draft\n\nSecond.' });
  assert.equal(updated.id, created.id);
  assert.equal(updated.version, 2);
  assert.equal(updated.title, 'Draft two');
  assert.equal(updated.previewUrl, '');
  const read = paper.getPaperContent(created.id);
  assert.match(read.content, /Second/);
  assert.match(read.paper.excerpt, /Second/);
});

test('favorites sort first and count', () => {
  const created = paper.createPaper({ title: 'Star me', kind: 'svg', content: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' });
  assert.match(created.previewUrl, /^blank-paper:\/\/view\//);
  const starred = paper.toggleFavorite(created.id);
  assert.equal(starred.favorite, true);
  const list = paper.listPapers({ favorite: true });
  assert.equal(list.items[0].id, created.id);
  assert.equal(list.counts.favorite, 1);
});

test('list filters by kind and query', () => {
  const code = paper.createPaper({ title: 'Guard clause', kind: 'code', language: 'js', content: 'export const guard = true;' });
  assert.equal(code.kindLabel, 'Code');
  const byKind = paper.listPapers({ kind: 'code' });
  assert.equal(byKind.total, 1);
  const byQuery = paper.listPapers({ query: 'guard' });
  assert.equal(byQuery.total, 1);
  assert.equal(byQuery.items[0].id, code.id);
});

test('empty and oversized content are rejected', () => {
  assert.throws(() => paper.createPaper({ title: 'Empty', content: '   ' }), /empty/i);
  assert.throws(
    () => paper.createPaper({ title: 'Huge', content: 'x'.repeat(paper.MAX_CONTENT + 1) }),
    /too large/i,
  );
  assert.throws(() => paper.createPaper({ title: 'Bad kind', kind: 'wasm', content: 'x' }), /kind/i);
});

test('html fragments get a document shell, full documents pass through', () => {
  const fragment = paper.htmlDocument('<section>Hello</section>');
  assert.match(fragment, /^<!doctype html>/i);
  assert.match(fragment, /<section>Hello<\/section>/);
  const full = '<!doctype html><html><body>Full</body></html>';
  assert.equal(paper.htmlDocument(full), full);
});

test('export names use the right extension', () => {
  assert.equal(paper.exportFileName({ title: 'Brief', kind: 'html' }), 'Brief.html');
  assert.equal(paper.exportFileName({ title: 'Notes', kind: 'markdown' }), 'Notes.md');
  assert.equal(paper.exportFileName({ title: 'Mark', kind: 'svg' }), 'Mark.svg');
  assert.equal(paper.exportFileName({ title: 'Guard', kind: 'code', language: 'py' }), 'Guard.py');
});

test('remove deletes the paper folder', () => {
  const created = paper.createPaper({ title: 'Remove me', kind: 'markdown', content: '# Remove me' });
  const dir = path.join(home, 'papers', created.id);
  assert.ok(fs.existsSync(dir));
  const result = paper.removePaper(created.id);
  assert.equal(result.removed, true);
  assert.equal(fs.existsSync(dir), false);
  assert.equal(paper.getPaper(created.id), null);
});
