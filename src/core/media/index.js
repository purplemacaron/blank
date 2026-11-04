'use strict';

/* Blank media library — one pipeline for images, video, music and 3D.
   Generation runs only through engines the user has actually connected:
   cloud providers with saved keys, a ComfyUI endpoint, or installed system
   voices for speech. Local sharp/ffmpeg tools remain for non-destructive
   edits and previews. Keys never leave the main process. */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  sharp, sharpAvailable, ffmpegAvailable, ffmpegBin, mediaPaths, ensureMedia,
  MEDIA_MIME, mimeForFile, fileSize, runProcess, probeMedia, makeWaveform,
  makePoster, makeThumbnail, imageInfo, hashString, clamp, titleFromPrompt,
  pickAspect, parseDimensions, safeName, extForMime, escapeXml, hexToRgb,
  readJSON, writeJSON,
} = (() => {
  const util = require('./util');
  return { ...util, readJSON: require('../paths').readJSON, writeJSON: require('../paths').writeJSON };
})();
const meshEngine = require('./mesh');
const cloud = require('./cloud');
const comfy = require('./comfy');
const voice = require('./voice');

const KINDS = ['image', 'video', 'audio', 'model3d'];
const KIND_LABEL = { image: 'Image', video: 'Video', audio: 'Music', model3d: '3D' };
const MAX_JOBS = 60;

const MEDIA_DEFAULTS = {
  image: { aspect: '1:1' },
  video: { aspect: '16:9', duration: 4 },
  audio: { duration: 20 },
  model3d: {},
};

let context = {
  getConfig: () => ({}),
  emit: () => {},
  patchConfig: null,
};
let jobs = new Map();
const controllers = new Map();
let indexCache = null;

function configureMedia(next = {}) {
  context = { ...context, ...next };
  indexCache = null;
}

function emit(event, payload) {
  try {
    context.emit(event, payload);
  } catch {}
}

function libraryPaths() {
  const paths = mediaPaths();
  ensureMedia();
  return paths;
}

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix = 'm') {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
}

/* ------------------------------------------------------------------ index */

function readIndex() {
  if (indexCache) return indexCache;
  const { index } = libraryPaths();
  const raw = readJSON(index, null);
  const items = Array.isArray(raw?.items) ? raw.items.filter((item) => item && item.id && item.kind) : [];
  indexCache = { version: 1, items, updatedAt: raw?.updatedAt || nowIso() };
  return indexCache;
}

function writeIndex(data) {
  const { index } = libraryPaths();
  data.updatedAt = nowIso();
  indexCache = data;
  writeJSON(index, data);
}

function mediaUrl(fileName) {
  if (!fileName) return '';
  return `blank-media://asset/${encodeURIComponent(fileName)}`;
}

function publicItem(item) {
  const fallbackPreview = item.waveformName || item.previewName || item.thumbName || item.posterName || item.fileName;
  const urls = {
    file: mediaUrl(item.fileName),
    thumb: mediaUrl(item.thumbName || item.waveformName || item.previewName || item.posterName || item.fileName),
    poster: mediaUrl(item.posterName || item.thumbName || item.fileName),
    waveform: item.waveformName ? mediaUrl(item.waveformName) : '',
    preview: mediaUrl(fallbackPreview),
  };
  return {
    id: item.id,
    kind: item.kind,
    kindLabel: KIND_LABEL[item.kind] || item.kind,
    title: item.title,
    prompt: item.prompt || '',
    engine: item.engine,
    provider: item.provider || '',
    engineLabel: item.engineLabel || '',
    model: item.model || '',
    fileName: item.fileName,
    mime: item.mime || '',
    bytes: item.bytes || 0,
    width: item.width || 0,
    height: item.height || 0,
    duration: item.duration || 0,
    seed: item.seed ?? null,
    favorite: Boolean(item.favorite),
    source: item.source || 'generated',
    parentId: item.parentId || '',
    createdAt: item.createdAt,
    meta: item.meta || {},
    extraFiles: (item.extraFiles || []).map((file) => ({
      name: file.name,
      fileName: file.fileName,
      bytes: file.bytes,
      url: mediaUrl(file.fileName),
    })),
    urls,
  };
}

function readConfig() {
  try {
    return context.getConfig() || {};
  } catch {
    return {};
  }
}

function engineAvailability() {
  const config = readConfig();
  const keys = (config.media && config.media.keys) || {};
  const endpoints = (config.media && config.media.endpoints) || {};
  const comfyEndpoint = String(endpoints.comfyui || '').trim();
  const providers = config.providers || {};
  const hasKey = (id) => Boolean(keys[id] || providers[id]?.apiKey);
  const local = [
    {
      id: 'system-voice',
      label: 'System voice',
      vendor: 'local',
      kinds: ['audio'],
      available: voice.available(),
      note: 'Text to speech with voices installed on this machine.',
      models: ['system'],
      speech: true,
    },
    {
      id: 'comfyui',
      label: 'ComfyUI',
      vendor: 'comfyui',
      kinds: ['image'],
      available: Boolean(comfyEndpoint),
      note: 'Your own ComfyUI server over its HTTP API.',
      endpoint: comfyEndpoint,
      models: ['auto'],
    },
  ];
  const remote = cloud.cloudProviderList().map((provider) => ({
    ...provider,
    available: hasKey(provider.keyId),
    hasKey: hasKey(provider.keyId),
    vendor: 'cloud',
  }));
  return { local, cloud: remote };
}

function storageInfo() {
  const data = readIndex();
  const counts = { image: 0, video: 0, audio: 0, model3d: 0 };
  let bytes = 0;
  for (const item of data.items) {
    counts[item.kind] = (counts[item.kind] || 0) + 1;
    bytes += Number(item.bytes) || 0;
  }
  return {
    root: libraryPaths().root,
    count: data.items.length,
    counts,
    bytes,
    capabilities: { sharp: sharpAvailable(), ffmpeg: ffmpegAvailable() },
    cloudReady: engineAvailability().cloud.filter((p) => p.available).map((p) => p.id),
  };
}

function listAssets(options = {}) {
  const data = readIndex();
  const kind = options.kind && KINDS.includes(options.kind) ? options.kind : '';
  const query = String(options.query || '').trim().toLowerCase();
  let items = data.items;
  if (kind) items = items.filter((item) => item.kind === kind);
  if (options.favorite) items = items.filter((item) => item.favorite);
  if (query) {
    items = items.filter((item) => `${item.title} ${item.prompt} ${item.engineLabel || ''} ${item.model || ''}`.toLowerCase().includes(query));
  }
  items = [...items].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const total = items.length;
  const offset = Math.max(0, Number(options.offset) || 0);
  const limit = Math.max(1, Math.min(200, Number(options.limit) || 60));
  return {
    items: items.slice(offset, offset + limit).map(publicItem),
    total,
    offset,
    limit,
    counts: storageInfo().counts,
  };
}

function getAsset(id) {
  const found = readIndex().items.find((item) => item.id === id);
  return found ? publicItem(found) : null;
}

function getRecord(id) {
  return readIndex().items.find((item) => item.id === id) || null;
}

function recordPath(record, name) {
  return path.join(libraryPaths().assets, name);
}

