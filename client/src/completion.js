// Autocomplete SQL consapevole del contesto.
//
// In base alla clausola in cui si trova il cursore (vedi sqlContext.js) e ai
// metadati dello schema (vedi rotta /autocomplete) propone, in sezioni
// ordinate per pertinenza:
//   • colonne delle tabelle citate nell'istruzione, con tipo e alias
//   • tabelle/viste dello schema, sinonimi, sequenze, package e procedure
//   • altri schemi, caricati al volo quando si scrive "ALTRO_SCHEMA."
//   • condizioni di join ricavate dalle foreign key
//   • espansione di "*" / "alias.*" nell'elenco delle colonne
//   • funzioni built-in di Oracle e parole chiave del dialetto PL/SQL
//
// I nomi vengono inseriti in minuscolo se l'istruzione è scritta in minuscolo.

import { syntaxTree } from '@codemirror/language';
import { PLSQL, keywordCompletionSource } from '@codemirror/lang-sql';
import { statementAt } from './sqlSplit.js';
import { analyze } from './sqlContext.js';
import { FUNCTIONS, BUILTIN_PACKAGES, PSEUDO_COLUMNS } from './sqlFunctions.js';
import { useStore } from './store.js';

const SECTION_NAMES = {
  join: 'Join',
  col: 'Colonne',
  alias: 'Alias',
  tab: 'Tabelle e viste',
  obj: 'Sequenze e package',
  fn: 'Funzioni',
  schema: 'Schemi',
  kw: 'Parole chiave',
};

// Ordine delle sezioni nei due contesti principali.
const ORDER = {
  tables: ['join', 'tab', 'schema', 'obj', 'col', 'alias', 'fn', 'kw'],
  columns: ['join', 'col', 'alias', 'fn', 'tab', 'obj', 'schema', 'kw'],
};

function sectionsFor(kind) {
  const out = {};
  ORDER[kind].forEach((key, i) => {
    out[key] = { name: SECTION_NAMES[key], rank: i };
  });
  return out;
}

// La sorgente delle parole chiave di @codemirror/lang-sql, con la sezione
// giusta e nelle due varianti maiuscolo/minuscolo.
const kwSection = { name: SECTION_NAMES.kw, rank: 99 };
const kwOption = (label, type) => ({ label, type, boost: -1, section: kwSection });
const KEYWORDS = {
  upper: keywordCompletionSource(PLSQL, true, kwOption),
  lower: keywordCompletionSource(PLSQL, false, kwOption),
};

