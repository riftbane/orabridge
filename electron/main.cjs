const { app, BrowserWindow, Menu, dialog, ipcMain, session, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const { randomBytes } = require('crypto');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

// Barra del titolo disegnata dall'app invece che dal sistema: nascondiamo il
// frame nativo e teniamo solo i tre pulsanti di Windows, sovrapposti nei colori
// dell'app (vedi TitleBar.jsx lato client). Su macOS no: i semafori stanno a
// sinistra e finirebbero sopra il logo.
const CUSTOM_TITLE_BAR = process.platform !== 'darwin';
const TITLE_BAR_OVERLAY = {
  color: '#1e1f24', // --bg-panel
  symbolColor: '#8b90a0', // --fg-dim
  height: 36,
};

app.setName('Orabridge');

let backend = null;
let mainWindow = null;
let logStream = null;

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(String).join(' ')}`;
  console.log(line);
  if (logStream) logStream.write(line + '\n');
}

function resourcesRoot() {
  return app.isPackaged ? process.resourcesPath : path.join(__dirname, 'resources');
}

async function startBackend() {
  process.env.DATA_DIR = app.getPath('userData');
  // Porta effimera: nessun indirizzo fisso da indovinare, e due istanze
  // dell'app non litigano per la stessa porta.
  process.env.PORT = '0';
  process.env.HOST = '127.0.0.1';
  // Serve al server per indicare nelle impostazioni il percorso del ponte MCP
  // da mettere in mcp.json: `app.isPackaged` lo sa solo Electron.
  process.env.ORABRIDGE_RESOURCES = resourcesRoot();

  if (app.isPackaged) {
    process.env.ORACLE_THICK_MODE = '1';
    process.env.ORACLE_CLIENT_LIB_DIR = path.join(resourcesRoot(), 'instantclient');
  }

  const entry = app.isPackaged
    ? path.join(resourcesRoot(), 'server', 'src', 'index.js')
    : path.join(__dirname, '..', 'server', 'src', 'index.js');

  log('avvio backend da', entry);
  if (!fs.existsSync(entry)) {
    throw new Error(`File del server non trovato: ${entry}`);
  }

  const mod = await import(pathToFileURL(entry).href);
  // Il server accetta solo le richieste che portano questo token: lo generiamo
  // a ogni avvio e la finestra lo riceve senza che passi da un file (vedi
  // injectAuthToken). L'unica eccezione è l'integrazione MCP, se accesa: lì il
  // token finisce nel file di scoperta che serve al ponte (server/src/mcp/endpoint.js).
  const token = randomBytes(32).toString('hex');
  backend = await mod.startServer({ token });
  const port = backend.port;
  log('backend in ascolto sulla porta', port);
  return { port, token };
}

// Il backend è un server HTTP sul loopback: senza un lucchetto, qualunque
// browser della macchina potrebbe aprire quell'indirizzo e ritrovarsi Orabridge
// in mano, connessioni Oracle aperte comprese. Il token viaggia come header su
// ogni richiesta della finestra, aggiunto qui a livello di rete: così vale
// anche per il documento, per il bundle e per gli EventSource della chat, che
// da JavaScript non possono mandare header propri. Chi il token non ce l'ha
// (un browser esterno) riceve 403 e una pagina che spiega perché.
function injectAuthToken(port, token) {
  const prefix = `http://127.0.0.1:${port}/`;
  session.defaultSession.webRequest.onBeforeSendHeaders(
    // Il filtro prende tutto e la porta la confrontiamo noi sull'URL vero: nei
    // pattern di Electron il trattamento della porta non è documentato, e se
    // non combaciasse l'header non partirebbe mai — finestra bianca, con il
    // server che risponde 403 a se stesso.
    { urls: ['*://*/*'] },
    (details, callback) => {
      if (!details.url.startsWith(prefix)) return callback({});
      callback({
        requestHeaders: { ...details.requestHeaders, 'X-Orabridge-Token': token },
      });
    }
  );
}