function updateRecord(id, patch) {
  const data = readIndex();
  const record = data.items.find((item) => item.id === id);
  if (!record) return null;
  Object.assign(record, patch);
  writeIndex(data);
  return record;
}

function removeAsset(id) {
  const data = readIndex();
  const index = data.items.findIndex((item) => item.id === id);
  if (index < 0) return { removed: false };
  const record = data.items[index];
  const files = new Set([
    record.fileName, record.thumbName, record.posterName, record.waveformName, record.previewName,
    ...(record.extraFiles || []).map((file) => file.fileName),
  ].filter(Boolean));
  for (const name of files) {
    try {
      fs.rmSync(recordPath(record, name), { force: true });
    } catch {}
  }
  data.items.splice(index, 1);
  writeIndex(data);
  emit('media:removed', { id });
  return { removed: true };
}

function toggleFavorite(id) {
  const record = getRecord(id);
  if (!record) throw new Error('Media asset not found');
  updateRecord(id, { favorite: !record.favorite });
  const updated = getRecord(id);
  emit('media:asset', { asset: publicItem(updated), replaced: true });
  return publicItem(updated);
}

/* --------------------------------------------------------------- previews */

function waveformSvg(peaks, options = {}) {
  const width = options.width || 1200;
  const height = options.height || 320;
  const color = options.color || '#2F6BFF';
  const mid = height / 2;
  const count = Math.max(24, peaks.length);
  const step = width / count;
  let bars = '';
  for (let i = 0; i < count; i += 1) {
    const value = peaks[i] ?? peaks[Math.min(peaks.length - 1, Math.round((i / count) * peaks.length))] ?? 0;
    const amp = Math.max(0.035, Math.min(1, value)) * (mid - 16);
    const x = i * step + step * 0.22;
    const w = Math.max(1.6, step * 0.56);
    bars += `<rect x="${x.toFixed(1)}" y="${(mid - amp).toFixed(1)}" width="${w.toFixed(1)}" height="${(amp * 2).toFixed(1)}" rx="${(w / 2).toFixed(1)}" fill="${color}" fill-opacity="${(0.32 + (i / count) * 0.55).toFixed(2)}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="wf" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${color}" stop-opacity="0.55"/><stop offset="0.55" stop-color="${color}"/><stop offset="1" stop-color="${color}" stop-opacity="0.35"/></linearGradient></defs><g fill="url(#wf)">${bars.replace(new RegExp(color, 'g'), 'url(#wf)')}</g></svg>`;
}

async function writeWaveformPreview(peaks, outFile) {
  if (!sharpAvailable()) return '';
  try {
    const svg = waveformSvg(peaks);
    await sharp(Buffer.from(svg)).png().toFile(outFile);
    return outFile;
  } catch {
    return '';
  }
}

async function peaksForFile(file) {
  return makeWaveform(file, 180);
}

function placeholderPreviewSvg(record, title) {
  const label = escapeXml(String(title || 'MODEL').slice(0, 34));
  const type = escapeXml((record.mime || 'model').replace('model/', '').toUpperCase());
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">
  <rect width="1200" height="900" fill="#0B1222"/>
  <g stroke="#2F6BFF" stroke-opacity="0.25">${Array.from({ length: 18 }, (_, i) => `<line x1="${i * 70}" y1="0" x2="${i * 70}" y2="900"/>`).join('')}${Array.from({ length: 14 }, (_, i) => `<line x1="0" y1="${i * 70}" x2="1200" y2="${i * 70}"/>`).join('')}</g>
  <g fill="none" stroke="#8FB2FF" stroke-width="2" stroke-linejoin="round">
    <path d="M600 260 L810 380 L810 620 L600 740 L390 620 L390 380 Z"/>
    <path d="M600 260 L600 500 L810 620 M600 500 L390 620 M810 380 L600 500" stroke-opacity="0.5"/>
  </g>
  <text x="600" y="820" text-anchor="middle" fill="#EAF0FF" font-family="Segoe UI, sans-serif" font-size="30" font-weight="600">${label}</text>
  <text x="600" y="858" text-anchor="middle" fill="#6F86B8" font-family="Cascadia Code, monospace" font-size="16" letter-spacing="4">${type} · BLANK 3D</text>
</svg>`;
}

function objToPreviewModel(file, title) {
  const text = fs.readFileSync(file, 'utf8');
  if (text.length > 80 * 1024 * 1024) throw new Error('OBJ is too large to preview');
  const vertices = [];
  const triangles = [];
  const groups = [];
  const colors = ['#2F6BFF', '#8FB2FF', '#37506F', '#5A76A8'];
  let current = -1;
  const materialIndex = new Map();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('v ')) {
      const [, x, y, z] = line.split(/\s+/).map(Number);
      if ([x, y, z].every(Number.isFinite)) vertices.push([x, y, z]);
    } else if (line.startsWith('usemtl ')) {
      const name = line.slice(7).trim();
      if (!materialIndex.has(name)) {
        materialIndex.set(name, groups.length);
        groups.push({ name, color: colors[groups.length % colors.length], faceStart: triangles.length, faceCount: 0 });
      }
      current = materialIndex.get(name);
    } else if (line.startsWith('f ')) {
      const refs = line.slice(2).trim().split(/\s+/).map((part) => parseInt(part, 10) - 1).filter((n) => Number.isInteger(n) && n >= 0 && n < vertices.length);
      if (refs.length < 3) continue;
      if (current < 0) {
        if (!groups.length) groups.push({ name: 'mesh', color: colors[0], faceStart: 0, faceCount: 0 });
        current = 0;
      }
      for (let i = 1; i < refs.length - 1; i += 1) {
        triangles.push({ a: refs[0], b: refs[i], c: refs[i + 1], group: current });
        groups[current].faceCount += 1;
      }
      if (triangles.length > 300000) throw new Error('OBJ has too many faces to preview');
    }
  }
  if (!vertices.length || !triangles.length) throw new Error('OBJ contains no geometry');
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const [x, y, z] of vertices) {
    bounds.min[0] = Math.min(bounds.min[0], x); bounds.min[1] = Math.min(bounds.min[1], y); bounds.min[2] = Math.min(bounds.min[2], z);
    bounds.max[0] = Math.max(bounds.max[0], x); bounds.max[1] = Math.max(bounds.max[1], y); bounds.max[2] = Math.max(bounds.max[2], z);
  }
  const size = [bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]].map((v) => Math.max(0.01, v));
  return {
    kind: 'imported',
    kindLabel: 'Imported',
    title: title || 'Imported model',
    palette: colors,
    theme: { bg: '#0B1222', ink: '#EAF0FF' },
    mesh: { vertices, triangles, groups },
    bounds,
    size,
    stats: { vertices: vertices.length, triangles: triangles.length, groups: groups.length },
    quality: 'imported',
    seed: 0,
  };
}

function stlToPreviewModel(file, title) {
  const buffer = fs.readFileSync(file);
  if (buffer.length < 84) throw new Error('STL is too small');
  const count = buffer.readUInt32LE(80);
  if (!count || count > 300000 || buffer.length < 84 + count * 50) throw new Error('STL is invalid or too large');
  const vertices = [];
  const triangles = [];
  const lookup = new Map();
  const key = (x, y, z) => `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
  for (let i = 0; i < count; i += 1) {
    const offset = 84 + i * 50 + 12;
    const refs = [];
    for (let v = 0; v < 3; v += 1) {
      const x = buffer.readFloatLE(offset + v * 12);
      const y = buffer.readFloatLE(offset + v * 12 + 4);
      const z = buffer.readFloatLE(offset + v * 12 + 8);
      if (![x, y, z].every(Number.isFinite)) throw new Error('STL has invalid vertices');
      const k = key(x, y, z);
      let index = lookup.get(k);
      if (index === undefined) {
        index = vertices.length;
        lookup.set(k, index);
        vertices.push([x, y, z]);
      }
      refs.push(index);
    }
    triangles.push({ a: refs[0], b: refs[1], c: refs[2], group: 0 });
  }
  const groups = [{ name: 'mesh', color: '#8FB2FF', faceStart: 0, faceCount: triangles.length }];
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const [x, y, z] of vertices) {
    bounds.min[0] = Math.min(bounds.min[0], x); bounds.min[1] = Math.min(bounds.min[1], y); bounds.min[2] = Math.min(bounds.min[2], z);
    bounds.max[0] = Math.max(bounds.max[0], x); bounds.max[1] = Math.max(bounds.max[1], y); bounds.max[2] = Math.max(bounds.max[2], z);
  }
  const size = [bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]].map((v) => Math.max(0.01, v));
  return {
    kind: 'imported',
    kindLabel: 'Imported',
    title: title || 'Imported model',
    palette: ['#2F6BFF', '#8FB2FF', '#37506F', '#5A76A8'],
    theme: { bg: '#0B1222', ink: '#EAF0FF' },
    mesh: { vertices, triangles, groups },
    bounds,
    size,
    stats: { vertices: vertices.length, triangles: triangles.length, groups: 1 },
    quality: 'imported',
    seed: 0,
  };
}