const needsQuote = (name) => !/^[A-Z][A-Z0-9_$#]*$/.test(name);

// Filtro dei candidati.
//
// CodeMirror, oltre ai prefissi, accetta anche le corrispondenze "sparse" —
// le lettere digitate sparpagliate a caso nel nome — che su uno schema con
// migliaia di oggetti riempiono la lista di proposte incoerenti: "sele"
// pescava DBMS_SCHEDULER e SPRINT_ELEMENTS_OLD. Teniamo solo i nomi che
// contengono il testo digitato oppure ne ricalcano le iniziali delle parole
// (MOV_RIGHE_CONTABILI per "mrc"), lasciando poi a CodeMirror il punteggio.
// Passa chi contiene il testo digitato come sottostringa ("moduli" →
// SEQ_ORE_MODULI), chi ne ricalca le iniziali delle parole ("mrc" →
// MOV_RIGHE_CONTABILI) e chi lo si può leggere dall'inizio del nome saltando
// di parola in parola ("wbsd" → WBS_DEFAULT_OWNER, "mypkg" → MY_PKG).
function matches(typed, label) {
  const needle = typed.toLowerCase();
  const low = label.toLowerCase();
  if (low.includes(needle)) return true;
  if (low[0] !== needle[0]) return false;
  const starts = wordStarts(label);
  return initials(needle, low, starts) || chunked(needle, low, starts);
}

// Tutte le lettere digitate cadono a inizio parola (qualcuna si può saltare).
function initials(needle, low, starts) {
  let i = 1;
  for (const w of starts) {
    if (low[w] === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return false;
}

// Il testo digitato spezzato in tronconi: il primo è un prefisso del nome di
// almeno due lettere, gli altri ripartono dall'inizio di una parola. Il minimo
// di due evita che una sola lettera in comune apra la porta a mezzo schema
// ("sele" non deve pescare SPRINT_ELEMENTS_OLD).
function chunked(needle, low, starts) {
  if (needle.length < 3 || low[1] !== needle[1]) return false;
  // Posizioni raggiunte dopo aver consumato le prime lettere: ognuna prosegue
  // la parola in corso o riparte dall'inizio di una parola seguente.
  let heads = [2];
  for (let i = 2; i < needle.length; i++) {
    const next = new Set();
    for (const p of heads) {
      if (low[p] === needle[i]) next.add(p + 1);
      for (const w of starts) if (w >= p && low[w] === needle[i]) next.add(w + 1);
    }
    if (!next.size) return false;
    heads = [...next];
  }
  return true;
}

// Inizio di parola: dopo un separatore o un passaggio da minuscola a maiuscola.
function wordStarts(label) {
  const out = [];
  for (let p = 1; p < label.length; p++) {
    const prev = label[p - 1];
    if (!/[A-Za-z0-9]/.test(prev) || (/[a-z]/.test(prev) && /[A-Z]/.test(label[p]))) out.push(p);
  }
  return out;
}

const filterBy = (typed, options) =>
  typed ? options.filter((o) => matches(typed, o.label)) : options;

// Avendo già filtrato sul testo digitato, la lista resta valida finché si
// aggiungono caratteri; se se ne cancellano va ricalcolata.
const validFor = (typed) => (text) =>
  /^[\w$#]*$/.test(text) && text.toLowerCase().startsWith(typed.toLowerCase());

// Nome da mostrare (e inserire) rispettando lo stile di chi scrive.
function ident(name, lower) {
  if (needsQuote(name)) return `"${name.replace(/"/g, '""')}"`;
  return lower ? name.toLowerCase() : name;
}

function nameOption(name, lower, extra) {
  const quoted = needsQuote(name);
  return {
    label: quoted ? name : lower ? name.toLowerCase() : name,
    apply: quoted ? `"${name.replace(/"/g, '""')}"` : undefined,
    ...extra,
  };
}

const TABLE_KIND = { T: 'tabella', V: 'vista', M: 'vista materializzata' };

function columnOption(col, lower, section, boost, source) {
  const [name, type, notNull, pk] = col;
  const bits = [source, type || 'colonna'];
  if (notNull) bits.push('NOT NULL');
  if (pk) bits.push('PK');
  return nameOption(name, lower, {
    type: pk ? 'constant' : 'property',
    detail: type || undefined,
    info: bits.filter(Boolean).join(' · '),
    section,
    boost,
  });
}

// Alias di comodo per una tabella in un JOIN generato: CUSTOMER_ORDER -> co.
function aliasFor(name, taken, lower) {
  const parts = name.split(/[_$#]/).filter(Boolean);
  let base = (parts.length > 1 ? parts.map((p) => p[0]).join('') : name.slice(0, 1)).toLowerCase();
  if (!/^[a-z]/.test(base)) base = 't';
  base = base.slice(0, 3);
  let alias = base;
  for (let i = 2; taken.has(alias.toUpperCase()); i++) alias = base + i;
  taken.add(alias.toUpperCase());
  return lower ? alias : alias.toUpperCase();
}

// Sostituisce un intervallo di testo: usato dall'espansione di "*".
const replaceWith = (from, to, text) => (view) => {
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
    userEvent: 'input.complete',
  });
};

export function sqlCompletionSource(connId) {
  return async (context) => {
    const node = syntaxTree(context.state).resolveInner(context.pos, -1);
    if (/String|Comment/.test(node.name)) return null;

    const state = () => useStore.getState().sqlMeta[connId] || {};
    const byOwner = () => state().byOwner || {};
    const current = () => byOwner()[state().owner] || null;
    const ensure = (owner) => useStore.getState().loadSchemaMeta(connId, owner);

    // ---- contesto ----------------------------------------------------------
    const doc = context.state.doc.toString();
    const stmt = statementAt(doc, context.pos);
    const base = stmt ? stmt.start : 0;
    const info = analyze(stmt ? stmt.text : doc, context.pos - base);
    const tableCtx = ['from', 'join', 'into', 'update', 'merge'].includes(info.clause);
    const sec = sectionsFor(tableCtx ? 'tables' : 'columns');

    const word = context.matchBefore(/[\w$#]*/);
    const typed = word ? word.text : '';
    // Maiuscolo o minuscolo: comanda quello che si sta digitando; se non c'è
    // ancora nulla vale lo stile dell'istruzione, e solo in mancanza di
    // entrambi si guarda il qualificatore (es. "emp." da solo).
    const caseOf = (text, fallback) => {
      if (/[A-Za-z]/.test(text)) return text === text.toLowerCase();
      if (info.styled) return info.lower;
      return fallback ? fallback === fallback.toLowerCase() : false;
    };
    const lower = caseOf(typed);

    // ---- risoluzione di tabelle e riferimenti ------------------------------

    // { owner, name, cols } oppure { pending: schema } se serve caricare
    // lo schema di destinazione di un sinonimo.
    const lookup = (owner, name) => {
      const all = byOwner();
      if (owner) {
        const t = all[owner]?.tables?.[name];
        if (t) return { owner, name, cols: t.c, kind: t.k };
        return !all[owner] && knownSchema(owner) ? { pending: owner } : null;
      }
      const cur = current();
      const t = cur?.tables?.[name];
      if (t) return { owner: state().owner, name, cols: t.c, kind: t.k };
      const syn = cur?.synonyms?.[name];
      if (syn) {
        const target = all[syn[0]]?.tables?.[syn[1]];
        if (target) return { owner: syn[0], name: syn[1], cols: target.c, kind: target.k };
        if (!all[syn[0]]) return { pending: syn[0] };
      }
      return null;
    };

    const knownSchema = (name) =>
      name === state().owner || (state().schemas || []).includes(name);

    const resolve = async (owner, name) => {
      let hit = lookup(owner, name);
      if (hit?.pending) {
        await ensure(hit.pending);
        hit = lookup(owner, name);
      }
      if (!hit && owner && !byOwner()[owner] && knownSchema(owner)) {
        await ensure(owner);
        hit = lookup(owner, name);
      }
      return hit?.cols ? hit : null;
    };

    // Colonne "viste" da un riferimento dell'istruzione (tabella, CTE o
    // subquery: per queste ultime si usa l'unione delle tabelle interne).
    const refColumns = async (ref, seen = new Set()) => {
      if (ref.kind === 'sub') {
        const out = [];
        for (const inner of ref.refs || []) out.push(...(await refColumns(inner, seen)));
        return out;
      }
      const cte = info.ctes.find((c) => c.name === ref.name && !ref.owner);
      if (cte && !seen.has(cte.name)) {
        seen.add(cte.name);
        if (cte.cols) return cte.cols.map((c) => [c, '', 0, 0]);
        const out = [];
        for (const inner of cte.refs) out.push(...(await refColumns(inner, seen)));
        return out;
      }
      const hit = await resolve(ref.owner, ref.name);
      return hit ? hit.cols : [];
    };

    // Testo con cui citare un riferimento: quello scritto dall'utente, così
    // l'SQL generato resta coerente con lo stile dell'istruzione.
    const refText = (ref) =>
      ref.rawAlias || ref.rawName || ref.alias || ref.name || 'subquery';
    const statementRefs = info.refs.filter((r) => !r.cursor && (r.name || r.alias));

    // ---- 1. espansione di "*" / "alias.*" ---------------------------------
    const star = context.matchBefore(/(?:("(?:[^"]|"")*"|[\w$#]+)\.)?\*/);
    if (star && doc[star.from - 1] !== '(') {
      const rawQualifier = star.text.length > 1 ? star.text.slice(0, -2) : null;
      const qualifier = rawQualifier && unquote(rawQualifier);
      let expansion = null;
      if (qualifier) {
        const ref = statementRefs.find((r) => (r.alias || r.name) === qualifier);
        const cols = ref ? await refColumns(ref) : (await resolve(null, qualifier))?.cols;
        if (cols?.length) {
          expansion = cols.map((c) => `${rawQualifier}.${ident(c[0], lower)}`);
        }
      } else if (statementRefs.length) {
        const many = statementRefs.length > 1;
        const parts = [];
        for (const ref of statementRefs) {
          const prefix = many ? `${refText(ref)}.` : '';
          for (const c of await refColumns(ref)) parts.push(prefix + ident(c[0], lower));
        }
        if (parts.length) expansion = parts;
      }
      if (expansion) {
        const text = expansion.join(', ');
        return {
          from: context.pos - 1,
          options: [
            {
              label: '*',
              displayLabel: `* → ${expansion.length} colonne`,
              detail: qualifier || 'tutte le tabelle',
              type: 'text',
              apply: replaceWith(star.from, context.pos, text),
            },
          ],
          validFor: false,
        };
      }
    }

    // ---- 2. qualificatori: "alias.", "schema.tabella.", "package." --------
    const qualified = context.matchBefore(/(?:("(?:[^"]|"")*"|[\w$#]+)\.){1,2}[\w$#]*/);
    if (qualified) {
      const parts = [];
      const raw = [];
      const re = /("(?:[^"]|"")*"|[\w$#]+)\./g;
      let m;
      let end = 0;
      while ((m = re.exec(qualified.text))) {
        parts.push(unquote(m[1]));
        raw.push(m[1]);
        end = m.index + m[0].length;
      }
      const prefix = qualified.text.slice(end);
      const qLower = caseOf(prefix, raw[raw.length - 1]);
      const from = context.pos - prefix.length;
      const found = await qualifiedOptions(parts, qLower);
      const options = found && filterBy(prefix, found);
      if (options?.length) return { from, options, validFor: validFor(prefix) };
      return null;

      async function qualifiedOptions(path, low) {
        // Boost decrescente: a parità di punteggio resta l'ordine delle colonne.
        const cols = (hit, source) =>
          hit.map((c, i) => columnOption(c, low, sec.col, -i / 1000, source));

        if (path.length === 1) {
          const key = path[0];
          const ref = statementRefs.find((r) => (r.alias || r.name) === key);
          if (ref) {
            const list = await refColumns(ref);
            if (list.length) return cols(list, refText(ref));
          }
          const table = await resolve(null, key);
          if (table) return cols(table.cols, `${table.owner}.${table.name}`);

          const cur = current();
          if (cur?.members?.[key]) return memberOptions(cur.members[key], low, key);
          if (BUILTIN_PACKAGES[key]) return memberOptions(BUILTIN_PACKAGES[key], low, key);
          if (cur?.sequences?.includes(key)) {
            return ['NEXTVAL', 'CURRVAL'].map((v) =>
              nameOption(v, low, { type: 'property', detail: 'sequenza', section: sec.col })
            );
          }
          if (knownSchema(key)) {
            const meta = byOwner()[key] || (await ensure(key));
            return schemaObjectOptions(meta, low);
          }
          return null;
        }

        // schema.tabella. → colonne, schema.package. → membri
        const [owner, name] = path.slice(-2);
        const table = await resolve(owner, name);
        if (table) return cols(table.cols, `${owner}.${name}`);
        const members = byOwner()[owner]?.members?.[name];
        if (members) return memberOptions(members, low, `${owner}.${name}`);
        return null;
      }
    }

    // ---- 3. condizioni di join dalle foreign key --------------------------
    const joins = joinOptions();
    if (!typed && joins.length) return { from: context.pos, options: joins, validFor: false };

    // ---- 4. proposta generica --------------------------------------------
    if (!word || (word.from === word.to && !context.explicit)) return null;
    const options = joins.slice();
    const cur = current();

    const seenCols = new Set();
    for (const ref of statementRefs) {
      const list = await refColumns(ref);
      const source = refText(ref);
      const boost = ref.depth === info.depth ? 2 : 1;
      for (const c of list) {
        if (seenCols.has(c[0])) continue;
        seenCols.add(c[0]);
        options.push(columnOption(c, lower, sec.col, boost, source));
      }
      if (ref.alias) {
        options.push(
          nameOption(ref.alias, lower, {
            type: 'variable',
            detail: ref.name || 'subquery',
            section: sec.alias,
          })
        );
      }
    }

    for (const cte of info.ctes) {
      options.push(
        nameOption(cte.name, lower, { type: 'class', detail: 'CTE', section: sec.tab })
      );
    }

    if (cur) {
      for (const [name, t] of Object.entries(cur.tables || {})) {
        options.push(
          nameOption(name, lower, {
            type: t.k === 'T' ? 'class' : 'interface',
            detail: TABLE_KIND[t.k],
            section: sec.tab,
          })
        );
      }
      for (const [name, target] of Object.entries(cur.synonyms || {})) {
        options.push(
          nameOption(name, lower, {
            type: 'class',
            detail: `sinonimo di ${target[0]}.${target[1]}`,
            section: sec.tab,
          })
        );
      }
      for (const name of cur.sequences || []) {
        options.push(
          nameOption(name, lower, { type: 'constant', detail: 'sequenza', section: sec.obj })
        );
      }
      for (const [name, kind] of cur.routines || []) {
        options.push(
          nameOption(name, lower, {
            type: kind === 'K' ? 'namespace' : 'function',
            detail: kind === 'K' ? 'package' : kind === 'F' ? 'funzione' : 'procedura',
            section: sec.obj,
          })
        );
      }
    }

    for (const name of state().schemas || []) {
      if (name === state().owner) continue;
      options.push(
        nameOption(name, lower, { type: 'namespace', detail: 'schema', section: sec.schema })
      );
    }

    if (!tableCtx) {
      for (const fn of FUNCTIONS) options.push(functionOption(fn, lower, sec.fn));
      for (const name of Object.keys(BUILTIN_PACKAGES)) {
        options.push(
          nameOption(name, lower, { type: 'namespace', detail: 'package', section: sec.fn })
        );
      }
      for (const name of PSEUDO_COLUMNS) {
        options.push(
          nameOption(name, lower, { type: 'constant', detail: 'pseudo-colonna', section: sec.fn })
        );
      }
    }

    const keywords = (lower ? KEYWORDS.lower : KEYWORDS.upper)(context);
    if (keywords && keywords.from === word.from) options.push(...keywords.options);

    return { from: word.from, options: filterBy(typed, options), validFor: validFor(typed) };

    // ---- helper che dipendono dal contesto -------------------------------

    function memberOptions(members, low, pkg) {
      return members.map((sig) => {
        const open = sig.indexOf('(');
        const name = open < 0 ? sig : sig.slice(0, open);
        return nameOption(name, low, {
          type: 'method',
          detail: open < 0 ? pkg : sig.slice(open),
          section: sec.fn,
          apply: open > 0 ? callApply(name, low, true) : undefined,
        });
      });
    }

    function schemaObjectOptions(meta, low) {
      if (!meta) return null;
      const out = [];
      for (const [name, t] of Object.entries(meta.tables || {})) {
        out.push(
          nameOption(name, low, {
            type: t.k === 'T' ? 'class' : 'interface',
            detail: TABLE_KIND[t.k],
            section: sec.tab,
          })
        );
      }
      for (const [name, kind] of meta.routines || []) {
        out.push(
          nameOption(name, low, {
            type: kind === 'K' ? 'namespace' : 'function',
            detail: kind === 'K' ? 'package' : 'programma',
            section: sec.obj,
          })
        );
      }
      for (const name of meta.sequences || []) {
        out.push(nameOption(name, low, { type: 'constant', detail: 'sequenza', section: sec.obj }));
      }
      return out;
    }

    function functionOption(fn, low, section) {
      const label = low ? fn.name.toLowerCase() : fn.name;
      return {
        label,
        type: 'function',
        detail: fn.sig.slice(fn.name.length) || undefined,
        section,
        apply: fn.paren ? callApply(fn.name, low, fn.args, fn.sig) : undefined,
      };
    }

    // Inserisce `NOME()` lasciando il cursore fra le parentesi se servono
    // argomenti; `COUNT(*)` e simili si inseriscono già completi.
    function callApply(name, low, args, sig) {
      const text = low ? name.toLowerCase() : name;
      if (sig && /\(\*\)$/.test(sig)) return `${text}(*)`;
      return (view, completion, from, to) => {
        view.dispatch({
          changes: { from, to, insert: `${text}()` },
          selection: { anchor: from + text.length + (args ? 1 : 2) },
          userEvent: 'input.complete',
        });
      };
    }

    // Condizioni di join fra la tabella appena inserita (o quella che si sta
    // scrivendo dopo JOIN) e le altre dell'istruzione, ricavate dalle FK.
    function joinOptions() {
      if (info.clause !== 'on' && info.clause !== 'join') return [];
      const scope = statementRefs.filter((r) => r.depth === info.depth && r.kind === 'table');
      if (!scope.length) return [];
      const out = [];

      if (info.clause === 'on') {
        const target = info.joinRef;
        if (!target || target.kind !== 'table') return out;
        for (const other of scope) {
          if (other === target) continue;
          for (const rel of relatedTo(other)) {
            if (!sameTable(rel.owner, rel.name, target)) continue;
            out.push({
              label: condition(refText(target), refText(other), rel.pairs),
              type: 'text',
              detail: 'chiave esterna',
              section: sec.join,
              boost: 90,
            });
          }
        }
        return out;
      }

      // clause === 'join': propone tabella + alias + ON già scritto
      const taken = new Set(info.refs.map((r) => (r.alias || r.name || '').toUpperCase()));
      const seen = new Set();
      for (const other of scope) {
        for (const rel of relatedTo(other)) {
          const key = `${rel.owner}.${rel.name}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const alias = aliasFor(rel.name, taken, lower);
          const shown =
            rel.owner === state().owner
              ? ident(rel.name, lower)
              : `${ident(rel.owner, lower)}.${ident(rel.name, lower)}`;
          const text = `${shown} ${alias} ON ${condition(alias, refText(other), rel.pairs)}`;
          out.push(
            nameOption(rel.name, lower, {
              type: 'class',
              detail: `join con ${refText(other)}`,
              info: text,
              section: sec.join,
              boost: 90,
              apply: text,
            })
          );
        }
      }
      return out;
    }

    // `left` e `right` sono già testo pronto da inserire (alias o nome tabella).
    function condition(left, right, pairs) {
      return pairs
        .map(([a, b]) => `${left}.${ident(a, lower)} = ${right}.${ident(b, lower)}`)
        .join(' AND ');
    }

    function sameTable(owner, name, ref) {
      return name === ref.name && owner === (ref.owner || state().owner);
    }

    // Tabelle legate a `ref` da una foreign key (in entrambi i versi), con le
    // coppie di colonne [colonna della tabella trovata, colonna di `ref`].
    function relatedTo(ref) {
      const out = [];
      for (const [owner, meta] of Object.entries(byOwner())) {
        for (const [table, cols, rOwner, rTable, rCols] of meta.fks || []) {
          if (sameTable(rOwner, rTable, ref)) {
            out.push({ owner, name: table, pairs: cols.map((c, i) => [c, rCols[i]]) });
          } else if (sameTable(owner, table, ref)) {
            out.push({ owner: rOwner, name: rTable, pairs: rCols.map((c, i) => [c, cols[i]]) });
          }
        }
      }
      return out;
    }
  };
}

function unquote(text) {
  return text[0] === '"' ? text.slice(1, -1).replace(/""/g, '"') : text.toUpperCase();
}
