'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload).catch((error) => {
  const raw = String((error && error.message) || error || '');
  const message = raw.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '').trim();
  throw new Error(message || 'The operation failed.');
});

contextBridge.exposeInMainWorld('Pet', {
  init: () => invoke('pet:init'),
  position: () => invoke('pet:position'),
  move: (point) => invoke('pet:move', point),
  save: (point) => invoke('pet:save', point),
  reset: () => invoke('pet:reset'),
  interactive: (value) => invoke('pet:interactive', value),
  focus: (value) => invoke('pet:focus', value),
  palette: (model, theme) => invoke('pet:palette', model, theme),
  prompt: (text) => invoke('pet:prompt', text),
  open: () => invoke('pet:open'),
  hide: () => invoke('pet:hide'),
  onEvent(callback) {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('blank:event', handler);
    return () => ipcRenderer.removeListener('blank:event', handler);
  },
});
