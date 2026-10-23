const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('screensaver', {
  dismiss: () => ipcRenderer.send('screensaver:dismiss'),
  getSettings: () => ipcRenderer.invoke('screensaver:get-settings'),
  setSettings: (settings) => ipcRenderer.invoke('screensaver:set-settings', settings),
});
