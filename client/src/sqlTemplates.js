// Modelli d'istruzione e parole chiave per posto, usati da completion.js.
//
// I modelli sono snippet di CodeMirror: `${n:testo}` è un campo, e l'ordine
// dei numeri decide in che sequenza il Tab li visita — non l'ordine in cui
// compaiono nel testo. È questo che permette a SELECT di chiedere prima la
// tabella e poi le colonne: senza sapere la tabella l'editor non potrebbe
// proporre nessuna colonna.
//
// Le parole chiave sono elenchi curati, non l'intero dizionario del dialetto:
// in ogni punto dell'istruzione ne hanno senso poche, e sono quelle che
// devono stare in cima.

// ---------------------------------------------------------------------------
// Modelli d'istruzione
// ---------------------------------------------------------------------------

// label   testo su cui si cerca (quello che si sta digitando)
// display come appare nell'elenco
// tpl     lo snippet; scritto in maiuscolo, viene abbassato se serve
// scope   'stmt' a inizio istruzione, 'expr' dentro un'espressione,
//         'tail' in coda a un SELECT (dopo il FROM come dopo le colonne)
const T = (label, display, tpl, scope = 'stmt') => ({ label, display, tpl, scope });

export const STATEMENTS = [
  T('SELECT', 'SELECT … FROM …', 'SELECT ${2:*}\n  FROM ${1:tabella}'),
  T(
    'SELECT WHERE',
    'SELECT … FROM … WHERE …',
    'SELECT ${2:*}\n  FROM ${1:tabella}\n WHERE ${3:condizione}'
  ),
  T(
    'SELECT JOIN',
    'SELECT … JOIN … ON …',
    'SELECT ${3:*}\n  FROM ${1:tabella} a\n  JOIN ${2:tabella} b ON b.${4:colonna} = a.${5:colonna}'
  ),
  T('SELECT COUNT', 'SELECT COUNT(*) FROM …', 'SELECT COUNT(*)\n  FROM ${1:tabella}'),
  T(
    'INSERT',
    'INSERT INTO … VALUES …',
    'INSERT INTO ${1:tabella} (${2:colonne})\nVALUES (${3:valori})'
  ),
  T(
    'INSERT SELECT',
    'INSERT INTO … SELECT …',
    'INSERT INTO ${1:tabella} (${2:colonne})\nSELECT ${4:colonne}\n  FROM ${3:tabella}'
  ),
  T(
    'UPDATE',
    'UPDATE … SET … WHERE …',
    'UPDATE ${1:tabella}\n   SET ${2:colonna} = ${3:valore}\n WHERE ${4:condizione}'
  ),
  T('DELETE', 'DELETE FROM … WHERE …', 'DELETE FROM ${1:tabella}\n WHERE ${2:condizione}'),
  T(
    'MERGE',
    'MERGE INTO … USING …',
    'MERGE INTO ${1:tabella} d\nUSING ${2:sorgente} s ON (d.${3:chiave} = s.${3:chiave})\n' +
      'WHEN MATCHED THEN UPDATE SET d.${4:colonna} = s.${4:colonna}\n' +
      'WHEN NOT MATCHED THEN INSERT (${5:colonne}) VALUES (${6:valori})'
  ),
  T(
    'WITH',
    'WITH … AS (…) SELECT …',
    'WITH ${1:dati} AS (\n  SELECT ${3:*}\n    FROM ${2:tabella}\n)\nSELECT *\n  FROM ${1:dati}'
  ),
  T(
    'CREATE TABLE',
    'CREATE TABLE …',
    'CREATE TABLE ${1:nome} (\n  ${2:id} NUMBER PRIMARY KEY,\n  ${3:descrizione} ${4:VARCHAR2(100)}\n)'
  ),
  T(
    'CREATE VIEW',
    'CREATE OR REPLACE VIEW …',
    'CREATE OR REPLACE VIEW ${1:nome} AS\nSELECT ${3:*}\n  FROM ${2:tabella}'
  ),
  T('CREATE INDEX', 'CREATE INDEX … ON …', 'CREATE INDEX ${1:nome} ON ${2:tabella} (${3:colonna})'),
  T(
    'CREATE SEQUENCE',
    'CREATE SEQUENCE …',
    'CREATE SEQUENCE ${1:nome} START WITH 1 INCREMENT BY 1 NOCACHE'
  ),
  T(
    'CREATE SYNONYM',
    'CREATE OR REPLACE SYNONYM …',
    'CREATE OR REPLACE SYNONYM ${1:nome} FOR ${2:schema}.${3:oggetto}'
  ),
  T(
    'CREATE PROCEDURE',
    'CREATE OR REPLACE PROCEDURE …',
    'CREATE OR REPLACE PROCEDURE ${1:nome} (${2:p_param} IN ${3:VARCHAR2}) IS\nBEGIN\n' +
      '  ${4:NULL};\nEND ${1:nome};\n/'
  ),
  T(
    'CREATE FUNCTION',
    'CREATE OR REPLACE FUNCTION …',
    'CREATE OR REPLACE FUNCTION ${1:nome} (${2:p_param} IN ${3:VARCHAR2}) RETURN ${4:NUMBER} IS\n' +
      '  v_risultato ${4:NUMBER};\nBEGIN\n  RETURN v_risultato;\nEND ${1:nome};\n/'
  ),
  T(
    'CREATE TRIGGER',
    'CREATE OR REPLACE TRIGGER …',
    'CREATE OR REPLACE TRIGGER ${1:nome}\nBEFORE INSERT ON ${2:tabella}\nFOR EACH ROW\n' +
      'BEGIN\n  ${3:NULL};\nEND;\n/'
  ),
  T('TRUNCATE', 'TRUNCATE TABLE …', 'TRUNCATE TABLE ${1:tabella}'),
  T(
    'COMMENT',
    'COMMENT ON TABLE … IS …',
    "COMMENT ON TABLE ${1:tabella} IS '${2:descrizione}'"
  ),
  T('BEGIN', 'blocco BEGIN … END', 'BEGIN\n  ${1:NULL};\nEND;\n/'),
  T(
    'DECLARE',
    'blocco DECLARE … BEGIN … END',
    'DECLARE\n  ${1:v_nome} ${2:VARCHAR2(100)};\nBEGIN\n  ${3:NULL};\nEND;\n/'
  ),
  T(
    'FOR',
    'FOR … IN (SELECT …) LOOP',
    'FOR ${1:r} IN (\n  SELECT ${3:*}\n    FROM ${2:tabella}\n) LOOP\n  ${4:NULL};\nEND LOOP;'
  ),
  T('IF', 'IF … THEN … END IF', 'IF ${1:condizione} THEN\n  ${2:NULL};\nEND IF;'),
  T(
    'EXCEPTION',
    'EXCEPTION WHEN OTHERS THEN',
    'EXCEPTION\n  WHEN OTHERS THEN\n    ${1:NULL};'
  ),
  T(
    'CASE',
    'CASE WHEN … THEN … END',
    'CASE WHEN ${1:condizione} THEN ${2:valore} ELSE ${3:valore} END',
    'expr'
  ),
  T('EXISTS', 'EXISTS (SELECT 1 FROM …)', 'EXISTS (\n  SELECT 1\n    FROM ${1:tabella}\n   WHERE ${2:condizione}\n)', 'expr'),
  T('FETCH FIRST', 'FETCH FIRST … ROWS ONLY', 'FETCH FIRST ${1:100} ROWS ONLY', 'tail'),
];

