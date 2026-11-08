'use strict';

const { findModel, getProvider } = require('./catalog');
const { resolveKey, keyCandidates, noteKeyUsage } = require('./config');
const reasoning = require('./reasoning');

const ANTHROPIC_VERSION = '2023-06-01';

function trimBase(url) {
  return String(url || '').replace(/\/+$/, '');
}

function contentForModel(message) {
  let content = String(message.content || '');
  if (Array.isArray(message.attachments) && message.attachments.length) {
    const blocks = message.attachments
      .map((file) => `<attached_file name="${file.name}">\n${file.content}\n</attached_file>`)
      .join('\n\n');
    content = content ? `${content}\n\n${blocks}` : blocks;
  }
  return content;
}

function imagesFor(message) {
  if (!Array.isArray(message.images)) return [];
  return message.images.filter((image) => image && image.mime && image.data);
}

function openaiUserContent(message) {
  const text = contentForModel(message);
  const images = imagesFor(message);
  if (!images.length) return text;
  const parts = [];
  if (text) parts.push({ type: 'text', text });
  for (const image of images) {
    parts.push({ type: 'image_url', image_url: { url: `data:${image.mime};base64,${image.data}` } });
  }
  return parts;
}

function anthropicUserContent(message) {
  const text = contentForModel(message);
  const images = imagesFor(message);
  if (!images.length) return text;
  const blocks = [];
  if (text) blocks.push({ type: 'text', text });
  for (const image of images) {
    blocks.push({ type: 'image', source: { type: 'base64', media_type: image.mime, data: image.data } });
  }
  return blocks;
}

function geminiUserParts(message) {
  const text = contentForModel(message);
  const parts = [];
  if (text) parts.push({ text });
  for (const image of imagesFor(message)) {
    parts.push({ inlineData: { mimeType: image.mime, data: image.data } });
  }
  return parts.length ? parts : [{ text: '' }];
}

function providerError(res, body, fields) {
  let detail = body || '';
  try {
    const json = JSON.parse(body);
    detail = json.error?.message || json.message || json.error || body;
    if (typeof detail === 'object') detail = JSON.stringify(detail);
  } catch {}
  const sent = Array.isArray(fields) && fields.length ? ` [sent: ${fields.join(', ')}]` : '';
  const error = new Error(`${res.status} ${res.statusText}${detail ? ` — ${String(detail).slice(0, 500)}` : ''}${sent}`);
  error.status = res.status;
  return error;
}

async function readError(res, fields) {
  let body = '';
  try { body = await res.text(); } catch {}
  throw providerError(res, body, fields);
}

async function* sseEvents(response) {
  const decoder = new TextDecoder();
  let buffer = '';
  const parseFrame = (frame) => {
    let event = 'message';
    const data = [];
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    return { event, data: data.join('\n') };
  };
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    buffer = buffer.replace(/\r\n/g, '\n');
    let index = buffer.indexOf('\n\n');
    while (index >= 0) {
      const frame = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      if (frame.trim()) yield parseFrame(frame);
      index = buffer.indexOf('\n\n');
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) yield parseFrame(buffer);
}

function withTimeout(signal, ms = 600000) {
  if (!signal) return AbortSignal.timeout(ms);
  try {
    return AbortSignal.any([signal, AbortSignal.timeout(ms)]);
  } catch {
    return signal;
  }
}

/* ------------------------------------------------------------------ OpenAI */

