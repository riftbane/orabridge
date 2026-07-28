// Informazioni sulla copia in esecuzione.
//
// La versione è iniettata da Vite al momento del build (`__APP_VERSION__`,
// definito in vite.config.js a partire da package.json): i tre package.json
// sono allineati dal workflow di rilascio, quindi è la stessa versione che
// l'app desktop riporta via IPC. Il fallback serve solo se il bundle viene
// caricato senza passare da Vite.
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '';

// `window.orabridge` esiste solo nel preload di Electron: fuori siamo nel
// client web (browser o PWA).
export const IS_DESKTOP = typeof window !== 'undefined' && !!window.orabridge;
