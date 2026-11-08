'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { petPalette } = require('../electron/pet-palette');
const motion = require('../electron/cursor-motion');
const { subagentTools } = require('../src/core/agent');

test('petPalette exposes a saturated accent that matches the provider hue in both themes', () => {
  const light = petPalette('openai/gpt-5.5', 'light');
  const dark = petPalette('openai/gpt-5.5', 'dark');
  assert.match(light.accent, /^hsl\(152, /);
  assert.match(dark.accent, /^hsl\(152, /);
  assert.notEqual(light.accent, dark.accent);
  assert.match(light.accentInk, /^#|^hsl\(/);
});

test('shortActor keeps the model name and drops provider prefixes', () => {
  assert.equal(motion.shortActor('openrouter/openai/gpt-5.5'), 'gpt-5.5');
  assert.equal(motion.shortActor('custom_upstage/solar-pro4'), 'solar-pro4');
  assert.equal(motion.shortActor('  anthropic/claude-sonnet-5  '), 'claude-sonnet-5');
  assert.equal(motion.shortActor(''), 'blank');
  assert.ok(motion.shortActor('x'.repeat(80)).length <= 18);
});

test('markerWindowPoint centers the cursor window on the pointer', () => {
  assert.deepEqual(motion.markerWindowPoint({ x: 400, y: 300 }, 200), { x: 300, y: 200 });
});

test('clampWindowToArea keeps the whole window on screen', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 };
  assert.deepEqual(motion.clampWindowToArea({ x: -80, y: -50 }, area, 200), { x: 0, y: 0 });
  assert.deepEqual(motion.clampWindowToArea({ x: 1800, y: 1000 }, area, 200), { x: 1720, y: 840 });
});

test('glideStep eases toward the target and reports when it arrives', () => {
  const first = motion.glideStep({ x: 0, y: 0 }, { x: 100, y: 50 }, 0.5);
  assert.deepEqual(first, { point: { x: 50, y: 25 }, done: false });
  const near = motion.glideStep({ x: 99.8, y: 49.9 }, { x: 100, y: 50 }, 0.35);
  assert.deepEqual(near, { point: { x: 100, y: 50 }, done: true });
});

test('subagents can control the computer; read-only workers only capture', () => {
  const write = subagentTools(true);
  const read = subagentTools(false);
  assert.ok(write.includes('computer_use'));
  assert.ok(write.includes('computer_screenshot'));
  assert.ok(read.includes('computer_screenshot'));
  assert.ok(!read.includes('computer_use'));
  assert.ok(!read.includes('write_file'));
  assert.ok(write.includes('write_file'));
});
