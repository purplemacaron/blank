'use strict';

/**
 * blank's provider catalog.
 *
 * Only user-entered custom models are hard-coded.
 * Every hosted and local provider is populated from its own /models endpoint:
 * hosted providers with your saved key, local runtimes without one. This
 * keeps the picker honest — no demo models are ever shown as available.
 */
const { profileFor } = require('./reasoning');

const PROVIDERS = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    monogram: 'A',
    protocol: 'anthropic',
    description: 'Claude models — strong long-horizon reasoning and tool use.',
    baseUrl: 'https://api.anthropic.com/v1',
    keyEnv: 'ANTHROPIC_API_KEY',
    docs: 'https://console.anthropic.com/settings/keys',
    models: [],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    monogram: 'O',
    protocol: 'openai',
    description: 'GPT and o-series models through the OpenAI API.',
    baseUrl: 'https://api.openai.com/v1',
    keyEnv: 'OPENAI_API_KEY',
    docs: 'https://platform.openai.com/api-keys',
    models: [],
  },
  {
    id: 'google',
    name: 'Google',
    monogram: 'G',
    protocol: 'gemini',
    description: 'Gemini models with long context and native function calling.',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    keyEnv: 'GEMINI_API_KEY',
    docs: 'https://aistudio.google.com/app/apikey',
    models: [],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    monogram: 'R',
    protocol: 'openai',
    description: 'One key for hundreds of hosted models and automatic routing.',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyEnv: 'OPENROUTER_API_KEY',
    docs: 'https://openrouter.ai/keys',
    models: [],
  },
  {
    id: 'xai',
    name: 'xAI',
    monogram: 'X',
    protocol: 'openai',
    description: 'Grok models with real-time flavored reasoning.',
    baseUrl: 'https://api.x.ai/v1',
    keyEnv: 'XAI_API_KEY',
    docs: 'https://console.x.ai',
    models: [],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    monogram: 'D',
    protocol: 'openai',
    description: 'Open-weight models with strong coding and reasoning value.',
    baseUrl: 'https://api.deepseek.com/v1',
    keyEnv: 'DEEPSEEK_API_KEY',
    docs: 'https://platform.deepseek.com/api_keys',
    models: [],
  },
  {
    id: 'mistral',
    name: 'Mistral',
    monogram: 'M',
    protocol: 'openai',
    description: 'European frontier and code models.',
    baseUrl: 'https://api.mistral.ai/v1',
    keyEnv: 'MISTRAL_API_KEY',
    docs: 'https://console.mistral.ai/api-keys',
    models: [],
  },
  {
    id: 'groq',
    name: 'Groq',
    monogram: 'Q',
    protocol: 'openai',
    description: 'Very fast inference on open models.',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyEnv: 'GROQ_API_KEY',
    docs: 'https://console.groq.com/keys',
    models: [],
  },
  {
    id: 'together',
    name: 'Together',
    monogram: 'T',
    protocol: 'openai',
    description: 'Open models, dedicated endpoints and fine-tunes.',
    baseUrl: 'https://api.together.xyz/v1',
    keyEnv: 'TOGETHER_API_KEY',
    docs: 'https://api.together.ai/settings/api-keys',
    models: [],
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    monogram: 'C',
    protocol: 'openai',
    description: 'Wafer-scale inference for open models.',
    baseUrl: 'https://api.cerebras.ai/v1',
    keyEnv: 'CEREBRAS_API_KEY',
    docs: 'https://cloud.cerebras.ai',
    models: [],
  },
  {
    id: 'ollama',
    name: 'Ollama',
    monogram: 'L',
    protocol: 'openai',
    kind: 'local',
    description: 'Your local Ollama runtime. Private by default.',
    baseUrl: 'http://localhost:11434/v1',
    keyEnv: null,
    docs: 'https://ollama.com',
    models: [],
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    monogram: 'S',
    protocol: 'openai',
    kind: 'local',
    description: 'Any model loaded in LM Studio’s local server.',
    baseUrl: 'http://localhost:1234/v1',
    keyEnv: null,
    docs: 'https://lmstudio.ai',
    models: [],
  },
];

function allProviders(config = {}) {
  const custom = Array.isArray(config.customProviders) ? config.customProviders : [];
  return [...PROVIDERS, ...custom];
}

