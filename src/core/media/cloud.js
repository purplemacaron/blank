'use strict';

/* Cloud media adapters. Every request uses HTTPS, keys stay in the main
   process, downloads are host-checked and byte-capped, and polling has a
   hard deadline. */

const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const net = require('net');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const MAX_JSON = 4 * 1024 * 1024;
const MAX_IMAGE = 64 * 1024 * 1024;
const MAX_AUDIO = 160 * 1024 * 1024;
const MAX_VIDEO = 512 * 1024 * 1024;
const MAX_MODEL = 256 * 1024 * 1024;

const CLOUD_PROVIDERS = [
  {
    id: 'openai-images',
    label: 'OpenAI Images',
    vendor: 'openai',
    keyProvider: 'openai',
    keyLabel: 'OpenAI API key',
    kinds: ['image'],
    models: ['gpt-image-1', 'dall-e-3'],
    note: 'Generate and edit images with GPT Image or DALL·E 3.',
  },
  {
    id: 'google-imagen',
    label: 'Google Imagen',
    vendor: 'google',
    keyProvider: 'google',
    keyLabel: 'Google AI API key',
    kinds: ['image'],
    models: ['imagen-3.0-generate-002', 'imagen-4.0-generate-001'],
    note: 'Imagen 3 and 4 stills with aspect-ratio control.',
  },
  {
    id: 'google-veo',
    label: 'Google Veo',
    vendor: 'google-veo',
    keyProvider: 'google',
    keyLabel: 'Google AI API key',
    kinds: ['video'],
    models: ['veo-2.0-generate-001', 'veo-3.0-generate-preview'],
    note: 'Text-to-video with native audio in Veo 3.',
  },
  {
    id: 'higgsfield',
    label: 'Higgsfield',
    vendor: 'higgsfield',
    keyProvider: 'higgsfield',
    keyLabel: 'Higgsfield key ID:secret',
    kinds: ['image', 'video'],
    models: ['higgsfield-ai/soul/v2/standard', 'kling-video/v3.0-turbo/text-to-video'],
    modelsByKind: {
      image: ['higgsfield-ai/soul/v2/standard'],
      video: ['kling-video/v3.0-turbo/text-to-video'],
    },
    note: 'Image and video models behind one key.',
  },
  {
    id: 'stability',
    label: 'Stability AI',
    vendor: 'stability',
    keyProvider: 'stability',
    keyLabel: 'Stability API key',
    kinds: ['image', 'audio'],
    models: ['core', 'sd3', 'ultra', 'stable-audio-2'],
    modelsByKind: {
      image: ['core', 'sd3', 'ultra'],
      audio: ['stable-audio-2'],
    },
    note: 'Stable Image and Stable Audio generation.',
  },
  {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    vendor: 'elevenlabs',
    keyProvider: 'elevenlabs',
    keyLabel: 'ElevenLabs API key',
    kinds: ['audio'],
    models: ['music_v1', 'sound-generation'],
    note: 'Original music and sound effects from a prompt.',
  },
  {
    id: 'replicate',
    label: 'Replicate',
    vendor: 'replicate',
    keyProvider: 'replicate',
    keyLabel: 'Replicate API token',
    kinds: ['image', 'video', 'audio', 'model3d'],
    models: [
      'black-forest-labs/flux-1.1-pro',
      'minimax/video-01',
      'meta/musicgen',
      'firtoz/trellis',
    ],
    modelsByKind: {
      image: ['black-forest-labs/flux-1.1-pro'],
      video: ['minimax/video-01'],
      audio: ['meta/musicgen'],
      model3d: ['firtoz/trellis'],
    },
    note: 'Thousands of community models through one token.',
  },
  {
    id: 'fal',
    label: 'fal.ai',
    vendor: 'fal',
    keyProvider: 'fal',
    keyLabel: 'fal key',
    kinds: ['image', 'video', 'audio', 'model3d'],
    models: [
      'fal-ai/flux/dev',
      'fal-ai/kling-video/v2/master/text-to-video',
      'fal-ai/stable-audio',
      'fal-ai/trellis',
    ],
    modelsByKind: {
      image: ['fal-ai/flux/dev'],
      video: ['fal-ai/kling-video/v2/master/text-to-video'],
      audio: ['fal-ai/stable-audio'],
      model3d: ['fal-ai/trellis'],
    },
    note: 'Fast hosted image, video, audio and 3D models.',
  },
  {
    id: 'openai-compatible',
    label: 'OpenAI compatible',
    vendor: 'openai-compatible',
    keyProvider: 'openaiCompatible',
    keyLabel: 'OpenAI-compatible API key',
    kinds: ['image', 'video'],
    models: [],
    modelsByKind: { image: [], video: [] },
    note: 'Any server that follows the OpenAI image and video APIs — NVIDIA NIM, local NIM, vLLM media servers.',
    dynamic: true,
  },
];

const PROVIDER_MAP = Object.fromEntries(CLOUD_PROVIDERS.map((p) => [p.id, p]));

function normalizeCompatBase(raw) {
  let value = String(raw || '').trim().replace(/\/+$/, '');
  if (!value) return '';
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return '';
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return '';
  if (!/\/v1$/i.test(parsed.pathname)) value += '/v1';
  return value;
}

/** The media endpoint: the saved value, or a NVIDIA custom provider already in use. */
function compatEndpoint(config) {
  const saved = normalizeCompatBase(config?.media?.endpoints?.openaiCompatible);
  if (saved) return saved;
  const candidates = [];
  for (const provider of config?.customProviders || []) {
    const base = config?.providers?.[provider.id]?.baseUrl || provider.baseUrl || '';
    if (/integrate\.api\.nvidia\.com/i.test(base)) candidates.push(base);
  }
  for (const [id, stored] of Object.entries(config?.providers || {})) {
    if (/nvidia/i.test(id) && stored?.baseUrl && /integrate\.api\.nvidia\.com/i.test(stored.baseUrl)) {
      candidates.push(stored.baseUrl);
    }
  }
  return normalizeCompatBase(candidates[0] || '');
}