async function renderModelPreview(file, outFile, title) {
  const ext = path.extname(file).toLowerCase();
  let svg;
  if (ext === '.obj') {
    const model = objToPreviewModel(file, title);
    svg = meshEngine.renderMeshPreview(model, { width: 1200, height: 900, shadow: true, grid: true, label: title });
  } else if (ext === '.stl') {
    const model = stlToPreviewModel(file, title);
    svg = meshEngine.renderMeshPreview(model, { width: 1200, height: 900, shadow: true, grid: true, label: title });
  } else {
    svg = placeholderPreviewSvg({ mime: mimeForFile(file) }, title);
  }
  await sharp(Buffer.from(svg)).png().toFile(outFile);
  return outFile;
}

/* ---------------------------------------------------------------- records */

function assetBaseName(id, title) {
  return `${id}-${safeName(title)}`;
}

async function saveFinalAsset(job, produced, options = {}) {
  const paths = libraryPaths();
  const kind = produced.kind;
  const title = produced.title || titleFromPrompt(produced.prompt, KIND_LABEL[kind]);
  const id = options.id || makeId(KIND_LABEL[kind] ? kind[0] : 'm');
  const base = assetBaseName(id, title);
  const ext = path.extname(produced.file) || extForMime(produced.mime, '.bin');
  const fileName = `${base}${ext}`;
  const dest = path.join(paths.assets, fileName);
  await fs.promises.copyFile(produced.file, dest);
  const extraFiles = [];
  if (kind === 'model3d' && Array.isArray(produced.extraFiles)) {
    for (const extra of produced.extraFiles) {
      if (!extra || !extra.file || !fs.existsSync(extra.file)) continue;
      const extraExt = path.extname(extra.file) || path.extname(extra.name || '');
      const extraName = `${base}${extraExt}`;
      await fs.promises.copyFile(extra.file, path.join(paths.assets, extraName));
      extraFiles.push({ name: path.basename(extra.name || extraName), fileName: extraName, bytes: fileSize(path.join(paths.assets, extraName)) });
    }
    if (ext === '.obj' && extraFiles.length) {
      try {
        const text = await fs.promises.readFile(dest, 'utf8');
        const mtl = extraFiles.find((file) => file.fileName.endsWith('.mtl'));
        if (mtl) await fs.promises.writeFile(dest, text.replace(/^mtllib .*$/m, `mtllib ${mtl.fileName}`), 'utf8');
      } catch {}
    }
  }
  const record = {
    id,
    kind,
    title,
    prompt: produced.prompt || '',
    engine: produced.engine || 'local',
    engineLabel: produced.engineLabel || 'Local tools',
    provider: produced.provider || '',
    model: produced.model || '',
    fileName,
    mime: produced.mime || mimeForFile(dest),
    bytes: fileSize(dest),
    width: produced.width || 0,
    height: produced.height || 0,
    duration: produced.duration || 0,
    seed: produced.seed ?? null,
    source: produced.source || 'generated',
    parentId: produced.parentId || '',
    favorite: false,
    createdAt: nowIso(),
    jobId: job.id,
    meta: produced.meta || {},
    thumbName: '',
    posterName: '',
    waveformName: '',
    previewName: '',
    extraFiles,
  };
  if (kind === 'image') {
    const thumbName = `${base}.thumb.png`;
    if (await makeThumbnail(dest, path.join(paths.assets, thumbName), 720)) record.thumbName = thumbName;
    if (!record.width || !record.height) {
      const info = await imageInfo(dest);
      record.width = info.width || record.width;
      record.height = info.height || record.height;
    }
  } else if (kind === 'video') {
    const probe = await probeMedia(dest);
    record.width = probe.width || record.width;
    record.height = probe.height || record.height;
    record.duration = probe.duration || record.duration;
    const posterName = `${base}.poster.jpg`;
    const poster = await makePoster(dest, path.join(paths.assets, posterName), Math.min(1, (record.duration || 2) / 2));
    if (poster) {
      record.posterName = posterName;
      const thumbName = `${base}.thumb.png`;
      if (await makeThumbnail(poster, path.join(paths.assets, thumbName), 720)) record.thumbName = thumbName;
    }
  } else if (kind === 'audio') {
    const probe = await probeMedia(dest);
    record.duration = probe.duration || record.duration;
    const peaks = await peaksForFile(dest);
    record.peaks = peaks;
    const waveformName = `${base}.wave.png`;
    if (await writeWaveformPreview(peaks, path.join(paths.assets, waveformName))) record.waveformName = waveformName;
  } else if (kind === 'model3d') {
    const previewName = `${base}.preview.png`;
    if (produced.previewFile && fs.existsSync(produced.previewFile)) {
      await fs.promises.copyFile(produced.previewFile, path.join(paths.assets, previewName));
      record.previewName = previewName;
    } else {
      try {
        await renderModelPreview(dest, path.join(paths.assets, previewName), title);
        record.previewName = previewName;
      } catch {}
    }
    record.width = 1200;
    record.height = 900;
  }
  const data = readIndex();
  data.items.push(record);
  writeIndex(data);
  const item = publicItem(record);
  emit('media:asset', { asset: item });
  return { record, item };
}

/* ---------------------------------------------------------------- speech */

