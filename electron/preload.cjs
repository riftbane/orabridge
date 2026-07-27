const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('orabridge', {
  isDesktop: true,
  getAppInfo: () => ipcRenderer.invoke('orabridge:app-info'),
  checkForUpdates: () => ipcRenderer.invoke('orabridge:check-for-updates'),
  onUpdateStatus: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('orabridge:update-status', handler);
    return () => ipcRenderer.removeListener('orabridge:update-status', handler);
  },
});
