import test from 'node:test';
import assert from 'node:assert/strict';
import { isReadOnlyStatement, assertWritable } from '../src/readonly.js';

const ro = isReadOnlyStatement;

test('le interrogazioni sono in sola lettura', () => {
  assert.equal(ro('SELECT * FROM clienti'), true);
  assert.equal(ro('  select 1 from dual  '), true);
  assert.equal(ro('SELECT /*+ FULL(t) */ * FROM t'), true);
  assert.equal(ro('SELECT 1 FROM dual;'), true);
});

test('i commenti iniziali non ingannano', () => {
  assert.equal(ro('-- estrazione mensile\nSELECT * FROM t'), true);
  assert.equal(ro('/* nota\n   su due righe */ SELECT * FROM t'), true);
  assert.equal(ro('-- INSERT INTO t VALUES (1)\nSELECT * FROM t'), true);
  assert.equal(ro('/* DELETE */ SELECT * FROM t'), true);
});

test('le CTE si giudicano sull\'operazione finale', () => {
  assert.equal(ro('WITH x AS (SELECT 1 a FROM dual) SELECT * FROM x'), true);
  assert.equal(ro('WITH x AS (SELECT 1 a FROM dual) INSERT INTO t SELECT * FROM x'), false);
  assert.equal(ro('WITH x AS (SELECT id FROM t) DELETE FROM u WHERE id IN (SELECT id FROM x)'), false);
  assert.equal(ro('WITH x AS (SELECT 1 FROM dual) UPDATE t SET a = 1'), false);
  assert.equal(ro('WITH x AS (SELECT 1 FROM dual) MERGE INTO t USING x ON (1=1) WHEN MATCHED THEN UPDATE SET a=1'), false);
  // Una colonna che contiene la parola non è un'operazione.
  assert.equal(ro('WITH x AS (SELECT deleted_flag FROM t) SELECT * FROM x'), true);
});

test('le scritture sono riconosciute', () => {
  assert.equal(ro('INSERT INTO t VALUES (1)'), false);
  assert.equal(ro('UPDATE t SET a = 1'), false);
  assert.equal(ro('DELETE FROM t WHERE id = 1'), false);
  assert.equal(ro('MERGE INTO t USING s ON (1=1) WHEN MATCHED THEN UPDATE SET a=1'), false);
  assert.equal(ro('CREATE TABLE t (a NUMBER)'), false);
  assert.equal(ro('DROP TABLE t'), false);
  assert.equal(ro('TRUNCATE TABLE t'), false);
  assert.equal(ro('GRANT SELECT ON t TO hr'), false);
  assert.equal(ro('COMMIT'), false);
});

test('i blocchi PL/SQL contano come scrittura', () => {
  assert.equal(ro('BEGIN pkg.aggiorna(1); END;'), false);
  assert.equal(ro('BEGIN NULL; END;'), false);
  assert.equal(ro('DECLARE n NUMBER; BEGIN SELECT 1 INTO n FROM dual; END;'), false);
  assert.equal(ro("CALL pkg.aggiorna('x')"), false);
});

test('SELECT … FOR UPDATE scrive: blocca le righe', () => {
  assert.equal(ro('SELECT * FROM t FOR UPDATE'), false);
  assert.equal(ro('SELECT * FROM t ORDER BY a FOR UPDATE OF a NOWAIT'), false);
  // «for update» dentro un letterale resta testo.
  assert.equal(ro("SELECT 'for update' FROM dual"), true);
  assert.equal(ro("SELECT * FROM t WHERE nota = 'INSERT'"), true);
});

test('EXPLAIN, DESCRIBE, SET e le impostazioni NLS passano', () => {
  assert.equal(ro('EXPLAIN PLAN FOR SELECT 1 FROM dual'), true);
  assert.equal(ro('DESC clienti'), true);
  assert.equal(ro('DESCRIBE hr.clienti'), true);
  assert.equal(ro('SET SERVEROUTPUT ON'), true);
  assert.equal(ro("ALTER SESSION SET NLS_DATE_FORMAT = 'YYYY-MM-DD'"), true);
  // Gli altri ALTER SESSION no: cambiano come si comporta la sessione.
  assert.equal(ro('ALTER SESSION SET current_schema = HR'), false);
  assert.equal(ro('ALTER TABLE t ADD (b NUMBER)'), false);
});

test('più istruzioni insieme e testo vuoto non passano', () => {
  assert.equal(ro('SELECT 1 FROM dual; DELETE FROM t'), false);
  assert.equal(ro(''), false);
  assert.equal(ro('   \n  '), false);
  assert.equal(ro(null), false);
  assert.equal(ro(undefined), false);
  assert.equal(ro('PIPPO qualcosa'), false);
});

test('assertWritable blocca solo le connessioni in sola lettura', () => {
  assert.doesNotThrow(() => assertWritable({}, 'DELETE FROM t'));
  assert.doesNotThrow(() => assertWritable(undefined, 'DELETE FROM t'));
  assert.doesNotThrow(() => assertWritable({ readOnly: true }, 'SELECT * FROM t'));
  assert.throws(
    () => assertWritable({ readOnly: true }, 'DELETE FROM t'),
    (err) => err.readOnly === true && /^Connessione in sola lettura: «DELETE»/.test(err.message)
  );
  assert.throws(
    () => assertWritable({ readOnly: true }, 'COMMIT'),
    /Connessione in sola lettura/
  );
});

test('un SELECT fra parentesi resta una lettura', () => {
  assert.equal(
    isReadOnlyStatement('(SELECT id FROM clienti) UNION ALL (SELECT id FROM fornitori)'),
    true
  );
  assert.equal(isReadOnlyStatement('  ( ( SELECT 1 FROM dual ) )'), true);
  // La parentesi non deve diventare un modo per far passare una scrittura.
  assert.equal(isReadOnlyStatement('(DELETE FROM clienti)'), false);
});
