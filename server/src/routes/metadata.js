import { Router } from 'express';
import oracledb from 'oracledb';
import { withPooled } from '../pools.js';
import { gridQuery, gridResult, qi } from '../oracle.js';

const router = Router({ mergeParams: true });
const a = (fn) => (req, res, next) => fn(req, res, next).catch(next);

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
  'TYPE BODY',
  'SYNONYM',
]);

router.get(
  '/schemas',
  a(async (req, res) => {
    const entry = req.oraEntry;
    const r = await withPooled(entry, (c) =>
      c.execute(`SELECT username FROM all_users ORDER BY username`, [], {
        outFormat: oracledb.OUT_FORMAT_ARRAY,
        maxRows: 5000,
      })
    );
    res.json({ schemas: r.rows.map((x) => x[0]) });
  })
);

router.get(
  '/objects',
  a(async (req, res) => {
    const { owner, type } = req.query;
    if (!OBJECT_TYPES.has(type)) return res.status(400).json({ error: 'Tipo non valido' });
    const entry = req.oraEntry;
    const MAX = 5000;
    const r = await withPooled(entry, (c) =>
      c.execute(
        `SELECT object_name, status FROM all_objects
          WHERE owner = :owner AND object_type = :t AND object_name NOT LIKE 'BIN$%'
          ORDER BY object_name`,
        { owner, t: type },
        { outFormat: oracledb.OUT_FORMAT_ARRAY, maxRows: MAX + 1 }
      )
    );
    const truncated = r.rows.length > MAX;
    const rows = truncated ? r.rows.slice(0, MAX) : r.rows;
    res.json({
      items: rows.map((x) => ({ name: x[0], status: x[1] })),
      truncated,
    });
  })
);

