import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import { PLSQL } from '@codemirror/lang-sql';

// Lo store usa il middleware persist: fuori dal browser serve uno storage finto.
globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

const { useStore } = await import('../src/store.js');
const { sqlCompletionSource } = await import('../src/completion.js');

const EMP = {
  k: 'T',
  c: [
    ['EMPNO', 'NUMBER(4)', 1, 1],
    ['ENAME', 'VARCHAR2(10)', 0, 0],
    ['DEPTNO', 'NUMBER(2)', 0, 0],
  ],
};
const DEPT = {
  k: 'T',
  c: [
    ['DEPTNO', 'NUMBER(2)', 1, 1],
    ['DNAME', 'VARCHAR2(14)', 0, 0],
  ],
};
const HR = {
  owner: 'HR',
  tables: { JOBS: { k: 'T', c: [['JOB_ID', 'VARCHAR2(10)', 1, 1]] } },
  fks: [],
  routines: [],
  members: {},
  sequences: [],
  synonyms: {},
};

let hrLoads = 0;

function setup() {
  hrLoads = 0;
  useStore.setState({
    sqlMeta: {
      c1: {
        owner: 'SCOTT',
        schemas: ['SCOTT', 'HR'],
        byOwner: {
          SCOTT: {
            owner: 'SCOTT',
            tables: { EMP, DEPT },
            fks: [['EMP', ['DEPTNO'], 'SCOTT', 'DEPT', ['DEPTNO']]],
            routines: [
              ['MY_PKG', 'K'],
              ['CALCOLA', 'F'],
            ],
            members: { MY_PKG: ['FOO(x)', 'BAR'] },
            sequences: ['EMP_SEQ'],
            synonyms: { LAVORI: ['HR', 'JOBS'] },
          },
        },
      },
    },
    loadSchemaMeta: async (id, owner) => {
      if (owner !== 'HR') return null;
      hrLoads++;
      useStore.setState((s) => ({
        sqlMeta: {
          ...s.sqlMeta,
          c1: { ...s.sqlMeta.c1, byOwner: { ...s.sqlMeta.c1.byOwner, HR } },
        },
      }));
      return HR;
    },
  });
  return sqlCompletionSource('c1');
}

// Il cursore è segnato con "|".
function ctx(doc, explicit = false) {
  const pos = doc.indexOf('|');
  const text = doc.slice(0, pos) + doc.slice(pos + 1);
  const state = EditorState.create({ doc: text, extensions: [PLSQL.language.extension] });
  return new CompletionContext(state, pos, explicit);
}

const labels = (res) => (res ? res.options.map((o) => o.label) : []);
const find = (res, label) => res.options.find((o) => o.label === label);

test('alias. propone le colonne con tipo e provenienza', async () => {
  const source = setup();
  const res = await source(ctx('SELECT * FROM emp e WHERE e.|'));
  assert.deepEqual(labels(res), ['EMPNO', 'ENAME', 'DEPTNO']);
  assert.equal(find(res, 'ENAME').detail, 'VARCHAR2(10)');
  assert.equal(find(res, 'EMPNO').info, 'e · NUMBER(4) · NOT NULL · PK');
});

test('nome tabella non aliasato e sinonimo verso un altro schema', async () => {
  const source = setup();
  assert.deepEqual(labels(await source(ctx('SELECT * FROM dept WHERE dept.|'))), [
    'DEPTNO',
    'DNAME',
  ]);
  const syn = await source(ctx('SELECT lavori.| FROM lavori'));
  assert.deepEqual(labels(syn), ['JOB_ID']);
  assert.equal(hrLoads, 1);
});

test('schema. carica i metadati e propone gli oggetti', async () => {
  const source = setup();
  const res = await source(ctx('SELECT * FROM hr.|'));
  assert.deepEqual(labels(res), ['JOBS']);
  assert.equal(hrLoads, 1);
  // schema.tabella. → colonne
  const cols = await source(ctx('SELECT * FROM hr.jobs j WHERE hr.jobs.|'));
  assert.deepEqual(labels(cols), ['JOB_ID']);
});

test('minuscolo se l\'istruzione è scritta in minuscolo', async () => {
  const source = setup();
  const res = await source(ctx('select * from emp e where e.|'));
  assert.deepEqual(labels(res), ['empno', 'ename', 'deptno']);
  const generic = await source(ctx('select * from emp e where en|'));
  assert.ok(labels(generic).includes('ename'));
  const kw = await source(ctx('select * from emp e where an|'));
  assert.ok(labels(kw).includes('and'), 'anche le parole chiave seguono lo stile');
});

test('il prefisso digitato ha la precedenza sullo stile dell\'istruzione', async () => {
  const source = setup();
  // istruzione in maiuscolo ma prefisso in minuscolo: si segue il prefisso
  assert.ok(labels(await source(ctx('SELECT * FROM emp e WHERE en|'))).includes('ename'));
  assert.ok(labels(await source(ctx('SELECT * FROM emp e WHERE EN|'))).includes('ENAME'));
  // senza prefisso decide lo stile dell'istruzione, non l'alias
  assert.deepEqual(labels(await source(ctx('SELECT * FROM emp e WHERE e.|'))), [
    'EMPNO',
    'ENAME',
    'DEPTNO',
  ]);
});

