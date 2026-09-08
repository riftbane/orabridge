import test from 'node:test';
import assert from 'node:assert/strict';
import { foldRangeAt, resolveObject, wordAt } from '../src/editorActions.js';

// Le prove indicano la riga (numerata da 1) e confrontano il *testo* che
// verrebbe nascosto: si vede subito che cosa finisce dietro il «…».
function fold(text, line) {
  const lines = text.split('\n');
  let from = 0;
  for (let i = 0; i < line - 1; i++) from += lines[i].length + 1;
  const range = foldRangeAt(text, from, from + lines[line - 1].length);
  return range ? text.slice(range.from, range.to) : null;
}

const BLOCCO = [
  'DECLARE',
  '  n NUMBER;',
  'BEGIN',
  '  IF n > 0 THEN',
  "    dbms_output.put_line('ok');",
  '  END IF;',
  'END;',
  '/',
].join('\n');

test('BEGIN si piega fino al proprio END, saltando END IF', () => {
  assert.equal(
    fold(BLOCCO, 3),
    "\n  IF n > 0 THEN\n    dbms_output.put_line('ok');\n  END IF;\n"
  );
});

test('la prima riga piega tutta l istruzione, senza gli spazi finali', () => {
  assert.equal(fold(BLOCCO, 1).endsWith('END;'), true);
  assert.equal(fold(BLOCCO, 1).startsWith('\n  n NUMBER;\nBEGIN'), true);
});

test('BEGIN annidati: vince l END che chiude quello giusto', () => {
  const src = [
    'BEGIN',
    '  BEGIN',
    '    NULL;',
    '  END;',
    '  NULL;',
    'END;',
  ].join('\n');
  assert.equal(fold(src, 2), '\n    NULL;\n  ');
  assert.equal(fold(src, 1), '\n  BEGIN\n    NULL;\n  END;\n  NULL;\n');
});

test('LOOP e CASE contano come aperture del blocco', () => {
  const src = [
    'BEGIN',
    '  FOR r IN (SELECT 1 x FROM dual) LOOP',
    '    v := CASE WHEN r.x = 1 THEN 2 ELSE 3 END;',
    '  END LOOP;',
    'END;',
  ].join('\n');
  assert.equal(fold(src, 1).trimEnd().endsWith('END LOOP;'), true);
});

const PROC = [
  'CREATE OR REPLACE PROCEDURE p IS',
  'BEGIN',
  '  NULL;',
  'END p;',
  '/',
  '',
  'SELECT 1 FROM dual;',
].join('\n');

test('CREATE OR REPLACE si piega fino alla fine dell istruzione', () => {
  assert.equal(fold(PROC, 1), '\nBEGIN\n  NULL;\nEND p;');
  assert.equal(fold(PROC, 2), '\n  NULL;\n');
});

test('un istruzione su una riga sola non è ripiegabile', () => {
  assert.equal(fold(PROC, 7), null);
  assert.equal(fold(PROC, 6), null);
});

test('istruzione su più righe: si piega dalla sua prima riga', () => {
  const src = 'SELECT a,\n       b\n  FROM t\n WHERE a = 1;\n';
  assert.equal(fold(src, 1), '\n       b\n  FROM t\n WHERE a = 1;');
  assert.equal(fold(src, 2), null);
});

test('commento /* */ su più righe: la chiusura resta visibile', () => {
  const src = '/* prima\n   seconda */\nSELECT 1 FROM dual;';
  assert.equal(fold(src, 1), '\n   seconda ');
});

test('commento a blocco su una riga e commento di riga non si piegano', () => {
  assert.equal(fold('/* x */\nSELECT 1 FROM dual;', 1), null);
  assert.equal(fold('-- /* finto\nSELECT 1 FROM dual;', 1), null);
});

test('riga vuota e testo fuori misura: niente ripiegatura', () => {
  assert.equal(fold('\nSELECT 1 FROM dual;', 1), null);
  assert.equal(foldRangeAt('SELECT 1 FROM dual;', 5, 5), null);
  assert.equal(foldRangeAt(null, 0, 3), null);
});

// ---------------------------------------------------------------- wordAt --

test('wordAt: parola semplice, normalizzata in maiuscolo', () => {
  const w = wordAt('SELECT * FROM emp e', 15);
  assert.equal(w.word, 'emp');
  assert.equal(w.name, 'EMP');
  assert.equal(w.qualified, null);
  assert.deepEqual([w.from, w.to], [14, 17]);
});

