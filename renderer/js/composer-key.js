'use strict';

/* Korean/Japanese/Chinese IMEs report Enter as Process/keyCode 229 while a
   composition is active, so matching only event.key === 'Enter' misses
   Ctrl+Enter. Match the physical key (code/keyCode) too, but never treat an
   IME commit Enter (no Ctrl) as a send. */
(function (global) {
  function action(event) {
    const keyCode = Number(event.keyCode) || 0;
    const code = event.code || '';
    const enter = event.key === 'Enter' || keyCode === 13 || code === 'Enter' || code === 'NumpadEnter';
    const ime = keyCode === 229 || Boolean(event.isComposing);
    if ((event.ctrlKey || event.metaKey) && enter) return 'send-now';
    if (event.key === 'Enter' && !event.shiftKey && !ime) return 'send-or-stop';
    return 'none';
  }

  const api = { action };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.ComposerKey = api;
})(typeof window !== 'undefined' ? window : globalThis);