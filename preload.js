const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getServerInfo: () => ipcRenderer.invoke('get-server-info'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSetting: (key, value) => ipcRenderer.invoke('update-setting', { key, value }),
  getUpcoming: () => ipcRenderer.invoke('get-upcoming'),
  showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
  onNavigate: (callback) => ipcRenderer.on('navigate', (event, page) => callback(page)),
});
