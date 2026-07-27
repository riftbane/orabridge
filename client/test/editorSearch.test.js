import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import {
  getSearchState,
  searchState,
  setSearchScope,
  setSearchSpec,
} from '../src/editorSearch.js';

const DOC = ['alfa Beta alfa', 'gamma alfabeto', 'ALFA delta'].join('\n');

function state(doc = DOC) {
  return EditorState.create({ doc, extensions: [searchState] });
}

function search(st, spec, scope) {
  const effects = [setSearchSpec.of(spec)];
  if (scope !== undefined) effects.push(setSearchScope.of(scope));
  return st.update({ effects }).state;
}

function texts(st) {
  return getSearchState(st).matches.map((m) => st.doc.sliceString(m.from, m.to));
}

test('ricerca semplice: non distingue maiuscole per impostazione predefinita', () => {
  const st = search(state(), { query: 'alfa' });
  assert.deepEqual(texts(st), ['alfa', 'alfa', 'alfa', 'ALFA']);
});

test('maiuscole/minuscole', () => {
  const st = search(state(), { query: 'alfa', caseSensitive: true });
  assert.deepEqual(texts(st), ['alfa', 'alfa', 'alfa']);
});

test('parola intera esclude le occorrenze dentro altre parole', () => {
  const st = search(state(), { query: 'alfa', wholeWord: true });
  assert.deepEqual(texts(st), ['alfa', 'alfa', 'ALFA']);
});

test('espressione regolare', () => {
  const st = search(state(), { query: '^\\w+', regexp: true });
  assert.deepEqual(texts(st), ['alfa', 'gamma', 'ALFA']);
});

test('espressione regolare non valida: nessun risultato ma segnalata', () => {
  const st = search(state(), { query: '(', regexp: true });
  assert.equal(getSearchState(st).invalid, true);
  assert.equal(getSearchState(st).matches.length, 0);
});

test('area limitata: cerca solo dentro lo scope', () => {
  const st = search(state(), { query: 'alfa' }, { from: 15, to: 29 });
  assert.deepEqual(texts(st), ['alfa']);
  assert.equal(getSearchState(st).scope.from, 15);
});

test('lo scope segue le modifiche al documento', () => {
  let st = search(state(), { query: 'alfa' }, { from: 15, to: 29 });
  st = st.update({ changes: { from: 0, to: 0, insert: 'XX\n' } }).state;
  const { scope } = getSearchState(st);
  assert.equal(scope.from, 18);
  assert.deepEqual(texts(st), ['alfa']);
});

test('i risultati si ricalcolano quando cambia il testo', () => {
  let st = search(state(), { query: 'alfa' });
  assert.equal(getSearchState(st).matches.length, 4);
  st = st.update({ changes: { from: 0, to: 4, insert: 'zeta' } }).state;
  assert.equal(getSearchState(st).matches.length, 3);
});

test('un pattern che può essere vuoto non blocca la ricerca', () => {
  const st = search(state('aaa'), { query: 'a*', regexp: true });
  assert.deepEqual(texts(st), ['aaa']);
});

test('il match corrente segue la selezione', () => {
  let st = search(state(), { query: 'alfa' });
  assert.equal(getSearchState(st).current, 0);
  st = st.update({ selection: { anchor: 10 } }).state;
  st = search(st, { query: 'alfa' });
  assert.equal(getSearchState(st).current, 1);
});
