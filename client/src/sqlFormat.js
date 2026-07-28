// Formattatore SQL/PL-SQL.
//
// Lavora sui token: cambia solo gli spazi bianchi e il maiuscolo delle parole
// chiave, non riordina né elimina nulla. Alla fine `verify()` ritokenizza il
// risultato e lo confronta con l'ingresso: se qualcosa non torna la
// formattazione viene annullata invece di rovinare il codice.

// ---------- tokenizer ----------

// Esportate anche per la colorazione dei blocchi SQL in chat (codeTokens.js).
export const KEYWORDS = new Set(
  `ACCESS ADD ALL ALTER AND ANY ARRAY AS ASC AT AUTHID BEGIN BETWEEN BFILE BINARY_DOUBLE
   BINARY_FLOAT BLOB BODY BOOLEAN BOTH BULK BY BYTE CALL CASCADE CASE CAST CHAR CHECK CLOB
   CLOSE CLUSTER COALESCE COLLECT COLUMN COMMENT COMMIT CONNECT CONSTANT CONSTRAINT CONTINUE
   CREATE CROSS CURRENT CURRENT_DATE CURRENT_TIMESTAMP CURSOR CYCLE DATE DAY DBLINK DEC DECIMAL
   DECLARE DEFAULT DEFERRABLE DELETE DESC DETERMINISTIC DIRECTORY DISABLE DISTINCT DO DOUBLE DROP
   EACH ELSE ELSIF ENABLE END ESCAPE EXCEPTION EXCEPTIONS EXCLUSIVE EXECUTE EXISTS EXIT EXTRACT
   FALSE FETCH FIRST FLOAT FOLLOWING FOR FORALL FOREIGN FROM FULL FUNCTION GOTO GRANT GROUP
   HAVING IF IMMEDIATE IN INCREMENT INDEX INDICES INITIALLY INNER INOUT INSERT INSTEAD INT INTEGER
   INTERSECT INTERVAL INTO IS JOIN KEEP KEY LAST LEADING LEFT LEVEL LIKE LIMIT LOCAL LOCK LONG
   LOOP MATERIALIZED MAXVALUE MERGE MINUS MINVALUE MOD MODIFY MONTH NATURAL NEW NEXTVAL NO NOCOPY
   NOCYCLE NOT NOWAIT NULL NULLS NUMBER NUMERIC NVARCHAR2 OBJECT OF OFFSET OLD ON ONLY OPEN OR
   ORDER OTHERS OUT OUTER OVER PACKAGE PARALLEL PARTITION PCTFREE PIPELINED PIVOT PRAGMA PRECEDING
   PRECISION PRIMARY PRIOR PROCEDURE PUBLIC RAISE RANGE RAW READ REAL RECORD REF REFERENCES
   REFERENCING RENAME REPLACE RESULT_CACHE RETURN RETURNING REVERSE REVOKE RIGHT ROLLBACK ROW
   ROWCOUNT ROWID ROWTYPE ROWS SAVEPOINT SEARCH SECOND SELECT SEQUENCE SESSION SET SHARE SIBLINGS
   SIGNTYPE SIZE SMALLINT SOME START STORAGE SUBTYPE SYNONYM SYS_REFCURSOR TABLE TABLESPACE THEN
   TIME TIMESTAMP TO TRAILING TRIGGER TRUE TRUNCATE TYPE UNBOUNDED UNION UNIQUE UNPIVOT UPDATE
   UROWID USING VALUES VARCHAR VARCHAR2 VARRAY VIEW WHEN WHENEVER WHERE WHILE WITH WITHIN WORK
   WRITE XMLTYPE YEAR ZONE`
    .split(/\s+/)
    .filter(Boolean)
);

// Parole chiave dopo le quali una parentesi vuole lo spazio: tutto il resto
// (nomi di funzione, identificatori) resta attaccato.
const SPACE_BEFORE_PAREN = new Set(
  `ALL AND ANY AS BETWEEN BY CASE CHECK DELETE ELSE ELSIF EXCEPTION EXISTS FOR FROM GROUP HAVING
   IF IN INSERT INTERSECT INTO IS JOIN KEY LIKE LOOP MINUS NOT ON OR ORDER OVER PARTITION PRIMARY
   REFERENCES RETURN RETURNING SELECT SET SOME START THEN UNION UNIQUE UPDATE USING VALUES WHEN
   WHERE WHILE WITH`
    .split(/\s+/)
    .filter(Boolean)
);

