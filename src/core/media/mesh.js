'use strict';

const {
  hashString, mulberry32, pick, range, clamp, escapeXml, shade, mix, titleFromPrompt, safeName,
} = require('./util');
const { PALETTES, STYLE_LABELS, resolveTheme } = require('./visual');

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

const KINDS = [
  { id: 'vase', label: 'Vessel', words: ['vase', 'bottle', 'pot', 'vessel', 'urn', 'ceramic', 'perfume'] },
  { id: 'torus', label: 'Torus', words: ['torus', 'ring', 'donut', 'loop', 'torus knot', 'band'] },
  { id: 'knot', label: 'Knot', words: ['knot', 'trefoil', 'twist', 'ribbon', 'sculpture', 'abstract shape'] },
  { id: 'crystal', label: 'Crystal', words: ['crystal', 'gem', 'diamond', 'shard', 'quartz', 'jewel', 'icosahedron'] },
  { id: 'terrain', label: 'Terrain', words: ['terrain', 'mountain', 'island', 'landscape', 'topography', 'hill', 'planet surface'] },
  { id: 'rocket', label: 'Rocket', words: ['rocket', 'spaceship', 'spacecraft', 'ship', 'missile', 'shuttle', 'launch'] },
  { id: 'planet', label: 'Planet', words: ['planet', 'saturn', 'sphere', 'globe', 'moon', 'orbit'] },
  { id: 'chair', label: 'Chair', words: ['chair', 'seat', 'furniture', 'stool', 'armchair'] },
  { id: 'arch', label: 'Arch', words: ['arch', 'gate', 'monument', 'portal', 'door', 'temple'] },
  { id: 'shell', label: 'Shell', words: ['shell', 'spiral', 'helix', 'horn', 'snail', 'tower'] },
];

const QUALITY = { low: 0.55, medium: 1, high: 1.6 };

function n(value) {
  return Math.round(Number(value) * 10000) / 10000;
}

function createMesh() {
  return { vertices: [], triangles: [], groups: [] };
}

function addGroup(mesh, name, color) {
  mesh.groups.push({ name, color, faceStart: mesh.triangles.length, faceCount: 0 });
  return mesh.groups.length - 1;
}

function addVertex(mesh, x, y, z) {
  mesh.vertices.push([x, y, z]);
  return mesh.vertices.length - 1;
}

function addTri(mesh, a, b, c, group) {
  if (a === b || b === c || a === c) return;
  mesh.triangles.push({ a, b, c, group });
  mesh.groups[group].faceCount += 1;
}

function addQuad(mesh, a, b, c, d, group) {
  addTri(mesh, a, b, c, group);
  addTri(mesh, a, c, d, group);
}

function addBox(mesh, group, cx, cy, cz, sx, sy, sz) {
  const hx = sx / 2;
  const hy = sy / 2;
  const hz = sz / 2;
  const base = mesh.vertices.length;
  const corners = [
    [cx - hx, cy - hy, cz - hz], [cx + hx, cy - hy, cz - hz],
    [cx + hx, cy + hy, cz - hz], [cx - hx, cy + hy, cz - hz],
    [cx - hx, cy - hy, cz + hz], [cx + hx, cy - hy, cz + hz],
    [cx + hx, cy + hy, cz + hz], [cx - hx, cy + hy, cz + hz],
  ];
  corners.forEach((v) => addVertex(mesh, v[0], v[1], v[2]));
  addQuad(mesh, base, base + 1, base + 2, base + 3, group);
  addQuad(mesh, base + 5, base + 4, base + 7, base + 6, group);
  addQuad(mesh, base + 4, base + 5, base + 1, base + 0, group);
  addQuad(mesh, base + 3, base + 2, base + 6, base + 7, group);
  addQuad(mesh, base + 4, base + 0, base + 3, base + 7, group);
  addQuad(mesh, base + 1, base + 5, base + 6, base + 2, group);
}

function addCylinder(mesh, group, cx, cy, cz, radius, height, segments, options = {}) {
  const rings = [];
  const rTop = options.rTop ?? radius;
  const rBottom = options.rBottom ?? radius;
  for (let yIndex = 0; yIndex < 2; yIndex += 1) {
    const ring = [];
    const r = yIndex === 0 ? rBottom : rTop;
    const y = cy + (yIndex === 0 ? -height / 2 : height / 2);
    for (let i = 0; i < segments; i += 1) {
      const angle = (i / segments) * TAU;
      ring.push(addVertex(mesh, cx + Math.cos(angle) * r, y, cz + Math.sin(angle) * r));
    }
    rings.push(ring);
  }
  for (let i = 0; i < segments; i += 1) {
    const next = (i + 1) % segments;
    addQuad(mesh, rings[0][i], rings[0][next], rings[1][next], rings[1][i], group);
  }
  if (options.cap !== false) {
    const bottomCenter = addVertex(mesh, cx, cy - height / 2, cz);
    const topCenter = addVertex(mesh, cx, cy + height / 2, cz);
    for (let i = 0; i < segments; i += 1) {
      const next = (i + 1) % segments;
      addTri(mesh, bottomCenter, rings[0][next], rings[0][i], group);
      addTri(mesh, topCenter, rings[1][i], rings[1][next], group);
    }
  }
}

