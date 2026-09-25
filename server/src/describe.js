// DESC / DESCRIBE come in SQL*Plus e SQL Developer. Non è un'istruzione SQL
// ma un comando del client: mandato così com'è al database torna ORA-00900.
// Qui lo si riconosce, si risolve il nome (schema corrente, sinonimi privati e
// pubblici) e si risponde con una griglia letta dal dizionario.

import oracledb from 'oracledb';

// Un identificatore: fra virgolette mantiene maiuscole e minuscole, altrimenti
// vale in maiuscolo come per Oracle.
const IDENT = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z][\w$#]*)`;
const DESC_RX = new RegExp(
  String.raw`^\s*DESC(?:RIBE)?\s+(${IDENT})(?:\s*\.\s*(${IDENT}))?(?:\s*@\s*([\w$#.]+))?\s*;?\s*$`,
  'i'
);

const unquote = (id) =>
  id.startsWith('"') ? id.slice(1, -1).replace(/""/g, '"') : id.toUpperCase();

// Commenti in testa (`-- descrizione\nDESC t`) come nel resto dei controlli.
const LEADING_COMMENTS = /^(?:\s+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*/;

// `{ owner, name, dbLink, text }` se l'istruzione è un DESC, altrimenti null.
export function parseDescribe(sql) {
  const body = String(sql ?? '').replace(LEADING_COMMENTS, '');
  const m = DESC_RX.exec(body);
  if (!m) return null;
  const [, first, second, dbLink] = m;
  return {
    owner: second ? unquote(first) : null,
    name: unquote(second || first),
    dbLink: dbLink || null,
    text: body.replace(/^\s*DESC(?:RIBE)?\s+/i, '').replace(/\s*;?\s*$/, ''),
  };
}

// ---------------------------------------------------------- tipi -----

// Il tipo come lo scrive SQL*Plus: VARCHAR2(30), NUMBER(10,2), NUMBER(38) per
// un INTEGER, VARCHAR2(20 CHAR) se la colonna è in caratteri.
export function columnType({ type, typeOwner, length, charLength, charUsed, precision, scale }) {
  if (!type) return null;
  if (type === 'VARCHAR2' || type === 'CHAR') {
    return `${type}(${charLength || length}${charUsed === 'C' ? ' CHAR' : ''})`;
  }
  if (type === 'NVARCHAR2' || type === 'NCHAR') return `${type}(${charLength || length})`;
  if (type === 'RAW' || type === 'UROWID') return `${type}(${length})`;
  if (type === 'NUMBER') {
    if (precision == null) return scale === 0 ? 'NUMBER(38)' : 'NUMBER';
    return `NUMBER(${precision}${scale ? `,${scale}` : ''})`;
  }
  if (type === 'FLOAT' && precision != null) return `FLOAT(${precision})`;
  // TIMESTAMP(6), INTERVAL DAY(2) TO SECOND(6) … arrivano già completi; i
  // tipi oggetto si qualificano con lo schema quando serve a capire quale sia.
  if (typeOwner && typeOwner !== 'SYS' && typeOwner !== 'PUBLIC') return `${typeOwner}.${type}`;
  return type;
}

// Tipo di un argomento di procedura: i tipi definiti da utente (record di
// package, oggetti, collezioni) stanno in type_name, gli altri in pls_type.
function argumentType([, , , , dataType, plsType, typeOwner, typeName, typeSub, length, precision, scale]) {
  if (typeName) {
    return [typeOwner, typeName, typeSub].filter(Boolean).join('.');
  }
  if (!dataType) return null;
  const base = plsType || dataType;
  if (base === 'NUMBER' || base === 'FLOAT') return columnType({ type: base, precision, scale });
  if (length && ['VARCHAR2', 'CHAR', 'NVARCHAR2', 'NCHAR', 'RAW'].includes(base)) return `${base}(${length})`;
  return base;
}

// ------------------------------------------------------ risoluzione ---

// Fra gli oggetti con lo stesso nome (una vista materializzata è anche una
// tabella) vince quello che il DESC saprebbe descrivere.
const TYPE_RANK = [
  'TABLE',
  'VIEW',
  'MATERIALIZED VIEW',
  'SYNONYM',
  'PACKAGE',
  'PROCEDURE',
  'FUNCTION',
  'TYPE',
  'SEQUENCE',
];

function notFound(target) {
  const err = new Error(`ORA-04043: l'oggetto ${target.text} non esiste`);
  err.errorNum = 4043;
  return err;
}

export async function describe(session, target) {
  if (target.dbLink) {
    throw new Error(`DESC su un database remoto (@${target.dbLink}) non è supportato.`);
  }
  const exec = (sql, binds = {}) =>
    session.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_ARRAY, maxRows: 5000 });

  const typeOf = async (owner, name) => {
    const r = await exec(
      `SELECT object_type FROM all_objects
        WHERE owner = :owner AND object_name = :name
          AND object_type IN (${TYPE_RANK.map((t) => `'${t}'`).join(', ')})`,
      { owner, name }
    );
    const found = r.rows.map((x) => x[0]);
    return TYPE_RANK.find((t) => found.includes(t)) || null;
  };

  let owner = target.owner;
  let name = target.name;
  let type;
  if (owner) {
    type = await typeOf(owner, name);
  } else {
    // Senza schema: prima lo schema corrente (che ALTER SESSION SET
    // CURRENT_SCHEMA può aver cambiato), poi i sinonimi pubblici.
    const r = await exec(`SELECT sys_context('USERENV', 'CURRENT_SCHEMA') FROM dual`);
    owner = r.rows[0][0];
    type = await typeOf(owner, name);
    if (!type && (await typeOf('PUBLIC', name))) {
      owner = 'PUBLIC';
      type = 'SYNONYM';
    }
  }

  // Catena di sinonimi (di norma uno solo; il limite evita i cicli).
  for (let hop = 0; type === 'SYNONYM'; hop++) {
    if (hop >= 10) throw notFound(target);
    const r = await exec(
      `SELECT table_owner, table_name, db_link FROM all_synonyms
        WHERE owner = :owner AND synonym_name = :name`,
      { owner, name }
    );
    const [tOwner, tName, dbLink] = r.rows[0] || [];
    if (!tName) throw notFound(target);
    if (dbLink) {
      throw new Error(
        `${target.text} è un sinonimo verso ${tOwner ? `${tOwner}.` : ''}${tName}@${dbLink}: ` +
          'DESC su un database remoto non è supportato.'
      );
    }
    owner = tOwner || owner;
    name = tName;
    type = await typeOf(owner, name);
  }
  if (!type) throw notFound(target);

  const title = `${type} ${owner}.${name}`;
  switch (type) {
    case 'TABLE':
    case 'VIEW':
    case 'MATERIALIZED VIEW':
      return { title, ...(await describeColumns(exec, owner, name)) };
    case 'PACKAGE':
    case 'PROCEDURE':
    case 'FUNCTION':
      return { title, ...(await describeArguments(exec, owner, name, type)) };
    case 'TYPE':
      return { title, ...(await describeType(exec, owner, name)) };
    default:
      throw new Error(`DESC non si applica a ${owner}.${name}, che è di tipo ${type}.`);
  }
}

