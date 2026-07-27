import oracledb from 'oracledb';
import { pools, runExclusive, withPooled } from '../pools.js';
import { gridResult } from '../oracle.js';
import { history } from '../history.js';
import { classifySql } from './sqlGuard.js';

// Strumenti messi a disposizione del modello. Ogni voce dichiara il permesso
// minimo richiesto; `execute_sql` lo calcola dall'istruzione stessa.
export const TOOL_DEFS = [
  {
    name: 'list_schemas',
    permission: 'read',
    description:
      "Elenca gli schemi (utenti) visibili sul database. Usalo quando non sai in quale schema si trova un oggetto.",
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_objects',
    permission: 'read',
    description:
      'Elenca gli oggetti di uno schema per tipo (TABLE, VIEW, MATERIALIZED VIEW, SEQUENCE, PROCEDURE, FUNCTION, PACKAGE, TRIGGER, TYPE, SYNONYM, INDEX). Accetta un filtro sul nome.',
    parameters: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Schema; se omesso usa lo schema corrente' },
        type: { type: 'string', description: 'Tipo di oggetto, es. TABLE' },
        like: { type: 'string', description: 'Filtro sul nome, senza wildcard (ricerca "contiene")' },
      },
      required: ['type'],
    },
  },
  {
    name: 'describe_table',
    permission: 'read',
    description:
      'Struttura completa di una tabella o vista: colonne con tipo e nullabilità, chiave primaria, vincoli, foreign key, indici e commenti.',
    parameters: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Schema; se omesso usa lo schema corrente' },
        name: { type: 'string', description: 'Nome della tabella o vista' },
      },
      required: ['name'],
    },
  },
  {
    name: 'get_source',
    permission: 'read',
    description:
      'Sorgente PL/SQL di una procedura, funzione, package, trigger o tipo; per le viste restituisce il testo della query.',
    parameters: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        name: { type: 'string' },
        type: {
          type: 'string',
          description: 'PROCEDURE, FUNCTION, PACKAGE, PACKAGE BODY, TRIGGER, TYPE oppure VIEW',
        },
      },
      required: ['name', 'type'],
    },
  },
  {
    name: 'get_ddl',
    permission: 'read',
    description: 'DDL completo di un oggetto tramite DBMS_METADATA.',
    parameters: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        name: { type: 'string' },
        type: { type: 'string', description: 'TABLE, VIEW, INDEX, SEQUENCE, …' },
      },
      required: ['name', 'type'],
    },
  },
  {
    name: 'run_query',
    permission: 'read',
    description:
      'Esegue una SELECT e restituisce le righe. Solo istruzioni di lettura: per qualsiasi modifica usa execute_sql. Il numero di righe è limitato, usa ROWNUM o FETCH FIRST se ti serve un campione.',
    parameters: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'Una sola SELECT, senza punto e virgola finale' },
        maxRows: { type: 'integer', description: 'Righe massime da restituire' },
      },
      required: ['sql'],
    },
  },
  {
    name: 'execute_sql',
    // Il livello dipende dall'istruzione: calcolato a runtime.
    permission: null,
    description:
      "Esegue un'istruzione che modifica dati o struttura (INSERT, UPDATE, MERGE, CREATE, ALTER, DELETE, DROP, blocchi PL/SQL). Non fa commit: ricorda all'utente di confermare la transazione. Se il permesso necessario non è concesso, all'utente viene chiesta un'approvazione.",
    parameters: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: "Una sola istruzione, senza punto e virgola finale" },
      },
      required: ['sql'],
    },
  },
];

export const TOOL_BY_NAME = Object.fromEntries(TOOL_DEFS.map((t) => [t.name, t]));

// Definizioni ripulite dai campi interni, pronte per il provider.
export const toolSchemas = () =>
  TOOL_DEFS.map(({ name, description, parameters }) => ({ name, description, parameters }));

export class ToolError extends Error {}

// Permesso richiesto da una chiamata: per execute_sql dipende dall'SQL.
export function requiredPermission(name, input) {
  const def = TOOL_BY_NAME[name];
  if (!def) throw new ToolError(`Strumento sconosciuto: ${name}`);
  if (def.permission) return { level: def.permission };
  const { level, error, statement } = classifySql(input?.sql || '');
  if (!level) throw new ToolError(error);
  return { level, statement };
}