// Metadati di uno schema per l'autocomplete dell'editor. Formato compatto
// (il payload viaggia intero al client):
//   tables    { NOME: { k: 'T'|'V'|'M', c: [[colonna, tipo, notNull, pk], …] } }
//   fks       [ [tabella, [colonne], schemaRif, tabellaRif, [colonneRif]], … ]
//   routines  [ [nome, 'P'|'F'|'K'], … ]   (Procedure, Function, pacKage)
//   members   { PACKAGE: [membri…] }
//   sequences [ nome, … ]
//   synonyms  { NOME: [schema, oggetto] }
// Tutto tranne le colonne è best-effort: se una vista del dizionario non è
// leggibile dall'utenza si restituisce una lista vuota invece di fallire.
router.get(
  '/autocomplete',
  a(async (req, res) => {
    const { owner } = req.query;
    if (!owner) return res.status(400).json({ error: 'Schema mancante' });
    const data = await withPooled(req.oraEntry, async (c) => {
      const run = async (sql, maxRows) => {
        const r = await c.execute(
          sql,
          { owner },
          { outFormat: oracledb.OUT_FORMAT_ARRAY, maxRows }
        );
        return r.rows;
      };
      const optional = (sql, maxRows) => run(sql, maxRows).catch(() => []);

      const colRows = await run(
        `SELECT c.table_name, c.column_name,
                c.data_type ||
                  CASE
                    WHEN c.data_type IN ('VARCHAR2','CHAR','NVARCHAR2','NCHAR','RAW')
                      THEN '(' || c.char_length || ')'
                    WHEN c.data_type = 'NUMBER' AND c.data_precision IS NOT NULL
                      THEN '(' || c.data_precision ||
                           CASE WHEN c.data_scale > 0 THEN ',' || c.data_scale END || ')'
                  END,
                c.nullable
           FROM all_tab_columns c
          WHERE c.owner = :owner AND c.table_name NOT LIKE 'BIN$%'
          ORDER BY c.table_name, c.column_id`,
        50000
      );

      const objRows = await optional(
        `SELECT object_name, object_type FROM all_objects
          WHERE owner = :owner AND object_name NOT LIKE 'BIN$%'
            AND object_type IN ('VIEW','MATERIALIZED VIEW','PACKAGE',
                                'FUNCTION','PROCEDURE','SEQUENCE')`,
        20000
      );

      const pkRows = await optional(
        `SELECT cc.table_name, cc.column_name
           FROM all_constraints k
           JOIN all_cons_columns cc
             ON cc.owner = k.owner AND cc.constraint_name = k.constraint_name
          WHERE k.owner = :owner AND k.constraint_type = 'P'`,
        20000
      );

      const fkRows = await optional(
        `SELECT c.constraint_name, c.table_name, cc.column_name,
                r.owner, r.table_name, rc.column_name
           FROM all_constraints c
           JOIN all_cons_columns cc
             ON cc.owner = c.owner AND cc.constraint_name = c.constraint_name
           JOIN all_constraints r
             ON r.owner = c.r_owner AND r.constraint_name = c.r_constraint_name
           JOIN all_cons_columns rc
             ON rc.owner = r.owner AND rc.constraint_name = r.constraint_name
            AND rc.position = cc.position
          WHERE c.owner = :owner AND c.constraint_type = 'R'
          ORDER BY c.constraint_name, cc.position`,
        20000
      );

      const memberRows = await optional(
        `SELECT object_name, procedure_name FROM all_procedures
          WHERE owner = :owner AND procedure_name IS NOT NULL
            AND object_name NOT LIKE 'BIN$%'`,
        20000
      );

      const synRows = await optional(
        `SELECT synonym_name, table_owner, table_name FROM all_synonyms
          WHERE owner = :owner AND table_owner IS NOT NULL`,
        10000
      );

      const tables = {};
      for (const [t, col, type, nullable] of colRows) {
        (tables[t] ??= { k: 'T', c: [] }).c.push([col, type, nullable === 'N' ? 1 : 0, 0]);
      }

      const KIND = { VIEW: 'V', 'MATERIALIZED VIEW': 'M' };
      const routines = [];
      const sequences = [];
      const packages = new Set();
      for (const [name, type] of objRows) {
        if (KIND[type]) {
          if (tables[name]) tables[name].k = KIND[type];
        } else if (type === 'SEQUENCE') {
          sequences.push(name);
        } else {
          routines.push([name, type === 'PACKAGE' ? 'K' : type === 'FUNCTION' ? 'F' : 'P']);
          if (type === 'PACKAGE') packages.add(name);
        }
      }

      for (const [t, col] of pkRows) {
        const entry = tables[t]?.c.find((x) => x[0] === col);
        if (entry) entry[3] = 1;
      }

      const fks = [];
      let last = null;
      for (const [cons, table, col, rOwner, rTable, rCol] of fkRows) {
        if (last?.cons === cons) {
          last.fk[1].push(col);
          last.fk[4].push(rCol);
        } else {
          const fk = [table, [col], rOwner, rTable, [rCol]];
          fks.push(fk);
          last = { cons, fk };
        }
      }

      const members = {};
      for (const [pkg, member] of memberRows) {
        if (packages.has(pkg)) (members[pkg] ??= []).push(member);
      }

      const synonyms = {};
      for (const [name, synOwner, synName] of synRows) synonyms[name] = [synOwner, synName];

      sequences.sort();
      routines.sort((x, y) => (x[0] < y[0] ? -1 : 1));
      return { owner, tables, fks, routines, members, sequences, synonyms };
    });
    res.json(data);
  })
);