async function generateSpeech(job, prompt, options) {
  const paths = libraryPaths();
  await fs.promises.mkdir(paths.temp, { recursive: true });
  let selectedVoice = String(options.voice || '').replace(/[\r\n]/g, ' ').trim().slice(0, 120);
  if (!selectedVoice && /[가-힣]/.test(prompt)) {
    const voices = await voice.listVoices().catch(() => []);
    selectedVoice = voices.find((name) => /Heami|SunHi|Yuna|Jin|Bong|Korean|ko-KR|Garam|Minsu/i.test(name)) || '';
  }
  const rate = clamp(Math.round(Number(options.rate) || 0), -10, 10);
  job.progress(0.2, 'speaking');
  const wav = await voice.synthesize({
    text: prompt,
    voice: selectedVoice,
    rate,
    outWav: path.join(paths.temp, `${job.id}.wav`),
    textFile: path.join(paths.temp, `${job.id}.txt`),
    signal: job.signal,
  });
  let file = wav;
  if (ffmpegAvailable()) {
    const mp3 = path.join(paths.temp, `${job.id}.mp3`);
    try {
      await runProcess(ffmpegBin(), [
        '-v', 'error', '-y', '-i', wav,
        '-codec:a', 'libmp3lame', '-b:a', '192k', mp3,
      ], { signal: job.signal, timeout: 120000, maxStdout: 4096 });
      file = mp3;
    } catch {}
  }
  job.progress(0.9, 'finishing');
  const probe = await probeMedia(file);
  return {
    kind: 'audio',
    file,
    mime: file.endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav',
    duration: probe.duration || 0,
    width: 0,
    height: 0,
    title: titleFromPrompt(prompt, 'Speech'),
    prompt,
    engine: 'system-voice',
    engineLabel: 'System voice',
    model: 'system',
    meta: { speech: true, voice: selectedVoice || 'auto', rate },
  };
}

/* ------------------------------------------------------------- cloud gen */

const SPEECH_ENGINE = 'system-voice';
const LEGACY_ENGINES = new Set(['blank', 'blank-image', 'blank-audio', 'blank-3d']);

function normalizeEngineId(engine) {
  const id = String(engine || '').trim().replace(/^cloud:/, '');
  if (!id || id === 'auto') return '';
  if (id === 'blank-voice') return SPEECH_ENGINE;
  if (LEGACY_ENGINES.has(id)) return '';
  return id;
}

function findCloudProvider(engine) {
  const id = normalizeEngineId(engine);
  if (!id || id === SPEECH_ENGINE || id === 'comfyui') return null;
  return cloud.providerFor(id);
}

function enginesForKind(kind) {
  const { local, cloud: remote } = engineAvailability();
  return [...local, ...remote].filter((engine) => engine.kinds.includes(kind));
}

function noEngineMessage(kind) {
  if (kind === 'image') return 'No image engine is configured. Add a provider key or a ComfyUI endpoint in Studio → Engines.';
  if (kind === 'video') return 'No video engine is configured. Add Google Veo, Higgsfield, Replicate or fal in Studio → Engines.';
  if (kind === 'audio') return 'No audio engine is configured. Add a music provider in Studio → Engines, or choose System voice for speech.';
  if (kind === 'model3d') return 'No 3D engine is configured. Add Replicate or fal in Studio → Engines.';
  return `No ${KIND_LABEL[kind] || kind} engine is configured. Open Studio → Engines.`;
}

function resolveGenerateEngine(kind, requested) {
  const wanted = normalizeEngineId(requested);
  if (wanted) {
    const engine = enginesForKind(kind).find((entry) => entry.id === wanted);
    if (!engine) throw new Error(`Unknown ${KIND_LABEL[kind] || kind} engine: ${wanted}`);
    if (!engine.available) throw new Error(`${engine.label} is not configured. Add its key or endpoint in Studio → Engines.`);
    return engine;
  }
  const automatic = enginesForKind(kind).find((engine) => engine.available && !engine.speech);
  if (automatic) return automatic;
  throw new Error(noEngineMessage(kind));
}

function engineLabelFor(engine) {
  const id = normalizeEngineId(engine);
  if (!id || id === 'local') return 'Local tools';
  if (id === SPEECH_ENGINE) return 'System voice';
  if (id === 'comfyui') return 'ComfyUI';
  return findCloudProvider(id)?.label || id;
}

async function generateCloudAsset(job, prompt, options, producedKinds) {
  const provider = findCloudProvider(options.engine);
  if (!provider) throw new Error(`Unknown cloud media engine: ${options.engine}`);
  if (!provider.kinds.includes(options.kind)) throw new Error(`${provider.label} cannot generate ${KIND_LABEL[options.kind]}`);
  const config = readConfig();
  const apiKey = cloud.resolveCloudKey(config, provider);
  if (!apiKey) throw new Error(`Add a ${provider.keyLabel} in Studio → Engines to use ${provider.label}`);
  const models = typeof cloud.modelsForKind === 'function' ? cloud.modelsForKind(provider, options.kind) : provider.models;
  const model = options.model || models[0] || provider.models[0];
  const paths = libraryPaths();
  const tmpBase = path.join(paths.temp, `${job.id}-${provider.id}`);
  await fs.promises.mkdir(paths.temp, { recursive: true });
  const result = await cloud.generateCloud({
    provider: provider.id,
    apiKey,
    kind: options.kind,
    prompt,
    model,
    options,
    tmpFile: tmpBase,
    signal: job.signal,
    onProgress: (progress, stage) => job.progress(0.08 + progress * 0.82, stage),
  });
  const probe = await probeMedia(result.file);
  const ext = path.extname(result.file);
  const title = titleFromPrompt(prompt, `${provider.label} ${KIND_LABEL[options.kind]}`);
  job.progress(0.93, 'finishing');
  return {
    kind: options.kind,
    file: result.file,
    mime: result.mime || mimeForFile(result.file),
    width: probe.width || (options.kind === 'image' ? 1024 : 0),
    height: probe.height || (options.kind === 'image' ? 1024 : 0),
    duration: probe.duration || (options.kind === 'audio' || options.kind === 'video' ? Number(options.duration) || 0 : 0),
    title,
    prompt,
    seed: null,
    engine: provider.id,
    engineLabel: `${provider.label} · ${model}`,
    provider: provider.id,
    model,
    meta: { ...result.meta, extension: ext, aspect: options.aspect || '', fileSize: probe.bytes },
  };
  void producedKinds;
}

async function generateComfyAsset(job, prompt, options) {
  const config = readConfig();
  const endpoint = String((config.media && config.media.endpoints && config.media.endpoints.comfyui) || '').trim();
  if (!endpoint) throw new Error('Add a ComfyUI endpoint in Studio → Engines');
  const paths = libraryPaths();
  await fs.promises.mkdir(paths.temp, { recursive: true });
  const result = await comfy.generate({
    endpoint,
    prompt,
    options,
    tmpFile: path.join(paths.temp, `${job.id}-comfy`),
    signal: job.signal,
    onProgress: (progress, stage) => job.progress(0.08 + progress * 0.82, stage),
  });
  const probe = await probeMedia(result.file);
  job.progress(0.93, 'finishing');
  return {
    kind: 'image',
    file: result.file,
    mime: 'image/png',
    width: result.width || probe.width,
    height: result.height || probe.height,
    title: titleFromPrompt(prompt, 'ComfyUI image'),
    prompt,
    engine: 'comfyui',
    engineLabel: 'ComfyUI',
    provider: 'comfyui',
    model: result.meta?.checkpoint || 'auto',
    meta: { ...(result.meta || {}), aspect: options.aspect || '', fileSize: probe.bytes },
  };
}