// ---------------------------------------------------------------------------
// Parole chiave per posto
// ---------------------------------------------------------------------------

// Verbi con cui può iniziare un'istruzione.
const STATEMENT_WORDS = [
  'SELECT', 'INSERT INTO', 'UPDATE', 'DELETE FROM', 'MERGE INTO', 'WITH',
  'CREATE', 'CREATE OR REPLACE', 'ALTER TABLE', 'DROP', 'TRUNCATE TABLE',
  'COMMENT ON', 'GRANT', 'REVOKE', 'RENAME', 'BEGIN', 'DECLARE', 'COMMIT',
  'ROLLBACK', 'SAVEPOINT', 'EXPLAIN PLAN FOR', 'DESC',
];

// Istruzioni che hanno senso solo dentro un blocco PL/SQL.
const PLSQL_WORDS = [
  'IF', 'FOR', 'WHILE', 'LOOP', 'CASE', 'RETURN', 'RAISE', 'NULL', 'EXIT',
  'CONTINUE', 'EXECUTE IMMEDIATE', 'OPEN', 'CLOSE', 'FETCH', 'EXCEPTION',
  'END', 'END IF', 'END LOOP', 'GOTO',
];

// Tipi di oggetto proponibili dopo ogni verbo DDL.
const OBJECT_WORDS = {
  CREATE: [
    'TABLE', 'GLOBAL TEMPORARY TABLE', 'VIEW', 'MATERIALIZED VIEW', 'INDEX',
    'UNIQUE INDEX', 'SEQUENCE', 'SYNONYM', 'PROCEDURE', 'FUNCTION', 'PACKAGE',
    'PACKAGE BODY', 'TRIGGER', 'TYPE', 'USER', 'ROLE', 'DIRECTORY', 'TABLESPACE',
  ],
  DROP: [
    'TABLE', 'VIEW', 'MATERIALIZED VIEW', 'INDEX', 'SEQUENCE', 'SYNONYM',
    'PROCEDURE', 'FUNCTION', 'PACKAGE', 'PACKAGE BODY', 'TRIGGER', 'TYPE',
    'USER', 'ROLE', 'DIRECTORY',
  ],
  ALTER: [
    'TABLE', 'VIEW', 'INDEX', 'SEQUENCE', 'TRIGGER', 'PACKAGE', 'PROCEDURE',
    'FUNCTION', 'TYPE', 'USER', 'SESSION', 'SYSTEM',
  ],
  TRUNCATE: ['TABLE'],
  COMMENT: ['TABLE', 'COLUMN'],
  PURGE: ['TABLE', 'INDEX', 'RECYCLEBIN'],
  ANALYZE: ['TABLE', 'INDEX'],
};