// Il client è anche una PWA: il suo service worker precarica la app shell e la
// serve dalla cache. Nel desktop il server locale usava sempre la stessa
// origine (127.0.0.1:3000), quindi il service worker sopravviveva agli
// aggiornamenti e al primo avvio dopo un update mostrava ancora la versione
// precedente: serviva un secondo riavvio per vedere le modifiche. Qui il server
// è in-process, di offline non ce ne facciamo nulla: cancelliamo service worker
// e cache prima di caricare la finestra, così parte sempre dai file appena
// installati (a maggior ragione ora che la porta cambia a ogni avvio).
async function purgeWebCaches() {
  try {
    await session.defaultSession.clearStorageData({
      storages: ['serviceworkers', 'cachestorage'],
    });
    await session.defaultSession.clearCache();
    log('cache del renderer ripulita (service worker + cache HTTP)');
  } catch (err) {
    log('pulizia cache del renderer fallita,', err && err.stack ? err.stack : err);
  }
}

// Scorciatoie da browser che in un client SQL sono solo un modo per rompere
// qualcosa: DevTools (F12, Ctrl+Shift+I/J/C) e ricarica della pagina (Ctrl+R,
// che qui butterebbe via schede e risultati). Nel pacchetto vengono ignorate;
// in sviluppo F12 resta l'unico modo per aprire gli strumenti, visto che non
// c'è più il menu.
function blockBrowserShortcuts(contents) {
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = (input.key || '').toLowerCase();
    const devTools =
      key === 'f12' || (input.control && input.shift && ['i', 'j', 'c'].includes(key));
    const reload = input.control && key === 'r';
    if (!devTools && !reload) return;
    event.preventDefault();
    if (devTools && !app.isPackaged) contents.toggleDevTools();
  });
  // Rete di sicurezza: qualunque altra strada porti agli strumenti (menu di
  // sistema, estensioni, chiamate accidentali) li richiude subito.
  contents.on('devtools-opened', () => {
    if (app.isPackaged) contents.closeDevTools();
  });
}

async function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Orabridge',
    backgroundColor: '#17181c', // --bg: niente lampo bianco prima del primo paint
    icon: path.join(__dirname, 'build', 'icon.ico'),
    ...(CUSTOM_TITLE_BAR
      ? { titleBarStyle: 'hidden', titleBarOverlay: TITLE_BAR_OVERLAY }
      : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // «Vedere il sorgente del sito» non deve essere possibile nell'app
      // installata: senza DevTools non c'è nulla da aprire.
      devTools: !app.isPackaged,
      // Il preload è sandboxed e non può leggere le costanti di questo file:
      // la scelta sulla barra del titolo gli arriva come argomento di avvio.
      additionalArguments: [`--orabridge-titlebar=${CUSTOM_TITLE_BAR ? '1' : '0'}`],
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  blockBrowserShortcuts(mainWindow.webContents);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  // I collegamenti esterni (note di rilascio, guida, risposte dell'assistente)
  // vanno aperti nel browser di sistema: dentro Electron finirebbero in una
  // finestra nuda, senza preload e senza modo di tornare indietro.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('did-fail-load', (event, code, desc, url) => {
    log('caricamento pagina fallito', code, desc, url);
  });
  await mainWindow.loadURL(`http://127.0.0.1:${port}`);
}

async function shutdownBackend() {
  if (!backend) return;
  await backend.close().catch(() => {});
  backend = null;
}

function fatalStartupError(err) {
  log('ERRORE FATALE ALL\'AVVIO:', err && err.stack ? err.stack : err);
  const logPath = logStream ? logStream.path : '(log non disponibile)';
  dialog.showErrorBox(
    'Orabridge non è riuscito ad avviarsi',
    `${err && err.message ? err.message : err}\n\nDettagli in: ${logPath}`
  );
  app.exit(1);
}

function broadcastUpdateStatus(status, extra) {
  if (mainWindow) mainWindow.webContents.send('orabridge:update-status', { status, ...extra });
}

// Codici di electron-updater che significano «la release non ha (ancora) i
// file per l'aggiornamento»: capita mentre il workflow di CI ha già creato il
// tag/la release ma non ha ancora pubblicato l'installer e `latest.yml`.
// Per l'utente non è un errore: semplicemente non c'è una nuova versione.
const UPDATE_NOT_READY_CODES = new Set([
  'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND',
  'ERR_UPDATER_LATEST_VERSION_NOT_FOUND',
  'ERR_UPDATER_NO_PUBLISHED_VERSIONS',
  'ERR_UPDATER_ASSET_NOT_FOUND',
]);

function isUpdateNotReady(err) {
  if (!err) return false;
  if (UPDATE_NOT_READY_CODES.has(err.code)) return true;
  // Il codice si perde se l'errore viene riavvolto: ripieghiamo sul messaggio.
  const message = String((err && err.message) || err);
  return /Cannot find [\w.-]+\.yml|No published versions|please ensure a production release exists/i.test(message);
}