/* ------------------------------------------------------------------ jobs */

function publicJob(job) {
  return {
    id: job.id,
    kind: job.kind,
    mode: job.mode || 'generate',
    prompt: job.prompt,
    engine: job.engine,
    engineLabel: job.engineLabel || '',
    status: job.status,
    progress: Number(job.progressValue || 0),
    stage: job.stage || '',
    error: job.error || '',
    assetIds: job.assetIds.slice(),
    parentId: job.parentId || '',
    createdAt: job.createdAt,
    startedAt: job.startedAt || '',
    finishedAt: job.finishedAt || '',
  };
}

function emitJob(job) {
  emit('media:job', { job: publicJob(job) });
}

function pruneJobs() {
  if (jobs.size <= MAX_JOBS) return;
  const finished = [...jobs.values()]
    .filter((job) => ['done', 'error', 'cancelled'].includes(job.status))
    .sort((a, b) => String(a.finishedAt).localeCompare(String(b.finishedAt)));
  while (jobs.size > MAX_JOBS && finished.length) {
    jobs.delete(finished.shift().id);
  }
}

function listJobs() {
  return [...jobs.values()]
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, MAX_JOBS)
    .map(publicJob);
}

function getJob(id) {
  const job = jobs.get(id);
  return job ? publicJob(job) : null;
}

function waitForJob(id, options = {}) {
  const job = jobs.get(id);
  if (!job) return Promise.reject(new Error('Job not found'));
  if (['done', 'error', 'cancelled'].includes(job.status)) {
    if (job.status === 'done') return Promise.resolve(publicJob(job));
    return Promise.reject(new Error(job.status === 'cancelled' ? 'Cancelled' : job.error || 'Media job failed'));
  }
  const timeout = Math.max(10000, Math.min(15 * 60 * 1000, Number(options.timeout) || 10 * 60 * 1000));
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (result, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (options.signal) options.signal.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(() => {
      cancelJob(id);
      done(null, new Error('Media generation timed out'));
    }, timeout);
    const onAbort = () => {
      cancelJob(id);
      done(null, new Error('Cancelled'));
    };
    if (options.signal) {
      if (options.signal.aborted) return onAbort();
      options.signal.addEventListener('abort', onAbort, { once: true });
    }
    job.waiters.push({ resolve: (publicValue) => done(publicValue), reject: (error) => done(null, error) });
  });
}

function cancelJob(id) {
  const job = jobs.get(id);
  if (!job) throw new Error('Job not found');
  if (['done', 'error', 'cancelled'].includes(job.status)) return publicJob(job);
  job.cancelledFlag = true;
  const controller = controllers.get(id);
  if (controller) controller.abort();
  job.status = 'cancelled';
  job.stage = 'cancelled';
  job.finishedAt = nowIso();
  emitJob(job);
  for (const waiter of job.waiters.splice(0)) waiter.reject(new Error('Cancelled'));
  return publicJob(job);
}

function createJob(input, mode) {
  const kind = KINDS.includes(input.kind) ? input.kind : 'image';
  const prompt = String(input.prompt || '').trim();
  if (!prompt) throw new Error('Describe what to create');
  if (prompt.length > 4000) throw new Error('Prompt is too long');
  const engine = normalizeEngineId(input.engine) || 'local';
  const job = {
    id: makeId('job'),
    kind,
    mode,
    prompt,
    engine,
    engineLabel: engineLabelFor(engine),
    status: 'queued',
    progressValue: 0,
    stage: 'queued',
    error: '',
    assetIds: [],
    parentId: input.id || '',
    input: { ...input },
    createdAt: nowIso(),
    startedAt: '',
    finishedAt: '',
    cancelledFlag: false,
    assetRecords: [],
    waiters: [],
  };
  const controller = new AbortController();
  job.signal = controller.signal;
  job.cancelled = () => job.cancelledFlag || controller.signal.aborted;
  job.progress = (value, stage) => {
    job.progressValue = clamp(Number(value) || 0, 0, 1);
    job.stage = stage || job.stage;
    emitJob(job);
  };
  controllers.set(job.id, controller);
  jobs.set(job.id, job);
  pruneJobs();
  emitJob(job);
  return job;
}

async function executeJob(job, runner) {
  job.status = 'running';
  job.startedAt = nowIso();
  job.progress(0.02, 'starting');
  try {
    const producedList = await runner(job);
    const list = Array.isArray(producedList) ? producedList : [producedList];
    if (!list.length) throw new Error('The engine returned no media');
    for (const produced of list) {
      if (job.cancelled()) throw new Error('Cancelled');
      const saved = await saveFinalAsset(job, produced);
      job.assetIds.push(saved.record.id);
      job.assetRecords.push(saved.record);
    }
    job.status = 'done';
    job.progressValue = 1;
    job.stage = 'done';
    job.finishedAt = nowIso();
    emitJob(job);
    for (const waiter of job.waiters.splice(0)) waiter.resolve(publicJob(job));
  } catch (error) {
    const cancelled = job.cancelled() || job.status === 'cancelled';
    job.status = cancelled ? 'cancelled' : 'error';
    job.error = cancelled ? '' : String(error.message || error).slice(0, 500);
    job.stage = cancelled ? 'cancelled' : 'error';
    job.finishedAt = nowIso();
    emitJob(job);
    const message = cancelled ? 'Cancelled' : job.error || 'Media job failed';
    for (const waiter of job.waiters.splice(0)) waiter.reject(new Error(message));
  } finally {
    controllers.delete(job.id);
    const tempRoot = libraryPaths().temp;
    try {
      for (const entry of fs.readdirSync(tempRoot)) {
        if (entry === job.id || entry.startsWith(`${job.id}-`) || entry.startsWith(`${job.id}.`)) {
          fs.rmSync(path.join(tempRoot, entry), { recursive: true, force: true });
        }
      }
    } catch {}
    pruneJobs();
  }
}

function generate(input = {}) {
  const kind = KINDS.includes(input.kind) ? input.kind : 'image';
  const engine = resolveGenerateEngine(kind, input.engine);
  const options = { ...input, kind, engine: engine.id };
  const job = createJob(options, 'generate');
  executeJob(job, async (active) => {
    const provider = findCloudProvider(engine.id);
    if (provider) return generateCloudAsset(active, active.prompt, options, active.kind);
    if (engine.id === 'comfyui' && active.kind === 'image') return generateComfyAsset(active, active.prompt, options);
    if (engine.id === SPEECH_ENGINE && active.kind === 'audio') return generateSpeech(active, active.prompt, options);
    throw new Error(`${engine.label} cannot generate ${KIND_LABEL[active.kind] || active.kind}.`);
  });
  return publicJob(job);
}

/* ------------------------------------------------------------------ edits */

function imageOperationChain(ops = {}) {
  return ops && typeof ops === 'object' ? ops : {};
}

