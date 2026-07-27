const { app, BrowserWindow, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

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
    },
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
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

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    logStream = fs.createWriteStream(path.join(app.getPath('userData'), 'main.log'), { flags: 'a' });
    log('Orabridge desktop in avvio, isPackaged =', app.isPackaged, 'resourcesRoot =', resourcesRoot());

    const port = await startBackend();
    await createWindow(port);

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