router.get(
  '/table/columns',
  a(async (req, res) => {
    const { owner, name } = req.query;
    res.json(
      await gridQuery(
        req.oraEntry,
        `SELECT c.column_id "#",
                c.column_name "Colonna",
                c.data_type ||
                  CASE
                    WHEN c.data_type IN ('VARCHAR2','CHAR','NVARCHAR2','NCHAR','RAW')
                      THEN '(' || c.char_length || ')'
                    WHEN c.data_type = 'NUMBER' AND c.data_precision IS NOT NULL
                      THEN '(' || c.data_precision ||
                           CASE WHEN c.data_scale > 0 THEN ',' || c.data_scale END || ')'
                  END "Tipo",
                DECODE(c.nullable, 'N', 'NOT NULL', '') "Null",
                CASE WHEN c.column_name IN (
                  SELECT cc.column_name
                    FROM all_cons_columns cc
                    JOIN all_constraints k
                      ON k.owner = cc.owner AND k.constraint_name = cc.constraint_name
                   WHERE k.constraint_type = 'P' AND k.owner = :owner AND k.table_name = :name
                ) THEN 'PK' END "Chiave",
                c.data_default "Default",
                com.comments "Commento"
           FROM all_tab_columns c
           LEFT JOIN all_col_comments com
             ON com.owner = c.owner AND com.table_name = c.table_name
            AND com.column_name = c.column_name
          WHERE c.owner = :owner AND c.table_name = :name
          ORDER BY c.column_id`,
        { owner, name }
      )
    );
  })
);

// Toglie dal grid l'ultima colonna (quelle di servizio: ROWNUM e ROWID).
function dropLastColumn(grid) {
  grid.columns.pop();
  grid.rows = grid.rows.map((row) => row.slice(0, -1));
}

router.get(
  '/table/data',
  a(async (req, res) => {
    const { owner, name, where, orderBy, dir } = req.query;
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const limit = Math.min(5000, Number(req.query.limit) || 200);
    // rowid=1 (Dati tab of a TABLE): also fetch ROWID so the grid can build
    // per-row UPDATE statements for inline cell editing.
    const withRowid = req.query.rowid === '1';
    let inner = withRowid
      ? `SELECT t.*, t.ROWID "__orabridge_rowid__" FROM ${qi(owner)}.${qi(name)} t`
      : `SELECT * FROM ${qi(owner)}.${qi(name)}`;
    if (where?.trim()) inner += ` WHERE ${where}`;
    if (orderBy) inner += ` ORDER BY ${qi(orderBy)} ${dir === 'desc' ? 'DESC' : 'ASC'}`;
    // Paginazione con ROWNUM invece di OFFSET/FETCH: quest'ultima esiste solo
    // da Oracle 12c e su 11g fa fallire la SELECT con ORA-00933.
    const sql = `SELECT * FROM (
                   SELECT q.*, ROWNUM "__orabridge_rn__"
                     FROM (${inner}) q
                    WHERE ROWNUM <= :maxrow
                 ) WHERE "__orabridge_rn__" > :off`;
    try {
      const grid = await withPooled(req.oraEntry, async (c) => {
        const r = await c.execute(
          sql,
          { maxrow: offset + limit + 1, off: offset },
          { outFormat: oracledb.OUT_FORMAT_ARRAY, maxRows: limit + 1 }
        );
        return gridResult(r, limit);
      });
      dropLastColumn(grid); // la colonna di servizio ROWNUM
      if (withRowid) {
        const idx = grid.columns.length - 1;
        grid.rowids = grid.rows.map((row) => row[idx]);
        dropLastColumn(grid);
      }
      res.json({ ...grid, offset });
    } catch (err) {
      res.json({ error: err.message });
    }
  })
);

router.get(
  '/table/count',
  a(async (req, res) => {
    const { owner, name, where } = req.query;
    let sql = `SELECT COUNT(*) FROM ${qi(owner)}.${qi(name)}`;
    if (where?.trim()) sql += ` WHERE ${where}`;
    try {
      const r = await withPooled(req.oraEntry, (c) => c.execute(sql));
      res.json({ count: r.rows[0][0] });
    } catch (err) {
      res.json({ error: err.message });
    }
  })
);