test('parole chiave incluse nella proposta generica', async () => {
  const source = setup();
  assert.ok(labels(await source(ctx('SELECT * FROM emp e WHERE EN|'))).includes('ENAME'));
  const res = await source(ctx('SELECT * FROM emp e WHERE AN|'));
  assert.ok(labels(res).includes('AND'));
  assert.equal(find(res, 'AND').section.name, 'Parole chiave');
});

test('espansione di alias.*', async () => {
  const source = setup();
  const res = await source(ctx('SELECT e.*| FROM emp e'));
  const opt = res.options[0];
  assert.equal(opt.label, '*');
  assert.match(opt.displayLabel, /3 colonne/);
  assert.equal(typeof opt.apply, 'function');
});

test('espansione di * su più tabelle qualifica con l\'alias', async () => {
  const source = setup();
  const res = await source(ctx('SELECT *| FROM emp e, dept d'));
  assert.match(res.options[0].displayLabel, /5 colonne/);
  // count(*) non deve attivare l'espansione
  assert.equal(await source(ctx('SELECT count(*|) FROM emp e')), null);
});

test('ON propone la condizione di join dalla foreign key', async () => {
  const source = setup();
  const res = await source(ctx('SELECT * FROM emp e JOIN dept d ON |'));
  assert.deepEqual(labels(res), ['d.DEPTNO = e.DEPTNO']);
  assert.equal(res.options[0].detail, 'chiave esterna');
});

test('JOIN propone tabella, alias e ON già scritti', async () => {
  const source = setup();
  const res = await source(ctx('SELECT * FROM emp e JOIN |'));
  assert.deepEqual(labels(res), ['DEPT']);
  assert.equal(res.options[0].apply, 'DEPT D ON D.DEPTNO = e.DEPTNO');
});

test('package e sequenze', async () => {
  const source = setup();
  assert.deepEqual(labels(await source(ctx('BEGIN my_pkg.| END;'))), ['FOO', 'BAR']);
  assert.deepEqual(labels(await source(ctx('SELECT emp_seq.| FROM dual'))), [
    'NEXTVAL',
    'CURRVAL',
  ]);
  // prefisso digitato in minuscolo: anche i membri arrivano in minuscolo
  assert.deepEqual(labels(await source(ctx('BEGIN dbms_output.pu| END;'))).slice(0, 2), [
    'put_line',
    'put',
  ]);
});

test('ordine delle sezioni secondo la clausola', async () => {
  const source = setup();
  const rank = (res, label) => find(res, label).section.rank;
  const inFrom = await source(ctx('SELECT * FROM emp e, D|'));
  assert.ok(rank(inFrom, 'DEPT') < rank(inFrom, 'DEPTNO'), 'in FROM prima le tabelle');
  const inWhere = await source(ctx('SELECT * FROM emp e WHERE D|'));
  assert.ok(rank(inWhere, 'DEPTNO') < rank(inWhere, 'DEPT'), 'in WHERE prima le colonne');
  const fn = await source(ctx('SELECT * FROM emp e WHERE NV|'));
  assert.equal(find(fn, 'NVL').section.name, 'Funzioni');
  assert.equal(find(fn, 'NVL').detail, '(expr, sostituto)');
});

test('solo corrispondenze sensate, niente lettere sparse', async () => {
  const source = setup();
  const at = async (doc) => labels(await source(ctx(doc)));
  // "ENO" ha le lettere di EMPNO ma sparpagliate: non deve proporlo
  assert.deepEqual(await at('SELECT * FROM emp e WHERE ENO|'), []);
  // prefisso, sottostringa e salti di parola restano
  assert.ok((await at('SELECT * FROM emp e WHERE ENAME|')).includes('ENAME'));
  assert.ok((await at('SELECT * FROM emp e WHERE PTNO|')).includes('DEPTNO'));
  assert.ok((await at('BEGIN MY_P| END;')).includes('MY_PKG'), 'prefisso');
  assert.ok((await at('BEGIN MYPKG| END;')).includes('MY_PKG'), 'separatore saltato');
  assert.ok((await at('BEGIN MP| END;')).includes('MY_PKG'), 'iniziali delle parole');
});

test('niente suggerimenti dentro stringhe e commenti', async () => {
  const source = setup();
  assert.equal(await source(ctx("SELECT 'ciao mon|' FROM dual")), null);
  assert.equal(await source(ctx('SELECT 1 FROM dual -- nota emp|')), null);
});

test('senza metadati restano le parole chiave', async () => {
  useStore.setState({ sqlMeta: {} });
  const res = await sqlCompletionSource('altra')(ctx('SELECT * FROM emp WHE|'));
  assert.ok(labels(res).includes('WHERE'));
});
