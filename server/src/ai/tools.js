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
      'Elenca gli oggetti di uno schema per tipo (TABLE, VIEW, MATERIALIZED VIEW, SEQUENCE, PROCEDURE, FUNCTION, PACKAGE, TRIGGER, TYPE, SYNONYM, INDEX). Senza filtro restituisce tutto: è il modo migliore per capire che cosa contiene il database.',
    parameters: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Schema; se omesso usa lo schema corrente' },
        type: { type: 'string', description: 'Tipo di oggetto, es. TABLE' },
        like: {
          type: 'string',
          description:
            'Filtro sul nome, senza wildcard (ricerca "contiene", sottostringa esatta). Usalo solo se sei sicuro di come è scritto il nome nel database: in caso di dubbio lascialo vuoto e leggi l\'elenco completo',
        },
      },
      required: ['type'],
    },
  },
  {
    name: 'describe_table',
    permission: 'read',
    description:
      'Struttura completa di una tabella o vista: colonne con tipo e nullabilità, chiave primaria, vincoli, foreign key, indici e commenti. Chiamalo su ogni tabella che userai, prima di scrivere la query: i nomi delle colonne vanno letti, non indovinati.',
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
      "Esegue una SELECT e restituisce le righe: è così che si risponde a una domanda sui dati, dopo aver guardato la struttura delle tabelle. Solo istruzioni di lettura, per qualsiasi modifica usa execute_sql. Il numero di righe è limitato: usa FETCH FIRST n ROWS ONLY (o ROWNUM) se ti serve un campione o una classifica.",
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

// I parametri obbligatori a volte mancano — succede quando il modello tronca
// gli argomenti. Senza questo controllo la chiamata parte lo stesso e finisce
// in un errore Oracle incomprensibile (o in una domanda di approvazione per
// un'istruzione vuota): meglio dire subito che cosa manca.
function checkInput(def, input) {
  const missing = (def.parameters.required || []).filter((k) => {
    const v = input?.[k];
    return v == null || (typeof v === 'string' && !v.trim());
  });
  if (missing.length) {
    throw new ToolError(
      `Chiamata a ${def.name} senza i parametri obbligatori: ${missing.join(', ')}. ` +
        'Ripeti la chiamata indicandoli.'
    );
  }
}

// Permesso richiesto da una chiamata: per execute_sql dipende dall'SQL.
export function requiredPermission(name, input) {
  const def = TOOL_BY_NAME[name];
  if (!def) throw new ToolError(`Strumento sconosciuto: ${name}`);
  checkInput(def, input);
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

// Elenco di oggetti come lo legge il modello.
export function objectsText(type, owner, r) {
  const names = r.rows.map(([n, s]) => (s === 'VALID' ? n : `${n} (${s})`));
  return (
    `${type} in ${owner}: ${r.rows.length}${r.truncated ? '+ (elenco troncato)' : ''}\n` +
    (names.join(', ') || '(nessuno)')
  );
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

// Lettura su una connessione del pool invece che sulla sessione del foglio SQL.
// Serve a chi interroga da fuori dall'app (l'integrazione MCP): la sessione del
// foglio è serializzata e ha una transazione aperta dell'utente, quindi
// usarla da lì vorrebbe dire accodarsi alle sue query, vedere le sue modifiche
// non confermate e lasciargli lock in giro.
async function pooledRead(entry, sql, maxRows) {
  const t0 = performance.now();
  const r = await query(entry, sql, {}, maxRows);
  return { ...r, elapsedMs: Math.round(performance.now() - t0) };
}

// ---- inventario dello schema ----

// I modelli piccoli si perdono al primo passo: elencano le tabelle e poi
// chiedono all'utente quale usare, oppure cercano un nome tradotto e non lo
// trovano. Mettere l'elenco degli oggetti direttamente nel prompt di sistema
// toglie di mezzo il problema alla radice — il nome giusto ce l'hanno già
// sotto gli occhi. L'elenco è limitato (i modelli locali hanno 8k di contesto
// in tutto) e messo in cache: la stessa connessione lo riusa per qualche
// minuto invece di interrogare il dizionario a ogni messaggio.
const OVERVIEW_TTL_MS = 5 * 60_000;
const OVERVIEW_MAX = 150;
const OVERVIEW_TYPES = ['TABLE', 'VIEW', 'MATERIALIZED VIEW'];
const OVERVIEW_LABEL = {
  TABLE: 'Tabelle',
  VIEW: 'Viste',
  'MATERIALIZED VIEW': 'Viste materializzate',
};
const overviewCache = new Map(); // connId -> { schema, at, text }

export function overviewText(schema, rows, max = OVERVIEW_MAX) {
  if (!rows.length) {
    return (
      `Lo schema corrente ${schema} non contiene tabelle né viste: cerca lo schema giusto ` +
      'con list_schemas e passa `owner` agli strumenti.'
    );
  }
  const out = [];
  let budget = max;
  for (const type of OVERVIEW_TYPES) {
    const names = rows.filter(([t]) => t === type).map(([, n]) => n);
    if (!names.length) continue;
    const shown = names.slice(0, Math.max(0, budget));
    budget -= shown.length;
    const rest = names.length - shown.length;
    const head = `${OVERVIEW_LABEL[type]} in ${schema} (${names.length}): `;
    if (!shown.length) {
      out.push(`${head}elenco troppo lungo per stare qui, chiedilo con list_objects.`);
    } else {
      out.push(head + shown.join(', ') + (rest ? `, … e altri ${rest} (list_objects per il resto)` : ''));
    }
  }
  return out.join('\n');
}

// Riga di inventario per il prompt di sistema, o null se il dizionario non è
// leggibile: un turno non deve fallire per colpa di un contorno.
export async function schemaOverview(connId) {
  const entry = pools.get(connId);
  if (!entry) return null;
  const schema = entry.currentSchema;
  const hit = overviewCache.get(connId);
  if (hit && hit.schema === schema && Date.now() - hit.at < OVERVIEW_TTL_MS) return hit.text;
  let text;
  try {
    const r = await query(
      entry,
      `SELECT object_type, object_name FROM all_objects
        WHERE owner = :owner AND object_type IN ('TABLE', 'VIEW', 'MATERIALIZED VIEW')
          AND object_name NOT LIKE 'BIN$%'
        ORDER BY object_type, object_name`,
      { owner: schema },
      3000
    );
    text = overviewText(schema, r.rows);
  } catch {
    return null;
  }
  overviewCache.set(connId, { schema, at: Date.now(), text });
  return text;
}

// Un nome può essere un sinonimo (proprio o pubblico) verso la tabella vera:
// senza seguirlo `describe_table` direbbe solo "non esiste".
async function synonymTarget(entry, owner, name) {
  const r = await query(
    entry,
    `SELECT table_owner, table_name, db_link FROM all_synonyms
      WHERE synonym_name = :name AND owner IN (:owner, 'PUBLIC')
      ORDER BY CASE WHEN owner = :owner THEN 0 ELSE 1 END`,
    { owner, name },
    5
  ).catch(() => ({ rows: [] }));
  const row = r.rows[0];
  if (!row || !row[1]) return null;
  return { owner: row[0] || owner, name: row[1], dbLink: row[2] || null };
}

// Perché non si trovano colonne: tipo sbagliato, schema sbagliato o davvero
// niente. Al modello serve la pista giusta, non un vicolo cieco.
async function missingReason(entry, owner, name) {
  const r = await query(
    entry,
    `SELECT owner, object_type FROM all_objects WHERE object_name = :name
      ORDER BY CASE WHEN owner = :owner THEN 0 ELSE 1 END, owner`,
    { owner, name },
    50
  ).catch(() => ({ rows: [] }));
  const here = r.rows.find(([o]) => o === owner);
  if (here) {
    return `${owner}.${name} è di tipo ${here[1]}, non una tabella o vista: usa get_source o get_ddl.`;
  }
  const others = [...new Set(r.rows.map(([o]) => o))].slice(0, 10);
  if (others.length) {
    return `${owner}.${name} non esiste, ma un oggetto con questo nome esiste in ${others.join(', ')}: ripeti indicando owner.`;
  }
  // Nome inventato (capita spesso ai modelli piccoli, che traducono o
  // abbreviano): senza un'alternativa concreta si arrendono, con l'elenco
  // sotto gli occhi ripiegano da soli sulla tabella giusta.
  const near = await query(
    entry,
    `SELECT object_name FROM all_objects
      WHERE owner = :owner AND object_type IN ('TABLE', 'VIEW')
        AND object_name NOT LIKE 'BIN$%'
      ORDER BY object_name`,
    { owner },
    60
  ).catch(() => ({ rows: [], truncated: false }));
  const hint = near.rows.length
    ? ` Tabelle e viste esistenti in ${owner}: ${near.rows.map(([n]) => n).join(', ')}${near.truncated ? ', …' : ''}. Scegli da qui.`
    : '';
  return `${owner}.${name} non esiste o non è leggibile con questa utenza.${hint}`;
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
    // Il filtro è una ricerca "contiene": le wildcard che il modello aggiunge
    // di sua iniziativa si tolgono. Il bind non può chiamarsi `like`: è una
    // parola riservata Oracle e la chiamata fallirebbe con ORA-01745.
    const like = (up(input.like) || '').replace(/^%+|%+$/g, '') || null;
    const list = (flt) =>
      query(
        entry,
        `SELECT object_name, status FROM all_objects
          WHERE owner = :owner AND object_type = :t AND object_name NOT LIKE 'BIN$%'
            ${flt ? `AND object_name LIKE '%' || :flt || '%'` : ''}
          ORDER BY object_name`,
        flt ? { owner, t: type, flt } : { owner, t: type },
        500
      );
    const r = await list(like);
    // Filtro a vuoto: un elenco di zero oggetti i modelli piccoli lo leggono
    // come "la tabella non esiste" e si fermano lì a chiedere aiuto — succede
    // ogni volta che cercano ORDERS in un database che le chiama ORDINI. Invece
    // di rimandare indietro il vicolo cieco si rifà la ricerca senza filtro:
    // l'elenco completo è la risposta che serviva davvero.
    if (!r.rows.length && like) {
      const all = await list(null);
      const head = `Nessun oggetto di tipo ${type} con "${like}" nel nome in ${owner}.`;
      if (!all.rows.length) {
        return `${head} Lo schema ${owner} non contiene alcun ${type}: cerca lo schema giusto con list_schemas.`;
      }
      return (
        `${head} Il filtro cerca la sottostringa esatta e i nomi nel database possono essere ` +
        `diversi dai termini della domanda: ecco l'elenco completo, scegli da qui.\n` +
        objectsText(type, owner, all)
      );
    }
    return objectsText(type, owner, r);
  },

  async describe_table(entry, input) {
    const asked = { owner: up(input.owner) || entry.currentSchema, name: up(input.name) };
    let owner = asked.owner;
    let name = asked.name;
    const columns = () =>
      query(
        entry,
        `SELECT column_name, data_type, data_length, data_precision, data_scale, nullable, data_default
           FROM all_tab_columns WHERE owner = :owner AND table_name = :name ORDER BY column_id`,
        { owner, name },
        1000
      );
    let cols = await columns();
    // Catena di sinonimi (di norma uno solo, il limite evita i cicli).
    for (let hop = 0; !cols.rows.length && hop < 3; hop++) {
      const target = await synonymTarget(entry, owner, name);
      if (!target) break;
      if (target.dbLink) {
        throw new ToolError(
          `${owner}.${name} è un sinonimo verso ${target.owner}.${target.name}@${target.dbLink}: ` +
            'la struttura sta su un altro database e da qui non è leggibile.'
        );
      }
      owner = target.owner;
      name = target.name;
      cols = await columns();
    }
    if (!cols.rows.length) {
      throw new ToolError(await missingReason(entry, asked.owner, asked.name));
    }
    const via = owner === asked.owner && name === asked.name
      ? ''
      : ` (sinonimo ${asked.owner}.${asked.name})`;
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

    const out = [`${owner}.${name}${via} — ${cols.rows.length} colonne`, 'Colonne:', ...lines];
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
        ctx.readOnly
          ? 'run_query esegue solo istruzioni di lettura, e questa integrazione non può modificare ' +
            'il database: le scritture si fanno dal foglio SQL di Orabridge.'
          : 'run_query esegue solo istruzioni di lettura: per modificare i dati usa execute_sql'
      );
    }
    const maxRows = Math.min(1000, Math.max(1, Number(input.maxRows) || ctx.maxRows));
    const sql = String(input.sql).trim().replace(/;\s*$/, '');
    const r = ctx.pooled
      ? await pooledRead(entry, sql, maxRows)
      : await runExclusive(entry, async () => {
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
      source: ctx.source || 'ai',
    });
    return (
      `${r.rows.length} righe${r.truncated ? ` (limite ${maxRows} raggiunto)` : ''} in ${r.elapsedMs} ms\n` +
      table(r.columns, r.rows)
    );
  },

  async execute_sql(entry, input) {
    const sql = String(input.sql || '').trim().replace(/;\s*$/, '');
    // Una CREATE/DROP cambia l'inventario che sta nel prompt: tenerlo com'era
    // farebbe negare al modello l'esistenza di una tabella appena creata.
    overviewCache.delete(entry.id);
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
  const fn = handlers[name];
  if (!fn) throw new ToolError(`Strumento sconosciuto: ${name}`);
  // Chi chiama in sola lettura (l'integrazione MCP) non deve poter arrivare a
  // uno strumento di scrittura nemmeno passando qui direttamente: l'elenco
  // filtrato in mcp/tools.js è la prima serratura, questa è la seconda. Prima
  // del controllo sulla connessione, perché «questo strumento non esiste per
  // te» viene logicamente prima di «non sei connesso».
  if (ctx?.readOnly && TOOL_BY_NAME[name]?.permission !== 'read') {
    throw new ToolError(`${name} non è disponibile in sola lettura`);
  }
  const entry = pools.get(connId);
  if (!entry) throw new ToolError('Connessione non attiva: chiedi all\'utente di connettersi.');
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
        // Come per le query riuscite: nella cronologia deve risultare chi l'ha
        // lanciata davvero, altrimenti una query fallita di Copilot passa per
        // una dell'assistente.
        source: ctx?.source || 'ai',
      });
    }
    throw new ToolError(err.message);
  }
}

