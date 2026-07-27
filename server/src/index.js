import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import connectionsRouter from './routes/connections.js';
import metadataRouter from './routes/metadata.js';
import sqlRouter from './routes/sql.js';
import historyRouter from './routes/history.js';
import diffRouter from './routes/diff.js';
import aiRouter from './routes/ai.js';
import { pools } from './pools.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '20mb' }));

  // JSON-only writes: blocks cross-site form posts from random web pages.
  app.use('/api', (req, res, next) => {
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && !req.is('json')) {
      return res.status(415).json({ error: 'Content-Type application/json richiesto' });
    }
    next();
  });

  app.use('/api/connections', connectionsRouter);
  app.use('/api/history', historyRouter);
  // Il confronto fra due database tocca due connessioni: sta fuori da /api/conn/:id.
  app.use('/api/diff', diffRouter);
  // Assistente AI: impostazioni, elenco modelli e sessioni di chat.
  app.use('/api/ai', aiRouter);

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
export async function startServer({ port = PORT, host = HOST } = {}) {
  const app = createApp();
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(port, host);
    s.once('listening', () => resolve(s));
    s.once('error', reject);
  });
  const close = async () => {
    await new Promise((resolve) => server.close(resolve));
    await pools.closeAll().catch(() => {});
  };
  return { app, server, close };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { close } = await startServer();
  console.log(`Orabridge in ascolto su http://${HOST}:${PORT}`);

  const shutdown = async () => {
    console.log('Arresto in corso…');
    await close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
