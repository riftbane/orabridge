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
  // Apertura e salvataggio dei fogli .sql: il percorso scelto torna al client,
  // che lo ripassa al salvataggio successivo per scrivere senza richiedere la
  // finestra. Ricopiamo i tre campi invece di inoltrare l'oggetto ricevuto:
  // quello che arriva dalla UI può portarsi dietro roba non serializzabile,
  // che farebbe fallire l'invio sul canale.
  openSqlFile: () => ipcRenderer.invoke('orabridge:open-sql'),
  saveSqlFile: ({ path, suggestedName, text } = {}) =>
    ipcRenderer.invoke('orabridge:save-sql', { path, suggestedName, text }),
  onUpdateStatus: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('orabridge:update-status', handler);
    return () => ipcRenderer.removeListener('orabridge:update-status', handler);
  },
});
