import test from 'node:test';
import assert from 'node:assert/strict';
import { importSnapshot, newId } from '../src/graph/model.js';
import { buildApplyPlan } from '../src/graph/apply.js';
import { demo, draftColumn, draftTable } from './fixtures.js';

const NOW = new Date(2026, 6, 29, 12, 0);
const plan = (draft, base, options = {}) => buildApplyPlan(draft, base, { now: NOW, ...options });

const addColumn = (table, name, type, extra = {}) => {
  const column = {
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
    ...extra,
  };
  table.columns.push(column);
  return column;
};

/* ---- il caso che conta di più ---- */

test('un diagramma non modificato non genera niente', () => {
  const base = demo();
  const p = plan(importSnapshot(base), base);
  assert.equal(p.sql, '');
  assert.equal(p.stats.statements, 0);
  assert.deepEqual(p.errors, []);
  assert.equal(p.items.every((it) => it.status === 'same'), true);
});

/* ---- creazioni e modifiche ---- */

test('una colonna aggiunta diventa un ALTER TABLE ADD', () => {
  const base = demo();
  const draft = importSnapshot(base);
  addColumn(draftTable(draft, 'ORDINI'), 'NOTE', 'VARCHAR2(200 CHAR)');

  const p = plan(draft, base);
  assert.match(p.sql, /ALTER TABLE "APP"\."ORDINI" ADD \(\s*"NOTE" VARCHAR2\(200 CHAR\)\s*\)/);
  assert.equal(p.stats.renames, 0);
});

test('cambiare il tipo di una colonna diventa un MODIFY', () => {
  const base = demo();
  const draft = importSnapshot(base);
  draftColumn(draft, 'ORDINI', 'TOTALE').type = 'NUMBER(14,4)';

  const p = plan(draft, base);
  assert.match(p.sql, /ALTER TABLE "APP"\."ORDINI" MODIFY \("TOTALE" NUMBER\(14,4\)\)/);
});

test('una tabella nuova diventa una CREATE TABLE con la sua chiave', () => {
  const base = demo();
  const draft = importSnapshot(base);
  const uid = newId('t');
  const nuova = {
    uid,
    base: null,
    name: 'NOTE',
    deleted: false,
    comment: 'Note libere',
    temporary: false,
    onCommit: null,
    columns: [],
    constraints: [],
    indexes: [],
  };
  draft.tables[uid] = nuova;
  const id = addColumn(nuova, 'ID', 'NUMBER(10)', { notNull: true });
  addColumn(nuova, 'TESTO', 'VARCHAR2(400 CHAR)');
  nuova.constraints.push({
    uid: newId('k'),
    base: null,
    name: 'NOTE_PK',
    deleted: false,
    type: 'P',
    columns: [{ columnUid: id.uid }],
    condition: null,
    refOwner: null,
    refTableUid: null,
    refTable: null,
    refColumns: [],
    deleteRule: null,
    disabled: false,
    generated: false,
  });

  const p = plan(draft, base);
  assert.match(p.sql, /CREATE TABLE "APP"\."NOTE"/);
  assert.match(p.sql, /CONSTRAINT "NOTE_PK" PRIMARY KEY \("ID"\)/);
  assert.match(p.sql, /COMMENT ON TABLE "APP"\."NOTE" IS 'Note libere'/);
  assert.equal(p.stats.created, 1);
});

test('una FK disegnata diventa un ADD CONSTRAINT con la sua ON DELETE', () => {
  const base = demo();
  const draft = importSnapshot(base);
  const ordini = draftTable(draft, 'ORDINI');
  const clienti = draftTable(draft, 'CLIENTI');
  const referente = addColumn(ordini, 'REFERENTE_ID', 'NUMBER(10)');
  ordini.constraints.push({
    uid: newId('k'),
    base: null,
    name: 'ORDINI_FK_REFERENTE',
    deleted: false,
    type: 'R',
    columns: [{ columnUid: referente.uid }],
    condition: null,
    refOwner: 'APP',
    refTableUid: clienti.uid,
    refTable: 'CLIENTI',
    refColumns: [{ columnUid: clienti.columns[0].uid }],
    deleteRule: 'SET NULL',
    disabled: false,
    generated: false,
  });

  const p = plan(draft, base);
  assert.match(
    p.sql,
    /ADD CONSTRAINT "ORDINI_FK_REFERENTE" FOREIGN KEY \("REFERENTE_ID"\) REFERENCES "APP"\."CLIENTI" \("ID"\) ON DELETE SET NULL/
  );
});

test('cambiare un commento genera solo il COMMENT ON', () => {
  const base = demo();
  const draft = importSnapshot(base);
  draftColumn(draft, 'CLIENTI', 'NOME').comment = 'Denominazione';

  const p = plan(draft, base);
  assert.match(p.sql, /COMMENT ON COLUMN "APP"\."CLIENTI"\."NOME" IS 'Denominazione'/);
  assert.equal(p.stats.statements, 1);
});