async function* openaiStream({ resolved, apiKey, system, messages, tools, options, signal }) {
  const base = trimBase(resolved.baseUrl);
  const body = {
    model: resolved.id,
    messages: [{ role: 'system', content: system }, ...messages.map((message) => {
      if (message.role === 'assistant') {
        const out = { role: 'assistant', content: message.content || null };
        if (Array.isArray(message.toolCalls) && message.toolCalls.length) {
          out.tool_calls = message.toolCalls.map((call, index) => ({
            id: call.id || `call_${index}`,
            type: 'function',
            function: {
              name: call.name,
              arguments: typeof call.args === 'string' ? call.args : JSON.stringify(call.args || {}),
            },
          }));
        }
        return out;
      }
      if (message.role === 'tool') {
        return { role: 'tool', tool_call_id: message.toolCallId, content: String(message.content || '') };
      }
      return { role: 'user', content: openaiUserContent(message) };
    })],
    stream: true,
    stream_options: { include_usage: true },
  };
  if (typeof options.temperature === 'number') body.temperature = options.temperature;
  // Utility calls (titles, compaction) must answer, not think: Ollama models
  // with an always-on thinking pass otherwise spend the whole budget reasoning
  // and take a minute per summary. Only cap the output where thinking is off.
  const utilityCall = Boolean(options.disableReasoning) && resolved.providerId === 'ollama';
  if (utilityCall && options.capMaxTokens && Number.isFinite(options.maxTokens)) {
    body.max_tokens = Math.floor(options.maxTokens);
  }
  if (options.reasoningEffort) {
    const effort = options.reasoningEffort;
    if (options.reasoningTransport === 'openrouter') {
      body.reasoning = effort === 'none' ? { enabled: false } : { effort };
    } else if (options.reasoningTransport === 'openai-effort' || options.reasoningTransport === 'xai-effort') {
      body.reasoning_effort = effort;
    }
  }
  if (utilityCall) {
    // Only send efforts the model's ladder accepts: gpt-oss rejects 'none'.
    const profile = reasoning.profileFor(resolved.providerId, resolved.id);
    if (profile?.fixedLabel) body.reasoning_effort = 'none';
    else if (profile && !profile.levels.includes('none') && profile.levels.includes('low')) body.reasoning_effort = 'low';
  }
  if (tools && tools.length) {
    body.tools = tools.map((tool) => ({
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    }));
    body.tool_choice = 'auto';
  }

  const headers = {
    'content-type': 'application/json',
    authorization: `Bearer ${apiKey}`,
  };
  if (resolved.providerId === 'openrouter') {
    headers['http-referer'] = 'https://blank.dev';
    headers['x-title'] = 'blank';
  }
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: withTimeout(signal),
  });
  if (!response.ok) await readError(response, Object.keys(body));

  const pending = new Map();
  let finished = false;
  for await (const frame of sseEvents(response)) {
    if (!frame.data || frame.data === '[DONE]') continue;
    let data;
    try { data = JSON.parse(frame.data); } catch { continue; }
    if (data.error) throw new Error(data.error.message || 'Provider error');
    if (data.usage) {
      yield {
        type: 'usage',
        usage: {
          input: data.usage.prompt_tokens || data.usage.input_tokens || 0,
          output: data.usage.completion_tokens || data.usage.output_tokens || 0,
        },
      };
    }
    const choice = data.choices?.[0];
    if (!choice) continue;
    const delta = choice.delta || {};
    if (delta.reasoning_content) yield { type: 'reasoning', text: delta.reasoning_content };
    else if (delta.reasoning) yield { type: 'reasoning', text: delta.reasoning };
    if (delta.content) yield { type: 'text', text: delta.content };
    if (Array.isArray(delta.tool_calls)) {
      for (const part of delta.tool_calls) {
        const index = part.index ?? 0;
        if (!pending.has(index)) pending.set(index, { id: '', name: '', args: '' });
        const acc = pending.get(index);
        if (part.id) acc.id = part.id;
        if (part.function?.name) acc.name += part.function.name;
        if (part.function?.arguments) acc.args += part.function.arguments;
      }
    }
    if (choice.finish_reason) finished = true;
  }

  if (pending.size) {
    const calls = [];
    for (const [index, acc] of [...pending.entries()].sort((a, b) => a[0] - b[0])) {
      if (!acc.name) continue;
      let args = {};
      try { args = acc.args ? JSON.parse(acc.args) : {}; } catch { args = { _raw: acc.args }; }
      calls.push({ id: acc.id || `call_${Date.now()}_${index}`, name: acc.name, args, rawArgs: acc.args });
    }
    if (calls.length) yield { type: 'tool_calls', calls };
  }
  yield { type: 'done', finished };
}

