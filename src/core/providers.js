'use strict';

const { findModel, getProvider } = require('./catalog');
const { resolveKey, keyCandidates, noteKeyUsage } = require('./config');
const { sandboxStream } = require('./sandbox');
const subscription = require('./subscription');

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

function providerError(res, body) {
  let detail = body || '';
  try {
    const json = JSON.parse(body);
    detail = json.error?.message || json.message || json.error || body;
    if (typeof detail === 'object') detail = JSON.stringify(detail);
  } catch {}
  const error = new Error(`${res.status} ${res.statusText}${detail ? ` — ${String(detail).slice(0, 500)}` : ''}`);
  error.status = res.status;
  return error;
}

async function readError(res) {
  let body = '';
  try { body = await res.text(); } catch {}
  throw providerError(res, body);
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
      return { role: 'user', content: contentForModel(message) };
    })],
    stream: true,
  };
  if (typeof options.temperature === 'number') body.temperature = options.temperature;
  if (options.reasoningEffort && options.reasoningEffort !== 'auto') {
    const effort = options.reasoningEffort;
    const family = String(resolved.id || '').split('/').pop().toLowerCase();
    if (resolved.providerId === 'openrouter') body.reasoning = { effort };
    if (/^(gpt-5|gpt-oss|o[1-9](?![0-9]))/.test(family)) body.reasoning_effort = effort;
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
    headers['x-title'] = 'Blank';
  }
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: withTimeout(signal),
  });
  if (!response.ok) await readError(response);

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

/* ------------------------------------------------ ChatGPT subscriptions */

function responsesInput(messages) {
  const items = [];
  for (const message of messages) {
    if (message.role === 'user') {
      items.push({ type: 'message', role: 'user', content: [{ type: 'input_text', text: contentForModel(message) }] });
    } else if (message.role === 'assistant') {
      const raw = Array.isArray(message.providerItems) ? message.providerItems : [];
      let functionCalls = 0;
      for (const item of raw) {
        if (item.type === 'reasoning') {
          items.push({
            type: 'reasoning',
            ...(item.id ? { id: item.id } : {}),
            ...(item.encrypted_content ? { encrypted_content: item.encrypted_content } : {}),
            summary: Array.isArray(item.summary) ? item.summary : [],
          });
        } else if (item.type === 'function_call') {
          functionCalls += 1;
          items.push({ type: 'function_call', call_id: item.call_id || item.id, name: item.name, arguments: item.arguments || '{}' });
        }
      }
      if (message.content) {
        items.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: message.content }] });
      }
      if (!functionCalls) {
        for (const call of message.toolCalls || []) {
          items.push({ type: 'function_call', call_id: call.id, name: call.name, arguments: JSON.stringify(call.args || {}) });
        }
      }
    } else if (message.role === 'tool') {
      items.push({ type: 'function_call_output', call_id: message.toolCallId, output: String(message.content || '') });
    }
  }
  return items;
}

async function* responsesStream({ resolved, apiKey, system, messages, tools, options, signal }) {
  const headers = {
    ...subscription.subscribeHeaders('openai'),
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
    accept: 'text/event-stream',
  };
  const body = {
    model: resolved.id,
    instructions: system,
    input: responsesInput(messages),
    tools: (tools || []).map((tool) => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      strict: false,
    })),
    tool_choice: 'auto',
    parallel_tool_calls: true,
    stream: true,
    store: false,
    include: ['reasoning.encrypted_content'],
  };
  if (options.reasoningEffort && options.reasoningEffort !== 'auto') {
    body.reasoning = { effort: options.reasoningEffort, summary: 'auto' };
  } else {
    body.reasoning = { summary: 'auto' };
  }
  if (!body.tools.length) delete body.tools;

  const response = await fetch(`${subscription.codexBase()}/responses`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: withTimeout(signal, 900000),
  });
  if (!response.ok) await readError(response);

  let finished = false;
  let sawText = false;
  for await (const frame of sseEvents(response)) {
    if (!frame.data || frame.data === '[DONE]') continue;
    let data;
    try { data = JSON.parse(frame.data); } catch { continue; }
    const type = data.type || frame.event;
    if (type === 'error' || type === 'response.failed') {
      const error = data.error || data.response?.error || {};
      throw new Error(error.message || 'The subscription endpoint returned an error.');
    }
    if (type === 'response.output_text.delta' && data.delta) {
      sawText = true;
      yield { type: 'text', text: data.delta };
      continue;
    }
    if (type === 'response.reasoning_summary_text.delta' && data.delta) {
      yield { type: 'reasoning', text: data.delta };
      continue;
    }
    if (type === 'response.completed') {
      const payload = data.response || {};
      const output = Array.isArray(payload.output) ? payload.output : [];
      const calls = [];
      for (const item of output) {
        if (item.type !== 'function_call' || !item.name) continue;
        let args = {};
        try { args = item.arguments ? JSON.parse(item.arguments) : {}; } catch { args = { _raw: item.arguments }; }
        calls.push({
          id: item.call_id || item.id || `call_${calls.length}_${Date.now()}`,
          name: item.name,
          args,
          rawArgs: item.arguments || '',
        });
      }
      const providerItems = output.filter((item) => ['reasoning', 'function_call'].includes(item.type));
      if (providerItems.length) yield { type: 'provider_items', items: providerItems };
      if (payload.usage) {
        yield {
          type: 'usage',
          usage: {
            input: payload.usage.input_tokens || 0,
            output: payload.usage.output_tokens || 0,
          },
        };
      }
      if (!sawText && !calls.length) {
        const text = output.filter((item) => item.type === 'message').flatMap((item) => item.content || []).filter((part) => part.type === 'output_text').map((part) => part.text || '').join('');
        if (text) yield { type: 'text', text };
      }
      if (calls.length) yield { type: 'tool_calls', calls };
      finished = true;
      break;
    }
  }
  yield { type: 'done', finished };
}

