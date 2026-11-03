'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { appPaths } = require('../paths');

let sharp = null;
try { sharp = require('sharp'); } catch {}
let ffmpegPath = '';
try { ffmpegPath = require('ffmpeg-static') || ''; } catch {}
if (ffmpegPath && !fs.existsSync(ffmpegPath)) ffmpegPath = '';

const IMAGE_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
};

const MEDIA_MIME = {
  ...IMAGE_MIME,
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.obj': 'model/obj',
  '.mtl': 'model/mtl',
  '.stl': 'model/stl',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
};

const KIND_EXT = {
  image: '.png',
  video: '.mp4',
  audio: '.mp3',
  model3d: '.obj',
};

function mediaPaths() {
  const root = path.join(appPaths().root, 'media');
  return {
    root,
    assets: path.join(root, 'assets'),
    temp: path.join(root, 'tmp'),
    index: path.join(root, 'index.json'),
  };
}

function ensureMedia() {
  const p = mediaPaths();
  for (const dir of [p.root, p.assets, p.temp]) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  }
  return p;
}

function hashString(value) {
  const text = String(value || '');
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, list) {
  return list[Math.floor(rng() * list.length) % list.length];
}

function range(rng, min, max) {
  return min + rng() * (max - min);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeXml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function hexToRgb(hex) {
  const clean = String(hex || '#000').replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean.padEnd(6, '0').slice(0, 6);
  return {
    r: parseInt(full.slice(0, 2), 16) || 0,
    g: parseInt(full.slice(2, 4), 16) || 0,
    b: parseInt(full.slice(4, 6), 16) || 0,
  };
}

function rgbToHex(r, g, b) {
  const to = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

function shade(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  if (amount >= 0) {
    return rgbToHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
  }
  const k = 1 + amount;
  return rgbToHex(r * k, g * k, b * k);
}

function mix(hexA, hexB, t) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  return rgbToHex(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t);
}

function extForMime(mime, fallback = '.bin') {
  const entry = Object.entries(MEDIA_MIME).find(([, value]) => value === mime);
  return entry ? entry[0] : fallback;
}

function mimeForFile(file) {
  return MEDIA_MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

function fileSize(file) {
  try { return fs.statSync(file).size; } catch { return 0; }
}

function sharpAvailable() {
  return Boolean(sharp);
}

function ffmpegAvailable() {
  return Boolean(ffmpegPath);
}

function ffmpegBin() {
  return ffmpegPath || 'ffmpeg';
}

function runProcess(bin, args, options = {}) {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(Object.assign(new Error('Cancelled.'), { name: 'AbortError' }));
      return;
    }
    const child = spawn(bin, args, {
      cwd: options.cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = [];
    let stderr = '';
    let stdoutBytes = 0;
    const maxBytes = options.maxStdout || 8 * 1024 * 1024;
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(options.timeoutMessage || 'The media engine timed out.'));
    }, options.timeout || 10 * 60 * 1000);
    const onAbort = () => child.kill('SIGKILL');
    options.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (chunk) => {
      if (stdoutBytes >= maxBytes) return;
      stdoutBytes += chunk.length;
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 300000) stderr += chunk.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      if (options.signal?.aborted) {
        reject(Object.assign(new Error('Cancelled.'), { name: 'AbortError' }));
        return;
      }
      const out = Buffer.concat(stdout);
      if (code === 0) resolve({ stdout: out, stderr, code });
      else reject(new Error(cleanFfmpegError(stderr) || `${path.basename(bin)} exited with code ${code}.`));
    });
  });
}

function cleanFfmpegError(stderr) {
  const lines = String(stderr || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const meaningful = lines.filter((line) => /error|invalid|failed|unable|unknown|no such|not found/i.test(line));
  return (meaningful.slice(-3).join(' ') || lines.slice(-2).join(' ')).slice(0, 500);
}

async function probeMedia(file) {
  const ext = path.extname(file).toLowerCase();
  const out = { duration: 0, width: 0, height: 0, mime: mimeForFile(file), bytes: fileSize(file) };
  if (IMAGE_MIME[ext] && sharp) {
    try {
      const meta = await sharp(file).metadata();
      out.width = meta.width || 0;
      out.height = meta.height || 0;
      out.orientation = meta.orientation || 1;
      out.pages = meta.pages || 1;
      return out;
    } catch {}
  }
  if (ffmpegAvailable() && ['.mp4', '.webm', '.mov', '.m4v', '.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.gif'].includes(ext)) {
    try {
      const result = await runProcess(ffmpegBin(), ['-hide_banner', '-i', file], { timeout: 15000, maxStdout: 4096 }).catch((err) => {
        const match = String(err.message);
        return { stderr: match };
      });
      const text = String(result.stderr || '');
      const duration = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (duration) out.duration = Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]);
      const video = text.match(/Video:.*?(\d{2,5})x(\d{2,5})/);
      if (video) { out.width = Number(video[1]); out.height = Number(video[2]); }
      if (/Audio:/.test(text)) out.hasAudio = true;
      if (/Video:/.test(text)) out.hasVideo = true;
    } catch {}
  }
  return out;
}