/** Models saved for the compatible engine, falling back to an NVIDIA media guess. */
function compatModels(config, kind) {
  const models = config?.media?.openaiModels;
  const list = Array.isArray(models?.[kind]) ? models[kind] : [];
  return list.map((model) => String(model || '').trim()).filter(Boolean);
}

function cloudProviderList(config) {
  return CLOUD_PROVIDERS.map(({ keyProvider, ...rest }) => {
    if (rest.id !== 'openai-compatible') return { ...rest, keyId: keyProvider };
    const image = compatModels(config, 'image');
    const video = compatModels(config, 'video');
    return {
      ...rest,
      keyId: keyProvider,
      models: [...image, ...video],
      modelsByKind: { image, video },
      endpoint: compatEndpoint(config),
      baseUrl: compatEndpoint(config),
    };
  });
}

function providerFor(id) {
  return PROVIDER_MAP[id] || null;
}

function modelsForKind(provider, kind) {
  const mapped = provider?.modelsByKind?.[kind];
  if (Array.isArray(mapped) && mapped.length) return mapped;
  return provider?.models || [];
}

function storedProviderKey(entry) {
  if (!entry) return '';
  if (entry.apiKey) return entry.apiKey;
  const keys = Array.isArray(entry.keys) ? entry.keys.filter((item) => item && (item.key || item.apiKey)) : [];
  if (!keys.length) return '';
  const active = keys.find((item) => item.id === entry.activeKeyId)
    || keys.find((item) => item.active)
    || keys[0];
  return active.key || active.apiKey || '';
}

function resolveCloudKey(config, provider) {
  if (!provider) return '';
  const mediaKeys = (config.media && config.media.keys) || {};
  if (mediaKeys[provider.keyProvider]) return mediaKeys[provider.keyProvider];
  const stored = config.providers && config.providers[provider.keyProvider];
  const storedKey = storedProviderKey(stored);
  if (storedKey) return storedKey;
  if (provider.keyProvider === 'openaiCompatible') {
    const base = compatEndpoint(config);
    if (!base) return '';
    const host = (() => { try { return new URL(base).host; } catch { return ''; } })();
    for (const [id, entry] of Object.entries(config.providers || {})) {
      if (!host) continue;
      const custom = (config.customProviders || []).find((item) => item.id === id);
      const baseUrl = entry?.baseUrl || custom?.baseUrl || '';
      if (!baseUrl) continue;
      try {
        if (new URL(baseUrl).host === host) return storedProviderKey(entry);
      } catch {}
    }
    if (host === 'integrate.api.nvidia.com' && config.providers?.['custom_nvidia-nim']) {
      return storedProviderKey(config.providers['custom_nvidia-nim']);
    }
    if (host === 'api.openai.com' && config.providers?.openai) {
      return storedProviderKey(config.providers.openai);
    }
  }
  return '';
}