// Il messaggio di electron-updater include lo stack e gli header HTTP: in UI
// serve solo la prima riga, altrimenti il riquadro diventa illeggibile.
function shortErrorMessage(err) {
  const message = String((err && err.message) || err || 'errore sconosciuto');
  const firstLine = message.split('\n')[0].trim();
  return firstLine.length > 200 ? `${firstLine.slice(0, 200)}…` : firstLine;
}

function reportUpdateError(err, origine) {
  if (isUpdateNotReady(err)) {
    log(`aggiornamenti (${origine}): nessuna release pronta al download,`, shortErrorMessage(err));
    broadcastUpdateStatus('not-available');
    return;
  }
  log(`aggiornamenti (${origine}): errore,`, err && err.stack ? err.stack : err);
  broadcastUpdateStatus('error', { message: shortErrorMessage(err) });
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    log('aggiornamenti: controllo in corso');
    broadcastUpdateStatus('checking');
  });
  autoUpdater.on('update-available', (info) => {
    log('aggiornamenti: disponibile la versione', info.version);
    broadcastUpdateStatus('available', { version: info.version });
  });
  autoUpdater.on('update-not-available', () => {
    log('aggiornamenti: nessun aggiornamento disponibile');
    broadcastUpdateStatus('not-available');
  });
  autoUpdater.on('error', (err) => {
    reportUpdateError(err, 'evento');
  });
  autoUpdater.on('download-progress', (progress) => {
    broadcastUpdateStatus('downloading', { percent: Math.round(progress.percent) });
  });
  autoUpdater.on('update-downloaded', async (info) => {
    log('aggiornamenti: scaricata la versione', info.version);
    broadcastUpdateStatus('downloaded', { version: info.version });
    if (!mainWindow) return;
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Aggiornamento disponibile',
      message: `È stata scaricata la versione ${info.version} di Orabridge.`,
      detail:
        "Riavvia ora per installarla, oppure verrà installata automaticamente alla prossima chiusura dell'app.",
      buttons: ['Riavvia e installa', 'Più tardi'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });

  const check = () => {
    // L'evento 'error' ha già notificato la UI: qui basta non far esplodere la promise.
    autoUpdater.checkForUpdates().catch(() => {});
  };
  check();
  setInterval(check, UPDATE_CHECK_INTERVAL_MS);
}

ipcMain.handle('orabridge:app-info', () => ({
  version: app.getVersion(),
  isPackaged: app.isPackaged,
}));

ipcMain.handle('orabridge:check-for-updates', async () => {
  if (!app.isPackaged) {
    broadcastUpdateStatus('unsupported');
    return { ok: false, reason: 'not-packaged' };
  }
  try {
    await autoUpdater.checkForUpdates();
    return { ok: true };
  } catch (err) {
    reportUpdateError(err, 'controllo manuale');
    return { ok: false, reason: isUpdateNotReady(err) ? 'not-available' : 'error' };
  }
});

app.whenReady().then(async () => {
  try {
    // Niente barra dei menu: File/Modifica/Visualizza/Finestra è cromo da
    // browser e su Windows bastava Alt per farla comparire sopra la UI. Su
    // macOS resta quello predefinito, perché lì il menu applicativo porta con
    // sé le scorciatoie di sistema (copia/incolla, chiudi finestra).
    if (process.platform !== 'darwin') Menu.setApplicationMenu(null);

    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    logStream = fs.createWriteStream(path.join(app.getPath('userData'), 'main.log'), { flags: 'a' });
    log('Orabridge desktop in avvio, isPackaged =', app.isPackaged, 'resourcesRoot =', resourcesRoot());

    const { port, token } = await startBackend();
    injectAuthToken(port, token);
    await purgeWebCaches();
    await createWindow(port);

    if (app.isPackaged) setupAutoUpdater();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(port);
    });
  } catch (err) {
    fatalStartupError(err);
  }
});

app.on('window-all-closed', async () => {
  await shutdownBackend();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async (event) => {
  if (!backend) return;
  event.preventDefault();
  await shutdownBackend();
  app.exit(0);
});

process.on('uncaughtException', (err) => {
  if (app.isReady()) fatalStartupError(err);
  else {
    log('uncaughtException prima di ready:', err && err.stack ? err.stack : err);
  }
});
