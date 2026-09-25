import test from 'node:test';
import assert from 'node:assert/strict';
import { tsvField, toTsv, parseTsv, resolvePaste, isMultiCell, pasteIntoRows } from '../src/gridClipboard.js';

test('toTsv: tabulazioni fra celle, a capo fra righe, NULL vuoto', () => {
  assert.equal(toTsv([['1', 'Rossi', null], ['2', 'Bianchi', '3.5']]), '1\tRossi\t\n2\tBianchi\t3.5');
});

test('tsvField: virgolette solo dove servono', () => {
  assert.equal(tsvField('a"b'), 'a"b');
  assert.equal(tsvField('a\tb'), '"a\tb"');
  assert.equal(tsvField('riga\nsotto "x"'), '"riga\nsotto ""x"""');
  assert.equal(tsvField('"inizio'), '"""inizio"');
});

test('parseTsv rilegge quello che toTsv scrive', () => {
  const rows = [['1', 'a\tb', null, 'due\nrighe', '"q"']];
  assert.deepEqual(parseTsv(toTsv(rows)), rows);
});

test('parseTsv: a capo finale (Excel) ignorato, CRLF accettato', () => {
  assert.deepEqual(parseTsv('1\t2\r\n3\t4\r\n'), [['1', '2'], ['3', '4']]);
  assert.deepEqual(parseTsv(''), []);
});

test('resolvePaste: il testo appena copiato dalla griglia torna ai valori grezzi', () => {
  const lastCopy = { text: 'a\t', rows: [['&agrave;', null]] };
  assert.deepEqual(resolvePaste('a\t', lastCopy), [['&agrave;', null]]);
  assert.deepEqual(resolvePaste('x\ty', lastCopy), [['x', 'y']]);
});

test('isMultiCell: un valore solo lo incolla il campo', () => {
  assert.equal(isMultiCell('ciao'), false);
  assert.equal(isMultiCell('ciao\n'), false);
  assert.equal(isMultiCell('a\tb'), true);
  assert.equal(isMultiCell('a\nb'), true);
});

const empty = (n) => ({ values: new Array(n).fill(undefined) });

test('pasteIntoRows: una riga intera va sempre dalla prima colonna', () => {
  const out = pasteIntoRows([empty(3)], 0, 2, [['1', 'x', null]], 3);
  assert.deepEqual(out[0].values, ['1', 'x', null]);
});

test('pasteIntoRows: una riga parziale parte dalla colonna scelta e si ferma al bordo', () => {
  const out = pasteIntoRows([empty(3)], 0, 1, [['a', 'b', 'c', 'd']], 3);
  // 4 celle su 3 colonne: non è una riga intera, parte dalla colonna 1.
  assert.deepEqual(out[0].values, [undefined, 'a', 'b']);
});

test('pasteIntoRows: più righe incollate creano le righe nuove mancanti', () => {
  const list = [empty(2)];
  const out = pasteIntoRows(list, 0, 0, [['1', 'a'], ['2', 'b']], 2);
  assert.equal(out.length, 2);
  assert.deepEqual(out[1].values, ['2', 'b']);
  assert.equal(list.length, 1, 'la lista ricevuta non cambia');
});

test('pasteIntoRows: le colonne non scrivibili restano omesse', () => {
  const out = pasteIntoRows([empty(3)], 0, 0, [['1', 'blob', 'x']], 3, (c) => c !== 1);
  assert.deepEqual(out[0].values, ['1', undefined, 'x']);
});

test('pasteIntoRows: makeRow decide la forma delle righe create', () => {
  let n = 0;
  const out = pasteIntoRows([], 0, 0, [['1']], 1, undefined, () => ({ key: ++n, values: [undefined] }));
  assert.deepEqual(out, [{ key: 1, values: ['1'] }]);
});
