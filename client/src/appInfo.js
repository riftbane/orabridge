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

// Nell'app desktop (Windows/Linux) la barra del titolo di sistema è nascosta e
// la disegniamo noi: il client vi sposta logo e comandi globali, lasciando al
// sistema solo i tre pulsanti della finestra. Nel browser e su macOS resta il
// cromo nativo, quindi la testata dell'app non va disegnata.
export const CUSTOM_TITLE_BAR = IS_DESKTOP && !!window.orabridge.customTitleBar;
