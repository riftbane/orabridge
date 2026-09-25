import test from 'node:test';
import assert from 'node:assert/strict';
import { splitStatements, statementAt } from '../src/sqlSplit.js';

const texts = (sql) => splitStatements(sql).map((s) => s.text.trim());

test('DESC finisce a capo anche senza punto e virgola', () => {
  assert.deepEqual(texts('desc emp\nselect * from dual;'), ['desc emp', 'select * from dual;']);
  assert.deepEqual(texts('DESCRIBE scott.emp;\ndesc dept'), ['DESCRIBE scott.emp;', 'desc dept']);
});

test('il cursore su una riga DESC prende solo quella', () => {
  const doc = 'desc emp\nselect 1\nfrom dual;';
  assert.equal(statementAt(doc, 3).text.trim(), 'desc emp');
  assert.equal(statementAt(doc, 12).text.trim(), 'select 1\nfrom dual;');
});

test('le altre istruzioni continuano su più righe', () => {
  assert.deepEqual(texts('select *\nfrom emp\norder by sal desc;'), ['select *\nfrom emp\norder by sal desc;']);
  assert.deepEqual(texts('begin\n  null;\nend;\n/\ndesc emp'), ['begin\n  null;\nend;', 'desc emp']);
});
