const { app, BrowserWindow, dialog, ipcMain, session, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

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
  process.env.PORT = '0';
  process.env.HOST = '127.0.0.1';

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
  backend = await mod.startServer();
  const port = backend.server.address().port;
  log('backend in ascolto sulla porta', port);
  return port;
}

// Il client è anche una PWA: il suo service worker precarica la app shell e la
// serve dalla cache. Nel desktop il server locale usa sempre la stessa origine
// (127.0.0.1:3000), quindi il service worker sopravviveva agli aggiornamenti e
// al primo avvio dopo un update mostrava ancora la versione precedente: serviva
// un secondo riavvio per vedere le modifiche. Qui il server è in-process, di
// offline non ce ne facciamo nulla: cancelliamo service worker e cache prima di
// caricare la finestra, così parte sempre dai file appena installati.
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

async function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Orabridge',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
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
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    logStream = fs.createWriteStream(path.join(app.getPath('userData'), 'main.log'), { flags: 'a' });
    log('Orabridge desktop in avvio, isPackaged =', app.isPackaged, 'resourcesRoot =', resourcesRoot());

    const port = await startBackend();
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
