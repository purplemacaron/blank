'use strict';

/**
 * Blank's model catalog. IDs are stable; anything can be overridden by adding a
 * custom provider or a discovered local model in Settings → Models.
 */
const PROVIDERS = [
  {
    id: 'sandbox',
    name: 'Blank Sandbox',
    monogram: 'b',
    protocol: 'sandbox',
    kind: 'local',
    description: 'An offline preview model. No network, no key, no data leaves your machine.',
    baseUrl: '',
    keyEnv: null,
    docs: '',
    models: [
      { id: 'blank-1', name: 'Blank 1', context: 32000, tags: ['Offline', 'Preview'], note: 'Guided demo' },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    monogram: 'A',
    protocol: 'anthropic',
    description: 'Claude models — strong long-horizon reasoning and tool use.',
    baseUrl: 'https://api.anthropic.com/v1',
    keyEnv: 'ANTHROPIC_API_KEY',
    docs: 'https://console.anthropic.com/settings/keys',
    models: [
      { id: 'claude-opus-4-1', name: 'Claude Opus 4.1', context: 200000, tags: ['Reasoning', 'Tools', 'Vision'] },
      { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', context: 200000, tags: ['Tools', 'Vision', 'Balanced'] },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', context: 200000, tags: ['Fast', 'Tools'] },
      { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', context: 200000, tags: ['Tools', 'Vision'] },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    monogram: 'O',
    protocol: 'openai',
    description: 'GPT and o-series models via the Responses-compatible chat API.',
    baseUrl: 'https://api.openai.com/v1',
    keyEnv: 'OPENAI_API_KEY',
    docs: 'https://platform.openai.com/api-keys',
    models: [
      { id: 'gpt-5.1', name: 'GPT-5.1', context: 400000, tags: ['Reasoning', 'Tools', 'Vision'] },
      { id: 'gpt-5.1-mini', name: 'GPT-5.1 mini', context: 400000, tags: ['Fast', 'Tools'] },
      { id: 'gpt-5', name: 'GPT-5', context: 400000, tags: ['Reasoning', 'Tools'] },
      { id: 'gpt-5-mini', name: 'GPT-5 mini', context: 400000, tags: ['Fast'] },
      { id: 'o4-mini', name: 'o4-mini', context: 200000, tags: ['Reasoning'] },
      { id: 'gpt-4.1', name: 'GPT-4.1', context: 1000000, tags: ['Tools', 'Vision'] },
      { id: 'gpt-4o', name: 'GPT-4o', context: 128000, tags: ['Vision', 'Fast'] },
    ],
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
    models: [
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', context: 1000000, tags: ['Reasoning', 'Tools', 'Vision'] },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', context: 1000000, tags: ['Fast', 'Tools', 'Vision'] },
      { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash-Lite', context: 1000000, tags: ['Fast'] },
    ],
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
    models: [
      { id: 'openrouter/auto', name: 'Auto router', context: 2000000, tags: ['Auto', 'Tools'] },
      { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5', context: 200000, tags: ['Tools'] },
      { id: 'openai/gpt-5.1', name: 'GPT-5.1', context: 400000, tags: ['Reasoning'] },
      { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', context: 1000000, tags: ['Reasoning'] },
      { id: 'x-ai/grok-4', name: 'Grok 4', context: 256000, tags: ['Reasoning'] },
      { id: 'deepseek/deepseek-chat-v3.1', name: 'DeepSeek V3.1', context: 128000, tags: ['Tools'] },
      { id: 'qwen/qwen3-coder', name: 'Qwen3 Coder', context: 256000, tags: ['Code'] },
    ],
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
    models: [
      { id: 'grok-4', name: 'Grok 4', context: 256000, tags: ['Reasoning', 'Tools'] },
      { id: 'grok-3-mini', name: 'Grok 3 mini', context: 131000, tags: ['Fast'] },
    ],
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
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek V3.2 Chat', context: 128000, tags: ['Tools', 'Code'] },
      { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', context: 128000, tags: ['Reasoning'] },
    ],
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
    models: [
      { id: 'mistral-large-latest', name: 'Mistral Large', context: 128000, tags: ['Tools'] },
      { id: 'devstral-medium-latest', name: 'Devstral Medium', context: 128000, tags: ['Code', 'Tools'] },
      { id: 'codestral-latest', name: 'Codestral', context: 256000, tags: ['Code', 'Fast'] },
    ],
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
    models: [
      { id: 'moonshotai/kimi-k2-instruct', name: 'Kimi K2', context: 256000, tags: ['Tools'] },
      { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B', context: 131000, tags: ['Reasoning'] },
      { id: 'meta-llama/llama-4-maverick-17b-128e-instruct', name: 'Llama 4 Maverick', context: 131000, tags: ['Fast'] },
      { id: 'qwen/qwen3-32b', name: 'Qwen3 32B', context: 131000, tags: ['Tools'] },
    ],
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
    models: [
      { id: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-Turbo', name: 'Llama 4 Maverick', context: 131000, tags: ['Fast'] },
      { id: 'Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8', name: 'Qwen3 Coder 480B', context: 256000, tags: ['Code'] },
      { id: 'deepseek-ai/DeepSeek-V3', name: 'DeepSeek V3', context: 128000, tags: ['Tools'] },
    ],
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
    models: [
      { id: 'gpt-oss-120b', name: 'GPT-OSS 120B', context: 131000, tags: ['Reasoning', 'Fast'] },
      { id: 'qwen-3-235b-a22b-instruct-2507', name: 'Qwen3 235B', context: 131000, tags: ['Tools'] },
      { id: 'llama-4-maverick-17b-128e-instruct', name: 'Llama 4 Maverick', context: 131000, tags: ['Fast'] },
    ],
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
    models: [
      { id: 'qwen3-coder:30b', name: 'Qwen3 Coder 30B', context: 256000, tags: ['Code', 'Local'] },
      { id: 'gpt-oss:20b', name: 'GPT-OSS 20B', context: 131000, tags: ['Reasoning', 'Local'] },
      { id: 'llama3.3:70b', name: 'Llama 3.3 70B', context: 128000, tags: ['Local'] },
      { id: 'qwen3:8b', name: 'Qwen3 8B', context: 40000, tags: ['Fast', 'Local'] },
      { id: 'deepseek-r1:8b', name: 'DeepSeek R1 8B', context: 64000, tags: ['Local'] },
    ],
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
    models: [
      { id: 'local-model', name: 'Loaded model', context: 32768, tags: ['Local'] },
    ],
  },
];

function allProviders(config = {}) {
  const custom = Array.isArray(config.customProviders) ? config.customProviders : [];
  return [...PROVIDERS, ...custom];
}

function getProvider(id, config = {}) {
  return allProviders(config).find((p) => p.id === id) || null;
}

function splitModel(fullId) {
  const value = String(fullId || '');
  const index = value.indexOf('/');
  if (index === -1) return { providerId: 'sandbox', modelId: value || 'blank-1' };
  return { providerId: value.slice(0, index), modelId: value.slice(index + 1) };
}

function allModels(config = {}) {
  const out = [];
  for (const provider of allProviders(config)) {
    const discovered = (config.discoveredModels && config.discoveredModels[provider.id]) || [];
    const merged = [...provider.models];
    for (const model of discovered) {
      if (!merged.some((m) => m.id === model.id)) merged.push(model);
    }
    for (const model of merged) {
      out.push({
        ...model,
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
    provider.models.find((m) => m.id === modelId) ||
    discovered.find((m) => m.id === modelId) ||
    { id: modelId, name: modelId, context: 128000, tags: [], custom: true };
  return {
    ...model,
    providerId,
    providerName: provider.name,
    protocol: provider.protocol,
    baseUrl: config.providers?.[providerId]?.baseUrl || provider.baseUrl,
    keyEnv: provider.keyEnv,
    fullId: `${providerId}/${modelId}`,
  };
}

function publicProvider(provider) {
  const { id, name, monogram, protocol, kind, description, baseUrl, keyEnv, docs, models } = provider;
  return { id, name, monogram, protocol, kind, description, baseUrl, keyEnv, docs, models };
}

module.exports = { PROVIDERS, allProviders, getProvider, splitModel, allModels, findModel, publicProvider };