/* --------------------------------------------------------------- Anthropic */

function anthropicMessages(messages) {
  const out = [];
  for (const message of messages) {
    if (message.role === 'user') {
      out.push({ role: 'user', content: contentForModel(message) });
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

async function* anthropicStream({ resolved, apiKey, system, messages, tools, options, signal, subscriptionMode = '' }) {
  const base = trimBase(resolved.baseUrl);
  const oauthMode = subscriptionMode === 'claude';
  const body = {
    model: resolved.id,
    max_tokens: options.maxTokens || 8192,
    system: oauthMode
      ? [
          { type: 'text', text: 'You are Claude Code, Anthropic\'s official CLI for Claude.' },
          { type: 'text', text: system },
        ]
      : system,
    messages: anthropicMessages(messages),
    stream: true,
  };
  if (typeof options.temperature === 'number') body.temperature = options.temperature;
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
  };
  if (oauthMode) {
    headers.authorization = `Bearer ${apiKey}`;
    headers['anthropic-beta'] = 'oauth-2025-04-20';
  } else {
    headers['x-api-key'] = apiKey;
  }
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
      out.push({ role: 'user', parts: [{ text: contentForModel(message) }] });
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
  if (options.reasoningEffort && options.reasoningEffort !== 'auto' && /gemini-2\.5/i.test(resolved.id)) {
    const budget = options.reasoningEffort === 'low' ? 1024 : options.reasoningEffort === 'medium' ? 8192 : 24576;
    body.generationConfig.thinkingConfig = { thinkingBudget: budget };
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
  const resolved = findModel(modelId || config.defaultModel, config);
  if (!resolved) throw new Error(`Unknown model: ${modelId || config.defaultModel}`);
  const provider = getProvider(resolved.providerId, config);
  if (!provider) throw new Error(`Unknown provider: ${resolved.providerId}`);
  const keys = keyCandidates(config, resolved.providerId, provider);
  const apiKey = keys[0]?.key || resolveKey(config, resolved.providerId, provider);
  const subEntry = subscription.entryFor(resolved.providerId);
  if (resolved.protocol !== 'sandbox' && provider.keyEnv && !apiKey && !subEntry?.mode) {
    throw new Error(`${provider.name} needs an API key. Open Models to connect it, or set ${provider.keyEnv}.`);
  }
  return { resolved, provider, apiKey, keys, subscriptionMode: subEntry?.mode || '' };
}

function isAbortError(err) {
  return err?.name === 'AbortError' || err?.code === 'ABORT_ERR';
}

function isKeyRotationError(err) {
  const status = Number(err?.status) || 0;
  if ([401, 402, 403, 429].includes(status)) return true;
  return /invalid.*(api )?key|incorrect api key|unauthorized|quota|insufficient|rate.?limit|too many requests/i.test(String(err?.message || ''));
}

function protocolStream({ resolved, apiKey, system, messages, tools, agentOptions, signal, subscriptionMode = '' }) {
  if (subscriptionMode === 'chatgpt') {
    return responsesStream({ resolved, apiKey, system, messages, tools, options: agentOptions, signal });
  }
  if (resolved.protocol === 'anthropic') {
    return anthropicStream({ resolved, apiKey, system, messages, tools, options: agentOptions, signal, subscriptionMode });
  }
  if (resolved.protocol === 'gemini') {
    return geminiStream({ resolved, apiKey, system, messages, tools, options: agentOptions, signal });
  }
  return openaiStream({ resolved, apiKey, system, messages, tools, options: agentOptions, signal });
}

async function* streamChat({ modelId, config, system, messages, tools, signal, options = {} }) {
  const { resolved, provider, keys, subscriptionMode } = resolveRequest(modelId, config);
  const agentOptions = {
    temperature: options.temperature ?? config.agent?.temperature ?? null,
    maxTokens: options.maxTokens || 8192,
    reasoningEffort: options.reasoningEffort || config.agent?.reasoningEffort || 'auto',
  };
  if (resolved.protocol === 'sandbox') {
    yield* sandboxStream({ resolved, messages, tools, options: agentOptions, signal });
    return;
  }

  if (subscriptionMode) {
    const token = await subscription.tokenFor(resolved.providerId);
    if (token) {
      let started = false;
      try {
        for await (const event of protocolStream({
          resolved, apiKey: token, system, messages, tools, agentOptions, signal, subscriptionMode,
        })) {
          started = true;
          yield event;
        }
        return;
      } catch (err) {
        if (isAbortError(err) || signal?.aborted || started) throw err;
        if (!keys.length || !isKeyRotationError(err)) throw err;
      }
    } else if (!keys.length) {
      throw new Error(`The ${provider.name} subscription sign-in expired. Sign in again in Models, or add an API key.`);
    }
  }

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
    options: { maxTokens, temperature: 0.2 },
  })) {
    if (event.type === 'text') text += event.text;
    if (event.type === 'error') throw new Error(event.error);
  }
  return text.trim();
}

