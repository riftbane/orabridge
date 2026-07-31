// Analisi best-effort di un'istruzione SQL/PL-SQL per l'autocomplete.
// Non è un parser completo: tokenizza il testo, ricava le tabelle citate con i
// loro alias (FROM/JOIN/UPDATE/INTO/USING, liste con virgole, CTE e subquery)
// e capisce in quale clausola si trova il cursore, così i suggerimenti possono
// essere ordinati per contesto. Nessuna dipendenza da CodeMirror: è logica
// pura, testabile con `npm test`.
//
// Oltre alla clausola, `analyze` dice che cosa ci si aspetta nel punto esatto
// del cursore (il «posto», vedi `slot`): all'inizio di un'istruzione servono
// modelli e verbi, dopo CREATE serve un tipo di oggetto, dentro CREATE TABLE
// serve un tipo di dato. È questa distinzione che evita di proporre funzioni
// dove può stare solo una parola chiave.

const WORD = /[A-Za-z][A-Za-z0-9_$#]*/y;

// Tokenizza scartando commenti e spazi. Ogni token: { k, v, s, e } dove
// k = id | qid | str | num | bind | punc e v è il valore normalizzato (gli
// identificatori non quotati diventano MAIUSCOLI, `raw` conserva l'originale).
export function tokenize(sql) {
  const out = [];
  const n = sql.length;
  let i = 0;
  while (i < n) {
    const ch = sql[i];
    if (ch <= ' ') {
      i++;
      continue;
    }
    if (ch === '-' && sql[i + 1] === '-') {
      const nl = sql.indexOf('\n', i);
      i = nl < 0 ? n : nl + 1;
      continue;
    }
    if (ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const s = i;
      i++;
      while (i < n) {
        if (sql[i] === ch) {
          if (sql[i + 1] === ch) i += 2;
          else {
            i++;
            break;
          }
        } else i++;
      }
      if (ch === '"') {
        out.push({ k: 'qid', v: sql.slice(s + 1, i - 1).replace(/""/g, '"'), raw: sql.slice(s, i), s, e: i });
      } else out.push({ k: 'str', v: sql.slice(s, i), s, e: i });
      continue;
    }
    if (ch >= '0' && ch <= '9') {
      const s = i;
      while (i < n && /[0-9.]/.test(sql[i])) i++;
      out.push({ k: 'num', v: sql.slice(s, i), s, e: i });
      continue;
    }
    WORD.lastIndex = i;
    let m = WORD.exec(sql);
    if (m) {
      out.push({ k: 'id', v: m[0].toUpperCase(), raw: m[0], s: i, e: i + m[0].length });
      i += m[0].length;
      continue;
    }
    if (ch === ':') {
      WORD.lastIndex = i + 1;
      m = WORD.exec(sql);
      if (m) {
        out.push({ k: 'bind', v: m[0], s: i, e: i + 1 + m[0].length });
        i += 1 + m[0].length;
        continue;
      }
    }
    out.push({ k: 'punc', v: ch, s: i, e: i + 1 });
    i++;
  }
  return out;
}

// Clausola associata a ogni parola chiave che ne apre una.
const CLAUSE = {
  SELECT: 'select',
  FROM: 'from',
  JOIN: 'join',
  ON: 'on',
  WHERE: 'where',
  GROUP: 'group',
  ORDER: 'order',
  HAVING: 'having',
  SET: 'set',
  VALUES: 'values',
  INTO: 'into',
  UPDATE: 'update',
  USING: 'join',
  RETURNING: 'select',
  CONNECT: 'where',
  START: 'where',
  WHEN: 'where',
  DELETE: 'delete',
  MERGE: 'merge',
};

// Clausole che introducono tabelle; il valore dice se accettano una lista
// separata da virgole (`FROM a, b` sì, `JOIN a` no).
const REF_CLAUSE = { FROM: true, JOIN: false, INTO: false, UPDATE: true, USING: false };

// Clausole in cui si nomina una tabella: lì i nomi di colonna non servono.
const TABLE_CLAUSES = new Set(['from', 'join', 'into', 'update', 'merge']);

// Parole che non possono mai essere un nome di tabella o un alias.
const STOP = new Set([
  ...Object.keys(CLAUSE),
  'AND', 'OR', 'NOT', 'AS', 'IS', 'IN', 'LIKE', 'BETWEEN', 'EXISTS', 'ALL', 'ANY',
  'INNER', 'LEFT', 'RIGHT', 'FULL', 'OUTER', 'CROSS', 'NATURAL', 'BY', 'OF',
  'UNION', 'MINUS', 'INTERSECT', 'DISTINCT', 'UNIQUE', 'MATCHED', 'THEN', 'ELSE',
  'CASE', 'END', 'PIVOT', 'UNPIVOT', 'SAMPLE', 'PARTITION', 'SUBPARTITION',
  'FETCH', 'OFFSET', 'ROWS', 'ROW', 'ONLY', 'NEXT', 'FIRST', 'LAST', 'ADD',
  'MODIFY', 'DROP', 'RENAME', 'TABLE', 'LOCK', 'ALTER', 'CREATE', 'WAIT',
  'NOWAIT', 'MODE', 'EXCLUSIVE', 'SHARE', 'LOOP', 'BEGIN', 'DECLARE', 'FOR',
  'WITH', 'INSERT', 'GRANT', 'REVOKE', 'COMMIT', 'ROLLBACK', 'DESC', 'ASC',
  'NULLS', 'SIBLINGS', 'TRUNCATE', 'COMMENT', 'DEFAULT', 'CURRENT', 'NULL',
  'TO', 'VIEW', 'INDEX', 'SEQUENCE', 'SYNONYM', 'PACKAGE', 'PROCEDURE',
  'FUNCTION', 'TRIGGER', 'TYPE', 'CONSTRAINT', 'COLUMN', 'REPLACE',
]);

// ---- istruzioni che non sono DML ----------------------------------------
// Per CREATE/ALTER/DROP il completamento non segue le clausole ma la
// grammatica dell'oggetto: verbo, eventuali modificatori, tipo, nome.

const DDL_VERBS = new Set([
  'CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'COMMENT', 'RENAME', 'GRANT',
  'REVOKE', 'ANALYZE', 'PURGE', 'AUDIT', 'NOAUDIT', 'DESC', 'DESCRIBE',
]);

// Parole che stanno fra il verbo e il tipo (CREATE OR REPLACE FORCE VIEW …).
const DDL_MODIFIERS = new Set([
  'OR', 'REPLACE', 'GLOBAL', 'PRIVATE', 'TEMPORARY', 'MATERIALIZED', 'UNIQUE',
  'BITMAP', 'PUBLIC', 'FORCE', 'NOFORCE', 'EDITIONABLE', 'NONEDITIONABLE',
  'SHARING', 'IF', 'EXISTS', 'NOT',
]);

// Tipi di oggetto riconosciuti dopo il verbo. Il valore è la categoria usata
// dall'autocomplete per pescare i nomi esistenti (vedi completion.js).
export const DDL_OBJECTS = {
  TABLE: 'table',
  VIEW: 'table',
  INDEX: 'index',
  SEQUENCE: 'sequence',
  SYNONYM: 'synonym',
  PROCEDURE: 'routine',
  FUNCTION: 'routine',
  PACKAGE: 'routine',
  TRIGGER: 'trigger',
  TYPE: 'type',
  USER: 'schema',
  ROLE: 'role',
  DIRECTORY: 'directory',
  TABLESPACE: 'tablespace',
  COLUMN: 'column',
  DATABASE: 'database',
  CONTEXT: 'context',
  PROFILE: 'profile',
};

// Verbo iniziale → tipo di istruzione.
const KIND_BY_VERB = {
  SELECT: 'select',
  WITH: 'select',
  INSERT: 'insert',
  UPDATE: 'update',
  DELETE: 'delete',
  MERGE: 'merge',
  BEGIN: 'plsql',
  DECLARE: 'plsql',
};

// Parole che chiudono un valore: dopo di loro serve un operatore o una
// clausola, non un altro nome (`WHERE x IS NULL |` → AND, ORDER BY, …).
const VALUE_WORDS = new Set(['NULL', 'SYSDATE', 'SYSTIMESTAMP', 'USER', 'ROWNUM', 'LEVEL', 'CURRVAL', 'NEXTVAL']);

// Parole dopo le quali ricomincia un'istruzione dentro un blocco PL/SQL.
const BLOCK_START = new Set(['BEGIN', 'LOOP']);

// Parole che nel corpo di un DDL introducono un nome nuovo (dopo di loro non
// si propone nulla) o un tipo di dato.
const DEFINES = new Set(['ADD', 'MODIFY']);

// Testa di un'istruzione DDL: { verb, type, typeIdx, nameIdx }.
// `typeIdx` è dove sta (o dove andrebbe scritto) il tipo di oggetto.
function ddlHead(toks) {
  const first = toks[0];
  if (first?.k !== 'id' || !DDL_VERBS.has(first.v)) return null;
  let i = 1;
  if (first.v === 'COMMENT' && toks[i]?.v === 'ON') i++;
  while (toks[i]?.k === 'id' && DDL_MODIFIERS.has(toks[i].v)) i++;
  const t = toks[i];
  const type = t?.k === 'id' && DDL_OBJECTS[t.v] ? t.v : null;
  let nameIdx = i + 1;
  if (type && toks[nameIdx]?.k === 'id' && toks[nameIdx].v === 'BODY') nameIdx++;
  return { verb: first.v, type, typeIdx: i, nameIdx: type ? nameIdx : -1 };
}

// Parole chiave usate per capire se l'utente sta scrivendo in minuscolo.
const STYLE_WORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'JOIN', 'ON', 'GROUP', 'ORDER', 'BY', 'HAVING',
  'SET', 'VALUES', 'INTO', 'UPDATE', 'DELETE', 'INSERT', 'AND', 'OR', 'NOT',
  'AS', 'IS', 'NULL', 'LIKE', 'IN', 'EXISTS', 'CASE', 'WHEN', 'THEN', 'ELSE',
  'END', 'LEFT', 'INNER', 'OUTER', 'UNION', 'DISTINCT', 'WITH', 'CREATE',
  'BEGIN', 'DECLARE', 'LOOP', 'MERGE', 'USING', 'ALTER', 'DROP', 'TABLE',
  'ADD', 'MODIFY', 'VIEW', 'INDEX', 'SEQUENCE', 'SYNONYM', 'PROCEDURE',
  'FUNCTION', 'PACKAGE', 'TRIGGER', 'TRUNCATE', 'COMMENT', 'GRANT', 'TO',
  'REPLACE', 'CONSTRAINT', 'COLUMN', 'RETURN', 'RAISE', 'FOR', 'IF',
]);