router.get(
  '/table/constraints',
  a(async (req, res) => {
    const { owner, name } = req.query;
    res.json(
      await gridQuery(
        req.oraEntry,
        `SELECT c.constraint_name "Nome",
                DECODE(c.constraint_type,
                       'P', 'Primary Key', 'R', 'Foreign Key', 'U', 'Unique',
                       'C', 'Check', c.constraint_type) "Tipo",
                (SELECT LISTAGG(cc.column_name, ', ')
                        WITHIN GROUP (ORDER BY cc.position)
                   FROM all_cons_columns cc
                  WHERE cc.owner = c.owner AND cc.constraint_name = c.constraint_name
                    AND cc.table_name = c.table_name) "Colonne",
                c.search_condition "Condizione",
                NVL2(c.r_constraint_name,
                     c.r_owner || '.' ||
                     (SELECT r.table_name FROM all_constraints r
                       WHERE r.owner = c.r_owner AND r.constraint_name = c.r_constraint_name),
                     NULL) "Riferimento",
                c.status "Stato"
           FROM all_constraints c
          WHERE c.owner = :owner AND c.table_name = :name
          ORDER BY DECODE(c.constraint_type, 'P', 1, 'U', 2, 'R', 3, 4), c.constraint_name`,
        { owner, name }
      )
    );
  })
);

router.get(
  '/table/indexes',
  a(async (req, res) => {
    const { owner, name } = req.query;
    res.json(
      await gridQuery(
        req.oraEntry,
        `SELECT i.index_name "Nome",
                i.owner "Schema",
                i.uniqueness "Unicità",
                i.index_type "Tipo",
                (SELECT LISTAGG(ic.column_name, ', ')
                        WITHIN GROUP (ORDER BY ic.column_position)
                   FROM all_ind_columns ic
                  WHERE ic.index_owner = i.owner AND ic.index_name = i.index_name) "Colonne",
                i.status "Stato"
           FROM all_indexes i
          WHERE i.table_owner = :owner AND i.table_name = :name
          ORDER BY i.index_name`,
        { owner, name }
      )
    );
  })
);

router.get(
  '/table/comment',
  a(async (req, res) => {
    const { owner, name } = req.query;
    const r = await withPooled(req.oraEntry, (c) =>
      c.execute(
        `SELECT comments FROM all_tab_comments WHERE owner = :owner AND table_name = :name`,
        { owner, name },
        { outFormat: oracledb.OUT_FORMAT_ARRAY }
      )
    );
    res.json({ comment: r.rows[0]?.[0] ?? '' });
  })
);

router.get(
  '/table/triggers',
  a(async (req, res) => {
    const { owner, name } = req.query;
    res.json(
      await gridQuery(
        req.oraEntry,
        `SELECT trigger_name "Nome", trigger_type "Tipo",
                triggering_event "Evento", status "Stato"
           FROM all_triggers
          WHERE table_owner = :owner AND table_name = :name
          ORDER BY trigger_name`,
        { owner, name }
      )
    );
  })
);

router.get(
  '/source',
  a(async (req, res) => {
    const { owner, name, type } = req.query;
    const r = await withPooled(req.oraEntry, (c) =>
      c.execute(
        `SELECT text FROM all_source
          WHERE owner = :owner AND name = :name AND type = :type
          ORDER BY line`,
        { owner, name, type },
        { outFormat: oracledb.OUT_FORMAT_ARRAY, maxRows: 100000 }
      )
    );
    const body = r.rows.map((x) => x[0]).join('');
    res.json({ text: body ? `CREATE OR REPLACE ${body}` : '' });
  })
);

// Compile errors of a stored object (after CREATE OR REPLACE from the UI).
router.get(
  '/errors',
  a(async (req, res) => {
    const { owner, name, type } = req.query;
    const r = await withPooled(req.oraEntry, (c) =>
      c.execute(
        `SELECT line, position, text, attribute FROM all_errors
          WHERE owner = :owner AND name = :name AND type = :type
          ORDER BY sequence`,
        { owner, name, type },
        { outFormat: oracledb.OUT_FORMAT_ARRAY, maxRows: 500 }
      )
    );
    res.json({
      errors: r.rows.map(([line, position, text, attribute]) => ({
        line,
        position,
        text,
        warning: attribute === 'WARNING',
      })),
    });
  })
);

