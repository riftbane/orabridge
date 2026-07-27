// Splits an editor buffer into executable statements.
// SQL statements end with ";". PL/SQL blocks (DECLARE/BEGIN/CREATE PROCEDURE…)
// end with a line containing only "/", like in SQL*Plus / SQL Developer.

const PLSQL_START =
  /^(DECLARE|BEGIN|CREATE\s+(OR\s+REPLACE\s+)?((NON)?EDITIONABLE\s+)?(FUNCTION|PROCEDURE|PACKAGE|TRIGGER|TYPE|LIBRARY))\b/;

function isPlsqlStart(text) {
  const t = text
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .trim()
    .toUpperCase();
  return PLSQL_START.test(t);
}

export function splitStatements(text) {
  const out = [];
  const n = text.length;
  let i = 0;
  let stmtStart = -1;
  let plsql = null;

  const push = (end) => {
    if (stmtStart === -1) return;
    const raw = text.slice(stmtStart, end);
    if (raw.trim()) {
      out.push({ text: raw, start: stmtStart, end, plsql: plsql ?? isPlsqlStart(raw) });
    }
    stmtStart = -1;
    plsql = null;
  };

  while (i < n) {
    const ch = text[i];

    if (ch === '-' && text[i + 1] === '-') {
      const nl = text.indexOf('\n', i);
      i = nl === -1 ? n : nl;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      if (stmtStart === -1) stmtStart = i;
      i++;
      while (i < n) {
        if (text[i] === ch) {
          if (text[i + 1] === ch) i += 2; // escaped quote
          else break;
        } else i++;
      }
      i++;
      continue;
    }

    // Line containing only "/" terminates the pending statement.
    if (ch === '/') {
      const lineStart = text.lastIndexOf('\n', i - 1) + 1;
      let lineEnd = text.indexOf('\n', i);
      if (lineEnd === -1) lineEnd = n;
      if (text.slice(lineStart, i).trim() === '' && text.slice(i + 1, lineEnd).trim() === '') {
        push(lineStart > (stmtStart === -1 ? 0 : stmtStart) ? lineStart : i);
        i = lineEnd + 1;
        continue;
      }
    }

    if (ch === ';') {
      if (stmtStart !== -1) {
        if (plsql === null) plsql = isPlsqlStart(text.slice(stmtStart, i));
        if (!plsql) {
          push(i + 1);
          i++;
          continue;
        }
      }
      i++;
      continue;
    }

    if (stmtStart === -1 && !/\s/.test(ch)) stmtStart = i;
    i++;
  }
  push(n);
  return out;
}

// Returns the statement containing the cursor (or the closest previous one).
export function statementAt(text, pos) {
  const stmts = splitStatements(text);
  if (!stmts.length) return null;
  for (const s of stmts) if (pos <= s.end) return s;
  return stmts[stmts.length - 1];
}

// Prepares a statement for the server: strips the trailing ";" for plain SQL,
// keeps it for PL/SQL blocks (they need their END;).
export function executableSql(stmt) {
  return stmt.plsql ? stmt.text.trimEnd() : stmt.text.trim().replace(/;\s*$/, '');
}
