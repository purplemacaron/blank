'use strict';

const {
  hashString, mulberry32, pick, range, clamp, escapeXml,
  hexToRgb, rgbToHex, shade, mix, titleFromPrompt,
} = require('./util');

const TAU = Math.PI * 2;

const PALETTES = {
  cobalt: { id: 'cobalt', name: 'Cobalt', dark: true, bg: '#070B16', ink: '#EDF2FF', colors: ['#2F6BFF', '#7CA8FF', '#C7D8FF', '#FF7A59'] },
  ice: { id: 'ice', name: 'Ice', dark: false, bg: '#F3F7FF', ink: '#0B1B3B', colors: ['#2F6BFF', '#6E9BFF', '#BBD2FF', '#0B1B3B'] },
  sunset: { id: 'sunset', name: 'Sunset', dark: true, bg: '#160D18', ink: '#FFF1E8', colors: ['#FF6B4A', '#FFB36B', '#FFD9A0', '#7C5CFF'] },
  dawn: { id: 'dawn', name: 'Dawn', dark: false, bg: '#FFF4EA', ink: '#2B1B12', colors: ['#FF8A5C', '#FFC08A', '#FFE3C7', '#2F6BFF'] },
  violet: { id: 'violet', name: 'Violet', dark: true, bg: '#0E0A1E', ink: '#F3EEFF', colors: ['#8B5CF6', '#C4B5FD', '#F472B6', '#2F6BFF'] },
  mint: { id: 'mint', name: 'Mint', dark: false, bg: '#EFFAF5', ink: '#0C2A22', colors: ['#17A57E', '#7FD8BC', '#C9F0E2', '#F2B64C'] },
  forest: { id: 'forest', name: 'Forest', dark: true, bg: '#08120D', ink: '#EAF6EE', colors: ['#2E7D5B', '#8ED3A8', '#E9C46A', '#173B2B'] },
  sand: { id: 'sand', name: 'Sand', dark: false, bg: '#F6F0E6', ink: '#2A2118', colors: ['#B4855B', '#D9BC9C', '#EFE0CC', '#2F6BFF'] },
  mono: { id: 'mono', name: 'Mono', dark: false, bg: '#F6F6F7', ink: '#111114', colors: ['#151519', '#6B6B75', '#C9C9D1', '#2F6BFF'] },
  noir: { id: 'noir', name: 'Noir', dark: true, bg: '#0A0A0C', ink: '#F2F2F4', colors: ['#E8E8EC', '#9A9AA5', '#4A4A55', '#2F6BFF'] },
};

const STYLE_RULES = [
  { id: 'cosmic', words: ['space', 'galaxy', 'nebula', 'planet', 'cosmic', 'star', 'universe', 'moon', 'orbit', 'astronaut', 'saturn'] },
  { id: 'landscape', words: ['mountain', 'landscape', 'nature', 'valley', 'sunrise', 'sunset', 'forest', 'lake', 'field', 'desert', 'alps', 'horizon', 'meadow', 'volcano', 'canyon'] },
  { id: 'portrait', words: ['portrait', 'person', 'face', 'woman', 'man', 'human', 'profile', 'child', 'figure', 'silhouette', 'head'] },
  { id: 'botanical', words: ['flower', 'botanical', 'plant', 'leaf', 'garden', 'floral', 'blossom', 'tree', 'rose', 'fern', 'petal'] },
  { id: 'product', words: ['product', 'bottle', 'package', 'sneaker', 'watch', 'device', 'perfume', 'cosmetic', 'still life', 'club', 'chair'] },
  { id: 'architecture', words: ['architecture', 'building', 'city', 'brutalist', 'arch', 'concrete', 'tower', 'house', 'interior', 'temple', 'monument'] },
  { id: 'mark', words: ['logo', 'mark', 'icon', 'brand', 'monogram', 'emblem', 'symbol', 'identity'] },
  { id: 'grid', words: ['poster', 'typography', 'editorial', 'swiss', 'layout', 'magazine', 'print', 'cover'] },
  { id: 'waves', words: ['wave', 'ocean', 'sea', 'sound', 'topography', 'flow', 'line art', 'water', 'ripple', 'frequency'] },
  { id: 'aurora', words: ['abstract', 'gradient', 'aurora', 'dream', 'fluid', 'glow', 'ethereal', 'light'] },
];

const STYLE_LABELS = {
  aurora: 'Aurora', cosmic: 'Cosmic', landscape: 'Landscape', portrait: 'Portrait',
  botanical: 'Botanical', product: 'Still life', architecture: 'Architecture',
  mark: 'Identity', grid: 'Poster', waves: 'Waves',
};

const PALETTE_WORDS = {
  cobalt: ['blue', 'cobalt', 'navy', 'azure', 'electric', 'royal'],
  ice: ['light', 'white', 'minimal', 'clean', 'sky', 'air', 'fresh', 'pale'],
  sunset: ['sunset', 'sunrise', 'orange', 'coral', 'fire', 'warm', 'golden hour', 'ember', 'peach'],
  dawn: ['cream', 'pastel', 'soft', 'morning', 'beige', 'blush'],
  violet: ['purple', 'violet', 'lavender', 'magenta', 'pink', 'orchid'],
  mint: ['green', 'mint', 'emerald', 'teal', 'turquoise', 'jade', 'sage'],
  forest: ['forest', 'jungle', 'moss', 'dark green', 'pine', 'woodland'],
  sand: ['sand', 'earth', 'brown', 'clay', 'terracotta', 'luxury', 'khaki'],
  mono: ['monochrome', 'black and white', 'grayscale', 'greyscale', 'ink', 'newspaper'],
  noir: ['black', 'dark', 'night', 'midnight', 'moody', 'shadow'],
};

const COLOR_WORDS = [
  ['#FF4D5E', ['crimson', 'scarlet', 'red']],
  ['#FF7A3C', ['orange', 'tangerine']],
  ['#F5A524', ['amber', 'gold', 'golden', 'yellow']],
  ['#1FB57A', ['emerald', 'jade', 'green']],
  ['#14B8A6', ['teal', 'turquoise', 'cyan']],
  ['#2F8DFF', ['sky blue', 'azure']],
  ['#2F6BFF', ['blue', 'cobalt', 'navy']],
  ['#8B5CF6', ['purple', 'violet', 'lavender']],
  ['#FF5CA8', ['pink', 'magenta', 'rose']],
  ['#9A6B4F', ['brown', 'coffee', 'chocolate']],
  ['#101014', ['black']],
  ['#FAFAFC', ['white']],
];

function n(value) {
  return Math.round(Number(value) * 100) / 100;
}

function linearGradient(id, stops, x1 = 0, y1 = 0, x2 = 0, y2 = 1) {
  const body = stops.map(([offset, color, opacity]) =>
    `<stop offset="${n(offset * 100)}%" stop-color="${color}"${opacity != null ? ` stop-opacity="${n(opacity)}"` : ''}/>`).join('');
  return `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${body}</linearGradient>`;
}

function radialGradient(id, stops, cx = 0.5, cy = 0.5, r = 0.5) {
  const body = stops.map(([offset, color, opacity]) =>
    `<stop offset="${n(offset * 100)}%" stop-color="${color}"${opacity != null ? ` stop-opacity="${n(opacity)}"` : ''}/>`).join('');
  return `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${body}</radialGradient>`;
}

function blurFilter(id, std) {
  return `<filter id="${id}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="${n(std)}"/></filter>`;
}

const GRAIN_FILTER = `<filter id="grainF" x="0" y="0" width="100%" height="100%">` +
  `<feTurbulence type="fractalNoise" baseFrequency="0.82" numOctaves="3" stitchTiles="stitch" result="noise"/>` +
  `<feColorMatrix in="noise" type="saturate" values="0"/>` +
  `<feComponentTransfer><feFuncA type="linear" slope="0.17" intercept="0"/></feComponentTransfer>` +
  `</filter>`;

function catmullPath(points) {
  if (!points || points.length < 2) return '';
  let d = `M ${n(points[0][0])} ${n(points[0][1])}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${n(c1x)} ${n(c1y)} ${n(c2x)} ${n(c2y)} ${n(p2[0])} ${n(p2[1])}`;
  }
  return d;
}

function wrapWords(text, maxChars, maxLines = 4) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  let index = 0;
  for (; index < words.length; index += 1) {
    const word = words[index];
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
      if (lines.length === maxLines) break;
    } else {
      current = candidate;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  const truncated = index < words.length && lines.length >= maxLines;
  if (truncated) lines[lines.length - 1] = `${lines[lines.length - 1].replace(/[.,;:]$/, '')}…`;
  return lines;
}

function quotedName(prompt) {
  const match = String(prompt || '').match(/["“'‘]([^"”'’]{2,28})["”'’]/);
  return match ? match[1].trim() : '';
}

function brandName(prompt) {
  const quoted = quotedName(prompt);
  if (quoted) return quoted;
  const called = String(prompt || '').match(/\b(?:called|named)\s+([A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*){0,2})/);
  if (called) return called[1].trim();
  const caps = String(prompt || '').match(/\b([A-Z]{3,16})\b/);
  if (caps) return caps[1];
  return '';
}

