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
const V_EMP = { k: 'V', c: [['ID', 'NUMBER', 0, 0]] };
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
            tables: { EMP, DEPT, V_EMP },
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
const section = (res, name) => res.options.filter((o) => o.section?.name === name);

// L'ordine con cui CodeMirror mostra le proposte: prima la sezione, poi il
// boost. Serve dove conta che cosa si trova in cima.
const ranked = (res) =>
  [...res.options]
    .sort((a, b) => a.section.rank - b.section.rank || (b.boost || 0) - (a.boost || 0))
    .map((o) => o.label);

// Applica un suggerimento a un editor finto e restituisce testo e selezione.
// `apply` può essere una funzione che spedisce una transazione (gli snippet)
// oppure una che spedisce direttamente le modifiche.
function applyOption(doc, option, from, to) {
  const state = EditorState.create({ doc, extensions: [PLSQL.language.extension] });
  let out = null;
  const view = { state, dispatch: (t) => (out = t.newDoc ? t : state.update(t)) };
  option.apply(view, option, from, to);
  return { text: out.newDoc.toString(), sel: out.newSelection.main };
}

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
  const res = await source(ctx('SELECT * FROM emp e WHERE e.deptno = 1 AN|'));
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
  const opt = res.options[0];
  assert.equal(opt.label, 'd.DEPTNO = e.DEPTNO');
  assert.equal(opt.detail, 'chiave esterna');
  assert.equal(opt.section.name, 'Join');
  // sotto la condizione restano le colonne delle due tabelle
  assert.ok(labels(res).includes('ENAME'));
  assert.ok(opt.section.rank < find(res, 'ENAME').section.rank);
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
  // in FROM ci vuole una tabella: le colonne non sono nemmeno proposte
  const inFrom = await source(ctx('SELECT * FROM emp e, D|'));
  assert.ok(labels(inFrom).includes('DEPT'));
  assert.equal(find(inFrom, 'DEPTNO'), undefined, 'niente colonne dove va una tabella');
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

// ---- posto nell'istruzione -------------------------------------------------

test('dopo CREATE si propongono i tipi di oggetto, non le funzioni', async () => {
  const source = setup();
  const syn = await source(ctx('create sy|'));
  assert.deepEqual(labels(syn), ['synonym'], 'niente sys_context, sysdate, schemi');
  const tab = await source(ctx('create tab|'));
  assert.equal(labels(tab)[0], 'table', 'prima TABLE, non json_table');
  assert.equal(find(tab, 'json_table'), undefined);
  assert.equal(find(tab, 'datasheet_lista_tabelle'), undefined);
  // dopo CREATE OR REPLACE restano solo gli oggetti ricreabili
  assert.ok(labels(await source(ctx('create or replace |'))).includes('view'));
  assert.equal(find(await source(ctx('create or replace |')), 'table'), undefined);
});

test('DROP e ALTER nominano solo oggetti del tipo dichiarato', async () => {
  const source = setup();
  const tables = labels(await source(ctx('DROP TABLE |')));
  assert.deepEqual(tables.slice(0, 2), ['EMP', 'DEPT']);
  assert.equal(tables.includes('V_EMP'), false, 'una vista non si droppa come tabella');
  const seq = labels(await source(ctx('DROP SEQUENCE |')));
  assert.equal(seq[0], 'EMP_SEQ');
  assert.equal(seq.includes('EMP'), false);
  assert.equal(labels(await source(ctx('DROP VIEW |')))[0], 'V_EMP');
  // ALTER TABLE: prima le azioni possibili, poi le colonne della tabella
  const alter = await source(ctx('ALTER TABLE emp |'));
  assert.deepEqual(ranked(alter).slice(0, 2), ['ADD', 'MODIFY']);
  assert.ok(find(alter, 'EMPNO').section.rank > find(alter, 'ADD').section.rank);
  assert.deepEqual(labels(await source(ctx('ALTER TABLE emp DROP COLUMN |'))), [
    'EMPNO',
    'ENAME',
    'DEPTNO',
  ]);
});

test('dove va un tipo di dato si propongono i tipi', async () => {
  const source = setup();
  const res = await source(ctx('CREATE TABLE nuova (id NU|'));
  assert.deepEqual(labels(res).slice(0, 2), ['NUMBER', 'NUMBER(10)']);
  assert.equal(find(res, 'NVL'), undefined, 'niente funzioni in una definizione di colonna');
});

