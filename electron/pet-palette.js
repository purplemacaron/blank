'use strict';

/**
 * One paper color per provider, so every model from the same provider shares
 * the same sheet and switching between providers is visible at a glance.
 */

const DEFAULT_HUE = 214;

const PROVIDER_HUES = {
  anthropic: 24,
  openai: 152,
  google: 218,
  openrouter: 268,
  xai: 198,
  deepseek: 208,
  mistral: 34,
  groq: 6,
  together: 172,
  cerebras: 326,
  ollama: 118,
  lmstudio: 286,
};

const PROVIDER_TINTS = [
  [/upstage/i, 272],
  [/nvidia/i, 96],
  [/azure|microsoft/i, 204],
  [/aws|bedrock|amazon/i, 32],
  [/vertex/i, 220],
  [/perplexity/i, 188],
  [/fireworks/i, 12],
  [/moonshot|kimi/i, 254],
  [/qwen|alibaba|dashscope/i, 248],
  [/zhipu|glm/i, 230],
  [/cohere/i, 300],
  [/cloudflare/i, 38],
  [/github/i, 212],
];

function hash(value) {
  let result = 2166136261;
  const text = String(value || '');
  for (let i = 0; i < text.length; i += 1) {
    result ^= text.charCodeAt(i);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

/** The part of a model id before the first slash identifies its provider. */
function providerOf(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return '';
  const slash = text.indexOf('/');
  return slash > 0 ? text.slice(0, slash) : text;
}

function petHue(model) {
  const provider = providerOf(model);
  if (!provider) return DEFAULT_HUE;
  if (Number.isFinite(PROVIDER_HUES[provider])) return PROVIDER_HUES[provider];
  for (const [pattern, hue] of PROVIDER_TINTS) {
    if (pattern.test(provider)) return hue;
  }
  return 30 + (hash(provider) % 300);
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
    accent: dark ? `hsl(${hue}, 74%, 62%)` : `hsl(${hue}, 78%, 52%)`,
    accentSoft: dark ? `hsla(${hue}, 74%, 62%, 0.28)` : `hsla(${hue}, 78%, 52%, 0.22)`,
    accentInk: '#ffffff',
  };
}

module.exports = { petHue, petPalette };
