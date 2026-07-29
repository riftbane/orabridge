// Riepilogo delle modifiche in sospeso.
//
// Il client non ha lo snapshot letto dal database — quello resta al server —
// ma ha il draft com'era all'apertura, che non tocca mai: confrontare i due
// per id stabile dice esattamente cosa è cambiato, e permette di annullare una
// singola voce ripristinandola da lì.

import { dictName } from '../ddl.js';

const kindOf = (before, after) => {
  if (!before) return 'new';
  if (after.deleted) return 'deleted';
  return 'modified';
};

// Le proprietà di una colonna che valgono una voce nel riepilogo, con
// l'etichetta con cui mostrarle.
const COLUMN_FIELDS = [
  ['type', 'tipo'],
  ['notNull', 'obbligatorietà'],
  ['default', 'valore predefinito'],
  ['comment', 'commento'],
  ['identity', 'identità'],
];

const norm = (v) => (v == null || v === '' ? null : v);
const same = (a, b) => norm(a) === norm(b);

function columnChanges(before, after) {
  const out = [];
  if (dictName(before.name) !== dictName(after.name))
    out.push(`rinominata da ${before.name}`);
  for (const [field, label] of COLUMN_FIELDS)
    if (!same(before[field], after[field])) out.push(`${label} modificato`);
  return out;
}

const describeConstraint = (c) =>
  c.type === 'P' ? 'chiave primaria' : c.type === 'U' ? 'vincolo UNIQUE' : c.type === 'R' ? 'foreign key' : 'vincolo CHECK';

/**
 * @param draft   il diagramma corrente
 * @param initial il diagramma com'era all'apertura
 * @returns [{ tableUid, name, kind, details: [] }] — solo le tabelle toccate
 */
export function changeSummary(draft, initial) {
  const out = [];

  for (const table of Object.values(draft.tables)) {
    const before = initial.tables[table.uid];
    const details = [];

    if (!before) {
      out.push({ tableUid: table.uid, name: table.name, kind: 'new', details: ['tabella nuova'] });
      continue;
    }
    if (table.deleted) {
      out.push({ tableUid: table.uid, name: table.name, kind: 'deleted', details: ['tabella eliminata'] });
      continue;
    }

    if (dictName(before.name) !== dictName(table.name)) details.push(`rinominata da ${before.name}`);
    if (!same(before.comment, table.comment)) details.push('commento modificato');

    const columnsBefore = new Map(before.columns.map((c) => [c.uid, c]));
    for (const c of table.columns) {
      const b = columnsBefore.get(c.uid);
      if (!b) {
        details.push(`colonna ${c.name} aggiunta`);
        continue;
      }
      if (c.deleted && !b.deleted) {
        details.push(`colonna ${c.name} eliminata`);
        continue;
      }
      if (c.deleted) continue;
      for (const change of columnChanges(b, c)) details.push(`colonna ${c.name}: ${change}`);
    }
    for (const b of before.columns)
      if (!table.columns.some((c) => c.uid === b.uid)) details.push(`colonna ${b.name} eliminata`);

    const consBefore = new Map(before.constraints.map((c) => [c.uid, c]));
    for (const c of table.constraints) {
      const b = consBefore.get(c.uid);
      if (!b) {
        details.push(`${describeConstraint(c)} ${c.name} aggiunto`);
        continue;
      }
      if (c.deleted && !b.deleted) {
        details.push(`${describeConstraint(c)} ${c.name} eliminato`);
        continue;
      }
      if (c.deleted) continue;
      if (dictName(b.name) !== dictName(c.name)) details.push(`vincolo ${b.name} rinominato in ${c.name}`);
      else if (JSON.stringify(omitName(b)) !== JSON.stringify(omitName(c)))
        details.push(`${describeConstraint(c)} ${c.name} modificato`);
    }
    for (const b of before.constraints)
      if (!table.constraints.some((c) => c.uid === b.uid))
        details.push(`${describeConstraint(b)} ${b.name} eliminato`);

    const idxBefore = new Map(before.indexes.map((i) => [i.uid, i]));
    for (const i of table.indexes) {
      const b = idxBefore.get(i.uid);
      if (!b) {
        details.push(`indice ${i.name} aggiunto`);
        continue;
      }
      if (i.deleted && !b.deleted) details.push(`indice ${i.name} eliminato`);
      else if (!i.deleted && JSON.stringify(omitName(b)) !== JSON.stringify(omitName(i)))
        details.push(`indice ${i.name} modificato`);
    }
    for (const b of before.indexes)
      if (!table.indexes.some((i) => i.uid === b.uid)) details.push(`indice ${b.name} eliminato`);

    if (details.length)
      out.push({ tableUid: table.uid, name: table.name, kind: kindOf(before, table), details });
  }

  // Le tabelle sparite dal draft senza passare per `deleted` (create e poi
  // tolte) non interessano: non erano mai arrivate nel database.
  out.sort((a, b) => (a.name < b.name ? -1 : 1));
  return out;
}

const omitName = ({ name, uid, base, ...rest }) => rest;

/** Ripristina una tabella com'era all'apertura del diagramma. */
export function revertTable(draft, initial, tableUid) {
  const before = initial.tables[tableUid];
  const tables = { ...draft.tables };
  if (!before) delete tables[tableUid];
  else tables[tableUid] = before;
  return { ...draft, tables };
}

export const countChanges = (draft, initial) => changeSummary(draft, initial).length;