function shortText(text, maxLength, fallback = '') {
  const value = String(text || fallback || '').trim();
  if (!value) return fallback;
  if (value.length <= maxLength) return value;
  const cut = value.slice(0, maxLength - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > maxLength * 0.55 ? cut.slice(0, space) : cut).replace(/[,.;:-]$/, '')}…`;
}

function detectStyle(lower, seed) {
  let best = '';
  let bestScore = 0;
  for (const rule of STYLE_RULES) {
    let score = 0;
    for (const word of rule.words) if (lower.includes(word)) score += 1;
    if (score > bestScore) { bestScore = score; best = rule.id; }
  }
  if (best) return best;
  const fallback = ['aurora', 'waves', 'grid', 'cosmic', 'mark', 'botanical'];
  return fallback[seed % fallback.length];
}

function choosePalette(lower, seed) {
  let best = '';
  let bestScore = 0;
  for (const [id, words] of Object.entries(PALETTE_WORDS)) {
    let score = 0;
    for (const word of words) if (lower.includes(word)) score += 1;
    if (score > bestScore) { bestScore = score; best = id; }
  }
  if (best) return PALETTES[best];
  const rotation = ['ice', 'cobalt', 'dawn', 'violet', 'mint', 'sunset', 'mono', 'sand', 'forest', 'noir'];
  return PALETTES[rotation[seed % rotation.length]];
}

function accentOverride(lower) {
  if (/black and white|monochrome|grayscale|greyscale/.test(lower)) return '';
  for (const [hex, words] of COLOR_WORDS) {
    for (const word of words) {
      if (word === 'white' || word === 'black') continue;
      if (new RegExp(`\\b${word}\\b`).test(lower)) return hex;
    }
  }
  return '';
}

function getPalette(input, seed = 0) {
  if (!input) return PALETTES[['ice', 'cobalt', 'dawn'][seed % 3]];
  if (typeof input === 'string') return PALETTES[input] || PALETTES.ice;
  if (Array.isArray(input?.colors)) {
    return {
      id: input.id || 'custom',
      name: input.name || 'Custom',
      dark: Boolean(input.dark),
      bg: input.bg || (input.dark ? '#0A0A10' : '#F7F7F9'),
      ink: input.ink || (input.dark ? '#F2F2F4' : '#111114'),
      colors: [input.colors[0] || '#2F6BFF', input.colors[1] || '#7CA8FF', input.colors[2] || '#C7D8FF', input.colors[3] || '#FF7A59'],
    };
  }
  return PALETTES.ice;
}

function resolveTheme(prompt, seed, styleOverride, paletteOverride) {
  const lower = String(prompt || '').toLowerCase();
  const resolvedSeed = Number.isFinite(Number(seed)) ? Number(seed) >>> 0 : hashString(String(prompt || 'blank'));
  const style = STYLE_RULES.some((rule) => rule.id === styleOverride) ? styleOverride : detectStyle(lower, resolvedSeed);
  let palette = paletteOverride ? getPalette(paletteOverride, resolvedSeed) : choosePalette(lower, resolvedSeed);
  const accent = accentOverride(lower);
  if (accent) {
    palette = {
      ...palette,
      colors: [accent, mix(accent, '#ffffff', 0.4), mix(accent, '#ffffff', 0.72), palette.colors[3]],
    };
  }
  if (/\b(dark|black|night|midnight|moody)\b/.test(lower) && !palette.dark) {
    palette = { ...palette, dark: true, bg: '#0A0A10', ink: '#F2F2F4', colors: [palette.colors[0], palette.colors[1], palette.colors[2], '#F2F2F4'] };
  }
  if (style === 'cosmic' && !palette.dark) {
    palette = { ...palette, dark: true, bg: '#05060F', ink: '#EDF2FF' };
  }
  return {
    style,
    palette,
    title: titleFromPrompt(prompt, 'Untitled'),
    brand: quotedName(prompt),
    seed: resolvedSeed,
  };
}

function vignette(theme, w, h, strength = 0.45) {
  const color = theme.dark ? '#000000' : theme.ink;
  return `<radialGradient id="vig" cx="0.5" cy="0.46" r="0.74">` +
    `<stop offset="55%" stop-color="${color}" stop-opacity="0"/>` +
    `<stop offset="100%" stop-color="${color}" stop-opacity="${n(strength)}"/>` +
    `</radialGradient><rect width="${w}" height="${h}" fill="url(#vig)"/>`;
}

function signature(ctx, label = 'BLANK') {
  const { w, h, theme } = ctx;
  const size = Math.max(9, Math.min(w, h) * 0.014);
  return `<g opacity="0.55" fill="${theme.ink}" font-family="Inter, 'Segoe UI', Arial, sans-serif" font-size="${n(size)}" letter-spacing="${n(size * 0.24)}">` +
    `<circle cx="${n(w * 0.06)}" cy="${n(h * 0.945)}" r="${n(size * 0.28)}" fill="${theme.colors[0]}"/>` +
    `<text x="${n(w * 0.06 + size * 1.1)}" y="${n(h * 0.945 + size * 0.36)}">${escapeXml(label)}</text>` +
    `</g>`;
}

/* ----------------------------------------------------------------- aurora */

function auroraScene(ctx) {
  const { w, h, t, rng, theme, defs } = ctx;
  const [c0, c1, c2, c3] = theme.colors;
  const deep = theme.dark ? '#04060E' : mix(theme.bg, c1, 0.24);
  defs.push(linearGradient('aBg', [
    [0, deep],
    [0.42, mix(deep, c0, theme.dark ? 0.2 : 0.14)],
    [0.78, mix(deep, c3, theme.dark ? 0.14 : 0.12)],
    [1, theme.dark ? shade(deep, 0.04) : shade(deep, -0.06)],
  ]));
  defs.push(blurFilter('aSoft', Math.min(w, h) * 0.15));
  defs.push(blurFilter('aTight', Math.min(w, h) * 0.035));
  defs.push(linearGradient('aRibbon', [[0, c0, 0], [0.2, c1, 1], [0.52, c2, 0.9], [0.8, c3, 0.95], [1, c0, 0]], 0, 0, 1, 0));
  defs.push(radialGradient('aGlow', [[0, c1, 0.75], [0.5, c0, 0.28], [1, c0, 0]], 0.5, 0.5, 0.5));
  defs.push(radialGradient('aMoon', [[0, '#FFFFFF', 0.95], [0.45, c2, 0.5], [1, c2, 0]], 0.4, 0.35, 0.6));

  let s = `<rect width="${w}" height="${h}" fill="url(#aBg)"/>`;
  s += `<ellipse cx="${n(w * 0.52)}" cy="${n(h * 0.58)}" rx="${n(w * 0.46)}" ry="${n(h * 0.3)}" fill="url(#aGlow)" opacity="0.55" filter="url(#aSoft)" style="mix-blend-mode:${theme.dark ? 'screen' : 'multiply'}"/>`;

  for (let i = 0; i < 4; i += 1) {
    const col = [c0, c1, c3, c2][i % 4];
    const cx = w * (0.18 + 0.64 * rng()) + Math.sin(t * TAU + i * 1.7) * w * 0.05;
    const cy = h * (0.2 + 0.62 * rng()) + Math.cos(t * TAU * 0.8 + i) * h * 0.035;
    const rx = w * (0.24 + 0.24 * rng());
    const ry = h * (0.19 + 0.22 * rng());
    s += `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(rx)}" ry="${n(ry)}" fill="${col}" opacity="${n(0.26 + 0.18 * rng())}" filter="url(#aSoft)" style="mix-blend-mode:${theme.dark ? 'screen' : 'multiply'}"/>`;
  }

  for (let i = 0; i < 3; i += 1) {
    const phase = i * 2.1;
    const points = [];
    const baseY = h * (0.34 + i * 0.16);
    for (let k = 0; k <= 9; k += 1) {
      const x = (w * k) / 9;
      const y = baseY + Math.sin((k / 9) * TAU * 1.35 + t * TAU + phase) * h * (0.055 + i * 0.02)
        + Math.cos((k / 9) * TAU + phase) * h * 0.022;
      points.push([x, y]);
    }
    const path = catmullPath(points);
    s += `<path d="${path}" fill="none" stroke="${i % 2 ? c1 : c0}" stroke-width="${n(Math.min(w, h) * (0.022 + i * 0.006))}" stroke-linecap="round" opacity="0.18" filter="url(#aTight)"/>`;
    s += `<path d="${path}" fill="none" stroke="url(#aRibbon)" stroke-width="${n(Math.min(w, h) * (0.0035 + i * 0.0018))}" stroke-linecap="round" opacity="${n(0.95 - i * 0.16)}"/>`;
  }

  for (let i = 0; i < 4; i += 1) {
    const cy = h * (0.3 + i * 0.13);
    const rx = w * (0.34 + i * 0.08);
    s += `<ellipse cx="${n(w * 0.5)}" cy="${n(cy)}" rx="${n(rx)}" ry="${n(rx * 0.2)}" fill="none" stroke="${theme.ink}" stroke-opacity="${n(0.055 + i * 0.01)}" stroke-width="${n(Math.min(w, h) * 0.0014)}"/>`;
  }

  const step = Math.max(30, w * 0.038);
  for (let x = step; x < w; x += step) {
    for (let y = step; y < h; y += step) {
      if (rng() < 0.35) continue;
      const twinkle = 0.1 + 0.18 * Math.abs(Math.sin(t * TAU + (x + y) * 0.013));
      s += `<circle cx="${n(x)}" cy="${n(y)}" r="${n(Math.min(w, h) * 0.0014)}" fill="${theme.ink}" opacity="${n(twinkle)}"/>`;
    }
  }

  s += `<circle cx="${n(w * 0.77)}" cy="${n(h * 0.19)}" r="${n(Math.min(w, h) * 0.11)}" fill="url(#aMoon)"/>`;
  s += `<circle cx="${n(w * 0.77)}" cy="${n(h * 0.19)}" r="${n(Math.min(w, h) * 0.032)}" fill="#FFFFFF" opacity="0.85"/>`;

  s += vignette(theme, w, h, theme.dark ? 0.55 : 0.14);
  return s;
}

/* ----------------------------------------------------------------- cosmic */