test('a inizio istruzione solo modelli e verbi', async () => {
  const source = setup();
  const res = await source(ctx('sel|'));
  assert.equal(res.options[0].section.name, 'Struttura');
  assert.equal(res.options[0].displayLabel, 'select … from …');
  assert.equal(find(res, 'emp'), undefined, 'niente tabelle dove va un verbo');
  assert.equal(find(res, 'sessiontimezone'), undefined, 'niente funzioni');
  assert.ok(labels(res).includes('select'), 'la parola chiave resta disponibile');
});

test('il modello SELECT chiede prima la tabella', async () => {
  const source = setup();
  const res = await source(ctx('sel|'));
  const { text, sel } = applyOption('sel', res.options[0], 0, 3);
  assert.equal(text, 'select *\n  from tabella');
  // il primo salto del Tab è sulla tabella: senza quella non si potrebbero
  // proporre le colonne
  assert.deepEqual([sel.from, sel.to], [text.indexOf('tabella'), text.length]);
});

// ---- scheletri costruiti sui metadati -------------------------------------

test('INSERT propone l\'elenco delle colonne e i valori', async () => {
  const source = setup();
  const res = await source(ctx('INSERT INTO emp |'));
  const opt = res.options[0];
  assert.equal(opt.displayLabel, '(3 colonne) VALUES (…)');
  const { text, sel } = applyOption('INSERT INTO emp ', opt, 16, 16);
  assert.equal(text, 'INSERT INTO emp (EMPNO, ENAME, DEPTNO)\nVALUES (EMPNO, ENAME, DEPTNO)');
  assert.ok(sel.from > text.indexOf('VALUES'), 'si parte dal primo valore da scrivere');
});

test('UPDATE e DELETE propongono SET e il filtro sulla chiave', async () => {
  const source = setup();
  const upd = await source(ctx('UPDATE emp |'));
  assert.equal(
    applyOption('UPDATE emp ', upd.options[0], 11, 11).text,
    'UPDATE emp SET ENAME = valore\n WHERE EMPNO = valore'
  );
  const del = await source(ctx('DELETE FROM emp |'));
  assert.equal(
    applyOption('DELETE FROM emp ', del.options[0], 16, 16).text,
    'DELETE FROM emp WHERE EMPNO = valore'
  );
});

test('nel SET la colonna arriva con l\'uguale', async () => {
  const source = setup();
  const res = await source(ctx('UPDATE emp SET |'));
  assert.deepEqual(labels(res), ['EMPNO', 'ENAME', 'DEPTNO']);
  assert.equal(find(res, 'ENAME').apply, 'ENAME = ');
  // nell'elenco colonne di un INSERT le colonne arrivano invece nude
  const cols = await source(ctx('INSERT INTO emp (|'));
  assert.deepEqual(labels(cols), ['EMPNO', 'ENAME', 'DEPTNO']);
  assert.equal(find(cols, 'ENAME').apply, undefined);
});

test('senza FROM si sceglie la tabella e il cursore resta fra le colonne', async () => {
  const source = setup();
  const res = await source(ctx('SELECT E|'));
  const opt = section(res, 'Da quale tabella?')[0];
  assert.equal(opt.label, 'EMP');
  assert.equal(opt.detail, 'aggiunge FROM EMP');
  const { text, sel } = applyOption('SELECT E', opt, 7, 8);
  assert.equal(text, 'SELECT  FROM EMP');
  assert.equal(sel.from, 7, 'si continua a scrivere le colonne');
  // e da lì l'autocomplete conosce le colonne
  assert.deepEqual(labels(await source(ctx('SELECT | FROM EMP'))), ['EMPNO', 'ENAME', 'DEPTNO']);
});

test('dopo un valore concluso comandano le parole chiave', async () => {
  const source = setup();
  const res = await source(ctx('SELECT * FROM emp e W|'));
  assert.equal(res.options[0].label, 'WHERE');
  assert.equal(res.options[0].section.name, 'Parole chiave');
  const join = await source(ctx('SELECT * FROM emp e LEFT |'));
  assert.deepEqual(labels(join).slice(0, 2), ['JOIN', 'OUTER JOIN']);
  // finché manca il FROM non si propongono le clausole che lo seguono
  assert.deepEqual(labels(await source(ctx('SELECT ename |'))).slice(0, 2), ['AS', 'FROM']);
});

test('la lista viene ricalcolata a ogni carattere', async () => {
  const source = setup();
  // Tenendo valida la lista, CodeMirror la rifiltra con il suo criterio
  // "sparso": digitando "tab" ricomparivano nomi come STD_ATTRIBUTI.
  const res = await source(ctx('SELECT * FROM t|'));
  assert.equal(res.validFor, false);
});