function isPrivateAddress(address) {
  if (!address) return true;
  const family = net.isIP(address);
  if (family === 4) {
    const parts = address.split('.').map(Number);
    if (parts[0] === 10 || parts[0] === 127 || parts[0] === 0) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    return false;
  }
  if (family === 6) {
    const lower = address.toLowerCase();
    if (lower === '::1' || lower === '::' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80')) return true;
    return false;
  }
  return true;
}

async function assertPublicHost(hostname) {
  const clean = String(hostname || '').toLowerCase();
  if (!clean || clean === 'localhost' || clean.endsWith('.local') || clean.endsWith('.internal')) {
    throw new Error('Blocked private download host');
  }
  if (net.isIP(clean)) {
    if (isPrivateAddress(clean)) throw new Error('Blocked private download address');
    return;
  }
  let records;
  try {
    records = await dns.lookup(clean, { all: true });
  } catch {
    throw new Error(`Could not resolve media host ${clean}`);
  }
  if (!records.length || records.some((r) => isPrivateAddress(r.address))) {
    throw new Error('Blocked media host resolving to a private address');
  }
}

function limitFor(kind) {
  if (kind === 'video') return MAX_VIDEO;
  if (kind === 'audio') return MAX_AUDIO;
  if (kind === 'model3d') return MAX_MODEL;
  return MAX_IMAGE;
}

async function downloadToFile(url, dest, options = {}) {
  const maxBytes = options.maxBytes || MAX_IMAGE;
  const deadline = Date.now() + (options.timeout || 240000);
  let current = String(url || '');
  let response = null;
  for (let hop = 0; hop < 5; hop += 1) {
    let parsed;
    try {
      parsed = new URL(current);
    } catch {
      throw new Error('Invalid download URL');
    }
    if (parsed.protocol !== 'https:') throw new Error('Media downloads must use HTTPS');
    await assertPublicHost(parsed.hostname);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1000, Math.min(60000, deadline - Date.now())));
    const onAbort = () => controller.abort();
    if (options.signal) options.signal.addEventListener('abort', onAbort, { once: true });
    try {
      response = await fetch(parsed.toString(), {
        redirect: 'manual',
        signal: controller.signal,
        headers: options.headers || {},
      });
    } finally {
      clearTimeout(timer);
      if (options.signal) options.signal.removeEventListener('abort', onAbort);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Download redirect without a location');
      current = new URL(location, parsed).toString();
      continue;
    }
    break;
  }
  if (!response) throw new Error('Download failed');
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Download failed (${response.status}) ${text.slice(0, 200)}`.trim());
  }
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared && declared > maxBytes) throw new Error(`Download is too large (${declared} bytes)`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  let bytes = 0;
  const out = fs.createWriteStream(dest);
  try {
    await pipeline(
      Readable.fromWeb(response.body),
      async function* (source) {
        for await (const chunk of source) {
          bytes += chunk.length;
          if (bytes > maxBytes) throw new Error('Download exceeded the size limit');
          if (Date.now() > deadline) throw new Error('Download timed out');
          yield chunk;
        }
      },
      out,
    );
  } catch (error) {
    await fs.promises.rm(dest, { force: true }).catch(() => {});
    throw error;
  }
  return { file: dest, bytes };
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout || 120000);
  const onAbort = () => controller.abort();
  if (options.signal) options.signal.addEventListener('abort', onAbort, { once: true });
  let response;
  try {
    response = await fetch(url, {
      method: options.method || 'GET',
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    if (options.signal) options.signal.removeEventListener('abort', onAbort);
  }
  const text = await response.text();
  if (text.length > MAX_JSON) throw new Error('Media API response was too large');
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    const detail = (json && (json.error?.message || json.detail || json.message)) || text.slice(0, 300);
    throw new Error(`Provider error ${response.status}: ${detail || response.statusText}`);
  }
  return json;
}

function dataUrlToBuffer(dataUrl) {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(String(dataUrl || ''));
  if (!match || !match[2]) throw new Error('Provider returned an invalid inline image');
  const buffer = Buffer.from(match[3], 'base64');
  if (!buffer.length) throw new Error('Provider returned an empty image');
  if (buffer.length > MAX_IMAGE) throw new Error('Provider image exceeded the size limit');
  return buffer;
}

function extForMime(mime, fallback) {
  const clean = String(mime || '').toLowerCase();
  if (clean.includes('png')) return '.png';
  if (clean.includes('jpeg') || clean.includes('jpg')) return '.jpg';
  if (clean.includes('webp')) return '.webp';
  if (clean.includes('avif')) return '.avif';
  if (clean.includes('gif')) return '.gif';
  if (clean.includes('mp4')) return '.mp4';
  if (clean.includes('webm')) return '.webm';
  if (clean.includes('mpeg') || clean.includes('mp3')) return '.mp3';
  if (clean.includes('wav')) return '.wav';
  if (clean.includes('ogg')) return '.ogg';
  if (clean.includes('flac')) return '.flac';
  if (clean.includes('glb')) return '.glb';
  if (clean.includes('gltf')) return '.gltf';
  if (clean.includes('obj')) return '.obj';
  return fallback || '.bin';
}

function aspectRatioOf(size) {
  const [w, h] = (size || '1024x1024').split('x').map(Number);
  const ratio = w / h;
  const options = [
    ['1:1', 1], ['16:9', 16 / 9], ['9:16', 9 / 16], ['4:3', 4 / 3], ['3:4', 3 / 4],
    ['3:2', 3 / 2], ['2:3', 2 / 3], ['21:9', 21 / 9],
  ];
  let best = options[0];
  for (const entry of options) {
    if (Math.abs(entry[1] - ratio) < Math.abs(best[1] - ratio)) best = entry;
  }
  return best[0];
}

async function saveInlineOrFetch({ buffer, url, tmpFile, kind, onProgress, signal }) {
  const maxBytes = limitFor(kind);
  if (url) {
    const result = await downloadToFile(url, tmpFile, { maxBytes, signal });
    return { file: tmpFile, meta: { downloadedBytes: result.bytes } };
  }
  if (!buffer || !buffer.length) throw new Error('Provider returned no media');
  if (buffer.length > maxBytes) throw new Error('Provider media exceeded the size limit');
  fs.mkdirSync(path.dirname(tmpFile), { recursive: true });
  await fs.promises.writeFile(tmpFile, buffer);
  if (onProgress) onProgress(0.92, 'saving');
  return { file: tmpFile, meta: { inlineBytes: buffer.length } };
}

/* ------------------------------------------------------------------ OpenAI */

async function generateOpenAI(ctx) {
  const { apiKey, kind, prompt, model, tmpFile, options, onProgress, signal } = ctx;
  if (kind !== 'image') throw new Error('OpenAI Images supports images only');
  const size = options.size || (model === 'dall-e-3' ? '1024x1024' : '1024x1024');
  const body = {
    model: model || 'gpt-image-1',
    prompt,
    n: 1,
    size,
  };
  if (!String(model || '').startsWith('gpt-image')) body.response_format = 'b64_json';
  if (options.quality === 'hd' && model === 'dall-e-3') body.quality = 'hd';
  if (options.style && model === 'dall-e-3') body.style = options.style === 'natural' ? 'natural' : 'vivid';
  onProgress(0.2, 'rendering');
  const json = await fetchJson('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
    timeout: 180000,
  });
  onProgress(0.75, 'downloading');
  const item = json?.data?.[0] || {};
  const buffer = item.b64_json ? Buffer.from(item.b64_json, 'base64') : null;
  const saved = await saveInlineOrFetch({ url: item.url, buffer, tmpFile: tmpFile + '.png', kind, onProgress, signal });
  return { file: saved.file, mime: 'image/png', meta: { revisedPrompt: item.revised_prompt || '', size } };
}

async function editOpenAIImage(ctx) {
  const { apiKey, prompt, model, inputFile, mime, tmpFile, options, onProgress, signal } = ctx;
  if (!fs.existsSync(inputFile)) throw new Error('Source image is missing');
  const data = await fs.promises.readFile(inputFile);
  if (data.length > 48 * 1024 * 1024) throw new Error('Source image is too large to edit');
  const form = new FormData();
  form.append('model', model || 'gpt-image-1');
  form.append('prompt', prompt || 'Refine this image, keep the composition and improve the details.');
  form.append('n', '1');
  if (options.size) form.append('size', options.size);
  form.append('image', new Blob([data], { type: mime || 'image/png' }), path.basename(inputFile));
  onProgress(0.25, 'editing');
  const json = await fetchJson('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
    signal,
    timeout: 180000,
  });
  const item = json?.data?.[0] || {};
  const buffer = item.b64_json ? Buffer.from(item.b64_json, 'base64') : null;
  onProgress(0.78, 'downloading');
  const saved = await saveInlineOrFetch({ url: item.url, buffer, tmpFile: tmpFile + '.png', kind: 'image', onProgress, signal });
  return { file: saved.file, mime: 'image/png', meta: { edited: true, revisedPrompt: item.revised_prompt || '' } };
}

/* ------------------------------------------------------------------ Google */

async function generateImagen(ctx) {
  const { apiKey, prompt, model, tmpFile, options, onProgress, signal } = ctx;
  const ratio = options.aspectRatio || aspectRatioOf(options.size);
  const body = {
    instances: [{ prompt }],
    parameters: { sampleCount: 1, aspectRatio: ratio, personGeneration: 'allow_adult' },
  };
  onProgress(0.2, 'rendering');
  const json = await fetchJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || 'imagen-3.0-generate-002')}:predict`,
    {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
      timeout: 180000,
    },
  );
  const prediction = json?.predictions?.[0] || {};
  if (!prediction.bytesBase64Encoded) throw new Error('Imagen returned no image');
  onProgress(0.78, 'saving');
  const saved = await saveInlineOrFetch({
    buffer: Buffer.from(prediction.bytesBase64Encoded, 'base64'),
    tmpFile: tmpFile + extForMime(prediction.mimeType, '.png'),
    kind: 'image',
    onProgress,
    signal,
  });
  return { file: saved.file, mime: prediction.mimeType || 'image/png', meta: { aspectRatio: ratio } };
}

