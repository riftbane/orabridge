// MCP (Model Context Protocol) — solo il protocollo: JSON-RPC 2.0 dentro,
// JSON-RPC 2.0 fuori. Niente Express e niente Oracle, così si può provare tutto
// con oggetti semplici (vedi test/mcp.test.js).
//
// Perché scritto a mano invece di usare @modelcontextprotocol/sdk: per un
// server di soli strumenti servono cinque metodi, mentre l'SDK porta 17
// dipendenze fra cui un secondo Express — e questo pacchetto finisce dentro
// l'installer, dove ogni MB si paga.

import path from 'path';
import { fileURLToPath } from 'url';
import { readJson } from '../secret.js';

const pkg = readJson(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json'),
  {}
);

// Revisioni di protocollo che sappiamo parlare, dalla più recente. In
// `initialize` si risponde con quella chiesta dal client se è fra queste,
// altrimenti con la nostra più recente: è il client a decidere se gli basta.
// La revisione 2026-07-28 ha reso il protocollo stateless (versione e
// capability viaggiano nei campi `_meta` di ogni richiesta, l'handshake non è
// più obbligatorio): qui non si tiene stato di sessione, quindi entrambe le ere
// funzionano senza rami separati.
export const PROTOCOL_VERSIONS = ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26'];

export const SERVER_INFO = {
  name: 'orabridge',
  title: 'Orabridge',
  version: pkg.version || '0.0.0',
};

// Istruzioni consegnate al modello all'inizializzazione: dicono da dove
// arrivano le connessioni e, soprattutto, che qui non si scrive.
export const INSTRUCTIONS = [
  "Questi strumenti leggono i database Oracle configurati nell'applicazione Orabridge, che è aperta",
  "sullo stesso computer. Sono visibili solo i database che l'utente ha esposto a questa",
  'integrazione: usa list_connections per sapere quali sono. Un database esposto ma non ancora',
  'collegato si collega da solo alla prima richiesta — non chiedere di collegarlo a mano. Le',
  'credenziali restano in Orabridge e non sono leggibili da qui.',
  '',
  'Sono strumenti di SOLA LETTURA: struttura, DDL, sorgenti PL/SQL e SELECT. Non esiste alcun modo',
  "di modificare dati o oggetti da qui — se l'utente lo chiede, spiega che va fatto dal foglio SQL",
  'di Orabridge.',
  '',
  'Prima di scrivere una query, leggi la struttura delle tabelle con describe_table: i nomi delle',
  'colonne vanno letti, non indovinati. Se non sai in quale schema cercare, usa list_schemas.',
].join('\n');

export const ERR = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
};

// Strumento inesistente: è un errore di protocollo (il client ha chiamato
// qualcosa che non gli abbiamo mai offerto), non un errore di esecuzione.
export class UnknownTool extends Error {}

const ok = (id, result) => ({ jsonrpc: '2.0', id, result });

export const rpcError = (id, code, message) => ({
  jsonrpc: '2.0',
  id: id ?? null,
  error: { code, message },
});

// Notifiche e risposte non hanno un id a cui rispondere: chi chiama non deve
// scrivere nulla sul canale.
const isNotification = (msg) => msg.id === undefined || msg.id === null;

/**
 * Gestisce un singolo messaggio JSON-RPC.
 * @param msg messaggio già deserializzato
 * @param api `{ listTools(), callTool(name, args) }` — l'implementazione vera
 * @returns la risposta da rimandare, oppure null se non va risposto nulla
 */
export async function handleMessage(msg, api) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.method !== 'string') {
    return rpcError(msg?.id, ERR.INVALID_REQUEST, 'Messaggio JSON-RPC non valido');
  }

  const { id, method, params } = msg;

  // Le notifiche si accettano in silenzio: `initialized` e `cancelled` non
  // richiedono niente da noi, e rispondere a una notifica è un errore.
  if (method.startsWith('notifications/')) return null;

  switch (method) {
    case 'initialize': {
      const wanted = params?.protocolVersion;
      return ok(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(wanted) ? wanted : PROTOCOL_VERSIONS[0],
        // Solo strumenti: niente resources, niente prompts, niente logging.
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }

    case 'ping':
      return ok(id, {});

    case 'tools/list':
      // La paginazione è opzionale e l'elenco è di sette voci: nessun cursore.
      return ok(id, { tools: api.listTools() });

    case 'tools/call': {
      const name = params?.name;
      if (typeof name !== 'string' || !name) {
        return rpcError(id, ERR.INVALID_PARAMS, 'Manca il nome dello strumento');
      }
      const args = params?.arguments ?? {};
      if (typeof args !== 'object' || Array.isArray(args)) {
        return rpcError(id, ERR.INVALID_PARAMS, 'Gli argomenti devono essere un oggetto');
      }
      try {
        const text = await api.callTool(name, args);
        return ok(id, { content: [{ type: 'text', text }] });
      } catch (err) {
        if (err instanceof UnknownTool) {
          return rpcError(id, ERR.INVALID_PARAMS, err.message);
        }
        // Errore di esecuzione: torna come risultato con isError, non come
        // errore JSON-RPC. È la differenza che permette al modello di leggerlo
        // e correggersi da solo invece di vedere la chiamata sparire.
        return ok(id, { content: [{ type: 'text', text: err.message }], isError: true });
      }
    }

    default:
      if (isNotification(msg)) return null;
      return rpcError(id, ERR.METHOD_NOT_FOUND, `Metodo non supportato: ${method}`);
  }
}

// Un batch JSON-RPC (le revisioni più vecchie lo ammettevano) si gestisce
// messaggio per messaggio; se dentro c'erano solo notifiche non si risponde.
export async function handleBatch(messages, api) {
  const out = [];
  for (const msg of messages) {
    const answer = await handleMessage(msg, api);
    if (answer) out.push(answer);
  }
  return out;
}
