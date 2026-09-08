import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCellUpdateSql,
  buildRowDeleteSql,
  buildRowInsertSql,
  cellExprSql,
} from '../src/ddl.js';

// I letterali prodotti qui devono coincidere con il formato testuale con cui
// il server serializza le celle (server/src/oracle.js): se cambiano lì vanno
// cambiati anche questi test, altrimenti un valore riletto dopo la scrittura
// non tornerebbe uguale a quello scritto.

test('cellExprSql: numeri, date, timestamp, testo e NULL', () => {
  assert.equal(cellExprSql('NUMBER', '42'), '42');
  assert.equal(cellExprSql('NUMBER', '-3.5'), '-3.5');
  assert.equal(cellExprSql('BINARY_DOUBLE', '1e3'), '1000');
  assert.equal(cellExprSql('VARCHAR2', null), 'NULL');
  assert.equal(cellExprSql('NUMBER', null), 'NULL');
  assert.equal(cellExprSql('DATE', null), 'NULL');
  assert.equal(
    cellExprSql('DATE', '2024-03-01 10:00:00'),
    "TO_DATE('2024-03-01 10:00:00', 'YYYY-MM-DD HH24:MI:SS')"
  );
  assert.equal(
    cellExprSql('TIMESTAMP', '2024-03-01 10:00:00'),
    "TO_TIMESTAMP('2024-03-01 10:00:00.0', 'YYYY-MM-DD HH24:MI:SS.FF')"
  );
  assert.equal(cellExprSql('CLOB', "l'ape"), "'l''ape'");
});

test('cellExprSql: un valore numerico non valido è un errore, non un letterale', () => {
  assert.throws(() => cellExprSql('NUMBER', 'pippo'), /Valore numerico non valido/);
});

test('buildCellUpdateSql: numero senza apici, ROWID sempre quotato', () => {
  assert.equal(
    buildCellUpdateSql('HR', 'EMP', 'SAL', 'NUMBER', 'AAAB12AAEAAAAQkAAA', '1500'),
    "UPDATE HR.EMP SET SAL = 1500 WHERE ROWID = 'AAAB12AAEAAAAQkAAA'"
  );
});

test('buildCellUpdateSql: DATE e TIMESTAMP passano dal formato di lettura', () => {
  assert.equal(
    buildCellUpdateSql('HR', 'EMP', 'HIREDATE', 'DATE', 'R1', '2024-03-01 10:00:00'),
    "UPDATE HR.EMP SET HIREDATE = TO_DATE('2024-03-01 10:00:00', 'YYYY-MM-DD HH24:MI:SS') WHERE ROWID = 'R1'"
  );
  // I decimali che il server aggiunge alle DATE non fanno parte del tipo.
  assert.equal(
    buildCellUpdateSql('HR', 'EMP', 'HIREDATE', 'DATE', 'R1', '2024-03-01 10:00:00.000'),
    "UPDATE HR.EMP SET HIREDATE = TO_DATE('2024-03-01 10:00:00', 'YYYY-MM-DD HH24:MI:SS') WHERE ROWID = 'R1'"
  );
  assert.equal(
    buildCellUpdateSql('HR', 'EMP', 'TS', 'TIMESTAMP', 'R1', '2024-03-01 10:00:00.123'),
    "UPDATE HR.EMP SET TS = TO_TIMESTAMP('2024-03-01 10:00:00.123', 'YYYY-MM-DD HH24:MI:SS.FF') WHERE ROWID = 'R1'"
  );
});

test('buildCellUpdateSql: NULL esplicito e apici raddoppiati', () => {
  assert.equal(
    buildCellUpdateSql('HR', 'EMP', 'ENAME', 'VARCHAR2', 'R1', null),
    "UPDATE HR.EMP SET ENAME = NULL WHERE ROWID = 'R1'"
  );
  assert.equal(
    buildCellUpdateSql('HR', 'EMP', 'ENAME', 'VARCHAR2', "R'1", "O'Brien"),
    `UPDATE HR.EMP SET ENAME = 'O''Brien' WHERE ROWID = 'R''1'`
  );
});

test('buildCellUpdateSql: identificatori da quotare', () => {
  assert.equal(
    buildCellUpdateSql('mio schema', 'Mia Tab', 'Col 1', 'VARCHAR2', 'R1', 'x'),
    `UPDATE "mio schema"."Mia Tab" SET "Col 1" = 'x' WHERE ROWID = 'R1'`
  );
  // I nomi regolari restano non quotati e vanno in maiuscolo.
  assert.equal(
    buildCellUpdateSql('hr', 'emp', 'ename', 'VARCHAR2', 'R1', 'x'),
    `UPDATE HR.EMP SET ENAME = 'x' WHERE ROWID = 'R1'`
  );
});

const COLS = [
  { name: 'ID', type: 'NUMBER' },
  { name: 'ENAME', type: 'VARCHAR2' },
  { name: 'HIREDATE', type: 'DATE' },
];

test('buildRowInsertSql: solo le colonne valorizzate finiscono nella lista', () => {
  assert.equal(
    buildRowInsertSql('HR', 'EMP', COLS, ['7', "O'Brien", '2024-03-01 10:00:00']),
    "INSERT INTO HR.EMP (ID, ENAME, HIREDATE) VALUES (7, 'O''Brien', " +
      "TO_DATE('2024-03-01 10:00:00', 'YYYY-MM-DD HH24:MI:SS'))"
  );
  // undefined = colonna omessa (prende il DEFAULT), null = NULL esplicito.
  assert.equal(
    buildRowInsertSql('HR', 'EMP', COLS, ['7', null, undefined]),
    "INSERT INTO HR.EMP (ID, ENAME) VALUES (7, NULL)"
  );
  // Un array più corto lascia omesse le colonne in coda.
  assert.equal(
    buildRowInsertSql('HR', 'EMP', COLS, ['7']),
    'INSERT INTO HR.EMP (ID) VALUES (7)'
  );
});

test('buildRowInsertSql: senza nemmeno una colonna restituisce null', () => {
  assert.equal(buildRowInsertSql('HR', 'EMP', COLS, [undefined, undefined, undefined]), null);
  assert.equal(buildRowInsertSql('HR', 'EMP', COLS, []), null);
  assert.equal(buildRowInsertSql('HR', 'EMP', [], []), null);
});

test('buildRowInsertSql: identificatori da quotare e valore numerico non valido', () => {
  assert.equal(
    buildRowInsertSql('mio schema', 'Mia Tab', [{ name: 'Col 1', type: 'VARCHAR2' }], ['x']),
    `INSERT INTO "mio schema"."Mia Tab" ("Col 1") VALUES ('x')`
  );
  assert.throws(
    () => buildRowInsertSql('HR', 'EMP', COLS, ['non un numero']),
    /Valore numerico non valido/
  );
});

test('buildRowDeleteSql: DELETE per ROWID con apici raddoppiati', () => {
  assert.equal(
    buildRowDeleteSql('HR', 'EMP', 'AAAB12AAEAAAAQkAAA'),
    "DELETE FROM HR.EMP WHERE ROWID = 'AAAB12AAEAAAAQkAAA'"
  );
  assert.equal(
    buildRowDeleteSql('mio schema', 'Mia Tab', "R'1"),
    `DELETE FROM "mio schema"."Mia Tab" WHERE ROWID = 'R''1'`
  );
});
