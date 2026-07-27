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

// Table/view names + columns of a schema, feeds the editor autocomplete.
router.get(
  '/autocomplete',
  a(async (req, res) => {
    const { owner } = req.query;
    const entry = req.oraEntry;
    const r = await withPooled(entry, (c) =>
      c.execute(
        `SELECT table_name, column_name FROM all_tab_columns
          WHERE owner = :owner ORDER BY table_name, column_id`,
        { owner },
        { outFormat: oracledb.OUT_FORMAT_ARRAY, maxRows: 30000 }
      )
    );
    const tables = {};
    for (const [t, col] of r.rows) (tables[t] ??= []).push(col);
    res.json({ tables });
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

router.get(
  '/table/data',
  a(async (req, res) => {
    const { owner, name, where, orderBy, dir } = req.query;
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const limit = Math.min(5000, Number(req.query.limit) || 200);
    // rowid=1 (Dati tab of a TABLE): also fetch ROWID so the grid can build
    // per-row UPDATE statements for inline cell editing.
    const withRowid = req.query.rowid === '1';
    let sql = withRowid
      ? `SELECT t.*, t.ROWID "__orabridge_rowid__" FROM ${qi(owner)}.${qi(name)} t`
      : `SELECT * FROM ${qi(owner)}.${qi(name)}`;
    if (where?.trim()) sql += ` WHERE ${where}`;
    if (orderBy) sql += ` ORDER BY ${qi(orderBy)} ${dir === 'desc' ? 'DESC' : 'ASC'}`;
    sql += ` OFFSET :off ROWS FETCH NEXT :lim ROWS ONLY`;
    try {
      const grid = await withPooled(req.oraEntry, async (c) => {
        const r = await c.execute(
          sql,
          { off: offset, lim: limit + 1 },
          { outFormat: oracledb.OUT_FORMAT_ARRAY, maxRows: limit + 1 }
        );
        return gridResult(r, limit);
      });
      if (withRowid) {
        const idx = grid.columns.length - 1;
        grid.rowids = grid.rows.map((row) => row[idx]);
        grid.columns = grid.columns.slice(0, idx);
        grid.rows = grid.rows.map((row) => row.slice(0, idx));
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