/* ---- eliminazioni ---- */

test('eliminare una tabella la elimina davvero: qui è un atto esplicito', () => {
  const base = demo();
  const draft = importSnapshot(base);
  draftTable(draft, 'ORDINI').deleted = true;

  const p = plan(draft, base);
  assert.match(p.sql, /DROP TABLE "APP"\."ORDINI" CASCADE CONSTRAINTS/);
  assert.equal(p.stats.dropped, 1);
});

test('con le eliminazioni escluse resta solo la nota in testa', () => {
  const base = demo();
  const draft = importSnapshot(base);
  draftTable(draft, 'ORDINI').deleted = true;

  const p = plan(draft, base, { includeDrops: false });
  assert.doesNotMatch(p.sql, /DROP TABLE/);
  assert.match(p.sql, /1 eliminazioni richieste nel diagramma NON vengono applicate/);
});

test('eliminare una colonna genera il DROP della colonna', () => {
  const base = demo();
  const draft = importSnapshot(base);
  draftColumn(draft, 'ORDINI', 'TOTALE').deleted = true;

  const p = plan(draft, base);
  assert.match(p.sql, /ALTER TABLE "APP"\."ORDINI" DROP \("TOTALE"\)/);
});

/* ---- rinomine ---- */

test('le rinomine stanno in cima, in una sezione a parte', () => {
  const base = demo();
  const draft = importSnapshot(base);
  draftTable(draft, 'CLIENTI').name = 'ANAGRAFICHE';

  const p = plan(draft, base);
  assert.match(p.sql, /-- RINOMINE/);
  assert.match(p.sql, /ALTER TABLE "APP"\."CLIENTI" RENAME TO "ANAGRAFICHE";/);
  assert.deepEqual(p.statements, [`ALTER TABLE "APP"."CLIENTI" RENAME TO "ANAGRAFICHE"`]);
  // la rinomina è tutto: nessuno propone di ricreare la tabella
  assert.doesNotMatch(p.sql, /CREATE TABLE/);
  assert.doesNotMatch(p.sql, /DROP TABLE/);
  assert.equal(p.stats.created, 0);
  assert.equal(p.stats.dropped, 0);
});

test('rinominare una colonna e cambiarne il tipo produce prima il RENAME poi il MODIFY', () => {
  const base = demo();
  const draft = importSnapshot(base);
  const totale = draftColumn(draft, 'ORDINI', 'TOTALE');
  totale.name = 'IMPORTO';
  totale.type = 'NUMBER(14,4)';

  const p = plan(draft, base);
  const rename = p.sql.indexOf('RENAME COLUMN "TOTALE" TO "IMPORTO"');
  const modify = p.sql.indexOf('MODIFY ("IMPORTO" NUMBER(14,4))');
  assert.ok(rename > 0, 'manca la rinomina');
  assert.ok(modify > rename, 'il MODIFY deve venire dopo la rinomina e usare il nome nuovo');
});

test('rinominando la tabella padre la FK figlia non viene toccata', () => {
  const base = demo();
  const draft = importSnapshot(base);
  draftTable(draft, 'CLIENTI').name = 'ANAGRAFICHE';

  const p = plan(draft, base);
  assert.doesNotMatch(p.sql, /DROP CONSTRAINT/);
  assert.doesNotMatch(p.sql, /ADD CONSTRAINT/);
});

/* ---- errori e avvisi ---- */

test('un errore di rinomina blocca lo script invece di generarne uno storto', () => {
  const base = demo();
  const draft = importSnapshot(base);
  draftTable(draft, 'CLIENTI').name = 'ORDINI';

  const p = plan(draft, base);
  assert.equal(p.sql, '');
  assert.equal(p.errors.length, 1);
});

test('gli avvisi finiscono in testa allo script', () => {
  const base = demo();
  const draft = importSnapshot(base);
  draftColumn(draft, 'CLIENTI', 'STATO').name = 'STATO_CLIENTE';

  const p = plan(draft, base);
  assert.match(p.sql, /-- Avviso: .*CHECK CLIENTI_CK_STATO cita STATO/);
});

test("l'intestazione dice schema e data", () => {
  const base = demo();
  const draft = importSnapshot(base);
  addColumn(draftTable(draft, 'ORDINI'), 'NOTE', 'VARCHAR2(10)');

  const p = plan(draft, base, { schemaLabel: 'APP su Collaudo' });
  assert.match(p.sql, /-- Schema \.+ APP su Collaudo/);
  assert.match(p.sql, /-- Generato \.+ 29\/07\/2026 12:00/);
  assert.doesNotMatch(p.sql, /Script di sincronizzazione/);
});
