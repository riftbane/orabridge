// Autocomplete SQL consapevole del contesto.
//
// L'idea è che in ogni punto di un'istruzione hanno senso poche cose: dopo
// CREATE un tipo di oggetto, dentro un FROM una tabella, dopo WHERE una
// colonna. `analyze` (sqlContext.js) dice qual è il «posto» sotto il cursore e
// da lì si decide **quali sezioni costruire**: quelle che non c'entrano non
// vengono nemmeno riempite, così l'elenco resta corto e pertinente.
//
// In ordine di pertinenza si propongono:
//   • modelli d'istruzione (SELECT … FROM …) che chiedono prima la tabella:
//     senza sapere la tabella non si potrebbero proporre le colonne
//   • scheletri costruiti sui metadati (l'elenco colonne di un INSERT, il SET
//     di un UPDATE, il WHERE sulla chiave primaria)
//   • condizioni di join ricavate dalle foreign key
//   • colonne delle tabelle citate nell'istruzione, con tipo e alias
//   • tabelle/viste dello schema, sinonimi, sequenze, package e procedure
//   • altri schemi, caricati al volo quando si scrive "ALTRO_SCHEMA."
//   • espansione di "*" / "alias.*" nell'elenco delle colonne
//   • funzioni built-in di Oracle e parole chiave del dialetto PL/SQL
//
// I nomi vengono inseriti in minuscolo se l'istruzione è scritta in minuscolo.

import { syntaxTree } from '@codemirror/language';
import { PLSQL, keywordCompletionSource } from '@codemirror/lang-sql';
import { snippet } from '@codemirror/autocomplete';
import { statementAt } from './sqlSplit.js';
import { analyze } from './sqlContext.js';
import { FUNCTIONS, BUILTIN_PACKAGES, PSEUDO_COLUMNS } from './sqlFunctions.js';
import {
  STATEMENTS,
  DATA_TYPES,
  keywordsFor,
  hasStrictFollow,
  missingRequired,
} from './sqlTemplates.js';
import { useStore } from './store.js';

const SECTION_NAMES = {
  tpl: 'Struttura',
  join: 'Join',
  from: 'Da quale tabella?',
  col: 'Colonne',
  alias: 'Alias',
  tab: 'Tabelle e viste',
  obj: 'Sequenze e package',
  fn: 'Funzioni',
  type: 'Tipi di dato',
  schema: 'Schemi',
  kw: 'Parole chiave',
  more: 'Altre parole chiave',
};

// Che cosa si propone in ogni posto, dalla sezione più pertinente in giù. Le
// sezioni che non compaiono non vengono costruite: è così che dopo CREATE
// spariscono funzioni, colonne e nomi di tabella.
const LAYOUT = {
  start: ['tpl', 'kw', 'obj'],
  ddlType: ['kw'],
  ddlName: ['tab', 'obj', 'schema'],
  ddlNew: [],
  ddlAction: ['kw', 'col'],
  ddlBody: ['kw', 'type', 'col'],
  dataType: ['type'],
  priv: ['kw'],
  grantee: ['schema', 'kw'],
  table: ['join', 'tpl', 'tab', 'obj', 'schema', 'kw'],
  column: ['join', 'from', 'col', 'alias', 'tpl', 'fn', 'kw', 'tab', 'obj', 'schema', 'more'],
};

// Posti in cui il suggerimento è così mirato da valere anche senza aver
// digitato nulla (dopo "CREATE ", "DROP TABLE ", "ALTER TABLE emp ").
const EAGER = new Set(['ddlType', 'ddlName', 'ddlAction', 'dataType']);

// Clausola in cui, appena finito di nominare la tabella, lo scheletro
// costruito sui metadati è la proposta principale.
const SKELETON_AT = { insert: 'into', update: 'update', delete: 'from' };

