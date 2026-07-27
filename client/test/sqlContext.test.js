import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, tokenize } from '../src/sqlContext.js';

// Il cursore nelle stringhe di prova è segnato con "|".
function at(sql) {
  const pos = sql.indexOf('|');
  assert.ok(pos >= 0, 'manca il marcatore del cursore');
  return analyze(sql.slice(0, pos) + sql.slice(pos + 1), pos);
}

const names = (info) => info.refs.map((r) => [r.owner, r.name, r.alias]);

test('tokenize salta commenti e riconosce stringhe e identificatori quotati', () => {
  const toks = tokenize(`-- commento\nSELECT 'a''b', "Mia Tab" /* x */ FROM t`);
  assert.deepEqual(
    toks.map((t) => [t.k, t.v]),
    [
      ['id', 'SELECT'],
      ['str', "'a''b'"],
      ['punc', ','],
      ['qid', 'Mia Tab'],
      ['id', 'FROM'],
      ['id', 'T'],
    ]
  );
});

test('tabella con alias e clausola al cursore', () => {
  const info = at('SELECT * FROM emp e WHERE e.|');
  assert.deepEqual(names(info), [[null, 'EMP', 'E']]);
  assert.equal(info.clause, 'where');
});

test('lista di tabelle separate da virgola', () => {
  const info = at('SELECT | FROM emp e, dept AS d, "Mia Tab" m');
  assert.deepEqual(names(info), [
    [null, 'EMP', 'E'],
    [null, 'DEPT', 'D'],
    [null, 'Mia Tab', 'M'],
  ]);
  assert.equal(info.clause, 'select');
});

test('schema qualificato e dblink', () => {
  const info = at('SELECT * FROM scott.emp@prod e WHERE |');
  assert.deepEqual(names(info), [['SCOTT', 'EMP', 'E']]);
});

test('parola chiave dopo la tabella non diventa alias', () => {
  assert.deepEqual(names(at('SELECT * FROM emp WHERE |')), [[null, 'EMP', null]]);
  assert.deepEqual(names(at('SELECT * FROM emp ORDER BY |')), [[null, 'EMP', null]]);
  assert.deepEqual(names(at('DELETE FROM emp WHERE |')), [[null, 'EMP', null]]);
});

test('join: clausola ON e tabella di destinazione', () => {
  const info = at('SELECT * FROM emp e JOIN dept d ON |');
  assert.equal(info.clause, 'on');
  assert.equal(info.joinRef.name, 'DEPT');
  assert.deepEqual(names(info), [
    [null, 'EMP', 'E'],
    [null, 'DEPT', 'D'],
  ]);
});

test('tabella in scrittura dopo JOIN marcata come "al cursore"', () => {
  const info = at('SELECT * FROM emp e JOIN de|');
  assert.equal(info.clause, 'join');
  assert.deepEqual(
    info.refs.filter((r) => !r.cursor).map((r) => r.name),
    ['EMP']
  );
});

test('UPDATE … SET e MERGE … USING', () => {
  const upd = at('UPDATE emp e SET |');
  assert.equal(upd.clause, 'set');
  assert.deepEqual(names(upd), [[null, 'EMP', 'E']]);

  const mrg = at('MERGE INTO target t USING sorgente s ON (|)');
  assert.deepEqual(names(mrg), [
    [null, 'TARGET', 'T'],
    [null, 'SORGENTE', 'S'],
  ]);
});

test('INSERT INTO con elenco colonne', () => {
  const info = at('INSERT INTO emp (empno, |) VALUES (1, 2)');
  assert.deepEqual(names(info), [[null, 'EMP', null]]);
});

test('CTE: nome, colonne dichiarate e tabelle interne', () => {
  const info = at('WITH x AS (SELECT a FROM emp), y (c1, c2) AS (SELECT 1, 2 FROM dual) SELECT | FROM x');
  assert.deepEqual(
    info.ctes.map((c) => [c.name, c.cols, c.refs.map((r) => r.name)]),
    [
      ['X', null, ['EMP']],
      ['Y', ['C1', 'C2'], ['DUAL']],
    ]
  );
  assert.equal(info.clause, 'select');
  assert.ok(info.refs.some((r) => r.name === 'X'));
});

test('subquery in FROM: alias e tabelle interne', () => {
  const info = at('SELECT * FROM (SELECT * FROM emp) t WHERE |');
  const sub = info.refs.find((r) => r.kind === 'sub');
  assert.equal(sub.alias, 'T');
  assert.deepEqual(sub.refs.map((r) => r.name), ['EMP']);
});

test('cursore dentro una subquery: clausola dello scope interno', () => {
  const info = at('SELECT * FROM emp e WHERE id IN (SELECT | FROM dept d)');
  assert.equal(info.clause, 'select');
  assert.equal(info.depth, 1);
});

test('stile minuscolo riconosciuto dalle parole chiave', () => {
  assert.equal(at('select * from emp where |').lower, true);
  assert.equal(at('SELECT * FROM emp WHERE |').lower, false);
  assert.equal(at('select * FROM emp WHERE |').lower, false);
});

test('istruzione incompleta: FROM senza tabella', () => {
  const info = at('SELECT * FROM |');
  assert.equal(info.clause, 'from');
  assert.deepEqual(names(info), []);
});