/* --------------------------------------------------------------- Anthropic */

function anthropicMessages(messages) {
  const out = [];
  for (const message of messages) {
    if (message.role === 'user') {
      out.push({ role: 'user', content: anthropicUserContent(message) });
    } else if (message.role === 'assistant') {
      const blocks = [];
      if (message.content) blocks.push({ type: 'text', text: message.content });
      for (const call of message.toolCalls || []) {
        blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.args || {} });
      }
      out.push({ role: 'assistant', content: blocks.length ? blocks : [{ type: 'text', text: ' ' }] });
    } else if (message.role === 'tool') {
      const block = {
        type: 'tool_result',
        tool_use_id: message.toolCallId,
        content: String(message.content || ''),
      };
      if (message.isError) block.is_error = true;
      const last = out[out.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content)) last.content.push(block);
      else out.push({ role: 'user', content: [block] });
    }
  }
  return out;
}

async function* anthropicStream({ resolved, apiKey, system, messages, tools, options, signal }) {
  const base = trimBase(resolved.baseUrl);
  const body = {
    model: resolved.id,
    max_tokens: options.maxTokens || 8192,
    system,
    messages: anthropicMessages(messages),
    stream: true,
  };
  if (typeof options.temperature === 'number') body.temperature = options.temperature;
  if (options.reasoningEffort) {
    const effort = options.reasoningEffort;
    if (options.reasoningTransport === 'anthropic-effort') {
      if (effort === 'none') {
        body.thinking = { type: 'disabled' };
      } else {
        body.output_config = { effort };
        if (effort === 'ultra') body.max_tokens = Math.max(body.max_tokens, 48000);
        else if (effort === 'max') body.max_tokens = Math.max(body.max_tokens, 32000);
        else if (effort === 'xhigh') body.max_tokens = Math.max(body.max_tokens, 24000);
        else if (effort === 'high') body.max_tokens = Math.max(body.max_tokens, 16000);
      }
    } else if (options.reasoningTransport === 'anthropic-budget') {
      if (effort === 'none') {
        body.thinking = { type: 'disabled' };
      } else {
        const budget = { low: 2048, medium: 8192, high: 16384, xhigh: 24576, max: 32768, ultra: 49152 }[effort] || 8192;
        body.thinking = { type: 'enabled', budget_tokens: budget };
        body.max_tokens = Math.max(body.max_tokens, budget + 2048);
      }
    }
  }
  if (tools && tools.length) {
    body.tools = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }));
  }
  const headers = {
    'content-type': 'application/json',
    'anthropic-version': ANTHROPIC_VERSION,
    'x-api-key': apiKey,
  };
  const response = await fetch(`${base}/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: withTimeout(signal),
  });
  if (!response.ok) await readError(response);

  const blocks = new Map();
  const toolCalls = [];
  let stopReason = null;
  for await (const frame of sseEvents(response)) {
    if (!frame.data) continue;
    let data;
    try { data = JSON.parse(frame.data); } catch { continue; }
    if (data.type === 'error') throw new Error(data.error?.message || 'Provider error');
    if (data.type === 'message_start') {
      const usage = data.message?.usage || {};
      if (usage.input_tokens) yield { type: 'usage', usage: { input: usage.input_tokens, output: 0 } };
    }
    if (data.type === 'content_block_start') {
      const index = data.index ?? 0;
      const block = data.content_block || {};
      if (block.type === 'tool_use') {
        blocks.set(index, { id: block.id, name: block.name, json: '', input: block.input || null });
      } else if (block.type === 'text') {
        blocks.set(index, { kind: 'text' });
        if (block.text) yield { type: 'text', text: block.text };
      } else if (block.type === 'thinking') {
        blocks.set(index, { kind: 'thinking' });
      }
    }
    if (data.type === 'content_block_delta') {
      const index = data.index ?? 0;
      const delta = data.delta || {};
      if (delta.type === 'text_delta' && delta.text) yield { type: 'text', text: delta.text };
      if (delta.type === 'thinking_delta' && delta.thinking) yield { type: 'reasoning', text: delta.thinking };
      if (delta.type === 'input_json_delta') {
        const block = blocks.get(index);
        if (block) block.json += delta.partial_json || '';
      }
    }
    if (data.type === 'content_block_stop') {
      const index = data.index ?? 0;
      const block = blocks.get(index);
      if (block && block.name) {
        let args = block.input || {};
        if (block.json) {
          try { args = JSON.parse(block.json); } catch { args = { _raw: block.json }; }
        }
        toolCalls.push({ id: block.id || `tool_${index}`, name: block.name, args, rawArgs: block.json });
        blocks.delete(index);
      }
    }
    if (data.type === 'message_delta') {
      if (data.delta?.stop_reason) stopReason = data.delta.stop_reason;
      if (data.usage?.output_tokens) {
        yield { type: 'usage', usage: { input: 0, output: data.usage.output_tokens } };
      }
    }
  }
  if (toolCalls.length) yield { type: 'tool_calls', calls: toolCalls };
  yield { type: 'done', finished: Boolean(stopReason) };
}

/* ------------------------------------------------------------------- Gemini */

function cleanGeminiSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(cleanGeminiSchema);
  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (['additionalProperties', '$schema', 'default', 'examples', 'title', '$id', '$ref'].includes(key)) continue;
    if (key === 'properties' && value && typeof value === 'object') {
      out.properties = {};
      for (const [prop, propSchema] of Object.entries(value)) out.properties[prop] = cleanGeminiSchema(propSchema);
    } else if (key === 'items') {
      out.items = cleanGeminiSchema(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function geminiContents(messages) {
  const out = [];
  for (const message of messages) {
    if (message.role === 'user') {
      out.push({ role: 'user', parts: geminiUserParts(message) });
    } else if (message.role === 'assistant') {
      const parts = [];
      if (message.content) parts.push({ text: message.content });
      for (const call of message.toolCalls || []) {
        parts.push({ functionCall: { name: call.name, args: call.args || {} } });
      }
      if (parts.length) out.push({ role: 'model', parts });
    } else if (message.role === 'tool') {
      const part = {
        functionResponse: {
          name: message.name || 'tool',
          response: { content: String(message.content || ''), isError: Boolean(message.isError) },
        },
      };
      const last = out[out.length - 1];
      if (last && last.role === 'user' && last.parts.every((p) => p.functionResponse)) last.parts.push(part);
      else out.push({ role: 'user', parts: [part] });
    }
  }
  return out;
}

async function* geminiStream({ resolved, apiKey, system, messages, tools, options, signal }) {
  const base = trimBase(resolved.baseUrl);
  const body = {
    contents: geminiContents(messages),
    systemInstruction: { parts: [{ text: system }] },
    generationConfig: {},
  };
  if (typeof options.temperature === 'number') body.generationConfig.temperature = options.temperature;
  if (options.maxTokens) body.generationConfig.maxOutputTokens = options.maxTokens;
  if (options.topP) body.generationConfig.topP = options.topP;
  if (options.reasoningEffort) {
    if (options.reasoningTransport === 'gemini-level') {
      body.generationConfig.thinkingConfig = { thinkingLevel: options.reasoningEffort };
    } else if (options.reasoningTransport === 'gemini-budget') {
      const budget = { none: 0, minimal: 512, low: 1024, medium: 8192, high: 24576, xhigh: 32768, max: 49152, ultra: 65536 }[options.reasoningEffort];
      body.generationConfig.thinkingConfig = { thinkingBudget: Number.isFinite(budget) ? budget : 8192 };
    }
  }
  if (tools && tools.length) {
    body.tools = [{
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: cleanGeminiSchema(tool.parameters),
      })),
    }];
  }
  const url = `${base}/models/${encodeURIComponent(resolved.id)}:streamGenerateContent?alt=sse`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
    signal: withTimeout(signal),
  });
  if (!response.ok) await readError(response);

  const toolCalls = [];
  for await (const frame of sseEvents(response)) {
    if (!frame.data) continue;
    let data;
    try { data = JSON.parse(frame.data); } catch { continue; }
    if (Array.isArray(data)) data = data[0];
    if (data.error) throw new Error(data.error.message || 'Provider error');
    if (data.usageMetadata) {
      yield {
        type: 'usage',
        usage: {
          input: data.usageMetadata.promptTokenCount || 0,
          output: data.usageMetadata.candidatesTokenCount || 0,
        },
      };
    }
    const candidate = data.candidates?.[0];
    if (!candidate) continue;
    for (const part of candidate.content?.parts || []) {
      if (typeof part.text === 'string') {
        if (part.thought) yield { type: 'reasoning', text: part.text };
        else yield { type: 'text', text: part.text };
      }
      if (part.functionCall) {
        toolCalls.push({
          id: `gemini_${toolCalls.length}_${Date.now()}`,
          name: part.functionCall.name,
          args: part.functionCall.args || {},
        });
      }
    }
  }
  if (toolCalls.length) yield { type: 'tool_calls', calls: toolCalls };
  yield { type: 'done', finished: true };
}

/* ------------------------------------------------------------------ stream */

function resolveRequest(modelId, config) {
  const active = modelId || config.defaultModel;
  if (!active) throw new Error('No model is configured. Connect a provider in Models and choose a model.');
  const resolved = findModel(active, config);
  if (!resolved) throw new Error(`Unknown model: ${active}`);
  const provider = getProvider(resolved.providerId, config);
  if (!provider) throw new Error(`Unknown provider: ${resolved.providerId}`);
  const keys = keyCandidates(config, resolved.providerId, provider);
  const apiKey = keys[0]?.key || resolveKey(config, resolved.providerId, provider);
  if (provider.keyEnv && !apiKey) {
    throw new Error(`${provider.name} needs an API key. Open Models to connect it, or set ${provider.keyEnv}.`);
  }
  return { resolved, provider, apiKey, keys };
}

function isAbortError(err) {
  return err?.name === 'AbortError' || err?.code === 'ABORT_ERR';
}

function isKeyRotationError(err) {
  const status = Number(err?.status) || 0;
  if ([401, 402, 403, 429].includes(status)) return true;
  return /invalid.*(api )?key|incorrect api key|unauthorized|quota|insufficient|rate.?limit|too many requests/i.test(String(err?.message || ''));
}

function protocolStream({ resolved, apiKey, system, messages, tools, agentOptions, signal }) {
  if (resolved.protocol === 'anthropic') {
    return anthropicStream({ resolved, apiKey, system, messages, tools, options: agentOptions, signal });
  }
  if (resolved.protocol === 'gemini') {
    return geminiStream({ resolved, apiKey, system, messages, tools, options: agentOptions, signal });
  }
  return openaiStream({ resolved, apiKey, system, messages, tools, options: agentOptions, signal });
}

async function* streamChat({ modelId, config, system, messages, tools, signal, options = {} }) {
  const { resolved, provider, keys } = resolveRequest(modelId, config);
  const fullId = `${resolved.providerId}/${resolved.id}`;
  const cachedHint = config.reasoningHints?.[fullId];
  const hint = cachedHint && (cachedHint.source === 'probe' || !resolved.reasoningHint)
    ? cachedHint
    : resolved.reasoningHint || cachedHint || null;
  const profile = reasoning.profileFor(resolved.providerId, resolved.id, hint);
  /* A custom endpoint may not document its reasoning ladder, and guessing a
     stage means sending a parameter the upstream never agreed to accept.
     Only an endpoint-reported ladder, a probe result, or an explicit user
     choice may put an effort on the wire. */
  const requestedEffort = options.reasoningEffort || config.agent?.reasoningEffort;
  const guessed = profile?.source === 'fallback';
  const effort = guessed && (!requestedEffort || requestedEffort === 'auto')
    ? ''
    : reasoning.normalize(profile, requestedEffort);
  const agentOptions = {
    temperature: options.temperature ?? config.agent?.temperature ?? null,
    maxTokens: options.maxTokens || 8192,
    capMaxTokens: Boolean(options.maxTokens),
    disableReasoning: Boolean(options.disableReasoning),
    reasoningEffort: effort,
    reasoningTransport: effort ? profile?.transport || '' : '',
  };

  const attempts = keys.length ? keys : [{ id: '', key: '', source: 'none' }];
  const canRotate = config.providers?.[resolved.providerId]?.autoRotate !== false;
  let lastError = null;
  for (let index = 0; index < attempts.length; index += 1) {
    const candidate = attempts[index];
    let started = false;
    try {
      for await (const event of protocolStream({
        resolved, apiKey: candidate.key, system, messages, tools, agentOptions, signal,
      })) {
        started = true;
        yield event;
      }
      if (candidate.source === 'stored' && candidate.id) noteKeyUsage(resolved.providerId, candidate.id, { ok: true });
      return;
    } catch (err) {
      if (isAbortError(err) || signal?.aborted) throw err;
      if (started) throw err;
      if (candidate.source === 'stored' && candidate.id) {
        noteKeyUsage(resolved.providerId, candidate.id, { ok: false, error: err.message });
      }
      lastError = err;
      const hasNext = index < attempts.length - 1;
      if (!hasNext || !canRotate || !isKeyRotationError(err)) throw err;
    }
  }
  throw lastError || new Error('No API key is available for this provider.');
}

async function completeText({ modelId, config, system, messages, signal, maxTokens = 2000 }) {
  let text = '';
  for await (const event of streamChat({
    modelId,
    config,
    system,
    messages,
    tools: [],
    signal,
    options: { maxTokens, temperature: 0.2, disableReasoning: true },
  })) {
    if (event.type === 'text') text += event.text;
    if (event.type === 'error') throw new Error(event.error);
  }
  return text.trim();
}

function firstList(...values) {
  for (const value of values) {
    if (Array.isArray(value) && value.length) return value;
  }
  return null;
}

function readEfforts(source) {
  if (!source || typeof source !== 'object') return null;
  const list = firstList(
    source.supported_efforts,
    source.efforts,
    source.levels,
    source.supported_levels,
    source.reasoning_efforts,
  );
  if (!list) return null;
  return list.map((value) => reasoning.normalizeLevel(value)).filter(Boolean);
}

/**
 * Read per-model reasoning capability from whatever shape the endpoint uses.
 * OpenRouter publishes `reasoning.supported_efforts`; other servers expose a
 * boolean or a list under `capabilities`. Nothing is assumed when absent.
 */
function reasoningHintFrom(entry = {}) {
  const hint = {};
  const params = Array.isArray(entry.supported_parameters)
    ? entry.supported_parameters.map((value) => String(value).toLowerCase())
    : null;
  if (params && params.some((value) => ['reasoning', 'include_reasoning', 'reasoning_effort', 'thinking'].includes(value))) {
    hint.supported = true;
  }
  const detail = entry.reasoning;
  if (detail && typeof detail === 'object') {
    if (typeof detail.supported === 'boolean') hint.supported = detail.supported;
    if (typeof detail.supports_effort === 'boolean') hint.supported = detail.supports_effort || hint.supported === true;
    if (detail.mandatory === true || detail.always_on === true) hint.mandatory = true;
    const levels = readEfforts(detail);
    if (levels) {
      hint.levels = levels;
      hint.supported = true;
    }
    const fallback = detail.default_effort ?? detail.default ?? detail.default_level;
    if (fallback) hint.default = reasoning.normalizeLevel(fallback);
  } else if (typeof entry.reasoning === 'boolean') {
    hint.supported = entry.reasoning;
  }
  const caps = entry.capabilities && typeof entry.capabilities === 'object' ? entry.capabilities : {};
  for (const key of ['reasoning', 'thinking', 'reasoning_effort']) {
    const value = caps[key];
    if (typeof value === 'boolean') hint.supported = value;
    else if (value && typeof value === 'object') {
      if (typeof value.supported === 'boolean') hint.supported = value.supported;
      if (value.mandatory === true) hint.mandatory = true;
      const levels = readEfforts(value);
      if (levels) {
        hint.levels = levels;
        hint.supported = true;
      }
    }
  }
  for (const key of ['supports_reasoning', 'supports_reasoning_effort', 'reasoning_supported']) {
    if (typeof entry[key] === 'boolean') hint.supported = entry[key];
  }
  const levels = readEfforts(entry);
  if (levels) {
    hint.levels = levels;
    hint.supported = true;
  }
  if (typeof entry.thinking === 'boolean') hint.supported = entry.thinking;
  if (!hint.supported && !hint.mandatory && !hint.levels?.length) return null;
  hint.source = 'api';
  return hint;
}

function visionHintFrom(entry = {}) {
  const modalities = entry.architecture?.input_modalities || entry.input_modalities;
  if (Array.isArray(modalities)) {
    return modalities.some((value) => String(value).toLowerCase() === 'image');
  }
  if (typeof entry.supports_vision === 'boolean') return entry.supports_vision;
  if (typeof entry.capabilities?.vision === 'boolean') return entry.capabilities.vision;
  if (typeof entry.capabilities?.image_input === 'boolean') return entry.capabilities.image_input;
  return undefined;
}

async function listModelsAt({ baseUrl: rawBaseUrl, apiKey, protocol = 'openai' }) {
  const baseUrl = trimBase(rawBaseUrl);
  if (!/^https?:\/\//i.test(baseUrl)) throw new Error('A valid http(s) base URL is required.');
  const headers = { accept: 'application/json' };
  if (protocol === 'anthropic') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = ANTHROPIC_VERSION;
  } else if (protocol === 'gemini') {
    headers['x-goog-api-key'] = apiKey;
  } else if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }
  const url = protocol === 'gemini' ? `${baseUrl}/models?pageSize=200` : `${baseUrl}/models`;
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  if (!response.ok) await readError(response);
  const json = await response.json();
  const raw = Array.isArray(json.data) ? json.data : Array.isArray(json.models) ? json.models : [];
  return raw
    .map((entry) => {
      const id = String(entry.id || entry.name || '').replace(/^models\//, '');
      const model = {
        id,
        name: entry.display_name || entry.displayName || entry.name || id,
        context: entry.context_window || entry.context_length || entry.inputTokenLimit || 128000,
        discovered: true,
      };
      const reasoningHint = reasoningHintFrom(entry);
      if (reasoningHint) model.reasoningHint = reasoningHint;
      const vision = visionHintFrom(entry);
      if (vision !== undefined) model.vision = vision;
      return model;
    })
    .filter((entry) => entry.id);
}

/**
 * Ask an OpenAI-compatible endpoint which effort values it accepts. Each trial
 * is a tiny chat completion; a rejected parameter is the signal. Metadata wins
 * when an endpoint publishes it, and the answer is cached by the caller.
 */
async function probeReasoningAt({ baseUrl: rawBaseUrl, apiKey, protocol = 'openai', modelId }) {
  const baseUrl = trimBase(rawBaseUrl);
  if (protocol !== 'openai' || !modelId || !/^https?:\/\//i.test(baseUrl)) return null;
  const headers = { 'content-type': 'application/json', accept: 'application/json' };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const deadline = Date.now() + 45000;

  async function attempt(effort) {
    const body = {
      model: modelId,
      messages: [{ role: 'user', content: effort ? 'What is 2 + 2? Reply with only the number.' : 'What is 2 + 2?' }],
      max_tokens: 32,
      temperature: 0,
      stream: false,
    };
    if (effort) body.reasoning_effort = effort;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      let json = null;
      try { json = JSON.parse(text); } catch {}
      return { status: response.status, ok: response.ok, text: text.slice(0, 2000), json };
    } catch (err) {
      return { status: 0, ok: false, network: true, text: err.name === 'AbortError' ? 'timeout' : '' };
    } finally {
      clearTimeout(timer);
    }
  }

  function showsReasoning(json) {
    const message = json?.choices?.[0]?.message || {};
    if (String(message.reasoning_content || message.reasoning || '').trim()) return true;
    const details = json?.usage?.completion_tokens_details || {};
    return Number(details.reasoning_tokens || json?.usage?.reasoning_tokens || 0) > 0;
  }

  function blamesReasoning(text) {
    return /reasoning[\s_-]?effort|reasoning|thinking|effort/i.test(String(text || ''));
  }

  const baseline = await attempt(null);
  if (baseline.network || baseline.status === 404) return null;
  if (!baseline.ok && baseline.status !== 400 && baseline.status !== 422) return null;
  const levels = [];
  let rejected = 0;
  for (const effort of ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']) {
    if (Date.now() > deadline) break;
    const result = await attempt(effort);
    if (result.ok) levels.push(effort);
    else if ((result.status === 400 || result.status === 422) && blamesReasoning(result.text)) rejected += 1;
  }
  if (levels.length) {
    const fallback = levels.includes('medium') ? 'medium' : levels.includes('high') ? 'high' : levels[0];
    return {
      supported: true,
      levels,
      default: fallback,
      source: 'probe',
      checkedAt: new Date().toISOString(),
    };
  }
  if (rejected >= 2 && baseline.ok) {
    return {
      supported: false,
      alwaysOn: showsReasoning(baseline.json),
      source: 'probe',
      checkedAt: new Date().toISOString(),
    };
  }
  return null;
}

async function probeModelReasoning({ providerId, modelId, config }) {
  const provider = getProvider(providerId, config);
  if (!provider) throw new Error('Unknown provider.');
  if (provider.protocol !== 'openai') return null;
  const baseUrl = config.providers?.[providerId]?.baseUrl || provider.baseUrl;
  const apiKey = resolveKey(config, providerId, provider);
  if (provider.keyEnv && !apiKey) throw new Error('Add an API key first.');
  return probeReasoningAt({ baseUrl, apiKey, protocol: provider.protocol, modelId });
}

async function ollamaContextAt(root, modelId) {
  try {
    const response = await fetch(`${root}/api/show`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ model: modelId }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return 0;
    const json = await response.json();
    const match = String(json.parameters || '').match(/(?:^|\n)\s*num_ctx\s+(\d+)/);
    return match ? Number(match[1]) : 0;
  } catch {
    return 0;
  }
}

async function addOllamaContexts(baseUrl, models) {
  const root = String(baseUrl || '').replace(/\/v1\/?$/i, '').replace(/\/+$/, '');
  await Promise.all(models.map(async (model) => {
    const context = await ollamaContextAt(root, model.id);
    if (context > 0) model.context = context;
  }));
}

async function listModels({ providerId, config, apiKey: overrideKey, keyId }) {
  const provider = getProvider(providerId, config);
  if (!provider) throw new Error('Unknown provider.');
  const baseUrl = config.providers?.[providerId]?.baseUrl || provider.baseUrl;
  const apiKey = overrideKey || resolveKey(config, providerId, provider, keyId);
  if (provider.keyEnv && !apiKey) throw new Error('Add an API key first.');
  const models = await listModelsAt({ baseUrl, apiKey, protocol: provider.protocol });
  if (providerId === 'ollama') await addOllamaContexts(baseUrl, models);
  return models;
}

module.exports = {
  streamChat, completeText, listModels, listModelsAt, resolveRequest, contentForModel,
  openaiUserContent, anthropicUserContent, geminiUserParts,
  anthropicMessages, geminiContents, cleanGeminiSchema, isKeyRotationError,
  reasoningHintFrom, visionHintFrom, probeReasoningAt, probeModelReasoning,
};
