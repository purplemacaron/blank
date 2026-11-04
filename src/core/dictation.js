'use strict';

/**
 * Speech dictation.
 *
 * The renderer records a short clip with MediaRecorder and sends it here. The
 * main process forwards it to an OpenAI-compatible /audio/transcriptions
 * endpoint using a key the user already saved in Models. Keys never leave the
 * main process and are never logged.
 */

const catalog = require('./catalog');
const { keyCandidates, loadConfig } = require('./config');

const DEFAULT_MODEL = 'whisper-1';
const MAX_AUDIO_BYTES = 24 * 1024 * 1024;

function trimBase(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function dictationProviders(config = loadConfig()) {
  return catalog.allProviders(config)
    .filter((provider) => provider.protocol === 'openai')
    .map((provider) => {
      const stored = config.providers?.[provider.id] || {};
      const baseUrl = trimBase(stored.baseUrl || provider.baseUrl || '');
      const keys = keyCandidates(config, provider.id, provider);
      return { id: provider.id, name: provider.name, baseUrl, hasKey: keys.length > 0 };
    })
    .filter((provider) => /^https?:\/\//i.test(provider.baseUrl));
}

function resolveDictation(config = loadConfig()) {
  const wanted = String(config.dictation?.providerId || '').trim();
  const ready = dictationProviders(config).filter((provider) => provider.hasKey);
  const provider = ready.find((entry) => entry.id === wanted)
    || ready.find((entry) => entry.id === 'openai')
    || ready[0];
  if (!provider) {
    throw new Error('Add an OpenAI-compatible API key in Models, then choose it in Settings → Dictation.');
  }
  const definition = catalog.getProvider(provider.id, config);
  const keys = keyCandidates(config, provider.id, definition);
  const key = keys.find((entry) => entry.active) || keys[0];
  if (!key) throw new Error(`${provider.name} has no API key. Add one in Models.`);
  return {
    provider: provider.name,
    baseUrl: provider.baseUrl,
    key: key.key,
    model: String(config.dictation?.model || DEFAULT_MODEL).trim().slice(0, 120) || DEFAULT_MODEL,
    language: String(config.dictation?.language || '').trim().slice(0, 20),
  };
}

async function transcribeAudio(input = {}) {
  const encoded = String(input.audio || '');
  if (!encoded) throw new Error('No audio was recorded.');
  const buffer = Buffer.from(encoded, 'base64');
  if (!buffer.length) throw new Error('No audio was recorded.');
  if (buffer.length > MAX_AUDIO_BYTES) throw new Error('That recording is too long. Keep dictation under two minutes.');

  const config = loadConfig();
  const target = resolveDictation(config);
  const mime = String(input.mime || 'audio/webm').slice(0, 80);
  const extension = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'mp4' : mime.includes('wav') ? 'wav' : 'webm';

  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mime }), `dictation.${extension}`);
  form.append('model', target.model);
  if (target.language) form.append('language', target.language);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  let response;
  try {
    response = await fetch(`${target.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${target.key}` },
      body: form,
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Dictation timed out. Try a shorter recording.');
    throw new Error(`Could not reach ${target.provider}: ${error.message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('This provider does not expose /audio/transcriptions. Choose a transcription provider in Settings → Dictation.');
    }
    let detail = '';
    try { detail = (await response.text()).replace(/\s+/g, ' ').trim().slice(0, 240); } catch {}
    throw new Error(`${target.provider} returned ${response.status}${detail ? `: ${detail}` : '.'}`);
  }
  const json = await response.json().catch(() => null);
  const text = String(json?.text || '').trim();
  if (!text) throw new Error('No speech was detected. Try again closer to the microphone.');
  return { text, provider: target.provider, model: target.model };
}

module.exports = { dictationProviders, resolveDictation, transcribeAudio, DEFAULT_MODEL };