function cosmicScene(ctx) {
  const { w, h, t, rng, theme, defs } = ctx;
  const [c0, c1, c2, c3] = theme.colors;
  defs.push(radialGradient('cBg', [[0, mix('#05060F', c0, 0.22)], [0.55, '#05060F'], [1, '#020207']], 0.62, 0.32, 0.9));
  defs.push(blurFilter('cSoft', Math.min(w, h) * 0.16));
  defs.push(radialGradient('cPlanet', [[0, shade(c0, 0.5)], [0.32, c0], [0.72, mix(c0, '#05060F', 0.55)], [1, '#04040A']], 0.36, 0.3, 0.72));
  defs.push(radialGradient('cMoon', [[0, c2], [0.7, shade(c1, -0.3)], [1, '#0A0A14']], 0.35, 0.32, 0.7));

  let s = `<rect width="${w}" height="${h}" fill="url(#cBg)"/>`;

  for (let i = 0; i < 6; i += 1) {
    const col = [c0, c1, c3, c2][i % 4];
    const cx = w * (0.08 + 0.84 * rng());
    const cy = h * (0.08 + 0.8 * rng());
    const rx = w * (0.16 + 0.26 * rng());
    const ry = h * (0.12 + 0.2 * rng());
    s += `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(rx)}" ry="${n(ry)}" fill="${col}" opacity="${n(0.14 + 0.16 * rng())}" filter="url(#cSoft)" style="mix-blend-mode:screen"/>`;
  }

  const stars = [];
  for (let i = 0; i < 150; i += 1) {
    const x = rng() * w;
    const y = rng() * h;
    const r = range(rng, 0.5, Math.min(w, h) * 0.0026);
    const phase = rng() * TAU;
    const alpha = 0.35 + 0.55 * Math.abs(Math.sin(t * TAU + phase));
    stars.push([x, y]);
    s += `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="#FFFFFF" opacity="${n(alpha)}"/>`;
  }
  for (let i = 0; i < 5; i += 1) {
    const star = stars[(i * 29) % stars.length];
    s += `<circle cx="${n(star[0])}" cy="${n(star[1])}" r="${n(Math.min(w, h) * 0.006)}" fill="${c2}" opacity="0.4" filter="url(#cSoft)"/>`;
  }

  const px = w * 0.66;
  const py = h * 0.42;
  const pr = Math.min(w, h) * 0.185;
  s += `<g transform="rotate(-16 ${n(px)} ${n(py)})" opacity="0.8">`;
  s += `<ellipse cx="${n(px)}" cy="${n(py)}" rx="${n(pr * 1.82)}" ry="${n(pr * 0.34)}" fill="none" stroke="${c1}" stroke-opacity="0.55" stroke-width="${n(pr * 0.035)}"/>`;
  s += `<ellipse cx="${n(px)}" cy="${n(py)}" rx="${n(pr * 1.55)}" ry="${n(pr * 0.27)}" fill="none" stroke="${c0}" stroke-opacity="0.35" stroke-width="${n(pr * 0.014)}"/>`;
  s += `</g>`;
  s += `<circle cx="${n(px)}" cy="${n(py)}" r="${n(pr)}" fill="url(#cPlanet)"/>`;
  s += `<circle cx="${n(px - pr * 0.28)}" cy="${n(py - pr * 0.32)}" r="${n(pr * 0.55)}" fill="#FFFFFF" opacity="0.05"/>`;
  s += `<circle cx="${n(px + pr * 0.52)}" cy="${n(py + pr * 0.45)}" r="${n(pr * 0.16)}" fill="#000000" opacity="0.28" filter="url(#cSoft)"/>`;

  const mx = w * 0.28;
  const my = h * 0.66;
  const mr = Math.min(w, h) * 0.055;
  s += `<circle cx="${n(mx)}" cy="${n(my)}" r="${n(mr)}" fill="url(#cMoon)"/>`;
  s += `<circle cx="${n(mx - mr * 0.25)}" cy="${n(my - mr * 0.2)}" r="${n(mr * 0.16)}" fill="#000000" opacity="0.18"/>`;

  for (let i = 0; i < 3; i += 1) {
    const a = stars[(i * 41 + 7) % stars.length];
    const b = stars[(i * 67 + 23) % stars.length];
    s += `<line x1="${n(a[0])}" y1="${n(a[1])}" x2="${n(b[0])}" y2="${n(b[1])}" stroke="${theme.ink}" stroke-opacity="0.1" stroke-width="0.8"/>`;
  }

  s += vignette(theme, w, h, 0.6);
  return s;
}

/* -------------------------------------------------------------- landscape */

function ridgePoints(w, baseY, amp, phase, rng) {
  const points = [];
  const steps = 20;
  for (let i = 0; i <= steps; i += 1) {
    const x = (w * i) / steps;
    const waves = Math.sin((i / steps) * TAU * 1.35 + phase) * 0.55
      + Math.sin((i / steps) * TAU * 2.9 + phase * 1.7) * 0.28
      + Math.cos((i / steps) * TAU * 0.7 + phase) * 0.2;
    const y = baseY - (0.5 + Math.abs(waves)) * amp - range(rng, 0, amp * 0.12);
    points.push([x, y]);
  }
  return points;
}

function landscapeScene(ctx) {
  const { w, h, t, rng, theme, defs } = ctx;
  const [c0, c1, c2, c3] = theme.colors;
  const horizon = h * 0.6;
  const skyTop = theme.dark ? mix('#0B1024', c3, 0.3) : mix('#E8F1FF', c3, 0.12);
  const glow = mix(c1, '#FFE7B8', 0.45);
  const ridgeDark = theme.dark ? '#173247' : '#2C4358';
  defs.push(linearGradient('lSky', [
    [0, skyTop],
    [0.42, mix(skyTop, glow, theme.dark ? 0.3 : 0.38)],
    [0.74, glow],
    [1, mix(glow, '#FFF8E8', 0.45)],
  ]));
  defs.push(radialGradient('lSun', [[0, '#FFFBEF', 0.98], [0.28, '#FFF1C9', 0.9], [0.62, c1, 0.32], [1, c1, 0]]));
  defs.push(linearGradient('lWater', [
    [0, theme.dark ? mix(glow, '#25435B', 0.7) : mix(glow, '#42657F', 0.55)],
    [0.24, theme.dark ? '#12283C' : '#244A64'],
    [1, theme.dark ? '#050B13' : '#0D2233'],
  ]));
  defs.push(linearGradient('lReflect', [[0, c1, 0.45], [1, c1, 0]]));
  defs.push(blurFilter('lSoft', Math.min(w, h) * 0.025));
  defs.push(radialGradient('lMist', [[0, '#FFFFFF', 0.35], [1, '#FFFFFF', 0]], 0.5, 0.5, 0.5));

  let s = `<rect width="${w}" height="${h}" fill="url(#lSky)"/>`;

  if (theme.dark) {
    for (let i = 0; i < 40; i += 1) {
      const x = rng() * w;
      const y = rng() * h * 0.36;
      s += `<circle cx="${n(x)}" cy="${n(y)}" r="${n(range(rng, 0.4, 1.2))}" fill="#FFFFFF" opacity="${n(0.2 + rng() * 0.4)}"/>`;
    }
  }

  const sx = w * 0.68;
  const sy = h * 0.335 + Math.sin(t * TAU) * h * 0.006;
  const sr = Math.min(w, h) * 0.062;
  s += `<circle cx="${n(sx)}" cy="${n(sy)}" r="${n(sr * 3.6)}" fill="url(#lSun)" opacity="0.7"/>`;
  s += `<circle cx="${n(sx)}" cy="${n(sy)}" r="${n(sr)}" fill="#FFF8E4"/>`;
  s += `<circle cx="${n(sx)}" cy="${n(sy)}" r="${n(sr * 0.7)}" fill="#FFFDF5"/>`;

  for (let i = 0; i < 3; i += 1) {
    const by = h * (0.26 + i * 0.055);
    const cx = w * (0.24 + i * 0.23) + Math.sin(t * TAU + i) * w * 0.015;
    s += `<ellipse cx="${n(cx)}" cy="${n(by)}" rx="${n(w * 0.22)}" ry="${n(h * 0.011)}" fill="${glow}" opacity="${n(0.22 + i * 0.06)}" filter="url(#lSoft)"/>`;
  }

  const ridgeData = [];
  for (let i = 0; i < 4; i += 1) {
    const baseY = horizon - h * (0.015 + i * 0.018);
    const amp = h * (0.15 - i * 0.026);
    const points = ridgePoints(w, baseY, amp, rng() * TAU, rng);
    const fill = mix(glow, ridgeDark, 0.35 + i * 0.19);
    ridgeData.push({ points, fill });
  }
  s += `<rect x="0" y="${n(horizon - h * 0.03)}" width="${w}" height="${n(h * 0.12)}" fill="url(#lMist)" opacity="0.6"/>`;
  ridgeData.forEach((ridge, i) => {
    s += `<path d="${catmullPath(ridge.points)} L ${w} ${n(horizon + 4)} L 0 ${n(horizon + 4)} Z" fill="${ridge.fill}" opacity="${n(0.97 - i * 0.03)}"/>`;
    if (i === 2) {
      const lit = ridge.points.slice(0, Math.ceil(ridge.points.length * 0.62));
      s += `<path d="${catmullPath(lit)}" fill="none" stroke="${c1}" stroke-opacity="0.28" stroke-width="1.2"/>`;
    }
  });

  const front = ridgeData[ridgeData.length - 1].points;
  const treeFill = theme.dark ? '#070D14' : '#182C3E';
  front.forEach(([x, y], index) => {
    if (index % 2 === 0 && index < front.length - 1) {
      const height = h * (0.016 + rng() * 0.024);
      const width = height * (0.3 + rng() * 0.12);
      s += `<path d="M ${n(x - width)} ${n(y + 2)} L ${n(x)} ${n(y - height)} L ${n(x + width)} ${n(y + 2)} Z" fill="${treeFill}" opacity="0.92"/>`;
      if (index % 4 === 0) {
        const h2 = height * 0.62;
        s += `<path d="M ${n(x + width * 1.4)} ${n(y + 2)} L ${n(x + width * 1.8)} ${n(y - h2)} L ${n(x + width * 2.2)} ${n(y + 2)} Z" fill="${treeFill}" opacity="0.8"/>`;
      }
    }
  });

  s += `<rect x="0" y="${n(horizon)}" width="${w}" height="${n(h - horizon)}" fill="url(#lWater)"/>`;
  s += `<rect x="${n(sx - sr * 1.5)}" y="${n(horizon)}" width="${n(sr * 3)}" height="${n(h - horizon)}" fill="url(#lReflect)"/>`;

  for (let i = 0; i < 18; i += 1) {
    const y = horizon + (h - horizon) * Math.pow(i / 18, 1.45);
    const lineW = w * (0.08 + 0.3 * rng()) * (1 - i / 26);
    const ox = Math.sin(t * TAU + i * 0.8) * w * 0.025;
    const warm = i % 3 !== 0;
    s += `<rect x="${n(sx - lineW / 2 + ox)}" y="${n(y)}" width="${n(Math.max(4, lineW))}" height="${n(1 + (i % 3) * 0.8)}" rx="1" fill="${warm ? c1 : '#FFFFFF'}" opacity="${n(0.1 + 0.14 * rng())}"/>`;
  }

  for (let i = 0; i < 5; i += 1) {
    const bx = w * (0.14 + i * 0.055) + Math.sin(t * TAU + i) * w * 0.008;
    const by = h * (0.16 + (i % 3) * 0.038);
    const size = h * (0.007 + (i % 2) * 0.003);
    s += `<path d="M ${n(bx - size)} ${n(by)} Q ${n(bx - size / 2)} ${n(by - size * 0.8)} ${n(bx)} ${n(by)} Q ${n(bx + size / 2)} ${n(by - size * 0.8)} ${n(bx + size)} ${n(by)}" fill="none" stroke="${theme.dark ? '#FFFFFF' : theme.ink}" stroke-opacity="${n(0.22 + i * 0.04)}" stroke-width="1.2"/>`;
  }

  s += vignette(theme, w, h, theme.dark ? 0.4 : 0.12);
  return s;
}

