import test from 'node:test';
import assert from 'node:assert/strict';
import { sniffDelimiter, parseCsv } from '../src/csvParse.js';

// ------------------------------------------------------- sniffDelimiter

test('sniffDelimiter: riconosce i quattro separatori', () => {
  assert.equal(sniffDelimiter('a,b,c\n1,2,3'), ',');
  assert.equal(sniffDelimiter('a;b;c\n1;2;3'), ';');
  assert.equal(sniffDelimiter('a\tb\tc\n1\t2\t3'), '\t');
  assert.equal(sniffDelimiter('a|b|c\n1|2|3'), '|');
});

test('sniffDelimiter: guarda solo la prima riga', () => {
  // La seconda riga è piena di punti e virgola, ma l intestazione decide.
  assert.equal(sniffDelimiter('a,b\n1;2;3;4;5'), ',');
});

test('sniffDelimiter: i separatori dentro le virgolette non contano', () => {
  assert.equal(sniffDelimiter('"a;b;c;d";x'), ';');
  assert.equal(sniffDelimiter('"a;b;c;d",x'), ',');
});

test('sniffDelimiter: un campo multiriga non interrompe la prima riga', () => {
  assert.equal(sniffDelimiter('"prima\nriga";b;c\n1;2;3'), ';');
});

test('sniffDelimiter: a parità vince la virgola, senza separatori pure', () => {
  assert.equal(sniffDelimiter('a,b;c'), ',');
  assert.equal(sniffDelimiter('una riga sola'), ',');
  assert.equal(sniffDelimiter(''), ',');
});

test('sniffDelimiter: il BOM iniziale non disturba', () => {
  assert.equal(sniffDelimiter('﻿a;b;c'), ';');
});

// ------------------------------------------------------------- parseCsv

test('parseCsv: intestazione e righe', () => {
  const r = parseCsv('ID,NOME\n1,Rossi\n2,Bianchi');
  assert.deepEqual(r.columns, ['ID', 'NOME']);
  assert.deepEqual(r.rows, [
    ['1', 'Rossi'],
    ['2', 'Bianchi'],
  ]);
});

test('parseCsv: CRLF, BOM e ultima riga senza a capo', () => {
  const r = parseCsv('﻿ID,NOME\r\n1,Rossi\r\n');
  assert.deepEqual(r.columns, ['ID', 'NOME']);
  assert.deepEqual(r.rows, [['1', 'Rossi']]);
});

test('parseCsv: virgolette, virgolette raddoppiate e separatore nel campo', () => {
  const r = parseCsv('A,B\n"con, virgola","dice ""ciao"""');
  assert.deepEqual(r.rows, [['con, virgola', 'dice "ciao"']]);
});

test('parseCsv: campo su più righe', () => {
  const r = parseCsv('A,B\n"prima\r\nseconda",x\ny,z');
  assert.deepEqual(r.rows, [
    ['prima\nseconda', 'x'],
    ['y', 'z'],
  ]);
});

test('parseCsv: le virgolette a metà campo sono testo', () => {
  const r = parseCsv('A\n12"x');
  assert.deepEqual(r.rows, [['12"x']]);
});

test('parseCsv: campo vuoto senza virgolette è null, "" è stringa vuota', () => {
  const r = parseCsv('A,B,C\n,"",   ');
  assert.deepEqual(r.rows, [[null, '', '   ']]);
});

test('parseCsv: separatore esplicito e a capo finale multiplo', () => {
  const r = parseCsv('A;B\n1;2\n\n', { delimiter: ';' });
  assert.deepEqual(r.rows, [['1', '2']]);
});

test('parseCsv: separatore riconosciuto da solo', () => {
  const r = parseCsv('A\tB\n1\t2');
  assert.deepEqual(r.columns, ['A', 'B']);
  assert.deepEqual(r.rows, [['1', '2']]);
});

test('parseCsv: senza intestazione le colonne sono COL1, COL2, …', () => {
  const r = parseCsv('1,2,3\n4,5,6', { header: false });
  assert.deepEqual(r.columns, ['COL1', 'COL2', 'COL3']);
  assert.deepEqual(r.rows, [
    ['1', '2', '3'],
    ['4', '5', '6'],
  ]);
});

test('parseCsv: nomi vuoti o doppi vengono resi univoci', () => {
  const r = parseCsv('ID,,ID\n1,2,3');
  assert.deepEqual(r.columns, ['ID', 'COL2', 'ID_2']);
});

test('parseCsv: righe più corte pareggiate a null, più lunghe non perse', () => {
  const r = parseCsv('A,B\n1\n1,2,3');
  assert.deepEqual(r.columns, ['A', 'B', 'COL3']);
  assert.deepEqual(r.rows, [
    ['1', null, null],
    ['1', '2', '3'],
  ]);
});

test('parseCsv: limit taglia le righe restituite', () => {
  const text = 'A\n1\n2\n3\n4\n5';
  assert.deepEqual(parseCsv(text, { limit: 2 }).rows, [['1'], ['2']]);
  assert.deepEqual(parseCsv(text, { limit: 2, header: false }).rows, [['A'], ['1']]);
  assert.equal(parseCsv(text).rows.length, 5);
});

test('parseCsv: testo vuoto', () => {
  assert.deepEqual(parseCsv(''), { columns: [], rows: [] });
  assert.deepEqual(parseCsv('A,B'), { columns: ['A', 'B'], rows: [] });
});

test('parseCsv: le virgolette possono contenere il fine riga e il separatore insieme', () => {
  const r = parseCsv('A;B\n"x;y\nz";2', { delimiter: ';' });
  assert.deepEqual(r.rows, [['x;y\nz', '2']]);
});