// Indice della parentesi che chiude quella aperta in `open`.
function matchParen(toks, open) {
  let depth = 0;
  for (let i = open; i < toks.length; i++) {
    const t = toks[i];
    if (t.k !== 'punc') continue;
    if (t.v === '(') depth++;
    else if (t.v === ')' && --depth === 0) return i;
  }
  return toks.length;
}

// Legge l'eventuale alias dopo una tabella: `emp e`, `emp AS e`, `emp "E"`.
// `raw` conserva il testo esatto scritto dall'utente, che è quello da
// riutilizzare quando l'autocomplete genera SQL (es. condizioni di join).
function readAlias(toks, i) {
  const t = toks[i];
  if (!t) return { alias: null, raw: null, next: i };
  if (t.k === 'id' && t.v === 'AS') {
    const nx = toks[i + 1];
    if (nx && (nx.k === 'qid' || (nx.k === 'id' && !STOP.has(nx.v)))) {
      return { alias: nx.v, raw: nx.raw, next: i + 2 };
    }
    return { alias: null, raw: null, next: i + 1 };
  }
  if (t.k === 'qid') return { alias: t.v, raw: t.raw, next: i + 1 };
  if (t.k === 'id' && !STOP.has(t.v)) return { alias: t.v, raw: t.raw, next: i + 1 };
  return { alias: null, raw: null, next: i };
}