/* --------------------------------------------------------------- portrait */

function portraitScene(ctx) {
  const { w, h, t, theme, defs, prompt } = ctx;
  const [c0, c1, c2, c3] = theme.colors;
  const cx = w * 0.5;
  const cy = h * 0.43;
  const headR = Math.min(w, h) * 0.185;
  const hue = theme.dark ? mix(c0, theme.bg, 0.45) : c0;
  const hairColor = theme.dark ? mix(c0, '#05070D', 0.55) : mix(c0, '#1B1B24', 0.62);

  defs.push(linearGradient('pBg', [[0, theme.bg], [0.62, mix(theme.bg, c0, 0.12)], [1, mix(theme.bg, c3, 0.13)]]));
  defs.push(radialGradient('pHalo', [[0, c1, 0.42], [0.55, c0, 0.2], [1, c0, 0]]));
  defs.push(linearGradient('pBust', [[0, mix(c0, '#FFFFFF', 0.12)], [0.45, hue], [1, theme.dark ? shade(c0, -0.62) : mix(c0, theme.bg, 0.55)]]));
  defs.push(linearGradient('pFace', [[0, mix(c1, '#FFFFFF', 0.2)], [0.45, c0], [1, shade(c0, -0.42)]], 0, 0, 1, 1));
  defs.push(linearGradient('pHair', [[0, mix(hairColor, c1, 0.2)], [1, hairColor]]));
  defs.push(`<pattern id="pDots" width="${n(Math.max(6, w * 0.011))}" height="${n(Math.max(6, w * 0.011))}" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r="${n(Math.max(0.9, w * 0.0014))}" fill="${theme.ink}"/></pattern>`);

  const left = cx - headR;
  const top = cy - headR * 1.02;
  const X = (u) => left + u * headR * 2;
  const Y = (v) => top + v * headR * 2.06;
  const scalp = `M ${n(X(0.36))} ${n(Y(1))} ` +
    `C ${n(X(0.1))} ${n(Y(0.74))} ${n(X(0.06))} ${n(Y(0.22))} ${n(X(0.34))} ${n(Y(0.03))} ` +
    `C ${n(X(0.5))} ${n(Y(-0.08))} ${n(X(0.7))} ${n(Y(-0.01))} ${n(X(0.755))} ${n(Y(0.14))} ` +
    `C ${n(X(0.62))} ${n(Y(0.04))} ${n(X(0.44))} ${n(Y(0.08))} ${n(X(0.36))} ${n(Y(0.24))} ` +
    `C ${n(X(0.28))} ${n(Y(0.4))} ${n(X(0.32))} ${n(Y(0.6))} ${n(X(0.43))} ${n(Y(0.76))} ` +
    `C ${n(X(0.39))} ${n(Y(0.86))} ${n(X(0.37))} ${n(Y(0.94))} ${n(X(0.36))} ${n(Y(1))} Z`;
  const facePath = `M ${n(X(0.34))} ${n(Y(1))} ` +
    `C ${n(X(0.16))} ${n(Y(0.78))} ${n(X(0.12))} ${n(Y(0.4))} ${n(X(0.32))} ${n(Y(0.16))} ` +
    `C ${n(X(0.46))} ${n(Y(0.01))} ${n(X(0.66))} ${n(Y(0.06))} ${n(X(0.74))} ${n(Y(0.26))} ` +
    `C ${n(X(0.765))} ${n(Y(0.33))} ${n(X(0.75))} ${n(Y(0.4))} ${n(X(0.75))} ${n(Y(0.44))} ` +
    `C ${n(X(0.82))} ${n(Y(0.475))} ${n(X(0.9))} ${n(Y(0.55))} ${n(X(0.89))} ${n(Y(0.59))} ` +
    `C ${n(X(0.88))} ${n(Y(0.625))} ${n(X(0.82))} ${n(Y(0.635))} ${n(X(0.77))} ${n(Y(0.625))} ` +
    `C ${n(X(0.79))} ${n(Y(0.655))} ${n(X(0.84))} ${n(Y(0.665))} ${n(X(0.825))} ${n(Y(0.695))} ` +
    `C ${n(X(0.815))} ${n(Y(0.715))} ${n(X(0.78))} ${n(Y(0.715))} ${n(X(0.77))} ${n(Y(0.715))} ` +
    `C ${n(X(0.79))} ${n(Y(0.745))} ${n(X(0.785))} ${n(Y(0.78))} ${n(X(0.76))} ${n(Y(0.805))} ` +
    `C ${n(X(0.74))} ${n(Y(0.87))} ${n(X(0.66))} ${n(Y(0.905))} ${n(X(0.58))} ${n(Y(0.895))} ` +
    `C ${n(X(0.56))} ${n(Y(0.94))} ${n(X(0.56))} ${n(Y(0.98))} ${n(X(0.575))} ${n(Y(1))} Z`;
  const neckY = Y(1);
  const shoulderTop = neckY + h * 0.05;
  const shoulders = `M ${n(cx - w * 0.35)} ${n(h + 4)} ` +
    `C ${n(cx - w * 0.31)} ${n(shoulderTop + h * 0.11)} ${n(cx - w * 0.15)} ${n(shoulderTop)} ${n(cx - headR * 0.42)} ${n(shoulderTop)} ` +
    `L ${n(cx + headR * 0.5)} ${n(shoulderTop)} ` +
    `C ${n(cx + w * 0.17)} ${n(shoulderTop)} ${n(cx + w * 0.31)} ${n(shoulderTop + h * 0.11)} ${n(cx + w * 0.35)} ${n(h + 4)} Z`;
  const neck = `M ${n(X(0.35))} ${n(Y(0.86))} L ${n(X(0.35))} ${n(shoulderTop - h * 0.01)} Q ${n(cx)} ${n(shoulderTop + h * 0.018)} ${n(X(0.585))} ${n(shoulderTop - h * 0.01)} L ${n(X(0.585))} ${n(Y(0.86))} Z`;

  let s = `<rect width="${w}" height="${h}" fill="url(#pBg)"/>`;
  s += `<polygon points="${n(w * 0.02)},0 ${n(w * 0.34)},0 ${n(w * 0.58)},${n(h)} ${n(w * 0.1)},${n(h)}" fill="${c1}" opacity="0.05"/>`;
  s += `<circle cx="${n(cx)}" cy="${n(cy - headR * 0.12)}" r="${n(Math.min(w, h) * 0.3)}" fill="url(#pHalo)"/>`;

  for (let i = 0; i < 5; i += 1) {
    s += `<circle cx="${n(cx)}" cy="${n(cy - headR * 0.12)}" r="${n(Math.min(w, h) * (0.19 + i * 0.035))}" fill="none" stroke="${theme.ink}" stroke-opacity="${n(0.09 - i * 0.013)}" stroke-width="1"/>`;
  }

  s += `<g transform="rotate(${n(Math.sin(t * TAU) * 0.5)} ${n(cx)} ${n(h)})">`;
  defs.push(`<clipPath id="pClip"><path d="${facePath}"/><path d="${shoulders}"/><path d="${neck}"/></clipPath>`);
  s += `<path d="${shoulders}" fill="url(#pBust)"/>`;
  s += `<path d="${neck}" fill="url(#pFace)" opacity="0.92"/>`;
  s += `<path d="M ${n(cx - w * 0.2)} ${n(shoulderTop + h * 0.022)} Q ${n(cx)} ${n(shoulderTop + h * 0.06)} ${n(cx + w * 0.2)} ${n(shoulderTop + h * 0.022)}" fill="none" stroke="${theme.ink}" stroke-opacity="0.26" stroke-width="1.6"/>`;
  s += `<circle cx="${n(X(0.2))}" cy="${n(Y(0.31))}" r="${n(headR * 0.22)}" fill="url(#pHair)"/>`;
  s += `<path d="${scalp}" fill="url(#pHair)"/>`;
  s += `<path d="${facePath}" fill="url(#pFace)"/>`;
  s += `<path d="${facePath}" fill="none" stroke="${c2}" stroke-opacity="0.55" stroke-width="1.6" transform="translate(-2 -2)"/>`;

  s += `<path d="M ${n(X(0.652))} ${n(Y(0.452))} Q ${n(X(0.686))} ${n(Y(0.436))} ${n(X(0.716))} ${n(Y(0.452))}" fill="none" stroke="${theme.ink}" stroke-opacity="0.7" stroke-width="${n(Math.max(1.2, headR * 0.012))}" stroke-linecap="round"/>`;
  s += `<path d="M ${n(X(0.64))} ${n(Y(0.398))} Q ${n(X(0.682))} ${n(Y(0.382))} ${n(X(0.724))} ${n(Y(0.396))}" fill="none" stroke="${theme.ink}" stroke-opacity="0.4" stroke-width="1.4" stroke-linecap="round"/>`;
  s += `<path d="M ${n(X(0.545))} ${n(Y(0.5))} C ${n(X(0.49))} ${n(Y(0.51))} ${n(X(0.49))} ${n(Y(0.585))} ${n(X(0.55))} ${n(Y(0.575))}" fill="none" stroke="${theme.ink}" stroke-opacity="0.28" stroke-width="1.4"/>`;
  s += `<path d="M ${n(X(0.755))} ${n(Y(0.64))} Q ${n(X(0.77))} ${n(Y(0.66))} ${n(X(0.76))} ${n(Y(0.672))}" fill="none" stroke="${theme.ink}" stroke-opacity="0.3" stroke-width="1.2"/>`;

  s += `<g clip-path="url(#pClip)"><rect width="${w}" height="${h}" fill="url(#pDots)" opacity="0.34"/></g>`;
  s += `<path d="${shoulders}" fill="none" stroke="${c3}" stroke-opacity="0.2" stroke-width="1.2"/>`;
  s += `</g>`;

  const size = Math.max(9, Math.min(w, h) * 0.0125);
  const label = shortText((brandName(prompt) || 'PROFILE').toUpperCase(), 22, 'PROFILE');
  s += `<g fill="${theme.ink}" opacity="0.62" font-family="Inter, 'Segoe UI', Arial, sans-serif" font-size="${n(size)}" letter-spacing="${n(size * 0.24)}">` +
    `<text x="${n(w * 0.06)}" y="${n(h * 0.075)}">PORTRAIT / ${escapeXml(label)}</text>` +
    `<text x="${n(w - w * 0.06)}" y="${n(h * 0.075)}" text-anchor="end">${String(ctx.seed % 1000).padStart(3, '0')}</text>` +
    `</g>`;
  s += `<line x1="${n(w * 0.06)}" y1="${n(h * 0.09)}" x2="${n(w * 0.24)}" y2="${n(h * 0.09)}" stroke="${theme.ink}" stroke-opacity="0.24"/>`;

  s += vignette(theme, w, h, theme.dark ? 0.42 : 0.1);
  return s;
}

