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
//    parametro `connection` facoltativo su ogni strumento. Si vedono solo
//    quelle con l'interruttore MCP acceso (`mcp.enabled` sulla connessione,
//    spento di default): le altre da qui non esistono.
// 3. Il collegamento lo apre l'integrazione, se serve. Chiedere all'utente di
//    connettersi a mano prima di ogni domanda rendeva l'integrazione inutile
//    metà delle volte; ora una connessione esposta si apre da sé al primo
//    utilizzo, usando la password già salvata (vedi `ensureOpen`). Quello che
//    succede finisce in `activity`, così l'utente lo vede in tempo reale.
// 4. Le query girano su una connessione del pool, non sulla sessione del foglio
//    SQL: chi lavora da VS Code non deve accodarsi alle query dell'utente né
//    entrare nella sua transazione aperta.
//
// Le credenziali non passano da qui in nessuna forma: `list_connections`
// restituisce nome, schema e versione del database, non utente, host, servizio
// né password.

import { pools, friendlyError } from '../pools.js';
import { store } from '../store.js';
import { settings } from '../settings.js';
import { TOOL_DEFS, ToolError, runTool } from '../ai/tools.js';
import { UnknownTool } from './protocol.js';
import { activity } from './activity.js';

const CONNECTION_PARAM = {
  type: 'string',
  description:
    "Nome (o id) della connessione Orabridge da interrogare. Si può omettere se ce n'è una sola esposta; con più connessioni chiama prima list_connections.",
};

