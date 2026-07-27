// Shared helpers to build Oracle DDL from the guided dialogs.

// Quotes an identifier only when needed; plain names are emitted uppercase.
export const ident = (n) => {
  const s = String(n ?? '').trim();
  return /^[A-Za-z][A-Za-z0-9_$#]*$/.test(s) ? s.toUpperCase() : '"' + s.replace(/"/g, '""') + '"';
};

// The name as it will appear in the data dictionary (to reopen the object).
export const dictName = (n) => {
  const s = String(n ?? '').trim();
  return /^[A-Za-z][A-Za-z0-9_$#]*$/.test(s) ? s.toUpperCase() : s;
};

export const qual = (owner, name) => `${ident(owner)}.${ident(name)}`;

export const lit = (s) => `'` + String(s ?? '').replace(/'/g, `''`) + `'`;

// size: 'y' = takes (size); prec: takes (precision[,scale])
export const COL_TYPES = [
  { name: 'VARCHAR2', size: 'y' },
  { name: 'NVARCHAR2', size: 'y' },
  { name: 'CHAR', size: 'y' },
  { name: 'NUMBER', prec: 'y' },
  { name: 'INTEGER' },
  { name: 'FLOAT' },
  { name: 'DATE' },
  { name: 'TIMESTAMP' },
  { name: 'TIMESTAMP WITH TIME ZONE' },
  { name: 'CLOB' },
  { name: 'NCLOB' },
  { name: 'BLOB' },
  { name: 'RAW', size: 'y' },
  { name: 'LONG' },
];

export function colTypeSql(col) {
  const spec = COL_TYPES.find((s) => s.name === col.type);
  let out = col.type;
  if (spec?.size && col.size) out += `(${col.size})`;
  else if (spec?.prec && col.size) out += `(${col.size}${col.scale ? ',' + col.scale : ''})`;
  return out;
}

export function colDefSql(col) {
  let out = `${ident(col.name)} ${colTypeSql(col)}`;
  if (col.def?.trim()) out += ` DEFAULT ${col.def.trim()}`;
  if (col.notNull) out += ' NOT NULL';
  return out;
}

// Parses "VARCHAR2(30)" / "NUMBER(10,2)" / "TIMESTAMP(6) WITH TIME ZONE".
export function parseTypeString(s) {
  const m = /^([A-Z0-9_ ]+?)\s*(?:\((\d+)(?:\s*,\s*(\d+))?\))?(\s+WITH.*)?$/.exec(String(s ?? '').trim());
  if (!m) return { type: s || '', size: '', scale: '' };
  let type = m[1].trim() + (m[4] ? m[4].replace(/\s+/g, ' ') : '');
  return { type, size: m[2] || '', scale: m[3] || '' };
}

// Builds `ALTER TABLE t ADD CONSTRAINT ...` from a guided-form definition:
// { ctype: 'PK'|'UQ'|'FK'|'CK', name, cols, refOwner, refTable, refCols, onDelete, condition }
export function buildAddConstraintSql(owner, table, def) {
  const t = qual(owner, table);
  let clause = null;
  if (def.ctype === 'PK' && def.cols?.length) clause = `PRIMARY KEY (${def.cols.map(ident).join(', ')})`;
  else if (def.ctype === 'UQ' && def.cols?.length) clause = `UNIQUE (${def.cols.map(ident).join(', ')})`;
  else if (def.ctype === 'FK' && def.cols?.length && def.refTable?.trim())
    clause =
      `FOREIGN KEY (${def.cols.map(ident).join(', ')}) REFERENCES ${qual(def.refOwner, def.refTable)}` +
      (def.refCols?.length ? ` (${def.refCols.map(ident).join(', ')})` : '') +
      (def.onDelete ? ` ON DELETE ${def.onDelete}` : '');
  else if (def.ctype === 'CK' && def.condition?.trim()) clause = `CHECK (${def.condition.trim()})`;
  return clause ? `ALTER TABLE ${t} ADD CONSTRAINT ${ident(def.name)} ${clause}` : null;
}

export function buildDrop(type, owner, name, opts = {}) {
  let sql = `DROP ${type} ${qual(owner, name)}`;
  if (type === 'TABLE' && opts.cascade) sql += ' CASCADE CONSTRAINTS';
  return sql;
}

// Column dbTypeName values the inline data-grid editor accepts. LOBs other
// than (N)CLOB, RAW/LONG/BLOB, ROWID and the timezone-aware timestamps are
// left out: no safe plain-text literal round-trip for them.
export const EDITABLE_CELL_TYPES = new Set([
  'VARCHAR2',
  'NVARCHAR2',
  'CHAR',
  'NCHAR',
  'NUMBER',
  'FLOAT',
  'BINARY_FLOAT',
  'BINARY_DOUBLE',
  'DATE',
  'TIMESTAMP',
  'CLOB',
  'NCLOB',
]);

const NUMERIC_TYPES = new Set(['NUMBER', 'FLOAT', 'BINARY_FLOAT', 'BINARY_DOUBLE']);

// Builds the SET expression for one cell, matching the display format used
// when the value was read (see server/src/oracle.js: fmtDate / plain numbers).
function cellExprSql(colType, rawValue) {
  if (rawValue === null) return 'NULL';
  if (NUMERIC_TYPES.has(colType)) {
    const n = Number(rawValue);
    if (!Number.isFinite(n)) throw new Error('Valore numerico non valido');
    return String(n);
  }
  if (colType === 'DATE') {
    const v = String(rawValue).replace(/\.\d+$/, '');
    return `TO_DATE(${lit(v)}, 'YYYY-MM-DD HH24:MI:SS')`;
  }
  if (colType === 'TIMESTAMP') {
    const v = String(rawValue).includes('.') ? String(rawValue) : `${rawValue}.0`;
    return `TO_TIMESTAMP(${lit(v)}, 'YYYY-MM-DD HH24:MI:SS.FF')`;
  }
  return lit(rawValue);
}

// UPDATE statement for one cell of one row, identified by its ROWID (stable
// regardless of primary keys, and unaffected by any WHERE filter applied to
// the grid).
export function buildCellUpdateSql(owner, table, column, colType, rowid, rawValue) {
  const expr = cellExprSql(colType, rawValue);
  return `UPDATE ${qual(owner, table)} SET ${ident(column)} = ${expr} WHERE ROWID = ${lit(rowid)}`;
}