// Inizio di una clausola SQL: va a capo (solo al livello di parentesi della
// query a cui appartiene, così `EXTRACT(YEAR FROM d)` resta su una riga).
const CLAUSE = new Set(
  `SELECT FROM WHERE GROUP HAVING ORDER CONNECT START UNION MINUS INTERSECT INSERT UPDATE DELETE
   MERGE VALUES SET RETURNING FETCH OFFSET`
    .split(/\s+/)
    .filter(Boolean)
);

const JOIN_PREFIX = new Set(['LEFT', 'RIGHT', 'FULL', 'INNER', 'CROSS', 'NATURAL']);
const SQL_OPENER = new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'WITH']);
// Dopo IS/AS queste parole escludono l'intestazione di un blocco PL/SQL.
const NOT_DECL_AFTER = new Set(['SELECT', 'OBJECT', 'TABLE', 'VARRAY', 'RECORD', 'REF', 'RANGE', 'WITH']);
const DECL_STARTERS = new Set(['CREATE', 'PROCEDURE', 'FUNCTION', 'PACKAGE']);
const DECL_OBJECTS = new Set(['PACKAGE', 'PROCEDURE', 'FUNCTION', 'TRIGGER', 'TYPE']);

const OPERATORS = [
  '**',
  ':=',
  '=>',
  '||',
  '<=',
  '>=',
  '<>',
  '!=',
  '^=',
  '~=',
  '..',
  '<<',
  '>>',
  '=',
  '<',
  '>',
  '+',
  '-',
  '*',
  '/',
  '%',
  '@',
  '|',
];

const QUOTE_PAIRS = { '(': ')', '[': ']', '{': '}', '<': '>' };

export function tokenize(sql) {
  const out = [];
  let i = 0;
  let nl = 0; // righe vuote/aperture di riga prima del token corrente
  let bol = true; // il token è il primo della sua riga nel sorgente
  const push = (type, text) => {
    out.push({ type, text, nl, bol });
    nl = 0;
    bol = false;
  };
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === '\n') {
      nl++;
      bol = true;
      i++;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      i++;
      continue;
    }
    if (ch === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      push('lineComment', sql.slice(i, end === -1 ? sql.length : end));
      i = end === -1 ? sql.length : end;
      continue;
    }
    if (ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      push('blockComment', sql.slice(i, end === -1 ? sql.length : end + 2));
      i = end === -1 ? sql.length : end + 2;
      continue;
    }
    // stringa con delimitatore alternativo: q'[ … ]'
    if ((ch === 'q' || ch === 'Q') && sql[i + 1] === "'") {
      const open = sql[i + 2];
      const close = QUOTE_PAIRS[open] || open;
      const end = sql.indexOf(close + "'", i + 3);
      if (end !== -1) {
        push('string', sql.slice(i, end + 2));
        i = end + 2;
        continue;
      }
    }
    if (ch === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") j += 2;
          else break;
        } else j++;
      }
      push('string', sql.slice(i, Math.min(j + 1, sql.length)));
      i = Math.min(j + 1, sql.length);
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < sql.length && sql[j] !== '"') j++;
      push('quoted', sql.slice(i, Math.min(j + 1, sql.length)));
      i = Math.min(j + 1, sql.length);
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(sql[i + 1] || ''))) {
      const m = /^[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?/.exec(sql.slice(i));
      push('number', m[0]);
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_$#]*/.exec(sql.slice(i));
      push('word', m[0]);
      i += m[0].length;
      continue;
    }
    if (ch === ':') {
      if (sql[i + 1] === '=') {
        push('op', ':=');
        i += 2;
        continue;
      }
      const m = /^:\s*[A-Za-z0-9_$#]+/.exec(sql.slice(i));
      if (m) {
        push('bind', m[0].replace(/\s+/g, ''));
        i += m[0].length;
        continue;
      }
      push('punct', ':');
      i++;
      continue;
    }
    if ('(),;'.includes(ch)) {
      push('punct', ch);
      i++;
      continue;
    }
    if (ch === '.') {
      push('punct', '.');
      i++;
      continue;
    }
    const op = OPERATORS.find((o) => sql.startsWith(o, i));
    if (op) {
      push('op', op);
      i += op.length;
      continue;
    }
    push('punct', ch);
    i++;
  }
  return out;
}

// ---------- layout ----------

const isWord = (t) => t && t.type === 'word';
const upper = (t) => (isWord(t) ? t.text.toUpperCase() : null);

