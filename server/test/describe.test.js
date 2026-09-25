import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDescribe, columnType, describe } from '../src/describe.js';

test('riconosce DESC e DESCRIBE', () => {
  assert.deepEqual(parseDescribe('desc emp'), { owner: null, name: 'EMP', dbLink: null, text: 'emp' });
  assert.deepEqual(parseDescribe('DESCRIBE scott.emp;'), {
    owner: 'SCOTT',
    name: 'EMP',
    dbLink: null,
    text: 'scott.emp',
  });
  assert.equal(parseDescribe('  Desc  hr . employees  ').owner, 'HR');
  assert.equal(parseDescribe('-- struttura\ndesc emp').name, 'EMP');
  assert.equal(parseDescribe('desc emp@remoto').dbLink, 'remoto');
});

test('gli identificatori fra virgolette mantengono il maiuscolo/minuscolo', () => {
  assert.deepEqual(parseDescribe('desc "Scott"."Mia Tabella"'), {
    owner: 'Scott',
    name: 'Mia Tabella',
    dbLink: null,
    text: '"Scott"."Mia Tabella"',
  });
});

test('quello che non è un DESC resta SQL', () => {
  assert.equal(parseDescribe('SELECT * FROM emp ORDER BY sal DESC'), null);
  assert.equal(parseDescribe('desc'), null);
  assert.equal(parseDescribe('desc emp, dept'), null);
  assert.equal(parseDescribe('description'), null);
});

test('i tipi si scrivono come in SQL*Plus', () => {
  assert.equal(columnType({ type: 'VARCHAR2', length: 30, charLength: 30, charUsed: 'B' }), 'VARCHAR2(30)');
  assert.equal(columnType({ type: 'VARCHAR2', length: 80, charLength: 20, charUsed: 'C' }), 'VARCHAR2(20 CHAR)');
  assert.equal(columnType({ type: 'NUMBER', precision: 10, scale: 2 }), 'NUMBER(10,2)');
  assert.equal(columnType({ type: 'NUMBER', precision: 5, scale: 0 }), 'NUMBER(5)');
  assert.equal(columnType({ type: 'NUMBER', precision: null, scale: 0 }), 'NUMBER(38)');
  assert.equal(columnType({ type: 'NUMBER', precision: null, scale: null }), 'NUMBER');
  assert.equal(columnType({ type: 'RAW', length: 16 }), 'RAW(16)');
  assert.equal(columnType({ type: 'TIMESTAMP(6)' }), 'TIMESTAMP(6)');
  assert.equal(columnType({ type: 'DATE' }), 'DATE');
  assert.equal(columnType({ type: 'INDIRIZZO_T', typeOwner: 'HR' }), 'HR.INDIRIZZO_T');
  assert.equal(columnType({ type: 'XMLTYPE', typeOwner: 'SYS' }), 'XMLTYPE');
});

// Sessione finta: un dizionario minimo con cui rispondere alle query del DESC.
function fakeSession({ schema = 'SCOTT', objects = [], synonyms = [], columns = {} } = {}) {
  return {
    async execute(sql, binds = {}) {
      if (/CURRENT_SCHEMA/.test(sql)) return { rows: [[schema]] };
      if (/FROM all_objects/.test(sql)) {
        return {
          rows: objects
            .filter(([o, n]) => o === binds.owner && n === binds.name)
            .map(([, , t]) => [t]),
        };
      }
      if (/FROM all_synonyms/.test(sql)) {
        return {
          rows: synonyms
            .filter(([o, n]) => o === binds.owner && n === binds.name)
            .map(([, , to, tn, link]) => [to, tn, link ?? null]),
        };
      }
      if (/FROM all_tab_columns/.test(sql)) return { rows: columns[`${binds.owner}.${binds.name}`] || [] };
      throw new Error('query inattesa: ' + sql);
    },
  };
}

const EMP_COLS = [
  ['EMPNO', 'N', 'NUMBER', null, 22, 0, null, 4, 0],
  ['ENAME', 'Y', 'VARCHAR2', null, 10, 10, 'B', null, null],
  ['HIREDATE', 'Y', 'DATE', null, 7, 0, null, null, null],
];

test('DESC di una tabella dello schema corrente', async () => {
  const s = fakeSession({ objects: [['SCOTT', 'EMP', 'TABLE']], columns: { 'SCOTT.EMP': EMP_COLS } });
  const d = await describe(s, parseDescribe('desc emp'));
  assert.equal(d.title, 'TABLE SCOTT.EMP');
  assert.deepEqual(d.columns.map((c) => c.name), ['Nome', 'Null?', 'Tipo']);
  assert.deepEqual(d.rows, [
    ['EMPNO', 'NOT NULL', 'NUMBER(4)'],
    ['ENAME', null, 'VARCHAR2(10)'],
    ['HIREDATE', null, 'DATE'],
  ]);
});

test('DESC segue i sinonimi pubblici e privati', async () => {
  const s = fakeSession({
    schema: 'APP',
    objects: [
      ['PUBLIC', 'EMP', 'SYNONYM'],
      ['APP', 'DIP', 'SYNONYM'],
      ['SCOTT', 'EMP', 'TABLE'],
    ],
    synonyms: [
      ['PUBLIC', 'EMP', 'SCOTT', 'EMP'],
      ['APP', 'DIP', 'PUBLIC', 'EMP'],
    ],
    columns: { 'SCOTT.EMP': EMP_COLS },
  });
  assert.equal((await describe(s, parseDescribe('desc emp'))).title, 'TABLE SCOTT.EMP');
  assert.equal((await describe(s, parseDescribe('desc dip'))).title, 'TABLE SCOTT.EMP');
});

test('un oggetto inesistente dà ORA-04043', async () => {
  const s = fakeSession();
  await assert.rejects(describe(s, parseDescribe('desc nessuno')), /ORA-04043.*nessuno/);
});

test('un sinonimo verso un db link lo dice chiaramente', async () => {
  const s = fakeSession({
    objects: [['SCOTT', 'REM', 'SYNONYM']],
    synonyms: [['SCOTT', 'REM', 'HR', 'EMPLOYEES', 'PROD']],
  });
  await assert.rejects(describe(s, parseDescribe('desc rem')), /EMPLOYEES@PROD/);
});

test('DESC di una sequenza non si applica', async () => {
  const s = fakeSession({ objects: [['SCOTT', 'SEQ1', 'SEQUENCE']] });
  await assert.rejects(describe(s, parseDescribe('desc seq1')), /SEQUENCE/);
});
