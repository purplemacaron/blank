/* Binds the renderer to the Electron preload bridge. */
(function () {
  'use strict';
  const backend = window.blank;
  if (!backend || !backend.isElectron) {
    document.body.innerHTML = '<div style="font:14px system-ui;padding:40px;color:#333">blank could not find its runtime bridge. Start the desktop app instead of opening this file directly.</div>';
    throw new Error('No blank API available');
  }
  window.API = backend;
})();
