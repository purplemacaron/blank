'use strict';

/**
 * Model-aware reasoning stages.
 *
 * Providers expose different ladders: some models cannot think at all, some
 * are always on, and the adjustable ones range from none/minimal up to
 * xhigh/max/ultra. blank never shows a generic "auto" list — the catalog
 * attaches the exact stages each discovered model accepts, and requests are
 * translated to that provider's native parameter.
 */

const LEVELS = {
  none: { label: 'Non-reasoning', hint: 'Answers without a thinking pass' },
  minimal: { label: 'Minimal', hint: 'Shortest thinking pass' },
  low: { label: 'Low', hint: 'Fast, shallow' },
  medium: { label: 'Medium', hint: 'Balanced' },
  high: { label: 'High', hint: 'Deeper, slower' },
  xhigh: { label: 'xHigh', hint: 'Very deep thinking' },
  max: { label: 'Max', hint: 'Maximum reasoning' },
  ultra: { label: 'Ultra', hint: 'Highest effort and cost' },
};

const ORDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const FULL = ['none', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const FULL_WITH_MINIMAL = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
/* 'auto' is accepted from older sessions and configs, then normalized. */
const EFFORTS = ['auto', ...ORDER];

const LEVEL_ALIASES = {
  none: 'none',
  'non-reasoning': 'none',
  nonreasoning: 'none',
  non_reasoning: 'none',
  'no-reasoning': 'none',
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  'x-high': 'xhigh',
  'extra-high': 'xhigh',
  'extra high': 'xhigh',
  'very-high': 'xhigh',
  max: 'max',
  maximum: 'max',
  ultra: 'ultra',
  highest: 'ultra',
};

/** Map an API effort name onto our stage keys. */
function normalizeLevel(value) {
  const key = String(value ?? '').trim().toLowerCase();
  return LEVEL_ALIASES[key] || LEVEL_ALIASES[key.replace(/_/g, '-')] || null;
}

function pick(levels, fallback, transport) {
  return {
    levels,
    default: levels.includes(fallback) ? fallback : levels[Math.floor(levels.length / 2)] || levels[0],
    transport,
    fixed: levels.length <= 1,
  };
}

function fixed(label) {
  return { levels: [], default: '', transport: 'none', fixed: true, fixedLabel: label };
}

function off() {
  return { levels: ['none'], default: 'none', transport: 'none', fixed: true };
}

/**
 * Turn endpoint-reported reasoning metadata (or a probe result) into a stage
 * list. Only stages the endpoint actually named are kept.
 */
function profileFromHint(hint) {
  if (!hint || typeof hint !== 'object') return null;
  const source = ['probe', 'api'].includes(hint.source) ? hint.source : 'api';
  const listed = Array.isArray(hint.levels)
    ? hint.levels.map(normalizeLevel).filter(Boolean)
    : [];
  const levels = ORDER.filter((level) => listed.includes(level));
  const preferred = normalizeLevel(hint.default)
    || (levels.includes('medium') ? 'medium' : levels.includes('high') ? 'high' : '');
  if (levels.length > 1) {
    const profile = pick(levels, preferred, hint.transport || 'openai-effort');
    if (hint.mandatory) profile.levels = profile.levels.filter((level) => level !== 'none');
    if (!profile.levels.length) return { ...fixed(hint.fixedLabel || 'Always on'), source };
    profile.source = source;
    return profile;
  }
  if (levels.length === 1) {
    if (levels[0] === 'none') return { ...off(), source };
    return { ...pick(levels, levels[0], hint.transport || 'openai-effort'), fixed: true, source };
  }
  if (hint.alwaysOn) return { ...fixed(hint.fixedLabel || 'Always on'), source };
  if (hint.supported === false) return { ...off(), source };
  if (hint.supported === true) {
    const profile = pick(['low', 'medium', 'high'], normalizeLevel(hint.default), 'openai-effort');
    profile.source = source;
    return profile;
  }
  return null;
}

function openaiProfile(id) {
  if (/^gpt-6\.1|^gpt-6[.-].*sol|^gpt-6.*sol/.test(id)) return pick(['medium', 'high', 'xhigh', 'max', 'ultra'], 'medium', 'openai-effort');
  if (/^gpt-6.*astra/.test(id)) return pick(['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], 'medium', 'openai-effort');
  if (/^gpt-6/.test(id)) return pick(['none', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'], 'medium', 'openai-effort');
  if (/^gpt-5\.5/.test(id)) {
    if (/-pro/.test(id)) return pick(['medium', 'high', 'xhigh'], 'high', 'openai-effort');
    return pick(['none', 'low', 'medium', 'high', 'xhigh'], 'medium', 'openai-effort');
  }
  if (/^gpt-5\.1/.test(id)) {
    if (/-pro/.test(id)) return pick(['medium', 'high', 'xhigh'], 'high', 'openai-effort');
    if (/codex/.test(id)) return pick(['none', 'low', 'medium', 'high', 'xhigh'], 'medium', 'openai-effort');
    return pick(['none', 'low', 'medium', 'high'], 'medium', 'openai-effort');
  }
  if (/^gpt-5/.test(id)) {
    if (/-pro/.test(id)) return pick(['high'], 'high', 'openai-effort');
    if (/codex/.test(id)) return pick(['low', 'medium', 'high'], 'medium', 'openai-effort');
    return pick(['minimal', 'low', 'medium', 'high'], 'medium', 'openai-effort');
  }
  if (/^o1-mini/.test(id)) return null;
  if (/^o[1-9]/.test(id)) return pick(['low', 'medium', 'high'], 'medium', 'openai-effort');
  if (/^gpt-oss/.test(id)) return pick(['low', 'medium', 'high'], 'medium', 'openai-effort');
  if (/^(gpt-4|gpt-4o|gpt-4\.1|gpt-4\.5|chatgpt)/.test(id)) return off();
  return null;
}

function anthropicProfile(id) {
  const current = /claude-(?:opus|sonnet|haiku)-(\d+)(?:[.-](\d{1,2})(?!\d))?/.exec(id);
  const legacy = /claude-(\d+)(?:[.-](\d{1,2})(?!\d))?-(?:opus|sonnet|haiku)/.exec(id);
  const match = current || legacy;
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2] || 0);
  if (legacy) return major === 3 && minor === 7 ? pick(['low', 'medium', 'high'], 'medium', 'anthropic-budget') : off();
  if (major >= 5) return pick(['low', 'medium', 'high', 'xhigh', 'max'], 'high', 'anthropic-effort');
  if (major === 4 && minor >= 6) return pick(['low', 'medium', 'high', 'max'], 'high', 'anthropic-effort');
  if (major === 4 && minor === 5) return pick(['low', 'medium', 'high'], 'high', 'anthropic-effort');
  if (major === 4) return pick(['low', 'medium', 'high'], 'medium', 'anthropic-budget');
  return off();
}

function geminiProfile(id) {
  if (/gemini-3\.1.*pro/.test(id)) return pick(['low', 'medium', 'high'], 'high', 'gemini-level');
  if (/gemini-3.*pro/.test(id)) return pick(['low', 'high'], 'high', 'gemini-level');
  if (/gemini-3.*flash/.test(id)) return pick(['minimal', 'low', 'medium', 'high'], 'medium', 'gemini-level');
  if (/gemini-3/.test(id)) return pick(['low', 'medium', 'high'], 'medium', 'gemini-level');
  if (/gemini-2\.5.*flash/.test(id)) return pick(['none', 'low', 'medium', 'high'], 'medium', 'gemini-budget');
  if (/gemini-2\.5.*pro/.test(id)) return pick(['low', 'medium', 'high'], 'medium', 'gemini-budget');
  if (/^gemini-(1|2\.0)/.test(id)) return off();
  return null;
}

function xaiProfile(id) {
  const match = /grok-(\d+)(?:[.-](\d{1,2})(?!\d))?/.exec(id);
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2] || 0);
  if (major >= 4 && minor >= 6) return pick(['low', 'medium', 'high', 'xhigh'], 'high', 'xai-effort');
  if (major === 4 && minor === 3) return pick(['none', 'low', 'medium', 'high'], 'medium', 'xai-effort');
  if (major === 4 && minor >= 4) return pick(['low', 'medium', 'high'], 'high', 'xai-effort');
  if (major === 4) return pick(['low', 'high'], 'low', 'xai-effort');
  if (major === 3) return pick(['low', 'high'], 'low', 'xai-effort');
  return off();
}

function openProfile(id) {
  if (/gpt-oss|gpt_oss/.test(id)) return pick(['low', 'medium', 'high'], 'medium', 'openai-effort');
  if (/qwen3|qwq|deepseek-r1|reasoner|thinking/.test(id)) return fixed('Always on');
  if (/^(deepseek-v|deepseek-chat-v)/.test(id)) return pick(FULL, 'medium', 'openai-effort');
  if (/^(llama|mixtral|mistral|gemma|qwen(?!3)|phi|yi|jamba|fuyu|nemotron)/.test(id)) return off();
  return null;
}

function viaOpenRouter(profile) {
  if (!profile) return null;
  return profile.levels.length > 1 ? { ...profile, transport: 'openrouter' } : profile;
}

function openRouterProfile(id) {
  const short = id.includes('/') ? id.split('/').pop().toLowerCase() : id;
  const vendor = id.includes('/') ? id.split('/')[0].toLowerCase() : '';
  if (/openai/.test(vendor) || /^gpt-|^o[1-9]/.test(short)) {
    return viaOpenRouter(openaiProfile(short));
  }
  if (/anthropic/.test(vendor) || /^claude-/.test(short)) {
    return viaOpenRouter(anthropicProfile(short));
  }
  if (/google/.test(vendor) || /^gemini-/.test(short)) {
    return viaOpenRouter(geminiProfile(short));
  }
  if (/x-ai|xai/.test(vendor) || /^grok-/.test(short)) {
    return viaOpenRouter(xaiProfile(short));
  }
  if (/deepseek/.test(vendor) || /deepseek/.test(short)) {
    if (/r1|reasoner/.test(short)) return fixed('Always on');
    return off();
  }
  if (/qwen|qwq|z-ai|thudm|moonshot|minimax/.test(vendor) || /qwen3|qwq|glm-z|kimi.*(think|reason)|reasoner/.test(short)) {
    return pick(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'], 'medium', 'openrouter');
  }
  if (/mistral|meta-llama|google|microsoft/.test(vendor) || /^(gpt-4o|gpt-4\.1|llama|gemma|mistral|phi)/.test(short)) {
    return off();
  }
  if (/reason|think|r1|qwq/.test(short)) {
    return pick(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'], 'medium', 'openrouter');
  }
  return null;
}

function deepseekProfile(id) {
  if (/reasoner|r1/.test(id)) return fixed('Always on');
  if (/^(deepseek-chat|deepseek-v3)/.test(id)) return off();
  return null;
}

function mistralProfile(id) {
  if (/magistral/.test(id)) return fixed('Always on');
  if (/^(mistral|codestral|devstral|pixtral|ministral)/.test(id)) return off();
  return null;
}

function customProfile(id, hint) {
  const hinted = profileFromHint(hint);
  if (hinted) return hinted;
  /* A custom endpoint may not document itself. Keep only stages that are
     universally understood by OpenAI-compatible effort parameters, and let
     the background probe replace this guess with the endpoint's real set. */
  if (/gpt-oss|gpt_oss/.test(id)) return { ...pick(['low', 'medium', 'high'], 'medium', 'openai-effort'), source: 'fallback' };
  if (/qwen3|qwq|deepseek-r1|reasoner|thinking/.test(id)) return { ...fixed('Always on'), source: 'fallback' };
  return { ...pick(['low', 'medium', 'high'], 'medium', 'openai-effort'), source: 'fallback' };
}

/**
 * Returns the reasoning ladder for a model, or null when the model is
 * unknown and we cannot honestly offer a stage list. `hint` is capability
 * metadata from the provider's /models response or a live effort probe.
 */
function profileFor(providerId, modelId, hint = null) {
  const pid = String(providerId || '').toLowerCase();
  const id = String(modelId || '').split('/').pop().toLowerCase();
  if (!id) return null;
  if (pid.startsWith('custom_')) return customProfile(id, hint);
  if (pid === 'openrouter') return profileFromHint(hint) || openRouterProfile(String(modelId || '').toLowerCase());
  let native = null;
  if (pid === 'openai') native = openaiProfile(id);
  else if (pid === 'anthropic') native = anthropicProfile(id);
  else if (pid === 'google') native = geminiProfile(id);
  else if (pid === 'xai') native = xaiProfile(id);
  else if (pid === 'deepseek') native = deepseekProfile(id);
  else if (pid === 'mistral') native = mistralProfile(id);
  else if (['groq', 'together', 'cerebras'].includes(pid)) native = openProfile(id);
  else if (pid === 'ollama') {
    if (/^gpt-oss/.test(id)) native = pick(['low', 'medium', 'high'], 'medium', 'openai-effort');
    else if (/qwen3|qwq|deepseek-r1|reasoner|thinking/.test(id)) native = fixed('Always on');
    else native = off();
  } else if (pid === 'lmstudio') native = off();
  if (native) return native;
  return profileFromHint(hint);
}

function normalize(profile, value) {
  if (!profile || !Array.isArray(profile.levels) || !profile.levels.length) return '';
  const effort = String(value || '');
  if (profile.levels.includes(effort)) return effort;
  if (!effort || effort === 'auto') return profile.default || profile.levels[profile.levels.length - 1];
  const wanted = ORDER.indexOf(effort);
  if (wanted < 0) return profile.default || profile.levels[profile.levels.length - 1];
  let best = profile.levels[0];
  let distance = Infinity;
  for (const level of profile.levels) {
    const delta = Math.abs(ORDER.indexOf(level) - wanted);
    if (delta < distance) { best = level; distance = delta; }
  }
  return best;
}

function isEffort(value) {
  return EFFORTS.includes(String(value || ''));
}

module.exports = {
  LEVELS, ORDER, EFFORTS, normalizeLevel, profileFromHint, profileFor, normalize, isEffort,
};