function needsSpace(prev, cur) {
  if (!prev) return false;
  const p = prev.text;
  const c = cur.text;
  if (c === ',' || c === ';' || c === ')') return false;
  if (p === '(' || p === '.' || p === '@' || p === '%') return false;
  if (c === '.' || c === '@' || c === '%') return false;
  if (c === '(') {
    if (prev.type === 'word') return SPACE_BEFORE_PAREN.has(p.toUpperCase());
    return prev.type !== 'quoted' && p !== ')';
  }
  if (prev.unary) return false;
  return true;
}

// `-`/`+` sono unari se non seguono un valore.
function isUnary(prev, text) {
  if (text !== '-' && text !== '+') return false;
  if (!prev) return true;
  if (prev.type === 'number' || prev.type === 'string' || prev.type === 'quoted' || prev.type === 'bind') return false;
  if (prev.text === ')') return false;
  if (prev.type === 'word') return KEYWORDS.has(prev.text.toUpperCase());
  return true;
}

export function formatSql(sql, opts = {}) {
  const tabWidth = opts.tabWidth ?? 2;
  const maxWidth = opts.maxWidth ?? 100;
  const pad = ' '.repeat(tabWidth);
  const tokens = tokenize(sql);
  if (!tokens.length) return sql;

  const lines = []; // { level, tokens: [{text, depth, unary}] }
  let cur = null;
  let level = 0;
  let depth = 0;
  const blocks = []; // { k: 'decl' | 'begin' | 'if' | 'loop' | 'case' }
  const parens = []; // { level, multiline }
  const sqlDepths = []; // profondità di parentesi delle query aperte
  let stmtWords = []; // prime parole dell'istruzione corrente

  const lineLen = (l) => {
    if (!l) return 0;
    let n = l.level * tabWidth;
    let prev = null;
    for (const t of l.tokens) {
      if (needsSpace(prev, t)) n++;
      n += t.text.length;
      prev = t;
    }
    return n;
  };

  const br = (blank = 0) => {
    if (cur && cur.tokens.length) {
      lines.push(cur);
      for (const p of parens) p.multiline = true;
    }
    for (let i = 0; i < blank; i++) lines.push({ level: 0, tokens: [] });
    cur = { level: Math.max(0, level + depth), tokens: [] };
  };

  const emit = (tok, text) => {
    if (!cur) cur = { level: Math.max(0, level + depth), tokens: [] };
    const prev = cur.tokens[cur.tokens.length - 1] || null;
    cur.tokens.push({
      text: text ?? tok.text,
      type: tok.type,
      depth,
      unary: tok.type === 'op' && isUnary(prev, tok.text),
    });
  };

  const inSqlClause = () => sqlDepths.length > 0 && depth === sqlDepths[sqlDepths.length - 1].depth;
  const top = () => blocks[blocks.length - 1];

  // Cerca la prossima parola significativa (per decidere IS/AS, END IF, join…).
  const nextWord = (from, skip = new Set()) => {
    for (let j = from; j < tokens.length; j++) {
      const t = tokens[j];
      if (t.type === 'lineComment' || t.type === 'blockComment') continue;
      if (t.type !== 'word') return null;
      const u = t.text.toUpperCase();
      if (skip.has(u)) continue;
      return u;
    }
    return null;
  };

  // Chiude fino al blocco richiesto compreso: `END p;` chiude anche i
  // gestori WHEN ancora aperti dentro il blocco.
  const closeBlock = (...kinds) => {
    let idx = -1;
    for (let i = blocks.length - 1; i >= 0; i--) {
      if (kinds.includes(blocks[i].k)) {
        idx = i;
        break;
      }
    }
    if (idx === -1) idx = blocks.length - 1;
    if (idx < 0) return null;
    const removed = blocks.splice(idx);
    for (const b of removed) if (b.k !== 'case') level = Math.max(0, level - 1);
    return removed[0].k;
  };

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const blank = tok.nl > 1 && lines.length ? 1 : 0;

    if (tok.type === 'lineComment' || tok.type === 'blockComment') {
      // Un commento in coda a codice resta dov'era; da solo va a capo.
      if (tok.bol || !cur || !cur.tokens.length) br(blank);
      emit(tok);
      if (tok.type === 'lineComment') br();
      continue;
    }

    if (tok.type === 'word') {
      const u = tok.text.toUpperCase();
      const kw = KEYWORDS.has(u);
      const text = kw ? u : tok.text;
      if (stmtWords.length < 6) stmtWords.push(u);

      switch (u) {
        case 'DECLARE':
          br(blank);
          emit(tok, text);
          level++;
          blocks.push({ k: 'decl' });
          br();
          continue;
        case 'IS':
        case 'AS': {
          const nxt = nextWord(i + 1);
          const isHeader =
            depth === 0 &&
            DECL_STARTERS.has(stmtWords[0]) &&
            (stmtWords[0] !== 'CREATE' || stmtWords.some((w) => DECL_OBJECTS.has(w))) &&
            !(nxt && NOT_DECL_AFTER.has(nxt));
          emit(tok, text);
          if (isHeader) {
            level++;
            blocks.push({ k: 'decl' });
            br();
          }
          continue;
        }
        case 'BEGIN': {
          if (depth === 0) {
            if (top()?.k === 'decl') {
              blocks.pop();
              level = Math.max(0, level - 1);
            }
            br(blank);
            emit(tok, text);
            level++;
            blocks.push({ k: 'begin' });
            br();
            stmtWords = [];
            continue;
          }
          break;
        }
        case 'EXCEPTION': {
          // Solo la sezione EXCEPTION di un blocco, non `… EXCEPTION;`
          if (depth === 0 && top()?.k === 'begin' && nextWord(i + 1) === 'WHEN') {
            level = Math.max(0, level - 1);
            br(blank);
            emit(tok, text);
            level++;
            br();
            top().inException = true;
            stmtWords = [];
            continue;
          }
          break;
        }
        case 'END': {
          const after = nextWord(i + 1);
          const kind = after === 'IF' ? 'if' : after === 'LOOP' ? 'loop' : after === 'CASE' ? 'case' : null;
          if ((top()?.k === 'case' && !kind) || kind === 'case') {
            closeBlock('case');
            emit(tok, text); // END di un'espressione CASE: resta in linea
            continue;
          }
          if (kind) closeBlock(kind);
          else closeBlock('begin', 'decl');
          br(blank);
          emit(tok, text);
          stmtWords = [];
          continue;
        }
        case 'IF': {
          if (upper(tokens[i - 1]) === 'END') {
            emit(tok, text);
            continue;
          }
          if (depth === 0 && (!cur || !cur.tokens.length || stmtWords.length === 1)) br(blank);
          emit(tok, text);
          blocks.push({ k: 'if' });
          continue;
        }
        case 'ELSIF': {
          closeBlock('if');
          br(blank);
          emit(tok, text);
          blocks.push({ k: 'if' });
          continue;
        }
        case 'THEN': {
          emit(tok, text);
          if (top()?.k === 'if' || top()?.k === 'when') {
            level++;
            top().opened = true;
            br();
          }
          continue;
        }
        case 'ELSE': {
          if (top()?.k === 'if' && top().opened) {
            level = Math.max(0, level - 1);
            br(blank);
            emit(tok, text);
            level++;
            br();
          } else {
            emit(tok, text); // ELSE di un CASE espressione
          }
          continue;
        }
        case 'LOOP': {
          if (upper(tokens[i - 1]) === 'END') {
            emit(tok, text);
            continue;
          }
          emit(tok, text);
          level++;
          blocks.push({ k: 'loop' });
          br();
          continue;
        }
        case 'CASE': {
          if (upper(tokens[i - 1]) === 'END') {
            emit(tok, text);
            continue;
          }
          emit(tok, text);
          blocks.push({ k: 'case' });
          continue;
        }
        case 'WHEN': {
          // Gestore di eccezione o ramo di MERGE: il corpo dopo THEN rientra.
          const isMergeWhen = depth === 0 && sqlDepths[sqlDepths.length - 1]?.kw === 'MERGE';
          if (top()?.k === 'when') {
            if (top().merge === isMergeWhen) closeBlock('when');
          }
          if ((top()?.k === 'begin' && top().inException) || isMergeWhen) {
            br(blank);
            emit(tok, text);
            blocks.push({ k: 'when', merge: isMergeWhen });
            continue;
          }
          emit(tok, text);
          continue;
        }
        default:
          break;
      }

      if (SQL_OPENER.has(u) && upper(tokens[i - 1]) !== 'END') sqlDepths.push({ depth, kw: u });

      const prevWord = upper(tokens[i - 1]);
      const isJoin =
        (u === 'JOIN' && !JOIN_PREFIX.has(prevWord) && prevWord !== 'OUTER') ||
        (JOIN_PREFIX.has(u) && nextWord(i + 1, new Set(['OUTER', 'LEFT', 'RIGHT', 'FULL', 'INNER'])) === 'JOIN');

      // Dopo THEN (MERGE) e in `UPDATE SET` la clausola resta sulla stessa riga.
      const glued = prevWord === 'THEN' || (u === 'SET' && prevWord === 'UPDATE');

      if ((CLAUSE.has(u) || isJoin) && inSqlClause() && cur?.tokens.length && !glued) {
        // `GROUP`/`ORDER` solo se seguiti da BY; `START` solo se seguito da WITH.
        const ok =
          (u !== 'GROUP' && u !== 'ORDER' && u !== 'START' && u !== 'CONNECT') ||
          ((u === 'GROUP' || u === 'ORDER') && nextWord(i + 1) === 'BY') ||
          (u === 'START' && nextWord(i + 1) === 'WITH') ||
          (u === 'CONNECT' && nextWord(i + 1) === 'BY');
        if (ok) br(blank);
      }
      emit(tok, text);
      continue;
    }

    if (tok.type === 'punct') {
      if (tok.text === '(') {
        emit(tok);
        parens.push({ level, multiline: false });
        depth++;
        continue;
      }
      if (tok.text === ')') {
        const open = parens.pop();
        depth = Math.max(0, depth - 1);
        while (sqlDepths.length && sqlDepths[sqlDepths.length - 1].depth > depth) sqlDepths.pop();
        if (open?.multiline) {
          const keep = level;
          level = open.level;
          br();
          level = keep;
        }
        emit(tok);
        continue;
      }
      if (tok.text === ';') {
        emit(tok);
        sqlDepths.length = 0;
        stmtWords = [];
        while (top()?.k === 'when' && top().merge) closeBlock('when');
        // Un commento sulla stessa riga resta in coda all'istruzione.
        const nxt = tokens[i + 1];
        if (!nxt || nxt.nl > 0 || (nxt.type !== 'lineComment' && nxt.type !== 'blockComment')) br();
        continue;
      }
      if (tok.text === '/' && tok.bol) {
        br(blank);
        emit(tok);
        br();
        continue;
      }
      emit(tok);
      continue;
    }

    if (tok.type === 'op' && tok.text === '/' && tok.bol && (!cur || !cur.tokens.length)) {
      br(blank);
      emit(tok);
      br();
      continue;
    }

    emit(tok);
  }
  br();

  return lines
    .flatMap((l) => wrap(l, maxWidth, tabWidth))
    .map((l) => (l.tokens.length ? pad.repeat(l.level) + render(l.tokens) : ''))
    .join('\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .trimEnd();
}

