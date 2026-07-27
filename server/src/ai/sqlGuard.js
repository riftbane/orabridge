// Classificazione delle istruzioni SQL nei tre livelli di permesso usati
// dall'assistente: `read` (sola lettura), `write` (modifica dati o struttura)
// e `danger` (cancellazioni e DROP, che si concedono a parte).

const DANGER = /\b(DELETE|DROP|TRUNCATE|PURGE)\b/i;

// Rimuove commenti e (se richiesto) stringhe: quello che resta si può
// analizzare con espressioni regolari senza falsi positivi, per esempio la
// parola DROP dentro un letterale o un commento.
export function stripSql(sql, { keepStrings = false } = {}) {
  let out = '';
  const s = String(sql);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const next = s[i + 1];
    if (c === '-' && next === '-') {
      while (i < s.length && s[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && next === '*') {
      i += 2;
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++;
      i++;
      out += ' ';
    } else if (c === "'") {
      let lit = '';
      i++;
      while (i < s.length) {
        if (s[i] === "'" && s[i + 1] === "'") {
          lit += "''";
          i += 2;
        } else if (s[i] === "'") break;
        else lit += s[i++];
      }
      out += keepStrings ? ` '${lit}' ` : " '' ";
    } else if (c === '"') {
      // Identificatore quotato: si conserva, non è testo libero.
      out += c;
      i++;
      while (i < s.length && s[i] !== '"') out += s[i++];
      out += '"';
    } else {
      out += c;
    }
  }
  return out;
}

// Vero se il testo contiene più istruzioni separate da `;`
// (un blocco PL/SQL usa il `;` internamente: lì il controllo non si applica).
function hasMultipleStatements(clean) {
  const body = clean.replace(/;\s*$/, '');
  return body.includes(';');
}

const FIRST_WORD = /^\s*(\w+)/;

export function classifySql(sql) {
  const clean = stripSql(sql).trim();
  if (!clean) return { level: null, error: 'Istruzione vuota' };

  const first = (clean.match(FIRST_WORD)?.[1] || '').toUpperCase();
  const plsql = first === 'BEGIN' || first === 'DECLARE';

  if (!plsql && hasMultipleStatements(clean)) {
    return { level: null, error: 'Esegui una sola istruzione per volta' };
  }

  // Blocchi anonimi e CALL possono nascondere qualsiasi cosa, anche in SQL
  // dinamico dentro un letterale (EXECUTE IMMEDIATE 'DROP …'): qui si guardano
  // anche le stringhe. Nel dubbio si chiede l'approvazione, che costa un clic.
  if (plsql || first === 'CALL' || first === 'EXEC' || first === 'EXECUTE') {
    const withStrings = stripSql(sql, { keepStrings: true });
    return { level: DANGER.test(withStrings) ? 'danger' : 'write', statement: first };
  }

  switch (first) {
    case 'SELECT':
      return { level: 'read', statement: 'SELECT' };
    case 'WITH': {
      // Una CTE può terminare con INSERT/UPDATE/DELETE: decide l'operazione finale.
      const m = clean.match(/\b(SELECT|INSERT|UPDATE|DELETE|MERGE)\b(?![\s\S]*\b(?:INSERT|UPDATE|DELETE|MERGE)\b)/i);
      const tail = (m?.[1] || 'SELECT').toUpperCase();
      if (tail === 'DELETE') return { level: 'danger', statement: 'DELETE' };
      return { level: tail === 'SELECT' ? 'read' : 'write', statement: tail };
    }
    case 'EXPLAIN':
    case 'DESC':
    case 'DESCRIBE':
      return { level: 'read', statement: first };

    case 'DELETE':
    case 'DROP':
    case 'TRUNCATE':
    case 'PURGE':
      return { level: 'danger', statement: first };

    case 'INSERT':
    case 'UPDATE':
    case 'MERGE':
    case 'CREATE':
    case 'ALTER':
    case 'COMMENT':
    case 'RENAME':
    case 'GRANT':
    case 'REVOKE':
    case 'ANALYZE':
    case 'COMMIT':
    case 'ROLLBACK':
    case 'SAVEPOINT':
    case 'SET':
      // Un CREATE OR REPLACE resta una scrittura, ma un CREATE che porta con sé
      // un DROP (raro, via PL/SQL dinamico) viene già intercettato sopra.
      return { level: 'write', statement: first };

    default:
      return { level: null, error: `Istruzione "${first}" non supportata dall'assistente` };
  }
}

// Descrizione leggibile del permesso, usata nei messaggi e nella richiesta
// di conferma mostrata in chat.
export const LEVEL_LABEL = {
  read: 'lettura',
  write: 'scrittura',
  danger: 'DELETE/DROP',
};
