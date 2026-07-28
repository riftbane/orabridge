const { contextBridge, ipcRenderer } = require('electron');

// Il main decide se la barra del titolo la disegna l'app (vedi CUSTOM_TITLE_BAR
// in main.cjs) e lo comunica con un argomento di avvio: da qui, sandboxed, non
// c'è altro modo di saperlo prima del primo render.
const customTitleBar = process.argv.includes('--orabridge-titlebar=1');

contextBridge.exposeInMainWorld('orabridge', {
  isDesktop: true,
  customTitleBar,
  getAppInfo: () => ipcRenderer.invoke('orabridge:app-info'),
  checkForUpdates: () => ipcRenderer.invoke('orabridge:check-for-updates'),
  onUpdateStatus: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('orabridge:update-status', handler);
    return () => ipcRenderer.removeListener('orabridge:update-status', handler);
  },
});