async function pollVeo(operationName, apiKey, ctx) {
  const { onProgress, signal } = ctx;
  const deadline = Date.now() + 9 * 60 * 1000;
  let attempt = 0;
  while (Date.now() < deadline) {
    if (signal && signal.aborted) throw new Error('Cancelled');
    attempt += 1;
    const json = await fetchJson(
      `https://generativelanguage.googleapis.com/v1beta/${operationName}`,
      { headers: { 'x-goog-api-key': apiKey }, signal, timeout: 60000 },
    );
    if (json?.done) {
      if (json.error) throw new Error(json.error.message || 'Veo generation failed');
      return json.response || json;
    }
    onProgress(Math.min(0.8, 0.2 + attempt * 0.04), 'rendering video');
    await new Promise((resolve) => setTimeout(resolve, 6000));
  }
  throw new Error('Veo generation timed out');
}

async function generateVeo(ctx) {
  const { apiKey, prompt, model, tmpFile, options, onProgress, signal } = ctx;
  const body = {
    instances: [{ prompt }],
    parameters: {
      aspectRatio: options.aspectRatio || '16:9',
      durationSeconds: Math.max(4, Math.min(8, Math.round(options.duration || 8))),
    },
  };
  onProgress(0.1, 'queued');
  const started = await fetchJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || 'veo-2.0-generate-001')}:predictLongRunning`,
    {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
      timeout: 60000,
    },
  );
  if (!started?.name) throw new Error('Veo did not return an operation');
  const result = await pollVeo(started.name, apiKey, ctx);
  const samples = result?.generateVideoResponse?.generatedSamples
    || result?.generatedVideos
    || result?.predictions
    || [];
  const video = (samples[0] && (samples[0].video || samples[0])) || {};
  const uri = video.uri || video.videoUri || video.gcsUri;
  if (!uri) throw new Error('Veo returned no video');
  onProgress(0.86, 'downloading');
  const saved = await downloadToFile(uri, tmpFile + '.mp4', {
    maxBytes: MAX_VIDEO,
    headers: uri.includes('key=') ? {} : { 'x-goog-api-key': apiKey },
    signal,
    timeout: 300000,
  });
  return { file: saved.file, mime: 'video/mp4', meta: { operation: started.name, duration: body.parameters.durationSeconds } };
}

/* --------------------------------------------------------------- Stability */

async function generateStability(ctx) {
  const { apiKey, kind, prompt, model, tmpFile, options, onProgress, signal } = ctx;
  if (kind === 'audio') {
    const form = new FormData();
    form.append('prompt', prompt);
    form.append('duration', String(Math.max(1, Math.min(190, Math.round(options.duration || 20)))));
    form.append('output_format', 'mp3');
    form.append('model', model || 'stable-audio-2');
    onProgress(0.2, 'composing');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 240000);
    const onAbort = () => controller.abort();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    let response;
    try {
      response = await fetch('https://api.stability.ai/v2beta/audio/stable-audio-2/text-to-audio', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, accept: 'audio/*' },
        body: form,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Stability audio failed (${response.status}) ${text.slice(0, 200)}`.trim());
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_AUDIO) throw new Error('Stability audio exceeded the size limit');
    onProgress(0.85, 'saving');
    await fs.promises.writeFile(tmpFile + '.mp3', buffer);
    return { file: tmpFile + '.mp3', mime: 'audio/mpeg', meta: { duration: Number(options.duration || 20) } };
  }
  const style = model === 'ultra' ? 'ultra' : model === 'sd3' ? 'sd3' : 'core';
  const form = new FormData();
  form.append('prompt', prompt);
  form.append('output_format', 'png');
  form.append('aspect_ratio', options.aspectRatio || aspectRatioOf(options.size));
  if (options.negativePrompt) form.append('negative_prompt', options.negativePrompt);
  if (style === 'sd3') form.append('model', 'sd3.5-large');
  onProgress(0.2, 'rendering');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180000);
  const onAbort = () => controller.abort();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  let response;
  try {
    response = await fetch(`https://api.stability.ai/v2beta/stable-image/generate/${style}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, accept: 'image/*' },
      body: form,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Stability failed (${response.status}) ${text.slice(0, 200)}`.trim());
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > MAX_IMAGE) throw new Error('Stability returned an invalid image');
  const mime = response.headers.get('content-type') || 'image/png';
  const file = tmpFile + extForMime(mime, '.png');
  await fs.promises.writeFile(file, buffer);
  onProgress(0.85, 'saving');
  return { file, mime, meta: { style } };
}

/* --------------------------------------------------------------- ElevenLabs */

