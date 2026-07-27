// Column/table-aware autocomplete for the SQL editor.
// Suggests the columns of the tables referenced in the statement under the
// cursor (with alias support: "e." lists the columns of the table aliased e)
// in addition to every table/view of the connected schema.

import { syntaxTree } from '@codemirror/language';
import { statementAt } from './sqlSplit.js';

// Words that can never be a table name or an alias in a ref position.
const STOP = new Set([
  'WHERE', 'ON', 'SET', 'VALUES', 'SELECT', 'GROUP', 'ORDER', 'HAVING',
  'UNION', 'MINUS', 'INTERSECT', 'CONNECT', 'START', 'JOIN', 'INNER', 'LEFT',
  'RIGHT', 'FULL', 'CROSS', 'NATURAL', 'USING', 'WHEN', 'MATCHED', 'AND',
  'OR', 'NOT', 'AS', 'IS', 'IN', 'LIKE', 'BETWEEN', 'FROM', 'INTO', 'UPDATE',
  'DELETE', 'INSERT', 'MERGE', 'RETURNING', 'FOR', 'WITH', 'CASE', 'END',
  'THEN', 'ELSE', 'PIVOT', 'UNPIVOT', 'SAMPLE', 'PARTITION', 'SUBPARTITION',
  'FETCH', 'OFFSET', 'ROWS', 'ROW', 'ONLY', 'NEXT', 'FIRST', 'ADD', 'MODIFY',
  'DROP', 'RENAME', 'TABLE', 'LOCK', 'ALTER', 'WAIT', 'NOWAIT', 'MODE',
  'EXCLUSIVE', 'SHARE', 'LOOP', 'BEGIN', 'DECLARE',
]);

const norm = (tok) => (tok[0] === '"' ? tok.slice(1, -1).replace(/""/g, '"') : tok.toUpperCase());

// Extracts { owner, table, alias } refs from a statement (FROM/JOIN/UPDATE/
// INTO/USING/TABLE clauses, comma lists included). Best-effort, regex based.
export function tableRefs(text) {
  const refs = [];
  const kw = /\b(from|join|update|into|using|table)\b/gi;
  const tok = /\s*("(?:[^"]|"")*"|[A-Za-z][\w$#]*|[.,])/y;
  const next = (pos) => {
    tok.lastIndex = pos;
    const m = tok.exec(text);
    return m ? { t: m[1], end: tok.lastIndex } : null;
  };
  let m;
  while ((m = kw.exec(text))) {
    let pos = m.index + m[0].length;
    for (;;) {
      let r = next(pos);
      if (!r || r.t === '.' || r.t === ',') break;
      if (r.t[0] !== '"' && STOP.has(r.t.toUpperCase())) break;
      let owner = null;
      let table = norm(r.t);
      pos = r.end;
      r = next(pos);
      if (r && r.t === '.') {
        const r2 = next(r.end);
        if (r2 && r2.t !== '.' && r2.t !== ',') {
          owner = table;
          table = norm(r2.t);
          pos = r2.end;
          r = next(pos);
        }
      }
      let alias = null;
      if (r && r.t !== '.' && r.t !== ',') {
        if (r.t[0] === '"') {
          alias = norm(r.t);
          pos = r.end;
        } else if (r.t.toUpperCase() === 'AS') {
          const r2 = next(r.end);
          if (r2 && r2.t !== '.' && r2.t !== ',' && (r2.t[0] === '"' || !STOP.has(r2.t.toUpperCase()))) {
            alias = norm(r2.t);
            pos = r2.end;
          }
        } else if (!STOP.has(r.t.toUpperCase())) {
          alias = r.t.toUpperCase();
          pos = r.end;
        }
        if (alias) r = next(pos);
      }
      refs.push({ owner, table, alias });
      // comma lists: FROM a al, b bl
      if (r && r.t === ',' && /^(from|into)$/i.test(m[1])) {
        pos = r.end;
        continue;
      }
      break;
    }
    if (pos > kw.lastIndex) kw.lastIndex = pos;
  }
  return refs;
}

const needsQuote = (n) => !/^[A-Z][A-Z0-9_$#]*$/.test(n);
const opt = (label, type, extra) => ({
  label,
  type,
  apply: needsQuote(label) ? `"${label}"` : label,
  ...extra,
});

// schemaMap: { TABLE_NAME: [columns] } for the current schema.
export function schemaCompletionSource(schemaMap) {
  const map = schemaMap || {};
  const tableOptions = Object.keys(map).map((t) => opt(t, 'class', { boost: 0 }));
  return (context) => {
    const inner = syntaxTree(context.state).resolveInner(context.pos, -1);
    if (/String|Comment/i.test(inner.name)) return null;

    const stmt = statementAt(context.state.doc.toString(), context.pos);
    const refs = stmt ? tableRefs(stmt.text) : [];

    // "alias.col" / "table.col"
    const q = context.matchBefore(/("(?:[^"]|"")*"|[\w$#]+)\.[\w$#]*/);
    if (q) {
      const m = /^("(?:[^"]|"")*"|[\w$#]+)\.([\w$#]*)$/.exec(q.text);
      if (m) {
        const qualifier = norm(m[1]);
        let table = null;
        const byAlias = refs.find((r) => r.alias === qualifier);
        if (byAlias && map[byAlias.table]) table = byAlias.table;
        else if (map[qualifier]) table = qualifier;
        if (!table) return null;
        return {
          from: context.pos - m[2].length,
          options: map[table].map((c) => opt(c, 'property')),
          validFor: /^[\w$#]*$/,
        };
      }
    }

    const word = context.matchBefore(/[\w$#]*/);
    if (!word || (word.from === word.to && !context.explicit)) return null;
    const options = [];
    const seen = new Set();
    for (const r of refs) {
      const cols = map[r.table];
      if (!cols) continue;
      for (const c of cols) {
        if (seen.has(c)) continue;
        seen.add(c);
        options.push(opt(c, 'property', { boost: 2, detail: r.alias ? `${r.alias} · ${r.table}` : r.table }));
      }
    }
    if (!options.length && !tableOptions.length) return null;
    return {
      from: word.from,
      options: options.concat(tableOptions),
      validFor: /^[\w$#]*$/,
    };
  };
}