// Oggetti che si possono ricreare con CREATE OR REPLACE.
const REPLACEABLE = [
  'VIEW', 'FORCE VIEW', 'PROCEDURE', 'FUNCTION', 'PACKAGE', 'PACKAGE BODY',
  'TRIGGER', 'TYPE', 'TYPE BODY', 'SYNONYM', 'PUBLIC SYNONYM', 'DIRECTORY',
];

// Che cosa può seguire il nome della tabella in un ALTER TABLE, e che cosa
// può seguire ognuna di quelle parole.
const ALTER_WORDS = {
  '': ['ADD', 'MODIFY', 'DROP', 'RENAME', 'ENABLE', 'DISABLE', 'SET UNUSED COLUMN', 'MOVE TABLESPACE', 'READ ONLY', 'READ WRITE'],
  DROP: ['COLUMN', 'CONSTRAINT', 'PRIMARY KEY', 'UNIQUE'],
  RENAME: ['COLUMN', 'TO'],
  ENABLE: ['CONSTRAINT', 'ALL TRIGGERS'],
  DISABLE: ['CONSTRAINT', 'ALL TRIGGERS'],
  SET: ['UNUSED COLUMN'],
};

// Attributi di colonna e vincoli, dentro CREATE TABLE o dopo ADD/MODIFY.
const COLUMN_WORDS = [
  'NOT NULL', 'NULL', 'DEFAULT', 'PRIMARY KEY', 'UNIQUE', 'CONSTRAINT',
  'REFERENCES', 'CHECK', 'GENERATED ALWAYS AS IDENTITY', 'FOREIGN KEY',
];