// Analizza `sql` con il cursore all'offset `pos`. Restituisce:
//   refs    tabelle citate: { kind, owner, name, alias, depth, from, to, cursor }
//   ctes    CTE del WITH:   { name, cols, body, refs }
//   clause  clausola al cursore ('select' | 'from' | 'join' | 'on' | …)
//   depth   profondità di parentesi al cursore
//   joinRef ultima tabella introdotta nello scope del cursore (target del JOIN)
//   lower   true se l'istruzione è scritta in minuscolo
export function analyze(sql, pos) {
  const toks = tokenize(sql);

  // Primo token che contiene il cursore o lo segue: lo stato registrato lì è
  // quello valido per il completamento in corso. Un nome che finisce sotto il
  // cursore è quello che si sta scrivendo; una parentesi o una stringa che
  // finiscono lì sono invece concluse, e il cursore viene dopo.
  let cursorTok = toks.length;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.e > pos || (t.e === pos && (t.k === 'id' || t.k === 'num'))) {
      cursorTok = i;
      break;
    }
  }

  const refs = [];
  const ctes = [];
  const clauseByDepth = [null];
  const lastRefByDepth = [null];
  const clauseHits = [];
  const ddl = ddlHead(toks);
  let depth = 0;
  let captured = null;
  let lowerWords = 0;
  let upperWords = 0;

  // In un DDL `ON` non è la clausola di un join ma introduce una tabella:
  // CREATE INDEX i ON emp (…), GRANT SELECT ON emp TO hr.
  const refAfterOn =
    !!ddl &&
    (ddl.verb === 'GRANT' ||
      ddl.verb === 'REVOKE' ||
      (ddl.verb === 'CREATE' && (ddl.type === 'INDEX' || ddl.type === 'TRIGGER')));

  const capture = () => {
    captured = {
      clause: clauseByDepth[depth] ?? null,
      depth,
      joinRef: lastRefByDepth[depth] ?? null,
      // clausole aperte a ogni livello di parentesi: dentro `VALUES (…)` la
      // clausola del livello 0 dice ancora che siamo in un elenco di valori.
      stack: clauseByDepth.slice(0, depth + 1),
    };
  };

  // Lista di tabelle dopo FROM/JOIN/…; restituisce l'indice del token dopo.
  const parseRefs = (start, comma) => {
    let i = start;
    for (;;) {
      const first = i;
      const t = toks[i];
      if (!t || t.k === 'punc' || t.k === 'str' || t.k === 'num' || t.k === 'bind') break;
      if (t.k === 'id' && STOP.has(t.v)) break;
      let owner = null;
      let name = t.v;
      let rawName = t.raw;
      i++;
      if (
        toks[i]?.k === 'punc' &&
        toks[i].v === '.' &&
        (toks[i + 1]?.k === 'id' || toks[i + 1]?.k === 'qid')
      ) {
        owner = name;
        name = toks[i + 1].v;
        rawName = toks[i + 1].raw;
        i += 2;
      }
      if (toks[i]?.k === 'punc' && toks[i].v === '@') {
        i++;
        if (toks[i]?.k === 'id') i++;
      }
      const { alias, raw: rawAlias, next } = readAlias(toks, i);
      const ref = {
        kind: 'table',
        owner,
        name,
        rawName,
        alias,
        rawAlias,
        depth,
        from: t.s,
        to: toks[Math.max(first, next - 1)].e,
        cursor: cursorTok >= first && cursorTok < Math.max(next, first + 1),
      };
      refs.push(ref);
      lastRefByDepth[depth] = ref;
      i = next;
      if (comma && toks[i]?.k === 'punc' && toks[i].v === ',') {
        i++;
        continue;
      }
      break;
    }
    return i;
  };

  // WITH: nomi e corpo delle CTE (i ref interni si assegnano a fine scansione).
  if (toks[0]?.k === 'id' && toks[0].v === 'WITH') {
    let i = 1;
    for (;;) {
      const t = toks[i];
      if (!t || (t.k !== 'id' && t.k !== 'qid') || (t.k === 'id' && STOP.has(t.v))) break;
      const name = t.v;
      i++;
      let cols = null;
      if (toks[i]?.k === 'punc' && toks[i].v === '(') {
        const close = matchParen(toks, i);
        if (toks[close + 1]?.v === 'AS') {
          cols = toks
            .slice(i + 1, close)
            .filter((x) => x.k === 'id' || x.k === 'qid')
            .map((x) => x.v);
          i = close + 1;
        }
      }
      if (toks[i]?.v !== 'AS') break;
      i++;
      if (toks[i]?.k !== 'punc' || toks[i].v !== '(') break;
      const close = matchParen(toks, i);
      ctes.push({
        name,
        cols,
        body: [toks[i].e, toks[close] ? toks[close].s : sql.length],
        refs: [],
      });
      i = close + 1;
      if (toks[i]?.k === 'punc' && toks[i].v === ',') {
        i++;
        continue;
      }
      break;
    }
  }

  // La tabella di ALTER/TRUNCATE/COMMENT ON TABLE vale come riferimento:
  // così `ALTER TABLE emp MODIFY …` sa proporre le colonne di EMP.
  if (ddl && ddl.type === 'TABLE' && ['ALTER', 'TRUNCATE', 'COMMENT'].includes(ddl.verb)) {
    parseRefs(ddl.nameIdx, false);
  }

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (captured === null && i >= cursorTok) capture();
    if (t.k === 'punc') {
      if (t.v === '(') {
        depth++;
        clauseByDepth[depth] = null;
        lastRefByDepth[depth] = null;
      } else if (t.v === ')' && depth > 0) {
        depth--;
      }
      continue;
    }
    if (t.k !== 'id') continue;
    if (STYLE_WORDS.has(t.v)) {
      if (t.raw === t.raw.toLowerCase()) lowerWords++;
      else if (t.raw === t.raw.toUpperCase()) upperWords++;
    }
    const clause = CLAUSE[t.v];
    if (clause) {
      clauseByDepth[depth] = clause;
      clauseHits.push({ clause, depth, before: i < cursorTok });
    }
    const comma = refAfterOn && t.v === 'ON' ? false : REF_CLAUSE[t.v];
    if (comma === undefined) continue;
    const nx = toks[i + 1];
    if (nx?.k === 'punc' && nx.v === '(') {
      // `FROM (SELECT …) x`: la subquery viene percorsa normalmente dal ciclo
      // (così il cursore al suo interno vede la clausola giusta); qui si legge
      // solo l'alias che segue la parentesi chiusa.
      if (t.v === 'FROM' || t.v === 'JOIN') {
        const close = matchParen(toks, i + 1);
        const { alias, raw: rawAlias } = readAlias(toks, close + 1);
        const ref = {
          kind: 'sub',
          owner: null,
          name: null,
          rawName: null,
          alias,
          rawAlias,
          depth,
          from: nx.s,
          to: toks[close] ? toks[close].e : sql.length,
          body: [nx.e, toks[close] ? toks[close].s : sql.length],
          cursor: false,
        };
        refs.push(ref);
        lastRefByDepth[depth] = ref;
      }
      continue;
    }
    i = parseRefs(i + 1, comma) - 1;
  }
  if (captured === null) capture();

  const inBody = (r, body, d) => r.from >= body[0] && r.to <= body[1] && r.depth === d;
  for (const cte of ctes) cte.refs = refs.filter((r) => inBody(r, cte.body, 1));
  for (const sub of refs) {
    if (sub.kind === 'sub') sub.refs = refs.filter((r) => inBody(r, sub.body, sub.depth + 1));
  }

  // ---- che cosa ci si aspetta nel punto del cursore ---------------------
  const ci = cursorTok;
  const at = (k) => (k >= 0 && k < toks.length ? toks[k] : null);
  const prev = at(ci - 1);
  const word = (t) => (t?.k === 'id' ? t.v : null);
  const isName = (t) => !!t && (t.k === 'qid' || (t.k === 'id' && !STOP.has(t.v) && !CLAUSE[t.v]));
  // Fine di un nome qualificato: `hr.emp` occupa tre token.
  const nameEnd = (n) => (at(n + 1)?.v === '.' && at(n + 2) ? n + 2 : n);

  const kind = ci === 0 ? null : ddl ? ddl.verb.toLowerCase() : KIND_BY_VERB[word(toks[0])] || null;
  const atStart =
    ci === 0 || (prev?.k === 'punc' && prev.v === ';') || BLOCK_START.has(word(prev));

  // Vero quando prima del cursore c'è un valore concluso (nome, numero,
  // stringa, parentesi chiusa): lì può iniziare solo un operatore o una nuova
  // clausola, quindi le parole chiave vanno in cima.
  const afterValue =
    !!prev &&
    (prev.k === 'qid' ||
      prev.k === 'num' ||
      prev.k === 'str' ||
      (prev.k === 'punc' && prev.v === ')') ||
      (prev.k === 'id' && (!STOP.has(prev.v) || VALUE_WORDS.has(prev.v))));

  // Prima istruzione DML dentro un DDL: `CREATE VIEW v AS SELECT …`, corpo di
  // una procedura. Da lì in poi comandano di nuovo le clausole.
  const dmlAt = ddl
    ? toks.findIndex((t, k) => k > ddl.typeIdx && t.k === 'id' && KIND_BY_VERB[t.v])
    : -1;

  let slot;
  let ddlType = ddl?.type || null;
  if (atStart) {
    slot = 'start';
  } else if (ddl && (dmlAt < 0 || ci <= dmlAt)) {
    slot = ddlSlot();
  } else {
    slot = TABLE_CLAUSES.has(captured.clause) ? 'table' : 'column';
  }

  const scopeRefs = refs.filter((r) => r.depth === captured.depth && !r.cursor);
  const clausesHere = clauseHits.filter((h) => h.depth === captured.depth);

  return {
    refs,
    ctes,
    clause: captured.clause,
    depth: captured.depth,
    joinRef: captured.joinRef,
    lower: lowerWords > upperWords,
    // false se non c'è nessuna parola chiave da cui dedurre lo stile
    styled: lowerWords + upperWords > 0,
    // ---- contesto esteso (vedi completion.js) ----
    kind,
    slot,
    ddlType,
    verb: ddl?.verb || null,
    afterValue,
    // ultima parola prima del cursore: decide i seguiti (IS → NULL, LEFT → JOIN)
    prevWord: word(prev),
    // inizio di istruzione dentro un blocco PL/SQL (dopo BEGIN, LOOP o ";")
    inBlock: slot === 'start' && !!prev,
    // tabella su cui agisce un INSERT/UPDATE/DELETE/MERGE
    target: refs.find((r) => r.depth === 0 && r.kind === 'table' && !r.cursor) || null,
    // 'cols' dentro l'elenco colonne di un INSERT, 'values' dentro i valori
    insertPart:
      kind !== 'insert' || captured.depth === 0
        ? null
        : captured.stack[0] === 'values'
          ? 'values'
          : 'cols',
    hasRefs: scopeRefs.length > 0,
    clausesBefore: clausesHere.filter((h) => h.before).map((h) => h.clause),
    clausesAfter: clausesHere.filter((h) => !h.before).map((h) => h.clause),
  };

  // Posto atteso dentro un'istruzione DDL, seguendo `verbo tipo nome corpo`.
  function ddlSlot() {
    // DESC non ha un tipo: dopo il verbo si nomina direttamente una tabella.
    if (ddl.verb === 'DESC' || ddl.verb === 'DESCRIBE' || ddl.verb === 'RENAME') {
      ddlType = 'TABLE';
      return 'ddlName';
    }
    if (ddl.verb === 'GRANT' || ddl.verb === 'REVOKE') return grantSlot();
    if (ci <= ddl.typeIdx) return 'ddlType';
    if (!ddl.type) return 'ddlBody';
    const end = nameEnd(ddl.nameIdx);
    if (ci >= ddl.nameIdx && ci <= end) return ddl.verb === 'CREATE' ? 'ddlNew' : 'ddlName';

    if (ddl.verb === 'ALTER' && ci === end + 1) return 'ddlAction';

    const p1 = at(ci - 1);
    const p2 = at(ci - 2);
    const kw = word(p1);
    // `CREATE INDEX i ON emp (…)`: dopo ON una tabella, dentro le parentesi
    // le sue colonne.
    if (refAfterOn && kw === 'ON') return 'table';
    if (refAfterOn && captured.depth > 0) return 'column';
    if (kw === 'MODIFY' || kw === 'COLUMN') return 'column';
    if (['DROP', 'RENAME', 'SET', 'ENABLE', 'DISABLE', 'ALTER'].includes(kw)) return 'ddlAction';
    // `(nome |` o `ADD nome |`: manca il tipo di dato
    const opensDef = (t) => DEFINES.has(word(t)) || (t?.k === 'punc' && (t.v === '(' || t.v === ','));
    if (isName(p1) && opensDef(p2)) return 'dataType';
    return 'ddlBody';
  }

  function grantSlot() {
    const idx = (v) => toks.findIndex((t) => t.k === 'id' && t.v === v);
    const to = Math.max(idx('TO'), idx('FROM'));
    if (to >= 0 && ci > to) return 'grantee';
    const on = idx('ON');
    return on >= 0 && ci > on ? 'table' : 'priv';
  }
}
