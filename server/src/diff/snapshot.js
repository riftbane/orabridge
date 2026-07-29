// Fotografia normalizzata di uno schema, letta dal dizionario dati.
//
// Tutto viene letto con poche query "bulk" (una per vista del dizionario,
// non una per oggetto): confrontare due schemi da centinaia di oggetti deve
// costare una manciata di round-trip, non migliaia.
//
// Ogni query secondaria è best-effort: se l'utenza non vede una vista del
// dizionario si ottiene una lista vuota invece di far fallire tutto il
// confronto (stesso criterio usato da routes/metadata.js per l'autocomplete).

import oracledb from 'oracledb';
import { withPooled } from '../pools.js';

export const DIFF_TYPES = [
  'TABLE',
  'VIEW',
  'MATERIALIZED VIEW',
  'SEQUENCE',
  'SYNONYM',
  'PROCEDURE',
  'FUNCTION',
  'PACKAGE',
  'PACKAGE BODY',
  'TRIGGER',
  'TYPE',
];

// Tipi il cui confronto si riduce al testo sorgente (da ALL_SOURCE).
export const SOURCE_TYPES = ['PROCEDURE', 'FUNCTION', 'PACKAGE', 'PACKAGE BODY', 'TYPE'];

// PROCEDURE e PACKAGE possono avere lo stesso nome: la chiave li distingue.
export const sourceKey = (type, name) => `${type}\u0000${name}`;

const MAX_ROWS = 200000;

// Nome del tipo di una colonna in forma canonica e confrontabile.
// Per TIMESTAMP/INTERVAL la precisione è già dentro data_type
// ("TIMESTAMP(6) WITH TIME ZONE"), quindi il ramo di default va bene.
export function columnType(c) {
  const t = c.dataType || '';
  if (c.typeOwner) return `${c.typeOwner}.${t}`;
  if (t === 'VARCHAR2' || t === 'NVARCHAR2' || t === 'CHAR' || t === 'NCHAR') {
    const unit = c.charUsed === 'B' ? ' BYTE' : c.charUsed === 'C' ? ' CHAR' : '';
    // NVARCHAR2/NCHAR sono sempre in caratteri: l'unità non si esplicita.
    const nchar = t[0] === 'N';
    return `${t}(${c.charLength ?? c.dataLength}${nchar ? '' : unit})`;
  }
  if (t === 'RAW') return `RAW(${c.dataLength})`;
  if (t === 'UROWID' && c.dataLength) return `UROWID(${c.dataLength})`;
  if (t === 'NUMBER') {
    if (c.precision == null) return c.scale ? `NUMBER(*,${c.scale})` : 'NUMBER';
    return c.scale ? `NUMBER(${c.precision},${c.scale})` : `NUMBER(${c.precision})`;
  }
  if (t === 'FLOAT' && c.precision != null) return `FLOAT(${c.precision})`;
  return t;
}

// I default arrivano da una colonna LONG: spazi e a-capo finali sono rumore.
const cleanDefault = (v) => {
  const s = v == null ? '' : String(v).trim();
  return s === '' ? null : s;
};

const clean = (v) => {
  const s = v == null ? '' : String(v).trim();
  return s === '' ? null : s;
};

// Vincolo CHECK creato in automatico da Oracle per un NOT NULL: la
// nullabilità è già confrontata a livello di colonna, ripeterla come vincolo
// (per giunta con nome SYS_C…) sarebbe solo rumore.
const isNotNullCheck = (type, condition, generated) =>
  type === 'C' &&
  generated === 'GENERATED NAME' &&
  /^\s*"?[A-Za-z0-9_$#]+"?\s+IS\s+NOT\s+NULL\s*$/i.test(condition || '');

export function isGeneratedName(name) {
  return /^(SYS_C\d|SYS_IL\d|SYS_NC\d|BIN\$)/i.test(String(name || ''));
}

