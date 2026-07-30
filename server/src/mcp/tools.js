// Gli strumenti esposti agli editor esterni (Copilot in VS Code) via MCP.
//
// Sono gli stessi del pannello AI — `server/src/ai/tools.js` — con tre
// differenze che contano:
//
// 1. SOLA LETTURA. L'elenco si costruisce filtrando `TOOL_DEFS` sul permesso
//    `read`, quindi `execute_sql` non esiste da questa parte: non è nascosto,
//    non è protetto da un'impostazione, non c'è. `runTool` viene chiamato con
//    `readOnly: true`, che è la seconda serratura sulla stessa porta.
// 2. Le connessioni non si scelgono da una UI: c'è `list_connections` e un
//    parametro `connection` facoltativo su ogni strumento.
// 3. Le query girano su una connessione del pool, non sulla sessione del foglio
//    SQL: chi lavora da VS Code non deve accodarsi alle query dell'utente né
//    entrare nella sua transazione aperta.
//
// Le credenziali non passano da qui in nessuna forma: `list_connections`
// restituisce nome, schema e versione del database, non utente, host, servizio
// né password.

import { pools } from '../pools.js';
import { store } from '../store.js';
import { settings } from '../settings.js';
import { TOOL_DEFS, ToolError, runTool } from '../ai/tools.js';
import { UnknownTool } from './protocol.js';

const CONNECTION_PARAM = {
  type: 'string',
  description:
    'Nome (o id) della connessione Orabridge da interrogare. Si può omettere se ce n\'è una sola attiva; con più connessioni attive chiama prima list_connections.',
};

const LIST_CONNECTIONS = {
  name: 'list_connections',
  title: 'Connessioni attive',
  description:
    "Elenca i database attualmente collegati in Orabridge, con lo schema corrente di ciascuno. Chiamalo per primo se non sai su quale database lavorare, o se un altro strumento dice che la connessione è ambigua. Le connessioni le apre l'utente dentro Orabridge: da qui non si possono creare né aprire.",
  inputSchema: { type: 'object', properties: {}, required: [] },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

// Definizioni in formato MCP: `parameters` diventa `inputSchema`, si aggiunge
// `connection` e si dichiara che nessuno di questi strumenti modifica niente
// (`readOnlyHint` permette a VS Code di non chiedere conferma ogni volta).
function toMcpTool(def) {
  return {
    name: def.name,
    description: def.description,
    inputSchema: {
      ...def.parameters,
      properties: { ...def.parameters.properties, connection: CONNECTION_PARAM },
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  };
}

// L'unica fonte di verità su cosa è di sola lettura è il permesso dichiarato
// nello strumento stesso: se un domani in `TOOL_DEFS` comparisse un nuovo
// strumento di scrittura, qui non entrerebbe da solo.
const READ_ONLY_DEFS = TOOL_DEFS.filter((t) => t.permission === 'read');

export const listTools = () => [LIST_CONNECTIONS, ...READ_ONLY_DEFS.map(toMcpTool)];

const byName = new Map(READ_ONLY_DEFS.map((d) => [d.name, d]));

// Nome «umano» di una connessione attiva, per i messaggi.
function nameOf(id) {
  return store.list().find((c) => c.id === id)?.name || id;
}

function activeConnections() {
  return pools.ids().map((id) => {
    const entry = pools.get(id);
    return { id, name: nameOf(id), schema: entry.currentSchema, version: entry.version };
  });
}

function connectionsText() {
  const list = activeConnections();
  if (!list.length) {
    return (
      'Nessuna connessione attiva in Orabridge. Chiedi all\'utente di collegarsi a un database ' +
      "nell'applicazione: da qui le connessioni non si possono aprire."
    );
  }
  return (
    `Connessioni attive (${list.length}):\n` +
    list
      .map((c) => `  ${c.name} — schema corrente ${c.schema}, Oracle ${c.version}`)
      .join('\n') +
    '\nPassa il nome nel parametro `connection` degli altri strumenti.'
  );
}

// Quale database interrogare. Senza indicazioni si usa l'unica connessione
// attiva; con più di una si chiede di scegliere, elencando i nomi — un errore
// che dice come uscirne, non un vicolo cieco.
export function resolveConnection(wanted) {
  const list = activeConnections();
  if (!list.length) {
    throw new ToolError(
      'Nessuna connessione attiva in Orabridge: chiedi all\'utente di collegarsi a un database ' +
        "nell'applicazione, poi riprova."
    );
  }
  const want = String(wanted || '').trim();
  if (!want) {
    if (list.length === 1) return list[0].id;
    throw new ToolError(
      `Ci sono ${list.length} connessioni attive: indica quale usare nel parametro \`connection\`. ` +
        `Disponibili: ${list.map((c) => c.name).join(', ')}.`
    );
  }
  const hit =
    list.find((c) => c.id === want) ||
    list.find((c) => c.name.toLowerCase() === want.toLowerCase()) ||
    list.find((c) => c.name.toLowerCase().includes(want.toLowerCase()));
  if (!hit) {
    throw new ToolError(
      `Nessuna connessione attiva di nome "${want}". Attive: ${list.map((c) => c.name).join(', ')}.`
    );
  }
  return hit.id;
}

export async function callTool(name, args = {}) {
  if (name === LIST_CONNECTIONS.name) return connectionsText();

  const def = byName.get(name);
  if (!def) {
    // Il caso che conta è `execute_sql`: esiste nel pannello AI, non qui. Vale
    // la pena spiegarlo, altrimenti il modello ci riprova a ogni giro.
    const known = TOOL_DEFS.find((t) => t.name === name);
    throw new UnknownTool(
      known
        ? `${name} non è disponibile: l'integrazione con gli editor esterni è di sola lettura. ` +
          'Le modifiche si fanno dal foglio SQL di Orabridge.'
        : `Strumento sconosciuto: ${name}`
    );
  }

  const { connection, ...input } = args;
  const connId = resolveConnection(connection);
  return runTool(connId, name, input, {
    maxRows: settings.ai().maxRows,
    // Fuori dalla sessione del foglio SQL e senza accesso agli strumenti di
    // scrittura: vedi i commenti in ai/tools.js.
    pooled: true,
    readOnly: true,
    source: 'mcp',
  });
}

export const mcpApi = { listTools, callTool };