function reasoningHintFor(providerId, model, config = {}) {
  const cache = config.reasoningHints?.[`${providerId}/${model.id}`];
  if (cache && (cache.source === 'probe' || !model.reasoningHint)) return cache;
  return model.reasoningHint || cache || null;
}

/**
 * Whether a model accepts an image attachment. Explicit endpoint metadata wins;
 * otherwise only families known to accept images are marked.
 */
function visionFor(providerId, modelId, hint) {
  if (typeof hint === 'boolean') return hint;
  const pid = String(providerId || '').toLowerCase();
  const id = String(modelId || '').toLowerCase();
  if (pid === 'openai') return /^(gpt-4o|gpt-4\.1|gpt-4\.5|gpt-5|gpt-6|o[1-9](?!-mini))/.test(id);
  if (pid === 'anthropic') return /claude-(3|4|5)/.test(id);
  if (pid === 'google') return /gemini-(1\.5|2|3)/.test(id);
  if (pid === 'xai') return /grok-(2.*vision|3|4)/.test(id);
  if (pid === 'openrouter') return false;
  if (pid.startsWith('custom_')) {
    return /(vision|-vl\b|\bvl\b|llava|pixtral|gpt-4o|claude-|gemini-)/i.test(id);
  }
  if (['groq', 'together', 'cerebras', 'ollama', 'lmstudio', 'mistral'].includes(pid)) {
    return /(vision|-vl\b|\bvl\b|llava|pixtral|llama-3\.2|gemma-3|qwen2\.5-vl)/i.test(id);
  }
  return false;
}

function getProvider(id, config = {}) {
  return allProviders(config).find((p) => p.id === id) || null;
}

function splitModel(fullId) {
  const value = String(fullId || '').trim();
  const index = value.indexOf('/');
  if (index <= 0) return { providerId: '', modelId: value };
  return { providerId: value.slice(0, index), modelId: value.slice(index + 1) };
}

function providerModels(provider, config = {}) {
  const discovered = (config.discoveredModels && config.discoveredModels[provider.id]) || [];
  const models = [];
  for (const model of provider.models || []) {
    if (!models.some((entry) => entry.id === model.id)) models.push(model);
  }
  for (const model of discovered) {
    if (!models.some((entry) => entry.id === model.id)) models.push(model);
  }
  return models;
}

function allModels(config = {}) {
  const out = [];
  for (const provider of allProviders(config)) {
    for (const model of providerModels(provider, config)) {
      out.push({
        ...model,
        reasoning: profileFor(provider.id, model.id, reasoningHintFor(provider.id, model, config)),
        vision: visionFor(provider.id, model.id, model.vision),
        providerId: provider.id,
        providerName: provider.name,
        monogram: provider.monogram,
        local: provider.kind === 'local',
        fullId: `${provider.id}/${model.id}`,
      });
    }
  }
  return out;
}

function findModel(fullId, config = {}) {
  const { providerId, modelId } = splitModel(fullId);
  const provider = getProvider(providerId, config);
  if (!provider) return null;
  const discovered = (config.discoveredModels && config.discoveredModels[providerId]) || [];
  const model =
    (provider.models || []).find((m) => m.id === modelId) ||
    discovered.find((m) => m.id === modelId) ||
    { id: modelId, name: modelId, context: 128000, tags: [], custom: true };
  return {
    ...model,
    reasoning: profileFor(providerId, modelId, reasoningHintFor(providerId, model, config)),
    vision: visionFor(providerId, modelId, model.vision),
    providerId,
    providerName: provider.name,
    protocol: provider.protocol,
    baseUrl: config.providers?.[providerId]?.baseUrl || provider.baseUrl,
    keyEnv: provider.keyEnv,
    fullId: `${providerId}/${modelId}`,
  };
}

function publicProvider(provider, config = {}) {
  const { id, name, monogram, protocol, kind, description, baseUrl, keyEnv, docs } = provider;
  const models = providerModels(provider, config).map((model) => ({
    ...model,
    reasoning: profileFor(id, model.id, reasoningHintFor(id, model, config)),
    vision: visionFor(id, model.id, model.vision),
  }));
  return { id, name, monogram, protocol, kind, description, baseUrl, keyEnv, docs, models };
}

module.exports = { PROVIDERS, allProviders, getProvider, splitModel, allModels, findModel, publicProvider, providerModels };
