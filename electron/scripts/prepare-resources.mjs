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

// I binari di llama.cpp esistono per ogni combinazione di piattaforma e
// acceleratore, e tutti insieme superano i 600 MB. Nell'installer Windows ne
// servono due soli: la versione CPU e quella Vulkan. Le varianti CUDA valgono
// mezzo giga da sole e non aggiungono nulla, perché Vulkan accelera anche sulle
// schede NVIDIA; le altre piattaforme non ci interessano proprio.
const LLAMA_KEEP = new Set(['win-x64', 'win-x64-vulkan']);
const LLAMA_SCOPE = path.join('node_modules', '@node-llama-cpp');
// Copia dei sorgenti di llama.cpp per ricompilarlo sul posto: 32 MB che non
// serviranno mai, visto che sul computer dell'utente non si compila niente
// (`getLlama({ build: 'never' })`).
const LLAMA_SOURCE_BUNDLE = path.join(
  'node_modules',
  'node-llama-cpp',
  'llama',
  'gitRelease.bundle'
);

function keepInServerModules(src, root) {
  const rel = path.relative(root, src);
  if (rel === LLAMA_SOURCE_BUNDLE) return false;
  if (!rel.startsWith(LLAMA_SCOPE)) return true;
  const parts = rel.split(path.sep);
  // node_modules/@node-llama-cpp -> la cartella dello scope passa sempre,
  // il filtro vale sui pacchetti che ci stanno dentro.
  if (parts.length < 3) return true;
  return LLAMA_KEEP.has(parts[2]);
}

function copyServer() {
  const dest = path.join(resourcesDir, 'server');
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });

  fs.cpSync(path.join(serverDir, 'src'), path.join(dest, 'src'), { recursive: true });
  fs.copyFileSync(path.join(serverDir, 'package.json'), path.join(dest, 'package.json'));
  fs.cpSync(path.join(serverDir, 'node_modules'), path.join(dest, 'node_modules'), {
    recursive: true,
    filter: (src) => keepInServerModules(src, serverDir),
  });

  const engines = path.join(dest, LLAMA_SCOPE);
  const shipped = fs.existsSync(engines) ? fs.readdirSync(engines) : [];
  if (!shipped.length) {
    // Su Linux/WSL npm non installa i binari Windows: il pacchetto si costruisce
    // lo stesso, ma senza motore per i modelli locali. Va bene per una prova,
    // non per una release (che infatti la CI builda su Windows nativo).
    console.warn(
      'ATTENZIONE: nessun binario llama.cpp per Windows in server/node_modules — l\'app risultante non potrà usare i modelli locali.'
    );
  } else {
    console.log('motori llama.cpp inclusi:', shipped.join(', '));
  }

  fs.cpSync(path.join(clientDir, 'dist'), path.join(dest, 'public'), { recursive: true });
  console.log('server + client copiati in', dest);
}

// Il ponte MCP per gli editor esterni: un file, nessuna dipendenza. Viene
// lanciato dall'eseguibile di Orabridge in modalità Node, quindi non serve
// impacchettare un runtime accanto.
function copyMcpBridge() {
  const dest = path.join(resourcesDir, 'mcp-bridge.cjs');
  fs.mkdirSync(resourcesDir, { recursive: true });
  fs.copyFileSync(path.join(root, 'mcp-bridge.cjs'), dest);
  console.log('ponte MCP copiato in', dest);
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
copyMcpBridge();
if (skipInstantClient) {
  console.log('--skip-instantclient: salto il download dell\'Instant Client (modalità thin).');
} else {
  await downloadInstantClient();
}
console.log('prepare-resources completato.');