function addSphere(mesh, group, cx, cy, cz, radius, segments = 36, rings = 22, scaleY = 1) {
  const grid = [];
  for (let r = 0; r <= rings; r += 1) {
    const phi = (r / rings) * Math.PI;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    const row = [];
    for (let s = 0; s < segments; s += 1) {
      const theta = (s / segments) * TAU;
      const x = cx + Math.cos(theta) * radius * sinPhi;
      const y = cy + Math.cos(phi) * radius * scaleY;
      const z = cz + Math.sin(theta) * radius * sinPhi;
      row.push(addVertex(mesh, x, y, z));
    }
    grid.push(row);
  }
  for (let r = 0; r < rings; r += 1) {
    for (let s = 0; s < segments; s += 1) {
      const next = (s + 1) % segments;
      addQuad(mesh, grid[r][s], grid[r][next], grid[r + 1][next], grid[r + 1][s], group);
    }
  }
}

function addParametric(mesh, group, fn, uSegments, vSegments, closeU = true) {
  const rows = [];
  for (let u = 0; u <= uSegments; u += 1) {
    const row = [];
    for (let v = 0; v <= vSegments; v += 1) {
      const point = fn(u / uSegments, v / vSegments);
      row.push(addVertex(mesh, point[0], point[1], point[2]));
    }
    rows.push(row);
  }
  const uLimit = uSegments;
  for (let u = 0; u < uLimit; u += 1) {
    for (let v = 0; v < vSegments; v += 1) {
      const u2 = (u + 1) % (uSegments + 1);
      addQuad(mesh, rows[u][v], rows[u][v + 1], rows[u2][v + 1], rows[u2][v], group);
    }
  }
  return rows;
}

function buildVase(mesh, rng, palette, qf) {
  const seg = Math.round(52 * qf);
  const rings = Math.round(38 * qf);
  const height = 3.3;
  const body = addGroup(mesh, 'body', palette[0]);
  const rim = addGroup(mesh, 'rim', shade(palette[0], -0.25));
  const inner = addGroup(mesh, 'interior', mix(palette[0], '#111111', 0.75));
  const outerRows = [];
  for (let r = 0; r <= rings; r += 1) {
    const v = r / rings;
    const wobble = 1 + 0.035 * Math.sin(v * Math.PI * 9 + rng() * 0.4);
    const profile = 0.52 + 0.8 * Math.sin(Math.PI * (0.08 + v * 0.86)) + 0.1 * Math.sin(v * Math.PI * 5.2);
    const radius = Math.max(0.24, profile) * wobble;
    const y = v * height;
    const row = [];
    for (let s = 0; s < seg; s += 1) {
      const angle = (s / seg) * TAU;
      row.push(addVertex(mesh, Math.cos(angle) * radius, y, Math.sin(angle) * radius));
    }
    outerRows.push(row);
  }
  for (let r = 0; r < rings; r += 1) {
    for (let s = 0; s < seg; s += 1) {
      const next = (s + 1) % seg;
      addQuad(mesh, outerRows[r][s], outerRows[r][next], outerRows[r + 1][next], outerRows[r + 1][s], body);
    }
  }
  const bottomCenter = addVertex(mesh, 0, 0, 0);
  for (let s = 0; s < seg; s += 1) {
    const next = (s + 1) % seg;
    addTri(mesh, bottomCenter, outerRows[0][next], outerRows[0][s], body);
  }
  const topRadius = 0.45;
  const innerTop = [];
  const innerLow = [];
  const topY = height;
  for (let s = 0; s < seg; s += 1) {
    const angle = (s / seg) * TAU;
    innerTop.push(addVertex(mesh, Math.cos(angle) * topRadius, topY, Math.sin(angle) * topRadius));
    innerLow.push(addVertex(mesh, Math.cos(angle) * (topRadius - 0.06), topY - 0.55, Math.sin(angle) * (topRadius - 0.06)));
  }
  for (let s = 0; s < seg; s += 1) {
    const next = (s + 1) % seg;
    addQuad(mesh, outerRows[rings][s], outerRows[rings][next], innerTop[next], innerTop[s], rim);
    addQuad(mesh, innerTop[s], innerTop[next], innerLow[next], innerLow[s], inner);
  }
  const innerCenter = addVertex(mesh, 0, topY - 0.58, 0);
  for (let s = 0; s < seg; s += 1) {
    const next = (s + 1) % seg;
    addTri(mesh, innerCenter, innerLow[s], innerLow[next], inner);
  }
  return { height, caption: 'VESSEL' };
}

