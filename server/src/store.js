import path from 'path';
import crypto from 'crypto';
import { DATA_DIR, decrypt, encrypt, readJson, writeJson } from './secret.js';

const FILE = path.join(DATA_DIR, 'connections.json');

function load() {
  return readJson(FILE, []);
}

function save(list) {
  writeJson(FILE, list);
}

// Configurazione MCP di una connessione: se è esposta agli editor esterni e con
// quali permessi. `write` e `delete` esistono per essere mostrati come non
// disponibili — dall'integrazione MCP escono solo strumenti di lettura (l'elenco
// è filtrato sul permesso `read` in mcp/tools.js), quindi qui restano false
// qualunque cosa arrivi dal client: la sola lettura non dipende da un'opzione.
export function normalizeMcp(raw) {
  return {
    enabled: !!raw?.enabled,
    // Acceso l'interruttore, la lettura è il minimo perché l'integrazione serva
    // a qualcosa: si parte da concessa e la si può togliere.
    permissions: { read: raw?.permissions?.read !== false, write: false, delete: false },
  };
}

function sanitize(c) {
  const { password, ...rest } = c;
  // `hasPassword` invece della password: il collegamento automatico da MCP
  // funziona solo se una password è salvata, e la UI deve poterlo dire prima
  // che Copilot ci sbatta contro.
  return { ...rest, hasPassword: !!c.password, mcp: normalizeMcp(c.mcp) };
}

export const store = {
  list() {
    return load().map(sanitize);
  },

  get(id) {
    const c = load().find((x) => x.id === id);
    if (!c) return null;
    return { ...c, mcp: normalizeMcp(c.mcp), password: c.password ? decrypt(c.password) : '' };
  },

  create(input) {
    const list = load();
    const conn = {
      id: crypto.randomUUID(),
      name: input.name,
      host: input.host || '',
      port: Number(input.port) || 1521,
      serviceType: input.serviceType || 'service',
      service: input.service || '',
      user: input.user || '',
      group: input.group || '',
      password: encrypt(input.password || ''),
      // Spenta di default: esporre un database a un editor esterno è una scelta
      // da fare una connessione alla volta, non un'eredità della creazione.
      mcp: normalizeMcp(input.mcp),
      createdAt: new Date().toISOString(),
    };
    list.push(conn);
    save(list);
    return sanitize(conn);
  },

  update(id, patch) {
    const list = load();
    const idx = list.findIndex((x) => x.id === id);
    if (idx === -1) return null;
    const cur = list[idx];
    const next = {
      ...cur,
      name: patch.name ?? cur.name,
      host: patch.host ?? cur.host,
      port: patch.port != null ? Number(patch.port) : cur.port,
      serviceType: patch.serviceType ?? cur.serviceType,
      service: patch.service ?? cur.service,
      user: patch.user ?? cur.user,
      group: patch.group ?? cur.group,
      password: patch.password ? encrypt(patch.password) : cur.password,
      // Patch parziale: `{ mcp: { enabled: true } }` non deve azzerare i
      // permessi già scelti.
      mcp: normalizeMcp(
        patch.mcp
          ? {
              ...cur.mcp,
              ...patch.mcp,
              permissions: { ...cur.mcp?.permissions, ...patch.mcp.permissions },
            }
          : cur.mcp
      ),
    };
    list[idx] = next;
    save(list);
    return sanitize(next);
  },

  remove(id) {
    const list = load();
    const next = list.filter((x) => x.id !== id);
    save(next);
    return next.length !== list.length;
  },
};