const PRIVILEGES = [
  'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'EXECUTE', 'ALTER', 'INDEX',
  'REFERENCES', 'ALL PRIVILEGES', 'CREATE SESSION', 'CREATE TABLE',
  'CREATE VIEW', 'CREATE PROCEDURE', 'CONNECT', 'RESOURCE',
];

// Tipi di dato Oracle, con una dimensione d'esempio già scritta.
export const DATA_TYPES = [
  'VARCHAR2(100)', 'NUMBER', 'NUMBER(10)', 'NUMBER(12,2)', 'DATE',
  'TIMESTAMP', 'TIMESTAMP WITH TIME ZONE', 'CHAR(1)', 'CLOB', 'BLOB',
  'NVARCHAR2(100)', 'NCHAR(1)', 'NCLOB', 'RAW(16)', 'FLOAT', 'BINARY_DOUBLE',
  'BINARY_FLOAT', 'INTERVAL DAY TO SECOND', 'INTERVAL YEAR TO MONTH', 'ROWID',
  'XMLTYPE', 'BOOLEAN', 'PLS_INTEGER',
];

// Seguiti obbligati: dopo queste parole ne può arrivare solo una manciata.
const FOLLOWS = {
  IS: ['NULL', 'NOT NULL'],
  NOT: ['NULL', 'IN', 'EXISTS', 'LIKE', 'BETWEEN'],
  ORDER: ['BY'],
  GROUP: ['BY'],
  PARTITION: ['BY'],
  CONNECT: ['BY'],
  LEFT: ['JOIN', 'OUTER JOIN'],
  RIGHT: ['JOIN', 'OUTER JOIN'],
  FULL: ['JOIN', 'OUTER JOIN'],
  INNER: ['JOIN'],
  CROSS: ['JOIN'],
  OUTER: ['JOIN'],
  UNION: ['ALL'],
  INSERT: ['INTO'],
  MERGE: ['INTO'],
  DELETE: ['FROM'],
  START: ['WITH'],
  NULLS: ['FIRST', 'LAST'],
};

// Sequenza delle clausole per tipo d'istruzione: `req` marca quelle senza le
// quali l'istruzione non sta in piedi (finché manca, si propone solo quella).
const FLOWS = {
  select: [
    ['select', null], ['from', 'FROM', true], ['where', 'WHERE'],
    ['group', 'GROUP BY'], ['having', 'HAVING'], ['order', 'ORDER BY'],
  ],
  delete: [['delete', null], ['from', 'FROM', true], ['where', 'WHERE']],
  update: [['update', null], ['set', 'SET', true], ['where', 'WHERE']],
  insert: [['into', null], ['values', 'VALUES', true]],
  merge: [['merge', null], ['join', 'USING', true]],
};

// Vero se dopo `prevWord` può arrivare solo una manciata di parole: in quel
// caso vale la pena proporle anche senza aver digitato niente.
export const hasStrictFollow = (prevWord) => !!FOLLOWS[prevWord];

// Vero se all'istruzione manca ancora una clausola senza la quale non sta in
// piedi (il FROM di un SELECT, il SET di un UPDATE): lì il suggerimento è
// obbligato e si può proporre subito.
export function missingRequired(info) {
  const flow = FLOWS[info.kind] || FLOWS.select;
  const seen = new Set([...info.clausesBefore, ...info.clausesAfter]);
  const here = flow.findIndex(([c]) => c === info.clause);
  return flow.some(([name, kw, req], i) => i > here && req && kw && !seen.has(name));
}

// Clausole ancora scrivibili dopo il punto in cui si trova il cursore.
function clauseFlow(info) {
  const flow = FLOWS[info.kind] || FLOWS.select;
  const seen = new Set([...info.clausesBefore, ...info.clausesAfter]);
  const here = flow.findIndex(([c]) => c === info.clause);
  const out = [];
  for (let i = 0; i < flow.length; i++) {
    const [name, kw, required] = flow[i];
    if (i <= here || !kw || seen.has(name)) continue;
    if (required) return [kw];
    out.push(kw);
  }
  return out;
}

