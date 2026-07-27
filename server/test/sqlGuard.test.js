import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySql, stripSql } from '../src/ai/sqlGuard.js';

const level = (sql) => classifySql(sql).level;

test('le letture sono riconosciute', () => {
  assert.equal(level('SELECT * FROM clienti'), 'read');
  assert.equal(level('  select 1 from dual  '), 'read');
  assert.equal(level('WITH x AS (SELECT 1 FROM dual) SELECT * FROM x'), 'read');
  assert.equal(level('EXPLAIN PLAN FOR SELECT 1 FROM dual'), 'read');
});

test('le scritture sono riconosciute', () => {
  assert.equal(level("INSERT INTO t VALUES (1)"), 'write');
  assert.equal(level('UPDATE t SET a = 1'), 'write');
  assert.equal(level('MERGE INTO t USING s ON (1=1) WHEN MATCHED THEN UPDATE SET a=1'), 'write');
  assert.equal(level('CREATE TABLE t (a NUMBER)'), 'write');
  assert.equal(level('ALTER TABLE t ADD (b NUMBER)'), 'write');
  assert.equal(level('COMMENT ON TABLE t IS \'nota\''), 'write');
});

test('DELETE, DROP e TRUNCATE richiedono il permesso pericoloso', () => {
  assert.equal(level('DELETE FROM t WHERE id = 1'), 'danger');
  assert.equal(level('DROP TABLE t'), 'danger');
  assert.equal(level('TRUNCATE TABLE t'), 'danger');
  assert.equal(level('WITH x AS (SELECT 1 FROM dual) DELETE FROM t'), 'danger');
});

test('una parola pericolosa dentro una stringa o un commento non conta', () => {
  assert.equal(level("SELECT 'DROP TABLE t' FROM dual"), 'read');
  assert.equal(level('SELECT 1 FROM dual -- DELETE FROM t'), 'read');
  assert.equal(level('/* DROP */ SELECT 1 FROM dual'), 'read');
  assert.equal(level("INSERT INTO log (msg) VALUES ('delete richiesta')"), 'write');
});

test('i blocchi PL/SQL si classificano sul contenuto', () => {
  assert.equal(level('BEGIN pkg.aggiorna(1); END;'), 'write');
  assert.equal(level('BEGIN DELETE FROM t; END;'), 'danger');
  assert.equal(level("BEGIN EXECUTE IMMEDIATE 'DROP TABLE t'; END;"), 'danger');
  // Il punto e virgola interno al blocco non è "più istruzioni".
  assert.equal(classifySql('BEGIN a(); b(); END;').error, undefined);
});

test('più istruzioni insieme vengono rifiutate', () => {
  const r = classifySql('SELECT 1 FROM dual; DROP TABLE t');
  assert.equal(r.level, null);
  assert.match(r.error, /una sola istruzione/i);
  // Un punto e virgola finale è ammesso.
  assert.equal(level('SELECT 1 FROM dual;'), 'read');
});

test('le istruzioni sconosciute non passano', () => {
  assert.equal(classifySql('PIPPO qualcosa').level, null);
  assert.equal(classifySql('   ').level, null);
});

test('stripSql conserva gli identificatori quotati', () => {
  assert.match(stripSql('SELECT "Colonna" FROM t'), /"Colonna"/);
  assert.doesNotMatch(stripSql("SELECT 'testo' FROM t"), /testo/);
});
