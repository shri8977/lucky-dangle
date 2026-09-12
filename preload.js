// preload.js
//
// Runs in an isolated context with access to Node/Electron APIs, and
// exposes only a small, explicit, safe surface to the renderer via
// contextBridge. The renderer itself never gets nodeIntegration or
// direct ipcRenderer access — this is the only bridge between them.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // --- Renderer -> Main -------------------------------------------------
  setIgnoreMouseEvents: (ignore) =>
    ipcRenderer.send('set-ignore-mouse-events', ignore),

  updatePosition: (xPercent) =>
    ipcRenderer.send('update-position', xPercent),

  updateChainLength: (chainLength) =>
    ipcRenderer.send('update-chain-length', chainLength),

  showContextMenu: () => ipcRenderer.send('show-context-menu'),

  getState: () => ipcRenderer.invoke('get-state'),

  // --- Main -> Renderer ---------------------------------------------------
  onInit: (callback) =>
    ipcRenderer.on('init-state', (event, payload) => callback(payload)),

  onThemeChanged: (callback) =>
    ipcRenderer.on('theme-changed', (event, theme) => callback(theme)),

  onSwingEnabledChanged: (callback) =>
    ipcRenderer.on('swing-enabled-changed', (event, enabled) => callback(enabled)),

  onTriggerSwing: (callback) =>
    ipcRenderer.on('trigger-swing', () => callback())
});
