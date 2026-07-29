// La giuntura fra client e server.
//
// Il client costruisce tabelle, colonne e vincoli con le sue fabbriche
// (`client/src/graph/mutations.js`), il server li proietta e ne ricava il DDL.
// Sono build separate e non possono condividere il modulo: se una delle due
// forme si sposta, l'unica cosa che se ne accorge è questo test — perciò
// l'importazione attraversa i due pacchetti, cosa che il codice a runtime non
// fa mai.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addColumn,
  addForeignKey,
  addTable,
  emptyColumn,
  emptyIndex,
  emptyTable,
  addIndex,
  pkColumnUids,
} from '../../client/src/graph/mutations.js';
import { importSnapshot, projectDraft } from '../src/graph/model.js';
import { buildApplyPlan } from '../src/graph/apply.js';
import { demo, snapshot } from './fixtures.js';

const emptyDraft = (owner = 'APP') => ({ owner, tables: {}, sequences: {}, rest: {} });

test('una tabella costruita dal client si proietta in uno snapshot valido', () => {
  const t = emptyTable('NOTE');
  const draft = addTable(emptyDraft(), t);
  const snap = projectDraft(draft);

  assert.deepEqual(Object.keys(snap.tables), ['NOTE']);
  assert.deepEqual(snap.tables.NOTE.columns.map((c) => c.name), ['ID']);
  assert.deepEqual(snap.tables.NOTE.constraints, [
    {
      name: 'NOTE_PK',
      type: 'P',
      columns: ['ID'],
      condition: null,
      refOwner: null,
      refTable: null,
      refColumns: [],
      deleteRule: null,
      disabled: false,
      generated: false,
    },
  ]);
});

test('quello che il client disegna da zero diventa CREATE TABLE e FOREIGN KEY', () => {
  const clienti = emptyTable('CLIENTI');
  const ordini = emptyTable('ORDINI');
  let draft = addTable(addTable(emptyDraft(), clienti), ordini);
  draft = addColumn(draft, ordini.uid, emptyColumn('CLIENTE_ID', 'NUMBER(10)'));
  const clienteId = draft.tables[ordini.uid].columns.at(-1);
  draft = addForeignKey(draft, {
    fromTableUid: ordini.uid,
    fromColumnUids: [clienteId.uid],
    toTableUid: clienti.uid,
    toColumnUids: pkColumnUids(clienti),
  });
  draft = addIndex(
    draft,
    ordini.uid,
    emptyIndex('ORDINI_IX_CLIENTE', [{ columnUid: clienteId.uid, desc: false }])
  );

  const plan = buildApplyPlan(draft, snapshot('APP'), {});
  assert.deepEqual(plan.errors, []);
  assert.match(plan.sql, /CREATE TABLE "APP"\."CLIENTI"/);
  assert.match(plan.sql, /CREATE TABLE "APP"\."ORDINI"/);
  assert.match(plan.sql, /CONSTRAINT "ORDINI_FK_CLIENTI" FOREIGN KEY \("CLIENTE_ID"\) REFERENCES "APP"\."CLIENTI" \("ID"\)/);
  assert.match(plan.sql, /CREATE INDEX "APP"\."ORDINI_IX_CLIENTE" ON "APP"\."ORDINI" \("CLIENTE_ID"\)/);
});

test('una colonna aggiunta dal client a una tabella letta dal database diventa un ADD', () => {
  const base = demo();
  const draft = importSnapshot(base);
  const ordini = Object.values(draft.tables).find((t) => t.base === 'ORDINI');
  const next = addColumn(draft, ordini.uid, emptyColumn('SPEDITO_IL', 'DATE'));

  const plan = buildApplyPlan(next, base, {});
  assert.match(plan.sql, /ALTER TABLE "APP"\."ORDINI" ADD \(\s*"SPEDITO_IL" DATE\s*\)/);
  assert.equal(plan.stats.statements, 1);
});

test('una FK disegnata dal client fra due tabelle esistenti non ricrea nulla', () => {
  const base = demo();
  const draft = importSnapshot(base);
  const clienti = Object.values(draft.tables).find((t) => t.base === 'CLIENTI');
  const ordini = Object.values(draft.tables).find((t) => t.base === 'ORDINI');
  let next = addColumn(draft, ordini.uid, emptyColumn('REFERENTE_ID', 'NUMBER(10)'));
  next = addForeignKey(next, {
    fromTableUid: ordini.uid,
    fromColumnUids: [next.tables[ordini.uid].columns.at(-1).uid],
    toTableUid: clienti.uid,
    toColumnUids: pkColumnUids(clienti),
  });

  const plan = buildApplyPlan(next, base, {});
  assert.doesNotMatch(plan.sql, /CREATE TABLE/);
  assert.doesNotMatch(plan.sql, /DROP/);
  assert.match(plan.sql, /ADD CONSTRAINT "ORDINI_FK_CLIENTI_2" FOREIGN KEY \("REFERENTE_ID"\)/);
});
