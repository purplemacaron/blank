'use strict';

const fs = require('fs');
const path = require('path');
const {
  hashString, mulberry32, pick, range, clamp, encodeWav, peakArray,
  runProcess, ffmpegAvailable, ffmpegBin, titleFromPrompt,
} = require('./util');

const TAU = Math.PI * 2;
const SAMPLE_RATE = 44100;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTE_PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

const SCALES = {
  minor: { label: 'minor', steps: [0, 2, 3, 5, 7, 8, 10] },
  major: { label: 'major', steps: [0, 2, 4, 5, 7, 9, 11] },
  dorian: { label: 'dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
  lydian: { label: 'lydian', steps: [0, 2, 4, 6, 7, 9, 11] },
  pentatonic: { label: 'minor pentatonic', steps: [0, 3, 5, 7, 10] },
  mixolydian: { label: 'mixolydian', steps: [0, 2, 4, 5, 7, 9, 10] },
};

const STYLES = {
  ambient: {
    label: 'Ambient', bpm: 64, scale: 'minor', bars: [0, 5, 3, 4],
    pad: { amp: 0.17, attack: 1.2, release: 2.2, brightness: 0.45, layers: 2 },
    bass: { amp: 0.16, pattern: 'long' }, lead: { amp: 0.085, density: 0.24, mode: 'air' },
    arp: null, drums: 'ambient', swing: 0, noise: 'air', reverb: 0.62, lowpass: 0,
  },
  lofi: {
    label: 'Lo-fi', bpm: 82, scale: 'dorian', bars: [1, 4, 0, 5],
    pad: { amp: 0.15, attack: 0.5, release: 1.0, brightness: 0.35, layers: 2 },
    bass: { amp: 0.2, pattern: 'lofi' }, lead: { amp: 0.1, density: 0.4, mode: 'lofi' },
    arp: { amp: 0.04, step: 2 }, drums: 'lofi', swing: 0.14, noise: 'vinyl', reverb: 0.42, lowpass: 5200,
  },
  cinematic: {
    label: 'Cinematic', bpm: 74, scale: 'minor', bars: [0, 5, 3, 6],
    pad: { amp: 0.19, attack: 0.9, release: 2.4, brightness: 0.5, layers: 3 },
    bass: { amp: 0.22, pattern: 'cinematic' }, lead: { amp: 0.1, density: 0.3, mode: 'cinematic' },
    arp: { amp: 0.035, step: 4 }, drums: 'cinematic', swing: 0, noise: 'rise', reverb: 0.66, lowpass: 0,
  },
  synthwave: {
    label: 'Synthwave', bpm: 104, scale: 'minor', bars: [0, 5, 3, 4],
    pad: { amp: 0.14, attack: 0.3, release: 0.8, brightness: 0.7, layers: 2 },
    bass: { amp: 0.22, pattern: 'pulse' }, lead: { amp: 0.11, density: 0.55, mode: 'synth' },
    arp: { amp: 0.05, step: 1 }, drums: 'synthwave', swing: 0, noise: 'none', reverb: 0.4, lowpass: 0,
  },
  electronic: {
    label: 'Electronic', bpm: 122, scale: 'minor', bars: [0, 5, 3, 4],
    pad: { amp: 0.12, attack: 0.25, release: 0.6, brightness: 0.75, layers: 2 },
    bass: { amp: 0.24, pattern: 'pulse' }, lead: { amp: 0.11, density: 0.5, mode: 'synth' },
    arp: { amp: 0.055, step: 1 }, drums: 'electronic', swing: 0, noise: 'none', reverb: 0.36, lowpass: 0,
  },
  jazz: {
    label: 'Jazz', bpm: 96, scale: 'dorian', bars: [1, 4, 0, 5],
    pad: { amp: 0.1, attack: 0.3, release: 1.0, brightness: 0.3, layers: 1 },
    bass: { amp: 0.2, pattern: 'walk' }, lead: { amp: 0.1, density: 0.42, mode: 'jazz' },
    arp: null, drums: 'jazz', swing: 0.26, noise: 'room', reverb: 0.38, lowpass: 0,
  },
  organic: {
    label: 'Organic', bpm: 88, scale: 'major', bars: [0, 4, 5, 3],
    pad: { amp: 0.12, attack: 0.6, release: 1.4, brightness: 0.4, layers: 2 },
    bass: { amp: 0.17, pattern: 'folk' }, lead: { amp: 0.1, density: 0.38, mode: 'pluck' },
    arp: { amp: 0.045, step: 2 }, drums: 'organic', swing: 0.06, noise: 'air', reverb: 0.48, lowpass: 7000,
  },
};

const STYLE_WORDS = {
  ambient: ['ambient', 'calm', 'drone', 'sleep', 'meditation', 'ethereal', 'dreamy', 'atmosphere', 'spa', 'peaceful'],
  lofi: ['lofi', 'lo-fi', 'chill', 'study', 'relax', 'coffee', 'mellow', 'hip hop', 'hip-hop', 'rainy'],
  cinematic: ['cinematic', 'epic', 'orchestral', 'soundtrack', 'film', 'trailer', 'dramatic', 'score', 'emotional'],
  synthwave: ['synthwave', 'retro', '80s', 'vaporwave', 'neon', 'outrun', 'analog', 'dreampop'],
  electronic: ['electronic', 'techno', 'house', 'edm', 'dance', 'club', 'trance', 'drum and bass', 'dnb', 'beat'],
  jazz: ['jazz', 'swing', 'bebop', 'smooth jazz', 'noir', 'lounge', 'saxophone', 'piano bar'],
  organic: ['folk', 'acoustic', 'nature', 'organic', 'garden', 'forest', 'handpan', 'world', 'warm'],
};

const DRUMS = {
  ambient: { hat: [0, 6, 8, 14], kick: [0], snare: [] },
  lofi: { kick: [0, 7, 10], snare: [4, 12], hat: [0, 2, 3, 6, 8, 10, 11, 14], rim: [13] },
  cinematic: { kick: [0, 8], snare: [8, 12], tom: [14, 15], hat: [] },
  synthwave: { kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14], open: [6, 14] },
  electronic: { kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14], open: [6, 14], clap: [12] },
  jazz: { kick: [0, 10], snare: [4, 12], ride: [0, 2, 4, 6, 8, 10, 12, 14], hat: [] },
  organic: { kick: [0, 8], shaker: [0, 2, 4, 6, 8, 10, 12, 14], snare: [12], tom: [14] },
};

