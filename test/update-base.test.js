'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { isTemporaryBuildPath } = require('../src/core/update-base');

const TEMP = 'C:\\Users\\me\\AppData\\Local\\Temp';

test('temporary build paths are rejected as update bases', () => {
  assert.equal(isTemporaryBuildPath(`${TEMP}\\blank-dist\\win-unpacked\\blank.exe`, TEMP), true);
  assert.equal(isTemporaryBuildPath('D:\\builds\\win-unpacked\\blank.exe', TEMP), true);
  assert.equal(isTemporaryBuildPath(`${TEMP}\\portable-9f2c\\blank.exe`, TEMP), true);
});

test('installed paths are accepted', () => {
  assert.equal(isTemporaryBuildPath('C:\\Users\\me\\AppData\\Local\\Programs\\blank\\blank.exe', TEMP), false);
  assert.equal(isTemporaryBuildPath('C:\\Program Files\\blank\\blank.exe', TEMP), false);
  assert.equal(isTemporaryBuildPath('C:\\Apps\\blank\\blank.exe', TEMP), false);
});

test('a temp root prefix without a path boundary is not a match', () => {
  assert.equal(isTemporaryBuildPath(`${TEMP}2\\blank\\blank.exe`, TEMP), false);
});

test('missing paths are safe', () => {
  assert.equal(isTemporaryBuildPath('', TEMP), false);
  assert.equal(isTemporaryBuildPath(undefined, TEMP), false);
});
