/* Selects the desktop bridge, falling back to the browser preview backend. */
(function () {
  'use strict';
  const backend = window.blank && window.blank.isElectron ? window.blank : window.BlankMock;
  if (!backend) {
    document.body.innerHTML = '<div style="font:14px system-ui;padding:40px;color:#333">Blank could not find its runtime bridge.</div>';
    throw new Error('No Blank API available');
  }
  window.API = backend;
  window.__BLANK_PREVIEW__ = !backend.isElectron;
})();
