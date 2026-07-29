import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import connectionsRouter from './routes/connections.js';
import metadataRouter from './routes/metadata.js';
import sqlRouter from './routes/sql.js';
import historyRouter from './routes/history.js';
import diffRouter from './routes/diff.js';
import graphRouter from './routes/graph.js';
import aiRouter from './routes/ai.js';
import releasesRouter from './routes/releases.js';
import { pools } from './pools.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// `PORT=0` vuol dire «porta effimera, la sceglie il sistema»: è quello che
// chiede l'app desktop. Un `|| 3000` lo scambierebbe per «non impostata».
const rawPort = process.env.PORT ? Number(process.env.PORT) : NaN;
const PORT = Number.isInteger(rawPort) && rawPort >= 0 && rawPort <= 65535 ? rawPort : 3000;
// Di default si ascolta solo il loopback: esporsi sulla rete va chiesto
// esplicitamente (il Dockerfile imposta HOST=0.0.0.0, il container è isolato e
// il compose pubblica comunque la porta solo su 127.0.0.1).
const HOST = process.env.HOST || '127.0.0.1';
// Token dell'app desktop: vedi requireToken().
const TOKEN = process.env.ORABRIDGE_TOKEN || '';
// Dietro un reverse proxy che non riscrive l'Origin, le origini legittime si
// elencano qui (separate da virgola).
const EXTRA_ORIGINS = (process.env.ORABRIDGE_ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim().toLowerCase())
  .filter(Boolean);

const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

// "127.0.0.1:3000" → "127.0.0.1", "[::1]:3000" → "[::1]".
function hostnameOf(hostHeader) {
  const h = String(hostHeader || '').trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1);
  const i = h.lastIndexOf(':');
  return i === -1 ? h : h.slice(0, i);
}

// Quando ascoltiamo solo il loopback, l'unico Host header sensato è il loopback
// stesso: un `Host: qualcosa.example` significa che una pagina web ci sta
// raggiungendo facendo puntare il suo dominio a 127.0.0.1 (DNS rebinding), che
// è il modo di aggirare le protezioni basate sulla sola origine.
function requireLocalHost(req, res, next) {
  if (LOOPBACK_NAMES.has(hostnameOf(req.headers.host))) return next();
  res.status(403).json({ error: 'Host non consentito' });
}

// Pagina servita al browser che apre l'indirizzo del server desktop: senza
// token non vedrà mai la app, tanto vale spiegargli perché.
const DESKTOP_ONLY_PAGE = `<!doctype html>
<html lang="it"><head><meta charset="utf-8"><title>Orabridge</title>
<style>
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:#17181c; color:#e6e7ea; font:15px/1.6 system-ui, sans-serif; text-align:center }
  div { max-width:32rem; padding:2rem }
  h1 { font-size:1.5rem; margin:0 0 .75rem; font-weight:600 }
  p { margin:0; color:#8b90a0 }
</style></head>
<body><div>
  <h1>Orabridge è già aperto</h1>
  <p>Questo indirizzo è il server locale dell'app desktop e risponde solo alla sua
  finestra. Usa l'applicazione Orabridge per lavorare sui database.</p>
</div></body></html>`;

const wantsHtml = (req) =>
  req.method === 'GET' && String(req.headers.accept || '').includes('text/html');

// L'app desktop porta con sé un server HTTP in ascolto sul loopback: senza
// questo controllo qualunque browser (o processo) della macchina potrebbe
// aprire quell'indirizzo e pilotare le connessioni Oracle già attive. Il main
// di Electron genera un token a ogni avvio e lo inietta a livello di rete in
// tutte le richieste della finestra (vedi injectAuthToken in main.cjs), quindi
// qui basta pretenderlo. Senza token il controllo è spento: è il caso del
// deployment web/Docker, dove il server è il servizio, non un dettaglio interno.
function requireToken(token) {
  return (req, res, next) => {
    if (req.get('x-orabridge-token') === token) return next();
    if (wantsHtml(req)) return res.status(403).type('html').send(DESKTOP_ONLY_PAGE);
    res.status(403).json({ error: "Accesso consentito solo dall'app Orabridge" });
  };
}

