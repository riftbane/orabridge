import test from 'node:test';
import assert from 'node:assert/strict';
import { findBinds, findSubstitutions, applySubstitutions } from '../src/binds.js';

const bindNames = (sql) => findBinds(sql).map((b) => b.name);
const subNames = (sql) => findSubstitutions(sql).map((s) => [s.name, s.persistent]);

// ---- variabili di bind ---------------------------------------------------

test('bind semplici, in ordine di comparsa', () => {
  const vars = findBinds('SELECT * FROM emp WHERE id = :id AND dept = :reparto');
  assert.deepEqual(vars, [
    { name: 'id', kind: 'bind' },
    { name: 'reparto', kind: 'bind' },
  ]);
});

test('bind ripetuti: una voce sola, grafia della prima comparsa', () => {
  assert.deepEqual(bindNames('SELECT :Id FROM emp WHERE id = :ID AND capo = :id'), ['Id']);
});

test('bind dentro stringhe e commenti non contano', () => {
  const sql = [
    '-- filtra per :nascosto',
    '/* nemmeno :questo */',
    "SELECT ':neanche' FROM emp WHERE id = :vero",
  ].join('\n');
  assert.deepEqual(bindNames(sql), ['vero']);
});

test("l'assegnazione PL/SQL := non è un bind", () => {
  const sql = [
    'DECLARE',
    '  v_tot NUMBER;',
    'BEGIN',
    '  v_tot := 0;',
    '  SELECT COUNT(*) INTO v_tot FROM emp WHERE dept = :reparto;',
    'END;',
  ].join('\n');
  assert.deepEqual(bindNames(sql), ['reparto']);
});

test('il doppio due punti non introduce un bind', () => {
  assert.deepEqual(bindNames('SELECT importo::numeric FROM movimenti'), []);
  assert.deepEqual(bindNames('SELECT a::b, :vero FROM t'), ['vero']);
});

test('bind numerici', () => {
  assert.deepEqual(bindNames('SELECT * FROM emp WHERE id = :1 AND dept = :2'), ['1', '2']);
  // Un decimale dopo i due punti non è il bind «1.5», e con lo spazio in mezzo
  // non c'è alcun bind.
  assert.deepEqual(bindNames('SELECT * FROM t WHERE x = :1.5'), []);
  assert.deepEqual(bindNames('SELECT * FROM t WHERE x = : 1'), []);
});

test('caratteri ammessi nel nome e correlazioni dei trigger', () => {
  assert.deepEqual(bindNames('BEGIN p(:p_id$1, :n#2); END;'), ['p_id$1', 'n#2']);
  assert.deepEqual(bindNames('IF :new.stipendio > :old.stipendio THEN NULL; END IF;'), []);
});

// ---- variabili di sostituzione -------------------------------------------

test('sostituzione singola e doppia', () => {
  const vars = findSubstitutions('SELECT * FROM &tabella WHERE dept = &&reparto');
  assert.deepEqual(vars, [
    { name: 'tabella', kind: 'sub', persistent: false },
    { name: 'reparto', kind: 'sub', persistent: true },
  ]);
});

test('sostituzione ripetuta: basta un && perché sia da ricordare', () => {
  assert.deepEqual(subNames('SELECT &citta FROM t WHERE c = &&CITTA AND d = &citta'), [
    ['citta', true],
  ]);
});

test('le sostituzioni valgono dentro le stringhe ma non nei commenti', () => {
  const sql = [
    '-- niente &commentata qui',
    '/* nemmeno &questa */',
    "SELECT * FROM emp WHERE citta = '&citta'",
  ].join('\n');
  assert.deepEqual(subNames(sql), [['citta', false]]);
});

test('una e commerciale isolata non è una sostituzione', () => {
  assert.deepEqual(subNames("SELECT 'Rossi & figli' FROM dual"), []);
  assert.deepEqual(subNames('SELECT * FROM t WHERE a = b & c'), []);
});

test('il punto chiude il nome e viene mangiato dalla sostituzione', () => {
  assert.deepEqual(subNames('SELECT * FROM &schema.emp'), [['schema', false]]);
  // Come in SQL*Plus: il punto è il terminatore del nome e sparisce, per
  // questo negli script si scrive `&schema..emp` quando il punto serve davvero.
  assert.equal(applySubstitutions('SELECT * FROM &schema.emp', { schema: 'scott' }), 'SELECT * FROM scottemp');
  assert.equal(applySubstitutions('SELECT * FROM &schema..emp', { schema: 'scott' }), 'SELECT * FROM scott.emp');
  assert.equal(applySubstitutions("WHERE id = '&id.'", { id: '7' }), "WHERE id = '7'");
});

// ---- espansione ----------------------------------------------------------

test('applySubstitutions inserisce il valore così com è scritto', () => {
  const sql = "SELECT * FROM &tab WHERE citta = &citta AND stato = '&stato'";
  const out = applySubstitutions(sql, { tab: 'emp', citta: "'ROMA'", stato: 'ATTIVO' });
  assert.equal(out, "SELECT * FROM emp WHERE citta = 'ROMA' AND stato = 'ATTIVO'");
});

test('applySubstitutions ignora le maiuscole nei nomi', () => {
  assert.equal(applySubstitutions('SELECT &Citta FROM t', { CITTA: 'x' }), 'SELECT x FROM t');
});

test('valore mancante: il testo resta com era', () => {
  const sql = 'SELECT * FROM &tab WHERE id = &id.';
  assert.equal(applySubstitutions(sql, { tab: 'emp' }), 'SELECT * FROM emp WHERE id = &id.');
  assert.equal(applySubstitutions(sql, {}), sql);
  assert.equal(applySubstitutions(sql, null), sql);
  // Una stringa vuota invece è un valore a tutti gli effetti.
  assert.equal(applySubstitutions('SELECT &x FROM t', { x: '' }), 'SELECT  FROM t');
});

test('applySubstitutions non tocca i commenti', () => {
  const sql = '-- &tab\nSELECT * FROM &tab';
  assert.equal(applySubstitutions(sql, { tab: 'emp' }), '-- &tab\nSELECT * FROM emp');
});

// ---- le due cose insieme -------------------------------------------------

test('caso realistico: sostituzioni espanse, bind lasciati al server', () => {
  const sql = [
    '-- report per &&anno (:anno non c entra)',
    'SELECT e.nome, e.stipendio',
    '  FROM &schema..emp e',
    " WHERE e.citta = '&citta'",
    '   AND e.assunto >= :dal',
    '   AND e.dept = :reparto',
    '   AND e.anno = &&anno',
  ].join('\n');

  assert.deepEqual(bindNames(sql), ['dal', 'reparto']);
  assert.deepEqual(subNames(sql), [
    ['schema', false],
    ['citta', false],
    ['anno', true],
  ]);

  const espanso = applySubstitutions(sql, { schema: 'scott', citta: 'ROMA', anno: '2026' });
  assert.ok(espanso.includes('FROM scott.emp e'));
  assert.ok(espanso.includes("e.citta = 'ROMA'"));
  assert.ok(espanso.includes('e.anno = 2026'));
  // Il commento non è stato toccato e i bind sono ancora lì per il server.
  assert.ok(espanso.startsWith('-- report per &&anno (:anno non c entra)'));
  assert.deepEqual(bindNames(espanso), ['dal', 'reparto']);
});
