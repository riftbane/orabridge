import oracledb from 'oracledb';
import { withPooled } from './pools.js';

const pad = (n, w = 2) => String(n).padStart(w, '0');

export function fmtDate(d) {
  let s = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  if (d.getMilliseconds()) s += `.${pad(d.getMilliseconds(), 3)}`;
  return s;
}

const MAX_CELL = 100000;

export function serializeValue(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return fmtDate(v);
  if (Buffer.isBuffer(v)) {
    if (v.length > 2000) return `(RAW ${v.length} byte)`;
    return v.toString('hex').toUpperCase();
  }
  if (typeof v === 'string' && v.length > MAX_CELL) {
    return v.slice(0, MAX_CELL) + `… (${v.length} caratteri)`;
  }
  if (typeof v === 'object') return String(v);
  return v;
}

export function serializeRows(rows) {
  return rows.map((r) => r.map(serializeValue));
}

export function gridResult(result, limit) {
  const truncated = limit != null && result.rows.length > limit;
  const rows = truncated ? result.rows.slice(0, limit) : result.rows;
  return {
    columns: result.metaData.map((m) => ({ name: m.name, type: m.dbTypeName || '' })),
    rows: serializeRows(rows),
    truncated,
  };
}

// Quotes an Oracle identifier safely.
export function qi(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

// Runs a read-only dictionary query on a pooled connection, returns grid shape.
export async function gridQuery(entry, sql, binds = {}, maxRows = 5000) {
  return withPooled(entry, async (conn) => {
    const r = await conn.execute(sql, binds, {
      outFormat: oracledb.OUT_FORMAT_ARRAY,
      maxRows: maxRows + 1,
    });
    return gridResult(r, maxRows);
  });
}