/* -------------------------------------------------------------- botanical */

function bezierPoint(p0, p1, p2, t) {
  const mt = 1 - t;
  return [
    mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0],
    mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1],
  ];
}

function leafShape(length, width) {
  return `M 0 0 C ${n(length * 0.3)} ${n(-width)} ${n(length * 0.72)} ${n(-width)} ${n(length)} 0 C ${n(length * 0.72)} ${n(width)} ${n(length * 0.3)} ${n(width)} 0 0 Z`;
}

function botanicalScene(ctx) {
  const { w, h, t, rng, theme, defs } = ctx;
  const [c0, c1, c2, c3] = theme.colors;
  defs.push(linearGradient('bBg', [[0, theme.bg], [0.6, mix(theme.bg, c1, 0.16)], [1, mix(theme.bg, c0, 0.14)]]));
  defs.push(radialGradient('bSun', [[0, c3, 0.42], [0.6, c2, 0.2], [1, c2, 0]]));
  defs.push(linearGradient('bStem', [[0, mix(c0, theme.ink, 0.35)], [1, c0]]));
  defs.push(linearGradient('bLeaf', [[0, c1], [0.55, c0], [1, theme.dark ? shade(c0, -0.4) : mix(c0, theme.bg, 0.35)]]));
  defs.push(blurFilter('bSoft', Math.min(w, h) * 0.03));

  let s = `<rect width="${w}" height="${h}" fill="url(#bBg)"/>`;
  s += `<circle cx="${n(w * 0.72)}" cy="${n(h * 0.24)}" r="${n(Math.min(w, h) * 0.24)}" fill="url(#bSun)"/>`;
  s += `<circle cx="${n(w * 0.72)}" cy="${n(h * 0.24)}" r="${n(Math.min(w, h) * 0.19)}" fill="none" stroke="${theme.ink}" stroke-opacity="0.09"/>`;

  const sway = Math.sin(t * TAU) * 0.9;
  s += `<g transform="rotate(${n(sway)} ${n(w * 0.5)} ${n(h * 1.05)})">`;

  const stems = 5;
  for (let i = 0; i < stems; i += 1) {
    const bx = w * (0.24 + 0.52 * (i / (stems - 1))) + range(rng, -w * 0.03, w * 0.03);
    const tipX = bx + range(rng, -w * 0.12, w * 0.12) + Math.sin(t * TAU + i) * w * 0.01;
    const tipY = h * (0.16 + 0.3 * rng());
    const ctrlX = bx + range(rng, -w * 0.1, w * 0.1);
    const ctrlY = h * range(rng, 0.42, 0.66);
    const p0 = [bx, h + 10];
    const p1 = [ctrlX, ctrlY];
    const p2 = [tipX, tipY];
    s += `<path d="M ${n(p0[0])} ${n(p0[1])} Q ${n(p1[0])} ${n(p1[1])} ${n(p2[0])} ${n(p2[1])}" fill="none" stroke="url(#bStem)" stroke-width="${n(Math.max(1.6, Math.min(w, h) * 0.0045))}" stroke-linecap="round"/>`;

    const leafCount = 3 + (i % 2);
    for (let k = 1; k <= leafCount; k += 1) {
      const along = 0.22 + (k / (leafCount + 1)) * 0.62;
      const pt = bezierPoint(p0, p1, p2, along);
      const side = (k + i) % 2 === 0 ? 1 : -1;
      const leafLen = Math.min(w, h) * (0.07 + 0.03 * rng());
      const leafW = leafLen * 0.36;
      const angle = side > 0 ? -38 + range(rng, -8, 8) : 38 + range(rng, -8, 8);
      s += `<g transform="translate(${n(pt[0])} ${n(pt[1])}) rotate(${n(angle)}) scale(${n(side)})">` +
        `<path d="${leafShape(leafLen, leafW)}" fill="url(#bLeaf)" opacity="0.92"/>` +
        `<path d="M 0 0 L ${n(leafLen)} 0" stroke="${theme.ink}" stroke-opacity="0.16" stroke-width="1"/>` +
        `</g>`;
    }

    const petals = 6;
    const blossomR = Math.min(w, h) * (0.032 + 0.012 * rng());
    s += `<g transform="translate(${n(tipX)} ${n(tipY)})">`;
    for (let p = 0; p < petals; p += 1) {
      const angle = (p / petals) * 360 + t * 12;
      s += `<ellipse cx="0" cy="${n(-blossomR * 0.9)}" rx="${n(blossomR * 0.44)}" ry="${n(blossomR * 0.8)}" fill="${p % 2 ? c1 : c3}" opacity="0.92" transform="rotate(${n(angle)})"/>`;
    }
    s += `<circle cx="0" cy="0" r="${n(blossomR * 0.36)}" fill="${theme.ink}"/>`;
    s += `</g>`;
  }

  s += `</g>`;

  for (let i = 0; i < 22; i += 1) {
    const x = rng() * w;
    const y = rng() * h;
    const r = range(rng, 1, Math.min(w, h) * 0.0035);
    s += `<circle cx="${n(x)}" cy="${n(y + Math.sin(t * TAU + i) * 6)}" r="${n(r)}" fill="${c3}" opacity="${n(0.2 + 0.3 * rng())}"/>`;
  }

  s += `<ellipse cx="${n(w * 0.5)}" cy="${n(h * 1.02)}" rx="${n(w * 0.6)}" ry="${n(h * 0.1)}" fill="${theme.ink}" opacity="0.06" filter="url(#bSoft)"/>`;
  s += vignette(theme, w, h, theme.dark ? 0.35 : 0.1);
  return s;
}

/* ---------------------------------------------------------------- product */