test('wordAt: SCHEMA.OGGETTO è una cosa sola, da qualunque lato lo si guardi', () => {
  const sullOggetto = wordAt('FROM scott.emp', 12);
  const sulloSchema = wordAt('FROM scott.emp', 6);
  for (const w of [sullOggetto, sulloSchema]) {
    assert.equal(w.word, 'scott.emp');
    assert.deepEqual([w.from, w.to], [5, 14]);
    assert.deepEqual(w.qualified, { owner: 'SCOTT', name: 'EMP' });
    assert.equal(w.name, 'EMP');
  }
});

test('wordAt: identificatori fra virgolette conservano le maiuscole', () => {
  const w = wordAt('SELECT * FROM "Mia Tab"', 17);
  assert.equal(w.word, '"Mia Tab"');
  assert.equal(w.name, 'Mia Tab');

  const q = wordAt('FROM "Sc"."Mia Tab" x', 13);
  assert.deepEqual(q.qualified, { owner: 'Sc', name: 'Mia Tab' });
  assert.equal(q.word, '"Sc"."Mia Tab"');
});

test('wordAt: fuori da un identificatore non c è nessuna parola', () => {
  assert.equal(wordAt('a  b', 2), null);
  assert.equal(wordAt('SELECT 123 FROM t', 8), null);
  assert.equal(wordAt('', 0), null);
});

test('wordAt: subito dopo la parola vale ancora la parola', () => {
  assert.equal(wordAt('SELECT * FROM emp', 17).name, 'EMP');
});

// --------------------------------------------------------- resolveObject --

const META = {
  owner: 'HR',
  schemas: ['HR', 'SCOTT', 'MAGAZZINO'],
  byOwner: {
    HR: {
      tables: { EMP: { k: 'T', c: [] }, V_EMP: { k: 'V', c: [] } },
      routines: [['CALCOLA', 'F'], ['PKG_UTIL', 'K']],
      sequences: ['SEQ_EMP'],
      synonyms: { DEPT: ['SCOTT', 'DEPARTMENTS'], ALTROVE: ['MAGAZZINO', 'ARTICOLI'] },
    },
    SCOTT: { tables: { DEPARTMENTS: { k: 'T', c: [] } }, routines: [] },
  },
};

test('resolveObject: oggetti dello schema di lavoro con il tipo giusto', () => {
  const t = (name) => resolveObject(META, { owner: null, name });
  assert.deepEqual(t('EMP'), { owner: 'HR', name: 'EMP', type: 'TABLE' });
  assert.deepEqual(t('V_EMP'), { owner: 'HR', name: 'V_EMP', type: 'VIEW' });
  assert.deepEqual(t('CALCOLA'), { owner: 'HR', name: 'CALCOLA', type: 'FUNCTION' });
  assert.deepEqual(t('PKG_UTIL'), { owner: 'HR', name: 'PKG_UTIL', type: 'PACKAGE' });
  assert.deepEqual(t('SEQ_EMP'), { owner: 'HR', name: 'SEQ_EMP', type: 'SEQUENCE' });
  assert.equal(t('SCONOSCIUTO'), null);
});

test('resolveObject: il sinonimo porta all oggetto vero', () => {
  assert.deepEqual(resolveObject(META, { owner: null, name: 'DEPT' }), {
    owner: 'SCOTT',
    name: 'DEPARTMENTS',
    type: 'TABLE',
  });
});

test('resolveObject: schema non ancora caricato da scaricare', () => {
  assert.deepEqual(resolveObject(META, { owner: 'MAGAZZINO', name: 'ARTICOLI' }), {
    pending: 'MAGAZZINO',
  });
  assert.deepEqual(resolveObject(META, { owner: null, name: 'ALTROVE' }), {
    pending: 'MAGAZZINO',
  });
});

test('resolveObject: PACCHETTO.PROCEDURA apre il pacchetto', () => {
  assert.deepEqual(resolveObject(META, { owner: 'PKG_UTIL', name: 'FAI_QUALCOSA' }), {
    owner: 'HR',
    name: 'PKG_UTIL',
    type: 'PACKAGE',
  });
});

test('resolveObject: qualificatore che non è né schema né oggetto', () => {
  assert.equal(resolveObject(META, { owner: 'E', name: 'ENAME' }), null);
  assert.equal(resolveObject(null, { owner: null, name: 'EMP' }), null);
  assert.equal(resolveObject(META, {}), null);
});
