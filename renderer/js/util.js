/* blank renderer utilities. */
(function () {
  'use strict';

  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => [...(root || document).querySelectorAll(selector)];

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function attr(value) {
    return esc(value).replace(/`/g, '&#96;');
  }

  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value === undefined || value === null) continue;
      if (key === 'class') node.className = value;
      else if (key === 'html') node.innerHTML = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
      else if (key in node) node[key] = value;
      else node.setAttribute(key, value);
    }
    for (const child of children.flat()) {
      if (child == null) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
  function kbd(key) {
    return isMac ? key.replace(/Ctrl/g, '⌘').replace(/Alt/g, '⌥').replace(/Shift/g, '⇧') : key;
  }

  function fmtTime(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function relativeTime(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    const diff = Date.now() - date.getTime();
    if (Number.isNaN(diff)) return '';
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'now';
    if (min < 60) return `${min}m`;
    const hours = Math.floor(min / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days === 1) return '1d';
    if (days < 7) return `${days}d`;
    if (days < 365) return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function dayLabel(iso) {
    const date = new Date(iso);
    const today = new Date();
    const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const days = Math.round((startOf(today) - startOf(date)) / 86400000);
    if (days <= 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return 'Previous 7 days';
    if (days < 30) return 'Previous 30 days';
    return 'Older';
  }

  function fmtNumber(value) {
    const number = Number(value) || 0;
    if (number >= 1e9) return `${(number / 1e9).toFixed(1)}B`;
    if (number >= 1e6) return `${(number / 1e6).toFixed(1)}M`;
    if (number >= 1e4) return `${(number / 1e3).toFixed(1)}k`;
    return number.toLocaleString();
  }

  function fmtBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10240 ? 1 : 0)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }

  function baseName(p) {
    if (!p) return '';
    const parts = String(p).replace(/\\/g, '/').split('/').filter(Boolean);
    return parts[parts.length - 1] || p;
  }

  function dirName(p) {
    if (!p) return '';
    const parts = String(p).replace(/\\/g, '/').split('/');
    return parts.slice(0, -1).join('/');
  }

  function truncate(text, length) {
    const value = String(text || '');
    return value.length > length ? `${value.slice(0, length).trimEnd()}…` : value;
  }

  function debounce(fn, ms) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  function throttle(fn, ms) {
    let last = 0;
    let timer = null;
    return (...args) => {
      const now = Date.now();
      const wait = ms - (now - last);
      if (wait <= 0) {
        last = now;
        fn(...args);
      } else if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          last = Date.now();
          fn(...args);
        }, wait);
      }
    };
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(String(text));
      return true;
    } catch {
      try {
        const area = document.createElement('textarea');
        area.value = String(text);
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        area.remove();
        return true;
      } catch {
        return false;
      }
    }
  }

  let uidCounter = 0;
  function uid(prefix) {
    uidCounter += 1;
    return `${prefix || 'x'}_${Date.now().toString(36)}${uidCounter.toString(36)}`;
  }

  function autoGrow(textarea, max) {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, max || 220)}px`;
  }

  function scrollToBottom(node, smooth) {
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }

  function isNearBottom(node, slack) {
    if (!node) return true;
    return node.scrollHeight - node.scrollTop - node.clientHeight < (slack || 120);
  }

  function download(filename, text, type) {
    const blob = new Blob([text], { type: type || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function providerName(provider) {
    if (!provider) return 'Model';
    return provider.name || provider.id || 'Model';
  }

  function modelLabel(catalog, fullId) {
    if (!fullId) return 'No model';
    if (!catalog) return fullId;
    const provider = (catalog.providers || []).find((p) => fullId.startsWith(`${p.id}/`));
    if (!provider) return fullId;
    const modelId = fullId.slice(provider.id.length + 1);
    const model = (provider.models || []).find((m) => m.id === modelId);
    return model ? model.name : modelId;
  }

  function providerOf(catalog, fullId) {
    if (!catalog || !fullId) return null;
    return (catalog.providers || []).find((p) => fullId.startsWith(`${p.id}/`)) || null;
  }

  function modelOf(catalog, fullId) {
    const provider = providerOf(catalog, fullId);
    if (!provider) return null;
    const modelId = fullId.slice(provider.id.length + 1);
    return (provider.models || []).find((m) => m.id === modelId) || null;
  }

  function selectableModels(catalog, config) {
    const providers = catalog?.providers || [];
    const providerConfig = config?.providers || {};
    return (catalog?.models || []).filter((model) => {
      const provider = providers.find((entry) => entry.id === model.providerId);
      if (!provider) return false;
      if (provider.kind === 'local') return true;
      const entry = providerConfig[provider.id] || {};
      if (entry.hasKey) return true;
      return provider.kind === 'custom' && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(entry.baseUrl || '');
    });
  }

  const REASONING_LEVELS = {
    none: { label: 'Non-reasoning', hint: 'Answers without a thinking pass' },
    minimal: { label: 'Minimal', hint: 'Shortest thinking pass' },
    low: { label: 'Low', hint: 'Fast, shallow' },
    medium: { label: 'Medium', hint: 'Balanced' },
    high: { label: 'High', hint: 'Deeper, slower' },
    xhigh: { label: 'xHigh', hint: 'Very deep thinking' },
    max: { label: 'Max', hint: 'Maximum reasoning' },
    ultra: { label: 'Ultra', hint: 'Highest effort and cost' },
  };
  const REASONING_ORDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
  const REASONING_BASE = ['none', 'low', 'medium', 'high', 'xhigh', 'max'];
  const REASONING_FULL = [...REASONING_BASE, 'ultra'];

  function reasoningFallback(fullId) {
    const value = String(fullId || '');
    const slash = value.indexOf('/');
    if (slash <= 0) return null;
    const providerId = value.slice(0, slash).toLowerCase();
    const id = value.slice(slash + 1).toLowerCase();
    if (!id) return null;
    if (/gpt-oss|gpt_oss/.test(id)) {
      return { levels: ['low', 'medium', 'high'], default: 'medium', transport: 'openai-effort', fixed: false, source: providerId.startsWith('custom_') ? 'fallback' : 'model' };
    }
    if (/qwen3|qwq|deepseek-r1|reasoner|thinking/.test(id)) {
      return { levels: [], default: '', transport: 'none', fixed: true, fixedLabel: 'Always on', source: providerId.startsWith('custom_') ? 'fallback' : 'model' };
    }
    if (providerId.startsWith('custom_')) {
      return { levels: REASONING_BASE, default: 'medium', transport: 'openai-effort', fixed: false, source: 'fallback' };
    }
    if (/^(deepseek-v|deepseek-chat-v)/.test(id)) {
      return { levels: REASONING_FULL, default: 'medium', transport: 'openai-effort', fixed: false, source: 'model' };
    }
    if (providerId === 'ollama' || providerId === 'lmstudio') {
      return { levels: ['none'], default: 'none', transport: 'none', fixed: true, source: 'model' };
    }
    return null;
  }

  function reasoningProfile(catalog, fullId) {
    const model = modelOf(catalog, fullId);
    if (model?.reasoning) return model.reasoning;
    if (model) return null;
    return reasoningFallback(fullId);
  }

  function normalizeReasoning(profile, value) {
    if (!profile || !Array.isArray(profile.levels) || !profile.levels.length) return '';
    const effort = String(value || '');
    if (profile.levels.includes(effort)) return effort;
    if (!effort || effort === 'auto') return profile.default || profile.levels[profile.levels.length - 1];
    const wanted = REASONING_ORDER.indexOf(effort);
    if (wanted < 0) return profile.default || profile.levels[profile.levels.length - 1];
    let best = profile.levels[0];
    let distance = Infinity;
    for (const level of profile.levels) {
      const delta = Math.abs(REASONING_ORDER.indexOf(level) - wanted);
      if (delta < distance) { best = level; distance = delta; }
    }
    return best;
  }

  function reasoningLabel(profile, effort) {
    if (!effort) return profile?.fixedLabel || '';
    return REASONING_LEVELS[effort]?.label || effort;
  }

  function parseTags(input) {
    return String(input || '')
      .split(/[,\n]/)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 12);
  }

  function linkifyPath(path) {
    return String(path || '').replace(/\\/g, '/');
  }

  function typeBadge(type) {
    return ({ memory: 'Memory', instruction: 'Instruction', skill: 'Skill' })[type] || type;
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  window.U = {
    $, $$, esc, attr, el, isMac, kbd, fmtTime, relativeTime, dayLabel, fmtNumber, fmtBytes,
    baseName, dirName, truncate, debounce, throttle, copyText, uid, autoGrow, scrollToBottom,
    isNearBottom, download, providerName, modelLabel, providerOf, modelOf, selectableModels, parseTags, linkifyPath,
    typeBadge, prefersReducedMotion, REASONING_LEVELS, REASONING_ORDER, reasoningProfile,
    normalizeReasoning, reasoningLabel,
  };
})();