async function generateElevenLabs(ctx) {
  const { apiKey, prompt, model, tmpFile, options, onProgress, signal } = ctx;
  const isSfx = model === 'sound-generation';
  const duration = Math.max(1, Math.min(300, Math.round(options.duration || 30)));
  const url = isSfx
    ? 'https://api.elevenlabs.io/v1/sound-generation'
    : 'https://api.elevenlabs.io/v1/music';
  const body = isSfx
    ? { text: prompt, duration_seconds: Math.min(22, duration), prompt_influence: 0.35 }
    : { prompt, music_length_ms: duration * 1000, model_id: 'music_v1' };
  onProgress(0.15, isSfx ? 'designing sound' : 'composing music');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 240000);
  const onAbort = () => controller.abort();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  let response;
  try {
    response = await fetch(`${url}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`ElevenLabs failed (${response.status}) ${text.slice(0, 200)}`.trim());
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > MAX_AUDIO) throw new Error('ElevenLabs returned invalid audio');
  await fs.promises.writeFile(tmpFile + '.mp3', buffer);
  onProgress(0.85, 'saving');
  return { file: tmpFile + '.mp3', mime: 'audio/mpeg', meta: { duration } };
}

/* ----------------------------------------------------------------- Replicate */

function replicateInput(kind, prompt, options, imageUrl) {
  const input = options.input && typeof options.input === 'object' ? { ...options.input } : {};
  if (kind === 'audio') {
    input.prompt = prompt;
    input.duration = Math.max(4, Math.min(180, Math.round(options.duration || 20)));
    input.output_format = 'mp3';
  } else if (kind === 'video') {
    input.prompt = prompt;
    input.aspect_ratio = options.aspectRatio || '16:9';
  } else if (kind === 'model3d') {
    if (prompt) input.prompt = prompt;
    if (imageUrl) input.image = imageUrl;
  } else {
    input.prompt = prompt;
    input.aspect_ratio = options.aspectRatio || aspectRatioOf(options.size);
    input.output_format = 'png';
    if (options.negativePrompt) input.negative_prompt = options.negativePrompt;
  }
  return input;
}

function firstUrl(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return firstUrl(value[0]);
  if (typeof value === 'object') {
    return value.url || value.video || value.audio || value.model_glb
      || value.model_mesh || value.mesh || value.file || '';
  }
  return '';
}

async function generateReplicate(ctx) {
  const { apiKey, kind, prompt, model, tmpFile, options, onProgress, signal } = ctx;
  if (!model || !model.includes('/')) throw new Error('Replicate needs an owner/model identifier');
  onProgress(0.08, 'starting');
  const created = await fetchJson(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      prefer: 'wait=10',
    },
    body: JSON.stringify({ input: replicateInput(kind, prompt, options, options.imageUrl) }),
    signal,
    timeout: 120000,
  });
  let prediction = created;
  const deadline = Date.now() + 9 * 60 * 1000;
  let attempt = 0;
  while (prediction && !['succeeded', 'failed', 'canceled'].includes(prediction.status)) {
    if (Date.now() > deadline) throw new Error('Replicate generation timed out');
    if (signal && signal.aborted) throw new Error('Cancelled');
    attempt += 1;
    onProgress(Math.min(0.8, 0.15 + attempt * 0.05), prediction.status || 'processing');
    await new Promise((resolve) => setTimeout(resolve, 4000));
    const pollUrl = prediction.urls?.get;
    if (!pollUrl) throw new Error('Replicate returned no polling URL');
    prediction = await fetchJson(pollUrl, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal,
      timeout: 60000,
    });
  }
  if (!prediction || prediction.status !== 'succeeded') {
    throw new Error(prediction?.error || 'Replicate generation failed');
  }
  const url = firstUrl(prediction.output);
  if (!url) throw new Error('Replicate returned no output');
  const ext = kind === 'video' ? '.mp4' : kind === 'audio' ? '.mp3' : kind === 'model3d' ? '.glb' : '.png';
  onProgress(0.86, 'downloading');
  const saved = await downloadToFile(url, tmpFile + ext, {
    maxBytes: limitFor(kind),
    signal,
    timeout: 300000,
  });
  const mime = kind === 'video' ? 'video/mp4' : kind === 'audio' ? 'audio/mpeg' : kind === 'model3d' ? 'model/gltf-binary' : 'image/png';
  return { file: saved.file, mime, meta: { id: prediction.id, model } };
}

/* ---------------------------------------------------------------------- fal */

function falInput(kind, prompt, options) {
  const input = options.input && typeof options.input === 'object' ? { ...options.input } : {};
  input.prompt = prompt;
  if (kind === 'video') {
    input.aspect_ratio = options.aspectRatio || '16:9';
    const seconds = String(Math.max(5, Math.min(10, Math.round(options.duration || 5))));
    input.duration = seconds;
  } else if (kind === 'audio') {
    input.duration = Math.max(4, Math.min(180, Math.round(options.duration || 20)));
  } else if (kind === 'image') {
    input.image_size = options.imageSize || 'square_hd';
    input.num_images = 1;
    input.output_format = 'png';
  }
  return input;
}

async function generateFal(ctx) {
  const { apiKey, kind, prompt, model, tmpFile, options, onProgress, signal } = ctx;
  if (!model || !model.includes('/')) throw new Error('fal needs a model path');
  const endpoint = model.replace(/^\/+/, '');
  onProgress(0.08, 'queued');
  const queued = await fetchJson(`https://queue.fal.run/${endpoint}`, {
    method: 'POST',
    headers: { authorization: `Key ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(falInput(kind, prompt, options)),
    signal,
    timeout: 120000,
  });
  if (!queued?.request_id || !queued?.status_url || !queued?.response_url) {
    throw new Error('fal did not return a queue handle');
  }
  const deadline = Date.now() + 9 * 60 * 1000;
  let attempt = 0;
  while (Date.now() < deadline) {
    if (signal && signal.aborted) throw new Error('Cancelled');
    attempt += 1;
    const status = await fetchJson(`${queued.status_url}`, {
      headers: { authorization: `Key ${apiKey}` },
      signal,
      timeout: 60000,
    });
    if (status?.status === 'COMPLETED') break;
    if (status?.status === 'FAILED') throw new Error('fal generation failed');
    onProgress(Math.min(0.8, 0.15 + attempt * 0.05), 'rendering');
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }
  const result = await fetchJson(`${queued.response_url}`, {
    headers: { authorization: `Key ${apiKey}` },
    signal,
    timeout: 60000,
  });
  const url = kind === 'image'
    ? firstUrl(result?.images?.[0]?.url || result?.images)
    : kind === 'video'
      ? firstUrl(result?.video?.url || result?.video)
      : kind === 'audio'
        ? firstUrl(result?.audio?.url || result?.audio)
        : firstUrl(result?.model_mesh?.url || result?.model_glb?.url || result?.model_mesh || result?.model_glb || result?.mesh);
  if (!url) throw new Error('fal returned no media');
  const ext = kind === 'video' ? '.mp4' : kind === 'audio' ? '.mp3' : kind === 'model3d' ? '.glb' : '.png';
  onProgress(0.86, 'downloading');
  const saved = await downloadToFile(url, tmpFile + ext, { maxBytes: limitFor(kind), signal, timeout: 300000 });
  const mime = kind === 'video' ? 'video/mp4' : kind === 'audio' ? 'audio/mpeg' : kind === 'model3d' ? 'model/gltf-binary' : 'image/png';
  return { file: saved.file, mime, meta: { requestId: queued.request_id, model } };
}

/* --------------------------------------------------------------- Higgsfield */

async function generateHiggsfield(ctx) {
  const { apiKey, kind, prompt, model, tmpFile, options, onProgress, signal } = ctx;
  if (!model) throw new Error('Choose a Higgsfield model');
  const endpoint = `https://api.higgsfield.ai/${String(model).replace(/^\/+/, '')}`;
  const body = { prompt };
  if (kind === 'video') {
    body.duration = Math.max(3, Math.min(15, Math.round(Number(options.duration) || 5)));
    body.resolution = options.resolution === '1080p' ? '1080p' : '720p';
    body.aspect_ratio = ['16:9', '9:16', '1:1'].includes(options.aspect) ? options.aspect : '16:9';
  }
  onProgress(0.08, 'queued');
  const created = await fetchJson(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Key ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
    timeout: 120000,
  });
  let status = created;
  const deadline = Date.now() + 10 * 60 * 1000;
  let attempt = 0;
  while (status && !['completed', 'failed', 'cancelled', 'nsfw'].includes(status.status)) {
    if (Date.now() > deadline) throw new Error('Higgsfield generation timed out');
    if (signal && signal.aborted) throw new Error('Cancelled');
    attempt += 1;
    onProgress(Math.min(0.8, 0.12 + attempt * 0.04), status.status || 'rendering');
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const statusUrl = status.status_url || (status.request_id ? `https://api.higgsfield.ai/requests/${status.request_id}/status` : '');
    if (!statusUrl) throw new Error('Higgsfield returned no status URL');
    status = await fetchJson(statusUrl, {
      headers: { authorization: `Key ${apiKey}` },
      signal,
      timeout: 60000,
    });
  }
  if (!status || status.status !== 'completed') {
    throw new Error(status?.error?.message || status?.message || `Higgsfield generation ${status?.status || 'failed'}`);
  }
  const url = kind === 'video'
    ? firstUrl(status.video) || firstUrl(status.videos) || firstUrl(status.output)
    : firstUrl(status.images) || firstUrl(status.image) || firstUrl(status.output);
  if (!url) throw new Error('Higgsfield returned no media');
  const ext = kind === 'video' ? '.mp4' : '.png';
  const mime = kind === 'video' ? 'video/mp4' : 'image/png';
  onProgress(0.86, 'downloading');
  const saved = await downloadToFile(url, tmpFile + ext, { maxBytes: limitFor(kind), signal, timeout: 300000 });
  return { file: saved.file, mime, meta: { requestId: status.request_id || created.request_id || '', model } };
}

/* --------------------------------------------------- OpenAI compatible */

const COMPAT_DONE = new Set(['completed', 'complete', 'succeeded', 'success', 'done', 'ready', 'finished']);
const COMPAT_FAILED = new Set(['failed', 'error', 'cancelled', 'canceled', 'rejected']);
const NVIDIA_IMAGE_SIZES = [768, 832, 896, 960, 1024, 1088, 1152, 1216, 1280, 1344];

function isHostedNvidia(base) {
  try {
    const host = new URL(base).host.toLowerCase();
    return host === 'integrate.api.nvidia.com' || host === 'ai.api.nvidia.com';
  } catch {
    return false;
  }
}

/** NVIDIA's hosted genai API only accepts these widths and heights. */
function nvidiaImageSize(options = {}) {
  let width = 1024;
  let height = 1024;
  const match = String(options.size || '').match(/^(\d{3,4})\s*[x×]\s*(\d{3,4})$/i);
  if (match) {
    width = Number(match[1]);
    height = Number(match[2]);
  } else if (options.aspect === '16:9') {
    width = 1344;
    height = 768;
  } else if (options.aspect === '9:16') {
    width = 768;
    height = 1344;
  }
  const snap = (value) => NVIDIA_IMAGE_SIZES.reduce((best, size) => (
    Math.abs(size - value) < Math.abs(best - value) ? size : best
  ), 1024);
  return { width: snap(width), height: snap(height) };
}

function compatStatus(json) {
  return String(json?.status || json?.state || json?.data?.[0]?.status || '').toLowerCase();
}

function b64Buffer(value) {
  const clean = String(value || '').replace(/^data:[^,]*,/, '').trim();
  if (!clean) return null;
  const buffer = Buffer.from(clean, 'base64');
  return buffer.length ? buffer : null;
}

/** Walk common response shapes (OpenAI data[], NVIDIA artifacts[], raw jobs). */
function compatMedia(json) {
  const seen = new Set();
  const queue = [json];
  let guard = 0;
  while (queue.length && guard < 40) {
    guard += 1;
    const node = queue.shift();
    if (!node || seen.has(node)) continue;
    if (typeof node === 'string') {
      if (/^https?:\/\//i.test(node)) return { url: node };
      if (node.length > 200 && /^[A-Za-z0-9+/=\r\n]+$/.test(node)) {
        const buffer = b64Buffer(node);
        if (buffer) return { buffer };
      }
      continue;
    }
    if (typeof node !== 'object') continue;
    seen.add(node);
    const b64 = node.b64_json || node.base64 || node.b64 || node.image_base64 || node.video_base64
      || (typeof node.image === 'string' && !/^https?:/i.test(node.image) ? node.image : '');
    if (b64) {
      const buffer = b64Buffer(b64);
      if (buffer) return { buffer };
    }
    const url = node.url || node.video_url || node.videoUrl || node.content_url || node.download_url
      || node.output_url || (typeof node.image === 'string' && /^https?:/i.test(node.image) ? node.image : '')
      || (typeof node.video === 'string' && /^https?:/i.test(node.video) ? node.video : '')
      || (typeof node.content === 'string' && /^https?:/i.test(node.content) ? node.content : '');
    if (url) return { url };
    for (const key of ['data', 'artifacts', 'images', 'videos', 'output', 'outputs', 'result', 'results', 'response', 'video', 'image', 'generated_images', 'predictions']) {
      const value = node[key];
      if (!value) continue;
      if (Array.isArray(value)) queue.push(...value.slice(0, 4));
      else queue.push(value);
    }
  }
  return {};
}

async function fetchBinary(url, apiKey, signal, maxBytes) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 300000);
  const onAbort = () => controller.abort();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  let response;
  try {
    response = await fetch(url, {
      headers: { authorization: `Bearer ${apiKey}`, accept: '*/*' },
      signal: controller.signal,
      redirect: 'follow',
    });
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
  if (!response.ok) throw new Error(`Video download failed (${response.status})`);
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared && declared > maxBytes) throw new Error('Video exceeded the size limit');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error('Video download was empty');
  if (buffer.length > maxBytes) throw new Error('Video exceeded the size limit');
  return { buffer, mime: response.headers.get('content-type') || 'video/mp4' };
}