async function makeWaveform(file, buckets = 180) {
  if (!ffmpegAvailable()) return [];
  try {
    const { stdout } = await runProcess(ffmpegBin(), [
      '-v', 'error', '-i', file, '-ac', '1', '-ar', '8000', '-f', 'f32le', 'pipe:1',
    ], { timeout: 45000, maxStdout: 96 * 1024 * 1024 });
    if (!stdout.length) return [];
    const samples = new Float32Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.byteLength / 4));
    const peaks = [];
    const size = Math.max(1, Math.floor(samples.length / buckets));
    for (let i = 0; i < buckets; i += 1) {
      let peak = 0;
      const start = i * size;
      const end = Math.min(samples.length, start + size);
      for (let j = start; j < end; j += 1) {
        const v = Math.abs(samples[j]);
        if (v > peak) peak = v;
      }
      peaks.push(Number(peak.toFixed(3)));
    }
    const max = Math.max(...peaks, 0.001);
    return peaks.map((peak) => Number((peak / max).toFixed(3)));
  } catch {
    return [];
  }
}

async function makePoster(videoFile, outFile, atSeconds = 1) {
  if (!ffmpegAvailable()) return '';
  try {
    await runProcess(ffmpegBin(), [
      '-v', 'error', '-ss', String(Math.max(0, atSeconds)), '-i', videoFile,
      '-frames:v', '1', '-vf', 'scale=1280:-2', '-y', outFile,
    ], { timeout: 45000 });
    return outFile;
  } catch {
    return '';
  }
}

async function makeThumbnail(input, outFile, width = 640) {
  if (!sharp) return '';
  try {
    await sharp(input)
      .rotate()
      .resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toFile(outFile);
    return outFile;
  } catch {
    return '';
  }
}

async function imageInfo(bufferOrPath) {
  if (!sharp) return { width: 0, height: 0 };
  try {
    const meta = await sharp(bufferOrPath).metadata();
    return { width: meta.width || 0, height: meta.height || 0, format: meta.format || '' };
  } catch {
    return { width: 0, height: 0, format: '' };
  }
}

function encodeWav(channels, sampleRate = 44100) {
  const left = channels[0];
  const right = channels[1] || channels[0];
  const frames = Math.min(left.length, right.length);
  const dataSize = frames * 4;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 4, 28);
  buffer.writeUInt16LE(4, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  let offset = 44;
  for (let i = 0; i < frames; i += 1) {
    const l = clamp(left[i], -1, 1);
    const r = clamp(right[i], -1, 1);
    buffer.writeInt16LE(Math.round(l * 32767), offset);
    buffer.writeInt16LE(Math.round(r * 32767), offset + 2);
    offset += 4;
  }
  return buffer;
}

function peakArray(channels, buckets = 180) {
  const left = channels[0];
  const right = channels[1] || channels[0];
  const frames = Math.min(left.length, right.length);
  const size = Math.max(1, Math.floor(frames / buckets));
  const peaks = [];
  for (let i = 0; i < buckets; i += 1) {
    let peak = 0;
    const start = i * size;
    const end = Math.min(frames, start + size);
    for (let j = start; j < end; j += 1) {
      const v = Math.max(Math.abs(left[j]), Math.abs(right[j]));
      if (v > peak) peak = v;
    }
    peaks.push(peak);
  }
  const max = Math.max(...peaks, 0.001);
  return peaks.map((peak) => Number((peak / max).toFixed(3)));
}

function titleFromPrompt(prompt, fallback = 'Untitled') {
  const text = String(prompt || '')
    .replace(/["“”]/g, '')
    .replace(/^(generate|create|make|design|render|compose|produce|draw|an?|the)\s+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return fallback;
  const words = text.split(' ').slice(0, 6).join(' ');
  const title = words.length > 52 ? `${words.slice(0, 50).trim()}…` : words;
  return title.charAt(0).toUpperCase() + title.slice(1);
}

function pickAspect(aspect, kind = 'image') {
  const key = String(aspect || (kind === 'video' ? '16:9' : '1:1'));
  const map = {
    image: {
      '1:1': [1024, 1024], '16:9': [1280, 720], '9:16': [720, 1280], '4:3': [1152, 864], '3:4': [864, 1152],
    },
    video: {
      '1:1': [768, 768], '16:9': [960, 540], '9:16': [540, 960], '4:3': [896, 672],
    },
  };
  const table = map[kind] || map.image;
  return table[key] || table['1:1'];
}

function parseDimensions(input, fallback) {
  if (input && typeof input === 'object') {
    return { width: clamp(Number(input.width) || fallback.width, 64, 4096), height: clamp(Number(input.height) || fallback.height, 64, 4096) };
  }
  if (typeof input === 'string' && /^\d+x\d+$/i.test(input)) {
    const [w, h] = input.toLowerCase().split('x').map(Number);
    return { width: clamp(w, 64, 4096), height: clamp(h, 64, 4096) };
  }
  return { ...fallback };
}

function safeName(value) {
  return String(value || 'asset')
    .toLowerCase()
    .replace(/[^a-z0-9\uac00-\ud7af._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'asset';
}

module.exports = {
  sharp, ffmpegPath, sharpAvailable, ffmpegAvailable, ffmpegBin,
  IMAGE_MIME, MEDIA_MIME, KIND_EXT,
  mediaPaths, ensureMedia, hashString, mulberry32, pick, range, clamp,
  escapeXml, hexToRgb, rgbToHex, shade, mix, extForMime, mimeForFile, fileSize,
  runProcess, probeMedia, makeWaveform, makePoster, makeThumbnail, imageInfo,
  encodeWav, peakArray, titleFromPrompt, pickAspect, parseDimensions, safeName,
};