const OBJECT_TYPES = new Set([
  'TABLE',
  'VIEW',
  'MATERIALIZED VIEW',
  'INDEX',
  'SEQUENCE',
  'PROCEDURE',
  'FUNCTION',
  'PACKAGE',
  'PACKAGE BODY',
  'TRIGGER',
  'TYPE',
  'SYNONYM',
]);

const up = (v) => (v == null ? null : String(v).trim().toUpperCase());

function table(columns, rows) {
  if (!rows.length) return '(nessuna riga)';
  const head = columns.map((c) => c.name ?? c).join(' | ');
  const body = rows.map((r) => r.map((v) => (v == null ? '' : String(v))).join(' | '));
  return [head, '-'.repeat(Math.min(head.length, 80)), ...body].join('\n');
}

async function query(entry, sql, binds, maxRows = 500) {
  return withPooled(entry, async (c) => {
    const r = await c.execute(sql, binds, {
      outFormat: oracledb.OUT_FORMAT_ARRAY,
      maxRows: maxRows + 1,
    });
    return gridResult(r, maxRows);
  });
}

const handlers = {
  async list_schemas(entry) {
    const r = await query(entry, `SELECT username FROM all_users ORDER BY username`, {}, 2000);
    return `Schemi (${r.rows.length}):\n` + r.rows.map((x) => x[0]).join(', ');
  },

  async list_objects(entry, input) {
    const owner = up(input.owner) || entry.currentSchema;
    const type = up(input.type);
    if (!OBJECT_TYPES.has(type)) {
      throw new ToolError(`Tipo non valido: ${type}. Ammessi: ${[...OBJECT_TYPES].join(', ')}`);
    }
    const like = up(input.like);
    const r = await query(
      entry,
      `SELECT object_name, status FROM all_objects
        WHERE owner = :owner AND object_type = :t AND object_name NOT LIKE 'BIN$%'
          ${like ? `AND object_name LIKE '%' || :like || '%'` : ''}
        ORDER BY object_name`,
      like ? { owner, t: type, like } : { owner, t: type },
      500
    );
    const names = r.rows.map(([n, s]) => (s === 'VALID' ? n : `${n} (${s})`));
    return (
      `${type} in ${owner}: ${r.rows.length}${r.truncated ? '+ (elenco troncato)' : ''}\n` +
      (names.join(', ') || '(nessuno)')
    );
  },

  async describe_table(entry, input) {
    const owner = up(input.owner) || entry.currentSchema;
    const name = up(input.name);
    const cols = await query(
      entry,
      `SELECT column_name, data_type, data_length, data_precision, data_scale, nullable, data_default
         FROM all_tab_columns WHERE owner = :owner AND table_name = :name ORDER BY column_id`,
      { owner, name },
      1000
    );
    if (!cols.rows.length) {
      throw new ToolError(`${owner}.${name} non esiste o non è leggibile con questa utenza`);
    }
    const typeOf = ([, t, len, prec, scale]) => {
      if (['VARCHAR2', 'CHAR', 'NVARCHAR2', 'NCHAR', 'RAW'].includes(t)) return `${t}(${len})`;
      if (t === 'NUMBER' && prec != null) return `NUMBER(${prec}${scale ? `,${scale}` : ''})`;
      return t;
    };
    const lines = cols.rows.map(
      (r) =>
        `  ${r[0]} ${typeOf(r)}${r[5] === 'N' ? ' NOT NULL' : ''}${r[6] ? ` DEFAULT ${String(r[6]).trim()}` : ''}`
    );

    // `search_condition_vc` esiste dalla 12c: sui database più vecchi si
    // ripiega su una versione senza il testo della CHECK.
    const consSql = (condition) => `
      SELECT c.constraint_name, c.constraint_type, cc.column_name, ${condition},
             c.r_owner, rc.table_name, rcc.column_name
        FROM all_constraints c
        JOIN all_cons_columns cc ON cc.owner = c.owner AND cc.constraint_name = c.constraint_name
        LEFT JOIN all_constraints rc ON rc.owner = c.r_owner AND rc.constraint_name = c.r_constraint_name
        LEFT JOIN all_cons_columns rcc ON rcc.owner = rc.owner
             AND rcc.constraint_name = rc.constraint_name AND rcc.position = cc.position
       WHERE c.owner = :owner AND c.table_name = :name
       ORDER BY c.constraint_type, c.constraint_name, cc.position`;
    const cons = await query(entry, consSql('c.search_condition_vc'), { owner, name }, 500)
      .catch(() => query(entry, consSql('NULL'), { owner, name }, 500))
      .catch(() => ({ rows: [] }));

    const grouped = new Map();
    for (const row of cons.rows) {
      const key = row[0];
      if (!grouped.has(key)) grouped.set(key, { type: row[1], cols: [], row });
      grouped.get(key).cols.push(row[2]);
    }
    const consLines = [...grouped.entries()].map(([cname, g]) => {
      const kind = { P: 'PK', U: 'UNIQUE', R: 'FK', C: 'CHECK' }[g.type] || g.type;
      if (g.type === 'R') {
        return `  ${kind} ${cname}: (${g.cols.join(', ')}) → ${g.row[4]}.${g.row[5]}`;
      }
      if (g.type === 'C') return `  ${kind} ${cname}: ${g.row[3] ?? ''}`;
      return `  ${kind} ${cname}: (${g.cols.join(', ')})`;
    });

    const idx = await query(
      entry,
      `SELECT i.index_name, i.uniqueness, ic.column_name
         FROM all_indexes i
         JOIN all_ind_columns ic ON ic.index_owner = i.owner AND ic.index_name = i.index_name
        WHERE i.table_owner = :owner AND i.table_name = :name
        ORDER BY i.index_name, ic.column_position`,
      { owner, name },
      500
    ).catch(() => ({ rows: [] }));
    const idxMap = new Map();
    for (const [iname, uniq, col] of idx.rows) {
      if (!idxMap.has(iname)) idxMap.set(iname, { uniq, cols: [] });
      idxMap.get(iname).cols.push(col);
    }

    const comments = await query(
      entry,
      `SELECT column_name, comments FROM all_col_comments
        WHERE owner = :owner AND table_name = :name AND comments IS NOT NULL`,
      { owner, name },
      500
    ).catch(() => ({ rows: [] }));

    const out = [`${owner}.${name} — ${cols.rows.length} colonne`, 'Colonne:', ...lines];
    if (consLines.length) out.push('Vincoli:', ...consLines);
    if (idxMap.size) {
      out.push(
        'Indici:',
        ...[...idxMap.entries()].map(
          ([n, v]) => `  ${n}${v.uniq === 'UNIQUE' ? ' (UNIQUE)' : ''}: (${v.cols.join(', ')})`
        )
      );
    }
    if (comments.rows.length) {
      out.push('Commenti:', ...comments.rows.map(([c, t]) => `  ${c}: ${t}`));
    }
    return out.join('\n');
  },

  async get_source(entry, input) {
    const owner = up(input.owner) || entry.currentSchema;
    const name = up(input.name);
    const type = up(input.type);
    if (type === 'VIEW') {
      // `text_vc` è disponibile dalla 12c; prima c'era solo `text` (LONG).
      const viewSql = (col) => `SELECT ${col} FROM all_views WHERE owner = :owner AND view_name = :name`;
      const r = await query(entry, viewSql('text_vc'), { owner, name }, 1).catch(() =>
        query(entry, viewSql('text'), { owner, name }, 1)
      );
      if (!r.rows.length) throw new ToolError(`Vista ${owner}.${name} non trovata`);
      return `CREATE OR REPLACE VIEW ${owner}.${name} AS\n${r.rows[0][0] ?? ''}`;
    }
    const r = await query(
      entry,
      `SELECT text FROM all_source WHERE owner = :owner AND name = :name AND type = :type
        ORDER BY line`,
      { owner, name, type },
      20000
    );
    if (!r.rows.length) throw new ToolError(`Sorgente di ${owner}.${name} (${type}) non trovato`);
    return r.rows.map((x) => x[0]).join('').trimEnd();
  },

  async get_ddl(entry, input) {
    const owner = up(input.owner) || entry.currentSchema;
    const name = up(input.name);
    const type = up(input.type).replace(/ /g, '_');
    const r = await withPooled(entry, async (c) => {
      await c
        .execute(
          `BEGIN dbms_metadata.set_transform_param(dbms_metadata.session_transform,'SQLTERMINATOR',TRUE);
                 dbms_metadata.set_transform_param(dbms_metadata.session_transform,'PRETTY',TRUE); END;`
        )
        .catch(() => {});
      return c.execute(
        `SELECT dbms_metadata.get_ddl(:type, :name, :owner) FROM dual`,
        { type, name, owner },
        { outFormat: oracledb.OUT_FORMAT_ARRAY }
      );
    });
    return String(r.rows?.[0]?.[0] ?? '').trim() || '(DDL vuoto)';
  },

  async run_query(entry, input, ctx) {
    const { level } = classifySql(input.sql || '');
    if (level !== 'read') {
      throw new ToolError(
        "run_query esegue solo istruzioni di lettura: per modificare i dati usa execute_sql"
      );
    }
    const maxRows = Math.min(1000, Math.max(1, Number(input.maxRows) || ctx.maxRows));
    const sql = String(input.sql).trim().replace(/;\s*$/, '');
    const r = await runExclusive(entry, async () => {
      const t0 = performance.now();
      entry.executing = true;
      try {
        const res = await entry.session.execute(sql, {}, {
          outFormat: oracledb.OUT_FORMAT_ARRAY,
          maxRows: maxRows + 1,
          autoCommit: false,
        });
        return { ...gridResult(res, maxRows), elapsedMs: Math.round(performance.now() - t0) };
      } finally {
        entry.executing = false;
      }
    });
    history.add({
      connId: entry.id,
      sql,
      ok: true,
      rows: r.rows.length,
      elapsedMs: r.elapsedMs,
      source: 'ai',
    });
    return (
      `${r.rows.length} righe${r.truncated ? ` (limite ${maxRows} raggiunto)` : ''} in ${r.elapsedMs} ms\n` +
      table(r.columns, r.rows)
    );
  },

  async execute_sql(entry, input) {
    const sql = String(input.sql || '').trim().replace(/;\s*$/, '');
    const r = await runExclusive(entry, async () => {
      const t0 = performance.now();
      entry.executing = true;
      try {
        const res = await entry.session.execute(sql, {}, {
          outFormat: oracledb.OUT_FORMAT_ARRAY,
          maxRows: 200,
          autoCommit: false,
        });
        const out = { elapsedMs: Math.round(performance.now() - t0) };
        if (res.metaData) Object.assign(out, gridResult(res, 200));
        else out.rowsAffected = res.rowsAffected ?? 0;
        return out;
      } finally {
        entry.executing = false;
      }
    });
    history.add({
      connId: entry.id,
      sql,
      ok: true,
      rows: r.rows?.length,
      rowsAffected: r.rowsAffected,
      elapsedMs: r.elapsedMs,
      source: 'ai',
    });
    if (r.columns) return `${r.rows.length} righe in ${r.elapsedMs} ms\n` + table(r.columns, r.rows);
    return `OK — ${r.rowsAffected} righe interessate in ${r.elapsedMs} ms (transazione non confermata: serve un COMMIT).`;
  },
};

// Esegue lo strumento e restituisce il testo da rimandare al modello.
export async function runTool(connId, name, input, ctx) {
  const entry = pools.get(connId);
  if (!entry) throw new ToolError('Connessione non attiva: chiedi all\'utente di connettersi.');
  const fn = handlers[name];
  if (!fn) throw new ToolError(`Strumento sconosciuto: ${name}`);
  try {
    const out = await fn(entry, input || {}, ctx || {});
    return String(out).slice(0, 60000);
  } catch (err) {
    if (err instanceof ToolError) throw err;
    const sql = input?.sql;
    if (sql) {
      history.add({
        connId,
        sql: String(sql),
        ok: false,
        errorMessage: err.message,
        source: 'ai',
      });
    }
    throw new ToolError(err.message);
  }
}

