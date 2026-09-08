// Azioni dell'editor SQL che non hanno a che fare con il testo digitato:
// ripiegatura del codice (folding), cambio di maiuscole/minuscole e
// riconoscimento dell'oggetto sotto una posizione (per «vai alla definizione»
// e per il describe rapido).
//
// Tutto ciò che *decide* — che cosa si piega, quale identificatore sta sotto
// il cursore, a quale oggetto corrisponde nei metadati — è logica pura,
// provata da `client/test/editorActions.test.js` senza CodeMirror né DOM. Dei
// comandi resta qui solo l'adattamento allo stato dell'editor.
import { EditorSelection } from '@codemirror/state';
import { splitStatements } from './sqlSplit.js';
import { tokenize } from './sqlContext.js';

// ---------------------------------------------------------------- folding --

// Oltre questa dimensione la ripiegatura si spegne: il gutter richiede il
// calcolo a ogni modifica del testo e riscandire megabyte a ogni tasto si
// sentirebbe. Un foglio scritto a mano non arriva mai a tanto.
const MAX_FOLD_CHARS = 1000000;

// Parole che «consumano» un END in PL/SQL: servono a contare l'annidamento.
const OPENERS = new Set(['BEGIN', 'CASE', 'IF', 'LOOP']);
// Parole che seguono END completandolo (END IF, END LOOP, END CASE): vanno
// saltate, altrimenti verrebbero contate come una nuova apertura.
const END_TAILS = new Set(['IF', 'LOOP', 'CASE']);

// L'analisi del documento (token, commenti a blocco, istruzioni) è la parte
// cara: si conserva quella degli ultimi testi visti, perché il gutter chiama
// `foldRangeAt` una volta per ogni riga visibile ma sempre sullo stesso testo.
// Poche voci bastano: gli editor aperti insieme sono due o tre.
const analyses = new Map();
const MAX_ANALYSES = 4;

function analysis(text) {
  const cached = analyses.get(text);
  if (cached) return cached;
  const data = {
    tokens: tokenize(text),
    comments: blockComments(text),
    statements: splitStatements(text),
  };
  analyses.set(text, data);
  if (analyses.size > MAX_ANALYSES) analyses.delete(analyses.keys().next().value);
  return data;
}

// Commenti /* … */ del documento: `to` è l'inizio di `*/`, così ripiegando
// resta visibile la chiusura. `tokenize` li scarta, qui invece servono.
function blockComments(text) {
  const out = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const ch = text[i];
    if (ch === '-' && text[i + 1] === '-') {
      const nl = text.indexOf('\n', i);
      i = nl < 0 ? n : nl + 1;
    } else if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      out.push({ from: i, to: end < 0 ? n : end });
      i = end < 0 ? n : end + 2;
    } else if (ch === "'" || ch === '"') {
      i++;
      while (i < n) {
        if (text[i] === ch) {
          if (text[i + 1] === ch) i += 2;
          else {
            i++;
            break;
          }
        } else i++;
      }
    } else i++;
  }
  return out;
}

// Primo token che comincia da `pos` in poi (ricerca binaria: la scansione
// lineare si pagherebbe una volta per riga visibile).
function firstTokenFrom(tokens, pos) {
  let lo = 0;
  let hi = tokens.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tokens[mid].s < pos) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Posizione dell'END che chiude il BEGIN in `i`, oppure null se il blocco è
// aperto. È un conteggio approssimato — non un parser — ma basta per decidere
// dove finisce un blocco: CASE, IF e LOOP contano come aperture perché ognuno
// vuole il suo END, e le code `END IF`/`END LOOP`/`END CASE` vengono saltate.
function matchingEnd(tokens, i) {
  let depth = 0;
  for (let j = i; j < tokens.length; j++) {
    const tok = tokens[j];
    if (tok.k !== 'id') continue;
    if (tok.v === 'END') {
      const next = tokens[j + 1];
      if (next && next.k === 'id' && END_TAILS.has(next.v)) j++;
      if (--depth <= 0) return tok.s;
    } else if (OPENERS.has(tok.v)) depth++;
  }
  return null;
}