// Sequenza creata da Oracle dietro una colonna di identità: appartiene alla
// tabella, non allo schema. Il numero nel nome è un id interno, diverso in
// ogni database, quindi confrontarla come oggetto a sé produrrebbe solo
// falsi "solo in origine"/"solo in destinazione".
export function isIdentitySequence(name) {
  return /^ISEQ\$\$_\d+$/i.test(String(name || ''));
}

// GENERATION_TYPE di all_tab_identity_cols, normalizzato: quello che finisce
// nel DDL deve essere una delle due forme previste dalla sintassi.
const identityKind = (v) => (String(v || '').toUpperCase() === 'ALWAYS' ? 'ALWAYS' : 'BY DEFAULT');

// Converte il filtro nomi digitato dall'utente in un predicato.
// Con % o _ vale come LIKE di Oracle, altrimenti è una sottostringa.
export function nameMatcher(pattern) {
  const p = String(pattern || '').trim();
  if (!p) return () => true;
  if (/[%_]/.test(p)) {
    const rx = new RegExp(
      '^' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$',
      'i'
    );
    return (name) => rx.test(name);
  }
  const low = p.toLowerCase();
  return (name) => name.toLowerCase().includes(low);
}

export async function readSnapshot(entry, owner, { types = DIFF_TYPES, filter = '' } = {}) {
  const want = new Set(types);
  const match = nameMatcher(filter);
  const wantSource = SOURCE_TYPES.some((t) => want.has(t));

  return withPooled(entry, async (c) => {
    const run = async (sql, binds = { owner }, maxRows = MAX_ROWS) => {
      const r = await c.execute(sql, binds, {
        outFormat: oracledb.OUT_FORMAT_ARRAY,
        maxRows,
      });
      return r.rows;
    };
    // Le viste del dizionario non leggibili non devono far saltare il confronto.
    const optional = (sql, binds, maxRows) => run(sql, binds, maxRows).catch(() => []);

    const snap = {
      owner,
      tables: {},
      views: {},
      mviews: {},
      sequences: {},
      synonyms: {},
      triggers: {},
      sources: {}, // "TIPO\u0000NOME" -> { type, name, text, status }
    };

    // ---- tabelle ----
    if (want.has('TABLE')) {
      const tableRows = await optional(
        `SELECT t.table_name, cm.comments, t.temporary, t.duration
           FROM all_tables t
           LEFT JOIN all_tab_comments cm
             ON cm.owner = t.owner AND cm.table_name = t.table_name
          WHERE t.owner = :owner
            AND t.nested = 'NO'
            AND t.secondary = 'N'
            AND t.table_name NOT LIKE 'BIN$%'
            AND NOT EXISTS (SELECT 1 FROM all_mviews m
                             WHERE m.owner = t.owner AND m.mview_name = t.table_name)`
      );
      for (const [name, comment, temporary, duration] of tableRows) {
        if (!match(name)) continue;
        snap.tables[name] = {
          name,
          comment: clean(comment),
          temporary: temporary === 'Y',
          onCommit: duration === 'SYS$TRANSACTION' ? 'DELETE' : duration ? 'PRESERVE' : null,
          columns: [],
          constraints: [],
          indexes: [],
        };
      }

      const colRows = await optional(
        `SELECT c.table_name, c.column_name, c.column_id, c.data_type, c.data_type_owner,
                c.char_length, c.char_used, c.data_length, c.data_precision, c.data_scale,
                c.nullable, c.data_default, cm.comments
           FROM all_tab_columns c
           LEFT JOIN all_col_comments cm
             ON cm.owner = c.owner AND cm.table_name = c.table_name
            AND cm.column_name = c.column_name
          WHERE c.owner = :owner AND c.table_name NOT LIKE 'BIN$%'
          ORDER BY c.table_name, c.column_id`
      );
      // Colonne di identità (12c) e colonne virtuali: per entrambe il
      // data_default letto sopra non è un vero DEFAULT — per le prime è la
      // sequenza di sistema, per le seconde l'espressione di calcolo — e
      // ricopiarlo tale e quale produrrebbe DDL non valido nella
      // destinazione. Query separate e best-effort: su 11g la prima vista
      // non esiste e si ottiene semplicemente una lista vuota.
      const identityRows = await optional(
        `SELECT table_name, column_name, generation_type
           FROM all_tab_identity_cols WHERE owner = :owner`
      );
      const virtualRows = await optional(
        `SELECT table_name, column_name FROM all_tab_cols
          WHERE owner = :owner AND virtual_column = 'YES' AND hidden_column = 'NO'
            AND table_name NOT LIKE 'BIN$%'`
      );
      const colKey = (table, column) => `${table}\u0000${column}`;
      const identityBy = new Map(
        identityRows.map(([table, column, kind]) => [colKey(table, column), identityKind(kind)])
      );
      const virtualCols = new Set(virtualRows.map(([table, column]) => colKey(table, column)));

      for (const r of colRows) {
        const t = snap.tables[r[0]];
        if (!t) continue;
        const identity = identityBy.get(colKey(r[0], r[1])) || null;
        t.columns.push({
          name: r[1],
          id: r[2],
          type: columnType({
            dataType: r[3],
            typeOwner: r[4],
            charLength: r[5],
            charUsed: r[6],
            dataLength: r[7],
            precision: r[8],
            scale: r[9],
          }),
          notNull: r[10] === 'N',
          // Per una colonna di identità il default è la sequenza di sistema:
          // l'informazione utile è già in `identity`.
          default: identity ? null : cleanDefault(r[11]),
          identity,
          virtual: virtualCols.has(colKey(r[0], r[1])),
          comment: clean(r[12]),
        });
      }

      // ---- vincoli (definizione + colonne + colonne referenziate) ----
      const consRows = await optional(
        `SELECT c.constraint_name, c.table_name, c.constraint_type, c.search_condition,
                c.r_owner, rc.table_name, c.delete_rule, c.status, c.generated, c.deferrable
           FROM all_constraints c
           LEFT JOIN all_constraints rc
             ON rc.owner = c.r_owner AND rc.constraint_name = c.r_constraint_name
          WHERE c.owner = :owner
            AND c.constraint_type IN ('P','U','R','C')
            AND c.table_name NOT LIKE 'BIN$%'`
      );
      const consCols = await optional(
        `SELECT cc.constraint_name, cc.column_name
           FROM all_cons_columns cc
          WHERE cc.owner = :owner
          ORDER BY cc.constraint_name, NVL(cc.position, 0)`
      );
      const refCols = await optional(
        `SELECT c.constraint_name, rcc.column_name
           FROM all_constraints c
           JOIN all_cons_columns rcc
             ON rcc.owner = c.r_owner AND rcc.constraint_name = c.r_constraint_name
          WHERE c.owner = :owner AND c.constraint_type = 'R'
          ORDER BY c.constraint_name, rcc.position`
      );
      const colsByCons = new Map();
      for (const [cons, col] of consCols) {
        if (!colsByCons.has(cons)) colsByCons.set(cons, []);
        colsByCons.get(cons).push(col);
      }
      const refByCons = new Map();
      for (const [cons, col] of refCols) {
        if (!refByCons.has(cons)) refByCons.set(cons, []);
        refByCons.get(cons).push(col);
      }
      for (const r of consRows) {
        const [name, table, type, condition, rOwner, rTable, deleteRule, status, generated] = r;
        const t = snap.tables[table];
        if (!t) continue;
        if (isNotNullCheck(type, condition, generated)) continue;
        t.constraints.push({
          name,
          type,
          columns: colsByCons.get(name) || [],
          condition: type === 'C' ? clean(condition) : null,
          refOwner: rOwner || null,
          refTable: rTable || null,
          refColumns: refByCons.get(name) || [],
          deleteRule: type === 'R' && deleteRule !== 'NO ACTION' ? deleteRule : null,
          disabled: status === 'DISABLED',
          generated: generated === 'GENERATED NAME' || isGeneratedName(name),
        });
      }

      // ---- indici ----
      const idxRows = await optional(
        `SELECT i.index_name, i.table_name, i.uniqueness, i.index_type, i.generated, i.status
           FROM all_indexes i
          WHERE i.table_owner = :owner
            AND i.index_type <> 'LOB'
            AND i.table_name NOT LIKE 'BIN$%'
            AND i.index_name NOT LIKE 'BIN$%'`
      );
      const idxCols = await optional(
        `SELECT ic.index_name, ic.column_name, ic.descend
           FROM all_ind_columns ic
          WHERE ic.table_owner = :owner
          ORDER BY ic.index_name, ic.column_position`
      );
      // Indici funzionali: la colonna vera è un SYS_NC…$ nascosto, l'espressione
      // sta in una vista a parte (colonna LONG).
      const idxExprs = await optional(
        `SELECT ie.index_name, ie.column_expression, ie.column_position
           FROM all_ind_expressions ie
          WHERE ie.table_owner = :owner
          ORDER BY ie.index_name, ie.column_position`
      );
      const exprByIdx = new Map();
      for (const [idx, expr, pos] of idxExprs) {
        if (!exprByIdx.has(idx)) exprByIdx.set(idx, new Map());
        exprByIdx.get(idx).set(pos, clean(expr));
      }
      const colsByIdx = new Map();
      for (const [idx, col, descend] of idxCols) {
        if (!colsByIdx.has(idx)) colsByIdx.set(idx, []);
        const list = colsByIdx.get(idx);
        const expr = exprByIdx.get(idx)?.get(list.length + 1);
        list.push((expr || col) + (descend === 'DESC' ? ' DESC' : ''));
      }
      for (const [name, table, uniqueness, type, generated, status] of idxRows) {
        const t = snap.tables[table];
        if (!t) continue;
        t.indexes.push({
          name,
          unique: uniqueness === 'UNIQUE',
          type,
          columns: colsByIdx.get(name) || [],
          generated: generated === 'Y' || isGeneratedName(name),
          unusable: status === 'UNUSABLE',
        });
      }

      for (const t of Object.values(snap.tables)) {
        t.constraints.sort((a, b) => (a.name < b.name ? -1 : 1));
        t.indexes.sort((a, b) => (a.name < b.name ? -1 : 1));
      }
    }

    // ---- viste ----
    if (want.has('VIEW')) {
      const rows = await optional(
        `SELECT v.view_name, v.text FROM all_views v WHERE v.owner = :owner`,
        { owner },
        20000
      );
      for (const [name, text] of rows) {
        if (!match(name)) continue;
        snap.views[name] = { name, text: String(text ?? '') };
      }
      const colRows = await optional(
        `SELECT c.table_name, c.column_name
           FROM all_tab_columns c
          WHERE c.owner = :owner
            AND c.table_name IN (SELECT view_name FROM all_views WHERE owner = :owner)
          ORDER BY c.table_name, c.column_id`
      );
      for (const [name, col] of colRows) {
        const v = snap.views[name];
        if (v) (v.columns ??= []).push(col);
      }
    }

    // ---- viste materializzate ----
    if (want.has('MATERIALIZED VIEW')) {
      const rows = await optional(
        `SELECT m.mview_name, m.query, m.refresh_mode, m.refresh_method, m.build_mode
           FROM all_mviews m WHERE m.owner = :owner`,
        { owner },
        20000
      );
      for (const [name, query, refreshMode, refreshMethod, buildMode] of rows) {
        if (!match(name)) continue;
        snap.mviews[name] = {
          name,
          query: String(query ?? ''),
          refreshMode,
          refreshMethod,
          buildMode,
        };
      }
    }

    // ---- sequenze ----
    // min/max stanno in NUMBER(28): oltre il campo dei Number JS, quindi
    // TO_CHAR in SQL per confrontarli senza perdita di cifre.
    // last_number viene letto ma non confrontato (cambia a ogni NEXTVAL):
    // serve solo come START WITH quando la sequenza va creata.
    if (want.has('SEQUENCE')) {
      const rows = await optional(
        `SELECT sequence_name, TO_CHAR(min_value), TO_CHAR(max_value),
                TO_CHAR(increment_by), cycle_flag, order_flag, TO_CHAR(cache_size),
                TO_CHAR(last_number)
           FROM all_sequences WHERE sequence_owner = :owner`
      );
      for (const [name, min, max, inc, cycle, order, cache, last] of rows) {
        if (!match(name) || isIdentitySequence(name)) continue;
        snap.sequences[name] = {
          name,
          min,
          max,
          increment: inc,
          cycle: cycle === 'Y',
          order: order === 'Y',
          cache,
          lastNumber: last,
        };
      }
    }

    // ---- sinonimi ----
    if (want.has('SYNONYM')) {
      const rows = await optional(
        `SELECT synonym_name, table_owner, table_name, db_link
           FROM all_synonyms WHERE owner = :owner`
      );
      for (const [name, tOwner, tName, dbLink] of rows) {
        if (!match(name)) continue;
        snap.synonyms[name] = { name, tableOwner: tOwner, tableName: tName, dbLink };
      }
    }

    // ---- trigger ----
    // description contiene già intestazione, timing, evento e FOR EACH ROW;
    // la clausola WHEN è a parte, il corpo è una LONG.
    if (want.has('TRIGGER')) {
      const rows = await optional(
        `SELECT trigger_name, description, when_clause, trigger_body, status,
                table_owner, table_name
           FROM all_triggers WHERE owner = :owner`,
        { owner },
        20000
      );
      for (const [name, description, whenClause, body, status, tOwner, tName] of rows) {
        if (!match(name)) continue;
        const when = clean(whenClause);
        snap.triggers[name] = {
          name,
          text:
            `CREATE OR REPLACE TRIGGER ${String(description ?? '').trim()}\n` +
            (when ? `WHEN (${when})\n` : '') +
            String(body ?? ''),
          disabled: status !== 'ENABLED',
          tableOwner: tOwner,
          tableName: tName,
        };
      }
    }

    // ---- oggetti con sorgente PL/SQL ----
    // L'inventario viene da all_objects (esiste sempre), il testo da
    // all_source (può mancare per oggetti wrapped o privilegi limitati).
    if (wantSource) {
      const wantedSource = SOURCE_TYPES.filter((t) => want.has(t));
      const inList = wantedSource.map((t) => `'${t}'`).join(',');
      const objRows = await optional(
        `SELECT object_name, object_type, status FROM all_objects
          WHERE owner = :owner AND object_name NOT LIKE 'BIN$%'
            AND subobject_name IS NULL
            AND object_type IN (${inList})`
      );
      for (const [name, type, status] of objRows) {
        if (!match(name)) continue;
        snap.sources[sourceKey(type, name)] = { type, name, text: '', invalid: status !== 'VALID' };
      }
      const srcRows = await optional(
        `SELECT name, type, text FROM all_source
          WHERE owner = :owner AND type IN (${inList})
          ORDER BY name, type, line`
      );
      const buf = new Map();
      for (const [name, type, text] of srcRows) {
        const key = sourceKey(type, name);
        if (!snap.sources[key]) continue;
        if (!buf.has(key)) buf.set(key, []);
        buf.get(key).push(text ?? '');
      }
      for (const [key, parts] of buf) snap.sources[key].text = parts.join('');
    }

    return snap;
  });
}