// Bare SELECT of a view (LONG column, fetched as string by node-oracledb).
router.get(
  '/view/text',
  a(async (req, res) => {
    const { owner, name } = req.query;
    const r = await withPooled(req.oraEntry, (c) =>
      c.execute(
        `SELECT text FROM all_views WHERE owner = :owner AND view_name = :name`,
        { owner, name },
        { outFormat: oracledb.OUT_FORMAT_ARRAY }
      )
    );
    res.json({ text: r.rows[0]?.[0] ?? '' });
  })
);

const DDL_TYPE = {
  TABLE: 'TABLE',
  VIEW: 'VIEW',
  'MATERIALIZED VIEW': 'MATERIALIZED_VIEW',
  INDEX: 'INDEX',
  SEQUENCE: 'SEQUENCE',
  PROCEDURE: 'PROCEDURE',
  FUNCTION: 'FUNCTION',
  PACKAGE: 'PACKAGE',
  'PACKAGE BODY': 'PACKAGE_BODY',
  TRIGGER: 'TRIGGER',
  TYPE: 'TYPE',
  'TYPE BODY': 'TYPE_BODY',
  SYNONYM: 'SYNONYM',
};

router.get(
  '/ddl',
  a(async (req, res) => {
    const { owner, name, type } = req.query;
    const ddlType = DDL_TYPE[type];
    if (!ddlType) return res.status(400).json({ error: 'Tipo non valido' });
    try {
      const text = await withPooled(req.oraEntry, async (c) => {
        await c.execute(
          `BEGIN
             DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM, 'SQLTERMINATOR', TRUE);
             DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM, 'SEGMENT_ATTRIBUTES', FALSE);
           END;`
        );
        const r = await c.execute(
          `SELECT dbms_metadata.get_ddl(:t, :name, :owner) FROM dual`,
          { t: ddlType, name, owner }
        );
        return r.rows[0][0];
      });
      res.json({ text });
    } catch (err) {
      res.json({ error: err.message });
    }
  })
);

router.get(
  '/sequence',
  a(async (req, res) => {
    const { owner, name } = req.query;
    res.json(
      await gridQuery(
        req.oraEntry,
        `SELECT sequence_name "Nome", min_value "Min", max_value "Max",
                increment_by "Incremento", cycle_flag "Ciclo", order_flag "Ordine",
                cache_size "Cache", last_number "Ultimo valore"
           FROM all_sequences
          WHERE sequence_owner = :owner AND sequence_name = :name`,
        { owner, name }
      )
    );
  })
);

router.get(
  '/synonym',
  a(async (req, res) => {
    const { owner, name } = req.query;
    res.json(
      await gridQuery(
        req.oraEntry,
        `SELECT synonym_name "Nome", table_owner "Schema oggetto",
                table_name "Oggetto", db_link "DB Link"
           FROM all_synonyms
          WHERE owner = :owner AND synonym_name = :name`,
        { owner, name }
      )
    );
  })
);

router.get(
  '/index',
  a(async (req, res) => {
    const { owner, name } = req.query;
    res.json(
      await gridQuery(
        req.oraEntry,
        `SELECT ic.column_position "#", ic.column_name "Colonna", ic.descend "Direzione",
                i.table_owner || '.' || i.table_name "Tabella",
                i.uniqueness "Unicità", i.index_type "Tipo", i.status "Stato"
           FROM all_indexes i
           JOIN all_ind_columns ic
             ON ic.index_owner = i.owner AND ic.index_name = i.index_name
          WHERE i.owner = :owner AND i.index_name = :name
          ORDER BY ic.column_position`,
        { owner, name }
      )
    );
  })
);

export default router;