// Sezioni da costruire per il posto in cui si trova il cursore.
// Due aggiustamenti sul modello fisso: dopo un valore concluso può cominciare
// solo una clausola o un operatore (le parole chiave passano davanti a tutto),
// e la sezione «Da quale tabella?» compare solo dove serve davvero, cioè in un
// SELECT che non ha ancora un FROM.
function layoutFor(info, bare, openExpr) {
  let base = LAYOUT[info.slot] || LAYOUT.column;
  // Dopo un LEFT o un IS può arrivare solo una manciata di parole, e finché
  // manca una clausola obbligatoria (il FROM di un SELECT) la proposta è una
  // sola: in questi casi le parole chiave vengono prima di tutto.
  const strict = hasStrictFollow(info.prevWord) || (info.afterValue && missingRequired(info));

  // Senza niente di digitato si propone solo ciò che è mirato: una condizione
  // di join, uno scheletro sui metadati, le colonne delle tabelle citate dove
  // può cominciare un'espressione (dopo «SET » o «WHERE » sono esattamente
  // quel che serve). Sfogliare mezzo schema a ogni spazio battuto non
  // aiuterebbe nessuno.
  if (bare && !EAGER.has(info.slot)) {
    const bareCols = openExpr && !info.afterValue;
    base = base.filter(
      (k) => k === 'join' || k === 'tpl' || (k === 'col' && bareCols) || (k === 'kw' && strict)
    );
  } else {
    const needsTable =
      info.slot === 'column' && !info.hasRefs && info.depth === 0 && info.kind === 'select';
    // Senza un FROM la prima cosa da fare è dire da dove leggere: le tabelle
    // si propongono lì, non anche come nomi da citare (senza FROM non si
    // possono citare).
    if (needsTable) base = ['from', ...base.filter((k) => k !== 'from' && k !== 'tab')];
    else base = base.filter((k) => k !== 'from');
    if (info.slot === 'start' && !info.inBlock) base = base.filter((k) => k !== 'obj');
  }
  // Appena nominata la tabella di un INSERT/UPDATE/DELETE, lo scheletro con le
  // sue colonne viene prima di ogni parola chiave.
  if (info.afterValue && info.target && SKELETON_AT[info.kind] === info.clause) {
    return ['tpl', ...base.filter((k) => k !== 'tpl')];
  }
  if ((!info.afterValue && !strict) || !base.includes('kw')) return base;
  return ['kw', ...base.filter((k) => k !== 'kw')];
}

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
// Sulle parole chiave il criterio si stringe: sono parole singole, che si
// cercano dall'inizio. Senza questo, "en" pescava `length`, `current_date` e
// `bfilename`, cioè mezza pagina di rumore sotto le proposte buone.
function matches(typed, label, strict) {
  if (!typed) return true;
  const needle = typed.toLowerCase();
  const low = label.toLowerCase();
  const at = low.indexOf(needle);
  if (at === 0) return true;
  const starts = wordStarts(label);
  if (at > 0 && (!strict || starts.includes(at))) return true;
  if (low[0] !== needle[0]) return false;
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

// Sezioni di parole chiave e funzioni, dove il testo digitato deve cadere a
// inizio di parola (`char` trova TO_CHAR, `en` non trova LENGTH). Sui nomi
// degli oggetti resta il criterio largo: chi cerca "moduli" si aspetta di
// trovare SEQ_ORE_MODULI.
const STRICT_MATCH = new Set(['kw', 'more', 'fn']);

// Raccoglie i suggerimenti già filtrati e assegna a ognuno la sua sezione.
// Costruire l'opzione solo per chi passa il filtro tiene il lavoro
// proporzionale ai risultati, non alle dimensioni dello schema.
function makeBag(typed, order) {
  const sections = {};
  order.forEach((key, i) => {
    sections[key] = { name: SECTION_NAMES[key], rank: i };
  });
  const options = [];
  return {
    options,
    has: (key) => key in sections,
    // Da chiamare prima di costruire un'opzione costosa: il filtro non
    // distingue maiuscole e minuscole, quindi si può interrogare sul nome
    // grezzo senza prima adattarlo allo stile di chi scrive.
    wants: (key, name) => key in sections && matches(typed, name, STRICT_MATCH.has(key)),
    add(key, label, extra) {
      const section = sections[key];
      if (!section || !matches(typed, label, STRICT_MATCH.has(key))) return;
      options.push({ label, section, ...extra });
    },
  };
}

// Nome da mostrare (e inserire) rispettando lo stile di chi scrive.
function ident(name, lower) {
  if (needsQuote(name)) return `"${name.replace(/"/g, '""')}"`;
  return lower ? name.toLowerCase() : name;
}

const TABLE_KIND = { T: 'tabella', V: 'vista', M: 'vista materializzata' };

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

// Il modello senza i marcatori dei campi, per il riquadro di anteprima.
const readable = (tpl) => tpl.replace(/\$\{\d+:([^}]*)\}/g, '$1');

