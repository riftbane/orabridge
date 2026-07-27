import test from 'node:test';
import assert from 'node:assert/strict';
import { diffRows, foldRows, diffStats } from '../src/textDiff.js';

const shape = (rows) => rows.map((r) => r.type).join('');
const left = (rows) => rows.filter((r) => r.left != null).map((r) => r.left);
const right = (rows) => rows.filter((r) => r.right != null).map((r) => r.right);

test('testi identici: tutte righe uguali', () => {
  const rows = diffRows('a\nb\nc', 'a\nb\nc');
  assert.equal(shape(rows), 'samesamesame');
  assert.deepEqual(diffStats(rows), { added: 0, removed: 0, changed: 0 });
});

test('riga cambiata: una sola riga affiancata', () => {
  const rows = diffRows('a\nb\nc', 'a\nB\nc');
  assert.equal(shape(rows), 'samemodsame');
  assert.equal(rows[1].left, 'b');
  assert.equal(rows[1].right, 'B');
  assert.deepEqual(diffStats(rows), { added: 0, removed: 0, changed: 1 });
});

test('riga aggiunta e riga rimossa', () => {
  const aggiunta = diffRows('a\nc', 'a\nb\nc');
  assert.equal(shape(aggiunta), 'sameaddsame');
  assert.equal(aggiunta[1].right, 'b');
  assert.equal(aggiunta[1].left, null);

  const rimossa = diffRows('a\nb\nc', 'a\nc');
  assert.equal(shape(rimossa), 'samedelsame');
  assert.equal(rimossa[1].left, 'b');
});

test('i numeri di riga seguono i due testi separatamente', () => {
  const rows = diffRows('a\nb\nc\nd', 'a\nc\nd');
  assert.equal(shape(rows), 'samedelsamesame');
  assert.deepEqual(
    rows.map((r) => [r.ln, r.rn]),
    [
      [1, 1],
      [2, null],
      [3, 2],
      [4, 3],
    ]
  );
});

test('il contenuto delle due colonne resta integro', () => {
  const a = 'uno\ndue\ntre\nquattro\ncinque';
  const b = 'uno\nDUE\ntre\ncinque\nsei';
  const rows = diffRows(a, b);
  assert.deepEqual(left(rows), a.split('\n'));
  assert.deepEqual(right(rows), b.split('\n'));
});

test('testo vuoto da un lato', () => {
  assert.equal(shape(diffRows('', 'a\nb')), 'modadd');
  assert.equal(shape(diffRows('a\nb', '')), 'moddel');
});

test('modifica in mezzo a un file lungo (taglio di testa e coda)', () => {
  const base = Array.from({ length: 3000 }, (_, i) => `riga ${i}`);
  const modificato = base.slice();
  modificato[1500] = 'riga cambiata';
  const rows = diffRows(base.join('\n'), modificato.join('\n'));
  assert.equal(rows.length, 3000);
  assert.equal(rows[1500].type, 'mod');
  assert.deepEqual(diffStats(rows), { added: 0, removed: 0, changed: 1 });
});

test('testi completamente diversi: blocco unico, nessun errore', () => {
  const a = Array.from({ length: 900 }, (_, i) => `a${i}`).join('\n');
  const b = Array.from({ length: 900 }, (_, i) => `b${i}`).join('\n');
  const rows = diffRows(a, b);
  assert.equal(rows.length, 900);
  assert.ok(rows.every((r) => r.type === 'mod'));
});

test('foldRows comprime le righe uguali lasciando il contorno', () => {
  const rows = diffRows(
    Array.from({ length: 50 }, (_, i) => `r${i}`).join('\n'),
    Array.from({ length: 50 }, (_, i) => (i === 25 ? 'cambiata' : `r${i}`)).join('\n')
  );
  const folded = foldRows(rows, 3);
  assert.equal(folded[0].type, 'fold');
  assert.equal(folded[0].count, 22); // 0..21, poi 3 righe di contorno
  assert.ok(folded.some((r) => r.type === 'mod'));
  assert.equal(folded.at(-1).type, 'fold');
  // le righe mostrate più quelle nascoste devono tornare
  const shown = folded.filter((r) => r.type !== 'fold').length;
  const hidden = folded.filter((r) => r.type === 'fold').reduce((n, r) => n + r.count, 0);
  assert.equal(shown + hidden, rows.length);
});
