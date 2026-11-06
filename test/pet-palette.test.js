'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { petHue, petPalette } = require('../electron/pet-palette');

test('every model from one provider shares a sheet color', () => {
  assert.equal(
    petHue('custom_upstage/solar-pro4'),
    petHue('custom_upstage/solar-mini4'),
  );
  assert.equal(
    petHue('openai/gpt-5.5'),
    petHue('openai/gpt-5.5-mini'),
  );
});

test('different providers get visibly different sheets', () => {
  assert.notEqual(petHue('custom_upstage/solar-pro4'), petHue('custom_nvidia-nim/mistralai/large'));
  assert.notEqual(petHue('openai/gpt-5.5'), petHue('anthropic/claude-sonnet-5'));
  assert.notEqual(petHue('google/gemini-3'), petHue('deepseek/deepseek-v4'));
});

test('custom endpoints identify their provider by name', () => {
  assert.equal(petHue('custom_upstage/solar-pro4'), petHue('Upstage/anything'));
  assert.equal(petHue('custom_nvidia-nim/model'), petHue('NVIDIA NIM/model'));
});

test('the palette stays stable and has dark and light variants', () => {
  const light = petPalette('custom_upstage/solar-pro4', 'light');
  const again = petPalette('custom_upstage/solar-pro4', 'light');
  const dark = petPalette('custom_upstage/solar-pro4', 'dark');
  assert.deepEqual(light, again);
  assert.equal(light.hue, 272);
  assert.match(light.paper, /^hsl\(272, 58%, 83%\)$/);
  assert.match(dark.paper, /^hsl\(272, 26%, 34%\)$/);
  assert.notEqual(light.paper, dark.paper);
});

test('an empty model falls back to the blank blue', () => {
  assert.equal(petHue(''), 214);
  assert.equal(petPalette('', 'light').hue, 214);
});
