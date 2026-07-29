import test from 'node:test';
import assert from 'node:assert/strict';
import { importSnapshot } from '../src/graph/model.js';
import { renamePass } from '../src/graph/rename.js';
import { byName, col, cons, demo, draftColumn, draftTable, idx, snapshot, table } from './fixtures.js';

const has = (list, rx) => list.some((s) => rx.test(s));

/* ---- istruzioni ---- */

test('senza rinomine non si emette nulla e la base resta uguale', () => {
  const base = demo();
  const r = renamePass(importSnapshot(base), base);
  assert.deepEqual(r.statements, []);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.rebased.tables, base.tables);
});

test('rinominare una tabella emette RENAME TO e ribasa la chiave', () => {
  const base = demo();
  const draft = importSnapshot(base);
  draftTable(draft, 'CLIENTI').name = 'ANAGRAFICHE';

  const r = renamePass(draft, base);
  assert.deepEqual(r.statements, [`ALTER TABLE "APP"."CLIENTI" RENAME TO "ANAGRAFICHE"`]);
  assert.ok(r.rebased.tables.ANAGRAFICHE);
  assert.equal(r.rebased.tables.CLIENTI, undefined);
  assert.equal(r.rebased.tables.ANAGRAFICHE.name, 'ANAGRAFICHE');
});

test('rinominare una tabella ribasa anche le FK che la referenziano', () => {
  const base = demo();
  const draft = importSnapshot(base);
  draftTable(draft, 'CLIENTI').name = 'ANAGRAFICHE';

  const { rebased } = renamePass(draft, base);
  const foreign = rebased.tables.ORDINI.constraints.find((c) => c.type === 'R');
  assert.equal(foreign.refTable, 'ANAGRAFICHE');
});

test('rinominare una colonna ribasa colonna, vincolo, indice e FK entranti', () => {
  const base = demo();
  const draft = importSnapshot(base);
  draftColumn(draft, 'CLIENTI', 'ID').name = 'CLIENTE_ID';

  const r = renamePass(draft, base);
  assert.deepEqual(r.statements, [
    `ALTER TABLE "APP"."CLIENTI" RENAME COLUMN "ID" TO "CLIENTE_ID"`,
  ]);
  const t = r.rebased.tables.CLIENTI;
  assert.deepEqual(t.columns.map((c) => c.name), ['CLIENTE_ID', 'NOME', 'STATO']);
  assert.deepEqual(t.constraints.find((c) => c.type === 'P').columns, ['CLIENTE_ID']);
  assert.deepEqual(t.indexes.find((i) => i.name === 'CLIENTI_PK').columns, ['CLIENTE_ID']);
  const foreign = r.rebased.tables.ORDINI.constraints.find((c) => c.type === 'R');
  assert.deepEqual(foreign.refColumns, ['CLIENTE_ID']);
});

test('la rinomina della tabella viene prima, e le colonne usano già il nome nuovo', () => {
  const base = demo();
  const draft = importSnapshot(base);
  const t = draftTable(draft, 'CLIENTI');
  t.name = 'ANAGRAFICHE';
  t.columns.find((c) => c.base === 'NOME').name = 'RAGIONE_SOCIALE';

  const { statements } = renamePass(draft, base);
  assert.deepEqual(statements, [
    `ALTER TABLE "APP"."CLIENTI" RENAME TO "ANAGRAFICHE"`,
    `ALTER TABLE "APP"."ANAGRAFICHE" RENAME COLUMN "NOME" TO "RAGIONE_SOCIALE"`,
  ]);
});

test('vincoli e indici si rinominano con le loro istruzioni', () => {
  const base = demo();
  const draft = importSnapshot(base);
  const t = draftTable(draft, 'ORDINI');
  t.constraints.find((c) => c.base === 'ORDINI_FK_CLIENTI').name = 'FK_ORDINI_CLIENTI';
  t.indexes.find((i) => i.base === 'ORDINI_IX_CLIENTE').name = 'IX_ORDINI_CLIENTE';

  const r = renamePass(draft, base);
  assert.ok(has(r.statements, /RENAME CONSTRAINT "ORDINI_FK_CLIENTI" TO "FK_ORDINI_CLIENTI"/));
  assert.ok(has(r.statements, /ALTER INDEX "APP"\."ORDINI_IX_CLIENTE" RENAME TO "IX_ORDINI_CLIENTE"/));
  assert.ok(r.rebased.tables.ORDINI.constraints.some((c) => c.name === 'FK_ORDINI_CLIENTI'));
  assert.ok(r.rebased.tables.ORDINI.indexes.some((i) => i.name === 'IX_ORDINE_CLIENTE') === false);
  assert.ok(r.rebased.tables.ORDINI.indexes.some((i) => i.name === 'IX_ORDINI_CLIENTE'));
});