function productScene(ctx) {
  const { w, h, t, rng, theme, defs, prompt } = ctx;
  const [c0, c1, c2, c3] = theme.colors;
  const lower = String(prompt || '').toLowerCase();
  const object = /bottle|perfume|cosmetic|serum|drink|jar|flask/.test(lower) ? 'bottle'
    : /box|package|card|book|console/.test(lower) ? 'box' : 'pod';

  defs.push(linearGradient('prBg', [[0, mix(theme.bg, c2, theme.dark ? 0.1 : 0.18)], [0.62, mix(theme.bg, c1, 0.12)], [1, theme.dark ? shade(theme.bg, -0.3) : shade(theme.bg, -0.04)]]));
  defs.push(radialGradient('prHalo', [[0, c1, 0.55], [0.65, c0, 0.18], [1, c0, 0]]));
  defs.push(linearGradient('prFloor', [[0, mix(theme.bg, c0, 0.16)], [1, theme.dark ? shade(theme.bg, -0.35) : shade(theme.bg, -0.05)]]));
  defs.push(linearGradient('prBody', [[0, shade(c0, 0.35)], [0.42, c0], [1, shade(c0, -0.35)]]));
  defs.push(linearGradient('prGlass', [[0, '#FFFFFF', 0.75], [0.35, c2, 0.35], [0.7, c0, 0.65], [1, shade(c0, -0.3)]]));
  defs.push(blurFilter('prSoft', Math.min(w, h) * 0.045));

  let s = `<rect width="${w}" height="${h}" fill="url(#prBg)"/>`;
  s += `<circle cx="${n(w * 0.5)}" cy="${n(h * 0.42)}" r="${n(Math.min(w, h) * 0.34)}" fill="url(#prHalo)"/>`;
  s += `<path d="M 0 ${n(h * 0.72)} L ${w} ${n(h * 0.72)} L ${w} ${h} L 0 ${h} Z" fill="url(#prFloor)"/>`;
  s += `<line x1="0" y1="${n(h * 0.72)}" x2="${w}" y2="${n(h * 0.72)}" stroke="${theme.ink}" stroke-opacity="0.1"/>`;

  const float = Math.sin(t * TAU) * h * 0.008;
  const baseY = h * 0.7 + float;
  s += `<ellipse cx="${n(w * 0.5)}" cy="${n(h * 0.735)}" rx="${n(w * 0.17 - float * 2)}" ry="${n(h * 0.018)}" fill="${theme.dark ? '#000000' : theme.ink}" opacity="0.24" filter="url(#prSoft)"/>`;

  s += `<g transform="translate(${n(w * 0.5)} ${n(baseY)})">`;

  if (object === 'bottle') {
    const bw = Math.min(w, h) * 0.16;
    const bh = Math.min(w, h) * 0.3;
    s += `<rect x="${n(-bw * 0.55)}" y="${n(-bh)}" width="${n(bw * 1.1)}" height="${n(bh)}" rx="${n(bw * 0.2)}" fill="url(#prGlass)"/>`;
    s += `<rect x="${n(-bw * 0.2)}" y="${n(-bh - bh * 0.18)}" width="${n(bw * 0.4)}" height="${n(bh * 0.2)}" fill="${shade(c0, -0.2)}"/>`;
    s += `<rect x="${n(-bw * 0.26)}" y="${n(-bh - bh * 0.3)}" width="${n(bw * 0.52)}" height="${n(bh * 0.14)}" rx="${n(bw * 0.04)}" fill="${theme.ink}"/>`;
    s += `<rect x="${n(-bw * 0.36)}" y="${n(-bh * 0.62)}" width="${n(bw * 0.72)}" height="${n(bh * 0.34)}" rx="${n(bw * 0.04)}" fill="${theme.dark ? '#0E1118' : '#FFFFFF'}" opacity="0.9"/>`;
    s += `<rect x="${n(-bw * 0.24)}" y="${n(-bh * 0.52)}" width="${n(bw * 0.48)}" height="2" fill="${c0}" opacity="0.6"/>`;
    s += `<rect x="${n(-bw * 0.24)}" y="${n(-bh * 0.46)}" width="${n(bw * 0.3)}" height="1.5" fill="${theme.ink}" opacity="0.3"/>`;
    s += `<rect x="${n(-bw * 0.24)}" y="${n(-bh * 0.42)}" width="${n(bw * 0.38)}" height="1.5" fill="${theme.ink}" opacity="0.2"/>`;
    s += `<rect x="${n(-bw * 0.42)}" y="${n(-bh * 0.9)}" width="${n(bw * 0.1)}" height="${n(bh * 0.6)}" rx="${n(bw * 0.05)}" fill="#FFFFFF" opacity="0.22"/>`;
  } else if (object === 'box') {
    const r = Math.min(w, h) * 0.16;
    s += `<polygon points="0,${n(-r * 1.9)} ${n(r)},${n(-r * 1.6)} ${n(r)},${n(-r * 0.4)} 0,${n(-r * 0.7)}" fill="${shade(c0, -0.18)}"/>`;
    s += `<polygon points="0,${n(-r * 1.9)} ${n(-r)},${n(-r * 1.6)} ${n(-r)},${n(-r * 0.4)} 0,${n(-r * 0.7)}" fill="${c0}"/>`;
    s += `<polygon points="0,${n(-r * 0.7)} ${n(r)},${n(-r * 0.4)} ${n(r)},${n(r * 0.9)} 0,${n(r * 0.6)}" fill="${shade(c0, -0.4)}"/>`;
    s += `<polygon points="0,${n(-r * 0.7)} ${n(-r)},${n(-r * 0.4)} ${n(-r)},${n(r * 0.9)} 0,${n(r * 0.6)}" fill="${shade(c0, -0.24)}"/>`;
    s += `<polygon points="0,${n(-r * 1.9)} ${n(r * 0.42)},${n(-r * 1.76)} ${n(r * 0.42)},${n(-r * 1.58)} 0,${n(-r * 1.72)}" fill="${theme.ink}" opacity="0.2"/>`;
    s += `<line x1="0" y1="${n(-r * 1.9)}" x2="0" y2="${n(-r * 0.7)}" stroke="${theme.ink}" stroke-opacity="0.15"/>`;
  } else {
    const r = Math.min(w, h) * 0.155;
    s += `<circle cx="0" cy="${n(-r)}" r="${n(r)}" fill="url(#prBody)"/>`;
    s += `<ellipse cx="0" cy="${n(-r)}" rx="${n(r * 0.98)}" ry="${n(r * 0.22)}" fill="none" stroke="${c3}" stroke-width="${n(r * 0.05)}" opacity="0.8" transform="rotate(-14)"/>`;
    s += `<circle cx="${n(-r * 0.28)}" cy="${n(-r * 1.35)}" r="${n(r * 0.34)}" fill="#FFFFFF" opacity="0.16"/>`;
    s += `<circle cx="${n(r * 0.55)}" cy="${n(-r * 0.6)}" r="${n(r * 0.16)}" fill="#000000" opacity="0.15" filter="url(#prSoft)"/>`;
  }

  s += `</g>`;

  const size = Math.max(10, Math.min(w, h) * 0.014);
  const productLabel = shortText((quotedName(prompt) || ctx.title || 'OBJECT').toUpperCase(), 26, 'OBJECT');
  s += `<g fill="${theme.ink}" font-family="Inter, 'Segoe UI', Arial, sans-serif">` +
    `<text x="${n(w * 0.07)}" y="${n(h * 0.9)}" font-size="${n(size * 1.1)}" letter-spacing="${n(size * 0.3)}" fill-opacity="0.8">${escapeXml(productLabel)}</text>` +
    `<text x="${n(w * 0.07)}" y="${n(h * 0.936)}" font-size="${n(size * 0.72)}" letter-spacing="${n(size * 0.2)}" fill-opacity="0.4">STUDY ${String(ctx.seed % 100).padStart(2, '0')} — BLANK</text>` +
    `</g>`;

  const bx = w * 0.88;
  for (let i = 0; i < 12; i += 1) {
    const bw = i % 3 === 0 ? 3 : 1.2;
    s += `<rect x="${n(bx + i * 5)}" y="${n(h * 0.875)}" width="${n(bw)}" height="${n(h * 0.04)}" fill="${theme.ink}" opacity="0.55"/>`;
  }

  s += vignette(theme, w, h, theme.dark ? 0.4 : 0.1);
  return s;
}

/* ----------------------------------------------------------- architecture */

function archPath(x, y, width, height) {
  const r = width / 2;
  return `M ${n(x)} ${n(y + height)} L ${n(x)} ${n(y + r)} A ${n(r)} ${n(r)} 0 0 1 ${n(x + width)} ${n(y + r)} L ${n(x + width)} ${n(y + height)} Z`;
}

function architectureScene(ctx) {
  const { w, h, t, rng, theme, defs } = ctx;
  const [c0, c1, c2, c3] = theme.colors;
  const horizon = h * 0.68;
  const skyTop = theme.dark ? mix('#101020', c0, 0.18) : mix('#F5E9DA', c2, 0.3);
  defs.push(linearGradient('arBg', [[0, skyTop], [0.55, mix(skyTop, c1, 0.42)], [1, mix(c1, '#FFE7BC', 0.35)]]));
  defs.push(radialGradient('arSun', [[0, '#FFF6DC', 0.98], [0.35, c3, 0.5], [1, c3, 0]]));
  defs.push(linearGradient('arConcrete', [[0, mix('#DAD4C8', c1, 0.24)], [0.55, mix('#BDB6AA', c2, 0.25)], [1, mix('#83807A', c0, 0.2)]]));
  defs.push(linearGradient('arShadow', [[0, mix('#6E6A62', c0, 0.3)], [1, mix(theme.dark ? '#080A0E' : '#2C2A28', theme.bg, 0.2)]]));
  defs.push(linearGradient('arGround', [[0, mix('#9B958B', c1, 0.2)], [1, theme.dark ? '#080A0F' : '#2B2C30']]));

  let s = `<rect width="${w}" height="${h}" fill="url(#arBg)"/>`;
  const sx = w * 0.79;
  const sy = h * 0.24;
  s += `<circle cx="${n(sx)}" cy="${n(sy)}" r="${n(Math.min(w, h) * 0.3)}" fill="url(#arSun)" opacity="${n(0.82 + Math.sin(t * TAU) * 0.08)}"/>`;
  s += `<circle cx="${n(sx)}" cy="${n(sy)}" r="${n(Math.min(w, h) * 0.058)}" fill="#FFF9EA"/>`;

  s += `<polygon points="${n(sx)},${n(sy)} ${n(w * 1.02)},${n(h * 0.52)} ${n(w * 1.02)},${n(horizon)} ${n(w * 0.5)},${n(horizon)}" fill="${c3}" opacity="0.1"/>`;

  s += `<rect x="0" y="${n(horizon)}" width="${w}" height="${n(h - horizon)}" fill="url(#arGround)"/>`;

  const vx = w * 0.5;
  const vy = horizon;
  for (let i = -7; i <= 7; i += 1) {
    const x = vx + (i / 7) * w * 1.2;
    s += `<line x1="${n(vx)}" y1="${n(vy)}" x2="${n(x)}" y2="${n(h)}" stroke="${theme.ink}" stroke-opacity="0.08" stroke-width="1"/>`;
  }
  for (let i = 1; i <= 4; i += 1) {
    const y = vy + Math.pow(i / 4, 1.9) * (h - vy) * 0.72;
    s += `<line x1="0" y1="${n(y)}" x2="${w}" y2="${n(y)}" stroke="${theme.ink}" stroke-opacity="0.07" stroke-width="1"/>`;
  }

  const count = 4;
  const archW = w * 0.155;
  for (let i = 0; i < count; i += 1) {
    const x = w * 0.11 + i * (archW + w * 0.045);
    const height = h * (0.29 + (i === 1 ? 0.06 : 0) - (i % 2) * 0.02);
    const y = horizon - height;
    s += `<path d="${archPath(x - archW * 0.055, y + h * 0.004, archW, height)}" fill="url(#arShadow)" opacity="0.55"/>`;
    s += `<path d="${archPath(x, y, archW, height)}" fill="url(#arConcrete)"/>`;
    s += `<path d="${archPath(x + archW * 0.24, y + archW * 0.24, archW * 0.52, height - archW * 0.24)}" fill="url(#arShadow)"/>`;
    s += `<path d="${archPath(x + archW * 0.24, y + archW * 0.24, archW * 0.52, height - archW * 0.24)}" fill="none" stroke="${theme.ink}" stroke-opacity="0.28" stroke-width="2"/>`;
    s += `<rect x="${n(x - archW * 0.03)}" y="${n(y + height - h * 0.012)}" width="${n(archW * 1.06)}" height="${n(h * 0.018)}" fill="${theme.ink}" opacity="0.16"/>`;
    s += `<line x1="${n(x + archW * 0.08)}" y1="${n(y + archW * 0.5)}" x2="${n(x + archW * 0.08)}" y2="${n(horizon - h * 0.02)}" stroke="#FFFFFF" stroke-opacity="0.1"/>`;
    s += `<line x1="${n(x + archW * 0.92)}" y1="${n(y + archW * 0.5)}" x2="${n(x + archW * 0.92)}" y2="${n(horizon - h * 0.02)}" stroke="${theme.ink}" stroke-opacity="0.18"/>`;
    if (i < count - 1) {
      const px = x + archW + w * 0.012;
      s += `<rect x="${n(px)}" y="${n(horizon - height * 0.82)}" width="${n(w * 0.014)}" height="${n(height * 0.82)}" fill="url(#arConcrete)" opacity="0.9"/>`;
      s += `<rect x="${n(px + w * 0.009)}" y="${n(horizon - height * 0.82)}" width="${n(w * 0.005)}" height="${n(height * 0.82)}" fill="${theme.ink}" opacity="0.22"/>`;
    }
  }

  for (let i = 0; i < 3; i += 1) {
    const stepW = w * (0.52 + i * 0.14);
    const stepY = h * (0.78 + i * 0.062);
    const stepH = h * 0.062;
    s += `<rect x="${n((w - stepW) / 2)}" y="${n(stepY)}" width="${n(stepW)}" height="${n(stepH)}" fill="${mix('#BDB6AA', c1, 0.25)}"/>`;
    s += `<rect x="${n((w - stepW) / 2)}" y="${n(stepY)}" width="${n(stepW)}" height="${n(stepH * 0.14)}" fill="#FFFFFF" opacity="0.12"/>`;
    s += `<rect x="${n((w - stepW) / 2)}" y="${n(stepY + stepH * 0.82)}" width="${n(stepW)}" height="${n(stepH * 0.18)}" fill="${theme.ink}" opacity="0.2"/>`;
  }

  for (let i = 0; i < 5; i += 1) {
    const x = w * (0.06 + i * 0.2);
    s += `<rect x="${n(x)}" y="${n(horizon + h * 0.06 + (i % 2) * h * 0.02)}" width="${n(w * 0.12)}" height="${n(h * 0.014)}" fill="${theme.ink}" opacity="0.07"/>`;
  }

  const birds = 4;
  for (let i = 0; i < birds; i += 1) {
    const bx = w * (0.2 + i * 0.09) + Math.sin(t * TAU + i) * w * 0.012;
    const by = h * (0.14 + (i % 3) * 0.03);
    const bs = h * 0.006;
    s += `<path d="M ${n(bx - bs)} ${n(by)} Q ${n(bx - bs / 2)} ${n(by - bs)} ${n(bx)} ${n(by)} Q ${n(bx + bs / 2)} ${n(by - bs)} ${n(bx + bs)} ${n(by)}" fill="none" stroke="${theme.ink}" stroke-opacity="0.35" stroke-width="1.2"/>`;
  }

  s += vignette(theme, w, h, theme.dark ? 0.35 : 0.18);
  return s;
}

