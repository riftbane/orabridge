// Variabili del foglio SQL. Ce ne sono di due specie, con regole diverse:
//
// - le variabili di **bind** (`:nome`, `:1`) restano nel testo e viaggiano al
//   server come parametri: Oracle le vede, quindi valgono solo dove il
//   database legge codice — non dentro le stringhe né nei commenti;
// - le variabili di **sostituzione** (`&nome`, `&&nome`) sono roba di
//   SQL*Plus: vengono espanse nel testo *prima* che l'istruzione parta, e
//   proprio per questo valgono anche dentro le stringhe (`WHERE citta =
//   '&citta'` è l'uso più comune) mentre nei commenti no.
//
// Per i bind riusiamo `tokenize` dell'autocomplete, che salta già stringhe e
// commenti; per le sostituzioni serve per forza una scansione a parte, perché
// deve fermarsi solo ai commenti. Modulo puro: nessun DOM, nessun CodeMirror.

import { tokenize } from './sqlContext.js';

// Nomi che nel corpo di un trigger sono correlazioni, non variabili da
// chiedere all'utente: `:new.stipendio` è codice valido e non ha alcun valore
// da inserire in una finestra.
const PSEUDO_BIND = new Set(['NEW', 'OLD', 'PARENT']);

// Un nome di sostituzione è un identificatore Oracle non quotato, oppure tutte
// cifre: `&1`, `&2` sono i parametri posizionali degli script SQL*Plus.
const SUB_NAME = /[A-Za-z][A-Za-z0-9_$#]*|[0-9]+/y;

// Le variabili di bind presenti nell'istruzione, in ordine di comparsa e senza
// ripetizioni. In Oracle il nome del bind è insensibile alle maiuscole
// (`:id` e `:ID` sono lo stesso parametro), quindi si deduplica ignorando il
// caso ma si conserva la grafia della prima comparsa: è quella che l'utente
// rivede nella finestra.
export function findBinds(sql) {
  const text = typeof sql === 'string' ? sql : '';
  const toks = tokenize(text);
  const seen = new Set();
  const out = [];
  const add = (name) => {
    const key = name.toUpperCase();
    if (seen.has(key) || PSEUDO_BIND.has(key)) return;
    seen.add(key);
    out.push({ name, kind: 'bind' });
  };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.k === 'bind') {
      // `a::b` fa emettere al tokenizzatore un bind `b` (il primo due punti
      // resta punteggiatura e il secondo apre il bind). Il doppio due punti
      // non è sintassi Oracle, ma capita di incollarlo da altri dialetti:
      // meglio non chiedere un valore per quello che è solo un cast.
      if (text[t.s - 1] === ':') continue;
      add(t.v);
      continue;
    }
    // I bind numerici non passano dal tokenizzatore, che dopo i due punti
    // pretende una lettera: `:1` diventa punteggiatura più numero e va
    // ricomposto qui. Il numero dev'essere attaccato ai due punti (`: 1` non
    // è un bind) e fatto di sole cifre (`:1.5` è un due punti seguito da un
    // decimale, non il bind «1.5»).
    if (t.k === 'punc' && t.v === ':' && text[t.s - 1] !== ':') {
      const next = toks[i + 1];
      if (next && next.k === 'num' && next.s === t.e && /^[0-9]+$/.test(next.v)) {
        add(next.v);
        i++;
      }
    }
  }
  return out;
}

// Percorre il testo saltando i soli commenti (`--` fino a fine riga e
// `/* … */`) e richiama `cb` su ogni `&` che apre davvero una sostituzione,
// dicendo dove comincia e dove finisce il tratto da rimpiazzare. Le stringhe
// non si saltano di proposito: vedi la nota in cima al file.
function scanSubs(text, cb) {
  const n = text.length;
  let i = 0;
  while (i < n) {
    const ch = text[i];
    if (ch === '-' && text[i + 1] === '-') {
      const nl = text.indexOf('\n', i);
      i = nl < 0 ? n : nl + 1;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (ch !== '&') {
      i++;
      continue;
    }
    const persistent = text[i + 1] === '&';
    const from = i + (persistent ? 2 : 1);
    SUB_NAME.lastIndex = from;
    const m = SUB_NAME.exec(text);
    // Una e commerciale seguita da tutt'altro (`'Rossi & figli'`) è solo un
    // carattere come un altro.
    if (!m) {
      i++;
      continue;
    }
    let end = from + m[0].length;
    // In SQL*Plus il punto chiude il nome quando segue altro testo
    // (`&schema.tabella`) e viene mangiato dalla sostituzione: va incluso nel
    // tratto da rimpiazzare, altrimenti resterebbe appiccicato al valore.
    if (text[end] === '.') end++;
    cb({ name: m[0], persistent, start: i, end });
    i = end;
  }
}

// Le variabili di sostituzione dell'istruzione, in ordine di comparsa e senza
// ripetizioni (anche qui il nome è insensibile alle maiuscole). `persistent`
// segnala il doppio `&&`: SQL*Plus lo usa per «chiedi una volta sola e
// ricorda», quindi basta una comparsa doppia perché il valore vada tenuto.
export function findSubstitutions(sql) {
  const text = typeof sql === 'string' ? sql : '';
  const byName = new Map();
  const out = [];
  scanSubs(text, ({ name, persistent }) => {
    const key = name.toUpperCase();
    const known = byName.get(key);
    if (known) {
      if (persistent) known.persistent = true;
      return;
    }
    const v = { name, kind: 'sub', persistent };
    byName.set(key, v);
    out.push(v);
  });
  return out;
}

// Espande `&nome` e `&&nome` con i valori indicati. È una sostituzione
// testuale pura, come in SQL*Plus: il valore entra esattamente com'è scritto,
// apici compresi, perché sono proprio gli apici (o la loro assenza) a decidere
// se ne esce un letterale o un pezzo di sintassi.
export function applySubstitutions(sql, values) {
  const text = typeof sql === 'string' ? sql : '';
  if (!values) return text;
  // Il confronto ignora le maiuscole perché `&citta` e `&CITTA` sono la stessa
  // variabile, mentre la finestra salva i valori con una grafia sola.
  const byName = new Map();
  for (const key of Object.keys(values)) byName.set(key.toUpperCase(), values[key]);
  let out = '';
  let last = 0;
  scanSubs(text, ({ name, start, end }) => {
    const val = byName.get(name.toUpperCase());
    // Valore mancante: si lascia il testo com'è. Meglio l'errore di Oracle
    // sulla variabile non risolta che un `undefined` infilato nell'istruzione.
    if (val === undefined || val === null) return;
    out += text.slice(last, start) + String(val);
    last = end;
  });
  return out + text.slice(last);
}
