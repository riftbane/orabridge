// Analisi best-effort di un'istruzione SQL/PL-SQL per l'autocomplete.
// Non è un parser completo: tokenizza il testo, ricava le tabelle citate con i
// loro alias (FROM/JOIN/UPDATE/INTO/USING, liste con virgole, CTE e subquery)
// e capisce in quale clausola si trova il cursore, così i suggerimenti possono
// essere ordinati per contesto. Nessuna dipendenza da CodeMirror: è logica
// pura, testabile con `npm test`.

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
]);

// Parole chiave usate per capire se l'utente sta scrivendo in minuscolo.
const STYLE_WORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'JOIN', 'ON', 'GROUP', 'ORDER', 'BY', 'HAVING',
  'SET', 'VALUES', 'INTO', 'UPDATE', 'DELETE', 'INSERT', 'AND', 'OR', 'NOT',
  'AS', 'IS', 'NULL', 'LIKE', 'IN', 'EXISTS', 'CASE', 'WHEN', 'THEN', 'ELSE',
  'END', 'LEFT', 'INNER', 'OUTER', 'UNION', 'DISTINCT', 'WITH', 'CREATE',
  'BEGIN', 'DECLARE', 'LOOP', 'MERGE', 'USING',
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
  // quello valido per il completamento in corso.
  let cursorTok = toks.length;
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].e >= pos) {
      cursorTok = i;
      break;
    }
  }

  const refs = [];
  const ctes = [];
  const clauseByDepth = [null];
  const lastRefByDepth = [null];
  let depth = 0;
  let captured = null;
  let lowerWords = 0;
  let upperWords = 0;

  const capture = () => {
    captured = {
      clause: clauseByDepth[depth] ?? null,
      depth,
      joinRef: lastRefByDepth[depth] ?? null,
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
    if (clause) clauseByDepth[depth] = clause;
    const comma = REF_CLAUSE[t.v];
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

  return {
    refs,
    ctes,
    clause: captured.clause,
    depth: captured.depth,
    joinRef: captured.joinRef,
    lower: lowerWords > upperWords,
    // false se non c'è nessuna parola chiave da cui dedurre lo stile
    styled: lowerWords + upperWords > 0,
  };
}