const COLUMNS = [
  { name: 'Nome', type: 'VARCHAR2' },
  { name: 'Null?', type: 'VARCHAR2' },
  { name: 'Tipo', type: 'VARCHAR2' },
];

async function describeColumns(exec, owner, name) {
  const r = await exec(
    `SELECT column_name, nullable, data_type, data_type_owner, data_length,
            char_length, char_used, data_precision, data_scale
       FROM all_tab_columns
      WHERE owner = :owner AND table_name = :name
      ORDER BY column_id`,
    { owner, name }
  );
  const rows = r.rows.map(([col, nullable, type, typeOwner, length, charLength, charUsed, precision, scale]) => [
    col,
    nullable === 'N' ? 'NOT NULL' : null,
    columnType({ type, typeOwner, length, charLength, charUsed, precision, scale }),
  ]);
  return { columns: COLUMNS, rows };
}

async function describeArguments(exec, owner, name, type) {
  const pkg = type === 'PACKAGE';
  const r = await exec(
    `SELECT object_name, overload, argument_name, position, data_type, pls_type,
            type_owner, type_name, type_subname, data_length, data_precision,
            data_scale, in_out, defaulted
       FROM all_arguments
      WHERE owner = :owner AND data_level = 0
        AND ${pkg ? 'package_name = :name' : 'package_name IS NULL AND object_name = :name'}
      ORDER BY object_name, TO_NUMBER(overload) NULLS FIRST, sequence`,
    { owner, name }
  );
  const rows = r.rows.map((row) => {
    const [object, overload, arg, position, dataType, , , , , , , , inOut, defaulted] = row;
    let label = arg;
    // Il valore di ritorno di una funzione è l'argomento senza nome in
    // posizione 0; una procedura senza argomenti ha una riga tutta vuota.
    if (!arg) label = position === 0 ? '(valore restituito)' : dataType ? null : '(nessun argomento)';
    const out = [
      label,
      argumentType(row),
      position === 0 && !arg ? 'OUT' : dataType ? inOut : null,
      defaulted === 'Y' ? 'DEFAULT' : null,
    ];
    return pkg ? [overload ? `${object} (${overload})` : object, ...out] : out;
  });
  const columns = [
    { name: 'Argomento', type: 'VARCHAR2' },
    { name: 'Tipo', type: 'VARCHAR2' },
    { name: 'In/Out', type: 'VARCHAR2' },
    { name: 'Default?', type: 'VARCHAR2' },
  ];
  if (pkg) columns.unshift({ name: 'Sottoprogramma', type: 'VARCHAR2' });
  return { columns, rows };
}

async function describeType(exec, owner, name) {
  const attrs = await exec(
    `SELECT attr_name, attr_type_name, attr_type_owner, length, precision, scale
       FROM all_type_attrs
      WHERE owner = :owner AND type_name = :name
      ORDER BY attr_no`,
    { owner, name }
  );
  if (attrs.rows.length) {
    const rows = attrs.rows.map(([attr, type, typeOwner, length, precision, scale]) => [
      attr,
      null,
      columnType({ type, typeOwner, length, charLength: length, precision, scale }),
    ]);
    return { columns: COLUMNS, rows };
  }
  // Una collezione non ha attributi: come SQL*Plus si mostra di cosa è fatta.
  const coll = await exec(
    `SELECT coll_type, upper_bound, elem_type_name, elem_type_owner, length, precision, scale
       FROM all_coll_types
      WHERE owner = :owner AND type_name = :name`,
    { owner, name }
  );
  const c = coll.rows[0];
  if (!c) return { columns: COLUMNS, rows: [] };
  const [collType, bound, type, typeOwner, length, precision, scale] = c;
  const elem = columnType({ type, typeOwner, length, charLength: length, precision, scale });
  const kind = collType === 'TABLE' ? 'TABLE' : `VARRAY(${bound})`;
  return { columns: COLUMNS, rows: [[name, null, `${kind} OF ${elem}`]] };
}