async function editImageLocal(record, input, job) {
  if (!sharpAvailable()) throw new Error('Image editing needs sharp');
  const source = recordPath(record, record.fileName);
  if (!fs.existsSync(source)) throw new Error('Source image file is missing');
  const ops = imageOperationChain(input.operations);
  const meta = await sharp(source).metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;
  let pipeline = sharp(source, { failOn: 'none' }).rotate();
  const crop = ops.crop;
  if (crop && Number(crop.width) > 2 && Number(crop.height) > 2) {
    const left = clamp(Math.round(Number(crop.left) || 0), 0, Math.max(0, width - 2));
    const top = clamp(Math.round(Number(crop.top) || 0), 0, Math.max(0, height - 2));
    pipeline = pipeline.extract({
      left,
      top,
      width: clamp(Math.round(Number(crop.width)), 2, Math.max(2, width - left)),
      height: clamp(Math.round(Number(crop.height)), 2, Math.max(2, height - top)),
    });
  }
  if (Number(ops.rotate)) pipeline = pipeline.rotate(Number(ops.rotate));
  if (ops.flip) pipeline = pipeline.flip();
  if (ops.flop) pipeline = pipeline.flop();
  if (ops.grayscale || ops.mono) {
    pipeline = pipeline.grayscale();
    if (ops.duotone) pipeline = pipeline.tint(String(ops.duotone));
  }
  const brightness = clamp(Number(ops.brightness) || 0, -100, 100);
  const saturation = clamp(Number(ops.saturation) || 0, -100, 200);
  const hue = clamp(Number(ops.hue) || 0, -360, 360);
  if (brightness || saturation || hue) {
    pipeline = pipeline.modulate({
      brightness: Math.max(0.05, 1 + brightness / 100),
      saturation: Math.max(0, 1 + saturation / 100),
      hue,
    });
  }
  const contrast = clamp(Number(ops.contrast) || 0, -100, 100);
  if (contrast) {
    const a = Math.max(0.1, 1 + contrast / 100);
    pipeline = pipeline.linear(a, 128 * (1 - a));
  }
  if (Number(ops.gamma) > 0) pipeline = pipeline.gamma(clamp(1 + Number(ops.gamma) / 100, 0.2, 3));
  if (ops.normalize) pipeline = pipeline.normalize();
  if (Number(ops.blur) > 0) pipeline = pipeline.blur(clamp(Number(ops.blur), 0.3, 60));
  if (ops.sharpen) pipeline = pipeline.sharpen({ sigma: clamp(Number(ops.sharpen) || 1, 0.3, 5) });
  if (Number(ops.width) > 8 || Number(ops.height) > 8) {
    pipeline = pipeline.resize({
      width: ops.width ? clamp(Math.round(Number(ops.width)), 8, 4096) : null,
      height: ops.height ? clamp(Math.round(Number(ops.height)), 8, 4096) : null,
      fit: ['cover', 'contain', 'fill', 'inside', 'outside'].includes(ops.fit) ? ops.fit : 'inside',
      withoutEnlargement: false,
      background: ops.background || '#ffffff',
    });
  }
  job.progress(0.45, 'processing image');
  let buffer = await pipeline.png().toBuffer();
  let info = await sharp(buffer).metadata();
  const tint = ops.tintColor ? String(ops.tintColor) : '';
  if (tint && /^#[0-9a-f]{6}$/i.test(tint)) {
    const { r, g, b } = hexToRgb(tint);
    const overlay = {
      create: { width: info.width, height: info.height, channels: 4, background: { r, g, b, alpha: 0.17 } },
    };
    buffer = await sharp(buffer).composite([{ input: overlay, blend: 'soft-light' }]).png().toBuffer();
  }
  const format = ['png', 'jpeg', 'webp', 'avif'].includes(ops.format) ? ops.format : 'png';
  const extension = format === 'jpeg' ? '.jpg' : `.${format}`;
  if (format === 'png') {
    // already encoded
  } else if (format === 'jpeg') {
    buffer = await sharp(buffer).jpeg({ quality: 92 }).toBuffer();
  } else if (format === 'webp') {
    buffer = await sharp(buffer).webp({ quality: 92 }).toBuffer();
  } else {
    buffer = await sharp(buffer).avif({ quality: 60 }).toBuffer();
  }
  info = await sharp(buffer).metadata();
  const paths = libraryPaths();
  const outFile = path.join(paths.temp, `${job.id}-edit${extension}`);
  await fs.promises.writeFile(outFile, buffer);
  const title = `${record.title} · edit`;
  job.progress(0.85, 'finishing');
  return {
    kind: 'image',
    file: outFile,
    mime: `image/${format === 'jpeg' ? 'jpeg' : format}`,
    width: info.width || width,
    height: info.height || height,
    title,
    prompt: record.prompt,
    seed: record.seed,
    engine: 'local',
    engineLabel: 'Local tools',
    model: 'sharp',
    source: 'edited',
    parentId: record.id,
    meta: {
      operations: ops,
      from: record.id,
      original: { width, height, format: meta.format },
      tint: tint || '',
    },
  };
}

async function editVideoLocal(record, input, job) {
  if (!ffmpegAvailable()) throw new Error('Video editing needs ffmpeg');
  const source = recordPath(record, record.fileName);
  if (!fs.existsSync(source)) throw new Error('Source video file is missing');
  const ops = input.operations || {};
  const probe = await probeMedia(source);
  const duration = probe.duration || record.duration || 0;
  const start = clamp(Number(ops.start) || 0, 0, Math.max(0, duration - 0.4));
  const length = clamp(Number(ops.duration) || duration - start, 0.4, Math.max(0.4, duration - start));
  const speed = clamp(Number(ops.speed) || 1, 0.25, 4);
  const format = ops.format === 'gif' ? 'gif' : 'mp4';
  const paths = libraryPaths();
  const outFile = path.join(paths.temp, `${job.id}-edit.${format}`);
  const filters = [];
  if (Number(ops.width) > 32) {
    const width = clamp(Math.round(Number(ops.width)), 32, 3840);
    filters.push(`scale=${width}:-2`);
  }
  if (format === 'gif') {
    filters.push('fps=12', 'scale=640:-1:flags=lanczos');
    const graph = `${filters.join(',')},split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`;
    const args = ['-v', 'error', '-ss', String(start), '-i', source, '-t', String(length), '-filter_complex', graph, '-loop', '0', '-y', outFile];
    await runProcess(ffmpegBin(), args, { timeout: 180000, signal: job.signal, maxStdout: 1024 * 1024 });
    return {
      kind: 'video',
      file: outFile,
      mime: 'image/gif',
      width: 640,
      height: Math.round((640 * (record.height || 9)) / (record.width || 16) / 2) * 2,
      duration: Number((length / speed).toFixed(2)),
      title: `${record.title} · animated`,
      prompt: record.prompt,
      seed: record.seed,
      engine: 'local',
      engineLabel: 'Local tools',
      model: 'ffmpeg',
      source: 'edited',
      parentId: record.id,
      meta: { operations: ops, format: 'gif' },
    };
  }
  if (optsTruthy(ops.mute)) filters.push('noaudio');
  const videoFilters = filters.filter((f) => f !== 'noaudio');
  if (speed !== 1) videoFilters.push(`setpts=${(1 / speed).toFixed(4)}*PTS`);
  const args = ['-v', 'error', '-ss', String(start), '-i', source, '-t', String(length)];
  if (videoFilters.length) {
    args.push('-vf', videoFilters.join(','));
  }
  if (!optsTruthy(ops.mute)) {
    const audioFilters = [];
    if (speed !== 1) {
      let remaining = speed;
      while (remaining > 2) { audioFilters.push('atempo=2'); remaining /= 2; }
      while (remaining < 0.5) { audioFilters.push('atempo=0.5'); remaining /= 0.5; }
      if (Math.abs(remaining - 1) > 0.01) audioFilters.push(`atempo=${remaining.toFixed(3)}`);
    }
    if (audioFilters.length) args.push('-af', audioFilters.join(','));
    args.push('-c:a', 'aac', '-b:a', '160k');
  } else {
    args.push('-an');
  }
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', outFile);
  job.progress(0.4, 're-encoding');
  await runProcess(ffmpegBin(), args, { timeout: 240000, signal: job.signal, maxStdout: 1024 * 1024 });
  const outProbe = await probeMedia(outFile);
  return {
    kind: 'video',
    file: outFile,
    mime: 'video/mp4',
    width: outProbe.width || record.width,
    height: outProbe.height || record.height,
    duration: outProbe.duration || length,
    title: `${record.title} · cut`,
    prompt: record.prompt,
    seed: record.seed,
    engine: 'local',
    engineLabel: 'Local tools',
    model: 'ffmpeg',
    source: 'edited',
    parentId: record.id,
    meta: { operations: ops },
  };
}

