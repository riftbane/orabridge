import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import extract from 'extract-zip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const repoRoot = path.join(root, '..');
const clientDir = path.join(repoRoot, 'client');
const serverDir = path.join(repoRoot, 'server');
const resourcesDir = path.join(root, 'resources');
const cacheDir = path.join(root, '.cache');

const skipInstantClient = process.argv.includes('--skip-instantclient');

const INSTANTCLIENT_URL =
  'https://download.oracle.com/otn_software/nt/instantclient/1923000/instantclient-basiclite-windows.x64-19.23.0.0.0dbru.zip';

function run(cmd, args, cwd, env) {
  console.log(`$ ${cmd} ${args.join(' ')}  (in ${cwd})`);
  const res = spawnSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...env },
  });
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} è uscito con codice ${res.status}`);
  }
}

function buildClient() {
  // ORABRIDGE_TARGET=desktop esclude il service worker della PWA: nell'app
  // desktop il server è locale e la cache dell'app shell faceva vedere la
  // versione precedente al primo avvio dopo un aggiornamento.
  run('npm', ['run', 'build'], clientDir, { ORABRIDGE_TARGET: 'desktop' });
}

function copyServer() {
  const dest = path.join(resourcesDir, 'server');
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });

  fs.cpSync(path.join(serverDir, 'src'), path.join(dest, 'src'), { recursive: true });
  fs.copyFileSync(path.join(serverDir, 'package.json'), path.join(dest, 'package.json'));
  fs.cpSync(path.join(serverDir, 'node_modules'), path.join(dest, 'node_modules'), { recursive: true });

  fs.cpSync(path.join(clientDir, 'dist'), path.join(dest, 'public'), { recursive: true });
  console.log('server + client copiati in', dest);
}

async function downloadInstantClient() {
  fs.mkdirSync(cacheDir, { recursive: true });
  const zipPath = path.join(cacheDir, 'instantclient-win-x64.zip');

  if (fs.existsSync(zipPath)) {
    console.log('Instant Client già in cache:', zipPath);
  } else {
    console.log('Download Instant Client Windows x64 da', INSTANTCLIENT_URL);
    const res = await fetch(INSTANTCLIENT_URL);
    if (!res.ok) throw new Error(`download Instant Client fallito: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(zipPath, buf);
    console.log(`scaricati ${(buf.length / 1e6).toFixed(1)} MB`);
  }

  const dest = path.join(resourcesDir, 'instantclient');
  fs.rmSync(dest, { recursive: true, force: true });
  const extractDir = path.join(cacheDir, 'instantclient-extract');
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });

  await extract(zipPath, { dir: extractDir });

  // Lo zip contiene una sola cartella tipo instantclient_19_23/: appiattiamo il contenuto.
  const entries = fs.readdirSync(extractDir, { withFileTypes: true });
  const inner = entries.find((e) => e.isDirectory() && e.name.startsWith('instantclient'));
  const flatSrc = inner ? path.join(extractDir, inner.name) : extractDir;
  fs.cpSync(flatSrc, dest, { recursive: true });
  fs.rmSync(extractDir, { recursive: true, force: true });

  console.log('Instant Client pronto in', dest);
}

buildClient();
copyServer();
if (skipInstantClient) {
  console.log('--skip-instantclient: salto il download dell\'Instant Client (modalità thin).');
} else {
  await downloadInstantClient();
}
console.log('prepare-resources completato.');