function noteName(pc) {
  return NOTE_NAMES[((pc % 12) + 12) % 12];
}

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function detectStyle(lower, seed) {
  let best = '';
  let bestScore = 0;
  for (const [style, words] of Object.entries(STYLE_WORDS)) {
    let score = 0;
    for (const word of words) if (lower.includes(word)) score += 1;
    if (score > bestScore) { bestScore = score; best = style; }
  }
  if (best) return best;
  const fallback = ['ambient', 'lofi', 'cinematic', 'organic', 'synthwave'];
  return fallback[seed % fallback.length];
}

function detectKey(lower, seed) {
  const match = lower.match(/\b(?:in\s+)?([a-g])(#|♯|b|♭)?\s*(minor|major|min|maj|dorian|lydian|mixolydian)\b/);
  if (match) {
    let pc = NOTE_PC[match[1]];
    if (match[2] === '#' || match[2] === '♯') pc += 1;
    if (match[2] === 'b' || match[2] === '♭') pc -= 1;
    const mode = match[3].startsWith('min') ? 'minor' : match[3].startsWith('maj') ? 'major' : match[3];
    return { pc: ((pc % 12) + 12) % 12, mode };
  }
  const pool = [9, 2, 5, 7, 0, 4];
  return { pc: pool[seed % pool.length], mode: '' };
}

function resolveMusic(prompt, seed, options = {}) {
  const lower = String(prompt || '').toLowerCase();
  const resolvedSeed = Number.isFinite(Number(seed)) ? Number(seed) >>> 0 : hashString(prompt || 'blank audio');
  const styleId = STYLES[options.style] ? options.style : detectStyle(lower, resolvedSeed);
  const def = STYLES[styleId];
  const bpmMatch = lower.match(/(\d{2,3})\s*bpm/);
  const bpm = clamp(Number(options.bpm) || (bpmMatch ? Number(bpmMatch[1]) : def.bpm), 40, 190);
  const key = detectKey(lower, resolvedSeed);
  let scale = key.mode && SCALES[key.mode] ? key.mode : def.scale;
  if (def.scale === 'major' && !key.mode && options.major !== false) scale = 'major';
  if (/\bminor\b|\bdark\b|\bsad\b|\bmoody\b/.test(lower)) scale = 'minor';
  if (/\bmajor\b|\bbright\b|\bhappy\b/.test(lower)) scale = 'major';
  return {
    style: styleId,
    styleLabel: def.label,
    bpm,
    rootPc: key.pc,
    scale,
    scaleLabel: SCALES[scale].label,
    seed: resolvedSeed,
    title: titleFromPrompt(prompt, `${def.label} sketch`),
    def,
  };
}

/* -------------------------------------------------------------- synthesis */

function buildChord(rootMidi, scaleSteps, degree, options = {}) {
  const len = scaleSteps.length;
  const tones = options.seventh ? [0, 2, 4, 6] : [0, 2, 4];
  const notes = [];
  for (const offset of tones) {
    const index = degree + offset;
    const octave = Math.floor(index / len);
    const within = ((index % len) + len) % len;
    notes.push(rootMidi + 12 * octave + scaleSteps[within]);
  }
  if (options.add9) {
    const index = degree + 8;
    notes.push(rootMidi + 12 * Math.floor(index / len) + scaleSteps[((index % len) + len) % len]);
  }
  return [...new Set(notes)].sort((a, b) => a - b);
}

function envelope(time, duration, attack, release, decayRate) {
  if (time < 0 || time > duration) return 0;
  let env;
  if (attack <= 0.001) env = 1;
  else if (time < attack) env = time / attack;
  else if (decayRate) env = Math.exp(-(time - attack) * decayRate);
  else env = 1;
  const releaseStart = duration - release;
  if (release > 0 && time > releaseStart) env *= Math.max(0, (duration - time) / release);
  return env;
}

function addTone(busL, busR, sr, startSec, durationSec, freq, options = {}) {
  const start = Math.round(startSec * sr);
  const count = Math.round(durationSec * sr);
  if (start >= busL.length || count <= 0 || freq <= 0) return;
  const total = Math.min(count, busL.length - start);
  const amp = options.amp ?? 0.1;
  const attack = options.attack ?? 0.01;
  const release = Math.min(options.release ?? 0.12, durationSec * 0.6);
  const decayRate = options.decay ?? 0;
  const pan = clamp(options.pan ?? 0, -1, 1);
  const angle = (pan + 1) * Math.PI / 4;
  const gainL = Math.cos(angle) * amp;
  const gainR = Math.sin(angle) * amp;
  const detune = options.detune ?? 0;
  const vibrato = options.vibratoDepth ? {
    hz: options.vibratoHz || 4.6,
    depth: options.vibratoDepth,
    delay: options.vibratoDelay || 0.18,
  } : null;
  const harmonics = options.harmonics || [[1, 1, 0]];
  const phase0 = (options.phase || 0) * TAU;
  const detuneRatio = Math.pow(2, detune / 1200);
  const twoPiOverSr = TAU / sr;

  for (let i = 0; i < total; i += 1) {
    const t = i / sr;
    let env = envelope(t, durationSec, attack, release, decayRate);
    if (env <= 0) continue;
    if (options.swell) env *= 0.75 + 0.25 * Math.sin(t * TAU / Math.max(1, options.swell));
    let vib = 0;
    if (vibrato) {
      const ramp = clamp((t - vibrato.delay) / 0.6, 0, 1);
      vib = Math.sin(t * TAU * vibrato.hz) * vibrato.depth * ramp;
    }
    let sample = 0;
    for (const [ratio, hAmp, hDecay] of harmonics) {
      const partialEnv = hDecay ? Math.exp(-t * hDecay) : 1;
      sample += hAmp * partialEnv * Math.sin(phase0 + t * twoPiOverSr * freq * ratio * detuneRatio + vib * ratio);
    }
    const value = sample * env;
    busL[start + i] += value * gainL;
    busR[start + i] += value * gainR;
  }
}

function addNoise(busL, busR, sr, startSec, durationSec, options = {}) {
  const start = Math.round(startSec * sr);
  const count = Math.round(durationSec * sr);
  if (start >= busL.length || count <= 0) return;
  const total = Math.min(count, busL.length - start);
  const amp = options.amp ?? 0.05;
  const attack = options.attack ?? 0.002;
  const release = Math.min(options.release ?? 0.05, durationSec * 0.8);
  const decay = options.decay ?? 0;
  const pan = clamp(options.pan ?? 0, -1, 1);
  const angle = (pan + 1) * Math.PI / 4;
  const gainL = Math.cos(angle) * amp;
  const gainR = Math.sin(angle) * amp;
  const rng = mulberry32((options.seed ?? 1) >>> 0);
  let prev = 0;
  let hp = 0;
  const brightness = options.brightness ?? 0.5;

  for (let i = 0; i < total; i += 1) {
    const t = i / sr;
    const env = envelope(t, durationSec, attack, release, decay);
    if (env <= 0) continue;
    const white = rng() * 2 - 1;
    hp = brightness * (hp + white - prev);
    prev = white;
    const value = hp * env;
    busL[start + i] += value * gainL;
    busR[start + i] += value * gainR;
  }
}

function addKick(busL, busR, sr, at, amp = 0.5, seed = 1) {
  const duration = 0.42;
  const start = Math.round(at * sr);
  const total = Math.min(Math.round(duration * sr), busL.length - start);
  if (total <= 0) return;
  const rng = mulberry32(seed);
  let phase = 0;
  for (let i = 0; i < total; i += 1) {
    const t = i / sr;
    const freq = 44 + 110 * Math.exp(-t * 24);
    phase += (TAU * freq) / sr;
    const body = Math.sin(phase) * Math.exp(-t * 7.2);
    const click = i < sr * 0.006 ? (rng() * 2 - 1) * 0.3 * (1 - i / (sr * 0.006)) : 0;
    const value = (body + click) * amp;
    busL[start + i] += value;
    busR[start + i] += value;
  }
}

function addSnare(busL, busR, sr, at, amp = 0.24, seed = 1, options = {}) {
  const duration = options.tail || 0.22;
  const start = Math.round(at * sr);
  const total = Math.min(Math.round(duration * sr), busL.length - start);
  if (total <= 0) return;
  const rng = mulberry32(seed);
  let prev = 0;
  let hp = 0;
  const pan = options.pan ?? 0;
  const gl = Math.cos(((pan + 1) * Math.PI) / 4);
  const gr = Math.sin(((pan + 1) * Math.PI) / 4);
  for (let i = 0; i < total; i += 1) {
    const t = i / sr;
    const noise = rng() * 2 - 1;
    hp = 0.72 * (hp + noise - prev);
    prev = noise;
    const env = Math.exp(-t * 20);
    const tone = Math.sin(TAU * 186 * t) * Math.exp(-t * 26) * 0.35;
    const value = (hp * env + tone) * amp;
    busL[start + i] += value * gl;
    busR[start + i] += value * gr;
  }
}

function addHat(busL, busR, sr, at, amp = 0.1, open = false, seed = 1, pan = 0.15) {
  const duration = open ? 0.3 : 0.07;
  const start = Math.round(at * sr);
  const total = Math.min(Math.round(duration * sr), busL.length - start);
  if (total <= 0) return;
  const rng = mulberry32(seed);
  let prev = 0;
  let hp = 0;
  const gl = Math.cos(((pan + 1) * Math.PI) / 4) * amp;
  const gr = Math.sin(((pan + 1) * Math.PI) / 4) * amp;
  const decay = open ? 11 : 48;
  for (let i = 0; i < total; i += 1) {
    const t = i / sr;
    const noise = rng() * 2 - 1;
    hp = 0.9 * (hp + noise - prev);
    prev = noise;
    const env = Math.exp(-t * decay);
    const value = hp * env;
    busL[start + i] += value * gl;
    busR[start + i] += value * gr;
  }
}

function addTom(busL, busR, sr, at, freq = 120, amp = 0.2, seed = 1) {
  const duration = 0.36;
  const start = Math.round(at * sr);
  const total = Math.min(Math.round(duration * sr), busL.length - start);
  if (total <= 0) return;
  const rng = mulberry32(seed);
  let phase = 0;
  for (let i = 0; i < total; i += 1) {
    const t = i / sr;
    const f = freq * (0.72 + 0.28 * Math.exp(-t * 16));
    phase += (TAU * f) / sr;
    const env = Math.exp(-t * 8);
    const value = (Math.sin(phase) + (rng() * 2 - 1) * 0.05) * env * amp;
    busL[start + i] += value;
    busR[start + i] += value;
  }
}

function addRim(busL, busR, sr, at, amp = 0.09, seed = 1) {
  const duration = 0.09;
  const start = Math.round(at * sr);
  const total = Math.min(Math.round(duration * sr), busL.length - start);
  if (total <= 0) return;
  const rng = mulberry32(seed);
  for (let i = 0; i < total; i += 1) {
    const t = i / sr;
    const env = Math.exp(-t * 60);
    const value = (Math.sin(TAU * 920 * t) * 0.6 + (rng() * 2 - 1) * 0.4) * env * amp;
    busL[start + i] += value;
    busR[start + i] += value * 0.8;
  }
}

function reverbChannel(input, sr, offsetSamples) {
  const combDelays = [1116, 1188, 1277, 1356].map((d) => Math.round((d * sr) / 44100) + offsetSamples);
  const allpassDelays = [556, 225].map((d) => Math.round((d * sr) / 44100) + offsetSamples);
  const out = new Float32Array(input.length);
  for (const delay of combDelays) {
    const buffer = new Float32Array(delay);
    let index = 0;
    let filter = 0;
    for (let i = 0; i < input.length; i += 1) {
      const delayed = buffer[index];
      filter = delayed * 0.62 + filter * 0.38;
      buffer[index] = input[i] + filter * 0.78;
      out[i] += delayed * 0.25;
      index = (index + 1) % delay;
    }
  }
  let temp = out;
  for (const delay of allpassDelays) {
    const buffer = new Float32Array(delay);
    const next = new Float32Array(input.length);
    let index = 0;
    for (let i = 0; i < input.length; i += 1) {
      const delayed = buffer[index];
      const value = -temp[i] + delayed;
      buffer[index] = temp[i] + delayed * 0.5;
      next[i] = value;
      index = (index + 1) % delay;
    }
    temp = next;
  }
  return temp;
}

function softLimit(value, drive = 1.1) {
  return Math.tanh(value * drive) / Math.tanh(drive);
}

function lowpassChannel(input, sr, cutoff) {
  if (!cutoff || cutoff >= sr / 2) return input;
  const a = 1 - Math.exp((-TAU * cutoff) / sr);
  const out = new Float32Array(input.length);
  let y = 0;
  for (let i = 0; i < input.length; i += 1) {
    y += a * (input[i] - y);
    out[i] = y;
  }
  return out;
}

function renderMusic(options = {}) {
  const prompt = String(options.prompt || '');
  const theme = resolveMusic(prompt, options.seed, options);
  const def = theme.def;
  const sr = SAMPLE_RATE;
  const duration = clamp(Number(options.duration) || 24, 4, 180);
  const frames = Math.ceil(duration * sr);
  const masterL = new Float32Array(frames);
  const masterR = new Float32Array(frames);
  const wetL = new Float32Array(frames);
  const wetR = new Float32Array(frames);
  const rng = mulberry32(theme.seed ^ 0x51f15a);
  const scale = SCALES[theme.scale].steps;
  const rootMidi = 48 + theme.rootPc;
  const barSec = (4 * 60) / theme.bpm;
  const totalBars = Math.max(2, Math.ceil(duration / barSec));
  const progression = def.bars;
  const introBars = Math.max(1, Math.round(totalBars * 0.12));
  const outroStart = Math.max(introBars + 1, totalBars - Math.max(1, Math.round(totalBars * 0.14)));
  const chordNames = [];

  const motif = [];
  for (let step = 0; step < 16; step += 1) {
    const hit = rng() < def.lead.density;
    motif.push(hit ? {
      degree: Math.floor(rng() * scale.length),
      length: pick(rng, [1, 2, 2, 3, 4]),
      velocity: 0.75 + rng() * 0.25,
    } : null);
  }

  for (let bar = 0; bar < totalBars; bar += 1) {
    const barStart = bar * barSec;
    if (barStart >= duration) break;
    const isIntro = bar < introBars;
    const isOutro = bar >= outroStart;
    const section = isIntro ? 'intro' : isOutro ? 'outro' : 'body';
    const degree = progression[bar % progression.length];
    const chord = buildChord(rootMidi, scale, degree, { seventh: theme.style === 'jazz' || theme.style === 'lofi', add9: theme.style === 'ambient' });
    const bassNote = chord[0] - 12;
    const rootPc = (((theme.rootPc + scale[((degree % scale.length) + scale.length) % scale.length]) % 12) + 12) % 12;
    if (!chordNames.includes(noteName(rootPc))) chordNames.push(noteName(rootPc));

    // Pad layers
    const padLayers = isOutro ? 1 : def.pad.layers;
    for (let layer = 0; layer < padLayers; layer += 1) {
      const pan = padLayers === 1 ? 0 : layer === 0 ? -0.38 : 0.38;
      const detune = (layer - (padLayers - 1) / 2) * 6;
      const amp = def.pad.amp / Math.sqrt(padLayers) * (isIntro ? 0.85 : 1);
      chord.forEach((midi, index) => {
        const freq = midiToFreq(midi + (layer === 1 ? 12 : 0));
        addTone(wetL, wetR, sr, barStart, barSec * 1.04, freq, {
          amp: amp * (1 - index * 0.08),
          attack: def.pad.attack,
          release: def.pad.release,
          pan,
          detune,
          swell: 8 + layer * 3,
          harmonics: [
            [1, 1, 0.18],
            [2, def.pad.brightness * 0.32, 0.3],
            [3, def.pad.brightness * 0.14, 0.5],
          ],
          phase: rng(),
        });
      });
    }

    // Bass
    if (!isIntro || bar % 2 === 0) {
      const pattern = def.bass.pattern;
      const beat = barSec / 4;
      const hits = [];
      if (pattern === 'long') {
        hits.push({ beat: 0, len: barSec * 0.94, note: bassNote, amp: 1 });
      } else if (pattern === 'cinematic') {
        hits.push({ beat: 0, len: barSec * 0.7, note: bassNote, amp: 1 });
        hits.push({ beat: 2.5, len: barSec * 0.38, note: bassNote + 7, amp: 0.6 });
      } else if (pattern === 'lofi') {
        hits.push({ beat: 0, len: beat * 1.6, note: bassNote, amp: 1 });
        hits.push({ beat: 2, len: beat * 1.2, note: bassNote, amp: 0.85 });
        if (rng() < 0.5) hits.push({ beat: 3.5, len: beat * 0.4, note: bassNote + 7, amp: 0.5 });
      } else if (pattern === 'pulse') {
        for (let step = 0; step < 8; step += 1) {
          hits.push({ beat: step * 0.5, len: beat * 0.42, note: step % 4 === 2 ? bassNote + 12 : bassNote, amp: step % 2 === 0 ? 1 : 0.7 });
        }
      } else if (pattern === 'walk') {
        for (let beatIndex = 0; beatIndex < 4; beatIndex += 1) {
          const chordTone = chord[beatIndex % chord.length] - 12;
          hits.push({ beat: beatIndex, len: beat * 0.9, note: beatIndex === 3 ? chordTone + 2 : chordTone, amp: 0.85 });
        }
      } else if (pattern === 'folk') {
        hits.push({ beat: 0, len: beat * 1.8, note: bassNote, amp: 1 });
        hits.push({ beat: 2, len: beat * 1.4, note: bassNote + 7, amp: 0.75 });
      }
      for (const hit of hits) {
        addTone(masterL, masterR, sr, barStart + hit.beat * beat, hit.len + 0.12, midiToFreq(hit.note), {
          amp: def.bass.amp * hit.amp,
          attack: 0.012,
          release: 0.14,
          decay: pattern === 'pulse' ? 2.4 : 0.5,
          harmonics: [[1, 1, 0], [2, 0.25, 1.2]],
          pan: 0,
        });
      }
    }

    // Arpeggio
    if (def.arp && !isIntro && !isOutro) {
      const steps = Math.round(4 / def.arp.step) * 4;
      const stepSec = barSec / steps;
      const chordTones = chord.map((midi) => midi + 12);
      const order = [...chordTones, ...[...chordTones].reverse().slice(1, -1)];
      for (let step = 0; step < steps; step += 1) {
        const note = order[step % order.length];
        const pan = Math.sin((step / steps) * TAU) * 0.6;
        addTone(wetL, wetR, sr, barStart + step * stepSec, stepSec * 1.8, midiToFreq(note), {
          amp: def.arp.amp * (step % 4 === 0 ? 1.25 : 0.8),
          attack: 0.004,
          release: 0.06,
          decay: 7,
          pan,
          harmonics: [[1, 1, 2.2], [2, 0.35, 4]],
          phase: step * 0.13,
        });
      }
    }

    // Lead motif
    if (!isIntro && !isOutro) {
      const stepSec = barSec / 16;
      const transpose = bar % 8 >= 4 && theme.style !== 'jazz' ? 2 : 0;
      const densityMod = bar % 4 === 0 ? 1 : 0.6;
      for (let step = 0; step < 16; step += 1) {
        const entry = motif[step];
        if (!entry || rng() > densityMod) continue;
        let midi;
        if (def.lead.mode === 'air' || def.lead.mode === 'cinematic') {
          midi = chord[step % chord.length] + 12;
        } else {
          const idx = (entry.degree + transpose) % scale.length;
          midi = rootMidi + 12 + scale[idx] + (transpose ? 2 : 0);
        }
        const freq = midiToFreq(midi);
        const noteDuration = stepSec * entry.length * (def.lead.mode === 'cinematic' ? 2.4 : 1.3);
        const swingShift = def.swing && step % 2 === 1 ? stepSec * def.swing : 0;
        addTone(wetL, wetR, sr, barStart + step * stepSec + swingShift, noteDuration + 0.1, freq, {
          amp: def.lead.amp * entry.velocity * (bar % 8 >= 4 ? 1.08 : 0.9),
          attack: def.lead.mode === 'cinematic' ? 0.24 : def.lead.mode === 'air' ? 0.5 : 0.008,
          release: 0.2,
          decay: def.lead.mode === 'pluck' || def.lead.mode === 'lofi' ? 3.4 : 0,
          pan: Math.sin(step * 0.7) * 0.22,
          vibratoDepth: def.lead.mode === 'cinematic' ? 0.004 : 0,
          harmonics: def.lead.mode === 'synth'
            ? [[1, 1, 0.5], [2, 0.4, 0.9], [3, 0.15, 1.4]]
            : [[1, 1, 0.2], [2, 0.2, 0.5]],
          phase: rng(),
        });
      }
    }

    // Drums
    const pattern = DRUMS[def.drums] || {};
    const stepSec = barSec / 16;
    const intensity = isIntro ? 0.35 : isOutro ? 0.4 : 1;
    const swingSteps = (step) => (def.swing && step % 2 === 1 ? stepSec * def.swing : 0);
    if (pattern.kick) {
      for (const step of pattern.kick) {
        if (isIntro && step !== 0) continue;
        const jitter = (rng() - 0.5) * 0.006;
        addKick(masterL, masterR, sr, barStart + step * stepSec + jitter, 0.46 * intensity, theme.seed + bar * 31 + step);
      }
    }
    if (pattern.snare) {
      for (const step of pattern.snare) {
        addSnare(masterL, masterR, sr, barStart + step * stepSec + swingSteps(step), 0.2 * intensity, theme.seed + bar * 53 + step, { tail: def.drums === 'jazz' ? 0.14 : 0.22 });
      }
    }
    if (pattern.clap) {
      for (const step of pattern.clap) {
        for (let k = 0; k < 3; k += 1) {
          addSnare(wetL, wetR, sr, barStart + step * stepSec + k * 0.011, 0.08 * intensity, theme.seed + k + step, { tail: 0.1, pan: 0.2 });
        }
      }
    }
    if (pattern.hat) {
      for (const step of pattern.hat) {
        addHat(masterL, masterR, sr, barStart + step * stepSec + swingSteps(step), 0.07 * intensity, false, theme.seed + bar * 13 + step, 0.24);
      }
    }
    if (pattern.open) {
      for (const step of pattern.open) {
        addHat(wetL, wetR, sr, barStart + step * stepSec, 0.055 * intensity, true, theme.seed + bar * 17 + step, -0.2);
      }
    }
    if (pattern.ride) {
      for (const step of pattern.ride) {
        addHat(wetL, wetR, sr, barStart + step * stepSec + swingSteps(step), 0.035 * intensity, false, theme.seed + bar * 19 + step, 0.35);
      }
    }
    if (pattern.shaker) {
      for (const step of pattern.shaker) {
        addNoise(wetL, wetR, sr, barStart + step * stepSec, 0.06, {
          amp: 0.028, decay: 50, pan: -0.25, seed: theme.seed + bar * 23 + step, brightness: 0.95,
        });
      }
    }
    if (pattern.tom) {
      for (const step of pattern.tom) {
        addTom(masterL, masterR, sr, barStart + step * stepSec, 110, 0.16 * intensity, theme.seed + bar * 29 + step);
      }
    }
    if (pattern.rim) {
      for (const step of pattern.rim) {
        addRim(wetL, wetR, sr, barStart + step * stepSec, 0.06 * intensity, theme.seed + bar * 37 + step);
      }
    }

    // Fill at phrase ends
    if (!isIntro && !isOutro && bar % 4 === 3) {
      for (let step = 12; step < 16; step += 1) {
        addSnare(wetL, wetR, sr, barStart + step * stepSec + swingSteps(step), 0.045 + (step - 12) * 0.018, theme.seed + bar * 61 + step, { tail: 0.12, pan: 0.1 });
      }
    }
  }

  // Atmosphere
  if (def.noise === 'air' || theme.style === 'cinematic') {
    addNoise(wetL, wetR, sr, 0, duration, {
      amp: 0.012, attack: 1.5, release: 2, seed: theme.seed + 5, brightness: 0.25,
    });
  }
  if (def.noise === 'vinyl') {
    const ticks = Math.round(duration * 7);
    for (let i = 0; i < ticks; i += 1) {
      const at = rng() * duration;
      addNoise(masterL, masterR, sr, at, 0.012, {
        amp: 0.03 + rng() * 0.03, decay: 80, pan: rng() * 2 - 1, seed: theme.seed + i * 7, brightness: 0.8,
      });
    }
    addNoise(wetL, wetR, sr, 0, duration, { amp: 0.008, attack: 0.2, release: 1, seed: theme.seed + 9, brightness: 0.12 });
  }
  if (def.noise === 'room') {
    addNoise(wetL, wetR, sr, 0, duration, { amp: 0.006, attack: 0.4, release: 1, seed: theme.seed + 11, brightness: 0.2 });
  }
  if (def.noise === 'rise' && duration > 4) {
    const riseStart = Math.max(0, duration * 0.42);
    addNoise(wetL, wetR, sr, riseStart, Math.min(6, duration - riseStart), {
      amp: 0.02, attack: 3.5, release: 0.8, seed: theme.seed + 13, brightness: 0.55,
    });
  }

  // Reverb
  const wetAmount = def.reverb ?? 0.45;
  if (wetAmount > 0) {
    const reverbL = reverbChannel(wetL, sr, 0);
    const reverbR = reverbChannel(wetR, sr, 23);
    for (let i = 0; i < frames; i += 1) {
      masterL[i] += reverbL[i] * wetAmount * 0.9 + wetL[i] * 0.36;
      masterR[i] += reverbR[i] * wetAmount * 0.9 + wetR[i] * 0.36;
    }
  } else {
    for (let i = 0; i < frames; i += 1) {
      masterL[i] += wetL[i] * 0.6;
      masterR[i] += wetR[i] * 0.6;
    }
  }

  let outL = masterL;
  let outR = masterR;
  if (def.lowpass) {
    outL = lowpassChannel(outL, sr, def.lowpass);
    outR = lowpassChannel(outR, sr, def.lowpass);
  }

  // Mixdown: fades, saturation, normalize
  let peak = 0;
  const fadeIn = Math.min(1.2, duration * 0.08);
  const fadeOut = Math.min(2.4, duration * 0.18);
  for (let i = 0; i < frames; i += 1) {
    const t = i / sr;
    let gain = 1;
    if (t < fadeIn) gain *= t / fadeIn;
    if (t > duration - fadeOut) gain *= Math.max(0, (duration - t) / fadeOut);
    outL[i] = softLimit(outL[i] * gain, 1.15);
    outR[i] = softLimit(outR[i] * gain, 1.15);
    const p = Math.max(Math.abs(outL[i]), Math.abs(outR[i]));
    if (p > peak) peak = p;
  }
  const normalize = peak > 0 ? 0.92 / peak : 1;
  for (let i = 0; i < frames; i += 1) {
    outL[i] *= normalize;
    outR[i] *= normalize;
  }

  const peaks = peakArray([outL, outR], 220);
  const progressionNames = progression.map((degree) => {
    const pc = (((theme.rootPc + scale[((degree % scale.length) + scale.length) % scale.length]) % 12) + 12) % 12;
    return noteName(pc);
  });

  return {
    channels: [outL, outR],
    sampleRate: sr,
    duration,
    peaks,
    meta: {
      style: theme.style,
      styleLabel: theme.styleLabel,
      bpm: theme.bpm,
      key: `${noteName(theme.rootPc)} ${theme.scaleLabel}`,
      scale: theme.scale,
      root: noteName(theme.rootPc),
      bars: totalBars,
      progression: progressionNames,
      seed: theme.seed,
      title: theme.title,
      instruments: ['pad', 'bass', ...(def.arp ? ['arp'] : []), 'lead', ...(patternHasDrums(def.drums) ? ['drums'] : [])],
    },
  };
}

function patternHasDrums(name) {
  const pattern = DRUMS[name];
  if (!pattern) return false;
  return Object.values(pattern).some((steps) => Array.isArray(steps) && steps.length > 0);
}

async function writeMusicFile(render, outFile, signal) {
  const dir = path.dirname(outFile);
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(outFile).toLowerCase();
  if (ext === '.wav') {
    fs.writeFileSync(outFile, encodeWav(render.channels, render.sampleRate));
    return outFile;
  }
  if (!ffmpegAvailable()) {
    const wav = outFile.replace(/\.[^.]+$/, '.wav');
    fs.writeFileSync(wav, encodeWav(render.channels, render.sampleRate));
    return wav;
  }
  const tempWav = path.join(dir, `.blank-audio-${process.pid}-${Date.now()}.wav`);
  fs.writeFileSync(tempWav, encodeWav(render.channels, render.sampleRate));
  try {
    await runProcess(ffmpegBin(), [
      '-v', 'error', '-y', '-i', tempWav,
      '-codec:a', 'libmp3lame', '-b:a', '192k', '-ar', String(render.sampleRate),
      outFile,
    ], { signal, timeout: 180000, maxStdout: 4096 });
    return outFile;
  } finally {
    try { fs.unlinkSync(tempWav); } catch {}
  }
}

const STYLE_LIST = Object.entries(STYLES).map(([id, def]) => ({ id, label: def.label, bpm: def.bpm }));

module.exports = {
  STYLES, STYLE_LIST, SCALES, resolveMusic, renderMusic, writeMusicFile,
  midiToFreq, noteName,
};
