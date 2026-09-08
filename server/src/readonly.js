// Riconoscimento delle istruzioni che non modificano nulla, usato dalle
// connessioni aperte «in sola lettura»: su quelle, tutto il resto viene
// rifiutato prima ancora di arrivare al database. Nel dubbio si risponde
// «scrive»: un falso allarme costa un messaggio d'errore, un falso via libera
// costa una modifica indesiderata in produzione.

import { stripSql } from './ai/sqlGuard.js';

// Le parentesi aperte iniziali si saltano insieme agli spazi: `(SELECT …)
// UNION ALL (SELECT …)` è una forma legittima e comune, e senza questo la
// prima parola non si troverebbe affatto — l'istruzione finirebbe fra le
// scritture. Nessuna scrittura può cominciare con una parentesi, quindi non
// si apre nessuna falla.
const FIRST_WORD = /^[\s(]*(\w+)/;

// Un SELECT … FOR UPDATE non cambia i dati ma blocca le righe e apre una
// transazione: su una connessione in sola lettura non ha senso permetterlo.
const FOR_UPDATE = /\bFOR\s+UPDATE\b/i;

// In una CTE conta l'operazione finale: `WITH x AS (…) SELECT` legge, mentre
// `WITH x AS (…) INSERT|UPDATE|DELETE|MERGE` scrive. Le parole dentro un
// identificatore (`deleted_flag`) non contano grazie ai confini di parola.
const WRITE_TAIL = /\b(INSERT|UPDATE|DELETE|MERGE)\b/i;

// L'unico ALTER ammesso: le impostazioni NLS della sessione cambiano il modo
// in cui i dati si leggono (formato di data, separatore decimale), non i dati.
const ALTER_SESSION_NLS = /^\s*ALTER\s+SESSION\s+SET\s+NLS_\w+/i;

function firstKeyword(clean) {
  return (clean.match(FIRST_WORD)?.[1] || '').toUpperCase();
}

export function isReadOnlyStatement(sql) {
  // `stripSql` toglie commenti (`--`, `/* */`) e letterali di stringa: quello
  // che resta si può guardare con espressioni regolari senza che una parola
  // dentro un commento o fra apici cambi il verdetto.
  const clean = stripSql(String(sql ?? ''))
    .trim()
    .replace(/;\s*$/, '');
  if (!clean) return false;

  const first = firstKeyword(clean);
  // Un blocco PL/SQL può fare qualsiasi cosa, anche in SQL dinamico dentro una
  // stringa: qui vale sempre come scrittura.
  if (first === 'BEGIN' || first === 'DECLARE') return false;
  // Più istruzioni insieme: basta che una scriva, e non sappiamo quale sia.
  if (clean.includes(';')) return false;

  switch (first) {
    case 'SELECT':
      return !FOR_UPDATE.test(clean);
    case 'WITH':
      return !WRITE_TAIL.test(clean) && !FOR_UPDATE.test(clean);
    case 'EXPLAIN':
    case 'DESC':
    case 'DESCRIBE':
    case 'SET':
      return true;
    case 'ALTER':
      return ALTER_SESSION_NLS.test(clean);
    default:
      return false;
  }
}

// `entry.readOnly` lo mette `pools.connect()` dalla configurazione della
// connessione; se manca (connessioni aperte prima, o percorsi che non passano
// di lì) non si blocca niente.
export function assertWritable(entry, sql) {
  if (!entry?.readOnly) return;
  if (isReadOnlyStatement(sql)) return;
  const first = firstKeyword(stripSql(String(sql ?? '')).trim());
  const err = new Error(
    `Connessione in sola lettura: ${first ? `«${first}»` : "l'istruzione"} non è consentita. ` +
      'Sono ammesse solo le interrogazioni (SELECT, WITH … SELECT, EXPLAIN PLAN, DESCRIBE) ' +
      'e le impostazioni NLS di sessione.'
  );
  err.readOnly = true;
  throw err;
}