async function discoverCompatModels({ baseUrl, apiKey, signal }) {
  const base = normalizeCompatBase(baseUrl);
  if (!base) throw new Error('Enter a valid OpenAI-compatible base URL.');
  if (!apiKey) throw new Error('Add an API key for this endpoint first.');
  const json = await fetchJson(`${base}/models`, {
    headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
    signal,
    timeout: 60000,
  });
  const rows = Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : [];
  const ids = rows.map((row) => (typeof row === 'string' ? row : row?.id || row?.name || '')).filter(Boolean);
  return [...new Set(ids)];
}

function classifyCompatModels(ids) {
  const image = [];
  const video = [];
  for (const id of ids) {
    if (/(wan2|wan-ai|veo|kling|sora|cosmos-predict|luma|pika|runway|mochi|animate|i2v|t2v|text-to-video)/i.test(id)) {
      video.push(id);
    } else if (/(flux|stable-diffusion|sdxl|dall-e|\bimagen\b|qwen-image|seedream|playground|ernie-image|diffusion(?!gemma))/i.test(id)) {
      image.push(id);
    }
  }
  return { image, video };
}

async function generateOpenAICompatible(ctx) {
  const { apiKey, kind, prompt, model, tmpFile, options, onProgress, signal } = ctx;
  const base = normalizeCompatBase(ctx.baseUrl);
  if (!base) throw new Error('Set an OpenAI-compatible base URL in Engines first.');
  if (!model) throw new Error('Choose an OpenAI-compatible model in the media composer.');
  const headers = {
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
    accept: 'application/json',
  };

  if (kind === 'image' && isHostedNvidia(base)) {
    const { width, height } = nvidiaImageSize(options);
    const hostedUrl = `https://ai.api.nvidia.com/v1/genai/${String(model).split('/').map(encodeURIComponent).join('/')}`;
    onProgress(0.2, 'rendering');
    const json = await fetchJson(hostedUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        prompt,
        width,
        height,
        seed: Math.max(0, Math.round(Number(options.seed) || 0)),
        steps: 4,
      }),
      signal,
      timeout: 590000,
    });
    onProgress(0.75, 'downloading');
    const media = compatMedia(json);
    if (!media.url && !media.buffer) throw new Error('NVIDIA returned no image. Check the model name and API access.');
    const saved = await saveInlineOrFetch({
      url: media.url,
      buffer: media.buffer,
      tmpFile: tmpFile + extForMime(media.mime, '.png'),
      kind: 'image',
      onProgress,
      signal,
    });
    return { file: saved.file, mime: media.mime || 'image/png', meta: { model, size: `${width}x${height}`, endpoint: hostedUrl } };
  }

  if (kind === 'image') {
    const size = options.size || '1024x1024';
    const baseBody = { model, prompt, n: 1, size };
    if (options.negativePrompt) baseBody.negative_prompt = String(options.negativePrompt).slice(0, 2000);
    onProgress(0.2, 'rendering');
    let json;
    try {
      json = await fetchJson(`${base}/images/generations`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...baseBody, response_format: 'b64_json' }),
        signal,
        timeout: 240000,
      });
    } catch (error) {
      if (!/response_format|unknown|unrecognized|invalid|extra/i.test(String(error.message))) throw error;
      json = await fetchJson(`${base}/images/generations`, {
        method: 'POST',
        headers,
        body: JSON.stringify(baseBody),
        signal,
        timeout: 240000,
      });
    }
    onProgress(0.75, 'downloading');
    const media = compatMedia(json);
    if (!media.url && !media.buffer) throw new Error('The endpoint returned no image. Check the model name and API path.');
    const saved = await saveInlineOrFetch({
      url: media.url,
      buffer: media.buffer,
      tmpFile: tmpFile + extForMime(media.mime, '.png'),
      kind: 'image',
      onProgress,
      signal,
    });
    return { file: saved.file, mime: media.mime || 'image/png', meta: { model, size, endpoint: base } };
  }

  if (kind !== 'video') throw new Error('OpenAI compatible supports images and video only');
  if (isHostedNvidia(base)) {
    throw new Error('NVIDIA hosted video is not available on this endpoint. Use a self-hosted NVIDIA NIM base URL for Wan2.2 video.');
  }
  const seconds = Math.max(1, Math.min(30, Math.round(Number(options.duration) || 4)));
  const body = { model, prompt, seconds };
  const aspectSize = { '16:9': '832x480', '9:16': '480x832', '1:1': '624x624' }[options.aspect];
  if (options.size) body.size = String(options.size).slice(0, 20);
  else if (aspectSize) body.size = aspectSize;
  if (options.negativePrompt) body.negative_prompt = String(options.negativePrompt).slice(0, 2000);
  onProgress(0.1, 'queued');
  let endpoint = `${base}/videos/generations`;
  const post = async (url, payload) => fetchJson(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal,
    timeout: 590000,
  });
  let json;
  try {
    json = await post(endpoint, body);
  } catch (error) {
    const message = String(error.message || '');
    if (/404|not found/i.test(message)) {
      endpoint = `${base}/videos`;
      try {
        json = await post(endpoint, body);
      } catch (retryError) {
        if (!/unknown|unsupported|invalid|extra|unexpected/i.test(String(retryError.message))) throw retryError;
        json = await post(endpoint, { model, prompt });
      }
    } else if (/unknown|unsupported|invalid|extra|unexpected/i.test(message)) {
      json = await post(endpoint, { model, prompt });
    } else {
      throw error;
    }
  }
  let media = compatMedia(json);
  let statusValue = compatStatus(json);
  let lastPayload = json;
  let id = json?.id || json?.request_id || json?.video_id || json?.task_id
    || json?.data?.[0]?.id || json?.data?.[0]?.request_id || '';
  const deadline = Date.now() + 12 * 60 * 1000;
  let attempt = 0;
  while (!media.url && !media.buffer && id && Date.now() < deadline) {
    if (signal && signal.aborted) throw new Error('Cancelled');
    if (COMPAT_FAILED.has(statusValue)) {
      throw new Error(lastPayload?.error?.message || lastPayload?.error || lastPayload?.message || 'Video generation failed');
    }
    if (COMPAT_DONE.has(statusValue)) break;
    attempt += 1;
    onProgress(Math.min(0.8, 0.28 + attempt * 0.03), statusValue || 'rendering video');
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const pollUrls = [];
    if (lastPayload?.status_url) pollUrls.push(String(lastPayload.status_url));
    pollUrls.push(`${endpoint}/${encodeURIComponent(id)}`);
    if (endpoint.endsWith('/generations')) pollUrls.push(`${base}/videos/${encodeURIComponent(id)}`);
    let latest = null;
    let lastError = null;
    for (const url of pollUrls) {
      try {
        latest = await fetchJson(url, {
          headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
          signal,
          timeout: 60000,
        });
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!latest) throw lastError || new Error('Video status could not be read.');
    lastPayload = latest;
    statusValue = compatStatus(latest);
    media = compatMedia(latest);
    id = latest?.id || latest?.request_id || latest?.video_id || latest?.task_id || id;
  }
  if (!media.url && !media.buffer && id && COMPAT_DONE.has(statusValue)) {
    for (const url of [`${endpoint}/${encodeURIComponent(id)}/content`, `${base}/videos/${encodeURIComponent(id)}/content`]) {
      try {
        const binary = await fetchBinary(url, apiKey, signal, MAX_VIDEO);
        media = { buffer: binary.buffer, mime: binary.mime };
        break;
      } catch {}
    }
  }
  if (!media.url && !media.buffer) {
    if (Date.now() >= deadline) throw new Error('Video generation timed out');
    throw new Error('The endpoint returned no video. Check the model name and API path.');
  }
  onProgress(0.86, 'downloading');
  const ext = extForMime(media.mime, '.mp4');
  const saved = await saveInlineOrFetch({
    url: media.url,
    buffer: media.buffer,
    tmpFile: tmpFile + (ext === '.bin' ? '.mp4' : ext),
    kind: 'video',
    onProgress,
    signal,
  });
  return {
    file: saved.file,
    mime: media.mime || 'video/mp4',
    meta: { model, endpoint: base, seconds, jobId: id || '' },
  };
}