test('un vincolo con nome di sistema non si rinomina: si rifà', () => {
  const base = snapshot('APP', {
    tables: byName([
      table('T', [col('A', 'NUMBER')], { constraints: [cons('SYS_C0012345', 'P', ['A'], { generated: true })] }),
    ]),
  });
  const draft = importSnapshot(base);
  draft.tables.t1.constraints[0].name = 'T_PK';
  assert.deepEqual(renamePass(draft, base).statements, []);
});

/* ---- ordine e collisioni ---- */

test('una catena di rinomine viene ordinata liberando prima il nome', () => {
  const base = snapshot('APP', {
    tables: byName([table('A', [col('X', 'NUMBER')]), table('B', [col('X', 'NUMBER')])]),
  });
  const draft = importSnapshot(base);
  draftTable(draft, 'A').name = 'B';
  draftTable(draft, 'B').name = 'C';

  const { statements, errors } = renamePass(draft, base);
  assert.deepEqual(errors, []);
  assert.deepEqual(statements, [
    `ALTER TABLE "APP"."B" RENAME TO "C"`,
    `ALTER TABLE "APP"."A" RENAME TO "B"`,
  ]);
});

test('uno scambio di nomi viene rifiutato invece di essere inventato', () => {
  const base = snapshot('APP', {
    tables: byName([table('A', [col('X', 'NUMBER')]), table('B', [col('X', 'NUMBER')])]),
  });
  const draft = importSnapshot(base);
  draftTable(draft, 'A').name = 'B';
  draftTable(draft, 'B').name = 'A';

  const { errors, statements } = renamePass(draft, base);
  assert.equal(statements.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /scambio di nomi non supportato/);
});

test('rinominare su un nome già occupato è un errore', () => {
  const base = demo();
  const draft = importSnapshot(base);
  draftTable(draft, 'CLIENTI').name = 'ORDINI';

  const { errors } = renamePass(draft, base);
  assert.match(errors[0], /il nome è già occupato/);
});

test('due colonne che finirebbero con lo stesso nome sono un errore', () => {
  const base = demo();
  const draft = importSnapshot(base);
  const t = draftTable(draft, 'CLIENTI');
  t.columns.find((c) => c.base === 'NOME').name = 'X';
  t.columns.find((c) => c.base === 'STATO').name = 'X';

  const { errors } = renamePass(draft, base);
  assert.match(errors[0], /verrebbero a chiamarsi X/);
});

test('lo scambio di colonne dentro una tabella è rifiutato come per le tabelle', () => {
  const base = demo();
  const draft = importSnapshot(base);
  const t = draftTable(draft, 'CLIENTI');
  t.columns.find((c) => c.base === 'NOME').name = 'STATO';
  t.columns.find((c) => c.base === 'STATO').name = 'NOME';

  const { errors } = renamePass(draft, base);
  assert.match(errors[0], /Colonne di CLIENTI: scambio di nomi/);
});

/* ---- deriva ---- */

test('una tabella sparita dal database blocca tutto con un messaggio chiaro', () => {
  const base = demo();
  const draft = importSnapshot(base);
  delete base.tables.ORDINI;

  const { errors } = renamePass(draft, base);
  assert.match(errors[0], /ORDINI non esiste più nel database/);
});

/* ---- avvisi ---- */

test('un CHECK che cita una colonna rinominata produce un avviso, non una riscrittura', () => {
  const base = demo();
  const draft = importSnapshot(base);
  draftColumn(draft, 'CLIENTI', 'STATO').name = 'STATO_CLIENTE';

  const r = renamePass(draft, base);
  assert.equal(r.errors.length, 0);
  assert.ok(r.warnings.some((w) => /CHECK CLIENTI_CK_STATO cita STATO/.test(w)));
  // il testo della condizione resta intatto
  assert.equal(
    r.rebased.tables.CLIENTI.constraints.find((c) => c.type === 'C').condition,
    "STATO IN ('A','S')"
  );
});

test('un indice funzionale che cita una colonna rinominata produce un avviso', () => {
  const base = snapshot('APP', {
    tables: byName([
      table('T', [col('NOME', 'VARCHAR2(10)')], { indexes: [idx('T_IX', ['UPPER("NOME")'])] }),
    ]),
  });
  const draft = importSnapshot(base);
  draft.tables.t1.columns[0].name = 'DENOMINAZIONE';

  const r = renamePass(draft, base);
  assert.ok(r.warnings.some((w) => /indice funzionale T_IX cita NOME/.test(w)));
  assert.deepEqual(r.rebased.tables.T.indexes[0].columns, ['UPPER("NOME")']);
});

test('un DEFAULT che cita una colonna rinominata produce un avviso', () => {
  const base = snapshot('APP', {
    tables: byName([
      table('T', [col('A', 'NUMBER'), col('B', 'NUMBER', { default: 'A + 1' })]),
    ]),
  });
  const draft = importSnapshot(base);
  draft.tables.t1.columns[0].name = 'AA';

  const r = renamePass(draft, base);
  assert.ok(r.warnings.some((w) => /il DEFAULT cita A/.test(w)));
});
