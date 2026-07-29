import test from 'node:test';
import assert from 'node:assert/strict';
import { importSnapshot, projectDraft, newId } from '../src/graph/model.js';
import { sourceKey } from '../src/diff/snapshot.js';
import {
  byName,
  col,
  cons,
  demo,
  draftColumn,
  draftTable,
  fk,
  idx,
  seq,
  snapshot,
  table,
} from './fixtures.js';

/* ---- l'invariante ---- */

// Se questo test cade, aprire un diagramma e applicarlo senza toccare niente
// genererebbe delle modifiche: è la garanzia su cui poggia tutto il resto.
test('proiettare un draft appena importato restituisce lo snapshot di partenza', () => {
  const snap = demo();
  assert.deepEqual(projectDraft(importSnapshot(snap)), snap);
});

test("l'invariante regge anche su uno snapshot vuoto", () => {
  const snap = snapshot('APP');
  assert.deepEqual(projectDraft(importSnapshot(snap)), snap);
});

test("l'invariante regge su indici funzionali, DESC e vincoli disabilitati", () => {
  const snap = snapshot('APP', {
    tables: byName([
      table('T', [col('A', 'VARCHAR2(10)'), col('B', 'NUMBER')], {
        constraints: [cons('T_CK', 'C', ['B'], { condition: 'B > 0', disabled: true })],
        indexes: [
          idx('T_IX1', ['UPPER("A")', 'B DESC']),
          idx('T_IX2', ['A DESC'], { unique: true, type: 'BITMAP' }),
        ],
      }),
    ]),
  });
  assert.deepEqual(projectDraft(importSnapshot(snap)), snap);
});

test("l'invariante regge sulle famiglie che l'editor non tocca", () => {
  const snap = snapshot('APP', {
    views: { V: { name: 'V', text: 'SELECT 1 FROM DUAL', columns: ['X'] } },
    triggers: { G: { name: 'G', text: 'CREATE OR REPLACE TRIGGER G …', disabled: false } },
    sources: {
      [sourceKey('PACKAGE', 'P')]: { type: 'PACKAGE', name: 'P', text: 'PACKAGE P IS END;' },
    },
    synonyms: { S: { name: 'S', tableOwner: 'ALTRO', tableName: 'T', dbLink: null } },
  });
  assert.deepEqual(projectDraft(importSnapshot(snap)), snap);
});

/* ---- riferimenti per id ---- */

test('rinominare una colonna aggiorna chiave, indice e FK che la usano', () => {
  const draft = importSnapshot(demo());
  draftColumn(draft, 'CLIENTI', 'ID').name = 'CLIENTE_ID';

  const snap = projectDraft(draft);
  assert.deepEqual(
    snap.tables.CLIENTI.columns.map((c) => c.name),
    ['CLIENTE_ID', 'NOME', 'STATO']
  );
  // la chiave primaria e il suo indice seguono…
  assert.deepEqual(snap.tables.CLIENTI.constraints[0].columns, ['CLIENTE_ID']);
  assert.deepEqual(snap.tables.CLIENTI.indexes[0].columns, ['CLIENTE_ID']);
  // …e anche la FK che punta lì dall'altra tabella
  const foreign = snap.tables.ORDINI.constraints.find((c) => c.type === 'R');
  assert.deepEqual(foreign.refColumns, ['CLIENTE_ID']);
  assert.equal(foreign.refTable, 'CLIENTI');
});

test('rinominare una tabella aggiorna le FK che la referenziano', () => {
  const draft = importSnapshot(demo());
  draftTable(draft, 'CLIENTI').name = 'ANAGRAFICHE';

  const snap = projectDraft(draft);
  assert.ok(snap.tables.ANAGRAFICHE);
  assert.equal(snap.tables.CLIENTI, undefined);
  assert.equal(snap.tables.ORDINI.constraints.find((c) => c.type === 'R').refTable, 'ANAGRAFICHE');
});

test('una FK verso un altro schema resta agganciata ai nomi', () => {
  const snap = snapshot('APP', {
    tables: byName([
      table('T', [col('X', 'NUMBER')], {
        constraints: [
          cons('T_FK', 'R', ['X'], {
            refOwner: 'ALTRO',
            refTable: 'ESTERNA',
            refColumns: ['ID'],
          }),
        ],
      }),
    ]),
  });
  const draft = importSnapshot(snap);
  assert.equal(draft.tables.t1.constraints[0].refTableUid, null);
  assert.deepEqual(projectDraft(draft), snap);
});

/* ---- eliminazioni ---- */

test('una tabella eliminata sparisce dalla proiezione', () => {
  const draft = importSnapshot(demo());
  draftTable(draft, 'ORDINI').deleted = true;

  const snap = projectDraft(draft);
  assert.deepEqual(Object.keys(snap.tables), ['CLIENTI']);
});

test('eliminando la tabella padre cade anche la FK che la referenziava', () => {
  const draft = importSnapshot(demo());
  draftTable(draft, 'CLIENTI').deleted = true;

  const snap = projectDraft(draft);
  assert.deepEqual(
    snap.tables.ORDINI.constraints.map((c) => c.name),
    ['ORDINI_PK']
  );
});

test('eliminando una colonna cadono i vincoli e gli indici che la citano', () => {
  const draft = importSnapshot(demo());
  draftColumn(draft, 'ORDINI', 'CLIENTE_ID').deleted = true;

  const snap = projectDraft(draft);
  assert.deepEqual(
    snap.tables.ORDINI.columns.map((c) => c.name),
    ['ID', 'TOTALE']
  );
  assert.deepEqual(
    snap.tables.ORDINI.constraints.map((c) => c.name),
    ['ORDINI_PK']
  );
  assert.deepEqual(
    snap.tables.ORDINI.indexes.map((i) => i.name),
    ['ORDINI_PK']
  );
});

test('una sequenza eliminata sparisce dalla proiezione', () => {
  const draft = importSnapshot(demo());
  Object.values(draft.sequences)[0].deleted = true;
  assert.deepEqual(projectDraft(draft).sequences, {});
});

/* ---- oggetti nuovi ---- */

test('una tabella creata nel diagramma si proietta senza base', () => {
  const draft = importSnapshot(demo());
  const uid = newId('t');
  const cuid = newId('c');
  draft.tables[uid] = {
    uid,
    base: null,
    name: 'NOTE',
    deleted: false,
    comment: null,
    temporary: false,
    onCommit: null,
    columns: [
      {
        uid: cuid,
        base: null,
        name: 'ID',
        deleted: false,
        id: null,
        type: 'NUMBER',
        notNull: true,
        default: null,
        identity: null,
        virtual: false,
        comment: null,
      },
    ],
    constraints: [
      {
        uid: newId('k'),
        base: null,
        name: 'NOTE_PK',
        deleted: false,
        type: 'P',
        columns: [{ columnUid: cuid }],
        condition: null,
        refOwner: null,
        refTableUid: null,
        refTable: null,
        refColumns: [],
        deleteRule: null,
        disabled: false,
        generated: false,
      },
    ],
    indexes: [],
  };

  const snap = projectDraft(draft);
  assert.deepEqual(snap.tables.NOTE.columns.map((c) => c.name), ['ID']);
  assert.deepEqual(snap.tables.NOTE.constraints[0].columns, ['ID']);
});

test('gli id generati per la UI non collidono con quelli importati', () => {
  const draft = importSnapshot(demo());
  const used = new Set(Object.keys(draft.tables));
  for (let i = 0; i < 50; i++) assert.equal(used.has(newId('t')), false);
});