const VENDORS = {
  openai: generateOpenAI,
  'google': generateImagen,
  'google-veo': generateVeo,
  stability: generateStability,
  elevenlabs: generateElevenLabs,
  replicate: generateReplicate,
  fal: generateFal,
  higgsfield: generateHiggsfield,
  'openai-compatible': generateOpenAICompatible,
};

async function generateCloud(ctx) {
  const provider = providerFor(ctx.provider);
  if (!provider) throw new Error(`Unknown media provider ${ctx.provider}`);
  if (!provider.kinds.includes(ctx.kind)) {
    throw new Error(`${provider.label} does not support ${ctx.kind}`);
  }
  const runner = VENDORS[provider.vendor];
  if (!runner) throw new Error(`No adapter for ${provider.label}`);
  const started = Date.now();
  if (ctx.onProgress) ctx.onProgress(0.04, 'contacting provider');
  const result = await runner(ctx);
  return {
    ...result,
    meta: { ...(result.meta || {}), provider: provider.id, providerLabel: provider.label, elapsedMs: Date.now() - started },
  };
}

module.exports = {
  CLOUD_PROVIDERS,
  cloudProviderList,
  providerFor,
  resolveCloudKey,
  generateCloud,
  editOpenAIImage,
  modelsForKind,
  downloadToFile,
  assertPublicHost,
  aspectRatioOf,
  extForMime,
  dataUrlToBuffer,
  normalizeCompatBase,
  compatEndpoint,
  compatModels,
  discoverCompatModels,
  classifyCompatModels,
  nvidiaImageSize,
};