// Che cosa si può ripiegare a partire dalla riga [lineFrom, lineTo)?
// Restituisce { from, to } in offset assoluti oppure null. `from` è sempre la
// fine della riga, così la prima riga resta leggibile e il resto diventa «…».
//
// L'ordine conta: il caso più stretto vince. Un commento a blocco è tale anche
// dentro un'istruzione; un BEGIN dà un intervallo più preciso dell'istruzione
// che lo contiene; l'istruzione è l'ultima rete (e copre da sola sia il
// `CREATE OR REPLACE …` — `splitStatements` sa che finisce sulla riga con «/»
// — sia una SELECT distribuita su più righe).
export function foldRangeAt(text, lineFrom, lineTo) {
  if (typeof text !== 'string' || lineTo <= lineFrom || text.length > MAX_FOLD_CHARS) return null;
  const { tokens, comments, statements } = analysis(text);

  for (const c of comments) {
    if (c.from >= lineTo) break;
    if (c.from >= lineFrom) {
      if (c.to > lineTo) return { from: lineTo, to: c.to };
      break;
    }
  }

  for (let i = firstTokenFrom(tokens, lineFrom); i < tokens.length && tokens[i].s < lineTo; i++) {
    if (tokens[i].k !== 'id' || tokens[i].v !== 'BEGIN') continue;
    const end = matchingEnd(tokens, i);
    // Fino all'inizio di END, non oltre: piegato si legge «BEGIN … END;».
    if (end != null && end > lineTo) return { from: lineTo, to: end };
    break;
  }

  for (const s of statements) {
    if (s.start >= lineTo) break;
    if (s.start >= lineFrom) {
      // `end` comprende gli spazi fino al terminatore: piegarli farebbe
      // sparire anche la riga vuota che separa dall'istruzione successiva.
      const to = s.end - (s.text.length - s.text.trimEnd().length);
      if (to > lineTo) return { from: lineTo, to };
      break;
    }
  }
  return null;
}

// `doc.toString()` su un foglio lungo non è gratis e il gutter chiama il
// servizio una volta per riga visibile: il testo si converte una volta sola
// per ogni versione del documento (l'oggetto Text è immutabile, quindi la
// chiave della WeakMap è affidabile).
const docTexts = new WeakMap();

function docText(doc) {
  let text = docTexts.get(doc);
  if (text === undefined) {
    text = doc.toString();
    docTexts.set(doc, text);
  }
  return text;
}

// Da registrare con `foldService.of(...)`: il PL/SQL di @codemirror/lang-sql
// non porta informazioni di ripiegatura nell'albero sintattico, quindi la
// calcoliamo dal testo.
export function sqlFoldService(state, lineStart, lineEnd) {
  return foldRangeAt(docText(state.doc), lineStart, lineEnd);
}

// ------------------------------------------------- maiuscole e minuscole --

// Applica `transform` a ogni selezione; dove la selezione è vuota lavora sulla
// parola sotto il cursore (comodo per correggere una parola chiave scritta
// male senza doverla selezionare).
function caseCommand(transform) {
  return (view) => {
    if (view.state.readOnly) return false;
    const spec = view.state.changeByRange((range) => {
      let { from, to } = range;
      if (from === to) {
        const line = view.state.doc.lineAt(from);
        const word = wordAt(line.text, from - line.from);
        if (!word) return { range };
        // Un identificatore fra doppi apici è sensibile alle maiuscole e le
        // virgolette fanno parte dello span: cambiarlo qui riscriverebbe il
        // nome di una colonna esistente, virgolette comprese. Vale anche
        // quando è qualificato (`t."Nome"`), dove la virgoletta non è il
        // primo carattere dello span.
        if (word.word.includes('"')) return { range };
        from = line.from + word.from;
        to = line.from + word.to;
      }
      const src = view.state.doc.sliceString(from, to);
      const out = transform(src);
      if (out === src) return { range };
      return {
        changes: { from, to, insert: out },
        // Il cursore resta dov'era (il testo cambia di forma, non di
        // lunghezza): si continua a scrivere senza rincorrerlo.
        range: range.empty
          ? EditorSelection.cursor(Math.min(range.head, from + out.length))
          : EditorSelection.range(from, from + out.length),
      };
    });
    if (spec.changes.empty) return false;
    view.dispatch(spec, { userEvent: 'input.case', scrollIntoView: true });
    return true;
  };
}

