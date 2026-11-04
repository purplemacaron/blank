'use strict';

/* ComfyUI bridge. Talks to a user-configured local or LAN ComfyUI server
   through its HTTP API: submits a minimal KSampler workflow, polls history
   and saves the first rendered image. No credentials are involved. */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_JSON = 8 * 1024 * 1024;
const MAX_IMAGE = 64 * 1024 * 1024;
const DEADLINE = 8 * 60 * 1000;

const SIZES = {
  '1:1': [1024, 1024],
  '4:3': [1152, 896],
  '3:4': [896, 1152],
  '16:9': [1344, 768],
  '9:16': [768, 1344],
};

function normalizeBase(endpoint) {
  const raw = String(endpoint || '').trim();
  if (!raw) throw new Error('Add a ComfyUI endpoint in Studio → Engines');
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error('ComfyUI endpoint is not a valid URL'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('ComfyUI endpoint must start with http:// or https://');
  return parsed.toString().replace(/\/+$/, '');
}

async function request(endpoint, route, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout || 30000);
  const onAbort = () => controller.abort();
  if (options.signal) options.signal.addEventListener('abort', onAbort, { once: true });
  try {
    const response = await fetch(`${normalizeBase(endpoint)}${route}`, {
      method: options.method || 'GET',
      headers: options.headers || {},
      body: options.body,
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`ComfyUI ${response.status}: ${text.slice(0, 240) || response.statusText}`);
    }
    if (options.binary) {
      const length = Number(response.headers.get('content-length') || 0);
      if (length && length > MAX_IMAGE) throw new Error('ComfyUI image is too large');
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > MAX_IMAGE) throw new Error('ComfyUI image is too large');
      return buffer;
    }
    const text = await response.text();
    if (text.length > MAX_JSON) throw new Error('ComfyUI response is too large');
    try { return text ? JSON.parse(text) : null; } catch { throw new Error('ComfyUI returned invalid JSON'); }
  } finally {
    clearTimeout(timer);
    if (options.signal) options.signal.removeEventListener('abort', onAbort);
  }
}

async function checkpoints(endpoint) {
  const info = await request(endpoint, '/object_info/CheckpointLoaderSimple', { timeout: 30000 });
  const values = info?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0];
  return Array.isArray(values) ? values.filter((value) => typeof value === 'string') : [];
}

async function ping(endpoint) {
  const base = normalizeBase(endpoint);
  const stats = await request(base, '/system_stats', { timeout: 8000 });
  const names = await checkpoints(base).catch(() => []);
  return {
    ok: true,
    version: stats?.system?.comfyui_version || stats?.system?.os || '',
    checkpoints: names.slice(0, 12),
  };
}

function workflowFor({ checkpoint, prompt, width, height, seed }) {
  return {
    3: {
      class_type: 'KSampler',
      inputs: {
        seed,
        steps: 24,
        cfg: 6.5,
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1,
        model: ['4', 0],
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['5', 0],
      },
    },
    4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
    5: { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    6: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['4', 1] } },
    7: { class_type: 'CLIPTextEncode', inputs: { text: 'blurry, watermark, text, low quality', clip: ['4', 1] } },
    8: { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    9: { class_type: 'SaveImage', inputs: { filename_prefix: 'Blank', images: ['8', 0] } },
  };
}

async function generate({ endpoint, prompt, options = {}, tmpFile, signal, onProgress }) {
  const base = normalizeBase(endpoint);
  if (options.model && options.model !== 'auto') {
    // Explicit model path means the caller supplied a workflow-safe checkpoint.
  }
  onProgress?.(0.12, 'reading checkpoints');
  const list = await checkpoints(base);
  if (!list.length) throw new Error('ComfyUI has no checkpoints installed');
  const checkpoint = options.model && options.model !== 'auto' && list.includes(options.model) ? options.model : list[0];
  const [width, height] = SIZES[options.aspect] || SIZES['1:1'];
  const seed = Number.isFinite(Number(options.seed)) ? Number(options.seed) >>> 0 : crypto.randomInt(1, 2 ** 32 - 1);
  const clientId = crypto.randomUUID();
  const workflow = workflowFor({ checkpoint, prompt, width, height, seed });
  onProgress?.(0.22, 'queued');
  const queued = await request(base, '/prompt', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
    signal,
    timeout: 60000,
  });
  const promptId = queued?.prompt_id;
  if (!promptId) throw new Error('ComfyUI did not accept the workflow');
  const deadline = Date.now() + DEADLINE;
  let image = null;
  let attempt = 0;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('Cancelled');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    attempt += 1;
    onProgress?.(Math.min(0.82, 0.28 + attempt * 0.035), 'rendering');
    const history = await request(base, `/history/${encodeURIComponent(promptId)}`, { signal, timeout: 30000 });
    const entry = history?.[promptId];
    if (!entry) continue;
    if (entry.status?.status_str === 'error') {
      const detail = entry.status?.messages?.find?.((message) => message?.[0] === 'execution_error')?.[1];
      throw new Error(detail?.exception_message || 'ComfyUI workflow failed');
    }
    for (const output of Object.values(entry.outputs || {})) {
      if (Array.isArray(output?.images) && output.images.length) {
        image = output.images[0];
        break;
      }
    }
    if (image) break;
  }
  if (!image) throw new Error('ComfyUI generation timed out');
  const query = new URLSearchParams({
    filename: image.filename || '',
    subfolder: image.subfolder || '',
    type: image.type || 'output',
  });
  onProgress?.(0.9, 'downloading');
  const buffer = await request(base, `/view?${query.toString()}`, { binary: true, signal, timeout: 120000 });
  fs.mkdirSync(path.dirname(tmpFile), { recursive: true });
  const file = tmpFile + '.png';
  await fs.promises.writeFile(file, buffer);
  return { file, mime: 'image/png', width, height, meta: { checkpoint, seed, promptId } };
}

module.exports = { generate, ping, checkpoints, normalizeBase };
