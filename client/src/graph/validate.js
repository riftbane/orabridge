// Controllo continuo del diagramma.
//
// È qui che un editor a nodi batte davvero una finestra di dialogo: la
// validazione guarda tutto lo schema insieme, non una tabella alla volta.
// Funzione pura, richiamata a ogni modifica; gli errori bloccano
// l'applicazione, gli avvisi no.

import { dictName } from '../ddl.js';
import { liveColumns, liveConstraints, liveIndexes, liveTables } from './mutations.js';

// Le parole riservate di Oracle che capita davvero di usare come nome di
// colonna. Non è l'elenco completo di V$RESERVED_WORDS: quello segnalerebbe
// mezzo dizionario e verrebbe ignorato.
const RESERVED = new Set(
  `ACCESS ADD ALL ALTER AND ANY AS ASC AUDIT BETWEEN BY CHAR CHECK CLUSTER COLUMN COMMENT
   COMPRESS CONNECT CREATE CURRENT DATE DECIMAL DEFAULT DELETE DESC DISTINCT DROP ELSE EXCLUSIVE
   EXISTS FILE FLOAT FOR FROM GRANT GROUP HAVING IDENTIFIED IMMEDIATE IN INCREMENT INDEX INITIAL
   INSERT INTEGER INTERSECT INTO IS LEVEL LIKE LOCK LONG MAXEXTENTS MINUS MODE MODIFY NOAUDIT
   NOCOMPRESS NOT NOWAIT NULL NUMBER OF OFFLINE ON ONLINE OPTION OR ORDER PCTFREE PRIOR PRIVILEGES
   PUBLIC RAW RENAME RESOURCE REVOKE ROW ROWID ROWNUM ROWS SELECT SESSION SET SHARE SIZE SMALLINT
   START SUCCESSFUL SYNONYM SYSDATE TABLE THEN TO TRIGGER UID UNION UNIQUE UPDATE USER VALIDATE
   VALUES VARCHAR VARCHAR2 VIEW WHENEVER WHERE WITH`.split(/\s+/)
);

// Da 12.2 gli identificatori arrivano a 128 byte; prima si fermano a 30, ed è
// il limite che fa inciampare chi disegna nomi parlanti.
export function nameLimit(oracleVersion) {
  const m = /^(\d+)\.(\d+)/.exec(String(oracleVersion || ''));
  if (!m) return 128;
  const [, major, minor] = m.map(Number);
  return major > 12 || (major === 12 && minor >= 2) ? 128 : 30;
}