async function listModelsAt({ baseUrl: rawBaseUrl, apiKey, protocol = 'openai', oauthMode = '' }) {
  const baseUrl = trimBase(rawBaseUrl);
  if (!/^https?:\/\//i.test(baseUrl)) throw new Error('A valid http(s) base URL is required.');
  const headers = { accept: 'application/json' };
  if (oauthMode === 'claude') {
    headers.authorization = `Bearer ${apiKey}`;
    headers['anthropic-version'] = ANTHROPIC_VERSION;
    headers['anthropic-beta'] = 'oauth-2025-04-20';
  } else if (protocol === 'anthropic') {
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
      return {
        id,
        name: entry.display_name || entry.displayName || entry.name || id,
        context: entry.context_window || entry.context_length || entry.inputTokenLimit || 128000,
        discovered: true,
      };
    })
    .filter((entry) => entry.id);
}

async function listChatGptModels(apiKey) {
  const response = await fetch(`${subscription.codexBase()}/models`, {
    headers: {
      accept: 'application/json',
      ...subscription.subscribeHeaders('openai'),
      authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) await readError(response);
  const json = await response.json();
  const raw = Array.isArray(json) ? json : Array.isArray(json.data) ? json.data : Array.isArray(json.models) ? json.models : Array.isArray(json.items) ? json.items : [];
  return raw
    .map((entry) => {
      if (typeof entry === 'string') return { id: entry, name: entry, context: 128000, discovered: true };
      const id = String(entry.id || entry.slug || entry.model || entry.name || '');
      return {
        id,
        name: entry.display_name || entry.displayName || entry.title || id,
        context: Number(entry.context_window || entry.context_length || entry.max_context) || 128000,
        discovered: true,
      };
    })
    .filter((entry) => entry.id);
}

async function listModels({ providerId, config, apiKey: overrideKey, keyId }) {
  const provider = getProvider(providerId, config);
  if (!provider) throw new Error('Unknown provider.');
  if (provider.protocol === 'sandbox') return provider.models;
  const baseUrl = config.providers?.[providerId]?.baseUrl || provider.baseUrl;
  const apiKey = overrideKey || resolveKey(config, providerId, provider, keyId);
  const subEntry = subscription.entryFor(providerId);
  if (!apiKey && subEntry?.mode) {
    const token = await subscription.tokenFor(providerId);
    if (token) {
      if (subEntry.mode === 'chatgpt') return listChatGptModels(token);
      return listModelsAt({ baseUrl, apiKey: token, protocol: provider.protocol, oauthMode: 'claude' });
    }
  }
  if (provider.keyEnv && !apiKey) throw new Error('Add an API key first.');
  return listModelsAt({ baseUrl, apiKey, protocol: provider.protocol });
}

module.exports = {
  streamChat, completeText, listModels, listModelsAt, resolveRequest, contentForModel,
  anthropicMessages, geminiContents, cleanGeminiSchema, isKeyRotationError,
};