function optsTruthy(value) {
  return value === true || value === 'true' || value === 1;
}

async function editAudioLocal(record, input, job) {
  if (!ffmpegAvailable()) throw new Error('Audio editing needs ffmpeg');
  const source = recordPath(record, record.fileName);
  if (!fs.existsSync(source)) throw new Error('Source audio file is missing');
  const ops = input.operations || {};
  const probe = await probeMedia(source);
  const duration = probe.duration || record.duration || 0;
  const start = clamp(Number(ops.start) || 0, 0, Math.max(0, duration - 0.2));
  const length = clamp(Number(ops.duration) || duration - start, 0.2, Math.max(0.2, duration - start));
  const speed = clamp(Number(ops.speed) || 1, 0.25, 4);
  const format = ops.format === 'wav' ? 'wav' : 'mp3';
  const filters = [];
  if (speed !== 1) {
    let remaining = speed;
    while (remaining > 2) { filters.push('atempo=2'); remaining /= 2; }
    while (remaining < 0.5) { filters.push('atempo=0.5'); remaining /= 0.5; }
    if (Math.abs(remaining - 1) > 0.01) filters.push(`atempo=${remaining.toFixed(3)}`);
  }
  if (optsTruthy(ops.reverse)) filters.push('areverse');
  const volume = clamp(Number(ops.volumeDb) || 0, -30, 20);
  if (volume) filters.push(`volume=${volume}dB`);
  if (optsTruthy(ops.normalize)) filters.push('loudnorm=I=-14:TP=-1.5:LRA=11');
  const fadeIn = clamp(Number(ops.fadeIn) || 0, 0, Math.min(12, length));
  const fadeOut = clamp(Number(ops.fadeOut) || 0, 0, Math.min(12, length));
  if (fadeIn > 0) filters.push(`afade=t=in:st=0:d=${fadeIn}`);
  if (fadeOut > 0) filters.push(`afade=t=out:st=${Math.max(0, length - fadeOut).toFixed(2)}:d=${fadeOut}`);
  const paths = libraryPaths();
  const outFile = path.join(paths.temp, `${job.id}-edit.${format}`);
  const args = ['-v', 'error', '-ss', String(start), '-i', source, '-t', String(length)];
  if (filters.length) args.push('-af', filters.join(','));
  if (format === 'mp3') args.push('-c:a', 'libmp3lame', '-b:a', '192k');
  else args.push('-c:a', 'pcm_s16le');
  args.push('-y', outFile);
  job.progress(0.35, 'processing audio');
  await runProcess(ffmpegBin(), args, { timeout: 180000, signal: job.signal, maxStdout: 1024 * 1024 });
  const peaks = await peaksForFile(outFile);
  const outProbe = await probeMedia(outFile);
  return {
    kind: 'audio',
    file: outFile,
    mime: format === 'wav' ? 'audio/wav' : 'audio/mpeg',
    duration: outProbe.duration || Number((length / speed).toFixed(2)),
    title: `${record.title} · edit`,
    prompt: record.prompt,
    seed: record.seed,
    engine: 'local',
    engineLabel: 'Local tools',
    model: 'ffmpeg',
    source: 'edited',
    parentId: record.id,
    meta: { operations: ops, peaks },
  };
}

async function editImageCloud(record, input, job) {
  const provider = findCloudProvider(input.engine);
  if (!provider) throw new Error('Choose a cloud engine to edit with');
  if (provider.id !== 'openai-images') throw new Error(`${provider.label} does not expose image editing yet`);
  const config = readConfig();
  const apiKey = cloud.resolveCloudKey(config, provider);
  if (!apiKey) throw new Error(`Add a ${provider.keyLabel} in Studio → Engines`);
  const source = recordPath(record, record.fileName);
  const tmpBase = path.join(libraryPaths().temp, `${job.id}-edit`);
  await fs.promises.mkdir(libraryPaths().temp, { recursive: true });
  const result = await cloud.editOpenAIImage({
    apiKey,
    prompt: input.prompt || `Refine ${record.title}`,
    model: input.model || 'gpt-image-1',
    inputFile: source,
    mime: record.mime,
    tmpFile: tmpBase,
    options: input.operations || {},
    signal: job.signal,
    onProgress: (progress, stage) => job.progress(0.1 + progress * 0.8, stage),
  });
  const probe = await probeMedia(result.file);
  return {
    kind: 'image',
    file: result.file,
    mime: result.mime,
    width: probe.width || record.width,
    height: probe.height || record.height,
    title: `${record.title} · ${input.prompt ? titleFromPrompt(input.prompt, 'edit') : 'edit'}`,
    prompt: input.prompt || record.prompt,
    seed: null,
    engine: provider.id,
    engineLabel: `${provider.label} · edit`,
    provider: provider.id,
    model: input.model || 'gpt-image-1',
    source: 'edited',
    parentId: record.id,
    meta: { ...result.meta, from: record.id },
  };
}

function edit(input = {}) {
  const record = getRecord(input.id);
  if (!record) throw new Error('Media asset not found');
  if (record.kind === 'model3d') throw new Error('3D editing is not supported. Export the mesh or create a new one with a 3D engine.');
  const requested = normalizeEngineId(input.engine);
  const provider = requested ? findCloudProvider(requested) : null;
  if (requested && !provider) throw new Error(`${engineLabelFor(requested)} cannot edit media. Choose a cloud image engine or use the local tools.`);
  const job = createJob({
    ...input,
    kind: record.kind,
    engine: provider ? provider.id : 'local',
    prompt: input.prompt || record.prompt || record.title,
  }, 'edit');
  executeJob(job, async (active) => {
    if (record.kind === 'image' && provider) return editImageCloud(record, input, active);
    if (record.kind === 'image') return editImageLocal(record, input, active);
    if (record.kind === 'video') {
      if (provider) throw new Error('Cloud video editing is not supported — use the local cutter');
      return editVideoLocal(record, input, active);
    }
    if (record.kind === 'audio') {
      if (provider) throw new Error('Cloud audio editing is not supported — use the local mixer');
      return editAudioLocal(record, input, active);
    }
    throw new Error('Unsupported edit');
  });
  return publicJob(job);
}

