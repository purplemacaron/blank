'use strict';

/**
 * One paper color per model. The hue is derived from the model id so the same
 * model always gets the same pet, while different models get different sheets.
 */

const DEFAULT_HUE = 214;

function hash(value) {
  let result = 2166136261;
  const text = String(value || '');
  for (let i = 0; i < text.length; i += 1) {
    result ^= text.charCodeAt(i);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function petHue(model) {
  const id = String(model || '').trim();
  if (!id) return DEFAULT_HUE;
  return hash(id) % 360;
}

function petPalette(model, theme) {
  const hue = petHue(model);
  const dark = theme === 'dark';
  return {
    model: String(model || ''),
    hue,
    paper: dark ? `hsl(${hue}, 26%, 34%)` : `hsl(${hue}, 58%, 83%)`,
    fold: dark ? `hsl(${hue}, 22%, 27%)` : `hsl(${hue}, 44%, 74%)`,
    edge: dark ? `hsl(${hue}, 18%, 46%)` : `hsl(${hue}, 30%, 70%)`,
    ink: dark ? `hsl(${hue}, 24%, 95%)` : `hsl(${hue}, 34%, 19%)`,
    glow: dark ? `hsla(${hue}, 65%, 65%, 0.34)` : `hsla(${hue}, 72%, 52%, 0.26)`,
  };
}

module.exports = { petHue, petPalette };
