// Endpoint MCP: un solo indirizzo, JSON-RPC 2.0 sul corpo della POST. È il
// trasporto «Streamable HTTP» della specifica, nella sua forma minima — non
// apriamo stream SSE perché un server di soli strumenti non ha niente da dire
// se non gli si chiede.
//
// Sta sotto /api di proposito: eredita i controlli già in piedi in index.js —
// token dell'app desktop, Host solo loopback (DNS rebinding), rifiuto delle
// scritture cross-site e Content-Type obbligatorio.

import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import { settings } from '../settings.js';
import { pools } from '../pools.js';
import { activity } from '../mcp/activity.js';
import { ENDPOINT_FILE, isPublished, sync } from '../mcp/endpoint.js';
import { ERR, handleBatch, handleMessage, rpcError } from '../mcp/protocol.js';
import { exposedConnections, listTools, mcpApi } from '../mcp/tools.js';

const router = Router();
const a = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// Percorsi pronti da incollare in mcp.json, ma solo dentro l'app desktop: il
// ponte gira come Node dell'eseguibile di Orabridge (ELECTRON_RUN_AS_NODE).
// `ORABRIDGE_RESOURCES` lo imposta il main di Electron, che è l'unico a sapere
// se l'app è impacchettata. Se il ponte non c'è (build senza
// prepare-resources), si torna null e la UI propone la forma HTTP.
function desktopPaths() {
  if (!process.versions.electron || !process.env.ORABRIDGE_RESOURCES) return null;
  const bridgePath = path.join(process.env.ORABRIDGE_RESOURCES, 'mcp-bridge.cjs');
  if (!fs.existsSync(bridgePath)) return null;
  return { execPath: process.execPath, bridgePath };
}

// Stato per la UI delle impostazioni (non fa parte del protocollo MCP).
router.get('/status', (req, res) => {
  res.json({
    enabled: settings.mcp().enabled,
    published: isPublished(),
    endpointFile: ENDPOINT_FILE,
    tools: listTools().map((t) => t.name),
    activeConnections: pools.ids().length,
    // Quante connessioni l'utente ha esposto: l'elenco vero la finestra ce l'ha
    // già (`/api/connections` porta la configurazione MCP di ognuna), qui serve
    // solo per dire in una riga se c'è qualcosa da leggere.
    exposed: exposedConnections().length,
    desktop: desktopPaths(),
  });
});

router.put('/status', (req, res) => {
  const out = settings.updateMcp({ enabled: !!req.body?.enabled });
  // Accendere l'integrazione pubblica subito porta e token per il ponte,
  // spegnerla cancella il file: nessun riavvio dell'app.
  sync();
  res.json({ ...out, published: isPublished(), endpointFile: ENDPOINT_FILE });
});

// Cosa sta facendo Copilot, mentre lo fa: collegamenti aperti dall'integrazione
// e chiamate agli strumenti, in tempo reale. Serve alla finestra di Orabridge —
// non è il trasporto MCP, che è la POST qui sotto.
router.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
  // Chi si collega a stream già avviato non deve trovare la lavagna pulita.
  send({ type: 'snapshot', entries: activity.recent() });
  const off = activity.subscribe((entry) => send({ type: 'entry', entry }));
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    off();
  });
});

// La specifica prevede che un server senza stream server→client risponda 405
// alla GET sull'endpoint.
router.get('/', (req, res) => {
  res.set('Allow', 'POST').status(405).json({ error: 'Su questo endpoint si parla MCP via POST' });
});

router.post(
  '/',
  a(async (req, res) => {
    if (!settings.mcp().enabled) {
      return res.status(403).json(
        rpcError(
          Array.isArray(req.body) ? null : req.body?.id,
          ERR.INTERNAL,
          'L\'integrazione con gli editor esterni è disattivata in Orabridge ' +
            '(Impostazioni → Copilot e MCP).'
        )
      );
    }

    const body = req.body;
    const answer = Array.isArray(body)
      ? await handleBatch(body, mcpApi)
      : await handleMessage(body, mcpApi);

    // Solo notifiche: niente da rispondere, e un corpo vuoto è la risposta
    // giusta (la specifica chiede 202).
    if (!answer || (Array.isArray(answer) && !answer.length)) return res.status(202).end();
    res.json(answer);
  })
);

export default router;