// L'anteprima è multiriga: senza un nodo con white-space:pre l'HTML la
// appiattirebbe su una riga sola.
function preview(text) {
  return () => {
    const el = document.createElement('div');
    el.style.whiteSpace = 'pre';
    el.textContent = text;
    return el;
  };
}

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
    const cased = (text) => (lower ? text.toLowerCase() : text);

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
      } else {
        expansion = await allColumns();
      }
      if (expansion?.length) {
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
      const options = found && found.filter((o) => matches(prefix, o.label));
      if (options?.length) return { from, options, validFor: false };
      return null;

      async function qualifiedOptions(path, low) {
        const sec = { name: SECTION_NAMES.col, rank: 0 };
        // Boost decrescente: a parità di punteggio resta l'ordine delle colonne.
        const cols = (hit, source) =>
          hit.map((c, i) => ({ ...columnOption(c, low, -i / 1000, source), section: sec }));

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
          if (cur?.members?.[key]) return memberOptions(cur.members[key], low, key, sec);
          if (BUILTIN_PACKAGES[key]) return memberOptions(BUILTIN_PACKAGES[key], low, key, sec);
          if (cur?.sequences?.includes(key)) {
            return ['NEXTVAL', 'CURRVAL'].map((v) => ({
              label: low ? v.toLowerCase() : v,
              type: 'property',
              detail: 'sequenza',
              section: sec,
            }));
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
        if (members) return memberOptions(members, low, `${owner}.${name}`, sec);
        return null;
      }
    }

    // ---- 3. che cosa ha senso proporre qui --------------------------------
    if (!word) return null;
    const bare = !typed && !context.explicit;
    // Dopo un "*" non comincia nessuna espressione: `count(*|` non deve
    // aprire l'elenco delle colonne.
    const openExpr = !/\*\s*$/.test(doc.slice(0, context.pos));
    const bag = makeBag(typed, layoutFor(info, bare, openExpr));
    const cur = current();

    const joins = joinOptions();
    const skeletons = await metaTemplates();
    for (const opt of joins) bag.add('join', opt.label, opt);
    for (const opt of skeletons) bag.add('tpl', opt.label, opt);

    // Modelli d'istruzione: a inizio istruzione quelli che sono istruzioni,
    // dentro un'espressione quelli che sono espressioni (CASE, EXISTS), in
    // coda a un SELECT quelli che si attaccano in fondo (FETCH FIRST).
    if (bag.has('tpl') && !bare) {
      // Dove va una tabella il modello di coda si propone solo dopo che il
      // nome è concluso: `FROM e|` sta cercando una tabella, non un FETCH.
      const scopes = {
        start: ['stmt'],
        column: ['expr', 'tail'],
        table: info.afterValue ? ['tail'] : [],
      }[info.slot];
      STATEMENTS.forEach((t, i) => {
        if (!scopes?.includes(t.scope)) return;
        const text = cased(t.tpl);
        bag.add('tpl', cased(t.label), {
          displayLabel: cased(t.display),
          type: 'text',
          detail: 'modello',
          info: preview(readable(text)),
          apply: snippet(text),
          boost: 50 - i,
        });
      });
    }

    // Colonne delle tabelle citate nell'istruzione.
    if (bag.has('col')) {
      const seen = new Set();
      // Nel SET di un UPDATE la colonna arriva già con l'uguale.
      const suffix = info.clause === 'set' && info.kind === 'update' ? ' = ' : '';
      for (const ref of statementRefs) {
        const list = await refColumns(ref);
        const source = refText(ref);
        const boost = ref.depth === info.depth ? 2 : 1;
        for (const c of list) {
          if (seen.has(c[0])) continue;
          seen.add(c[0]);
          const opt = columnOption(c, lower, boost, source);
          if (suffix) opt.apply = ident(c[0], lower) + suffix;
          bag.add('col', opt.label, opt);
        }
        if (ref.alias) {
          bag.add('alias', cased(ref.alias), {
            type: 'variable',
            detail: ref.name || 'subquery',
          });
        }
      }
    }

    // Tabelle, viste, sinonimi e CTE.
    if (bag.has('tab')) {
      // In un DROP/ALTER si nominano solo oggetti del tipo dichiarato.
      const wanted = info.slot === 'ddlName' ? info.ddlType : null;
      const kinds = KIND_FILTER[wanted] || (wanted ? new Set() : null);
      if (!wanted) {
        for (const cte of info.ctes) addName('tab', cte.name, { type: 'class', detail: 'CTE' });
      }
      for (const [name, t] of Object.entries(cur?.tables || {})) {
        if ((kinds && !kinds.has(t.k)) || !bag.wants('tab', name)) continue;
        addName('tab', name, {
          type: t.k === 'T' ? 'class' : 'interface',
          detail: TABLE_KIND[t.k],
          info: tableInfo(t),
        });
      }
      if (!wanted || wanted === 'SYNONYM') {
        for (const [name, target] of Object.entries(cur?.synonyms || {})) {
          if (!bag.wants('tab', name)) continue;
          addName('tab', name, {
            type: 'class',
            detail: `sinonimo di ${target[0]}.${target[1]}`,
          });
        }
      }
    }

    // Tabelle da cui pescare le colonne quando l'istruzione non ne cita
    // ancora nessuna: la scelta aggiunge il FROM e riporta il cursore qui.
    if (bag.has('from')) {
      for (const cte of info.ctes) {
        addName('from', cte.name, {
          type: 'class',
          detail: `aggiunge ${cased('FROM')} ${ident(cte.name, lower)}`,
          apply: addFrom(cte.name),
        });
      }
      for (const [name, t] of Object.entries(cur?.tables || {})) {
        if (!bag.wants('from', name)) continue;
        addName('from', name, {
          type: t.k === 'T' ? 'class' : 'interface',
          detail: `aggiunge ${cased('FROM')} ${ident(name, lower)}`,
          info: tableInfo(t),
          apply: addFrom(name),
        });
      }
      for (const name of Object.keys(cur?.synonyms || {})) {
        if (!bag.wants('from', name)) continue;
        addName('from', name, {
          type: 'class',
          detail: `aggiunge ${cased('FROM')} ${ident(name, lower)}`,
          apply: addFrom(name),
        });
      }
    }

    // Sequenze, package e programmi.
    if (bag.has('obj')) {
      const wanted = info.slot === 'ddlName' ? info.ddlType : null;
      if (!wanted || wanted === 'SEQUENCE') {
        for (const name of cur?.sequences || []) {
          addName('obj', name, { type: 'constant', detail: 'sequenza' });
        }
      }
      if (!wanted || ROUTINE_KIND[wanted]) {
        for (const [name, kind] of cur?.routines || []) {
          if (wanted && ROUTINE_KIND[wanted] !== kind) continue;
          addName('obj', name, {
            type: kind === 'K' ? 'namespace' : 'function',
            detail: kind === 'K' ? 'package' : kind === 'F' ? 'funzione' : 'procedura',
          });
        }
      }
      // A inizio istruzione dentro un blocco PL/SQL non c'è la sezione delle
      // funzioni: i package built-in (DBMS_OUTPUT e simili) vanno proposti qui.
      if (info.slot === 'start' && !bag.has('fn')) {
        for (const name of Object.keys(BUILTIN_PACKAGES)) {
          bag.add('obj', cased(name), { type: 'namespace', detail: 'package' });
        }
      }
    }

    if (bag.has('schema')) {
      for (const name of state().schemas || []) {
        if (name === state().owner) continue;
        addName('schema', name, { type: 'namespace', detail: 'schema' });
      }
    }

    if (bag.has('fn')) {
      for (const fn of FUNCTIONS) {
        bag.add('fn', cased(fn.name), {
          type: 'function',
          detail: fn.sig.slice(fn.name.length) || undefined,
          apply: fn.paren ? callApply(fn.name, lower, fn.args, fn.sig) : undefined,
        });
      }
      for (const name of Object.keys(BUILTIN_PACKAGES)) {
        bag.add('fn', cased(name), { type: 'namespace', detail: 'package' });
      }
      for (const name of PSEUDO_COLUMNS) {
        bag.add('fn', cased(name), { type: 'constant', detail: 'pseudo-colonna' });
      }
    }

    if (bag.has('type')) {
      DATA_TYPES.forEach((t, i) => {
        bag.add('type', cased(t), { type: 'type', detail: 'tipo di dato', boost: 20 - i });
      });
    }

    // Parole chiave pertinenti al punto in cui si è, e solo quelle: l'elenco
    // completo del dialetto resta in fondo, nella sezione "Altre".
    const keywords = keywordsFor(info);
    keywords.forEach((kw, i) => {
      bag.add('kw', cased(kw), { type: 'keyword', boost: 20 - i });
    });

    if (bag.has('more')) {
      const source = lower ? KEYWORDS.lower : KEYWORDS.upper;
      const res = source(context);
      const already = new Set(keywords.map((k) => cased(k)));
      if (res && res.from === word.from) {
        for (const opt of res.options) {
          if (!already.has(opt.label)) bag.add('more', opt.label, { type: 'keyword' });
        }
      }
    }

    return bag.options.length ? { from: word.from, options: bag.options, validFor: false } : null;

    // ---- helper che dipendono dal contesto -------------------------------

    function addName(key, name, extra) {
      if (!bag.has(key)) return;
      const quoted = needsQuote(name);
      bag.add(key, quoted ? name : lower ? name.toLowerCase() : name, {
        apply: quoted ? `"${name.replace(/"/g, '""')}"` : undefined,
        ...extra,
      });
    }

    // Le prime colonne, per capire al volo se è la tabella giusta. Il testo si
    // costruisce solo quando il riquadro viene mostrato: su uno schema con
    // migliaia di tabelle farlo per ognuna costerebbe più di tutto il resto.
    function tableInfo(t) {
      if (!t.c?.length) return undefined;
      return () => {
        const head = t.c.slice(0, 12).map((c) => `${c[0]}  ${c[1] || ''}`.trim());
        if (t.c.length > head.length) head.push(`… altre ${t.c.length - head.length}`);
        return preview(head.join('\n'))();
      };
    }

    function columnOption(col, low, boost, source) {
      const [name, type, notNull, pk] = col;
      const bits = [source, type || 'colonna'];
      if (notNull) bits.push('NOT NULL');
      if (pk) bits.push('PK');
      const quoted = needsQuote(name);
      return {
        label: quoted ? name : low ? name.toLowerCase() : name,
        apply: quoted ? `"${name.replace(/"/g, '""')}"` : undefined,
        type: pk ? 'constant' : 'property',
        detail: type || undefined,
        info: bits.filter(Boolean).join(' · '),
        boost,
      };
    }

    function memberOptions(members, low, pkg, section) {
      return members.map((sig) => {
        const open = sig.indexOf('(');
        const name = open < 0 ? sig : sig.slice(0, open);
        return {
          label: low ? name.toLowerCase() : name,
          type: 'method',
          detail: open < 0 ? pkg : sig.slice(open),
          section,
          apply: open > 0 ? callApply(name, low, true) : undefined,
        };
      });
    }

    function schemaObjectOptions(meta, low) {
      if (!meta) return null;
      const out = [];
      const push = (name, extra) =>
        out.push({
          label: low ? name.toLowerCase() : name,
          section: { name: SECTION_NAMES.tab, rank: 0 },
          ...extra,
        });
      for (const [name, t] of Object.entries(meta.tables || {})) {
        push(name, {
          type: t.k === 'T' ? 'class' : 'interface',
          detail: TABLE_KIND[t.k],
          info: tableInfo(t),
        });
      }
      for (const [name, kind] of meta.routines || []) {
        push(name, {
          type: kind === 'K' ? 'namespace' : 'function',
          detail: kind === 'K' ? 'package' : 'programma',
        });
      }
      for (const name of meta.sequences || []) {
        push(name, { type: 'constant', detail: 'sequenza' });
      }
      return out;
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

    // Elenco esplicito delle colonne di tutte le tabelle dell'istruzione,
    // qualificate con l'alias se le tabelle sono più d'una.
    async function allColumns() {
      const refs = statementRefs.filter((r) => r.depth === info.depth);
      if (!refs.length) return null;
      const many = refs.length > 1;
      const out = [];
      for (const ref of refs) {
        const prefix = many ? `${refText(ref)}.` : '';
        for (const c of await refColumns(ref)) out.push(prefix + ident(c[0], lower));
      }
      return out.length ? out : null;
    }

    // Aggiunge `FROM tabella` in fondo all'istruzione lasciando il cursore
    // dov'era: da lì l'autocomplete conosce le colonne e può proporle.
    function addFrom(name) {
      return (view, completion, from, to) => {
        const stop = stmt ? base + stmt.text.replace(/\s*;?\s*$/, '').length : doc.length;
        const at = Math.max(stop, to);
        const pad = at === to || !/\s/.test(doc[at - 1] || '') ? ' ' : '';
        view.dispatch({
          changes: [
            { from, to, insert: '' },
            { from: at, to: at, insert: `${pad}${cased('FROM')} ${ident(name, lower)}` },
          ],
          selection: { anchor: from },
          userEvent: 'input.complete',
        });
      };
    }

    // Scheletri costruiti sui metadati della tabella su cui si sta agendo:
    // l'elenco colonne di un INSERT, il SET di un UPDATE, il WHERE sulla
    // chiave primaria di un DELETE. È quello che evita di riscrivere a mano
    // decine di nomi di colonna.
    async function metaTemplates() {
      if (!bag.has('tpl') || !info.afterValue) return [];
      if (SKELETON_AT[info.kind] !== info.clause) return [];
      const ref = info.target;
      if (!ref || ref.kind !== 'table') return [];
      const hit = await resolve(ref.owner, ref.name);
      const cols = hit?.cols;
      if (!cols?.length) return [];

      const names = cols.slice(0, 60).map((c) => ident(c[0], lower));
      const keys = cols.filter((c) => c[3]).map((c) => ident(c[0], lower));
      const key = keys[0] || names[0];
      const first = names.find((n) => !keys.includes(n)) || names[0];
      const tpl = (label, display, text) => ({
        label: cased(label),
        displayLabel: cased(display),
        type: 'text',
        detail: `su ${refText(ref)}`,
        info: preview(readable(cased(text))),
        apply: snippet(cased(text)),
        boost: 60,
      });

      if (info.kind === 'insert') {
        const fields = names.map((n, i) => `\${${i + 1}:${n}}`).join(', ');
        return [
          tpl(
            'VALUES',
            `(${names.length} colonne) VALUES (…)`,
            `(${names.join(', ')})\nVALUES (${fields})`
          ),
        ];
      }
      if (info.kind === 'update') {
        return [
          tpl(
            'SET',
            'SET … WHERE …',
            `SET \${1:${first}} = \${2:valore}\n WHERE \${3:${key}} = \${4:valore}`
          ),
        ];
      }
      if (info.kind === 'delete') {
        return [tpl('WHERE', 'WHERE …', `WHERE \${1:${key}} = \${2:valore}`)];
      }
      return [];
    }

    // Condizioni di join fra la tabella appena inserita (o quella che si sta
    // scrivendo dopo JOIN) e le altre dell'istruzione, ricavate dalle FK.
    function joinOptions() {
      if (!bag.has('join')) return [];
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
          const text = `${shown} ${alias} ${cased('ON')} ${condition(alias, refText(other), rel.pairs)}`;
          out.push({
            label: lower ? rel.name.toLowerCase() : rel.name,
            type: 'class',
            detail: `join con ${refText(other)}`,
            info: text,
            boost: 90,
            apply: text,
          });
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

// Tipo di oggetto DDL → lettera con cui è registrato in `routines`.
const ROUTINE_KIND = { PROCEDURE: 'P', FUNCTION: 'F', PACKAGE: 'K' };

// Tipo di oggetto DDL → generi di tabella da proporre (T abella, V ista,
// vista M aterializzata).
const KIND_FILTER = {
  TABLE: new Set(['T']),
  VIEW: new Set(['V', 'M']),
  COLUMN: new Set(['T', 'V', 'M']),
};

// La sorgente delle parole chiave di @codemirror/lang-sql, nelle due varianti
// maiuscolo/minuscolo: serve solo per la sezione di riserva in fondo.
const kwOption = (label, type) => ({ label, type });
const KEYWORDS = {
  upper: keywordCompletionSource(PLSQL, true, kwOption),
  lower: keywordCompletionSource(PLSQL, false, kwOption),
};

function unquote(text) {
  return text[0] === '"' ? text.slice(1, -1).replace(/""/g, '"') : text.toUpperCase();
}