// Famiglia di un tipo: due colonne legate da una FK devono appartenere alla
// stessa. Le lunghezze diverse invece Oracle le accetta.
function family(type) {
  const t = String(type || '').toUpperCase().replace(/\(.*/, '').trim();
  if (/^(NUMBER|INTEGER|INT|SMALLINT|FLOAT|DECIMAL|NUMERIC|BINARY_FLOAT|BINARY_DOUBLE)$/.test(t))
    return 'numerico';
  if (/^N?(VARCHAR2?|CHAR)$/.test(t)) return 'testo';
  if (/^(DATE|TIMESTAMP)/.test(t)) return 'data';
  if (/^(BLOB|CLOB|NCLOB|RAW|LONG)/.test(t)) return 'binario';
  return t || '?';
}

const uidSet = (refs) => refs.map((r) => r.columnUid).filter(Boolean);

/**
 * @returns [{ level: 'error'|'warn', text, tableUid, columnUid }]
 */
export function validateDraft(draft, { oracleVersion } = {}) {
  const out = [];
  const limit = nameLimit(oracleVersion);
  const add = (level, text, tableUid = null, columnUid = null) =>
    out.push({ level, text, tableUid, columnUid });

  const tables = liveTables(draft);

  // ---- nomi ----
  const byName = new Map();
  for (const t of tables) {
    const name = dictName(t.name);
    if (!name) {
      add('error', 'Una tabella non ha nome', t.uid);
      continue;
    }
    if (byName.has(name)) add('error', `Due tabelle si chiamano ${name}`, t.uid);
    byName.set(name, t);
    if (name.length > limit)
      add('error', `${name}: il nome supera i ${limit} caratteri ammessi da questo Oracle`, t.uid);
    if (RESERVED.has(name)) add('warn', `${name} è una parola riservata: andrà sempre fra virgolette`, t.uid);
  }

  const constraintNames = new Map();
  const indexNames = new Map();

  for (const t of tables) {
    const columns = liveColumns(t);
    if (!columns.length) add('error', `${t.name} non ha nessuna colonna`, t.uid);

    const seen = new Map();
    for (const c of columns) {
      const name = dictName(c.name);
      if (!name) {
        add('error', `${t.name}: una colonna non ha nome`, t.uid, c.uid);
        continue;
      }
      if (seen.has(name)) add('error', `${t.name}: due colonne si chiamano ${name}`, t.uid, c.uid);
      seen.set(name, c);
      if (name.length > limit)
        add('error', `${t.name}.${name}: il nome supera i ${limit} caratteri`, t.uid, c.uid);
      if (RESERVED.has(name))
        add('warn', `${t.name}.${name} è una parola riservata: andrà fra virgolette`, t.uid, c.uid);
      if (!String(c.type || '').trim())
        add('error', `${t.name}.${name}: manca il tipo`, t.uid, c.uid);
    }

    // ---- chiave primaria ----
    const keys = liveConstraints(t).filter((c) => c.type === 'P');
    if (keys.length > 1) add('error', `${t.name} ha più di una chiave primaria`, t.uid);
    if (!keys.length) add('warn', `${t.name} non ha chiave primaria`, t.uid);

    // ---- nomi di vincoli e indici, unici nello schema ----
    for (const c of liveConstraints(t)) {
      const name = dictName(c.name);
      if (!name) {
        add('error', `${t.name}: un vincolo non ha nome`, t.uid);
        continue;
      }
      if (constraintNames.has(name))
        add('error', `Due vincoli si chiamano ${name} (${constraintNames.get(name)} e ${t.name})`, t.uid);
      constraintNames.set(name, t.name);
      if (name.length > limit) add('error', `Il vincolo ${name} supera i ${limit} caratteri`, t.uid);
      if (c.type === 'C' && !String(c.condition || '').trim())
        add('error', `${t.name}: il vincolo CHECK ${name} non ha condizione`, t.uid);
      if (c.type !== 'C' && !c.columns.length)
        add('error', `${t.name}: il vincolo ${name} non ha colonne`, t.uid);
    }

    for (const i of liveIndexes(t)) {
      const name = dictName(i.name);
      if (indexNames.has(name))
        add('error', `Due indici si chiamano ${name} (${indexNames.get(name)} e ${t.name})`, t.uid);
      indexNames.set(name, t.name);
      // Oracle crea da sé l'indice che regge una PK o un UNIQUE: farne un
      // secondo sulle stesse colonne è spazio buttato.
      const cols = uidSet(i.columns).sort().join(',');
      const backed = liveConstraints(t).some(
        (c) =>
          (c.type === 'P' || c.type === 'U') &&
          c.name !== i.name &&
          uidSet(c.columns).sort().join(',') === cols
      );
      if (cols && backed)
        add('warn', `${t.name}: l'indice ${i.name} ripete le colonne di un vincolo già indicizzato`, t.uid);
    }
  }

  // ---- foreign key ----
  for (const t of tables) {
    for (const c of liveConstraints(t)) {
      if (c.type !== 'R') continue;
      const parent = c.refTableUid ? draft.tables[c.refTableUid] : null;
      if (c.refTableUid && (!parent || parent.deleted)) {
        add('error', `${t.name}: la FK ${c.name} punta a una tabella eliminata`, t.uid);
        continue;
      }
      if (!parent) continue; // riferimento a un altro schema: non lo sappiamo giudicare
      if (c.columns.length !== c.refColumns.length) {
        add('error', `${t.name}: la FK ${c.name} accoppia un numero diverso di colonne`, t.uid);
        continue;
      }
      const refUids = uidSet(c.refColumns);
      const unique = liveConstraints(parent).some(
        (k) =>
          (k.type === 'P' || k.type === 'U') &&
          uidSet(k.columns).sort().join(',') === refUids.slice().sort().join(',')
      );
      if (refUids.length && !unique)
        add(
          'error',
          `${t.name}: la FK ${c.name} punta a colonne di ${parent.name} che non sono chiave né UNIQUE`,
          t.uid
        );

      for (let i = 0; i < c.columns.length; i++) {
        const child = liveColumns(t).find((x) => x.uid === c.columns[i].columnUid);
        const ref = liveColumns(parent).find((x) => x.uid === c.refColumns[i]?.columnUid);
        if (!child || !ref) continue;
        if (family(child.type) !== family(ref.type))
          add(
            'error',
            `${t.name}.${child.name} (${child.type}) e ${parent.name}.${ref.name} (${ref.type}) ` +
              `non sono dello stesso tipo: la FK ${c.name} non si può creare`,
            t.uid,
            child.uid
          );
      }

      // Una FK senza indice sulle colonne figlie è la causa classica dei
      // blocchi sul padre durante le DELETE.
      const cols = uidSet(c.columns).join(',');
      const indexed = [...liveIndexes(t), ...liveConstraints(t).filter((k) => k.type === 'P' || k.type === 'U')].some(
        (i) => uidSet(i.columns).slice(0, c.columns.length).join(',') === cols
      );
      if (cols && !indexed)
        add(
          'warn',
          `${t.name}: la FK ${c.name} non ha un indice sulle colonne figlie — le DELETE sul padre bloccheranno la tabella`,
          t.uid
        );
    }
  }

  return out;
}

export const errorsOf = (issues) => issues.filter((i) => i.level === 'error');