// Parole chiave da proporre nel punto in cui si trova il cursore, in ordine di
// pertinenza. È l'elenco che sta in cima quando prima del cursore c'è un
// valore concluso e quindi può cominciare solo una clausola o un operatore.
export function keywordsFor(info) {
  return [...new Set(pick(info))];
}

// Gli elenchi si sovrappongono (VALUES arriva sia dal tipo d'istruzione sia
// dal flusso delle clausole): a togliere i doppioni ci pensa keywordsFor.
function pick(info) {
  // Il tipo di oggetto viene prima dei seguiti: dopo CREATE si propongono le
  // tabelle e le viste, non solo OR REPLACE.
  if (info.slot === 'ddlType') {
    if (info.prevWord === 'REPLACE') return REPLACEABLE;
    const list = OBJECT_WORDS[info.verb] || [];
    return info.prevWord === 'CREATE' ? ['OR REPLACE', ...list] : list;
  }

  const follows = FOLLOWS[info.prevWord];
  if (follows) return follows;

  switch (info.slot) {
    case 'start':
      return info.inBlock ? [...PLSQL_WORDS, ...STATEMENT_WORDS] : STATEMENT_WORDS;
    case 'ddlAction':
      return ALTER_WORDS[info.prevWord] || ALTER_WORDS[''];
    case 'ddlBody':
      return COLUMN_WORDS;
    case 'priv':
      return PRIVILEGES;
    case 'grantee':
      return ['PUBLIC'];
    case 'table':
      return info.afterValue ? afterTable(info) : [];
    case 'column':
      return info.afterValue ? afterExpression(info) : startOfExpression(info);
    default:
      return [];
  }
}

// Dopo il nome di una tabella (o del suo alias).
function afterTable(info) {
  const out = [];
  if (info.kind === 'insert' && info.clause === 'into') out.push('VALUES', 'SELECT');
  if (info.clause === 'join') out.push('ON');
  if (info.clause === 'from' || info.clause === 'join') {
    out.push('JOIN', 'LEFT JOIN', 'INNER JOIN', 'RIGHT JOIN', 'FULL OUTER JOIN', 'CROSS JOIN');
  }
  out.push(...clauseFlow(info));
  if (info.clause === 'from') out.push('UNION', 'UNION ALL', 'MINUS', 'INTERSECT');
  return out;
}

// Dopo un'espressione conclusa: operatori e clausole successive.
function afterExpression(info) {
  const out = [];
  if (info.clause === 'where' || info.clause === 'on' || info.clause === 'having') {
    out.push('AND', 'OR', 'LIKE', 'IN', 'NOT IN', 'BETWEEN', 'IS NULL', 'IS NOT NULL');
  } else if (info.clause === 'order') {
    out.push('DESC', 'ASC', 'NULLS LAST', 'NULLS FIRST');
  } else if (info.clause === 'select') {
    out.push('AS');
  }
  out.push(...clauseFlow(info));
  if (info.clause === 'where') out.push('CONNECT BY', 'START WITH');
  return out;
}

// All'inizio di un'espressione: poche parole, il resto sono nomi.
function startOfExpression(info) {
  if (info.clause === 'select') {
    return info.prevWord === 'SELECT' ? ['DISTINCT', 'CASE', 'ALL'] : ['CASE'];
  }
  if (info.clause === 'where' || info.clause === 'on' || info.clause === 'having') {
    return ['NOT', 'EXISTS', 'CASE'];
  }
  if (info.clause === 'values') return ['NULL', 'DEFAULT', 'SYSDATE'];
  if (info.clause === 'set') return ['NULL', 'DEFAULT'];
  return [];
}