const LIST_CONNECTIONS = {
  name: 'list_connections',
  title: 'Database disponibili',
  description:
    "Elenca i database Orabridge esposti a questa integrazione, con lo schema corrente di quelli già collegati. Chiamalo per primo se non sai su quale database lavorare, o se un altro strumento dice che la connessione è ambigua. Un database non ancora collegato si collega da solo al primo utilizzo: non serve chiedere niente all'utente. Quali database compaiono lo decide l'utente in Orabridge, connessione per connessione.",
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

// I database che l'utente ha esposto: l'interruttore è sulla singola
// connessione ed è spento finché non lo si accende. Una connessione non esposta
// non compare qui, quindi da MCP non è nominabile in nessun modo.
export function exposedConnections() {
  return store
    .list()
    .filter((c) => c.mcp?.enabled)
    .map((c) => {
      const entry = pools.get(c.id);
      return {
        id: c.id,
        name: c.name,
        permissions: c.mcp.permissions,
        hasPassword: c.hasPassword,
        connected: !!entry,
        schema: entry?.currentSchema || null,
        version: entry?.version || null,
      };
    });
}

const NOTHING_EXPOSED =
  "Nessun database è esposto a questa integrazione. In Orabridge ogni connessione ha un suo " +
  'interruttore «Esponi a Copilot (MCP)» (finestra di modifica della connessione, oppure ' +
  'Impostazioni → Copilot e MCP): è spento di default, e solo l\'utente può accenderlo.';

function connectionsText() {
  const list = exposedConnections();
  if (!list.length) return NOTHING_EXPOSED;
  return (
    `Database esposti (${list.length}):\n` +
    list
      .map((c) => {
        if (!c.permissions.read) return `  ${c.name} — lettura non consentita dall'utente`;
        if (c.connected) return `  ${c.name} — collegato, schema corrente ${c.schema}, Oracle ${c.version}`;
        return `  ${c.name} — non ancora collegato: si collega da sé appena lo interroghi`;
      })
      .join('\n') +
    '\nPassa il nome nel parametro `connection` degli altri strumenti.'
  );
}

// Quale database interrogare, fra quelli esposti. Senza indicazioni si usa
// l'unico esposto; se sono più d'uno ma ne è collegato uno solo si usa quello
// (è il database su cui l'utente sta lavorando in questo momento); altrimenti
// si chiede di scegliere, elencando i nomi — un errore che dice come uscirne,
// non un vicolo cieco.
export function pickConnection(wanted) {
  const list = exposedConnections();
  if (!list.length) throw new ToolError(NOTHING_EXPOSED);

  const want = String(wanted || '').trim();
  if (!want) {
    if (list.length === 1) return list[0];
    const open = list.filter((c) => c.connected);
    if (open.length === 1) return open[0];
    throw new ToolError(
      `Ci sono ${list.length} database esposti: indica quale usare nel parametro \`connection\`. ` +
        `Disponibili: ${list.map((c) => c.name).join(', ')}.`
    );
  }
  const hit =
    list.find((c) => c.id === want) ||
    list.find((c) => c.name.toLowerCase() === want.toLowerCase()) ||
    list.find((c) => c.name.toLowerCase().includes(want.toLowerCase()));
  if (!hit) {
    throw new ToolError(
      `Nessun database esposto di nome "${want}". Disponibili: ${list.map((c) => c.name).join(', ')}. ` +
        "Se il database esiste in Orabridge ma non è in elenco, l'utente non l'ha esposto a questa integrazione."
    );
  }
  return hit;
}

// Collegamenti che stiamo aprendo: due strumenti chiamati in parallelo sullo
// stesso database devono aspettare la stessa connessione, non aprirne due.
const opening = new Map();

// Apre il collegamento se non c'è già. È la differenza fra un'integrazione che
// funziona e una che rimanda sempre all'utente — ma senza password salvata non
// si inventa niente: si spiega cosa fare in Orabridge.
async function ensureOpen(conn) {
  if (pools.get(conn.id)) return;

  // L'attività la registra chi apre davvero, non chi si mette in coda: un
  // collegamento è un fatto solo, anche se lo stavano aspettando in tre.
  let promise = opening.get(conn.id);
  if (!promise) {
    const cfg = store.get(conn.id);
    if (!cfg) throw new ToolError(`La connessione "${conn.name}" non esiste più in Orabridge.`);
    if (!cfg.password) {
      activity.note({
        kind: 'denied',
        connId: conn.id,
        connName: conn.name,
        error: 'Nessuna password salvata: collegamento automatico impossibile',
      });
      throw new ToolError(
        `"${conn.name}" non ha una password salvata in Orabridge, quindi non posso collegarmi da solo. ` +
          "Chiedi all'utente di collegarla una volta dall'applicazione: la password viene salvata e da " +
          'lì in poi il collegamento è automatico.'
      );
    }

    promise = pools
      .connect(cfg)
      .then((entry) => {
        activity.note({
          kind: 'open',
          connId: conn.id,
          connName: conn.name,
          schema: entry.currentSchema,
          version: entry.version,
          user: entry.user,
        });
        return entry;
      })
      .catch((err) => {
        activity.note({
          kind: 'error',
          connId: conn.id,
          connName: conn.name,
          error: friendlyError(err),
        });
        throw err;
      })
      .finally(() => opening.delete(conn.id));
    opening.set(conn.id, promise);
  }

  try {
    await promise;
  } catch (err) {
    throw new ToolError(`Collegamento a "${conn.name}" non riuscito: ${friendlyError(err)}`);
  }
}

// Sceglie il database, controlla il permesso e si assicura che sia collegato.
// Restituisce l'id, come prima: chi chiama non deve sapere se il collegamento
// c'era già o l'abbiamo appena aperto.
export async function resolveConnection(wanted) {
  const conn = pickConnection(wanted);
  ensureRead(conn);
  await ensureOpen(conn);
  return conn.id;
}

// Il permesso di lettura è per connessione. Modifica ed eliminazione non sono
// impostabili: gli strumenti che servirebbero non escono da questa parte.
function ensureRead(conn) {
  if (conn.permissions.read) return;
  activity.note({
    kind: 'denied',
    connId: conn.id,
    connName: conn.name,
    error: 'Lettura non abilitata per questa connessione',
  });
  throw new ToolError(
    `L'utente non ha abilitato la lettura di "${conn.name}" dagli editor esterni. ` +
      'Si accende in Orabridge, sulla connessione.'
  );
}

export async function callTool(name, args = {}) {
  const def = name === LIST_CONNECTIONS.name ? LIST_CONNECTIONS : byName.get(name);
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
  // La voce di attività nasce prima di sapere su quale database si finirà: se
  // la scelta fallisce (ambigua, non esposta) l'utente deve vedere anche quello.
  const call = activity.startCall({ tool: name, connName: String(connection || '').trim() || null });
  try {
    if (name === LIST_CONNECTIONS.name) {
      const text = connectionsText();
      call.done({ ok: true });
      return text;
    }

    const conn = pickConnection(connection);
    call.update({ connId: conn.id, connName: conn.name });
    ensureRead(conn);
    await ensureOpen(conn);

    const out = await runTool(conn.id, name, input, {
      maxRows: settings.ai().maxRows,
      // Fuori dalla sessione del foglio SQL e senza accesso agli strumenti di
      // scrittura: vedi i commenti in ai/tools.js.
      pooled: true,
      readOnly: true,
      source: 'mcp',
    });
    call.done({ ok: true });
    return out;
  } catch (err) {
    call.done({ ok: false, error: err.message });
    throw err;
  }
}

export const mcpApi = { listTools, callTool };
