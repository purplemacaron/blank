'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { decodeConsole } = require('../src/core/encoding');

test('UTF-8 console output stays intact', () => {
  assert.equal(decodeConsole(Buffer.from('설정 창', 'utf8')), '설정 창');
});

test('Korean Windows code page output is decoded instead of turning into replacement characters', () => {
  const cp949 = Buffer.from([0xC7, 0xD1, 0xB1, 0xDB]);
  assert.equal(decodeConsole(cp949), '한글');
  assert.ok(!decodeConsole(cp949).includes('\uFFFD'));
});

test('empty console buffers yield an empty string', () => {
  assert.equal(decodeConsole(Buffer.alloc(0)), '');
  assert.equal(decodeConsole(null), '');
});

test('undecodable bytes fall back without throwing', () => {
  const text = decodeConsole(Buffer.from([0xFF, 0xFE, 0x00]));
  assert.equal(typeof text, 'string');
});