function render(toks) {
  let out = '';
  let prev = null;
  for (const t of toks) {
    if (needsSpace(prev, t)) out += ' ';
    out += t.text;
    prev = t;
  }
  return out;
}

// Righe troppo lunghe: spezza sulle virgole (o su AND/OR) del livello di
// parentesi più esterno della riga, rientrando di un livello.
function wrap(line, maxWidth, tabWidth) {
  const width = line.level * tabWidth + render(line.tokens).length;
  if (width <= maxWidth || line.tokens.length < 4) return [line];
  const minDepth = Math.min(...line.tokens.map((t) => t.depth));
  const points = [];
  let between = 0;
  for (let i = 1; i < line.tokens.length - 1; i++) {
    const t = line.tokens[i];
    if (t.depth !== minDepth) continue;
    const u = t.text.toUpperCase();
    if (u === 'BETWEEN') between++;
    if (t.text === ',') points.push({ i, after: true });
    else if ((u === 'AND' || u === 'OR') && t.type === 'word') {
      if (u === 'AND' && between > 0) between--;
      else points.push({ i, after: false });
    }
  }
  if (!points.length) return [line];
  const out = [];
  let start = 0;
  for (const p of points) {
    const end = p.after ? p.i + 1 : p.i;
    if (end > start) out.push({ level: line.level + (out.length ? 1 : 0), tokens: line.tokens.slice(start, end) });
    start = end;
  }
  if (start < line.tokens.length) {
    out.push({ level: line.level + (out.length ? 1 : 0), tokens: line.tokens.slice(start) });
  }
  return out.length ? out : [line];
}

// ---------- verifica ----------

function significant(sql) {
  return tokenize(sql).map((t) => (t.type === 'word' ? t.text.toUpperCase() : t.text));
}

export class FormatError extends Error {}

// Formatta solo se il risultato contiene esattamente gli stessi token.
export function safeFormatSql(sql, opts) {
  let out;
  try {
    out = formatSql(sql, opts);
  } catch (err) {
    throw new FormatError(`Formattazione non riuscita: ${err.message}`);
  }
  const a = significant(sql);
  const b = significant(out);
  if (a.length !== b.length || a.some((t, i) => t !== b[i])) {
    throw new FormatError('Formattazione annullata: il codice non è stato riconosciuto correttamente');
  }
  return out;
}
