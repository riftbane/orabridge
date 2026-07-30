import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const FILE = path.join(DATA_DIR, 'history.json');

// Tetto alle voci conservate: evita una crescita illimitata del file su
// worksheet usati a lungo, mantenendo comunque una cronologia ampia.
const MAX_ENTRIES = 3000;
const MAX_SQL_LEN = 20000;

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return [];
  }
}

// Scrittura atomica (tmp + rename): la cronologia deve sopravvivere a un
// crash o riavvio a metà scrittura, non solo a una chiusura pulita — è
// proprio il problema che questa funzione sostituisce in SQL Developer.
function save(list) {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
}

export const history = {
  add(entry) {
    const list = load();
    let sql = String(entry.sql || '').trim();
    if (sql.length > MAX_SQL_LEN) sql = sql.slice(0, MAX_SQL_LEN) + '\n-- […troncato]';
    list.push({
      id: crypto.randomUUID(),
      connId: entry.connId,
      sql,
      ok: !!entry.ok,
      errorMessage: entry.errorMessage,
      rows: entry.rows,
      rowsAffected: entry.rowsAffected,
      elapsedMs: entry.elapsedMs,
      // Chi ha lanciato l'istruzione: foglio SQL ('sql'), assistente ('ai')
      // oppure un editor esterno collegato via MCP ('mcp').
      source: ['ai', 'mcp'].includes(entry.source) ? entry.source : 'sql',
      ts: new Date().toISOString(),
    });
    save(list.length > MAX_ENTRIES ? list.slice(list.length - MAX_ENTRIES) : list);
  },

  // Più recenti prima; filtro opzionale per connessione e per sottostringa SQL.
  list({ connId, q, limit = 300 } = {}) {
    let list = load();
    if (connId) list = list.filter((e) => e.connId === connId);
    if (q?.trim()) {
      const needle = q.trim().toLowerCase();
      list = list.filter((e) => e.sql.toLowerCase().includes(needle));
    }
    list = list.slice().reverse();
    return list.slice(0, Math.min(1000, Math.max(1, Number(limit) || 300)));
  },

  removeOne(id) {
    const list = load();
    const next = list.filter((e) => e.id !== id);
    save(next);
    return next.length !== list.length;
  },

  clear({ connId } = {}) {
    if (!connId) {
      save([]);
      return;
    }
    save(load().filter((e) => e.connId !== connId));
  },
};
