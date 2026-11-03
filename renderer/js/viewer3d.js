/* Dependency-free 3D viewer for generated and imported meshes.
   Parses OBJ (and ASCII STL), draws it with WebGL, and falls back to a
   painter-sorted canvas renderer when WebGL is unavailable. */
(function () {
  'use strict';

  const DEG = Math.PI / 180;

  /* --------------------------------------------------------------- parsing */

  function parseObj(text) {
    const vertices = [];
    const triangles = [];
    const lines = String(text || '').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      if (trimmed.startsWith('v ')) {
        const parts = trimmed.split(/\s+/);
        vertices.push([Number(parts[1]) || 0, Number(parts[2]) || 0, Number(parts[3]) || 0]);
      } else if (trimmed.startsWith('f ')) {
        const parts = trimmed.split(/\s+/).slice(1);
        const indices = parts.map((part) => {
          const index = parseInt(part.split('/')[0], 10);
          if (!Number.isFinite(index)) return -1;
          return index < 0 ? vertices.length + index : index - 1;
        }).filter((index) => index >= 0 && index < vertices.length);
        for (let i = 1; i + 1 < indices.length; i += 1) {
          triangles.push([indices[0], indices[i], indices[i + 1]]);
        }
      }
    }
    return { vertices, triangles };
  }

  function parseAsciiStl(text) {
    const vertices = [];
    const triangles = [];
    const pattern = /vertex\s+(-?[\d.eE+]+)\s+(-?[\d.eE+]+)\s+(-?[\d.eE+]+)/g;
    let match;
    const points = [];
    while ((match = pattern.exec(text))) {
      points.push([Number(match[1]), Number(match[2]), Number(match[3])]);
    }
    for (let i = 0; i + 2 < points.length; i += 3) {
      const base = vertices.length;
      vertices.push(points[i], points[i + 1], points[i + 2]);
      triangles.push([base, base + 1, base + 2]);
    }
    return { vertices, triangles };
  }

  function parseMesh(text) {
    const source = String(text || '');
    if (/^\s*solid\b/i.test(source) && /\bfacet\b/i.test(source) && /\bvertex\b/i.test(source)) {
      return parseAsciiStl(source);
    }
    return parseObj(source);
  }

  function buildGeometry(parsed) {
    const { vertices, triangles } = parsed;
    if (!vertices.length || !triangles.length) throw new Error('No triangles in this mesh');
    let min = [Infinity, Infinity, Infinity];
    let max = [-Infinity, -Infinity, -Infinity];
    for (const v of vertices) {
      for (let i = 0; i < 3; i += 1) {
        if (v[i] < min[i]) min[i] = v[i];
        if (v[i] > max[i]) max[i] = v[i];
      }
    }
    const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    let radius = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2;
    if (!Number.isFinite(radius) || radius <= 0) radius = 1;

    const positions = new Float32Array(triangles.length * 9);
    const normals = new Float32Array(triangles.length * 9);
    const edges = [];
    let offset = 0;
    for (const face of triangles) {
      const a = vertices[face[0]];
      const b = vertices[face[1]];
      const c = vertices[face[2]];
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      let nx = ab[1] * ac[2] - ab[2] * ac[1];
      let ny = ab[2] * ac[0] - ab[0] * ac[2];
      let nz = ab[0] * ac[1] - ab[1] * ac[0];
      const length = Math.hypot(nx, ny, nz) || 1;
      nx /= length; ny /= length; nz /= length;
      for (const v of [a, b, c]) {
        positions[offset] = (v[0] - center[0]) / radius;
        positions[offset + 1] = (v[1] - center[1]) / radius;
        positions[offset + 2] = (v[2] - center[2]) / radius;
        normals[offset] = nx; normals[offset + 1] = ny; normals[offset + 2] = nz;
        offset += 3;
      }
    }
    const limit = Math.min(triangles.length, 9000);
    for (let i = 0; i < limit; i += 1) {
      const face = triangles[i];
      for (let e = 0; e < 3; e += 1) {
        const p = vertices[face[e]];
        const q = vertices[face[(e + 1) % 3]];
        edges.push(
          (p[0] - center[0]) / radius, (p[1] - center[1]) / radius, (p[2] - center[2]) / radius,
          (q[0] - center[0]) / radius, (q[1] - center[1]) / radius, (q[2] - center[2]) / radius,
        );
      }
    }
    return {
      positions,
      normals,
      edges: new Float32Array(edges),
      triangleCount: triangles.length,
      bounds: { min, max, radius },
    };
  }

  /* ---------------------------------------------------------------- matrix */

  function mat4Identity() {
    return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  }

  function mat4Multiply(a, b) {
    const out = new Float32Array(16);
    for (let col = 0; col < 4; col += 1) {
      for (let row = 0; row < 4; row += 1) {
        out[col * 4 + row] =
          a[0 * 4 + row] * b[col * 4 + 0] +
          a[1 * 4 + row] * b[col * 4 + 1] +
          a[2 * 4 + row] * b[col * 4 + 2] +
          a[3 * 4 + row] * b[col * 4 + 3];
      }
    }
    return out;
  }

  function mat4Perspective(fov, aspect, near, far) {
    const f = 1 / Math.tan(fov / 2);
    const out = new Float32Array(16);
    out[0] = f / aspect;
    out[5] = f;
    out[10] = (far + near) / (near - far);
    out[11] = -1;
    out[14] = (2 * far * near) / (near - far);
    return out;
  }

  function mat4Translate(x, y, z) {
    const out = mat4Identity();
    out[12] = x; out[13] = y; out[14] = z;
    return out;
  }

  function mat4RotateX(angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const out = mat4Identity();
    out[5] = c; out[6] = s; out[9] = -s; out[10] = c;
    return out;
  }

  function mat4RotateY(angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const out = mat4Identity();
    out[0] = c; out[2] = -s; out[8] = s; out[10] = c;
    return out;
  }

  function mat4RotateZ(angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const out = mat4Identity();
    out[0] = c; out[1] = s; out[4] = -s; out[5] = c;
    return out;
  }

  /* ---------------------------------------------------------------- WebGL */

  const VERTEX_SHADER = `
    attribute vec3 aPosition;
    attribute vec3 aNormal;
    uniform mat4 uMVP;
    uniform mat4 uModel;
    varying vec3 vNormal;
    varying vec3 vPosition;
    void main() {
      vNormal = mat3(uModel) * aNormal;
      vPosition = (uModel * vec4(aPosition, 1.0)).xyz;
      gl_Position = uMVP * vec4(aPosition, 1.0);
    }
  `;

  const FRAGMENT_SHADER = `
    precision mediump float;
    uniform vec3 uBase;
    uniform vec3 uGlow;
    uniform float uEdges;
    varying vec3 vNormal;
    varying vec3 vPosition;
    void main() {
      vec3 n = normalize(vNormal);
      vec3 keyDir = normalize(vec3(-0.45, 0.7, 0.85));
      vec3 fillDir = normalize(vec3(0.8, -0.25, 0.4));
      float key = max(dot(n, keyDir), 0.0);
      float fill = max(dot(n, fillDir), 0.0);
      float rim = pow(1.0 - max(dot(n, vec3(0.0, 0.0, 1.0)), 0.0), 2.4);
      vec3 color = uBase * (0.34 + key * 0.72 + fill * 0.16);
      color += uGlow * rim * 0.5;
      float alpha = 0.94 + key * 0.06;
      if (uEdges > 0.5) {
        gl_FragColor = vec4(uGlow, 0.32);
      } else {
        gl_FragColor = vec4(color, alpha);
      }
    }
  `;

  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(log || 'Shader compilation failed');
    }
    return shader;
  }

  function createWebGL(canvas) {
    const gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: false })
      || canvas.getContext('experimental-webgl', { antialias: true, alpha: true });
    if (!gl) return null;
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || 'Program link failed');
    }
    return {
      gl,
      program,
      locations: {
        position: gl.getAttribLocation(program, 'aPosition'),
        normal: gl.getAttribLocation(program, 'aNormal'),
        mvp: gl.getUniformLocation(program, 'uMVP'),
        model: gl.getUniformLocation(program, 'uModel'),
        base: gl.getUniformLocation(program, 'uBase'),
        glow: gl.getUniformLocation(program, 'uGlow'),
        edges: gl.getUniformLocation(program, 'uEdges'),
      },
    };
  }

  function upload(gl, data, target) {
    const buffer = gl.createBuffer();
    gl.bindBuffer(target || gl.ARRAY_BUFFER, buffer);
    gl.bufferData(target || gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return buffer;
  }

  /* -------------------------------------------------------------- fallback */

  function project(point, rotation, distance, aspect) {
    const [x0, y0, z0] = point;
    const cy = Math.cos(rotation.yaw);
    const sy = Math.sin(rotation.yaw);
    const cx = Math.cos(rotation.pitch);
    const sx = Math.sin(rotation.pitch);
    const x1 = x0 * cy + z0 * sy;
    const z1 = -x0 * sy + z0 * cy;
    const y1 = y0 * cx - z1 * sx;
    const z2 = y0 * sx + z1 * cx + distance;
    const f = 1 / Math.tan(38 * DEG / 2);
    const w = z2 || 0.0001;
    return {
      x: (x1 * f) / (aspect * w),
      y: (y1 * f) / w,
      depth: z2,
    };
  }

  function createFallback(container, canvas) {
    const ctx = canvas.getContext('2d');
    let geometry = null;
    let frame = 0;
    function draw(view) {
      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);
      if (!geometry) return;
      const aspect = width / height || 1;
      const faces = [];
      const src = geometry.positions;
      for (let i = 0; i < src.length; i += 9) {
        const pts = [];
        for (let v = 0; v < 3; v += 1) {
          const point = [src[i + v * 3], src[i + v * 3 + 1], src[i + v * 3 + 2]];
          const p = project(point, view.rotation, view.distance, aspect);
          pts.push(p);
        }
        const depth = (pts[0].depth + pts[1].depth + pts[2].depth) / 3;
        faces.push({ pts, depth, i });
      }
      faces.sort((a, b) => b.depth - a.depth);
      for (const face of faces) {
        const [a, b, c] = face.pts;
        const ax = (a.x * 0.5 + 0.5) * width;
        const ay = (-a.y * 0.5 + 0.5) * height;
        const bx = (b.x * 0.5 + 0.5) * width;
        const by = (-b.y * 0.5 + 0.5) * height;
        const cx = (c.x * 0.5 + 0.5) * width;
        const cy = (-c.y * 0.5 + 0.5) * height;
        const shade = Math.max(0.22, Math.min(1, 0.55 + (1 - (face.depth - view.distance) / 2) * 0.35));
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.lineTo(cx, cy);
        ctx.closePath();
        ctx.fillStyle = `rgba(${Math.round(76 * shade + 22)}, ${Math.round(126 * shade + 30)}, ${Math.round(255 * shade + 20)}, 0.92)`;
        ctx.fill();
        ctx.strokeStyle = 'rgba(174, 203, 255, 0.26)';
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }
      view.frame = requestAnimationFrame(() => draw(view));
    }
    return {
      setGeometry(next) { geometry = next; },
      start(view) { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => draw(view)); },
      stop() { cancelAnimationFrame(frame); },
    };
  }

  /* ------------------------------------------------------------------ view */

  function create(container, options = {}) {
    if (!container) throw new Error('Viewer3D needs a container');
    container.classList.add('viewer3d');
    container.innerHTML = '';
    const canvas = document.createElement('canvas');
    container.appendChild(canvas);

    const loading = document.createElement('div');
    loading.className = 'viewer3d-loading';
    loading.innerHTML = '<span class="spinner"></span><span>Preparing mesh…</span>';
    container.appendChild(loading);

    const hint = document.createElement('div');
    hint.className = 'viewer3d-hint';
    hint.textContent = 'Drag to orbit · Scroll to zoom';
    container.appendChild(hint);

    const tools = document.createElement('div');
    tools.className = 'viewer3d-tools';
    tools.innerHTML = `
      <button type="button" data-viewer-action="spin" title="Toggle auto-rotate">${window.icon ? window.icon('play', 13) : '↻'}</button>
      <button type="button" data-viewer-action="reset" title="Reset view">${window.icon ? window.icon('rotate-ccw', 13) : '⌂'}</button>
      <button type="button" data-viewer-action="full" title="Toggle size">${window.icon ? window.icon('maximize', 13) : '⛶'}</button>`;
    container.appendChild(tools);

    const state = {
      geometry: null,
      rotation: { pitch: -0.24, yaw: 0.62 },
      distance: 3.1,
      spin: !window.U?.prefersReducedMotion?.(),
      dragging: false,
      lastX: 0,
      lastY: 0,
      frame: 0,
      disposed: false,
      useGL: true,
    };

    let glState = null;
    let buffers = null;
    let fallback = null;
    let dpr = 1;

    function resize() {
      const rect = container.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.max(160, Math.floor(rect.width * dpr));
      const height = Math.max(160, Math.floor(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      if (glState) glState.gl.viewport(0, 0, canvas.width, canvas.height);
    }

    function drawGL() {
      if (!glState || !state.geometry) return;
      const gl = glState.gl;
      const loc = glState.locations;
      resize();
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.useProgram(glState.program);

      const aspect = canvas.width / Math.max(1, canvas.height);
      const projection = mat4Perspective(38 * DEG, aspect, 0.05, 50);
      const view = mat4Multiply(
        mat4Translate(0, 0, -state.distance),
        mat4Multiply(mat4RotateX(state.rotation.pitch), mat4RotateY(state.rotation.yaw)),
      );
      const model = mat4Multiply(mat4RotateY(state.spinAngle || 0), mat4RotateZ(0));
      const mvp = mat4Multiply(projection, mat4Multiply(view, model));

      gl.uniformMatrix4fv(loc.mvp, false, mvp);
      gl.uniformMatrix4fv(loc.model, false, model);
      gl.uniform3f(loc.base, 0.36, 0.52, 0.95);
      gl.uniform3f(loc.glow, 0.58, 0.76, 1.0);

      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.positions);
      gl.enableVertexAttribArray(loc.position);
      gl.vertexAttribPointer(loc.position, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.normals);
      gl.enableVertexAttribArray(loc.normal);
      gl.vertexAttribPointer(loc.normal, 3, gl.FLOAT, false, 0, 0);

      gl.uniform1f(loc.edges, 0);
      gl.drawArrays(gl.TRIANGLES, 0, state.geometry.positions.length / 3);

      if (buffers.edges) {
        gl.disable(gl.CULL_FACE);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        gl.uniform1f(loc.edges, 1);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.edges);
        gl.vertexAttribPointer(loc.position, 3, gl.FLOAT, false, 0, 0);
        gl.vertexAttribPointer(loc.normal, 3, gl.FLOAT, false, 0, 0);
        gl.uniformMatrix4fv(loc.model, false, mat4Identity());
        gl.drawArrays(gl.LINES, 0, state.geometry.edges.length / 3);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
      }
    }

    function loop() {
      if (state.disposed) return;
      if (state.spin && !state.dragging) {
        state.rotation.yaw += 0.0032;
      }
      if (state.useGL && glState) drawGL();
      else if (fallback) fallback.frame = null;
      state.frame = requestAnimationFrame(loop);
    }

    try {
      glState = createWebGL(canvas);
      if (!glState) throw new Error('WebGL unavailable');
    } catch (error) {
      state.useGL = false;
      glState = null;
      fallback = createFallback(container, canvas);
    }

    function setGeometry(geometry) {
      state.geometry = geometry;
      if (glState) {
        glState.gl.deleteBuffer(buffers?.positions);
        glState.gl.deleteBuffer(buffers?.normals);
        glState.gl.deleteBuffer(buffers?.edges);
        buffers = {
          positions: upload(glState.gl, geometry.positions),
          normals: upload(glState.gl, geometry.normals),
          edges: geometry.edges.length ? upload(glState.gl, geometry.edges) : null,
        };
        drawGL();
      }
      if (fallback) fallback.setGeometry(geometry);
      loading.hidden = true;
    }

    function setError(message) {
      loading.hidden = false;
      loading.innerHTML = `<span style="max-width:220px;text-align:center;line-height:1.5">${window.U ? window.U.esc(message) : message}</span>`;
      hint.hidden = true;
    }

    function reset() {
      state.rotation = { pitch: -0.24, yaw: 0.62 };
      state.distance = 3.1;
      if (glState) drawGL();
    }

    function toggleSpin() {
      state.spin = !state.spin;
      const button = tools.querySelector('[data-viewer-action="spin"]');
      if (button) {
        button.classList.toggle('active', state.spin);
        const glyph = button.querySelector('svg');
        if (glyph) glyph.style.opacity = state.spin ? '1' : '0.65';
      }
    }

    tools.addEventListener('click', (event) => {
      const button = event.target.closest('[data-viewer-action]');
      if (!button) return;
      const action = button.dataset.viewerAction;
      if (action === 'reset') reset();
      else if (action === 'spin') toggleSpin();
      else if (action === 'full') container.classList.toggle('viewer3d-expanded');
    });

    canvas.addEventListener('pointerdown', (event) => {
      state.dragging = true;
      state.lastX = event.clientX;
      state.lastY = event.clientY;
      canvas.setPointerCapture?.(event.pointerId);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!state.dragging) return;
      const dx = event.clientX - state.lastX;
      const dy = event.clientY - state.lastY;
      state.lastX = event.clientX;
      state.lastY = event.clientY;
      state.rotation.yaw += dx * 0.008;
      state.rotation.pitch = Math.max(-1.35, Math.min(1.35, state.rotation.pitch - dy * 0.007));
      if (glState) drawGL();
    });
    const stopDrag = () => { state.dragging = false; };
    canvas.addEventListener('pointerup', stopDrag);
    canvas.addEventListener('pointercancel', stopDrag);
    canvas.addEventListener('pointerleave', stopDrag);
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      state.distance = Math.max(1.6, Math.min(9, state.distance + event.deltaY * 0.0018));
      if (glState) drawGL();
    }, { passive: false });

    const resizeObserver = new ResizeObserver(() => {
      resize();
      if (glState) drawGL();
    });
    resizeObserver.observe(container);

    resize();
    if (fallback) {
      fallback.setGeometry(null);
      fallback.start(state);
    }
    state.frame = requestAnimationFrame(loop);

    return {
      setObj(text) {
        const parsed = parseMesh(text);
        const geometry = buildGeometry(parsed);
        setGeometry(geometry);
        if (fallback) {
          // The fallback renderer owns its own loop; refresh geometry for the next frame.
          fallback.setGeometry(geometry);
        }
        return { triangles: geometry.triangleCount, bounds: geometry.bounds };
      },
      setGeometry,
      setError,
      reset,
      toggleSpin,
      dispose() {
        state.disposed = true;
        cancelAnimationFrame(state.frame);
        if (fallback) fallback.stop();
        resizeObserver.disconnect();
        if (glState) {
          const gl = glState.gl;
          if (buffers?.positions) gl.deleteBuffer(buffers.positions);
          if (buffers?.normals) gl.deleteBuffer(buffers.normals);
          if (buffers?.edges) gl.deleteBuffer(buffers.edges);
          gl.deleteProgram(glState.program);
        }
        container.innerHTML = '';
      },
    };
  }

  window.Viewer3D = { create, parseMesh, parseObj, parseAsciiStl };
})();