// Una scrittura arrivata da un'altra origine è una richiesta cross-site: le
// uniche legittime sono quelle della nostra pagina (stesso host dell'API).
// Origin assente = client non browser (curl, script): non c'è cross-site.
function sameOrigin(req) {
  const origin = req.get('origin');
  if (!origin) return true;
  const host = String(req.headers.host || '').toLowerCase();
  try {
    const url = new URL(origin);
    return url.host === host || EXTRA_ORIGINS.includes(origin.toLowerCase());
  } catch {
    return false;
  }
}

function createApp({ token = TOKEN, host = HOST } = {}) {
  const app = express();
  app.disable('x-powered-by');

  if (LOOPBACK_NAMES.has(String(host).toLowerCase())) app.use(requireLocalHost);
  if (token) app.use(requireToken(token));

  app.use(express.json({ limit: '20mb' }));

  app.use('/api', (req, res, next) => {
    // JSON-only writes: blocks cross-site form posts from random web pages.
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && !req.is('json')) {
      return res.status(415).json({ error: 'Content-Type application/json richiesto' });
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !sameOrigin(req)) {
      return res.status(403).json({ error: 'Richiesta cross-site rifiutata' });
    }
    next();
  });

  app.use('/api/connections', connectionsRouter);
  app.use('/api/history', historyRouter);
  // Il confronto fra due database tocca due connessioni: sta fuori da /api/conn/:id.
  app.use('/api/diff', diffRouter);
  // Editor a nodi: una sessione tiene la fotografia dello schema su cui si
  // calcolano le modifiche, quindi non sta sotto /api/conn/:id.
  app.use('/api/graph', graphRouter);
  // Assistente AI: impostazioni, elenco modelli e sessioni di chat.
  app.use('/api/ai', aiRouter);
  // Novità delle versioni, lette da GitHub Releases e messe in cache.
  app.use('/api/releases', releasesRouter);

  // Everything under /api/conn/:id requires an active connection.
  const requireConn = (req, res, next) => {
    const entry = pools.get(req.params.id);
    if (!entry) return res.status(409).json({ error: 'Connessione non attiva' });
    req.oraEntry = entry;
    next();
  };
  app.use('/api/conn/:id', requireConn, metadataRouter);
  app.use('/api/conn/:id', requireConn, sqlRouter);

  // Static frontend (client build).
  const pub = path.join(__dirname, '..', 'public');
  if (fs.existsSync(pub)) {
    app.use(express.static(pub));
    app.get('*', (req, res) => res.sendFile(path.join(pub, 'index.html')));
  } else {
    app.get('/', (req, res) =>
      res.send('Orabridge API attiva. Frontend non compilato (usare vite dev o npm run build).')
    );
  }

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: err.message || 'Errore interno' });
  });

  return app;
}

// Avvia il server e restituisce anche `close()`, per l'uso da chi importa
// questo modulo invece di eseguirlo come processo CLI (es. il main process Electron).
export async function startServer({ port = PORT, host = HOST, token = TOKEN } = {}) {
  const app = createApp({ token, host });
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(port, host);
    s.once('listening', () => resolve(s));
    s.once('error', reject);
  });
  const close = async () => {
    await new Promise((resolve) => server.close(resolve));
    await pools.closeAll().catch(() => {});
  };
  // Con `port: 0` la porta vera la conosce solo il server: la restituiamo.
  return { app, server, close, port: server.address().port };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { close, port } = await startServer();
  console.log(`Orabridge in ascolto su http://${HOST}:${port}`);

  const shutdown = async () => {
    console.log('Arresto in corso…');
    await close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