export const upperCaseSelection = caseCommand((s) => s.toUpperCase());
export const lowerCaseSelection = caseCommand((s) => s.toLowerCase());
// Iniziale maiuscola parola per parola: su una selezione lunga è l'unica resa
// utile (su una parola sola coincide con quello che ci si aspetta).
export const capitalizeSelection = caseCommand((s) =>
  s.replace(/[A-Za-z][A-Za-z0-9_$#]*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
);

// ------------------------------------------- identificatore sotto il cursore --

const IDENT = /[A-Za-z0-9_$#]/;

// Identificatore quotato che contiene `pos` ("Mia Tabella"): si cerca solo
// nella riga, così una virgoletta spaiata non trascina tutto il documento.
function quotedAt(text, pos) {
  const start = text.lastIndexOf('\n', pos - 1) + 1;
  let eol = text.indexOf('\n', pos);
  if (eol < 0) eol = text.length;
  let i = start;
  while (i < eol) {
    if (text[i] === '"') {
      const close = text.indexOf('"', i + 1);
      if (close < 0 || close >= eol) return null;
      if (pos >= i && pos <= close) return { from: i, to: close + 1 };
      i = close + 1;
    } else i++;
  }
  return null;
}

function identBefore(text, end) {
  if (text[end - 1] === '"') {
    const open = text.lastIndexOf('"', end - 2);
    return open < 0 ? null : { from: open, to: end };
  }
  let i = end;
  while (i > 0 && IDENT.test(text[i - 1])) i--;
  return i < end && !/[0-9]/.test(text[i]) ? { from: i, to: end } : null;
}

function identAfter(text, start) {
  if (text[start] === '"') {
    const close = text.indexOf('"', start + 1);
    return close < 0 ? null : { from: start, to: close + 1 };
  }
  let i = start;
  while (i < text.length && IDENT.test(text[i])) i++;
  return i > start && !/[0-9]/.test(text[start]) ? { from: start, to: i } : null;
}

// Nome normalizzato come lo conosce il dizionario Oracle: senza virgolette si
// va in maiuscolo, con le virgolette si rispetta quello che c'è scritto.
const normalize = (raw) => (raw[0] === '"' ? raw.slice(1, -1) : raw.toUpperCase());

// Identificatore sotto `pos`, con `SCHEMA.OGGETTO` trattato come una cosa
// sola: cliccando sullo schema o sull'oggetto si ottiene lo stesso risultato.
//   { word, from, to, name, qualified }
// `word` è il testo così com'è scritto (serve nei messaggi), `from`/`to` lo
// delimitano, `name` è il nome normalizzato dell'oggetto e `qualified` c'è
// solo quando il nome è qualificato. Fuori da un identificatore: null.
export function wordAt(text, pos) {
  if (typeof text !== 'string' || !text) return null;
  const p = Math.max(0, Math.min(pos, text.length));

  const quoted = quotedAt(text, p);
  let from;
  let to;
  if (quoted) {
    from = quoted.from;
    to = quoted.to;
  } else {
    from = p;
    to = p;
    while (from > 0 && IDENT.test(text[from - 1])) from--;
    while (to < text.length && IDENT.test(text[to])) to++;
    // Un numero non è un identificatore: `123` o `1.5` non vanno risolti.
    if (from === to || /[0-9]/.test(text[from])) return null;
  }

  const left = text[from - 1] === '.' ? identBefore(text, from - 1) : null;
  const right = !left && text[to] === '.' ? identAfter(text, to + 1) : null;
  let qualified = null;
  if (left) {
    qualified = { owner: normalize(text.slice(left.from, left.to)), name: normalize(text.slice(from, to)) };
    from = left.from;
  } else if (right) {
    qualified = { owner: normalize(text.slice(from, to)), name: normalize(text.slice(right.from, right.to)) };
    to = right.to;
  }

  const word = text.slice(from, to);
  return {
    word,
    from,
    to,
    name: qualified ? qualified.name : normalize(word),
    qualified,
  };
}

// ------------------------------------------ risoluzione nei metadati ------

const TABLE_TYPE = { T: 'TABLE', V: 'VIEW', M: 'MATERIALIZED VIEW' };
const ROUTINE_TYPE = { P: 'PROCEDURE', F: 'FUNCTION', K: 'PACKAGE' };
// Tipi con delle colonne da mostrare nel describe rapido.
export const DESCRIBABLE = new Set(['TABLE', 'VIEW', 'MATERIALIZED VIEW']);

function inSchema(meta, owner, name) {
  const schema = meta?.byOwner?.[owner];
  if (!schema) return null;
  const table = schema.tables?.[name];
  if (table) return { owner, name, type: TABLE_TYPE[table.k] || 'TABLE' };
  const routine = (schema.routines || []).find((r) => r[0] === name);
  if (routine) return { owner, name, type: ROUTINE_TYPE[routine[1]] || 'PROCEDURE' };
  if ((schema.sequences || []).includes(name)) return { owner, name, type: 'SEQUENCE' };
  return null;
}

// Cerca l'oggetto nei metadati dell'autocomplete (`sqlMeta[connId]`, vedi
// store.js e completion.js). Restituisce { owner, name, type }, oppure
// { pending: schema } quando lo schema che servirebbe non è ancora stato
// caricato (chi chiama fa `loadSchemaMeta` e riprova), oppure null.
export function resolveObject(meta, ref) {
  if (!ref?.name) return null;
  const home = meta?.owner || '';
  const known = (owner) => owner === home || (meta?.schemas || []).includes(owner);

  if (ref.owner) {
    const hit = inSchema(meta, ref.owner, ref.name);
    if (hit) return hit;
    if (!meta?.byOwner?.[ref.owner] && known(ref.owner)) return { pending: ref.owner };
    // `PACCHETTO.PROCEDURA`: il qualificatore non è uno schema ma un package
    // (o comunque un oggetto) dello schema corrente — si apre quello.
    const pkg = inSchema(meta, home, ref.owner);
    if (pkg) return pkg;
    return null;
  }

  const hit = inSchema(meta, home, ref.name);
  if (hit) return hit;

  const target = meta?.byOwner?.[home]?.synonyms?.[ref.name];
  if (target) {
    const real = inSchema(meta, target[0], target[1]);
    if (real) return real;
    if (!meta?.byOwner?.[target[0]] && known(target[0])) return { pending: target[0] };
    // Il sinonimo punta a uno schema che non possiamo leggere: si apre almeno
    // il sinonimo, che la sua scheda ce l'ha.
    return { owner: home, name: ref.name, type: 'SYNONYM' };
  }
  return null;
}
