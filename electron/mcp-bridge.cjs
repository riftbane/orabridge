#!/usr/bin/env node
'use strict';

// Ponte fra VS Code e Orabridge: MCP su stdin/stdout da una parte, l'endpoint
// HTTP locale dell'app dall'altra. Nessuna dipendenza, CommonJS, un file solo —
// viene copiato in resources/ e lanciato dall'eseguibile di Orabridge in
// modalità Node (ELECTRON_RUN_AS_NODE=1), così non serve un runtime a parte.
//
// Perché serve un ponte invece di puntare VS Code direttamente all'HTTP:
// l'app desktop ascolta su una porta effimera e cambia il token a ogni avvio,
// quindi in un mcp.json statico non ci sta nulla di stabile. Il ponte li
// rilegge dal file di scoperta a ogni messaggio, e come effetto collaterale il
// token non finisce mai in un file di configurazione dell'editor.
//
// In più risolve WSL: lanciato da un workspace WSL attraverso l'interop di
// Windows, questo processo gira comunque sul lato Windows e quindi il loopback
// dell'app lo raggiunge — senza esporre nessuna porta sulla rete.
//
// Regola d'oro: su stdout escono solo messaggi JSON-RPC. Tutto il resto (log,
// errori) va su stderr, dove VS Code lo mostra nel canale del server.

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const ENDPOINT_NAME = 'mcp-endpoint.json';
const REQUEST_TIMEOUT_MS = 120000;

// Dove l'app scrive porta e token. La prima voce che esiste vince.
function endpointCandidates() {
  const out = [];
  if (process.env.ORABRIDGE_MCP_ENDPOINT) out.push(process.env.ORABRIDGE_MCP_ENDPOINT);
  if (process.platform === 'win32' && process.env.APPDATA) {
    out.push(path.join(process.env.APPDATA, 'Orabridge', ENDPOINT_NAME));
  } else if (process.platform === 'darwin') {
    out.push(path.join(os.homedir(), 'Library', 'Application Support', 'Orabridge', ENDPOINT_NAME));
  } else {
    out.push(path.join(os.homedir(), '.config', 'Orabridge', ENDPOINT_NAME));
  }
  // Server avviato a mano dal repository (`npm run dev` in server/): la cartella
  // dati è server/data. Comodo in sviluppo, innocuo nel pacchetto installato.
  out.push(path.join(__dirname, '..', 'server', 'data', ENDPOINT_NAME));
  out.push(path.join(__dirname, '..', 'data', ENDPOINT_NAME));
  return out;
}

// Riletto a ogni messaggio: se l'app si riavvia, porta e token nuovi vengono
// raccolti da soli senza far ripartire il ponte.
function readEndpoint() {
  for (const file of endpointCandidates()) {
    try {
      const info = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (info && Number.isInteger(info.port) && info.port > 0) return info;
    } catch {
      /* file assente o illeggibile: si prova il successivo */
    }
  }
  return null;
}

const write = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');

const rpcError = (id, code, message) => ({
  jsonrpc: '2.0',
  id: id === undefined ? null : id,
  error: { code, message },
});

// Risposta all'handshake generata qui, quando l'app non è raggiungibile: senza
// di questa VS Code segnerebbe il server come guasto e non riproverebbe fino al
// ricaricamento della finestra. Così invece il server resta registrato e a
// spiegare il problema è il primo strumento che si prova a usare.
function localInitialize(msg) {
  return {
    jsonrpc: '2.0',
    id: msg.id,
    result: {
      protocolVersion: msg.params?.protocolVersion || '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'orabridge', title: 'Orabridge', version: '0.0.0' },
      instructions:
        "Orabridge non è in esecuzione: apri l'applicazione e collega un database, poi riprova.",
    },
  };
}

const NOT_RUNNING =
  "Orabridge non è in esecuzione, oppure l'integrazione con gli editor esterni è spenta. " +
  'Apri Orabridge, collega un database e controlla Impostazioni → Copilot e MCP.';

function post(endpoint, message) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    const req = http.request(
      {
        host: '127.0.0.1',
        port: endpoint.port,
        method: 'POST',
        path: '/api/mcp',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'Content-Length': body.length,
          ...(endpoint.token ? { 'X-Orabridge-Token': endpoint.token } : {}),
        },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (text += chunk));
        res.on('end', () => {
          // 202 senza corpo: era una notifica, non c'è niente da rimandare.
          if (!text.trim()) return resolve(null);
          let parsed;
          try {
            parsed = JSON.parse(text);
          } catch {
            return reject(new Error(`risposta non JSON (HTTP ${res.statusCode})`));
          }
          // Un errore JSON-RPC è già nel formato giusto e va inoltrato com'è
          // (per esempio: integrazione disattivata nelle impostazioni).
          if (parsed && (parsed.jsonrpc || Array.isArray(parsed))) return resolve(parsed);
          // Errore del server che non parla JSON-RPC: tipicamente il token non
          // valido perché l'app è stata riavviata.
          if (res.statusCode >= 400) {
            return reject(new Error(parsed?.error || `HTTP ${res.statusCode}`));
          }
          resolve(parsed);
        });
      }
    );
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('nessuna risposta entro 120 s')));
    req.on('error', reject);
    req.end(body);
  });
}

async function handle(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return write(rpcError(null, -32700, 'JSON non valido'));
  }

  const isNotification = msg.id === undefined || msg.id === null;
  const endpoint = readEndpoint();

  if (!endpoint) {
    if (isNotification) return;
    if (msg.method === 'initialize') return write(localInitialize(msg));
    return write(rpcError(msg.id, -32000, NOT_RUNNING));
  }

  try {
    const answer = await post(endpoint, msg);
    if (answer) write(answer);
  } catch (err) {
    process.stderr.write(`orabridge-mcp: ${err.message}\n`);
    if (isNotification) return;
    if (msg.method === 'initialize') return write(localInitialize(msg));
    write(rpcError(msg.id, -32000, `${NOT_RUNNING} (dettaglio: ${err.message})`));
  }
}

// Framing del trasporto stdio: un messaggio JSON per riga.
//
// Le richieste non si aspettano una per una (le risposte si appaiano per id,
// non per ordine di arrivo), ma vanno tenute d'occhio: chiudere il processo
// mentre una è in volo butterebbe via la risposta a un messaggio già accettato.
const pending = new Set();

function accept(line) {
  const work = handle(line).catch((err) =>
    process.stderr.write(`orabridge-mcp: ${err.message}\n`)
  );
  pending.add(work);
  work.finally(() => pending.delete(work));
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (line) accept(line);
  }
});

// Stdin chiuso: il client ha finito di parlare. Prima di uscire si aspetta che
// le richieste già in corso scrivano la loro risposta — con un tetto, perché un
// processo che non muore è peggio di una risposta persa. Nell'uso da editor la
// coda è vuota e l'uscita è immediata; conta quando qualcuno pilota il ponte da
// uno script, mandando i messaggi e chiudendo subito il tubo.
const DRAIN_MS = 15000;
async function drainAndExit() {
  if (pending.size) {
    await Promise.race([
      Promise.allSettled([...pending]),
      new Promise((r) => setTimeout(r, DRAIN_MS)),
    ]);
  }
  process.exit(0);
}
process.stdin.on('end', drainAndExit);
process.stdin.on('error', drainAndExit);
