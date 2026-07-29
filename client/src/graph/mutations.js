// Modifiche al diagramma, sempre immutabili.
//
// Il draft è indicizzato per id stabile (lo costruisce il server, vedi
// `server/src/graph/model.js`): modificare qualcosa clona **solo la tabella
// toccata** e riusa tutto il resto. Lo stack di annullamento è quindi un array
// di radici e costa quanto una tabella per modifica, non quanto lo schema.
//
// Le fabbriche qui sotto devono produrre la stessa forma di quelle
// dell'import: client e server sono build separate e non possono condividere
// il modulo, quindi la forma è fissata dai test del server
// (`server/test/graphApply.test.js`).

let counter = 0;
export const newId = (prefix) =>
  `${prefix}n${(++counter).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/* -------------------------------------------------------------- fabbriche -- */

export const emptyColumn = (name = '', type = 'VARCHAR2(50 CHAR)') => ({
  uid: newId('c'),
  base: null,
  name,
  deleted: false,
  id: null,
  type,
  notNull: false,
  default: null,
  identity: null,
  virtual: false,
  comment: null,
});

export const emptyTable = (name) => {
  const id = emptyColumn('ID', 'NUMBER(10)');
  id.notNull = true;
  const table = {
    uid: newId('t'),
    base: null,
    name,
    deleted: false,
    comment: null,
    temporary: false,
    onCommit: null,
    columns: [id],
    constraints: [],
    indexes: [],
  };
  table.constraints.push(
    emptyConstraint('P', `${name}_PK`, [{ columnUid: id.uid }])
  );
  return table;
};

export const emptyConstraint = (type, name, columns = []) => ({
  uid: newId('k'),
  base: null,
  name,
  deleted: false,
  type,
  columns,
  condition: null,
  refOwner: null,
  refTableUid: null,
  refTable: null,
  refColumns: [],
  deleteRule: null,
  disabled: false,
  generated: false,
});

export const emptyIndex = (name, columns = []) => ({
  uid: newId('x'),
  base: null,
  name,
  deleted: false,
  unique: false,
  type: 'NORMAL',
  columns,
  generated: false,
  unusable: false,
});

/* ---------------------------------------------------------------- letture -- */

export const liveTables = (draft) => Object.values(draft.tables).filter((t) => !t.deleted);
export const liveColumns = (table) => table.columns.filter((c) => !c.deleted);
export const liveConstraints = (table) => table.constraints.filter((c) => !c.deleted);
export const liveIndexes = (table) => table.indexes.filter((i) => !i.deleted);

export const columnOf = (table, uid) => table.columns.find((c) => c.uid === uid) || null;

// Gli uid delle colonne che compongono la chiave primaria.
export function pkColumnUids(table) {
  const pk = liveConstraints(table).find((c) => c.type === 'P');
  return pk ? pk.columns.map((r) => r.columnUid).filter(Boolean) : [];
}

// Gli uid delle colonne che partecipano a una FK: servono al nodo per il
// badge, e alla vista «solo colonne chiave».
export function fkColumnUids(table) {
  const out = new Set();
  for (const c of liveConstraints(table))
    if (c.type === 'R') for (const r of c.columns) if (r.columnUid) out.add(r.columnUid);
  return out;
}

// Un insieme di colonne è già garantito unico (chiave primaria o vincolo
// UNIQUE)? È la condizione perché ci si possa puntare con una FK.
export function isUniqueSet(table, columnUids) {
  const want = [...columnUids].sort().join(',');
  return liveConstraints(table).some(
    (c) =>
      (c.type === 'P' || c.type === 'U') &&
      c.columns.map((r) => r.columnUid).filter(Boolean).sort().join(',') === want
  );
}

// Gli archi da disegnare: una FK per arco, ancorata alla prima colonna di
// ciascun lato. Le FK verso schemi esterni o verso tabelle fuori dal disegno
// non producono un arco (manca il nodo di arrivo).
export function foreignKeys(draft) {
  const out = [];
  for (const t of liveTables(draft)) {
    for (const c of liveConstraints(t)) {
      if (c.type !== 'R' || !c.refTableUid) continue;
      const target = draft.tables[c.refTableUid];
      if (!target || target.deleted) continue;
      out.push({
        uid: c.uid,
        constraint: c,
        fromTable: t,
        toTable: target,
        fromColumnUids: c.columns.map((r) => r.columnUid).filter(Boolean),
        toColumnUids: c.refColumns.map((r) => r.columnUid).filter(Boolean),
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------- mutazioni -- */

// Unica porta d'ingresso: tutto il resto passa di qui, così la condivisione
// strutturale è garantita in un punto solo.
export function updateTable(draft, uid, fn) {
  const table = draft.tables[uid];
  if (!table) return draft;
  const next = fn(table);
  if (next === table) return draft;
  return { ...draft, tables: { ...draft.tables, [uid]: next } };
}

const replaceIn = (list, uid, fn) => list.map((x) => (x.uid === uid ? fn(x) : x));

export const patchTable = (draft, uid, patch) =>
  updateTable(draft, uid, (t) => ({ ...t, ...patch }));

export const patchColumn = (draft, tableUid, columnUid, patch) =>
  updateTable(draft, tableUid, (t) => ({
    ...t,
    columns: replaceIn(t.columns, columnUid, (c) => ({ ...c, ...patch })),
  }));

export const patchConstraint = (draft, tableUid, constraintUid, patch) =>
  updateTable(draft, tableUid, (t) => ({
    ...t,
    constraints: replaceIn(t.constraints, constraintUid, (c) => ({ ...c, ...patch })),
  }));

export const patchIndex = (draft, tableUid, indexUid, patch) =>
  updateTable(draft, tableUid, (t) => ({
    ...t,
    indexes: replaceIn(t.indexes, indexUid, (i) => ({ ...i, ...patch })),
  }));

export function addColumn(draft, tableUid, column = emptyColumn()) {
  return updateTable(draft, tableUid, (t) => ({ ...t, columns: [...t.columns, column] }));
}

// Una colonna mai esistita nel database si toglie e basta; una che c'è già si
// marca, così resta annullabile e il pannello delle modifiche può mostrarla.
export function removeColumn(draft, tableUid, columnUid) {
  return updateTable(draft, tableUid, (t) => {
    const column = columnOf(t, columnUid);
    if (!column) return t;
    if (column.base == null)
      return { ...t, columns: t.columns.filter((c) => c.uid !== columnUid) };
    return { ...t, columns: replaceIn(t.columns, columnUid, (c) => ({ ...c, deleted: true })) };
  });
}

export function moveColumn(draft, tableUid, columnUid, delta) {
  return updateTable(draft, tableUid, (t) => {
    const i = t.columns.findIndex((c) => c.uid === columnUid);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= t.columns.length) return t;
    const columns = t.columns.slice();
    [columns[i], columns[j]] = [columns[j], columns[i]];
    return { ...t, columns };
  });
}

export const addConstraint = (draft, tableUid, constraint) =>
  updateTable(draft, tableUid, (t) => ({ ...t, constraints: [...t.constraints, constraint] }));

export const removeConstraint = (draft, tableUid, constraintUid) =>
  updateTable(draft, tableUid, (t) => {
    const c = t.constraints.find((x) => x.uid === constraintUid);
    if (!c) return t;
    if (c.base == null)
      return { ...t, constraints: t.constraints.filter((x) => x.uid !== constraintUid) };
    return {
      ...t,
      constraints: replaceIn(t.constraints, constraintUid, (x) => ({ ...x, deleted: true })),
    };
  });

export const addIndex = (draft, tableUid, index) =>
  updateTable(draft, tableUid, (t) => ({ ...t, indexes: [...t.indexes, index] }));

export const removeIndex = (draft, tableUid, indexUid) =>
  updateTable(draft, tableUid, (t) => {
    const i = t.indexes.find((x) => x.uid === indexUid);
    if (!i) return t;
    if (i.base == null) return { ...t, indexes: t.indexes.filter((x) => x.uid !== indexUid) };
    return { ...t, indexes: replaceIn(t.indexes, indexUid, (x) => ({ ...x, deleted: true })) };
  });

export function addTable(draft, table) {
  return { ...draft, tables: { ...draft.tables, [table.uid]: table } };
}

// Eliminare una tabella mai creata la toglie di mezzo; una esistente si marca.
export function deleteTable(draft, uid) {
  const table = draft.tables[uid];
  if (!table) return draft;
  if (table.base == null) {
    const tables = { ...draft.tables };
    delete tables[uid];
    return { ...draft, tables };
  }
  return patchTable(draft, uid, { deleted: true });
}

export const restoreTable = (draft, uid) => patchTable(draft, uid, { deleted: false });

/* ------------------------------------------------------------ chiavi FK -- */

// Il nome proposto per una FK. Deterministico e leggibile: meglio di un
// SYS_C0012345, e resta modificabile nel pannello del vincolo.
export function proposeFkName(draft, childName, parentName) {
  const taken = new Set();
  for (const t of Object.values(draft.tables))
    for (const c of t.constraints) if (!c.deleted) taken.add(c.name);
  const base = `${childName}_FK_${parentName}`.slice(0, 26);
  if (!taken.has(base)) return base;
  for (let i = 2; i < 100; i++) if (!taken.has(`${base}_${i}`)) return `${base}_${i}`;
  return base;
}

/**
 * Aggiunge una foreign key fra due tabelle del diagramma. Le colonne
 * referenziate vuote significano «la chiave primaria del padre».
 */
export function addForeignKey(draft, { fromTableUid, fromColumnUids, toTableUid, toColumnUids }) {
  const child = draft.tables[fromTableUid];
  const parent = draft.tables[toTableUid];
  if (!child || !parent) return draft;
  const refUids = toColumnUids?.length ? toColumnUids : pkColumnUids(parent);
  if (!refUids.length || refUids.length !== fromColumnUids.length) return draft;

  const constraint = emptyConstraint(
    'R',
    proposeFkName(draft, child.name, parent.name),
    fromColumnUids.map((uid) => ({ columnUid: uid }))
  );
  constraint.refOwner = draft.owner;
  constraint.refTableUid = toTableUid;
  constraint.refTable = parent.name;
  constraint.refColumns = refUids.map((uid) => ({ columnUid: uid }));
  return addConstraint(draft, fromTableUid, constraint);
}
