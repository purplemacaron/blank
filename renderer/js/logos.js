/* Local provider marks. Small, dependency-free and legible at 15px. */
(function () {
  'use strict';

  const stroke = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';

  const MARKS = {
    sandbox: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.4" y="2.4" width="19.2" height="19.2" rx="5.8" fill="currentColor"/><circle cx="12" cy="12" r="3.7" fill="#fff"/></svg>`,
    anthropic: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l8.6 18.8h-5.2l-1.2-3H9.8l-1.2 3H3.4L12 2.6zm0 7.6l-1.7 4.5h3.4L12 10.2z" fill="currentColor"/></svg>`,
    openai: `<svg viewBox="0 0 24 24" aria-hidden="true"><g ${stroke}><path d="M12 2.8l8 4.6v9.2l-8 4.6-8-4.6V7.4z"/><path d="M12 8l4 2.3v4.6L12 17.2l-4-2.3V9.3z"/><path d="M12 8V2.9M16 10.3l4.1-2.5M16 13.9l4.1 2.5M12 17.2V22M8 13.9l-4.1 2.5M8 10.3L3.9 7.8"/></g></svg>`,
    google: `<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke-width="3.1" stroke-linecap="butt"><circle cx="12" cy="12" r="7.7" stroke="#4285F4" stroke-dasharray="12.1 36.3" transform="rotate(-45 12 12)"/><circle cx="12" cy="12" r="7.7" stroke="#34A853" stroke-dasharray="12.1 36.3" transform="rotate(45 12 12)"/><circle cx="12" cy="12" r="7.7" stroke="#FBBC05" stroke-dasharray="12.1 36.3" transform="rotate(135 12 12)"/><circle cx="12" cy="12" r="7.7" stroke="#EA4335" stroke-dasharray="12.1 36.3" transform="rotate(225 12 12)"/></g><path d="M12 12h7.6" stroke="#4285F4" stroke-width="2.9" stroke-linecap="round"/></svg>`,
    openrouter: `<svg viewBox="0 0 24 24" aria-hidden="true"><g ${stroke}><path d="M3.2 7.2h4.2c2 0 3.1 1 4.2 2.6 1.1 1.6 2.2 3 4.3 3h4.7"/><path d="M17.4 9.5l3.4 3.3-3.4 3.2"/><path d="M3.2 16.8h4.2c2 0 3.1-1 4.2-2.6"/></g></svg>`,
    xai: `<svg viewBox="0 0 24 24" aria-hidden="true"><g ${stroke}><path d="M4 3.8l16 16.4M20 3.8L4 20.2"/><path d="M8.2 8.2L4.6 3.8M15.8 15.8l3.6 4.4"/></g></svg>`,
    deepseek: `<svg viewBox="0 0 24 24" aria-hidden="true"><g ${stroke}><path d="M3 14.4c2.3-5 6.4-7.6 11-6.9 3 .4 5.1 2.2 7 4.9-3-.7-5-.4-6.8.8-1.6 1-2.5 2.3-3 3.8-1.1-1.3-2.3-2-4-2.3"/><path d="M6.4 18.5c1.3-.5 2.3-1.3 3-2.4M13.8 9.1l.1.1"/></g></svg>`,
    mistral: `<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor"><rect x="3" y="3.8" width="18" height="2.5" rx="1.2"/><rect x="5" y="8.2" width="14" height="2.5" rx="1.2"/><rect x="3" y="12.6" width="18" height="2.5" rx="1.2"/><rect x="5" y="17" width="14" height="2.5" rx="1.2"/></g></svg>`,
    groq: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.6 4.8h16.8v3.4h-7.2v2.9h6.8v8.1h-3.5v-4.6H9.6v-3.3H3.6z" fill="currentColor"/></svg>`,
    together: `<svg viewBox="0 0 24 24" aria-hidden="true"><g ${stroke}><rect x="3.4" y="3.4" width="10.2" height="10.2" rx="2.6"/><rect x="10.4" y="10.4" width="10.2" height="10.2" rx="2.6"/></g></svg>`,
    cerebras: `<svg viewBox="0 0 24 24" aria-hidden="true"><g ${stroke}><circle cx="12" cy="12" r="8.4"/><path d="M3.8 12h16.4M12 3.6v16.8M6.2 6.2l11.6 11.6M17.8 6.2L6.2 17.8"/></g></svg>`,
    ollama: `<svg viewBox="0 0 24 24" aria-hidden="true"><g ${stroke}><path d="M8 20.4V10.2L6.6 5l3.2.9L12 8.2l2.2-2.3 3.2-.9L16 10.2v10.2"/><circle cx="9.7" cy="11.4" r=".9" fill="currentColor" stroke="none"/><circle cx="14.3" cy="11.4" r=".9" fill="currentColor" stroke="none"/><path d="M10 15.2c1.2.8 2.8.8 4 0"/></g></svg>`,
    lmstudio: `<svg viewBox="0 0 24 24" aria-hidden="true"><g ${stroke}><rect x="3.2" y="3.2" width="17.6" height="17.6" rx="4.6"/><path d="M7.4 16.4V8l2.6 4 2.6-4v8.4M15.4 16.4V8"/></g></svg>`,
    custom: `<svg viewBox="0 0 24 24" aria-hidden="true"><g ${stroke}><path d="M9 3.2v4.4M15 3.2v4.4M6.2 7.6h11.6v3.2a5.8 5.8 0 0 1-11.6 0z"/><path d="M12 16.6v4.2"/></g></svg>`,
  };

  function keyFor(provider) {
    if (!provider) return '';
    if (provider.kind === 'custom' || String(provider.id || '').startsWith('custom_')) return 'custom';
    const id = String(provider.id || '').toLowerCase();
    if (MARKS[id]) return id;
    if (id.includes('openai')) return 'openai';
    if (id.includes('anthropic') || id.includes('claude')) return 'anthropic';
    if (id.includes('google') || id.includes('gemini')) return 'google';
    if (id.includes('mistral')) return 'mistral';
    if (id.includes('groq')) return 'groq';
    if (id.includes('cerebras')) return 'cerebras';
    if (id.includes('together')) return 'together';
    if (id.includes('openrouter')) return 'openrouter';
    if (id.includes('deepseek')) return 'deepseek';
    if (id.includes('ollama')) return 'ollama';
    if (id.includes('lmstudio')) return 'lmstudio';
    if (id === 'xai' || id.includes('grok')) return 'xai';
    if (id.includes('sandbox') || id.includes('blank')) return 'sandbox';
    return '';
  }

  function forProvider(provider) {
    const key = keyFor(provider);
    return key ? MARKS[key] : '';
  }

  function forId(id) {
    return forProvider({ id });
  }

  window.ProviderLogos = { marks: MARKS, for: forProvider, forId, keyFor };
})();
