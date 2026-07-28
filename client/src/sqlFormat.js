// Formattatore SQL/PL-SQL.
//
// Lavora sui token: cambia solo gli spazi bianchi e il maiuscolo delle parole
// chiave, non riordina né elimina nulla. Alla fine `verify()` ritokenizza il
// risultato e lo confronta con l'ingresso: se qualcosa non torna la
// formattazione viene annullata invece di rovinare il codice.

// ---------- tokenizer ----------

// Esportate anche per la colorazione dei blocchi SQL in chat (codeTokens.js).
export const KEYWORDS = new Set(
  `ACCESS ADD AFTER ALL ALTER AND ANY ARRAY AS ASC AT AUTHID BEFORE BEGIN BETWEEN BFILE BINARY_DOUBLE
   BINARY_FLOAT BLOB BODY BOOLEAN BOTH BULK BY BYTE CALL CASCADE CASE CAST CHAR CHECK CLOB
   CLOSE CLUSTER COALESCE COLLECT COLUMN COMMENT COMMIT CONNECT CONSTANT CONSTRAINT CONTINUE
   CREATE CROSS CURRENT CURRENT_DATE CURRENT_TIMESTAMP CURSOR CYCLE DATE DAY DBLINK DEC DECIMAL
   DECLARE DEFAULT DEFERRABLE DELETE DESC DETERMINISTIC DIRECTORY DISABLE DISTINCT DO DOUBLE DROP
   EACH ELSE ELSIF ENABLE END ESCAPE EXCEPTION EXCEPTIONS EXCLUSIVE EXECUTE EXISTS EXIT EXTRACT
   FALSE FETCH FIRST FLOAT FOLLOWING FOR FORALL FOREIGN FROM FULL FUNCTION GOTO GRANT GROUP
   HAVING IF IMMEDIATE IN INCREMENT INDEX INDICES INITIALLY INNER INOUT INSERT INSTEAD INT INTEGER
   INTERSECT INTERVAL INTO IS JOIN KEEP KEY LAST LEADING LEFT LEVEL LIKE LIMIT LOCAL LOCK LONG
   LOOP MATCHED MATERIALIZED MAXVALUE MERGE MINUS MINVALUE MOD MODIFY MONTH NATURAL NEW NEXTVAL NO NOCOPY
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

// Parole dopo le quali segue il nome di un oggetto: la parentesi che chiude il
// nome (`CREATE TABLE t (…)`, `INSERT INTO t (…)`, `CREATE INDEX i ON t (…)`)
// vuole lo spazio, a differenza di una chiamata di funzione.
const NAME_PAREN_AFTER = new Set(['TABLE', 'INTO', 'INDEX', 'VIEW', 'ON', 'CLUSTER']);

// Inizio di una clausola SQL: va a capo (solo al livello di parentesi della
// query a cui appartiene, così `EXTRACT(YEAR FROM d)` resta su una riga).
const CLAUSE = new Set(
  `SELECT FROM WHERE GROUP HAVING ORDER CONNECT START UNION MINUS INTERSECT INSERT UPDATE DELETE
   MERGE VALUES SET RETURNING FETCH OFFSET`
    .split(/\s+/)
    .filter(Boolean)
);

const JOIN_PREFIX = new Set(['LEFT', 'RIGHT', 'FULL', 'INNER', 'CROSS', 'NATURAL']);
const TRIGGER_EVENTS = new Set(['INSERT', 'UPDATE', 'DELETE']);
const TRIGGER_EVENT_PREV = new Set(['BEFORE', 'AFTER', 'OR', 'OF']);
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
    if (cur.spaced) return true;
    if (prev.type === 'word') return SPACE_BEFORE_PAREN.has(p.toUpperCase());
    return prev.type !== 'quoted' && p !== ')';
  }
  if (prev.unary) return false;
  return true;
}

// Vero se la parentesi in posizione `i` chiude il nome di un oggetto
// (`t`, `schema.t`) introdotto da CREATE TABLE / INSERT INTO / … ON.
function afterObjectName(tokens, i) {
  const isName = (t) => !!t && (t.type === 'word' || t.type === 'quoted');
  let j = i - 1;
  if (!isName(tokens[j])) return false;
  while (j > 0 && tokens[j - 1].type === 'punct' && tokens[j - 1].text === '.') {
    j -= 2;
    if (!isName(tokens[j])) return false;
  }
  const before = tokens[j - 1];
  return !!before && before.type === 'word' && NAME_PAREN_AFTER.has(before.text.toUpperCase());
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

  const br = (blank = 0) => {
    if (cur && cur.tokens.length) {
      lines.push(cur);
      for (const p of parens) p.multiline = true;
    }
    for (let i = 0; i < blank; i++) lines.push({ level: 0, tokens: [] });
    cur = { level: Math.max(0, level + depth), tokens: [] };
  };

  const emit = (tok, text, extra) => {
    if (!cur) cur = { level: Math.max(0, level + depth), tokens: [] };
    const prev = cur.tokens[cur.tokens.length - 1] || null;
    cur.tokens.push({
      text: text ?? tok.text,
      type: tok.type,
      depth,
      unary: tok.type === 'op' && isUnary(prev, tok.text),
      ...extra,
    });
  };

  const inSqlClause = () => sqlDepths.length > 0 && depth === sqlDepths[sqlDepths.length - 1].depth;
  const top = () => blocks[blocks.length - 1];
  const lastBlock = (k) => {
    for (let i = blocks.length - 1; i >= 0; i--) if (blocks[i].k === k) return blocks[i];
    return null;
  };

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
    for (const b of removed) if (b.k !== 'case' || b.stmt) level = Math.max(0, level - 1);
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
      // Dopo un punto la parola è un nome (colonna, campo, pseudo-colonna):
      // non va maiuscolata né interpretata come parola chiave, altrimenti
      // `t.date` o `s.level` diventerebbero `t.DATE` e `s.LEVEL`.
      if (tokens[i - 1]?.type === 'punct' && tokens[i - 1].text === '.') {
        emit(tok);
        continue;
      }
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
            const stmt = lastBlock('case')?.stmt;
            closeBlock('case');
            if (stmt) br(blank); // istruzione CASE: END CASE su una riga sua
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
          if (top()?.k === 'case' && top().stmt) {
            br(blank);
            emit(tok, text);
            continue;
          }
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
          // CASE come istruzione PL/SQL (chiuso da END CASE): apre un blocco,
          // i rami WHEN vanno a capo rientrati. Come espressione resta in riga.
          if (depth === 0 && !sqlDepths.length && !cur?.tokens.length) {
            br(blank);
            emit(tok, text);
            level++;
            blocks.push({ k: 'case', stmt: true });
            continue;
          }
          emit(tok, text);
          blocks.push({ k: 'case' });
          continue;
        }
        case 'WHEN': {
          if (top()?.k === 'case' && top().stmt) {
            br(blank);
            emit(tok, text);
            continue;
          }
          // Gestore di eccezione o ramo di MERGE: il corpo dopo THEN rientra.
          // Il MERGE si cerca in tutta la pila perché i suoi rami aprono a
          // loro volta UPDATE e INSERT.
          const isMergeWhen =
            depth === 0 && top()?.k !== 'case' && sqlDepths.some((s) => s.depth === 0 && s.kw === 'MERGE');
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

      const prevWord = upper(tokens[i - 1]);

      // `BEFORE INSERT OR UPDATE OF col ON t`: gli eventi di un trigger non
      // sono istruzioni, restano nell'intestazione senza andare a capo.
      if (
        TRIGGER_EVENTS.has(u) &&
        TRIGGER_EVENT_PREV.has(prevWord) &&
        !blocks.length &&
        stmtWords[0] === 'CREATE' &&
        stmtWords.includes('TRIGGER')
      ) {
        emit(tok, text);
        continue;
      }

      if (SQL_OPENER.has(u) && prevWord !== 'END') sqlDepths.push({ depth, kw: u });

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
        emit(tok, null, depth === 0 && afterObjectName(tokens, i) ? { spaced: true } : null);
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

// Righe troppo lunghe: si prova a spezzarle, in ordine, sui separatori del
// livello di parentesi più esterno (virgole, AND/OR), sulla struttura di un
// CASE, sulle concatenazioni e infine aprendo il gruppo di parentesi più
// esterno. Ogni pezzo viene riesaminato, così una colonna lunga dentro una
// lista già spezzata continua a rientrare.
function wrap(line, maxWidth, tabWidth) {
  if (line.tokens.length < 4 || lineWidth(line, tabWidth) <= maxWidth) return [line];
  const minDepth = Math.min(...line.tokens.map((t) => t.depth));
  const parts =
    splitSeparators(line, minDepth) ||
    splitCase(line, minDepth) ||
    splitConcat(line, minDepth) ||
    splitParen(line, minDepth);
  return parts ? parts.flatMap((l) => wrap(l, maxWidth, tabWidth)) : [line];
}

function lineWidth(line, tabWidth) {
  return line.level * tabWidth + render(line.tokens).length;
}

// Taglia la riga nei punti indicati: `i` è l'indice del token davanti al quale
// (o dietro al quale, con `after`) si va a capo, `indent` il rientro relativo
// dei token che seguono.
function cut(line, points) {
  const out = [];
  let start = 0;
  let indent = 0;
  for (const p of points) {
    const end = p.after ? p.i + 1 : p.i;
    if (end > start) out.push({ level: line.level + indent, tokens: line.tokens.slice(start, end) });
    start = end;
    indent = p.indent;
  }
  if (start < line.tokens.length) out.push({ level: line.level + indent, tokens: line.tokens.slice(start) });
  return out.length > 1 ? out : null;
}

// Virgole e AND/OR del livello più esterno. `indent` è 0 quando la riga è già
// il contenuto rientrato di una parentesi: le voci restano allineate fra loro.
function splitSeparators(line, minDepth, indent = 1) {
  const points = [];
  let between = 0;
  let caseNest = 0;
  for (let i = 0; i < line.tokens.length; i++) {
    const t = line.tokens[i];
    if (t.depth !== minDepth) continue;
    const u = t.text.toUpperCase();
    // Dentro un CASE…END gli AND/OR fanno parte della condizione di un ramo:
    // spezzarli qui scompaginerebbe il rientro, se ne occupa splitCase.
    if (t.type === 'word' && u === 'CASE') caseNest++;
    else if (t.type === 'word' && u === 'END') caseNest = Math.max(0, caseNest - 1);
    if (caseNest > 0 || i === 0 || i === line.tokens.length - 1) continue;
    if (u === 'BETWEEN') between++;
    if (t.text === ',') points.push({ i, after: true, indent });
    else if ((u === 'AND' || u === 'OR') && t.type === 'word') {
      if (u === 'AND' && between > 0) between--;
      else points.push({ i, after: false, indent });
    }
  }
  return points.length ? cut(line, points) : null;
}

// Concatenazioni: si va a capo prima di `||`.
function splitConcat(line, minDepth) {
  const points = [];
  for (let i = 1; i < line.tokens.length - 1; i++) {
    const t = line.tokens[i];
    if (t.depth === minDepth && t.type === 'op' && t.text === '||') points.push({ i, after: false, indent: 1 });
  }
  return points.length ? cut(line, points) : null;
}

// Un CASE lungo: WHEN/ELSE rientrati di un livello, END di nuovo allineato.
function splitCase(line, minDepth) {
  const toks = line.tokens;
  const points = [];
  let nest = 0;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.type !== 'word' || t.depth !== minDepth) continue;
    const u = t.text.toUpperCase();
    if (u === 'CASE') nest++;
    else if (u === 'END') {
      if (nest === 1 && i > 0) points.push({ i, after: false, indent: 0 });
      nest = Math.max(0, nest - 1);
    } else if (nest === 1 && i > 0 && (u === 'WHEN' || u === 'ELSE')) {
      points.push({ i, after: false, indent: 1 });
    }
  }
  return points.length ? cut(line, points) : null;
}

// Ultima risorsa: apre il primo gruppo di parentesi del livello più esterno e
// ne rientra il contenuto — `CREATE TABLE t (`, lista colonne, `)`.
function splitParen(line, minDepth) {
  const toks = line.tokens;
  const at = (i, text) => toks[i].type === 'punct' && toks[i].text === text && toks[i].depth === minDepth;
  let open = -1;
  for (let i = 0; i < toks.length && open === -1; i++) if (at(i, '(')) open = i;
  if (open === -1) return null;
  let close = -1;
  for (let i = open + 1; i < toks.length && close === -1; i++) if (at(i, ')')) close = i;
  if (close === -1 || close === open + 1) return null;
  const inner = { level: line.level + 1, tokens: toks.slice(open + 1, close) };
  const innerDepth = Math.min(...inner.tokens.map((t) => t.depth));
  return [
    { level: line.level, tokens: toks.slice(0, open + 1) },
    ...(splitSeparators(inner, innerDepth, 0) || [inner]),
    { level: line.level, tokens: toks.slice(close) },
  ];
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