function buildTorus(mesh, rng, palette, qf) {
  const seg = Math.round(56 * qf);
  const tube = Math.round(28 * qf);
  const R = 1.25 + rng() * 0.1;
  const r = 0.42 + rng() * 0.08;
  const body = addGroup(mesh, 'torus', palette[0]);
  addParametric(mesh, body, (u, v) => {
    const a = u * TAU;
    const b = v * TAU;
    return [
      (R + r * Math.cos(b)) * Math.cos(a),
      r * Math.sin(b) * 1.25 + 1.25,
      (R + r * Math.cos(b)) * Math.sin(a),
    ];
  }, seg, tube);
  return { height: 3, caption: 'TORUS' };
}

function buildKnot(mesh, rng, palette, qf) {
  const seg = Math.round(150 * qf);
  const tube = Math.round(20 * qf);
  const group = addGroup(mesh, 'knot', palette[0]);
  const twist = rng() * 0.6;
  const scale = 1.1;
  const curve = (u) => {
    const a = u * TAU;
    return [
      (Math.sin(a + twist) + 2 * Math.sin(2 * a)) * 0.42 * scale,
      (Math.cos(a) - 2 * Math.cos(2 * a)) * 0.42 * scale + 1.8,
      (-Math.sin(3 * a)) * 0.42 * scale,
    ];
  };
  const tangent = (u) => {
    const eps = 0.0005;
    const a = curve(Math.max(0, u - eps));
    const b = curve(Math.min(1, u + eps));
    return [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  };
  const normalize = (v) => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  addParametric(mesh, group, (u, v) => {
    const p = curve(u);
    const t = normalize(tangent(u));
    const up = Math.abs(t[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
    const n1 = normalize([t[1] * up[2] - t[2] * up[1], t[2] * up[0] - t[0] * up[2], t[0] * up[1] - t[1] * up[0]]);
    const n2 = normalize([t[1] * n1[2] - t[2] * n1[1], t[2] * n1[0] - t[0] * n1[2], t[0] * n1[1] - t[1] * n1[0]]);
    const angle = v * TAU;
    const r = 0.28 * (1 + 0.16 * Math.sin(u * TAU * 3));
    return [
      p[0] + (n1[0] * Math.cos(angle) + n2[0] * Math.sin(angle)) * r,
      p[1] + (n1[1] * Math.cos(angle) + n2[1] * Math.sin(angle)) * r,
      p[2] + (n1[2] * Math.cos(angle) + n2[2] * Math.sin(angle)) * r,
    ];
  }, seg, tube);
  return { height: 3, caption: 'KNOT' };
}

function buildCrystal(mesh, rng, palette, qf) {
  const body = addGroup(mesh, 'crystal', palette[0]);
  const facet = addGroup(mesh, 'facet', shade(palette[0], 0.35));
  const base = addGroup(mesh, 'base', mix(palette[0], '#101014', 0.62));
  const sides = 6;
  const radius = 0.95 + rng() * 0.15;
  const upper = [];
  const lower = [];
  const shoulder = [];
  for (let i = 0; i < sides; i += 1) {
    const a = (i / sides) * TAU;
    upper.push(addVertex(mesh, Math.cos(a) * radius, 1.35, Math.sin(a) * radius));
    shoulder.push(addVertex(mesh, Math.cos(a) * radius * 1.22, 0.75, Math.sin(a) * radius * 1.22));
    lower.push(addVertex(mesh, Math.cos(a) * radius * 0.72, 0.15, Math.sin(a) * radius * 0.72));
  }
  const top = addVertex(mesh, 0.1, 3.15, 0.05);
  const bottom = addVertex(mesh, 0, -0.75, 0);
  for (let i = 0; i < sides; i += 1) {
    const next = (i + 1) % sides;
    addTri(mesh, top, upper[i], upper[next], facet);
    addQuad(mesh, upper[i], upper[next], shoulder[next], shoulder[i], i % 2 ? body : facet);
    addQuad(mesh, shoulder[i], shoulder[next], lower[next], lower[i], body);
    addTri(mesh, bottom, lower[next], lower[i], base);
  }
  const r2 = 0.32;
  const smallTop = addVertex(mesh, 1.65, 1.35, 0.6);
  const ring2 = [];
  for (let i = 0; i < sides; i += 1) {
    const a = (i / sides) * TAU + 0.4;
    ring2.push(addVertex(mesh, 1.65 + Math.cos(a) * r2, 0.25, 0.6 + Math.sin(a) * r2));
  }
  for (let i = 0; i < sides; i += 1) {
    const next = (i + 1) % sides;
    addTri(mesh, smallTop, ring2[i], ring2[next], facet);
  }
  return { height: 3.9, caption: 'CRYSTAL' };
}

function valueNoise(seed) {
  const hash = (x, y) => {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const smooth = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = smooth(x - xi);
    const yf = smooth(y - yi);
    const a = hash(xi, yi);
    const b = hash(xi + 1, yi);
    const c = hash(xi, yi + 1);
    const d = hash(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
}

function buildTerrain(mesh, rng, palette, qf) {
  const seg = Math.round(38 * qf);
  const size = 3.6;
  const noise = valueNoise((rng() * 1e9) | 0);
  const ground = addGroup(mesh, 'terrain', mix(palette[0], '#8A8F7A', 0.35));
  const rock = addGroup(mesh, 'summit', mix(palette[0], '#F2F0E8', 0.4));
  const skirt = addGroup(mesh, 'base', mix(palette[0], '#2A2C2E', 0.55));
  const heights = [];
  const rows = [];
  for (let r = 0; r <= seg; r += 1) {
    const row = [];
    for (let c = 0; c <= seg; c += 1) {
      const u = c / seg;
      const v = r / seg;
      let h = 0;
      let amp = 1;
      let freq = 2.1;
      for (let o = 0; o < 4; o += 1) {
        h += noise(u * freq + o * 7.3, v * freq - o * 3.1) * amp;
        amp *= 0.5;
        freq *= 2.05;
      }
      h = Math.pow(h, 1.4) * 1.6;
      const falloff = Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
      h *= 0.35 + falloff * 0.9;
      const x = (u - 0.5) * size;
      const z = (v - 0.5) * size;
      heights.push(h);
      row.push(addVertex(mesh, x, h + 0.15, z));
    }
    rows.push(row);
  }
  for (let r = 0; r < seg; r += 1) {
    for (let c = 0; c < seg; c += 1) {
      const a = rows[r][c];
      const b = rows[r][c + 1];
      const d = rows[r + 1][c + 1];
      const e = rows[r + 1][c];
      const h = (heights[r * (seg + 1) + c] + heights[r * (seg + 1) + c + 1] + heights[(r + 1) * (seg + 1) + c]) / 3;
      const group = h > 1.15 ? rock : ground;
      addQuad(mesh, a, b, d, e, group);
    }
  }
  const bottom = addVertex(mesh, 0, -0.4, 0);
  const edge = [];
  for (let c = 0; c <= seg; c += 1) edge.push(rows[0][c]);
  for (let r = 1; r <= seg; r += 1) edge.push(rows[r][seg]);
  for (let c = seg - 1; c >= 0; c -= 1) edge.push(rows[seg][c]);
  for (let r = seg - 1; r >= 0; r -= 1) edge.push(rows[r][0]);
  for (let i = 0; i < edge.length; i += 1) {
    const next = (i + 1) % edge.length;
    addTri(mesh, bottom, edge[next], edge[i], skirt);
  }
  return { height: 3, caption: 'TERRAIN' };
}

function buildRocket(mesh, rng, palette, qf) {
  const seg = Math.round(36 * qf);
  const body = addGroup(mesh, 'hull', mix(palette[0], '#FFFFFF', 0.18));
  const accent = addGroup(mesh, 'fins', palette[2] || mix(palette[0], '#FFFFFF', 0.5));
  const dark = addGroup(mesh, 'nozzle', mix(palette[0], '#101014', 0.7));
  const glass = addGroup(mesh, 'window', mix(palette[0], '#8FD4FF', 0.6));
  addCylinder(mesh, body, 0, 1.5, 0, 0.62, 2.4, seg, { rTop: 0.58, cap: false });
  const noseBase = [];
  const noseTip = addVertex(mesh, 0, 3.85, 0);
  for (let i = 0; i < seg; i += 1) {
    const a = (i / seg) * TAU;
    noseBase.push(addVertex(mesh, Math.cos(a) * 0.58, 2.7, Math.sin(a) * 0.58));
  }
  for (let i = 0; i < seg; i += 1) {
    const next = (i + 1) % seg;
    addTri(mesh, noseTip, noseBase[i], noseBase[next], body);
  }
  addCylinder(mesh, dark, 0, 0.22, 0, 0.42, 0.36, seg);
  addCylinder(mesh, glass, 0, 2.1, 0.62, 0.2, 0.12, 18, { cap: true });
  const finCount = 3;
  for (let i = 0; i < finCount; i += 1) {
    const a = (i / finCount) * TAU;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const px = -dz;
    const pz = dx;
    const p1 = addVertex(mesh, dx * 0.5, 0.75, dz * 0.5);
    const p2 = addVertex(mesh, dx * 1.25, 0.2, dz * 1.25);
    const p3 = addVertex(mesh, dx * 0.55, 0.25, dz * 0.55);
    const p4 = addVertex(mesh, dx * 0.5, 1.9, dz * 0.5);
    const p5 = addVertex(mesh, dx * 0.48, 0.9, dz * 0.48);
    const p6 = addVertex(mesh, dx * 0.95, 0.35, dz * 0.95);
    addQuad(mesh, p1, p2, p6, p5, accent);
    addQuad(mesh, p5, p6, p2, p4, accent);
    const p7 = addVertex(mesh, dx * 0.5 + px * 0.035, 1.9, dz * 0.5 + pz * 0.035);
    addTri(mesh, p1, p4, p7, accent);
  }
  return { height: 4, caption: 'LAUNCH' };
}

function buildPlanet(mesh, rng, palette, qf) {
  const seg = Math.round(42 * qf);
  const rings = Math.round(26 * qf);
  const body = addGroup(mesh, 'planet', palette[0]);
  const band = addGroup(mesh, 'bands', mix(palette[0], palette[3] || '#FFFFFF', 0.35));
  addSphere(mesh, body, 0, 1.8, 0, 1.35, seg, rings);
  const ringGroup = addGroup(mesh, 'ring', mix(palette[2] || '#D9D9D9', '#FFFFFF', 0.3));
  const tilt = 18 * DEG;
  const ringSegments = Math.round(70 * qf);
  const tube = Math.round(8 * qf);
  addParametric(mesh, ringGroup, (u, v) => {
    const a = u * TAU;
    const b = v * TAU;
    const major = 2.15;
    const minor = 0.06;
    const x = (major + minor * Math.cos(b)) * Math.cos(a);
    const z = (major + minor * Math.cos(b)) * Math.sin(a);
    const y = minor * Math.sin(b);
    return [
      x,
      1.8 + y * Math.cos(tilt) - z * Math.sin(tilt) * 0.22,
      z * Math.cos(tilt) + y * Math.sin(tilt),
    ];
  }, ringSegments, tube);
  return { height: 3.6, caption: 'ORBIT' };
}

function buildChair(mesh, rng, palette, qf) {
  const wood = addGroup(mesh, 'frame', mix(palette[3] || '#9A6B4F', '#7A5233', 0.4));
  const seat = addGroup(mesh, 'cushion', palette[0]);
  addBox(mesh, seat, 0, 1.35, 0, 2.2, 0.28, 2.05);
  addBox(mesh, wood, 0, 2.28, -0.95, 2.2, 1.7, 0.18);
  addBox(mesh, wood, -1.02, 0.65, -0.9, 0.18, 1.5, 0.18);
  addBox(mesh, wood, 1.02, 0.65, -0.9, 0.18, 1.5, 0.18);
  addBox(mesh, wood, -1.02, 0.65, 0.9, 0.18, 1.5, 0.18);
  addBox(mesh, wood, 1.02, 0.65, 0.9, 0.18, 1.5, 0.18);
  addBox(mesh, seat, 0, 2.9, -0.95, 2.0, 0.1, 0.5);
  return { height: 3.2, caption: 'SEAT' };
}

function buildArch(mesh, rng, palette, qf) {
  const stone = addGroup(mesh, 'stone', mix(palette[1] || '#C9B79C', '#D8D3C8', 0.4));
  const accent = addGroup(mesh, 'accent', palette[0]);
  const seg = Math.round(40 * qf);
  const tube = Math.round(12 * qf);
  const R = 1.15;
  const T = 0.24;
  const baseY = 1.1;
  addParametric(mesh, stone, (u, v) => {
    const a = u * Math.PI;
    const b = v * TAU;
    const radius = R + T * Math.cos(b);
    return [radius * Math.cos(a), baseY + radius * Math.sin(a), T * Math.sin(b)];
  }, seg, tube, false);
  addBox(mesh, stone, -R, baseY / 2, 0, 0.48, baseY, 0.48);
  addBox(mesh, stone, R, baseY / 2, 0, 0.48, baseY, 0.48);
  addBox(mesh, accent, 0, 0.16, 0, 3.2, 0.32, 1.2);
  addBox(mesh, accent, 0, baseY + R + 0.04, 0, 0.34, 0.42, T * 2.6);
  return { height: 3.5, caption: 'PORTAL' };
}

function buildShell(mesh, rng, palette, qf) {
  const seg = Math.round(120 * qf);
  const tube = Math.round(16 * qf);
  const body = addGroup(mesh, 'shell', palette[0]);
  const lip = addGroup(mesh, 'lip', mix(palette[0], '#FFFFFF', 0.4));
  addParametric(mesh, body, (u, v) => {
    const angle = u * Math.PI * 5.5;
    const growth = 0.18 + u * 1.05;
    const x = Math.cos(angle) * growth;
    const z = Math.sin(angle) * growth;
    const y = u * 3.1;
    const side = v * TAU;
    return [
      x + Math.cos(angle) * Math.cos(side) * growth * 0.25,
      y + Math.sin(side) * growth * 0.25,
      z + Math.sin(angle) * Math.cos(side) * growth * 0.25,
    ];
  }, seg, tube);
  addSphere(mesh, lip, 0, 3.15, 0, 0.1, Math.max(10, Math.round(seg * 0.6)), Math.max(6, Math.round(tube * 0.5)));
  return { height: 3.4, caption: 'SPIRAL' };
}

const BUILDERS = {
  vase: buildVase, torus: buildTorus, knot: buildKnot, crystal: buildCrystal,
  terrain: buildTerrain, rocket: buildRocket, planet: buildPlanet,
  chair: buildChair, arch: buildArch, shell: buildShell,
};

function detectKind(lower, seed) {
  let best = '';
  let bestScore = 0;
  for (const kind of KINDS) {
    let score = 0;
    for (const word of kind.words) if (lower.includes(word)) score += 1;
    if (score > bestScore) { bestScore = score; best = kind.id; }
  }
  if (best) return best;
  const fallback = ['vase', 'torus', 'crystal', 'terrain', 'knot', 'arch'];
  return fallback[seed % fallback.length];
}

function resolveMesh(prompt, seed, options = {}) {
  const lower = String(prompt || '').toLowerCase();
  const resolvedSeed = Number.isFinite(Number(seed)) ? Number(seed) >>> 0 : hashString(prompt || 'blank 3d');
  const kind = BUILDERS[options.kind] ? options.kind : detectKind(lower, resolvedSeed);
  const theme = resolveTheme(prompt, resolvedSeed);
  const palette = theme.palette;
  const quality = QUALITY[options.quality] ? options.quality : 'medium';
  return {
    kind,
    kindLabel: (KINDS.find((entry) => entry.id === kind) || {}).label || kind,
    seed: resolvedSeed,
    quality,
    palette: [palette.colors[0], palette.colors[1], palette.colors[2], palette.colors[3]],
    theme: palette,
    title: titleFromPrompt(prompt, (KINDS.find((entry) => entry.id === kind) || {}).label || 'Object'),
  };
}

function generateMesh(options = {}) {
  const resolved = resolveMesh(options.prompt, options.seed, options);
  const qf = QUALITY[resolved.quality];
  const rng = mulberry32(resolved.seed ^ 0x7ac3e2);
  const mesh = createMesh();
  const info = BUILDERS[resolved.kind](mesh, rng, resolved.palette, qf);
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const [x, y, z] of mesh.vertices) {
    bounds.min[0] = Math.min(bounds.min[0], x);
    bounds.min[1] = Math.min(bounds.min[1], y);
    bounds.min[2] = Math.min(bounds.min[2], z);
    bounds.max[0] = Math.max(bounds.max[0], x);
    bounds.max[1] = Math.max(bounds.max[1], y);
    bounds.max[2] = Math.max(bounds.max[2], z);
  }
  const size = [
    Math.max(0.01, bounds.max[0] - bounds.min[0]),
    Math.max(0.01, bounds.max[1] - bounds.min[1]),
    Math.max(0.01, bounds.max[2] - bounds.min[2]),
  ];
  return {
    ...resolved,
    info,
    mesh,
    bounds,
    size,
    stats: {
      vertices: mesh.vertices.length,
      triangles: mesh.triangles.length,
      groups: mesh.groups.length,
    },
  };
}

/* --------------------------------------------------------------- preview */

function normalize3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function cross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function renderMeshPreview(model, options = {}) {
  const width = Math.round(options.width || 900);
  const height = Math.round(options.height || 900);
  const theme = model.theme || PALETTES.ice;
  const dark = Boolean(options.dark ?? theme.dark);
  const bg = dark ? mix('#0B0C12', theme.colors[0], 0.16) : mix('#F7F5F1', theme.colors[0], 0.06);
  const bg2 = dark ? '#07080D' : '#E9E6DF';
  const mesh = model.mesh;
  const center = [
    (model.bounds.min[0] + model.bounds.max[0]) / 2,
    (model.bounds.min[1] + model.bounds.max[1]) / 2,
    (model.bounds.min[2] + model.bounds.max[2]) / 2,
  ];
  const yaw = options.yaw ?? (-38 * DEG + (model.seed % 30) * DEG);
  const pitch = options.pitch ?? (18 * DEG);
  const eyeDir = normalize3([Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)]);
  const right = normalize3(cross3([0, 1, 0], eyeDir));
  const up = normalize3(cross3(eyeDir, right));
  const project = (v) => {
    const x = v[0] - center[0];
    const y = v[1] - center[1];
    const z = v[2] - center[2];
    return [x * right[0] + y * right[1] + z * right[2], x * up[0] + y * up[1] + z * up[2], x * eyeDir[0] + y * eyeDir[1] + z * eyeDir[2]];
  };
  let maxX = 0;
  let maxY = 0;
  for (const vertex of mesh.vertices) {
    const p = project(vertex);
    maxX = Math.max(maxX, Math.abs(p[0]));
    maxY = Math.max(maxY, Math.abs(p[1]));
  }
  const span = Math.max(maxX, maxY, 0.001);
  const scale = (Math.min(width, height) * 0.36) / span;
  const cx = width / 2;
  const cy = height / 2 - height * 0.015;

  const light = normalize3([-0.55, 0.82, 0.5]);
  const fill = normalize3([0.7, 0.2, 0.65]);
  const faces = mesh.triangles.map((triangle) => {
    const a = mesh.vertices[triangle.a];
    const b = mesh.vertices[triangle.b];
    const c = mesh.vertices[triangle.c];
    const p0 = project(a);
    const p1 = project(b);
    const p2 = project(c);
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const normal = normalize3(cross3(ab, ac));
    const group = mesh.groups[triangle.group];
    const base = group.color;
    const diffuse = Math.max(0, normal[0] * light[0] + normal[1] * light[1] + normal[2] * light[2]);
    const fillLight = Math.max(0, normal[0] * fill[0] + normal[1] * fill[1] + normal[2] * fill[2]) * 0.28;
    const rim = Math.pow(1 - Math.max(0, normal[0] * eyeDir[0] + normal[1] * eyeDir[1] + normal[2] * eyeDir[2]), 2.4) * 0.18;
    let tone = 0.34 + diffuse * 0.72 + fillLight;
    if (dark) tone += 0.05;
    const specular = Math.pow(diffuse, 14) * 0.28;
    let color = shade(base, clamp((tone - 0.72) * 0.55, -0.45, 0.36));
    color = mix(color, '#FFFFFF', clamp(specular, 0, 0.3));
    color = mix(color, theme.colors[0], clamp(rim, 0, 0.22));
    const x = cx + p0[0] * scale;
    const y = cy - p0[1] * scale;
    const x2 = cx + p1[0] * scale;
    const y2 = cy - p1[1] * scale;
    const x3 = cx + p2[0] * scale;
    const y3 = cy - p2[1] * scale;
    return {
      points: `${n(x)},${n(y)} ${n(x2)},${n(y2)} ${n(x3)},${n(y3)}`,
      color,
      depth: (p0[2] + p1[2] + p2[2]) / 3,
      opacity: 1,
    };
  });
  faces.sort((a, b) => a.depth - b.depth);

  let shadow = '';
  if (options.shadow !== false) {
    const shadowR = Math.min(width, height) * 0.22;
    shadow = `<ellipse cx="${n(width * 0.5)}" cy="${n(height * 0.82)}" rx="${n(shadowR)}" ry="${n(shadowR * 0.14)}" fill="${dark ? '#000000' : '#1A1813'}" opacity="0.22" filter="url(#soft)"/>`;
  }

  const captionSize = Math.max(10, Math.min(width, height) * 0.0135);
  const label = (options.label || model.title || model.info?.caption || 'OBJECT').toUpperCase();
  const number = String(model.seed % 1000).padStart(3, '0');

  const background = `<linearGradient id="mbg" x1="0" y1="0" x2="0.7" y2="1">` +
    `<stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="${bg2}"/></linearGradient>` +
    `<radialGradient id="mglow" cx="0.5" cy="0.38" r="0.55"><stop offset="0" stop-color="${theme.colors[1]}" stop-opacity="${dark ? 0.22 : 0.18}"/><stop offset="1" stop-color="${theme.colors[0]}" stop-opacity="0"/></radialGradient>` +
    `<filter id="soft" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="${n(Math.min(width, height) * 0.02)}"/></filter>`;

  let grid = '';
  if (options.grid !== false) {
    const step = Math.min(width, height) * 0.08;
    for (let x = step; x < width; x += step) {
      for (let y = step; y < height; y += step) {
        grid += `<circle cx="${n(x)}" cy="${n(y)}" r="1" fill="${theme.ink || (dark ? '#F2F2F4' : '#111114')}" opacity="0.08"/>`;
      }
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<defs>${background}</defs>` +
    `<rect width="${width}" height="${height}" fill="url(#mbg)"/>` +
    `<rect width="${width}" height="${height}" fill="url(#mglow)"/>` +
    grid +
    shadow +
    `<g stroke-linejoin="round">` +
    faces.map((face) => `<polygon points="${face.points}" fill="${face.color}" stroke="${face.color}" stroke-width="0.5" opacity="${face.opacity}"/>`).join('') +
    `</g>` +
    `<g fill="${dark ? '#F2F2F4' : '#111114'}" opacity="0.55" font-family="Inter, 'Segoe UI', Arial, sans-serif" font-size="${n(captionSize)}" letter-spacing="${n(captionSize * 0.22)}">` +
    `<text x="${n(width * 0.06)}" y="${n(height * 0.945)}">${escapeXml(label.slice(0, 40))}</text>` +
    `<text x="${n(width - width * 0.06)}" y="${n(height * 0.945)}" text-anchor="end">${escapeXml(model.kindLabel.toUpperCase())} / ${number}</text>` +
    `</g>` +
    `<line x1="${n(width * 0.06)}" y1="${n(height * 0.915)}" x2="${n(width * 0.16)}" y2="${n(height * 0.915)}" stroke="${theme.ink || '#111114'}" stroke-opacity="0.25"/>` +
    `</svg>`;
  return svg;
}

/* ----------------------------------------------------------------- export */

function exportObj(model) {
  const { mesh } = model;
  const lines = [
    `# blank Studio — ${model.title || model.kind}`,
    `# ${model.stats.triangles} triangles, generated with blank`,
    `mtllib ${safeName(model.title || model.kind)}.mtl`,
    '',
  ];
  mesh.vertices.forEach((v) => lines.push(`v ${n(v[0])} ${n(v[1])} ${n(v[2])}`));
  const facesByGroup = mesh.groups.map(() => []);
  mesh.triangles.forEach((face) => {
    const bucket = facesByGroup[face.group] || facesByGroup[0];
    if (bucket) bucket.push(face);
  });
  let triangleIndex = 0;
  mesh.groups.forEach((group, groupIndex) => {
    const faces = facesByGroup[groupIndex];
    if (!faces.length) return;
    lines.push(`o ${safeName(group.name)}_${groupIndex}`);
    lines.push(`usemtl mat_${groupIndex}`);
    faces.forEach((face) => {
      lines.push(`f ${face.a + 1} ${face.b + 1} ${face.c + 1}`);
      triangleIndex += 1;
    });
  });
  const mtl = mesh.groups.map((group, index) => {
    const { r, g, b } = hexToRgbLocal(group.color);
    return [`newmtl mat_${index}`, `Kd ${n(r / 255)} ${n(g / 255)} ${n(b / 255)}`, 'Ka 0 0 0', 'Ks 0.25 0.25 0.25', 'Ns 40', ''].join('\n');
  }).join('\n');
  return { obj: `${lines.join('\n')}\n`, mtl: `# blank Studio materials\n\n${mtl}`, triangles: triangleIndex };
}

function hexToRgbLocal(hex) {
  const clean = String(hex || '#888888').replace('#', '');
  return {
    r: parseInt(clean.slice(0, 2), 16) || 0,
    g: parseInt(clean.slice(2, 4), 16) || 0,
    b: parseInt(clean.slice(4, 6), 16) || 0,
  };
}

function exportStl(model) {
  const { mesh } = model;
  const triangles = mesh.triangles;
  const buffer = Buffer.alloc(84 + triangles.length * 50);
  buffer.write('blank Studio binary STL', 0);
  buffer.writeUInt32LE(triangles.length, 80);
  let offset = 84;
  const v = (index) => mesh.vertices[index];
  for (const face of triangles) {
    const a = v(face.a);
    const b = v(face.b);
    const c = v(face.c);
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const normal = normalize3(cross3(ab, ac));
    [normal, a, b, c].forEach((vec) => {
      buffer.writeFloatLE(vec[0], offset);
      buffer.writeFloatLE(vec[1], offset + 4);
      buffer.writeFloatLE(vec[2], offset + 8);
      offset += 12;
    });
    buffer.writeUInt16LE(0, offset);
    offset += 2;
  }
  return buffer;
}

const MESH_STYLE_LIST = KINDS.map(({ id, label }) => ({ id, label }));

module.exports = {
  KINDS, MESH_STYLE_LIST, generateMesh, resolveMesh, renderMeshPreview, exportObj, exportStl,
};