/* --------------------------------------------------------------- imports */

function kindForFile(file) {
  const mime = mimeForFile(file);
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (['model/obj', 'model/stl', 'model/gltf-binary', 'model/gltf+json', 'model/mtl'].includes(mime)) return 'model3d';
  return '';
}

async function importStoredFile(sourcePath, originalName, options = {}) {
  if (!fs.existsSync(sourcePath)) throw new Error('File not found');
  const stat = fs.statSync(sourcePath);
  if (!stat.isFile()) throw new Error('Only files can be imported');
  if (stat.size > 512 * 1024 * 1024) throw new Error('File is too large (512 MB maximum)');
  const name = originalName || path.basename(sourcePath);
  const ext = path.extname(name).toLowerCase();
  if (!MEDIA_MIME[ext]) throw new Error(`Unsupported media type ${ext || '(none)'}`);
  const kind = kindForFile(name);
  if (!kind) throw new Error('That file is not an image, video, audio or 3D model');
  const paths = libraryPaths();
  const id = makeId('imp');
  const base = assetBaseName(id, path.basename(name, ext));
  const fileName = `${base}${ext}`;
  await fs.promises.copyFile(sourcePath, path.join(paths.assets, fileName));
  const probe = await probeMedia(path.join(paths.assets, fileName));
  const record = {
    id,
    kind,
    title: path.basename(name, ext).replace(/[-_]+/g, ' ').slice(0, 70) || 'Imported media',
    prompt: '',
    engine: 'import',
    engineLabel: 'Imported',
    provider: '',
    model: '',
    fileName,
    mime: probe.mime || mimeForFile(fileName),
    bytes: stat.size,
    width: probe.width || 0,
    height: probe.height || 0,
    duration: probe.duration || 0,
    seed: null,
    source: 'imported',
    parentId: '',
    favorite: false,
    createdAt: nowIso(),
    meta: { imported: true },
    thumbName: '',
    posterName: '',
    waveformName: '',
    previewName: '',
  };
  const dest = path.join(paths.assets, fileName);
  if (kind === 'image') {
    const thumbName = `${base}.thumb.png`;
    if (await makeThumbnail(dest, path.join(paths.assets, thumbName), 720)) record.thumbName = thumbName;
  } else if (kind === 'video') {
    const posterName = `${base}.poster.jpg`;
    const poster = await makePoster(dest, path.join(paths.assets, posterName), 1);
    if (poster) {
      record.posterName = posterName;
      const thumbName = `${base}.thumb.png`;
      if (await makeThumbnail(poster, path.join(paths.assets, thumbName), 720)) record.thumbName = thumbName;
    }
  } else if (kind === 'audio') {
    const peaks = await peaksForFile(dest);
    const waveformName = `${base}.wave.png`;
    if (await writeWaveformPreview(peaks, path.join(paths.assets, waveformName))) record.waveformName = waveformName;
    record.meta.peaks = peaks;
  } else {
    const previewName = `${base}.preview.png`;
    try {
      await renderModelPreview(dest, path.join(paths.assets, previewName), record.title);
      record.previewName = previewName;
    } catch {}
  }
  const data = readIndex();
  data.items.push(record);
  writeIndex(data);
  const item = publicItem(record);
  emit('media:asset', { asset: item });
  return item;
}

async function importFile(filePath) {
  return importStoredFile(filePath, path.basename(filePath));
}

async function importData(input = {}) {
  const name = String(input.name || 'drop').replace(/[\\/]+/g, '-').slice(0, 120);
  const dataUrl = String(input.dataUrl || '');
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match || !match[2]) throw new Error('Invalid import payload');
  const buffer = Buffer.from(match[3], 'base64');
  if (!buffer.length) throw new Error('Empty file');
  if (buffer.length > 128 * 1024 * 1024) throw new Error('File is too large (128 MB maximum)');
  const ext = path.extname(name).toLowerCase();
  if (!MEDIA_MIME[ext]) throw new Error(`Unsupported media type ${ext || '(none)'}`);
  const tempDir = path.join(libraryPaths().temp, makeId('drop'));
  await fs.promises.mkdir(tempDir, { recursive: true });
  const tempFile = path.join(tempDir, `input${ext}`);
  await fs.promises.writeFile(tempFile, buffer);
  try {
    return await importStoredFile(tempFile, name);
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
}

async function copyTo(id, destination) {
  const record = getRecord(id);
  if (!record) throw new Error('Media asset not found');
  const source = recordPath(record, record.fileName);
  if (!fs.existsSync(source)) throw new Error('Asset file is missing');
  const target = path.resolve(destination);
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.copyFile(source, target);
  return { path: target, fileName: path.basename(target), bytes: fileSize(target) };
}

async function saveToWorkspace(id, workspaceRoot, subdir = '') {
  const record = getRecord(id);
  if (!record) throw new Error('Media asset not found');
  if (!workspaceRoot) throw new Error('Open a workspace first');
  const root = path.resolve(workspaceRoot);
  const folder = path.resolve(root, String(subdir || '').replace(/^([/\\])+/, ''));
  if (folder !== root && !folder.startsWith(root + path.sep)) throw new Error('Destination must stay inside the workspace');
  await fs.promises.mkdir(folder, { recursive: true });
  const ext = path.extname(record.fileName);
  const desired = subdir || safeName(record.title || 'media');
  let target = path.join(folder, `${desired}${ext}`);
  if (subdir) target = path.join(folder, record.fileName);
  let counter = 1;
  while (fs.existsSync(target)) {
    target = path.join(path.dirname(target), `${path.basename(target, ext)}-${counter}${ext}`);
    counter += 1;
  }
  await fs.promises.copyFile(recordPath(record, record.fileName), target);
  return { path: target, relative: path.relative(root, target), bytes: fileSize(target) };
}

function readText(id) {
  const record = getRecord(id);
  if (!record) throw new Error('Media asset not found');
  const ext = path.extname(record.fileName).toLowerCase();
  if (!['.obj', '.mtl', '.svg', '.stl', '.json'].includes(ext)) throw new Error('This asset has no text preview');
  const file = recordPath(record, record.fileName);
  const stat = fs.statSync(file);
  if (stat.size > 4 * 1024 * 1024) throw new Error('Text preview is limited to 4 MB');
  return { fileName: record.fileName, text: fs.readFileSync(file, 'utf8'), bytes: stat.size };
}

function assetFilePath(id) {
  const record = getRecord(id);
  return record ? recordPath(record, record.fileName) : '';
}

module.exports = {
  KINDS,
  KIND_LABEL,
  MEDIA_DEFAULTS,
  configureMedia,
  generate,
  edit,
  listAssets,
  getAsset,
  removeAsset,
  toggleFavorite,
  listJobs,
  getJob,
  waitForJob,
  cancelJob,
  importFile,
  importData,
  saveToWorkspace,
  copyTo,
  readText,
  assetFilePath,
  storageInfo,
  engineAvailability,
  listVoices: () => voice.listVoices(),
  testEndpoint: (endpoint) => comfy.ping(endpoint),
  publicItem,
  mediaUrl,
};