/* ------------------------------------------------------------------- mark */

function markScene(ctx) {
  const { w, h, t, rng, theme, defs, prompt } = ctx;
  const [c0, c1, c2, c3] = theme.colors;
  const cx = w * 0.5;
  const cy = h * 0.42;
  const r = Math.min(w, h) * 0.16;
  const variant = ctx.seed % 3;
  const brand = (brandName(prompt) || ctx.brand || ctx.title.split(' ')[0] || 'BLANK').toUpperCase().slice(0, 18);

  defs.push(linearGradient('mBg', [[0, theme.bg], [1, mix(theme.bg, c1, theme.dark ? 0.08 : 0.16)]]));
  defs.push(linearGradient('mAccent', [[0, c0], [1, mix(c0, c2, 0.55)], [1, c1]]));

  let s = `<rect width="${w}" height="${h}" fill="url(#mBg)"/>`;

  const step = Math.min(w, h) * 0.08;
  for (let x = step; x < w; x += step) {
    for (let y = step; y < h; y += step) {
      s += `<circle cx="${n(x)}" cy="${n(y)}" r="0.9" fill="${theme.ink}" opacity="0.1"/>`;
    }
  }
  s += `<line x1="${n(cx)}" y1="${n(h * 0.08)}" x2="${n(cx)}" y2="${n(h * 0.76)}" stroke="${theme.ink}" stroke-opacity="0.07"/>`;
  s += `<line x1="${n(w * 0.08)}" y1="${n(cy)}" x2="${n(w * 0.92)}" y2="${n(cy)}" stroke="${theme.ink}" stroke-opacity="0.07"/>`;

  for (let i = 0; i < 4; i += 1) {
    const cornerX = i % 2 === 0 ? w * 0.06 : w * 0.94;
    const cornerY = i < 2 ? h * 0.07 : h * 0.82;
    s += `<path d="M ${n(cornerX - 8)} ${n(cornerY)} L ${n(cornerX + 8)} ${n(cornerY)} M ${n(cornerX)} ${n(cornerY - 8)} L ${n(cornerX)} ${n(cornerY + 8)}" stroke="${theme.ink}" stroke-opacity="0.25"/>`;
  }

  s += `<g transform="rotate(${n(Math.sin(t * TAU) * 2)} ${n(cx)} ${n(cy)})">`;
  if (variant === 0) {
    s += `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="none" stroke="url(#mAccent)" stroke-width="${n(r * 0.09)}"/>`;
    s += `<path d="M ${n(cx)} ${n(cy - r)} A ${n(r)} ${n(r)} 0 0 1 ${n(cx)} ${n(cy + r)} Z" fill="url(#mAccent)" opacity="0.9"/>`;
    s += `<circle cx="${n(cx + r * 0.42)}" cy="${n(cy)}" r="${n(r * 0.16)}" fill="${theme.bg}"/>`;
    s += `<circle cx="${n(cx + r * 0.42)}" cy="${n(cy)}" r="${n(r * 0.05)}" fill="${c3}"/>`;
  } else if (variant === 1) {
    s += `<rect x="${n(cx - r * 0.78)}" y="${n(cy - r * 0.78)}" width="${n(r * 1.56)}" height="${n(r * 1.56)}" rx="${n(r * 0.24)}" fill="url(#mAccent)" transform="rotate(45 ${n(cx)} ${n(cy)})"/>`;
    s += `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r * 0.52)}" fill="${theme.bg}"/>`;
    s += `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r * 0.3)}" fill="url(#mAccent)"/>`;
    s += `<circle cx="${n(cx + r * 0.82)}" cy="${n(cy - r * 0.82)}" r="${n(r * 0.11)}" fill="${c3}"/>`;
  } else {
    s += `<path d="M ${n(cx - r)} ${n(cy + r * 0.55)} A ${n(r)} ${n(r)} 0 0 1 ${n(cx + r)} ${n(cy + r * 0.55)}" fill="none" stroke="url(#mAccent)" stroke-width="${n(r * 0.12)}" stroke-linecap="round"/>`;
    s += `<path d="M ${n(cx - r * 0.55)} ${n(cy + r * 0.55)} A ${n(r * 0.55)} ${n(r * 0.55)} 0 0 1 ${n(cx + r * 0.55)} ${n(cy + r * 0.55)}" fill="none" stroke="${c3}" stroke-width="${n(r * 0.12)}" stroke-linecap="round"/>`;
    s += `<circle cx="${n(cx)}" cy="${n(cy - r * 0.35)}" r="${n(r * 0.18)}" fill="url(#mAccent)"/>`;
  }
  s += `</g>`;

  const brandSize = Math.min(w, h) * 0.058;
  s += `<text x="${n(cx)}" y="${n(h * 0.68)}" text-anchor="middle" fill="${theme.ink}" font-family="Inter, 'Segoe UI', Arial, sans-serif" font-size="${n(brandSize)}" font-weight="600" letter-spacing="${n(brandSize * 0.34)}">${escapeXml(brand)}</text>`;
  const subSize = brandSize * 0.28;
  s += `<text x="${n(cx)}" y="${n(h * 0.68 + brandSize * 0.62)}" text-anchor="middle" fill="${theme.ink}" fill-opacity="0.45" font-family="Inter, 'Segoe UI', Arial, sans-serif" font-size="${n(subSize)}" letter-spacing="${n(subSize * 0.4)}">IDENTITY / ${String(ctx.seed % 1000).padStart(3, '0')}</text>`;

  s += `<text x="${n(w * 0.06)}" y="${n(h * 0.06)}" fill="${theme.ink}" fill-opacity="0.45" font-family="Inter, 'Segoe UI', Arial, sans-serif" font-size="${n(Math.min(w, h) * 0.014)}" letter-spacing="${n(Math.min(w, h) * 0.004)}">BLANK / MARK</text>`;
  s += `<text x="${n(w * 0.94)}" y="${n(h * 0.06)}" text-anchor="end" fill="${theme.ink}" fill-opacity="0.45" font-family="Inter, 'Segoe UI', Arial, sans-serif" font-size="${n(Math.min(w, h) * 0.014)}" letter-spacing="${n(Math.min(w, h) * 0.004)}">${String(ctx.seed % 1000).padStart(3, '0')}</text>`;

  s += vignette(theme, w, h, theme.dark ? 0.35 : 0.08);
  return s;
}

/* ------------------------------------------------------------------- grid */

