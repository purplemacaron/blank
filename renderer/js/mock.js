/* Browser preview backend. Mirrors the Electron IPC surface with seeded, clearly
   local data so the interface can be designed and tested without a desktop shell.
   Nothing here is used inside Electron. */
(function () {
  'use strict';

  const NOW = Date.now();
  const iso = (offsetMs) => new Date(NOW + offsetMs).toISOString();
  const listeners = new Set();
  const emit = (payload) => {
    for (const fn of [...listeners]) {
      try { fn(payload); } catch (error) { console.error(error); }
    }
  };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const workspace = 'C:\\Users\\you\\Projects\\atlas-platform';

  const PROVIDERS = [
    {
      id: 'sandbox', name: 'Blank Sandbox', monogram: 'b', protocol: 'sandbox', kind: 'local',
      description: 'An offline preview model. No network, no key, no data leaves your machine.', docs: '',
      models: [{ id: 'blank-1', name: 'Blank 1', context: 32000, tags: ['Offline', 'Preview'], note: 'Guided demo' }],
    },
    {
      id: 'anthropic', name: 'Anthropic', monogram: 'A', protocol: 'anthropic',
      description: 'Claude models — strong long-horizon reasoning and tool use.', docs: 'https://console.anthropic.com/settings/keys',
      models: [
        { id: 'claude-opus-4-1', name: 'Claude Opus 4.1', context: 200000, tags: ['Reasoning', 'Tools', 'Vision'] },
        { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', context: 200000, tags: ['Tools', 'Vision', 'Balanced'] },
        { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', context: 200000, tags: ['Fast', 'Tools'] },
        { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', context: 200000, tags: ['Tools', 'Vision'] },
      ],
    },
    {
      id: 'openai', name: 'OpenAI', monogram: 'O', protocol: 'openai',
      description: 'GPT and o-series models via the chat completions API.', docs: 'https://platform.openai.com/api-keys',
      models: [
        { id: 'gpt-5.1', name: 'GPT-5.1', context: 400000, tags: ['Reasoning', 'Tools', 'Vision'] },
        { id: 'gpt-5.1-mini', name: 'GPT-5.1 mini', context: 400000, tags: ['Fast', 'Tools'] },
        { id: 'gpt-5', name: 'GPT-5', context: 400000, tags: ['Reasoning', 'Tools'] },
        { id: 'gpt-5-mini', name: 'GPT-5 mini', context: 400000, tags: ['Fast'] },
        { id: 'o4-mini', name: 'o4-mini', context: 200000, tags: ['Reasoning'] },
        { id: 'gpt-4.1', name: 'GPT-4.1', context: 1000000, tags: ['Tools', 'Vision'] },
        { id: 'gpt-4o', name: 'GPT-4o', context: 128000, tags: ['Vision', 'Fast'] },
      ],
    },
    {
      id: 'google', name: 'Google', monogram: 'G', protocol: 'gemini',
      description: 'Gemini models with long context and native function calling.', docs: 'https://aistudio.google.com/app/apikey',
      models: [
        { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', context: 1000000, tags: ['Reasoning', 'Tools', 'Vision'] },
        { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', context: 1000000, tags: ['Fast', 'Tools', 'Vision'] },
        { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash-Lite', context: 1000000, tags: ['Fast'] },
      ],
    },
    {
      id: 'openrouter', name: 'OpenRouter', monogram: 'R', protocol: 'openai',
      description: 'One key for hundreds of hosted models and automatic routing.', docs: 'https://openrouter.ai/keys',
      models: [
        { id: 'openrouter/auto', name: 'Auto router', context: 2000000, tags: ['Auto', 'Tools'] },
        { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5', context: 200000, tags: ['Tools'] },
        { id: 'openai/gpt-5.1', name: 'GPT-5.1', context: 400000, tags: ['Reasoning'] },
        { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', context: 1000000, tags: ['Reasoning'] },
        { id: 'x-ai/grok-4', name: 'Grok 4', context: 256000, tags: ['Reasoning'] },
        { id: 'deepseek/deepseek-chat-v3.1', name: 'DeepSeek V3.1', context: 128000, tags: ['Tools'] },
        { id: 'qwen/qwen3-coder', name: 'Qwen3 Coder', context: 256000, tags: ['Code'] },
      ],
    },
    {
      id: 'xai', name: 'xAI', monogram: 'X', protocol: 'openai',
      description: 'Grok models with real-time flavored reasoning.', docs: 'https://console.x.ai',
      models: [
        { id: 'grok-4', name: 'Grok 4', context: 256000, tags: ['Reasoning', 'Tools'] },
        { id: 'grok-3-mini', name: 'Grok 3 mini', context: 131000, tags: ['Fast'] },
      ],
    },
    {
      id: 'deepseek', name: 'DeepSeek', monogram: 'D', protocol: 'openai',
      description: 'Open-weight models with strong coding and reasoning value.', docs: 'https://platform.deepseek.com/api_keys',
      models: [
        { id: 'deepseek-chat', name: 'DeepSeek V3.2 Chat', context: 128000, tags: ['Tools', 'Code'] },
        { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', context: 128000, tags: ['Reasoning'] },
      ],
    },
    {
      id: 'mistral', name: 'Mistral', monogram: 'M', protocol: 'openai',
      description: 'European frontier and code models.', docs: 'https://console.mistral.ai/api-keys',
      models: [
        { id: 'mistral-large-latest', name: 'Mistral Large', context: 128000, tags: ['Tools'] },
        { id: 'devstral-medium-latest', name: 'Devstral Medium', context: 128000, tags: ['Code', 'Tools'] },
        { id: 'codestral-latest', name: 'Codestral', context: 256000, tags: ['Code', 'Fast'] },
      ],
    },
    {
      id: 'groq', name: 'Groq', monogram: 'Q', protocol: 'openai',
      description: 'Very fast inference on open models.', docs: 'https://console.groq.com/keys',
      models: [
        { id: 'moonshotai/kimi-k2-instruct', name: 'Kimi K2', context: 256000, tags: ['Tools'] },
        { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B', context: 131000, tags: ['Reasoning'] },
        { id: 'meta-llama/llama-4-maverick-17b-128e-instruct', name: 'Llama 4 Maverick', context: 131000, tags: ['Fast'] },
        { id: 'qwen/qwen3-32b', name: 'Qwen3 32B', context: 131000, tags: ['Tools'] },
      ],
    },
    {
      id: 'together', name: 'Together', monogram: 'T', protocol: 'openai',
      description: 'Open models, dedicated endpoints and fine-tunes.', docs: 'https://api.together.ai/settings/api-keys',
      models: [
        { id: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-Turbo', name: 'Llama 4 Maverick', context: 131000, tags: ['Fast'] },
        { id: 'Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8', name: 'Qwen3 Coder 480B', context: 256000, tags: ['Code'] },
        { id: 'deepseek-ai/DeepSeek-V3', name: 'DeepSeek V3', context: 128000, tags: ['Tools'] },
      ],
    },
    {
      id: 'cerebras', name: 'Cerebras', monogram: 'C', protocol: 'openai',
      description: 'Wafer-scale inference for open models.', docs: 'https://cloud.cerebras.ai',
      models: [
        { id: 'gpt-oss-120b', name: 'GPT-OSS 120B', context: 131000, tags: ['Reasoning', 'Fast'] },
        { id: 'qwen-3-235b-a22b-instruct-2507', name: 'Qwen3 235B', context: 131000, tags: ['Tools'] },
        { id: 'llama-4-maverick-17b-128e-instruct', name: 'Llama 4 Maverick', context: 131000, tags: ['Fast'] },
      ],
    },
    {
      id: 'ollama', name: 'Ollama', monogram: 'L', protocol: 'openai', kind: 'local',
      description: 'Your local Ollama runtime. Private by default.', docs: 'https://ollama.com',
      models: [
        { id: 'qwen3-coder:30b', name: 'Qwen3 Coder 30B', context: 256000, tags: ['Code', 'Local'] },
        { id: 'gpt-oss:20b', name: 'GPT-OSS 20B', context: 131000, tags: ['Reasoning', 'Local'] },
        { id: 'llama3.3:70b', name: 'Llama 3.3 70B', context: 128000, tags: ['Local'] },
        { id: 'qwen3:8b', name: 'Qwen3 8B', context: 40000, tags: ['Fast', 'Local'] },
      ],
    },
    {
      id: 'lmstudio', name: 'LM Studio', monogram: 'S', protocol: 'openai', kind: 'local',
      description: 'Any model loaded in LM Studio’s local server.', docs: 'https://lmstudio.ai',
      models: [{ id: 'local-model', name: 'Loaded model', context: 32768, tags: ['Local'] }],
    },
  ];

  const config = {
    version: 1,
    defaultModel: 'anthropic/claude-sonnet-4-5',
    fallbackModel: 'openai/gpt-5.1',
    workspace,
    theme: 'light',
    onboarded: true,
    customProviders: [],
    discoveredModels: {},
    permissions: {
      read_file: 'allow', list_dir: 'allow', glob: 'allow', grep: 'allow', web_fetch: 'allow',
      todo_write: 'allow', memory_search: 'allow', remember: 'allow', read_skill: 'allow',
      delegate: 'allow', write_file: 'ask', edit_file: 'ask', run_command: 'ask', mcp: 'ask',
    },
    agent: {
      maxSteps: 32, temperature: null, autoCompact: true, compactAt: 0.82,
      autoMemory: true, autoReflect: false, showReasoning: true,
    },
    customInstructions: 'Prefer small, focused diffs. Run the relevant tests before reporting work as complete. Never commit secrets.',
    ssh: { hosts: [] },
    disabledSkills: [],
    ui: { railOpen: true, sidebarOpen: true, density: 'comfy' },
    runtime: {
      version: '1.0.0', platform: 'win32', arch: 'x64',
      home: 'C:\\Users\\you\\.blank', dataDir: 'C:\\Users\\you\\.blank',
      electron: '45.2.1', node: '24.4.0', isDev: true,
    },
    providers: {
      anthropic: { hasKey: true, keyPreview: 'sk-a…49c2', keySource: 'stored', connected: true, baseUrl: '' },
      openai: { hasKey: true, keyPreview: 'sk-p…8f10', keySource: 'env', connected: true, baseUrl: '' },
      ollama: { hasKey: false, keyPreview: '', keySource: null, connected: true, baseUrl: 'http://localhost:11434/v1' },
      lmstudio: { hasKey: false, keyPreview: '', keySource: null, connected: false, baseUrl: 'http://localhost:1234/v1' },
    },
  };
  for (const provider of PROVIDERS) {
    if (!config.providers[provider.id]) {
      config.providers[provider.id] = {
        hasKey: false, keyPreview: '', keySource: null,
        connected: provider.kind === 'local' && provider.id === 'ollama',
        baseUrl: '',
      };
    }
  }
  for (const [providerId, entry] of Object.entries(config.providers)) {
    const keys = entry.keys || (entry.hasKey ? [{
      id: `k_${providerId}_primary`,
      label: entry.keySource === 'env' ? 'Environment' : 'Primary',
      preview: entry.keyPreview,
      active: true,
      source: entry.keySource || 'stored',
      removable: entry.keySource !== 'env',
      createdAt: iso(-86400000 * 3),
      lastUsedAt: iso(-3600000),
      lastError: '',
    }] : []);
    entry.keys = keys;
    entry.keyCount = keys.length;
    entry.activeKeyId = keys.find((key) => key.active)?.id || keys[0]?.id || '';
    entry.autoRotate = entry.autoRotate !== false;
    if (entry.hasKey && !keys.length) {
      entry.keys = [{ id: `k_${providerId}_primary`, label: 'Primary', preview: entry.keyPreview, active: true, source: 'stored', removable: true, createdAt: iso(-86400000 * 3), lastUsedAt: '', lastError: '' }];
      entry.keyCount = 1;
      entry.activeKeyId = entry.keys[0].id;
    }
    if (providerId === 'openai' && entry.keys.length) {
      entry.keys.push({ id: 'k_openai_backup', label: 'Backup', preview: 'sk-b…7c31', active: false, source: 'stored', removable: true, createdAt: iso(-86400000), lastUsedAt: '', lastError: '' });
      entry.keyCount = entry.keys.length;
      entry.hasKey = true;
    }
  }
  config.search = { provider: 'duckduckgo', maxResults: 6, baseUrl: '', hasKey: {}, keyIds: [] };
  config.computer = { showCursor: true };
  config.remote = { port: 8787, allowLan: false, allowApprovals: false, autoStart: false };
  config.media = { defaults: {}, hasKey: {}, keyIds: [] };

  /* ------------------------------------------------------- plugins & remote */

  const pluginState = new Set(['builtin-web-search', 'builtin-computer', 'builtin-media', 'builtin-remote']);
  const pluginServers = new Map();
  const PLUGIN_ITEMS = [
    { id: 'builtin-web-search', name: 'Web search', category: 'Built in', icon: 'globe', kind: 'builtin', action: 'settings-web', tagline: 'Search the live web, then read and cite the best pages.', description: 'Blank ships web_search and web_fetch. DuckDuckGo works with no key; other backends can be connected in Settings.', tags: ['No setup', 'Citations'] },
    { id: 'builtin-computer', name: 'Computer use', category: 'Built in', icon: 'monitor', kind: 'builtin', action: 'settings-computer', tagline: 'See the screen and control the desktop with approval.', description: 'computer_screenshot and computer_use work on Windows, macOS and Linux with a blue cursor marker.', tags: ['Approval gated', 'Cursor overlay'] },
    { id: 'builtin-media', name: 'Studio', category: 'Built in', icon: 'wand', kind: 'builtin', action: 'studio', tagline: 'Create and edit images, video, music and 3D.', description: 'A local-first media workspace with deterministic local engines and optional cloud models.', tags: ['Local first'] },
    { id: 'builtin-remote', name: 'Remote control', category: 'Built in', icon: 'smartphone', kind: 'builtin', action: 'settings-remote', tagline: 'Pair a phone over your network with a one-time token.', description: 'An authenticated web client for sending messages, watching runs and answering approvals.', tags: ['Token auth', 'Off by default'] },
    { id: 'filesystem', name: 'Filesystem', category: 'MCP', icon: 'folder', kind: 'mcp', transport: 'stdio', tagline: 'Give the agent a scoped view of your workspace files.', description: 'Starts the official Filesystem MCP server rooted at your current workspace.', requires: ['workspace', 'node'], risk: 'Starts a local process with npx. Every MCP tool call still follows your approval policy.', tags: ['Local', 'npx'] },
    { id: 'playwright', name: 'Playwright Browser', category: 'MCP', icon: 'globe', kind: 'mcp', transport: 'stdio', tagline: 'Drive a real browser, inspect pages and take screenshots.', description: 'Microsoft Playwright MCP gives the agent a browser with snapshots, navigation and form interaction.', requires: ['node'], risk: 'Starts a local browser automation process.', tags: ['Browser', 'npx'] },
    { id: 'context7', name: 'Context7 Docs', category: 'MCP', icon: 'book', kind: 'mcp', transport: 'stdio', tagline: 'Pull current, version-specific documentation into context.', description: 'Upstash Context7 resolves library names and returns up-to-date docs and code examples.', requires: ['node'], tags: ['Docs', 'npx'] },
    { id: 'github', name: 'GitHub', category: 'MCP', icon: 'github', kind: 'mcp', transport: 'http', tagline: 'Read repositories, issues and pull requests.', description: 'Connects to GitHub’s hosted MCP endpoint with a personal access token.', requires: ['token'], tokenLabel: 'Fine-grained GitHub token', risk: 'Your token is stored locally and sent only to api.githubcopilot.com.', tags: ['Remote', 'Token'] },
    { id: 'a11y-audit', name: 'Accessibility audit', category: 'Skill', icon: 'eye', kind: 'skill', tagline: 'A rigorous WCAG-minded review pass for any UI.', description: 'Installs a skill that walks keyboard, focus, contrast, semantics and motion checks.', tags: ['Skill', 'WCAG'] },
    { id: 'perf-audit', name: 'Performance budget', category: 'Skill', icon: 'zap', kind: 'skill', tagline: 'Find the slow path and prove the win.', description: 'Installs a skill for measuring, locating and fixing performance bottlenecks.', tags: ['Skill', 'Benchmarks'] },
  ];

  let remoteRunning = false;
  let remoteConnections = 2;

  /* ------------------------------------------------------------ mock media */

  const paletteSets = [
    ['#1d4ed8', '#93c5fd', '#f8fafc'], ['#0f766e', '#99f6e4', '#f0fdfa'],
    ['#b45309', '#fed7aa', '#fffbeb'], ['#7e22ce', '#e9d5ff', '#faf5ff'],
    ['#be123c', '#fecdd3', '#fff1f2'], ['#334155', '#cbd5e1', '#f8fafc'],
  ];
  function svgThumb(title, palette, kind) {
    const [a, b, c] = palette;
    const bars = kind === 'audio'
      ? Array.from({ length: 36 }, (_, i) => {
        const h = 12 + Math.abs(Math.sin(i * 1.7)) * 58;
        return `<rect x="${12 + i * 7}" y="${90 - h / 2}" width="3.4" height="${h}" rx="1.7" fill="${a}" opacity="${0.35 + (i % 4) * 0.16}"/>`;
      }).join('')
      : '';
    return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 160"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="280" height="160" fill="${c}"/><circle cx="214" cy="38" r="86" fill="url(#g)" opacity="0.22"/><circle cx="66" cy="132" r="58" fill="${a}" opacity="0.12"/>${bars || `<path d="M28 108 C74 66 112 126 152 82 S224 42 258 70" fill="none" stroke="url(#g)" stroke-width="9" stroke-linecap="round" opacity="0.85"/>`}<text x="20" y="32" font-family="Inter,system-ui,sans-serif" font-size="10" font-weight="600" fill="${a}" opacity="0.9">${String(title).slice(0, 34).replace(/[<&>]/g, '')}</text></svg>`)}`;
  }
  let mediaSeq = 0;
  const mediaJobs = [];
  const mediaAssets = [
    { kind: 'image', title: 'Harbor at blue hour', prompt: 'A quiet harbor at blue hour, long exposure, minimal composition', engine: 'blank-image', engineLabel: 'Blank Visual', w: 1 },
    { kind: 'video', title: 'Rooftop wind study', prompt: 'Slow pan across a rooftop, fabric moving in the wind, soft light', engine: 'blank-image', engineLabel: 'Blank Visual' },
    { kind: 'audio', title: 'Glass morning', prompt: 'Ambient piano with warm tape hiss, slow arpeggio', engine: 'blank-audio', engineLabel: 'Blank Audio' },
    { kind: 'model3d', title: 'Parametric shell', prompt: 'A ribbed glass pavilion, rounded base, translucent shell', engine: 'blank-3d', engineLabel: 'Blank 3D' },
    { kind: 'image', title: 'Signal map', prompt: 'Abstract signal map, thin blue lines on off-white', engine: 'blank-image', engineLabel: 'Blank Visual' },
    { kind: 'image', title: 'Paper interior', prompt: 'Editorial photo of a paper-white interior with a single blue chair', engine: 'blank-image', engineLabel: 'Blank Visual' },
    { kind: 'audio', title: 'Night transit', prompt: 'Minimal electronic loop, 92 bpm, soft analog bass', engine: 'blank-audio', engineLabel: 'Blank Audio' },
    { kind: 'video', title: 'Line field', prompt: 'A field of thin lines bending in wind, monochrome, loop', engine: 'blank-image', engineLabel: 'Blank Visual' },
  ].map((asset, index) => {
    const palette = paletteSets[index % paletteSets.length];
    const id = `asset_${String(index + 1).padStart(3, '0')}`;
    const thumb = svgThumb(asset.title, palette, asset.kind);
    if (asset.kind === 'audio') config.media.keyIds = config.media.keyIds || [];
    return {
      id, kind: asset.kind, kindLabel: { image: 'Image', video: 'Video', audio: 'Music', model3d: '3D' }[asset.kind],
      title: asset.title, prompt: asset.prompt, engine: asset.engine, engineLabel: asset.engineLabel,
      provider: '', model: 'blank-1', fileName: `${id}.bin`, mime: 'application/octet-stream',
      bytes: 420000 + index * 180000, width: 1024, height: 1024, duration: asset.kind === 'video' ? 4 : asset.kind === 'audio' ? 20 + index : 0,
      seed: 1000 + index, favorite: index === 0 || index === 3, source: 'generated', parentId: '',
      createdAt: iso(-3600000 * (index * 7 + 1)), meta: {}, extraFiles: [],
      urls: { file: thumb, thumb, poster: thumb, waveform: asset.kind === 'audio' ? thumb : '', preview: thumb },
    };
  });
  function mediaCounts() {
    const counts = { image: 0, video: 0, audio: 0, model3d: 0 };
    for (const asset of mediaAssets) counts[asset.kind] += 1;
    return counts;
  }
  function mediaStorage() {
    return {
      root: 'C:\\Users\\you\\.blank\\media', count: mediaAssets.length, counts: mediaCounts(),
      bytes: mediaAssets.reduce((sum, asset) => sum + asset.bytes, 0),
      capabilities: { sharp: true, ffmpeg: false }, cloudReady: [],
    };
  }
  function mediaEngines() {
    return {
      local: [
        { id: 'blank', label: 'Blank Engine', vendor: 'local', kinds: ['image', 'video', 'audio', 'model3d'], available: true, note: 'Offline procedural art, music and 3D. No key, no network.', models: ['blank-1'] },
        { id: 'blank-image', label: 'Blank Visual', vendor: 'local', kinds: ['image', 'video'], available: true, note: 'Deterministic poster art.', models: ['blank-1'] },
        { id: 'blank-audio', label: 'Blank Audio', vendor: 'local', kinds: ['audio'], available: false, note: 'Needs ffmpeg on this machine.', models: ['blank-1'] },
        { id: 'blank-3d', label: 'Blank 3D', vendor: 'local', kinds: ['model3d'], available: true, note: 'Parametric objects as OBJ and STL.', models: ['blank-1'] },
        { id: 'blank-voice', label: 'Blank Voice', vendor: 'local', kinds: ['audio'], available: true, note: 'System text to speech.', models: ['system'] },
        { id: 'comfyui', label: 'ComfyUI', vendor: 'comfyui', kinds: ['image'], available: false, note: 'Your own ComfyUI server.', endpoint: '', models: ['auto'] },
      ],
      cloud: [
        { id: 'fal', label: 'fal.ai', vendor: 'cloud', kinds: ['image', 'video'], available: false, hasKey: false, note: 'Cloud image and video models.', models: ['flux-pro', 'kling-video'], keyLabel: 'FAL_KEY' },
        { id: 'elevenlabs', label: 'ElevenLabs', vendor: 'cloud', kinds: ['audio'], available: false, hasKey: false, note: 'Cloud music and speech.', models: ['music-v1'], keyLabel: 'ElevenLabs key' },
      ],
      defaults: config.media.defaults || {},
      endpoints: config.media.endpoints || { comfyui: '' },
    };
  }



  /* ------------------------------------------------------------------ files */

  const FILES = {
    'README.md': "# Atlas Platform\n\nBilling, identity, and the public API for Atlas.\n\n## Development\n\n```bash\npnpm install\npnpm dev\n```\n\n- API: `src/api`\n- Billing: `src/billing`\n- Auth: `src/auth`\n\nSee `AGENTS.md` for agent working agreements.",
    'AGENTS.md': "# AGENTS.md\n\nGuidance for coding agents working in this repository.\n\n## Working agreements\n\n- Read a file before changing it. Keep changes focused.\n- Use pnpm. Never introduce a dependency without a note in the PR.\n- Run `pnpm test` before claiming work is done.\n\n## Commands\n\n- Dev: `pnpm dev`\n- Test: `pnpm test`\n- Lint: `pnpm lint`\n\n## Invariants\n\n- Billing writes must be idempotent by Stripe `event.id`.\n- Public API responses never include internal account ids.\n",
    'package.json': '{\n  "name": "atlas-platform",\n  "private": true,\n  "packageManager": "pnpm@9.12.0",\n  "scripts": {\n    "dev": "tsx watch src/server.ts",\n    "build": "tsc -p tsconfig.build.json",\n    "test": "vitest run",\n    "lint": "eslint . --max-warnings=0"\n  },\n  "dependencies": {\n    "express": "^4.21.2",\n    "stripe": "^17.4.0",\n    "zod": "^3.23.8"\n  }\n}',
    'tsconfig.json': '{\n  "compilerOptions": {\n    "target": "ES2022",\n    "module": "NodeNext",\n    "strict": true,\n    "noUncheckedIndexedAccess": true,\n    "outDir": "dist"\n  }\n}',
    'src/server.ts': "import express from 'express';\nimport { stripeRouter } from './billing/webhooks.js';\n\nconst app = express();\napp.use('/webhooks', stripeRouter);\n\napp.listen(3000, () => {\n  console.log('atlas api listening on :3000');\n});",
    'src/billing/webhooks.ts': [
      "import type { Request, Response } from 'express';",
      "import { prisma } from '../lib/db.js';",
      "import { stripe } from '../lib/stripe.js';",
      "import { enqueue } from './queue.js';",
      '',
      'export async function handleStripeEvent(req: Request, res: Response) {',
      '  const event = req.body as Stripe.Event;',
      '',
      '  // TODO: duplicate deliveries currently create duplicate ledger rows',
      '  await prisma.ledger.create({',
      '    data: {',
      '      kind: event.type,',
      '      payload: event as never,',
      '      amount: readAmount(event),',
      '    },',
      '  });',
      '',
      '  await enqueue(event.id, event.type);',
      '  res.json({ received: true });',
      '}',
      '',
      'function readAmount(event: Stripe.Event): number {',
      "  if (event.type !== 'invoice.paid') return 0;",
      '  return event.data.object.amount_paid;',
      '}',
    ].join('\n'),
    'src/billing/webhooks.test.ts': [
      "import { describe, expect, it } from 'vitest';",
      "import { handleStripeEvent } from './webhooks.js';",
      '',
      "describe('stripe webhooks', () => {",
      "  it('accepts a signed event', async () => {",
      "    const response = await postEvent(fixture('invoice.paid'));",
      '    expect(response.status).toBe(200);',
      '  });',
      '',
      "  it('is idempotent for duplicate deliveries', async () => {",
      "    const event = fixture('invoice.paid');",
      '    await postEvent(event);',
      '    await postEvent(event);',
      "    expect(await ledgerCount(event.id)).toBe(1);",
      '  });',
      '});',
    ].join('\n'),
    'src/billing/queue.ts': "export type QueuedEvent = { id: string; type: string };\n\nconst jobs: QueuedEvent[] = [];\n\nexport async function enqueue(id: string, type: string) {\n  if (!jobs.some((job) => job.id === id)) jobs.push({ id, type });\n}\n",
    'src/billing/ledger.ts': "import { prisma } from '../lib/db.js';\n\nexport async function recordEvent(eventId: string, type: string, amount: number) {\n  return prisma.ledger.upsert({\n    where: { eventId },\n    update: {},\n    create: { eventId, type, amount },\n  });\n}\n",
    'src/auth/callback.ts': "import type { Request, Response } from 'express';\nimport { exchangeCode } from './oauth.js';\n\nexport async function callback(req: Request, res: Response) {\n  const { code, state } = req.query;\n  const session = await exchangeCode(String(code));\n  res.redirect(session.returnTo ?? '/');\n}\n",
    'src/auth/oauth.ts': "import { createHash, randomBytes } from 'node:crypto';\n\nexport function createVerifier() {\n  return randomBytes(32).toString('base64url');\n}\n\nexport function challengeFor(verifier: string) {\n  return createHash('sha256').update(verifier).digest('base64url');\n}\n\nexport async function exchangeCode(code: string) {\n  return { accessToken: code, returnTo: '/' };\n}\n",
    'src/api/rate-limit.ts': "export type Bucket = { tokens: number; updatedAt: number };\n\nconst buckets = new Map<string, Bucket>();\n\nexport function consume(key: string, capacity = 120, refillPerSecond = 2) {\n  const now = Date.now();\n  const bucket = buckets.get(key) ?? { tokens: capacity, updatedAt: now };\n  const refill = ((now - bucket.updatedAt) / 1000) * refillPerSecond;\n  bucket.tokens = Math.min(capacity, bucket.tokens + refill);\n  bucket.updatedAt = now;\n  if (bucket.tokens < 1) return false;\n  bucket.tokens -= 1;\n  buckets.set(key, bucket);\n  return true;\n}\n",
    'docs/architecture.md': '# Architecture\n\nRequests enter through the API edge, then fan out to billing or identity. Billing events are persisted and queued in one transaction. Every public route is rate limited per API key.\n\n## Services\n\n- `api` — public REST surface\n- `billing` — Stripe ingestion and ledger\n- `identity` — OAuth and sessions\n',
    'docs/release-notes.md': '# Release notes\n\n## v2.4 — current\n\n- Add PKCE to the hosted OAuth flow\n- Idempotent Stripe event ingestion\n- Rate limit headers on every public response\n',
    'tests/webhooks.spec.ts': "import { test } from '@playwright/test';\n\ntest('webhook endpoint rejects unsigned payloads', async ({ request }) => {\n  const response = await request.post('/webhooks/stripe', { data: {} });\n  test.expect(response.status()).toBe(400);\n});\n",
  };

  function tree() {
    const mk = (name, path, type, extra) => ({ name, path, type, ...extra });
    return [
      mk('src', 'src', 'dir', { children: [
        mk('api', 'src/api', 'dir', { children: [
          mk('rate-limit.ts', 'src/api/rate-limit.ts', 'file', { size: 512 }),
          mk('routes.ts', 'src/api/routes.ts', 'file', { size: 2048 }),
        ] }),
        mk('auth', 'src/auth', 'dir', { children: [
          mk('callback.ts', 'src/auth/callback.ts', 'file', { size: 640 }),
          mk('oauth.ts', 'src/auth/oauth.ts', 'file', { size: 890 }),
        ] }),
        mk('billing', 'src/billing', 'dir', { children: [
          mk('ledger.ts', 'src/billing/ledger.ts', 'file', { size: 520 }),
          mk('queue.ts', 'src/billing/queue.ts', 'file', { size: 340 }),
          mk('webhooks.test.ts', 'src/billing/webhooks.test.ts', 'file', { size: 940 }),
          mk('webhooks.ts', 'src/billing/webhooks.ts', 'file', { size: 1240 }),
        ] }),
        mk('server.ts', 'src/server.ts', 'file', { size: 420 }),
      ] }),
      mk('docs', 'docs', 'dir', { children: [
        mk('architecture.md', 'docs/architecture.md', 'file', { size: 1420 }),
        mk('release-notes.md', 'docs/release-notes.md', 'file', { size: 780 }),
      ] }),
      mk('tests', 'tests', 'dir', { children: [
        mk('webhooks.spec.ts', 'tests/webhooks.spec.ts', 'file', { size: 620 }),
      ] }),
      mk('AGENTS.md', 'AGENTS.md', 'file', { size: 840 }),
      mk('README.md', 'README.md', 'file', { size: 980 }),
      mk('package.json', 'package.json', 'file', { size: 640 }),
      mk('tsconfig.json', 'tsconfig.json', 'file', { size: 240 }),
    ];
  }

  /* ------------------------------------------------------------------- skills */

  const SKILLS = [
    {
      id: 'bundled/code-review', slug: 'code-review', name: 'Code review', source: 'bundled', enabled: true,
      description: 'Review a diff or module for correctness, security, regressions, and missing tests. Use before shipping a change.',
      version: '1.0', updatedAt: iso(-86400000 * 20), path: 'assets/skills/code-review/SKILL.md',
      body: '# Code review\n\nReview for truth, not for style points. A short review that finds the real bug beats a long checklist.\n\n## 1. Establish the change\n\n- Identify the exact diff (`git diff`, `git diff --staged`, or the files named).\n- Read the full surrounding function and its callers — not only changed lines.\n- Note the intent: bug fix, feature, refactor, or dependency bump.\n\n## 2. Look for what breaks\n\n1. **Correctness** — wrong state, off-by-one, races, unhandled error paths.\n2. **Security** — injection, missing authorization, secret exposure, path traversal, SSRF.\n3. **Data** — migrations that lose data, missing transactions, non-idempotent retries, N+1 queries.\n4. **Compatibility** — public API changes, schema drift, platform differences.\n5. **Tests** — behavior changed without a failing test that now passes.\n\n## 3. Output\n\n- Start with a one-line verdict: ship / ship with nits / needs work.\n- List findings by severity: `blocker`, `major`, `minor`.\n- Each finding: `path:line` → what happens → why it matters → minimal fix.\n- Separate **questions** from findings when intent is unclear.\n\n## Guardrails\n\n- Never modify code during a review unless asked.\n- Read tests and relevant call sites before claiming a regression.',
    },
    {
      id: 'bundled/debug', slug: 'debug', name: 'Debug', source: 'bundled', enabled: true,
      description: 'Diagnose a failing test, crash, or unexpected behavior by reproducing it, narrowing the cause, and fixing the root issue.',
      version: '1.0', updatedAt: iso(-86400000 * 20), path: 'assets/skills/debug/SKILL.md',
      body: '# Debug\n\nA disciplined loop: reproduce, isolate, explain, fix, prove.\n\n## 1. Reproduce\n\n- Get the exact command, input, and environment.\n- Run it yourself. Capture the full error and exit code.\n- If it is intermittent, find the smallest reliable reproducer.\n\n## 2. Isolate\n\n- Read the failing code and its direct dependencies before guessing.\n- Use `grep` to find all call sites; check recent changes with `git log -p` when relevant.\n- Form one hypothesis at a time. Change one thing per experiment.\n\n## 3. Explain\n\nWrite down the causal chain: trigger → faulty state → observed symptom. If you cannot explain it, you have not found the root cause.\n\n## 4. Fix and prove\n\n- Make the smallest correct fix at the right layer.\n- Add a regression test that fails before and passes after.\n- Re-run the broader suite when the change touches shared state.\n\n## Guardrails\n\n- Do not silence errors with broad try/catch or empty fallbacks.\n- Remove debug logging before finishing.',
    },
    {
      id: 'bundled/research', slug: 'research', name: 'Research', source: 'bundled', enabled: true,
      description: 'Investigate documentation, APIs, or unfamiliar code and return a concise, source-backed answer with clear tradeoffs.',
      version: '1.0', updatedAt: iso(-86400000 * 20), path: 'assets/skills/research/SKILL.md',
      body: '# Research\n\nAnswer the question that was asked, with evidence and a recommendation.\n\n## 1. Frame the question\n\n- Restate the decision or fact in one sentence.\n- Identify what would change the answer.\n\n## 2. Gather primary evidence\n\n- Prefer official docs, source code, changelogs, and specifications over blog summaries.\n- Use `web_fetch` for pages; quote the relevant passage.\n- For code, cite `path:line`. Do not infer behavior from names alone.\n\n## 3. Reconcile\n\n- Note version requirements and contradictions across sources.\n- Separate what you verified from what you assume.\n\n## 4. Deliver\n\n- Lead with the answer.\n- Include a short evidence list with links.\n- Give the recommendation and the believable alternative.\n\n## Guardrails\n\n- Never invent URLs or API fields. If a source is unreachable, say so.\n- Distinguish current behavior from announced or deprecated behavior.',
    },
    {
      id: 'bundled/ship', slug: 'ship', name: 'Ship', source: 'bundled', enabled: true,
      description: 'Prepare a change for production: run checks, review the diff, write release notes, and verify the rollback path.',
      version: '1.0', updatedAt: iso(-86400000 * 20), path: 'assets/skills/ship/SKILL.md',
      body: '# Ship\n\nThe last mile is part of the work.\n\n## Checklist\n\n1. **Scope** — the diff matches the request; no drive-by refactors or debug code.\n2. **Checks** — typecheck, lint, unit tests, and the relevant integration test have run. Report exact results.\n3. **Diff review** — read every changed file as a reviewer would. Look for secrets, stray files, and accidental edits.\n4. **Migration** — if data or config changes, verify forward and backward paths.\n5. **Release note** — one paragraph: what changed, why, and any user-visible behavior.\n6. **Rollback** — name the revert path or feature flag that disables the change.\n\n## Output template\n\n```\nShipped: <one line>\nChecks:  <commands and outcomes>\nRisk:    <one line>\nRollback:<one line>\n```\n\n## Guardrails\n\n- Do not claim checks ran if they did not.\n- Do not commit generated artifacts or credentials.\n- Ask before force-pushing, deleting branches, or rewriting history.',
    },
    {
      id: 'global/api-design', slug: 'api-design', name: 'API design', source: 'global', enabled: true,
      description: 'Shape a public HTTP API: resource modeling, naming, errors, pagination, versioning, and idempotency.',
      version: '1.1', updatedAt: iso(-86400000 * 4), path: 'C:\\Users\\you\\.blank\\skills\\api-design\\SKILL.md',
      body: '# API design\n\n## Principles\n\n- Resources are nouns; actions are HTTP methods.\n- Every response is stable and documented, including errors.\n- Pagination is cursor-based by default.\n- Mutations accept an idempotency key.\n\n## Checklist\n\n- Model the resources and their relationships before choosing routes.\n- Name fields from the client’s perspective.\n- Define errors with a stable machine-readable `code`.\n- Decide what is filterable; do not expose internal ids.\n- Write examples for the happy path and the two most likely failures.\n\n## Guardrails\n\n- No breaking changes without a version or an explicit migration.\n- Never leak stack traces to clients.\n- Rate-limit every public surface and return `Retry-After`.',
    },
    {
      id: 'global/release-notes', slug: 'release-notes', name: 'Release notes', source: 'global', enabled: true,
      description: 'Turn a noisy commit range into short, user-facing release notes grouped by impact.',
      version: '1.0', updatedAt: iso(-86400000 * 11), path: 'C:\\Users\\you\\.blank\\skills\\release-notes\\SKILL.md',
      body: '# Release notes\n\nRead the commits and the diff; write for the person using the product.\n\n## Steps\n\n1. Collect merged changes since the last tag.\n2. Drop internal refactors unless they change behavior.\n3. Group into **New**, **Improved**, and **Fixed**.\n4. One sentence per item: what changed, and why it matters.\n5. Mention required migrations and deprecations explicitly.\n\n## Guardrails\n\n- Do not use internal ticket ids as the headline.\n- Never include secrets, customer names, or unreleased roadmaps.\n- If an item is not user-visible, it belongs in the engineering log, not the notes.',
    },
  ];

  /* ------------------------------------------------------------------- memory */

  const MEMORIES = [
    {
      id: 'm_1', pinned: true, text: 'Prefers TypeScript with strict mode and no `any`; small, reviewable diffs over large rewrites.',
      tags: ['preference', 'typescript'], source: 'manual', uses: 14, createdAt: iso(-86400000 * 30), updatedAt: iso(-86400000 * 2),
    },
    {
      id: 'm_2', pinned: true, text: 'Production API base is https://api.atlas.dev/v2; staging uses a separate Stripe account and test clocks.',
      tags: ['infra', 'billing'], source: 'manual', uses: 9, createdAt: iso(-86400000 * 26), updatedAt: iso(-86400000 * 6),
    },
    {
      id: 'm_3', pinned: true, text: 'Never add a runtime dependency without a written rationale. Use pnpm, not npm, in atlas-platform.',
      tags: ['convention', 'tooling'], source: 'reflection', uses: 6, createdAt: iso(-86400000 * 21), updatedAt: iso(-86400000 * 8),
    },
    {
      id: 'm_4', pinned: false, text: 'Billing writes must be idempotent by Stripe `event.id`; duplicate deliveries are expected.',
      tags: ['billing', 'stripe', 'invariant'], source: 'session', sessionId: 's_atlas_webhooks', uses: 4,
      createdAt: iso(-86400000 * 2), updatedAt: iso(-86400000 * 1),
    },
    {
      id: 'm_5', pinned: false, text: 'The team releases on Tuesdays; retros happen Thursday afternoons.',
      tags: ['team'], source: 'manual', uses: 2, createdAt: iso(-86400000 * 18), updatedAt: iso(-86400000 * 18),
    },
    {
      id: 'm_6', pinned: false, text: 'The `/v1/webhooks` endpoint is deprecated. New integrations should consume queue events instead.',
      tags: ['api', 'billing'], source: 'manual', uses: 3, createdAt: iso(-86400000 * 15), updatedAt: iso(-86400000 * 15),
    },
    {
      id: 'm_7', pinned: false, text: 'Public API responses should never expose internal account ids or raw Stripe objects.',
      tags: ['api', 'security'], source: 'session', sessionId: 's_oauth', uses: 1, createdAt: iso(-86400000 * 6), updatedAt: iso(-86400000 * 6),
    },
    {
      id: 'm_8', pinned: false, text: 'The design system uses semantic tokens only; no raw hex values in components.',
      tags: ['frontend', 'design'], source: 'manual', uses: 0, createdAt: iso(-86400000 * 9), updatedAt: iso(-86400000 * 9),
    },
  ];

  /* ----------------------------------------------------------------- insights */

  const insights = {
    pending: [
      {
        id: 'i_1', type: 'memory', title: 'Ship billing changes behind flags', confidence: 0.86,
        content: 'Billing changes should ship behind a feature flag and be enabled per-account before a full rollout.',
        reason: 'You asked for a flag twice when changing billing behavior, and reverted a release once when flags were skipped.',
        tags: ['billing', 'release'], skillName: '', description: '',
        fingerprint: 'ship billing changes behind flags', createdAt: iso(-86400000 * 1.2),
      },
      {
        id: 'i_2', type: 'instruction', title: 'Read the tests before editing webhook code', confidence: 0.78,
        content: 'Before changing anything under src/billing, read the matching test file and the event fixtures first.',
        reason: 'In two recent sessions the first edit missed behavior that the existing tests already documented.',
        tags: ['testing', 'billing'], skillName: '', description: '',
        fingerprint: 'read the tests before editing webhook code', createdAt: iso(-86400000 * 1.2),
      },
      {
        id: 'i_3', type: 'skill', title: 'Webhook hardening', confidence: 0.72,
        content: '# Webhook hardening\n\nA repeatable review for third-party webhook handlers.\n\n## 1. Verify authenticity\n\n- Validate the signature with the raw request body, not a parsed object.\n- Reject timestamps older than the tolerance window.\n- Use a timing-safe comparison.\n\n## 2. Make processing idempotent\n\n- Persist the provider event id in a unique column before side effects.\n- Wrap the ledger write and queue publish in one transaction.\n- Make retries safe for every consumer.\n\n## 3. Bound the work\n\n- Acknowledge quickly; do heavy work in a queue.\n- Set timeouts for downstream calls.\n- Log the event id, type, and attempt count — never the payload.\n\n## 4. Prove it\n\n- Test duplicate delivery, out-of-order delivery, and an invalid signature.\n- Confirm queue deduplication.\n\n## Guardrails\n\n- Do not swallow signature failures.\n- Do not retry non-idempotent writes.\n- Never log customer data or raw card details.',
        reason: 'You have now hardened around four webhook handlers across two projects; the steps are stable enough to reuse.',
        tags: ['billing', 'webhooks'], skillName: 'Webhook hardening', description: 'A review workflow for third-party webhook handlers: authenticity, idempotency, bounded work, and proof.',
        fingerprint: 'webhook hardening', createdAt: iso(-86400000 * 1.2),
      },
    ],
    applied: [
      {
        id: 'i_a1', type: 'memory', title: 'Prefer pnpm for atlas-platform', confidence: 0.9,
        content: 'Use pnpm, not npm, in atlas-platform.', tags: ['tooling'], appliedAt: iso(-86400000 * 8),
        createdAt: iso(-86400000 * 9), reason: 'Repeated from repository conventions.',
      },
      {
        id: 'i_a2', type: 'instruction', title: 'Report exact test output', confidence: 0.82,
        content: 'When reporting completed work, include the exact checks that ran and their results.',
        tags: ['communication'], appliedAt: iso(-86400000 * 12), createdAt: iso(-86400000 * 13),
        reason: 'Two sessions ended with “tests pass” but no record of which suite ran.',
      },
    ],
    lastReflectionAt: iso(-86400000 * 1.2),
    reflections: 3,
  };

  /* -------------------------------------------------------------------- MCP */

  let mcpServers = [
    {
      id: 'mcp_echo_demo', name: 'Echo (example)', transport: 'stdio', enabled: true, connected: true,
      toolCount: 3, tools: ['echo', 'add', 'now'], error: '', command: 'node examples/mcp-echo-server.js', url: '',
    },
    {
      id: 'mcp_linear', name: 'Linear', transport: 'http', enabled: true, connected: true,
      toolCount: 4, tools: ['list_issues', 'search_issues', 'create_issue', 'get_project'],
      error: '', command: '', url: 'https://mcp.linear.app/mcp',
    },
    {
      id: 'mcp_github', name: 'GitHub', transport: 'stdio', enabled: false, connected: false,
      toolCount: 0, tools: [], error: 'Set GITHUB_TOKEN to connect.',
      command: 'npx -y @modelcontextprotocol/server-github', url: '',
    },
  ];
  const mcpCatalog = () => mcpServers
    .filter((server) => server.connected)
    .flatMap((server) => server.tools.map((tool) => ({
      name: `mcp__${server.id.split('_')[1] || server.id}__${tool}`,
      originalName: tool,
      serverName: server.name,
      serverId: server.id,
      description: {
        echo: 'Echo back a message. Useful for testing the transport.',
        add: 'Add two numbers.',
        now: 'Return the current time in ISO format.',
        list_issues: 'List issues for a Linear team.',
        search_issues: 'Search Linear issues by text.',
        create_issue: 'Create a Linear issue.',
        get_project: 'Read a Linear project and its milestones.',
      }[tool] || 'MCP tool.',
    })));

  /* ---------------------------------------------------------------- sessions */

  const webhookCode = "import type { Request, Response } from 'express';\nimport { prisma } from '../lib/db.js';\nimport { stripe } from '../lib/stripe.js';\nimport { enqueue } from './queue.js';\n\nexport async function handleStripeEvent(req: Request, res: Response) {\n  const event = req.body as Stripe.Event;\n\n  await prisma.ledger.create({\n    data: { kind: event.type, payload: event as never, amount: readAmount(event) },\n  });\n\n  await enqueue(event.id, event.type);\n  res.json({ received: true });\n}";

  const sessions = new Map();
  function putSession(session) {
    sessions.set(session.id, session);
    return session;
  }
  function sessionSummary(session) {
    const last = [...(session.messages || [])].reverse().find((m) => m.role === 'user' || m.role === 'assistant');
    return {
      id: session.id,
      title: session.title,
      preview: last ? String(last.content || '').replace(/```[\s\S]*?```/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) : '',
      updatedAt: session.updatedAt,
      createdAt: session.createdAt,
      model: session.model,
      mode: session.mode,
      pinned: Boolean(session.pinned),
      messageCount: (session.messages || []).length,
      workspace: session.workspace,
      usage: session.usage || { input: 0, output: 0 },
    };
  }
  function touch(session) {
    session.updatedAt = new Date().toISOString();
    sessions.set(session.id, session);
    emit({ type: 'session:updated', session: sessionSummary(session) });
  }

  putSession({
    id: 's_atlas_webhooks', title: 'Make Stripe webhooks idempotent', pinned: true, mode: 'agent',
    model: 'anthropic/claude-sonnet-4-5', workspace,
    createdAt: iso(-86400000 * 1.15), updatedAt: iso(-86400000 * 1.1),
    usage: { input: 18420, output: 3120 },
    summary: '', compactedCount: 0, allowTools: [],
    tasks: [
      { content: 'Trace the webhook delivery path', status: 'completed' },
      { content: 'Add a unique event-id guard', status: 'completed' },
      { content: 'Add duplicate-delivery regression test', status: 'completed' },
      { content: 'Run the billing test suite', status: 'completed' },
    ],
    files: ['src/billing/webhooks.ts', 'src/billing/webhooks.test.ts'],
    messages: [
      {
        id: 'm_demo_u', role: 'user', at: iso(-86400000 * 1.14),
        content: 'The Stripe webhook handler drops events under load. Trace `src/billing/webhooks.ts`, make processing idempotent, and add a regression test for duplicate deliveries. Keep the public API unchanged.',
      },
      {
        id: 'm_demo_a1', role: 'assistant', at: iso(-86400000 * 1.13), model: 'anthropic/claude-sonnet-4-5',
        usage: { input: 6240, output: 412 },
        reasoning: "Start with the actual delivery path. I'll read the route, the queue producer, and the tests, then make the write idempotent at the database boundary.",
        content: "I'll trace the delivery path first — the handler, the queue producer, and the existing tests — then make the write idempotent at the database boundary.",
        toolCalls: [
          { id: 'tc_demo_1', name: 'read_file', args: { path: 'src/billing/webhooks.ts' } },
          { id: 'tc_demo_2', name: 'read_file', args: { path: 'src/billing/queue.ts' } },
          { id: 'tc_demo_3', name: 'grep', args: { pattern: 'ledger\\.create|event\\.id', path: 'src/billing' } },
        ],
      },
      { id: 'm_demo_t1', role: 'tool', toolCallId: 'tc_demo_1', name: 'read_file', at: iso(-86400000 * 1.13), isError: false, content: webhookCode, meta: { path: 'src/billing/webhooks.ts' } },
      { id: 'm_demo_t2', role: 'tool', toolCallId: 'tc_demo_2', name: 'read_file', at: iso(-86400000 * 1.13), isError: false, content: "export type QueuedEvent = { id: string; type: string };\n\nconst jobs: QueuedEvent[] = [];\n\nexport async function enqueue(id: string, type: string) {\n  if (!jobs.some((job) => job.id === id)) jobs.push({ id, type });\n}", meta: { path: 'src/billing/queue.ts' } },
      { id: 'm_demo_t3', role: 'tool', toolCallId: 'tc_demo_3', name: 'grep', at: iso(-86400000 * 1.13), isError: false, content: "src/billing/webhooks.ts:10: await prisma.ledger.create({\nsrc/billing/queue.ts:6: if (!jobs.some((job) => job.id === id))\nsrc/billing/ledger.ts:3: export async function recordEvent(eventId: string, type: string, amount: number) {", meta: { count: 3 } },
      {
        id: 'm_demo_a2', role: 'assistant', at: iso(-86400000 * 1.12), model: 'anthropic/claude-sonnet-4-5',
        usage: { input: 7040, output: 1020 },
        reasoning: 'The queue already deduplicates in memory, but the ledger write happens first and has no unique key. The right fix is an upsert on event.id inside a transaction with the queue publish.',
        content: 'Found it. `enqueue` deduplicates, but the ledger write happens first and has no unique key — so a duplicate delivery inserts a second row before the queue ever sees it. I’ll move both into one transaction and upsert by `event.id`.',
        toolCalls: [
          { id: 'tc_demo_4', name: 'todo_write', args: { todos: [
            { content: 'Trace the webhook delivery path', status: 'completed' },
            { content: 'Add a unique event-id guard', status: 'in_progress' },
            { content: 'Add duplicate-delivery regression test', status: 'pending' },
            { content: 'Run the billing test suite', status: 'pending' },
          ] } },
          { id: 'tc_demo_5', name: 'edit_file', args: { path: 'src/billing/webhooks.ts', old_string: '  await prisma.ledger.create({\n    data: {\n      kind: event.type,\n      payload: event as never,\n      amount: readAmount(event),\n    },\n  });', new_string: '  await prisma.$transaction(async (tx) => {\n    await tx.ledger.upsert({\n      where: { eventId: event.id },\n      update: {},\n      create: { eventId: event.id, kind: event.type, amount: readAmount(event) },\n    });\n  });' } },
          { id: 'tc_demo_6', name: 'edit_file', args: { path: 'src/billing/webhooks.test.ts', old_string: "it('accepts a signed event', async () => {", new_string: "it('is idempotent for duplicate deliveries', async () => {\n  const event = fixture('invoice.paid');\n  await postEvent(event);\n  await postEvent(event);\n  expect(await ledgerCount(event.id)).toBe(1);\n});\n\nit('accepts a signed event', async () => {" } },
          { id: 'tc_demo_7', name: 'run_command', args: { command: 'pnpm vitest run src/billing' } },
        ],
      },
      { id: 'm_demo_t4', role: 'tool', toolCallId: 'tc_demo_4', name: 'todo_write', at: iso(-86400000 * 1.12), isError: false, content: 'Plan updated — 4 items.', meta: { tasks: [
        { content: 'Trace the webhook delivery path', status: 'completed' },
        { content: 'Add a unique event-id guard', status: 'in_progress' },
        { content: 'Add duplicate-delivery regression test', status: 'pending' },
        { content: 'Run the billing test suite', status: 'pending' },
      ] } },
      { id: 'm_demo_t5', role: 'tool', toolCallId: 'tc_demo_5', name: 'edit_file', at: iso(-86400000 * 1.12), isError: false, content: 'Updated src/billing/webhooks.ts — 8 lines added, 6 removed.', meta: { path: 'src/billing/webhooks.ts', checkpointId: 'c_demo_webhook', additions: 8, removals: 6 } },
      { id: 'm_demo_t6', role: 'tool', toolCallId: 'tc_demo_6', name: 'edit_file', at: iso(-86400000 * 1.12), isError: false, content: 'Updated src/billing/webhooks.test.ts — 9 lines added.', meta: { path: 'src/billing/webhooks.test.ts', checkpointId: 'c_demo_test', additions: 9, removals: 0 } },
      { id: 'm_demo_t7', role: 'tool', toolCallId: 'tc_demo_7', name: 'run_command', at: iso(-86400000 * 1.12), isError: false, content: "RUN  v2.1.4 C:/Users/you/Projects/atlas-platform\n\n ✓ src/billing/webhooks.test.ts (4 tests) 214ms\n   ✓ accepts a signed event\n   ✓ rejects a bad signature\n   ✓ is idempotent for duplicate deliveries\n   ✓ retries transient queue failures\n\n Test Files  1 passed (1)\n      Tests  4 passed (4)\n   Duration  1.42s", meta: { command: 'pnpm vitest run src/billing', exitCode: 0, cwd: 'atlas-platform' } },
      {
        id: 'm_demo_a3', role: 'assistant', at: iso(-86400000 * 1.11), model: 'anthropic/claude-sonnet-4-5',
        usage: { input: 5140, output: 1688 },
        reasoning: 'The transaction plus upsert closes the duplicate path. The queue publish still happens after the transaction; if it fails, the ledger row exists and a retry will skip the insert and re-enqueue. That is safe.',
        content: [
          'Done. The handler is now idempotent at the storage boundary, and the public API is unchanged.',
          '',
          '**What changed**',
          '',
          '- `src/billing/webhooks.ts` — the ledger write is an `upsert` keyed by `event.id`, wrapped in a transaction with the queue publish. Duplicate deliveries update nothing instead of inserting a second row.',
          '- `src/billing/webhooks.test.ts` — added a duplicate-delivery regression test and kept the signature checks intact.',
          '',
          '```ts',
          'await prisma.$transaction(async (tx) => {',
          '  await tx.ledger.upsert({',
          '    where: { eventId: event.id },',
          '    update: {},',
          '    create: { eventId: event.id, kind: event.type, amount: readAmount(event) },',
          '  });',
          '});',
          '```',
          '',
          '**Verification**',
          '',
          '- `pnpm vitest run src/billing` → 4 passed in 1.42s',
          '- Duplicate delivery test fails without the guard, passes with it.',
          '',
          'Both edits have checkpoints, so you can restore either file from the Files panel if you want to adjust the approach. I left the queue backoff untouched since it already deduplicates.',
        ].join('\n'),
      },
    ],
  });

  putSession({
    id: 's_oauth', title: 'Add PKCE checks to the OAuth callback', pinned: false, mode: 'agent',
    model: 'openai/gpt-5.1', workspace,
    createdAt: iso(-86400000 * 0.1), updatedAt: iso(-3600000 * 2),
    usage: { input: 6120, output: 1240 },
    summary: '', compactedCount: 0, allowTools: ['read_file', 'grep'],
    tasks: [
      { content: 'Read the callback and verifier storage', status: 'completed' },
      { content: 'Verify PKCE challenge before exchanging the code', status: 'completed' },
    ],
    files: ['src/auth/callback.ts'],
    messages: [
      { id: 'm_oauth_u', role: 'user', at: iso(-3600000 * 2.4), content: 'Add PKCE verification to the OAuth callback and reject replayed state values. Keep existing sessions valid.' },
      {
        id: 'm_oauth_a1', role: 'assistant', at: iso(-3600000 * 2.2), model: 'openai/gpt-5.1', usage: { input: 3120, output: 860 },
        content: 'The callback currently exchanges the code without checking the verifier. I’ll verify the stored challenge and consume the state once, without changing the session format.',
        toolCalls: [
          { id: 'tc_oauth_1', name: 'read_file', args: { path: 'src/auth/callback.ts' } },
          { id: 'tc_oauth_2', name: 'read_file', args: { path: 'src/auth/oauth.ts' } },
        ],
      },
      { id: 'm_oauth_t1', role: 'tool', toolCallId: 'tc_oauth_1', name: 'read_file', isError: false, content: "export async function callback(req: Request, res: Response) {\n  const { code, state } = req.query;\n  const session = await exchangeCode(String(code));\n  res.redirect(session.returnTo ?? '/');\n}", meta: { path: 'src/auth/callback.ts' } },
      { id: 'm_oauth_t2', role: 'tool', toolCallId: 'tc_oauth_2', name: 'read_file', isError: false, content: "export function createVerifier() {\n  return randomBytes(32).toString('base64url');\n}\n\nexport function challengeFor(verifier: string) {\n  return createHash('sha256').update(verifier).digest('base64url');\n}", meta: { path: 'src/auth/oauth.ts' } },
      {
        id: 'm_oauth_a2', role: 'assistant', at: iso(-3600000 * 2.05), model: 'openai/gpt-5.1', usage: { input: 3000, output: 380 },
        content: 'I’ve mapped the flow. Before changing the exchange path, one decision matters: existing sessions were created without a verifier. Do you want those to fail closed (force re-login) or grandfather them for 24 hours? I’d recommend failing closed — it’s cleaner and this flow is low-traffic.',
      },
    ],
  });

  putSession({
    id: 's_build', title: 'Why is the production build slower?', pinned: false, mode: 'ask',
    model: 'anthropic/claude-sonnet-4-5', workspace,
    createdAt: iso(-86400000 * 2.3), updatedAt: iso(-86400000 * 2.1),
    usage: { input: 9840, output: 1810 }, summary: '', compactedCount: 0, allowTools: [],
    tasks: [], files: [],
    messages: [
      { id: 'm_build_u', role: 'user', at: iso(-86400000 * 2.3), content: 'Why is the production build suddenly 40s slower? It was 12s last week.' },
      { id: 'm_build_a', role: 'assistant', at: iso(-86400000 * 2.1), model: 'anthropic/claude-sonnet-4-5', usage: { input: 9840, output: 1810 },
        reasoning: 'No tools in Ask mode; reason from the build script and the symptoms described.',
        content: 'The most likely cause is a dependency that stopped being externalized. A 3× build-time jump usually comes from the bundler suddenly parsing a large library instead of receiving it as an external import.\n\nI’d check three things, in order:\n\n1. **Recent lockfile changes** — a minor bump can switch a package from ESM to CJS (or add a new export condition), which changes how the bundler treats it.\n2. **The `external` list** — if it is generated from `dependencies`, a moved package (dev → prod or vice versa) silently changes the build graph.\n3. **Source maps** — enabling them for production can add 30–50% to the build. Check whether the flag changed.\n\nIn Agent mode I can run `pnpm why` and time the build with the analyzer to confirm rather than guess.' },
    ],
  });

  putSession({
    id: 's_ratelimit', title: 'Design a token bucket rate limiter', pinned: false, mode: 'plan',
    model: 'google/gemini-2.5-pro', workspace,
    createdAt: iso(-86400000 * 3.2), updatedAt: iso(-86400000 * 3.1),
    usage: { input: 12400, output: 2400 }, summary: '', compactedCount: 0, allowTools: [],
    tasks: [
      { content: 'Define limits per plan tier', status: 'completed' },
      { content: 'Choose storage for distributed buckets', status: 'in_progress' },
      { content: 'Specify headers and 429 behavior', status: 'pending' },
    ],
    files: ['src/api/rate-limit.ts'],
    messages: [
      { id: 'm_rate_u', role: 'user', at: iso(-86400000 * 3.2), content: 'Design a token bucket rate limiter for the public API. No code yet — I want the plan and the failure modes.' },
      {
        id: 'm_rate_a', role: 'assistant', at: iso(-86400000 * 3.1), model: 'google/gemini-2.5-pro', usage: { input: 12400, output: 2400 },
        content: [
          '## Proposed design',
          '',
          '**Key:** `api_key_id` plus route class (`read` / `write` / `webhook-test`). Limits are per class so a burst of reads never starves a write.',
          '',
          '**Algorithm:** token bucket, capacity = 2× the sustained rate, refill continuous. Read: 120/min, write: 30/min, burst ×2.',
          '',
          '**Storage:** Redis with a Lua script for atomic refill + consume. A single round trip per request; buckets expire after 10 idle minutes.',
          '',
          '**Response contract:**',
          '- `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` on every response.',
          '- `429` with `Retry-After` when empty. No `Retry-After: 0`.',
          '- Internal callers use a separate class with higher limits; never bypass the limiter entirely.',
          '',
          '### Failure modes',
          '',
          '1. **Redis unavailable** — fail open for reads for 30s, fail closed for writes. Log loudly and page.',
          '2. **Clock skew** — store logical time in Redis, not each app node.',
          '3. **Hot keys** — one abusive key at 10× capacity can saturate a shard; isolate per-key buckets in cluster slots and cap request body size before the limiter.',
          '4. **Retry storms** — `Retry-After` must include jitter guidance in docs; clients that ignore it are throttled harder.',
          '',
          '### Open question',
          '',
          'Do you want per-account aggregate limits in addition to per-key? That changes the storage key design, so it is worth deciding before implementation.',
        ].join('\n'),
      },
    ],
  });

  putSession({
    id: 's_incident', title: 'Draft the webhook incident review', pinned: false, mode: 'agent',
    model: 'anthropic/claude-sonnet-4-5', workspace,
    createdAt: iso(-86400000 * 5.1), updatedAt: iso(-86400000 * 5),
    usage: { input: 14600, output: 2900 }, summary: '', compactedCount: 0, allowTools: [],
    tasks: [], files: [],
    messages: [
      { id: 'm_inc_u', role: 'user', at: iso(-86400000 * 5.1), content: 'Draft an incident review for Tuesday’s missed Stripe events. Use the timeline in #billing-incident. Blameless, concrete follow-ups.' },
      {
        id: 'm_inc_a', role: 'assistant', at: iso(-86400000 * 5), model: 'anthropic/claude-sonnet-4-5', usage: { input: 14600, output: 2900 },
        content: '# Incident review — missed Stripe events\n\n**Impact:** 2.5% of invoice.paid events were not processed for 38 minutes. No incorrect charges; 14 subscriptions renewed late.\n\n## Timeline\n\n- **14:02** — Deploy of the webhook consumer (v2.3.7).\n- **14:09** — Duplicate ledger rows appear; alert fires on row count, not on processing lag.\n- **14:18** — Queue depth crosses threshold; first responder starts triage.\n- **14:40** — Consumer rolled back; backlog drains in 11 minutes.\n\n## What happened\n\nThe consumer retried non-idempotent writes. Duplicate deliveries created extra ledger rows, and retries amplified queue depth. The alert measured row count instead of processing lag, so it fired late.\n\n## What went well\n\n- Rollback was one command and had been rehearsed.\n- Backlog drained without manual replay.\n\n## Follow-ups\n\n1. Make ledger writes idempotent by `event.id` — owner: billing, due Friday.\n2. Alert on queue age, not row count — owner: platform.\n3. Add a duplicate-delivery test to the release gate — owner: billing.\n4. Simulate a 10k-event backlog in staging before the next consumer change.\n\n## What we are not doing\n\nWe are not adding automatic replay until idempotency is proven in production. Replay on a non-idempotent consumer would repeat the incident at a larger scale.',
      },
    ],
  });

  putSession({
    id: 's_notes', title: 'Release train notes — v2.4', pinned: true, mode: 'ask',
    model: 'sandbox/blank-1', workspace,
    createdAt: iso(-86400000 * 8.2), updatedAt: iso(-86400000 * 8),
    usage: { input: 4200, output: 980 }, summary: '', compactedCount: 0, allowTools: [],
    tasks: [], files: [],
    messages: [
      { id: 'm_notes_u', role: 'user', at: iso(-86400000 * 8.2), content: 'Turn the v2.4 commit range into release notes for customers. Group by impact.' },
      {
        id: 'm_notes_a', role: 'assistant', at: iso(-86400000 * 8), model: 'sandbox/blank-1', usage: { input: 4200, output: 980 },
        content: '# Atlas Platform v2.4\n\n## New\n\n- **Hosted OAuth with PKCE** — the hosted login flow now uses proof-key exchange for every authorization code. Existing sessions remain valid.\n- **Rate limit headers** — every public response includes remaining quota and reset time.\n\n## Improved\n\n- Webhook ingestion is now idempotent. Duplicate Stripe deliveries no longer create duplicate ledger entries.\n- Queue retries use jittered backoff and preserve ordering per event id.\n\n## Fixed\n\n- OAuth state values are single-use; replays are rejected.\n- `/v1/webhooks` returns a deprecation header in addition to the existing documentation notice.\n\n## Required actions\n\nNone. No schema migration is required for this release.\n',
      },
    ],
  });

  /* --------------------------------------------------------------- API data */

  let activeRun = null;
  let pendingApproval = null;

  function allModels() {
    const out = [];
    for (const provider of [...PROVIDERS, ...config.customProviders]) {
      const discovered = config.discoveredModels[provider.id] || [];
      const models = [...provider.models, ...discovered.filter((m) => !provider.models.some((x) => x.id === m.id))];
      for (const model of models) {
        out.push({ ...model, providerId: provider.id, providerName: provider.name, monogram: provider.monogram, local: provider.kind === 'local', fullId: `${provider.id}/${model.id}` });
      }
    }
    return out;
  }

  function publicProviders() {
    return [...PROVIDERS, ...config.customProviders].map((provider) => ({
      id: provider.id,
      name: provider.name,
      monogram: provider.monogram,
      protocol: provider.protocol,
      kind: provider.kind || 'cloud',
      description: provider.description,
      baseUrl: config.providers[provider.id]?.baseUrl || provider.baseUrl || '',
      keyEnv: provider.keyEnv || '',
      docs: provider.docs || '',
      models: provider.models || [],
    }));
  }

  function stateConfig() {
    return JSON.parse(JSON.stringify(config));
  }

  function findModel(fullId) {
    return allModels().find((model) => model.fullId === fullId) || null;
  }

  function listSessions() {
    return [...sessions.values()].map(sessionSummary).sort((a, b) => {
      if (Boolean(b.pinned) !== Boolean(a.pinned)) return b.pinned ? 1 : -1;
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });
  }

  function stats() {
    const activity = [];
    const counts = [0, 2, 5, 3, 8, 4, 0, 1, 6, 9, 5, 3, 7, 4];
    for (let i = 13; i >= 0; i -= 1) {
      const date = new Date(NOW - i * 86400000).toISOString().slice(0, 10);
      activity.push({ date, count: counts[13 - i] });
    }
    return {
      sessions: sessions.size,
      messages: 84,
      toolCalls: 37,
      toolErrors: 1,
      tokens: { input: 184320, output: 42180 },
      topTools: [
        { name: 'read_file', count: 14 }, { name: 'run_command', count: 7 }, { name: 'edit_file', count: 6 },
        { name: 'grep', count: 5 }, { name: 'todo_write', count: 3 }, { name: 'web_fetch', count: 2 },
      ],
      activity,
      memory: { total: MEMORIES.length, pinned: MEMORIES.filter((m) => m.pinned).length },
      insights: { pending: insights.pending.length, applied: insights.applied.length },
    };
  }

  function learnState() {
    return {
      pending: insights.pending,
      applied: insights.applied,
      lastReflectionAt: insights.lastReflectionAt,
      reflections: insights.reflections,
      stats: stats(),
      reflectionModel: 'anthropic/claude-sonnet-4-5',
      counts: {
        memory: MEMORIES.length,
        skills: SKILLS.length,
        enabledSkills: SKILLS.filter((skill) => skill.enabled).length,
      },
    };
  }

  function saveUserMessage(session, text, attachments) {
    session.messages.push({
      id: `msg_${Math.random().toString(36).slice(2, 9)}`,
      role: 'user', content: text, attachments: attachments || [], at: new Date().toISOString(),
    });
    if (!session.title || session.title === 'New session') {
      const title = String(text || 'New session').replace(/\s+/g, ' ').trim();
      session.title = title.length > 52 ? `${title.slice(0, 52)}…` : title;
    }
  }

  const queues = new Map();

  function queueFor(sessionId) {
    if (!queues.has(sessionId)) queues.set(sessionId, []);
    return queues.get(sessionId);
  }
  function publicQueue(sessionId) {
    return queueFor(sessionId).map((item) => ({ queueId: item.queueId, text: item.text, queuedAt: item.queuedAt }));
  }
  function emitQueue(sessionId) {
    emit({ type: 'chat:queue:update', sessionId, queue: publicQueue(sessionId) });
  }

  function drainMockQueue() {
    if (activeRun) return false;
    for (const [sessionId, queue] of queues) {
      if (!queue.length) continue;
      const session = sessions.get(sessionId);
      if (!session) { queue.length = 0; continue; }
      const item = queue.shift();
      saveUserMessage(session, item.text, item.attachments || []);
      touch(session);
      const runId = `run_${Math.random().toString(36).slice(2, 9)}`;
      activeRun = { id: runId, session, cancelled: false };
      emit({
        type: 'chat:queued:sent', sessionId, queueId: item.queueId, source: 'queue',
        message: session.messages[session.messages.length - 1], title: session.title,
        queueLength: queue.length,
      });
      emitQueue(sessionId);
      emit({ type: 'session:updated', session: sessionSummary(session) });
      const reply = demoReply(item.text);
      setTimeout(() => startMockRun(runId, reply), 220);
      return true;
    }
    return false;
  }

  async function streamText(text, runId, messageId, delay = 18) {
    const chunks = String(text).match(/\S+\s*/g) || [text];
    let buffer = '';
    for (let i = 0; i < chunks.length; i += 1) {
      if (!activeRun || activeRun.id !== runId || activeRun.cancelled) return false;
      buffer += chunks[i];
      if (buffer.length > 18 || i === chunks.length - 1) {
        emit({ type: 'text', sessionId: activeRun.session.id, runId, messageId, text: buffer });
        buffer = '';
        await sleep(delay);
      }
    }
    return true;
  }

  function streamReasoning(text, runId, messageId) {
    emit({ type: 'reasoning', sessionId: activeRun.session.id, runId, messageId, text });
  }

  function toolStart(call) {
    emit({ type: 'tool:start', sessionId: activeRun.session.id, runId: activeRun.id, callId: call.id, name: call.name, label: call.label || call.name, args: call.args, summary: call.summary || '' });
  }
  function toolEnd(call, content, meta, isError) {
    emit({ type: 'tool:end', sessionId: activeRun.session.id, runId: activeRun.id, callId: call.id, name: call.name, content, meta: meta || {}, isError: Boolean(isError) });
  }

  function outlineTour() {
    const session = activeRun.session;
    const runId = activeRun.id;
    return (async () => {
      emit({ type: 'run:start', sessionId: session.id, runId, model: session.model, mode: session.mode, title: session.title });
      emit({ type: 'assistant:start', sessionId: session.id, runId, messageId: 'live_a1', model: session.model, step: 0 });
      streamReasoning('The user wants to see the harness work. Plan a short sequence, inspect the workspace, then recall durable memory — using real tools rather than describing them.', runId, 'live_a1');
      await streamText("Good — let's run the real harness loop, not a mock-up.\n\nFirst I'll record a plan for this session.", runId, 'live_a1');
      const todos = [
        { content: 'Inspect the workspace', status: 'in_progress' },
        { content: 'Recall relevant memory', status: 'pending' },
        { content: 'Summarize what happened', status: 'pending' },
      ];
      const calls = [
        { id: 'live_t1', name: 'todo_write', args: { todos } },
        { id: 'live_t2', name: 'list_dir', args: { path: '.' } },
        { id: 'live_t3', name: 'memory_search', args: { query: 'project conventions' } },
      ];
      const assistant = { id: 'live_a1', role: 'assistant', content: "Good — let's run the real harness loop, not a mock-up.\n\nFirst I'll record a plan for this session.", reasoning: '', toolCalls: calls, model: session.model, at: new Date().toISOString(), usage: { input: 0, output: 0 } };
      session.messages.push(assistant);
      emit({ type: 'assistant:end', sessionId: session.id, runId, messageId: 'live_a1', message: { ...assistant } });

      toolStart({ ...calls[0], label: 'Update plan' });
      await sleep(400);
      session.tasks = todos;
      emit({ type: 'tasks', sessionId: session.id, runId, tasks: todos });
      toolEnd(calls[0], 'Plan updated — 3 items.', { tasks: todos });

      emit({ type: 'assistant:start', sessionId: session.id, runId, messageId: 'live_a2', model: session.model, step: 1 });
      await streamText('Plan recorded. Now I’ll inspect the **workspace** with the read-only file tool. Reads are scoped to the workspace root.', runId, 'live_a2');
      toolStart({ ...calls[1], label: 'List folder' });
      await sleep(700);
      const listing = tree().map((node) => `${node.type === 'dir' ? '▸' : '·'} ${node.name}${node.type === 'dir' ? '/' : ''}`).join('\n');
      toolEnd(calls[1], listing, { path: '.', count: tree().length });
      const a2 = { id: 'live_a2', role: 'assistant', content: 'Plan recorded. Now I’ll inspect the **workspace** with the read-only file tool. Reads are scoped to the workspace root.', reasoning: '', toolCalls: [calls[1]], model: session.model, at: new Date().toISOString(), usage: { input: 0, output: 0 } };
      session.messages.push(a2);
      emit({ type: 'assistant:end', sessionId: session.id, runId, messageId: 'live_a2', message: a2 });

      emit({ type: 'assistant:start', sessionId: session.id, runId, messageId: 'live_a3', model: session.model, step: 2 });
      await streamText('Workspace checked. Next, **memory** — durable notes that survive across sessions.', runId, 'live_a3');
      toolStart({ ...calls[2], label: 'Search memory' });
      await sleep(650);
      toolEnd(calls[2], MEMORIES.slice(0, 2).map((m) => `• ${m.text}`).join('\n'), { count: 2 });
      const a3 = { id: 'live_a3', role: 'assistant', content: 'Workspace checked. Next, **memory** — durable notes that survive across sessions.', reasoning: '', toolCalls: [calls[2]], model: session.model, at: new Date().toISOString(), usage: { input: 0, output: 0 } };
      session.messages.push(a3);
      session.tasks = todos.map((todo) => ({ ...todo, status: 'completed' }));
      emit({ type: 'tasks', sessionId: session.id, runId, tasks: session.tasks });
      emit({ type: 'assistant:end', sessionId: session.id, runId, messageId: 'live_a3', message: a3 });

      emit({ type: 'assistant:start', sessionId: session.id, runId, messageId: 'live_a4', model: session.model, step: 3 });
      const finalText = [
        "That's the tour. Three real things just happened:",
        '',
        '1. `todo_write` saved a plan to this session.',
        '2. `list_dir` read the workspace, scoped to its root.',
        '3. `memory_search` queried durable memory.',
        '',
        'The **Plan** panel updates as the loop runs. Writes and commands respect the approval policy — they ask first by default, and “Always allow” applies only to this session.',
        '',
        'Connect a hosted model and this same loop extends across your codebase. Add a key in **Models**, or point Blank at a local runtime like Ollama.',
      ].join('\n');
      await streamText(finalText, runId, 'live_a4');
      const a4 = { id: 'live_a4', role: 'assistant', content: finalText, reasoning: '', toolCalls: [], model: session.model, at: new Date().toISOString(), usage: { input: 1810, output: 426 } };
      session.messages.push(a4);
      session.usage.input += 1810;
      session.usage.output += 426;
      emit({ type: 'usage', sessionId: session.id, runId, usage: { ...session.usage } });
      emit({ type: 'assistant:end', sessionId: session.id, runId, messageId: 'live_a4', message: a4 });
      touch(session);
      emit({ type: 'run:done', sessionId: session.id, runId, outcome: { ok: true, steps: 4 }, usage: session.usage, title: session.title, tasks: session.tasks, files: session.files || [], summary: false });
      activeRun = null;
    })();
  }

  function demoReply(text) {
    if (/tour|harness|둘러보기/i.test(text)) {
      return { kind: 'tour' };
    }
    if (/model|provider|claude|gpt|모델/i.test(text)) {
      return {
        kind: 'text',
        reasoning: 'Answer directly from knowledge of the configuration surface; no workspace access needed.',
        text: 'Blank is model-agnostic by design. The model chip in the composer switches the current session; **Models** manages keys and the default.\n\n- **Hosted:** Anthropic, OpenAI, Google, xAI, DeepSeek, Mistral, Groq, Together, Cerebras, OpenRouter — 13 providers in total, plus any OpenAI-compatible endpoint you add.\n- **Local:** Ollama and LM Studio. No key required; traffic stays on your machine.\n- **Sidekick:** the offline **Sandbox** model, which can walk the harness without a network.\n\nYou currently have Anthropic and OpenAI connected, with `Claude Sonnet 4.5` as the default and `GPT-5.1` as the fallback. If a run fails on the primary model, Blank retries once on the fallback before giving up.',
      };
    }
    if (/edit|fix|add|refactor|write|build|test|create|api|코드/i.test(text)) {
      return { kind: 'edit' };
    }
    const snippet = 'export async function handleRequest(req: Request) {\n  const user = await authenticate(req);\n  if (!user) return unauthorized();\n  return handle(user, req);\n}';
    return {
      kind: 'read',
      path: 'src/server.ts',
      reasoning: 'The request points at the API entry point; read it before proposing a change.',
      text: 'I’d start from the actual entry point rather than guessing. Here is the current request path — once I can see how authentication and routing are composed, the smallest safe change is usually obvious.\n\nTell me the behavior you want and I’ll trace the callers, then propose a focused patch.',
      snippet,
    };
  }

  async function runReadScenario(reply) {
    const session = activeRun.session;
    const runId = activeRun.id;
    emit({ type: 'run:start', sessionId: session.id, runId, model: session.model, mode: session.mode, title: session.title });
    await sleep(280);
    emit({ type: 'assistant:start', sessionId: session.id, runId, messageId: 'live_read', model: session.model, step: 0 });
    streamReasoning(reply.reasoning, runId, 'live_read');
    await streamText("I'll read the entry point first.", runId, 'live_read');
    const call = { id: 'live_r1', name: 'read_file', args: { path: reply.path }, label: 'Read file' };
    toolStart(call);
    await sleep(850);
    const content = FILES[reply.path] || reply.snippet;
    toolEnd(call, content, { path: reply.path });
    const a1 = { id: 'live_read', role: 'assistant', content: "I'll read the entry point first.", reasoning: reply.reasoning, toolCalls: [call], model: session.model, at: new Date().toISOString(), usage: { input: 920, output: 84 } };
    session.messages.push(a1, { id: 'live_rt1', role: 'tool', toolCallId: call.id, name: 'read_file', content, meta: { path: reply.path }, isError: false, at: new Date().toISOString() });
    emit({ type: 'assistant:end', sessionId: session.id, runId, messageId: 'live_read', message: a1 });

    emit({ type: 'assistant:start', sessionId: session.id, runId, messageId: 'live_final', model: session.model, step: 1 });
    await streamText(reply.text, runId, 'live_final');
    const a2 = { id: 'live_final', role: 'assistant', content: reply.text, reasoning: '', toolCalls: [], model: session.model, at: new Date().toISOString(), usage: { input: 1200, output: 220 } };
    session.messages.push(a2);
    session.usage.input += 2120;
    session.usage.output += 304;
    emit({ type: 'usage', sessionId: session.id, runId, usage: { ...session.usage } });
    emit({ type: 'assistant:end', sessionId: session.id, runId, messageId: 'live_final', message: a2 });
    touch(session);
    emit({ type: 'run:done', sessionId: session.id, runId, outcome: { ok: true, steps: 2 }, usage: session.usage, title: session.title, tasks: session.tasks || [], files: session.files || [], summary: false });
    activeRun = null;
  }

  async function runEditScenario() {
    const session = activeRun.session;
    const runId = activeRun.id;
    emit({ type: 'run:start', sessionId: session.id, runId, model: session.model, mode: session.mode, title: session.title });
    await sleep(280);
    emit({ type: 'assistant:start', sessionId: session.id, runId, messageId: 'live_edit', model: session.model, step: 0 });
    await streamText('The limiter exists but the header contract is missing. I’ll add `Retry-After` and remaining-budget headers to the middleware, then run the focused tests.', runId, 'live_edit');
    const readCall = { id: 'live_e1', name: 'read_file', args: { path: 'src/api/rate-limit.ts' }, label: 'Read file' };
    toolStart(readCall);
    await sleep(800);
    const readResult = FILES['src/api/rate-limit.ts'];
    toolEnd(readCall, readResult, { path: 'src/api/rate-limit.ts' });
    const a1 = { id: 'live_edit', role: 'assistant', content: 'The limiter exists but the header contract is missing. I’ll add `Retry-After` and remaining-budget headers to the middleware, then run the focused tests.', reasoning: '', toolCalls: [readCall], model: session.model, at: new Date().toISOString(), usage: { input: 1040, output: 210 } };
    session.messages.push(a1, { id: 'live_et1', role: 'tool', toolCallId: readCall.id, name: 'read_file', content: readResult, meta: { path: 'src/api/rate-limit.ts' }, isError: false, at: new Date().toISOString() });
    emit({ type: 'assistant:end', sessionId: session.id, runId, messageId: 'live_edit', message: a1 });

    const approvalId = `appr_${Math.random().toString(36).slice(2, 8)}`;
    emit({
      type: 'approval', sessionId: session.id, runId, approvalId,
      tool: 'edit_file', label: 'Edit file',
      summary: 'src/api/rate-limit.ts',
      args: {
        path: 'src/api/rate-limit.ts',
        old_string: '  if (bucket.tokens < 1) return false;',
        new_string: '  if (bucket.tokens < 1) {\n    const retryAfter = Math.ceil((1 - bucket.tokens) / refillPerSecond);\n    throw new RateLimitError(retryAfter);\n  }',
      },
    });
    const decision = await new Promise((resolve) => { pendingApproval = { resolve, approvalId }; });
    pendingApproval = null;
    if (!activeRun || activeRun.cancelled) { activeRun = null; return; }
    emit({ type: 'approval:resolved', sessionId: session.id, runId, approvalId, decision });
    if (decision === 'deny') {
      emit({ type: 'assistant:start', sessionId: session.id, runId, messageId: 'live_denied', model: session.model, step: 1 });
      const text = 'Understood — I won’t touch the file. The limiter currently returns a boolean, so the header work will need a small contract change. Tell me if you want that scoped into this change or handled separately.';
      await streamText(text, runId, 'live_denied');
      const message = { id: 'live_denied', role: 'assistant', content: text, reasoning: '', toolCalls: [], model: session.model, at: new Date().toISOString(), usage: { input: 800, output: 120 } };
      session.messages.push(message);
      emit({ type: 'assistant:end', sessionId: session.id, runId, messageId: 'live_denied', message });
      touch(session);
      emit({ type: 'run:done', sessionId: session.id, runId, outcome: { ok: true, steps: 2 }, usage: session.usage, title: session.title, tasks: session.tasks || [], files: session.files || [], summary: false });
      activeRun = null;
      return;
    }

    emit({ type: 'assistant:start', sessionId: session.id, runId, messageId: 'live_edit2', model: session.model, step: 1 });
    await streamText('Approved. Applying the two-line change and running the API test suite.', runId, 'live_edit2');
    const editCall = { id: 'live_e2', name: 'edit_file', args: { path: 'src/api/rate-limit.ts', old_string: '  if (bucket.tokens < 1) return false;', new_string: '  if (bucket.tokens < 1) throw new RateLimitError(retryAfter);' }, label: 'Edit file' };
    toolStart(editCall);
    await sleep(900);
    toolEnd(editCall, 'Updated src/api/rate-limit.ts — 3 lines added, 1 removed.', { path: 'src/api/rate-limit.ts', checkpointId: 'c_live_rate', additions: 3, removals: 1 });
    const runCall = { id: 'live_e3', name: 'run_command', args: { command: 'pnpm vitest run src/api' }, label: 'Run command' };
    toolStart(runCall);
    await sleep(1100);
    toolEnd(runCall, 'RUN  v2.1.4 C:/Users/you/Projects/atlas-platform\n\n ✓ src/api/rate-limit.test.ts (6 tests) 188ms\n\n Test Files  1 passed (1)\n      Tests  6 passed (6)\n   Duration  0.92s', { command: 'pnpm vitest run src/api', exitCode: 0, cwd: 'atlas-platform' });
    const a2 = { id: 'live_edit2', role: 'assistant', content: 'Approved. Applying the two-line change and running the API test suite.', reasoning: '', toolCalls: [editCall, runCall], model: session.model, at: new Date().toISOString(), usage: { input: 1420, output: 310 } };
    session.messages.push(a2,
      { id: 'live_et2', role: 'tool', toolCallId: editCall.id, name: 'edit_file', content: 'Updated src/api/rate-limit.ts — 3 lines added, 1 removed.', meta: { path: 'src/api/rate-limit.ts', checkpointId: 'c_live_rate', additions: 3, removals: 1 }, isError: false, at: new Date().toISOString() },
      { id: 'live_et3', role: 'tool', toolCallId: runCall.id, name: 'run_command', content: 'RUN  v2.1.4\n\n ✓ src/api/rate-limit.test.ts (6 tests) 188ms\n\n Test Files  1 passed (1)\n      Tests  6 passed (6)', meta: { command: 'pnpm vitest run src/api', exitCode: 0, cwd: 'atlas-platform' }, isError: false, at: new Date().toISOString() });
    session.files = [...new Set([...(session.files || []), 'src/api/rate-limit.ts'])];
    emit({ type: 'assistant:end', sessionId: session.id, runId, messageId: 'live_edit2', message: a2 });

    emit({ type: 'assistant:start', sessionId: session.id, runId, messageId: 'live_edit3', model: session.model, step: 2 });
    const finalText = 'Done. The limiter now signals a retry window and the focused suite passes.\n\n- `src/api/rate-limit.ts` — throws a typed `RateLimitError` carrying `retryAfter` instead of returning `false`.\n- `pnpm vitest run src/api` → 6 passed in 0.92s.\n\nOne follow-up worth considering: the error handler should translate `RateLimitError` into `429` with a `Retry-After` header. That touches the shared HTTP layer, so I left it out of this change.';
    await streamText(finalText, runId, 'live_edit3');
    const a3 = { id: 'live_edit3', role: 'assistant', content: finalText, reasoning: '', toolCalls: [], model: session.model, at: new Date().toISOString(), usage: { input: 1600, output: 380 } };
    session.messages.push(a3);
    session.usage.input += 4060;
    session.usage.output += 900;
    emit({ type: 'usage', sessionId: session.id, runId, usage: { ...session.usage } });
    emit({ type: 'assistant:end', sessionId: session.id, runId, messageId: 'live_edit3', message: a3 });
    touch(session);
    emit({ type: 'run:done', sessionId: session.id, runId, outcome: { ok: true, steps: 3 }, usage: session.usage, title: session.title, tasks: session.tasks || [], files: session.files, summary: false });
    activeRun = null;
  }

  async function startMockRun(runId, reply) {
    try {
      if (reply.kind === 'tour') await outlineTour();
      else if (reply.kind === 'edit') await runEditScenario();
      else await runReadScenario(reply);
    } catch (error) {
      emit({ type: 'error', sessionId: activeRun?.session.id, runId, message: error.message, hint: 'Preview runner failed.' });
      emit({ type: 'run:done', sessionId: activeRun?.session.id, runId, outcome: { ok: false, error: error.message } });
      activeRun = null;
    } finally {
      setTimeout(drainMockQueue, 140);
    }
  }

  /* -------------------------------------------------------------------- API */

  const api = {
    isElectron: false,
    isMock: true,
    platform: 'browser',
    versions: { electron: null, chrome: navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] || null, node: null },

    onEvent(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },

    app: {
      async info() { await sleep(40); return { name: 'Blank', version: '1.0.0', platform: 'win32', arch: 'x64', home: config.runtime.home, dataDir: config.runtime.home, electron: null, node: null, isDev: true, workspace }; },
      async openExternal(url) { window.open(url, '_blank', 'noopener'); return true; },
      async openDataFolder() { return true; },
    },

    config: {
      async get() { await sleep(30); return stateConfig(); },
      async update(patch) {
        const merge = (base, next) => {
          for (const [key, value] of Object.entries(next || {})) {
            if (value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object') merge(base[key], value);
            else base[key] = value;
          }
          return base;
        };
        merge(config, patch);
        emit({ type: 'config:updated' });
        return stateConfig();
      },
    },

    models: {
      async list() { await sleep(40); return { providers: publicProviders(), models: allModels(), config: stateConfig() }; },
      async setKey(input) {
        if (input.apiKey !== undefined && String(input.apiKey).trim()) {
          return api.models.addKey({ providerId: input.providerId, key: input.apiKey, label: 'Default', makeActive: true }).then((result) => result.config);
        }
        const entry = config.providers[input.providerId] || {};
        if (input.apiKey !== undefined) {
          entry.keys = [];
          entry.hasKey = false;
          entry.keySource = null;
          entry.keyPreview = '';
          entry.keyCount = 0;
          entry.activeKeyId = '';
          entry.connected = ['ollama', 'lmstudio'].includes(input.providerId);
        }
        if (input.baseUrl !== undefined) entry.baseUrl = input.baseUrl;
        config.providers[input.providerId] = entry;
        emit({ type: 'config:updated' });
        return stateConfig();
      },
      async addKey(input) {
        const providerId = input.providerId;
        const entry = config.providers[providerId] || (config.providers[providerId] = {});
        const value = String(input.key || '').trim();
        if (!value) throw new Error('Paste an API key first.');
        entry.keys = entry.keys || [];
        const key = {
          id: `k_${Math.random().toString(36).slice(2, 9)}`,
          label: String(input.label || 'API key').slice(0, 40) || 'API key',
          preview: `${value.slice(0, 4)}…${value.slice(-4)}`,
          active: input.makeActive !== false,
          source: 'stored',
          removable: true,
          createdAt: new Date().toISOString(),
          lastUsedAt: '',
          lastError: '',
        };
        if (input.makeActive !== false) for (const other of entry.keys) other.active = false;
        entry.keys.push(key);
        entry.hasKey = true;
        entry.keySource = 'stored';
        entry.keyPreview = key.preview;
        entry.connected = true;
        entry.activeKeyId = key.id;
        entry.keyCount = entry.keys.length;
        emit({ type: 'config:updated' });
        return { config: stateConfig(), providers: publicProviders() };
      },
      async removeKey(input) {
        const entry = config.providers[input.providerId] || {};
        const removed = (entry.keys || []).find((key) => key.id === input.keyId);
        if (!removed) throw new Error('Key not found.');
        entry.keys = entry.keys.filter((key) => key.id !== input.keyId);
        if (removed.active) {
          const next = entry.keys[0];
          if (next) next.active = true;
          entry.activeKeyId = next?.id || '';
          entry.keyPreview = next?.preview || '';
        }
        entry.keyCount = entry.keys.length;
        entry.hasKey = entry.keys.length > 0;
        entry.keySource = entry.keys[0]?.source || null;
        entry.connected = entry.hasKey || ['ollama', 'lmstudio'].includes(input.providerId);
        emit({ type: 'config:updated' });
        return stateConfig();
      },
      async setActiveKey(input) {
        const entry = config.providers[input.providerId] || {};
        const target = (entry.keys || []).find((key) => key.id === input.keyId);
        if (!target) throw new Error('Key not found.');
        for (const key of entry.keys) key.active = key.id === target.id;
        entry.activeKeyId = target.id;
        entry.keyPreview = target.preview;
        emit({ type: 'config:updated' });
        return stateConfig();
      },
      async setAutoRotate(input) {
        const entry = config.providers[input.providerId] || (config.providers[input.providerId] = {});
        entry.autoRotate = Boolean(input.autoRotate);
        emit({ type: 'config:updated' });
        return stateConfig();
      },
      async probe(input) {
        await sleep(650);
        const baseUrl = String(input.baseUrl || '').trim();
        if (!/^https?:\/\//i.test(baseUrl)) return { ok: false, error: 'Enter a valid http(s) base URL.' };
        if (/invalid|bad-host/i.test(baseUrl)) return { ok: false, error: 'Could not reach the endpoint. Check the URL and key.' };
        const samples = input.protocol === 'anthropic'
          ? ['claude-sonnet-4-5', 'claude-haiku-4-5']
          : input.protocol === 'gemini'
            ? ['gemini-2.5-pro', 'gemini-2.5-flash']
            : ['gpt-5.1', 'gpt-5.1-mini', 'o4-mini', 'gpt-4.1'];
        return { ok: true, models: samples.map((id) => ({ id, name: id })) };
      },
      async test(input) {
        await sleep(850);
        const provider = [...PROVIDERS, ...config.customProviders].find((p) => p.id === input.providerId);
        if (!provider) return { ok: false, error: 'Unknown provider.' };
        if (input.providerId !== 'sandbox' && !config.providers[input.providerId]?.hasKey && !['ollama', 'lmstudio'].includes(input.providerId) && !input.apiKey) {
          return { ok: false, error: 'No API key configured for this provider.' };
        }
        return { ok: true, count: provider.models.length, models: provider.models.slice(0, 6).map((model) => ({ id: model.id, name: model.name })) };
      },
      async discover(providerId) {
        await sleep(1000);
        const provider = [...PROVIDERS, ...config.customProviders].find((p) => p.id === providerId);
        if (!provider) return { ok: false, error: 'Unknown provider.' };
        const extra = providerId === 'openai'
          ? [{ id: 'gpt-5.1-codex', name: 'GPT-5.1 Codex', context: 400000, tags: ['Detected'] }, { id: 'o3-pro', name: 'o3 Pro', context: 200000, tags: ['Detected'] }]
          : [{ id: 'detected-model', name: 'Detected model', context: 128000, tags: ['Detected'] }];
        config.discoveredModels[providerId] = extra;
        emit({ type: 'config:updated' });
        return { ok: true, models: extra };
      },
      async addCustom(input) {
        const id = `custom_${String(input.name || 'provider').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'provider'}`;
        const provider = {
          id, name: input.name || 'Custom provider', monogram: (input.name || 'C').slice(0, 1).toUpperCase(),
          protocol: input.protocol || 'openai', kind: 'custom', description: 'Custom OpenAI-compatible endpoint.',
          docs: '', models: String(input.models || 'default').split(/[\n,]/).map((m) => m.trim()).filter(Boolean).map((modelId) => ({ id: modelId, name: modelId, context: 128000, tags: ['Custom'] })),
        };
        config.customProviders.push(provider);
        const key = input.apiKey ? {
          id: `k_${Math.random().toString(36).slice(2, 9)}`,
          label: String(input.keyLabel || 'Default').slice(0, 40) || 'Default',
          preview: `${String(input.apiKey).slice(0, 4)}…${String(input.apiKey).slice(-4)}`,
          active: true, source: 'stored', removable: true,
          createdAt: new Date().toISOString(), lastUsedAt: '', lastError: '',
        } : null;
        config.providers[id] = {
          hasKey: Boolean(key),
          keyPreview: key?.preview || '',
          keySource: key ? 'stored' : null,
          keys: key ? [key] : [],
          keyCount: key ? 1 : 0,
          activeKeyId: key?.id || '',
          autoRotate: true,
          connected: Boolean(key),
          baseUrl: input.baseUrl || '',
        };
        emit({ type: 'config:updated' });
        return stateConfig();
      },
      async removeCustom(providerId) {
        config.customProviders = config.customProviders.filter((provider) => provider.id !== providerId);
        delete config.providers[providerId];
        if (config.defaultModel.startsWith(`${providerId}/`)) config.defaultModel = 'sandbox/blank-1';
        emit({ type: 'config:updated' });
        return stateConfig();
      },
    },

    sessions: {
      async list() { await sleep(40); return { sessions: listSessions(), workspace }; },
      async get(id) {
        await sleep(30);
        const session = sessions.get(id);
        return { session: session ? JSON.parse(JSON.stringify(session)) : null, running: Boolean(activeRun && activeRun.session.id === id), queue: publicQueue(id) };
      },
      async create(input = {}) {
        const session = {
          id: `s_${Math.random().toString(36).slice(2, 9)}`,
          title: input.title || 'New session',
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          workspace, model: input.model || config.defaultModel, mode: input.mode || 'agent',
          messages: [], tasks: [], usage: { input: 0, output: 0 }, allowTools: [],
          summary: '', compactedCount: 0, pinned: false, files: [],
        };
        putSession(session);
        emit({ type: 'session:updated', session: sessionSummary(session) });
        return { session: JSON.parse(JSON.stringify(session)) };
      },
      async update(input) {
        const session = sessions.get(input.id);
        if (!session) throw new Error('Session not found.');
        if (input.title !== undefined) session.title = String(input.title).trim().slice(0, 120) || 'New session';
        if (input.pinned !== undefined) session.pinned = Boolean(input.pinned);
        if (input.model !== undefined && findModel(input.model)) session.model = input.model;
        if (input.mode !== undefined) session.mode = input.mode;
        touch(session);
        return { session: JSON.parse(JSON.stringify(session)) };
      },
      async delete(id) { sessions.delete(id); emit({ type: 'sessions:refresh' }); return { ok: true }; },
      async compact(id) {
        await sleep(900);
        const session = sessions.get(id);
        if (!session) throw new Error('Session not found.');
        session.summary = 'Earlier turns covered tracing the webhook handler, the idempotent ledger change, and the regression test.';
        session.compactedCount = Math.max(0, session.messages.length - 6);
        touch(session);
        return { ok: true, compacted: session.compactedCount, session: JSON.parse(JSON.stringify(session)) };
      },
    },

    chat: {
      async send(input = {}) {
        let session = input.sessionId ? sessions.get(input.sessionId) : null;
        if (!session) {
          session = {
            id: `s_${Math.random().toString(36).slice(2, 9)}`, title: 'New session',
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
            workspace, model: input.model || config.defaultModel, mode: input.mode || 'agent',
            messages: [], tasks: [], usage: { input: 0, output: 0 }, allowTools: [], files: [],
            summary: '', compactedCount: 0, pinned: false,
          };
          putSession(session);
        }
        if (input.model && findModel(input.model)) session.model = input.model;
        if (input.mode) session.mode = input.mode;
        if (activeRun && (input.queue || activeRun.session.id === session.id)) {
          const item = {
            queueId: `q_${Math.random().toString(36).slice(2, 9)}`,
            text: String(input.text || ''),
            attachments: input.attachments || [],
            model: session.model,
            mode: session.mode,
            queuedAt: new Date().toISOString(),
          };
          queueFor(session.id).push(item);
          const payload = { type: 'chat:queued', sessionId: session.id, queueId: item.queueId, text: item.text, queueLength: queueFor(session.id).length, source: 'desktop' };
          emit(payload);
          emitQueue(session.id);
          return { queued: true, sessionId: session.id, queueId: item.queueId, title: session.title, model: session.model, mode: session.mode };
        }
        saveUserMessage(session, String(input.text || ''), input.attachments || []);
        touch(session);
        const runId = `run_${Math.random().toString(36).slice(2, 9)}`;
        activeRun = { id: runId, session, cancelled: false };
        const reply = demoReply(String(input.text || ''));
        setTimeout(() => startMockRun(runId, reply), 220);
        return {
          sessionId: session.id, runId, title: session.title,
          message: session.messages[session.messages.length - 1],
          model: session.model, mode: session.mode, queued: false,
        };
      },
      async queue(sessionId) {
        return { queue: publicQueue(sessionId) };
      },
      async removeQueued(input = {}) {
        const queue = queueFor(input.sessionId);
        const index = queue.findIndex((item) => item.queueId === input.queueId);
        if (index >= 0) queue.splice(index, 1);
        emitQueue(input.sessionId);
        return { ok: index >= 0, queue: publicQueue(input.sessionId) };
      },
      async stop(sessionId) {
        const clearedQueue = queueFor(sessionId).length;
        queueFor(sessionId).length = 0;
        if (activeRun && activeRun.session.id === sessionId) {
          activeRun.cancelled = true;
          if (pendingApproval) {
            pendingApproval.resolve('deny');
            pendingApproval = null;
          }
          const session = activeRun.session;
          const runId = activeRun.id;
          activeRun = null;
          emit({ type: 'session:updated', session: sessionSummary(session) });
          emit({ type: 'run:done', sessionId: session.id, runId, outcome: { ok: false, stopped: true }, usage: session.usage, title: session.title, tasks: session.tasks || [], files: session.files || [], summary: false });
          emitQueue(session.id);
          return { ok: true, clearedQueue };
        }
        emitQueue(sessionId);
        return { ok: false, clearedQueue };
      },
      async approve(input) {
        if (!pendingApproval || pendingApproval.approvalId !== input.approvalId) return { ok: false, error: 'Approval expired.' };
        const approval = pendingApproval;
        pendingApproval = null;
        approval.resolve(input.decision || 'deny');
        return { ok: true };
      },
      async openWorkspace() { return true; },
    },

    ssh: {
      async list() { await sleep(30); return { hosts: config.ssh?.hosts || [] }; },
      async add(input = {}) {
        await sleep(120);
        const host = {
          id: `ssh_${Date.now().toString(36)}`,
          name: input.name || input.host || 'Host',
          host: input.host || '',
          port: Number(input.port) || 22,
          user: input.user || '',
          authType: input.authType === 'password' ? 'password' : 'key',
          keyPath: input.keyPath || '',
          fingerprint: '',
        };
        config.ssh = { ...(config.ssh || {}), hosts: [...(config.ssh?.hosts || []), host] };
        return { hosts: config.ssh.hosts };
      },
      async remove(id) {
        await sleep(80);
        config.ssh = { ...(config.ssh || {}), hosts: (config.ssh?.hosts || []).filter((host) => host.id !== id) };
        return { hosts: config.ssh.hosts };
      },
      async test(input = {}) {
        await sleep(250);
        return { ok: true, latencyMs: 42, hosts: config.ssh?.hosts || [] };
      },
    },

    workspace: {
      async choose() {
        await sleep(300);
        return { canceled: true };
      },
      async tree() { await sleep(30); return { workspace, tree: tree() }; },
      async read(relativePath) {
        await sleep(120);
        const content = FILES[relativePath];
        if (content === undefined) throw new Error('File not found in preview.');
        return { path: relativePath, content };
      },
      async openPath() { return true; },
      async reveal() { return true; },
      async openEditor() { return { ok: true, preview: true }; },
      async writeAgents() { return { exists: false, path: 'AGENTS.md' }; },
    },

    mcp: {
      async list() { await sleep(60); return { servers: mcpServers, catalog: mcpCatalog() }; },
      async refresh() {
        await sleep(700);
        mcpServers = mcpServers.map((server) => server.id === 'mcp_linear' ? { ...server, connected: true, toolCount: server.tools.length } : server);
        return { servers: mcpServers, catalog: mcpCatalog() };
      },
      async add(input) {
        await sleep(500);
        const id = `mcp_${String(input.name || 'server').toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${Math.random().toString(36).slice(2, 5)}`;
        const server = {
          id, name: input.name || 'MCP server', transport: input.transport || 'stdio', enabled: true,
          connected: true, command: input.command || '', url: input.url || '', error: '',
          toolCount: 1, tools: ['status'],
        };
        mcpServers.push(server);
        emit({ type: 'config:updated' });
        return { server };
      },
      async addExample() {
        await sleep(600);
        let server = mcpServers.find((entry) => entry.name.startsWith('Echo'));
        if (!server) {
          server = { id: 'mcp_echo_demo', name: 'Echo (example)', transport: 'stdio', enabled: true, connected: true, command: 'node examples/mcp-echo-server.js', url: '', error: '', toolCount: 3, tools: ['echo', 'add', 'now'] };
          mcpServers.push(server);
        }
        emit({ type: 'config:updated' });
        return { server, existed: true };
      },
      async remove(id) { mcpServers = mcpServers.filter((server) => server.id !== id); emit({ type: 'config:updated' }); return { servers: mcpServers }; },
      async toggle(input) {
        mcpServers = mcpServers.map((server) => server.id === input.id ? { ...server, enabled: Boolean(input.enabled) } : server);
        await sleep(200);
        emit({ type: 'config:updated' });
        return { servers: mcpServers };
      },
    },

    skills: {
      async list() { await sleep(30); return { skills: SKILLS }; },
      async get(id) { const skill = SKILLS.find((entry) => entry.id === id); return { skill: skill || null }; },
      async create(input) {
        const name = String(input.name || '').trim();
        if (!name) throw new Error('A skill name is required.');
        const slug = name.toLowerCase().replace(/[^a-z0-9\uac00-\ud7af]+/g, '-').replace(/^-|-$/g, '') || 'skill';
        const skill = {
          id: `${input.scope === 'project' ? 'project' : 'global'}/${slug}`, slug, name,
          description: String(input.description || '').slice(0, 300), source: input.scope === 'project' ? 'project' : 'global',
          enabled: true, body: String(input.body || ''), version: '', updatedAt: new Date().toISOString(),
          path: `${input.scope === 'project' ? '.blank/skills' : '~/.blank/skills'}/${slug}/SKILL.md`,
        };
        SKILLS.push(skill);
        emit({ type: 'skills:updated' });
        return { skill, skills: SKILLS };
      },
      async remove(id) {
        const index = SKILLS.findIndex((skill) => skill.id === id);
        if (index < 0 || SKILLS[index].source === 'bundled') throw new Error('Bundled skills cannot be deleted.');
        SKILLS.splice(index, 1);
        emit({ type: 'skills:updated' });
        return { skills: SKILLS };
      },
      async toggle(input) {
        const skill = SKILLS.find((entry) => entry.id === input.id);
        if (skill) skill.enabled = Boolean(input.enabled);
        emit({ type: 'config:updated' });
        return { skills: SKILLS };
      },
      async openFolder() { return '~/.blank/skills'; },
    },

    memory: {
      async list() { await sleep(30); return { entries: MEMORIES }; },
      async add(input) {
        const text = String(input.text || '').trim();
        if (!text) throw new Error('Memory text is empty.');
        const existing = MEMORIES.find((entry) => entry.text.toLowerCase() === text.toLowerCase());
        if (existing) return { entry: existing, entries: MEMORIES };
        const entry = {
          id: `m_${Math.random().toString(36).slice(2, 8)}`, text,
          tags: (input.tags || []).map((tag) => String(tag).toLowerCase()), pinned: Boolean(input.pinned),
          source: 'manual', uses: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        };
        MEMORIES.unshift(entry);
        emit({ type: 'memory:updated' });
        return { entry, entries: MEMORIES };
      },
      async update(input) {
        const entry = MEMORIES.find((item) => item.id === input.id);
        if (!entry) throw new Error('Memory not found.');
        Object.assign(entry, input.patch || {}, { updatedAt: new Date().toISOString() });
        emit({ type: 'memory:updated' });
        return { entry };
      },
      async remove(id) {
        const index = MEMORIES.findIndex((entry) => entry.id === id);
        if (index >= 0) MEMORIES.splice(index, 1);
        emit({ type: 'memory:updated' });
        return { ok: index >= 0 };
      },
      async search(query) {
        const tokens = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
        const entries = MEMORIES.filter((entry) => !tokens.length || tokens.some((token) => `${entry.text} ${(entry.tags || []).join(' ')}`.toLowerCase().includes(token)));
        return { entries };
      },
    },

    learn: {
      async state() { await sleep(40); return learnState(); },
      async reflect() {
        await sleep(1800);
        const entry = {
          id: `i_${Math.random().toString(36).slice(2, 8)}`, type: 'memory',
          title: 'Use Stripe test clocks for subscription tests', confidence: 0.81,
          content: 'Use Stripe test clocks when testing subscription lifecycle changes; advance the clock instead of waiting for real time.',
          reason: 'Two sessions manually waited on billing periods and one test timed out.',
          tags: ['billing', 'testing'], skillName: '', description: '',
          fingerprint: 'stripe test clocks', createdAt: new Date().toISOString(),
        };
        if (!insights.pending.some((item) => item.fingerprint === entry.fingerprint)) insights.pending.unshift(entry);
        insights.lastReflectionAt = new Date().toISOString();
        insights.reflections += 1;
        emit({ type: 'learn:updated' });
        return { ok: true, model: 'anthropic/claude-sonnet-4-5', added: [entry], considered: 3, proposals: 1, message: '1 insight ready for review.' };
      },
      async apply(id) {
        const index = insights.pending.findIndex((entry) => entry.id === id);
        if (index < 0) throw new Error('Insight not found.');
        const insight = insights.pending[index];
        if (insight.type === 'memory') {
          if (!MEMORIES.some((entry) => entry.text === insight.content)) {
            MEMORIES.unshift({
              id: `m_${Math.random().toString(36).slice(2, 8)}`, text: insight.content,
              tags: [...(insight.tags || []), 'learned'], pinned: false, source: 'reflection', uses: 0,
              createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
            });
          }
        } else if (insight.type === 'instruction') {
          config.customInstructions = `${config.customInstructions}\n- ${insight.content}`;
        } else if (insight.type === 'skill') {
          SKILLS.push({
            id: `global/${String(insight.skillName || insight.title).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
            slug: String(insight.skillName || insight.title).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            name: insight.skillName || insight.title, source: 'global', enabled: true, description: insight.description || '',
            body: insight.content, version: '1.0', updatedAt: new Date().toISOString(), path: '~/.blank/skills/learned/SKILL.md',
          });
        }
        insights.pending.splice(index, 1);
        insights.applied.unshift({ ...insight, appliedAt: new Date().toISOString() });
        emit({ type: 'learn:updated' });
        emit({ type: 'memory:updated' });
        emit({ type: 'skills:updated' });
        return { state: learnState() };
      },
      async dismiss(id) {
        insights.pending = insights.pending.filter((entry) => entry.id !== id);
        emit({ type: 'learn:updated' });
        return { ok: true };
      },
    },

    media: {
      async list(options = {}) {
        await sleep(30);
        let items = mediaAssets;
        if (options.kind) items = items.filter((asset) => asset.kind === options.kind);
        if (options.favorite) items = items.filter((asset) => asset.favorite);
        const query = String(options.query || '').toLowerCase();
        if (query) items = items.filter((asset) => `${asset.title} ${asset.prompt}`.toLowerCase().includes(query));
        items = [...items].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
        return { items: items.slice(0, Number(options.limit) || 60), total: items.length, counts: mediaCounts() };
      },
      async get(id) { await sleep(10); return mediaAssets.find((asset) => asset.id === id) || null; },
      async jobs() { await sleep(10); return mediaJobs.map((job) => ({ ...job })); },
      async job(id) { await sleep(10); const job = mediaJobs.find((entry) => entry.id === id); return job ? { ...job } : null; },
      async engines() { await sleep(20); return mediaEngines(); },
      async storage() { await sleep(10); return mediaStorage(); },
      async voices() { await sleep(10); return ['Samantha', 'Daniel', 'Microsoft Heami']; },
      async setEndpoint(input = {}) {
        await sleep(10);
        config.media.endpoints = { ...(config.media.endpoints || {}), comfyui: String(input.endpoint || '') };
        return { endpoints: config.media.endpoints, engines: mediaEngines() };
      },
      async testEndpoint() { await sleep(30); return { ok: false, version: '', checkpoints: [] }; },
      async generate(input = {}) {
        await sleep(260);
        const kind = input.kind || 'image';
        const job = {
          id: `job_${Math.random().toString(36).slice(2, 9)}`, kind,
          prompt: String(input.prompt || ''), engine: input.engine || 'blank',
          engineLabel: { blank: 'Blank Engine', 'blank-image': 'Blank Visual', 'blank-audio': 'Blank Audio', 'blank-3d': 'Blank 3D' }[input.engine] || 'Blank Engine',
          status: 'running', progress: 0.08, stage: 'Preparing', assetIds: [], createdAt: new Date().toISOString(),
        };
        mediaJobs.unshift(job);
        emit({ type: 'media:job', job: { ...job } });
        const count = kind === 'image' ? Math.max(1, Math.min(4, Number(input.count) || 1)) : 1;
        setTimeout(() => {
          job.progress = 0.48; job.stage = 'Rendering';
          emit({ type: 'media:job', job: { ...job } });
        }, 900);
        setTimeout(() => {
          const created = [];
          for (let index = 0; index < count; index += 1) {
            const palette = paletteSets[(mediaAssets.length + index + mediaSeq) % paletteSets.length];
            const title = String(input.prompt || 'Untitled').split(/[.\n]/)[0].slice(0, 42) || 'Untitled';
            const thumb = svgThumb(title, palette, kind);
            const asset = {
              id: `asset_${Math.random().toString(36).slice(2, 9)}`,
              kind, kindLabel: { image: 'Image', video: 'Video', audio: 'Music', model3d: '3D' }[kind],
              title, prompt: String(input.prompt || ''), engine: input.engine || 'blank',
              engineLabel: job.engineLabel, provider: '', model: 'blank-1',
              fileName: 'preview.bin', mime: 'image/svg+xml', bytes: 680000 + index * 90000,
              width: 1024, height: 1024,
              duration: kind === 'video' ? Number(input.duration) || 4 : kind === 'audio' ? Number(input.duration) || 20 : 0,
              seed: 2000 + mediaSeq + index, favorite: false, source: 'generated', parentId: '',
              createdAt: new Date().toISOString(), meta: {}, extraFiles: [],
              urls: { file: thumb, thumb, poster: thumb, waveform: kind === 'audio' ? thumb : '', preview: thumb },
            };
            mediaSeq += 1;
            mediaAssets.unshift(asset);
            created.push(asset);
            emit({ type: 'media:asset', asset: { ...asset } });
          }
          job.status = 'done'; job.progress = 1; job.stage = 'Done';
          job.assetIds = created.map((asset) => asset.id);
          emit({ type: 'media:job', job: { ...job } });
        }, 2300);
        return { ...job };
      },
      async edit(input = {}) {
        return api.media.generate({ ...input, prompt: input.prompt || 'Edited asset' });
      },
      async cancel(id) {
        const job = mediaJobs.find((entry) => entry.id === id);
        if (job && ['queued', 'running'].includes(job.status)) {
          job.status = 'cancelled';
          emit({ type: 'media:job', job: { ...job } });
        }
        return { ok: Boolean(job) };
      },
      async remove(id) {
        const index = mediaAssets.findIndex((asset) => asset.id === id);
        if (index >= 0) mediaAssets.splice(index, 1);
        emit({ type: 'media:removed', id });
        return { ok: index >= 0 };
      },
      async favorite(id) {
        const asset = mediaAssets.find((entry) => entry.id === id);
        if (asset) asset.favorite = !asset.favorite;
        return asset ? { ...asset } : null;
      },
      async importFiles() { return { canceled: true, items: [] }; },
      async importData(input = {}) {
        const name = String(input.name || 'Imported asset');
        const kind = /\.(mp4|webm|mov)$/i.test(name) ? 'video' : /\.(mp3|wav|m4a|ogg)$/i.test(name) ? 'audio' : /\.(obj|stl|glb|gltf)$/i.test(name) ? 'model3d' : 'image';
        const asset = {
          id: `asset_${Math.random().toString(36).slice(2, 9)}`, kind,
          kindLabel: { image: 'Image', video: 'Video', audio: 'Music', model3d: '3D' }[kind],
          title: name, prompt: '', engine: 'imported', engineLabel: 'Imported',
          provider: '', model: '', fileName: name, mime: '', bytes: 120000,
          width: 0, height: 0, duration: 0, seed: null, favorite: false,
          source: 'imported', parentId: '', createdAt: new Date().toISOString(), meta: {}, extraFiles: [],
          urls: { file: input.dataUrl, thumb: input.dataUrl, poster: input.dataUrl, waveform: '', preview: input.dataUrl },
        };
        mediaAssets.unshift(asset);
        emit({ type: 'media:asset', asset: { ...asset } });
        return { asset };
      },
      async exportAsset(id) { return { canceled: true, id }; },
      async saveToWorkspace(input = {}) { return { path: `${workspace}/media/${input.id}`, preview: true }; },
      async reveal() { return true; },
      async open() { return true; },
      async readText(id) {
        const asset = mediaAssets.find((entry) => entry.id === id);
        return { content: asset?.kind === 'model3d' ? 'o preview\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n' : '' };
      },
      async setKey(input = {}) {
        config.media = config.media || { defaults: {}, hasKey: {}, keyIds: [] };
        const ids = new Set(config.media.keyIds || []);
        if (String(input.key || '').trim()) ids.add(input.engineId || input.id || 'fal');
        else ids.delete(input.engineId || input.id || 'fal');
        config.media.keyIds = [...ids];
        config.media.hasKey = Object.fromEntries([...ids].map((id) => [id, true]));
        emit({ type: 'config:updated' });
        return stateConfig();
      },
      async setDefaults(input = {}) {
        config.media = config.media || { defaults: {} };
        config.media.defaults = { ...(config.media.defaults || {}), ...(input.defaults || input) };
        emit({ type: 'config:updated' });
        return { defaults: config.media.defaults };
      },
    },

    plugins: {
      async list() {
        await sleep(60);
        return { items: PLUGIN_ITEMS.map((item) => ({
          ...item,
          installed: pluginState.has(item.id),
          server: pluginServers.get(item.id) || null,
        })) };
      },
      async install(input = {}) {
        await sleep(700);
        const item = PLUGIN_ITEMS.find((entry) => entry.id === input.id);
        if (!item) throw new Error('Unknown plugin.');
        if (item.kind === 'mcp') {
          const server = { id: `mcp_${item.id}`, name: item.name, pluginId: item.id, transport: item.transport, enabled: true, connected: true, command: item.command || '', url: item.url || '', error: '', toolCount: item.id === 'github' ? 8 : 4, tools: ['read', 'search', 'list', 'open'] };
          pluginServers.set(item.id, server);
        }
        pluginState.add(item.id);
        emit({ type: 'config:updated' });
        return { installed: true, id: item.id };
      },
      async remove(id) {
        pluginState.delete(id);
        pluginServers.delete(id);
        emit({ type: 'config:updated' });
        return { ok: true };
      },
    },

    remote: {
      async status() {
        return {
          running: remoteRunning, port: config.remote.port, allowLan: config.remote.allowLan,
          allowApprovals: config.remote.allowApprovals, autoStart: config.remote.autoStart,
          token: remoteRunning ? 'preview-token-2f7c9a41b3e85d60' : '',
          startedAt: remoteRunning ? Date.now() - 42000 : 0,
          connections: remoteRunning ? remoteConnections : 0,
          urls: remoteRunning ? [{ label: 'This machine', url: `http://127.0.0.1:${config.remote.port}/#t=preview-token-2f7c9a41b3e85d60` }, ...(config.remote.allowLan ? [{ label: 'Network', url: `http://192.168.1.24:${config.remote.port}/#t=preview-token-2f7c9a41b3e85d60` }] : [])] : [],
          url: remoteRunning ? `http://127.0.0.1:${config.remote.port}/#t=preview-token-2f7c9a41b3e85d60` : '',
        };
      },
      async start(input = {}) {
        await sleep(400);
        if (input.port) config.remote.port = Math.max(1024, Math.min(65535, Number(input.port) || 8787));
        remoteRunning = true;
        remoteConnections = 2;
        emit({ type: 'remote:status', status: await api.remote.status() });
        return api.remote.status();
      },
      async stop() {
        await sleep(200);
        remoteRunning = false;
        emit({ type: 'remote:status', status: await api.remote.status() });
        return api.remote.status();
      },
      async configure(input = {}) {
        await sleep(200);
        config.remote = { ...config.remote, ...input };
        emit({ type: 'config:updated' });
        emit({ type: 'remote:status', status: await api.remote.status() });
        return api.remote.status();
      },
    },

    search: {
      async setKey(input = {}) {
        config.search = config.search || { provider: 'duckduckgo', maxResults: 6, baseUrl: '', hasKey: {}, keyIds: [] };
        const ids = new Set(config.search.keyIds || []);
        if (String(input.key || '').trim()) ids.add(input.id || config.search.provider);
        else ids.delete(input.id || config.search.provider);
        config.search.keyIds = [...ids];
        config.search.hasKey = Object.fromEntries([...ids].map((id) => [id, true]));
        emit({ type: 'config:updated' });
        return stateConfig();
      },
      async test() {
        await sleep(700);
        if (config.search.provider !== 'duckduckgo' && !(config.search.hasKey || {})[config.search.provider]) {
          return { ok: false, error: 'No key saved. DuckDuckGo fallback is available.' };
        }
        return {
          ok: true, backend: config.search.provider,
          backendLabel: { duckduckgo: 'DuckDuckGo', brave: 'Brave Search', tavily: 'Tavily', exa: 'Exa', serper: 'Serper', searxng: 'SearXNG' }[config.search.provider] || 'DuckDuckGo',
          note: 'Preview results', results: [
            { title: 'Blank agent harness', url: 'https://example.com/blank', snippet: 'A local-first desktop agent harness with tools, skills and memory.' },
            { title: 'Computer use with approval', url: 'https://example.com/computer', snippet: 'See and control the desktop while every action asks first.' },
          ],
        };
      },
    },

    computer: {
      async testScreenshot() {
        await sleep(900);
        return { ok: true, path: 'C:\\Users\\you\\.blank\\screenshots\\preview.png', width: 1920, height: 1080 };
      },
    },

    checkpoint: {
      async revert(id) {
        await sleep(400);
        emit({ type: 'workspace:changed' });
        return { ok: true, path: 'src/api/rate-limit.ts', preview: true, id };
      },
    },

    cli: {
      async install() {
        await sleep(500);
        return { path: 'C:\\Users\\you\\.blank\\bin\\blank.cmd', dir: 'C:\\Users\\you\\.blank\\bin', instructions: 'Add C:\\Users\\you\\.blank\\bin to PATH, then run "blank" from any terminal.' };
      },
    },

    window: {
      async minimize() { return true; },
      async maximize() { return false; },
      async close() { return true; },
      async state() { return { maximized: false, fullscreen: false }; },
    },
  };

  window.BlankMock = api;
  window.BlankMockData = { sessions, config, providers: PROVIDERS, files: FILES };
})();