function gridScene(ctx) {
  const { w, h, t, theme, defs, prompt } = ctx;
  const [c0, c1, c2, c3] = theme.colors;
  const margin = w * 0.07;
  const title = (quotedName(prompt) || ctx.title || 'NEW FORM').toUpperCase();
  const lines = wrapWords(title, 13, 4);
  const titleSize = Math.min(w * 0.09, (h * 0.34) / Math.max(1.15, lines.length));
  const lineHeight = titleSize * 1.01;

  defs.push(linearGradient('gBg', [[0, theme.bg], [1, mix(theme.bg, c2, theme.dark ? 0.05 : 0.12)]]));
  defs.push(radialGradient('gCircle', [[0, c0], [1, mix(c0, c3, 0.4)]]));

  let s = `<rect width="${w}" height="${h}" fill="url(#gBg)"/>`;

  const size = Math.max(9, Math.min(w, h) * 0.0125);
  s += `<text x="${n(margin)}" y="${n(h * 0.085)}" fill="${theme.ink}" fill-opacity="0.8" font-family="Inter, 'Segoe UI', Arial, sans-serif" font-size="${n(size)}" font-weight="600" letter-spacing="${n(size * 0.22)}">BLANK GENERATIVE SERIES</text>`;
  s += `<text x="${n(w - margin)}" y="${n(h * 0.085)}" text-anchor="end" fill="${theme.ink}" fill-opacity="0.8" font-family="Inter, 'Segoe UI', Arial, sans-serif" font-size="${n(size)}" letter-spacing="${n(size * 0.22)}">№ ${String((ctx.seed % 900) + 100)}</text>`;
  s += `<line x1="${n(margin)}" y1="${n(h * 0.105)}" x2="${n(w - margin)}" y2="${n(h * 0.105)}" stroke="${theme.ink}" stroke-opacity="0.22"/>`;

  let ty = h * 0.21;
  for (const line of lines) {
    s += `<text x="${n(margin)}" y="${n(ty)}" fill="${theme.ink}" font-family="Inter, 'Segoe UI', Arial, sans-serif" font-size="${n(titleSize)}" font-weight="700" letter-spacing="${n(-titleSize * 0.03)}">${escapeXml(line)}</text>`;
    ty += lineHeight;
  }

  const circleR = Math.min(w, h) * 0.13;
  const orbit = t * TAU;
  const ccx = w * 0.755 + Math.cos(orbit) * w * 0.01;
  const ccy = h * 0.565 + Math.sin(orbit) * h * 0.01;
  s += `<rect x="${n(w - margin - w * 0.018)}" y="${n(h * 0.44)}" width="${n(w * 0.018)}" height="${n(h * 0.2)}" fill="${c3}" opacity="0.9"/>`;
  s += `<circle cx="${n(ccx)}" cy="${n(ccy)}" r="${n(circleR * 1.55)}" fill="none" stroke="${theme.ink}" stroke-opacity="0.12" stroke-dasharray="1 7" stroke-width="1.2"/>`;
  s += `<circle cx="${n(ccx)}" cy="${n(ccy)}" r="${n(circleR)}" fill="url(#gCircle)"/>`;
  s += `<circle cx="${n(ccx)}" cy="${n(ccy)}" r="${n(circleR * 0.4)}" fill="none" stroke="${theme.bg}" stroke-opacity="0.5" stroke-width="${n(circleR * 0.03)}"/>`;

  s += `<rect x="${n(margin)}" y="${n(h * 0.775)}" width="${n(w - margin * 2)}" height="1.4" fill="${theme.ink}" opacity="0.28"/>`;

  const colY = h * 0.815;
  const colW = (w - margin * 2) / 3;
  const columns = [
    ['PROCEDURAL', 'COMPOSITION ENGINE', 'SEED ' + String(ctx.seed % 100000).padStart(5, '0')],
    ['IMAGE', 'VIDEO', 'OBJECT'],
    ['BLANK STUDIO', new Date().getFullYear().toString(), 'SERIES 01'],
  ];
  columns.forEach((col, ci) => {
    col.forEach((text, li) => {
      s += `<text x="${n(margin + ci * colW)}" y="${n(colY + li * size * 2.1)}" fill="${theme.ink}" fill-opacity="${li === 0 ? 0.72 : 0.4}" font-family="Inter, 'Segoe UI', Arial, sans-serif" font-size="${n(size * (li === 0 ? 0.95 : 0.82))}" letter-spacing="${n(size * 0.14)}">${escapeXml(text)}</text>`;
    });
  });

  s += `<text x="${n(w - margin)}" y="${n(h * 0.955)}" text-anchor="end" fill="${theme.ink}" fill-opacity="0.3" font-family="Inter, 'Segoe UI', Arial, sans-serif" font-size="${n(size * 0.8)}" letter-spacing="${n(size * 0.18)}">SET IN INTER / GENERATED LOCALLY</text>`;

  s += `<rect x="${n(w * 0.09)}" y="${n(h * 0.12)}" width="2" height="2" fill="${c0}"/>`;
  s += `<rect x="${n(w * 0.955)}" y="${n(h * 0.9)}" width="2" height="2" fill="${c0}"/>`;

  s += vignette(theme, w, h, theme.dark ? 0.2 : 0.04);
  return s;
}

/* ------------------------------------------------------------------ waves */

function wavesScene(ctx) {
  const { w, h, t, theme, defs } = ctx;
  const [c0, c1, c2, c3] = theme.colors;
  defs.push(linearGradient('wBg', [[0, theme.dark ? shade(theme.bg, 0.03) : theme.bg], [0.6, mix(theme.bg, c1, 0.16)], [1, mix(theme.bg, c3, 0.16)]]));
  defs.push(radialGradient('wSun', [[0, c3, 0.55], [0.6, c1, 0.22], [1, c1, 0]]));
  defs.push(linearGradient('wLine', [[0, c0, 0.1], [0.4, c1, 0.95], [0.8, c0, 0.8], [1, c3, 0.15]], 0, 0, 1, 0));

  let s = `<rect width="${w}" height="${h}" fill="url(#wBg)"/>`;
  s += `<circle cx="${n(w * 0.74)}" cy="${n(h * 0.26)}" r="${n(Math.min(w, h) * 0.22)}" fill="url(#wSun)"/>`;
  s += `<circle cx="${n(w * 0.74)}" cy="${n(h * 0.26)}" r="${n(Math.min(w, h) * 0.075)}" fill="${c3}" opacity="0.75"/>`;

  const lines = 30;
  for (let i = 0; i < lines; i += 1) {
    const p = i / (lines - 1);
    const baseY = h * (0.14 + Math.pow(p, 1.28) * 0.86);
    const amp = h * (0.005 + p * 0.055);
    const freq = 1.1 + (i % 5) * 0.24;
    const phase = t * TAU * (0.6 + (i % 3) * 0.12) + i * 0.55;
    const points = [];
    for (let k = 0; k <= 26; k += 1) {
      const x = (w * k) / 26;
      const envelope = 0.35 + 0.65 * Math.sin((k / 26) * Math.PI);
      const y = baseY + Math.sin((k / 26) * TAU * freq + phase) * amp * envelope
        + Math.sin((k / 26) * TAU * freq * 2.3 + phase * 0.7) * amp * 0.22 * envelope;
      points.push([x, y]);
    }
    const opacity = 0.22 + 0.42 * (1 - Math.abs(p - 0.55) * 1.4);
    const width = i % 7 === 0 ? Math.min(w, h) * 0.004 : Math.min(w, h) * 0.0014;
    s += `<path d="${catmullPath(points)}" fill="none" stroke="url(#wLine)" stroke-width="${n(width)}" opacity="${n(clamp(opacity, 0.12, 0.75))}"/>`;
  }

  s += `<g opacity="0.6">`;
  for (let i = 0; i < 3; i += 1) {
    const bx = w * (0.16 + i * 0.07);
    const by = h * (0.16 + i * 0.035);
    const bs = h * 0.006;
    s += `<path d="M ${n(bx - bs)} ${n(by)} Q ${n(bx - bs / 2)} ${n(by - bs)} ${n(bx)} ${n(by)} Q ${n(bx + bs / 2)} ${n(by - bs)} ${n(bx + bs)} ${n(by)}" fill="none" stroke="${theme.ink}" stroke-width="1.2"/>`;
  }
  s += `</g>`;

  s += `<text x="${n(w * 0.06)}" y="${n(h * 0.95)}" fill="${theme.ink}" fill-opacity="0.35" font-family="Inter, 'Segoe UI', Arial, sans-serif" font-size="${n(Math.min(w, h) * 0.013)}" letter-spacing="${n(Math.min(w, h) * 0.005)}">${escapeXml(shortText((ctx.title || 'FREQUENCY').toUpperCase(), 38, 'FREQUENCY'))}</text>`;

  s += vignette(theme, w, h, theme.dark ? 0.4 : 0.08);
  return s;
}

const SCENES = {
  aurora: auroraScene,
  cosmic: cosmicScene,
  landscape: landscapeScene,
  portrait: portraitScene,
  botanical: botanicalScene,
  product: productScene,
  architecture: architectureScene,
  mark: markScene,
  grid: gridScene,
  waves: wavesScene,
};

function renderScene(options = {}) {
  const prompt = String(options.prompt || '');
  const width = clamp(Math.round(Number(options.width) || 1024), 64, 4096);
  const height = clamp(Math.round(Number(options.height) || 1024), 64, 4096);
  const seed = Number.isFinite(Number(options.seed)) ? Number(options.seed) >>> 0 : hashString(prompt || 'blank');
  const time = clamp(Number(options.time ?? 0.5), 0, 1);
  const themeInfo = resolveTheme(prompt, seed, options.style, options.palette);
  const rng = mulberry32(seed ^ 0x9e3779b9 ^ Math.floor(time * 0xffff));
  const defs = [];
  const ctx = {
    w: width,
    h: height,
    t: time,
    rng,
    theme: themeInfo.palette,
    defs,
    prompt,
    title: themeInfo.title,
    brand: themeInfo.brand,
    seed,
  };
  const scene = SCENES[themeInfo.style] || auroraScene;
  let body = scene(ctx);

  if (options.grain !== false) defs.push(GRAIN_FILTER);
  const grain = options.grain !== false
    ? `<rect width="${width}" height="${height}" filter="url(#grainF)" opacity="0.5" style="mix-blend-mode:overlay"/>`
    : '';

  const background = themeInfo.palette.dark ? themeInfo.palette.bg : '#FFFFFF';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none">` +
    `<rect width="${width}" height="${height}" fill="${background}"/>` +
    `<defs>${defs.join('')}</defs>` +
    body +
    grain +
    `</svg>`;
}

const STYLES = Object.entries(STYLE_LABELS).map(([id, label]) => ({ id, label }));
const PALETTE_LIST = Object.values(PALETTES).map(({ id, name, dark, bg, colors }) => ({ id, name, dark, bg, colors }));

module.exports = {
  PALETTES, PALETTE_LIST, STYLES, STYLE_LABELS,
  renderScene, resolveTheme, detectStyle, choosePalette, getPalette,
};
