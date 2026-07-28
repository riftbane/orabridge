import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, parseInline } from '../src/markdown.js';
import { tokenizeCode } from '../src/codeTokens.js';

// Testo di un albero inline, ignorando la formattazione.
const plain = (nodes) =>
  nodes
    .map((n) =>
      typeof n === 'string' ? n : n.type === 'br' ? '\n' : n.text || plain(n.children || [])
    )
    .join('');

test('paragrafo e titoli', () => {
  const b = parseMarkdown('# Titolo\n\nUn paragrafo.\n\n### Sotto');
  assert.deepEqual(
    b.map((x) => x.type),
    ['heading', 'para', 'heading']
  );
  assert.equal(b[0].level, 1);
  assert.equal(plain(b[0].inline), 'Titolo');
  assert.equal(b[2].level, 3);
});

test('grassetto, corsivo, barrato e codice inline', () => {
  const nodes = parseInline('**forte** e *lieve* e ~~via~~ e `codice`');
  const types = nodes.filter((n) => typeof n !== 'string').map((n) => n.type);
  assert.deepEqual(types, ['strong', 'em', 'strike', 'code']);
  assert.equal(plain(nodes), 'forte e lieve e via e codice');
});

test('gli underscore dentro un identificatore non sono corsivo', () => {
  const nodes = parseInline('la tabella ORDINI_TESTATA_2024 esiste');
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0], 'la tabella ORDINI_TESTATA_2024 esiste');
});

test('SELECT * non apre un corsivo', () => {
  const nodes = parseInline('usa SELECT * FROM T e count(*) insieme');
  assert.equal(plain(nodes), 'usa SELECT * FROM T e count(*) insieme');
});

test('collegamenti espliciti e nudi', () => {
  const nodes = parseInline('vedi [la guida](https://esempio.it/a) o https://oracle.com.');
  const links = nodes.filter((n) => typeof n !== 'string' && n.type === 'link');
  assert.equal(links.length, 2);
  assert.equal(links[0].href, 'https://esempio.it/a');
  assert.equal(plain(links[0].children), 'la guida');
  assert.equal(links[1].href, 'https://oracle.com');
});

test('blocco di codice con linguaggio', () => {
  const b = parseMarkdown('Ecco:\n\n```sql\nSELECT 1 FROM DUAL;\n```\n\nFine.');
  assert.deepEqual(
    b.map((x) => x.type),
    ['para', 'code', 'para']
  );
  assert.equal(b[1].lang, 'sql');
  assert.equal(b[1].code, 'SELECT 1 FROM DUAL;');
});

test('blocco di codice non ancora chiuso (risposta in streaming)', () => {
  const b = parseMarkdown('```sql\nSELECT 1');
  assert.equal(b.length, 1);
  assert.equal(b[0].type, 'code');
  assert.equal(b[0].code, 'SELECT 1');
});

test('elenco puntato con annidamento', () => {
  const b = parseMarkdown('- primo\n- secondo\n  - interno\n- terzo');
  assert.equal(b.length, 1);
  assert.equal(b[0].type, 'list');
  assert.equal(b[0].ordered, false);
  assert.equal(b[0].items.length, 3);
  const nested = b[0].items[1].blocks;
  assert.equal(nested[0].type, 'para');
  assert.equal(nested[1].type, 'list');
  assert.equal(plain(nested[1].items[0].blocks[0].inline), 'interno');
});

test('elenco numerato con numero di partenza', () => {
  const b = parseMarkdown('3. terzo\n4. quarto');
  assert.equal(b[0].ordered, true);
  assert.equal(b[0].start, 3);
  assert.equal(b[0].items.length, 2);
});

test('checkbox negli elenchi', () => {
  const b = parseMarkdown('- [x] fatto\n- [ ] da fare');
  assert.deepEqual(
    b[0].items.map((i) => i.task),
    [true, false]
  );
  assert.equal(plain(b[0].items[0].blocks[0].inline), 'fatto');
});

test('tabella con allineamenti', () => {
  const b = parseMarkdown('| Nome | Righe |\n| :--- | ----: |\n| ORDINI | 12 |\n| CLIENTI | 3 |');
  assert.equal(b.length, 1);
  assert.equal(b[0].type, 'table');
  assert.deepEqual(b[0].align, ['left', 'right']);
  assert.equal(plain(b[0].head[1]), 'Righe');
  assert.equal(b[0].rows.length, 2);
  assert.equal(plain(b[0].rows[1][0]), 'CLIENTI');
});

test('citazione e riga orizzontale', () => {
  const b = parseMarkdown('> attento\n> davvero\n\n---\n\ntesto');
  assert.deepEqual(
    b.map((x) => x.type),
    ['quote', 'hr', 'para']
  );
  assert.equal(plain(b[0].blocks[0].inline), 'attento\ndavvero');
});

test('a capo singolo dentro il paragrafo', () => {
  const b = parseMarkdown('prima\nseconda');
  assert.equal(b.length, 1);
  assert.equal(plain(b[0].inline), 'prima\nseconda');
});

test('colorazione SQL: parole chiave, stringhe e commenti', () => {
  const t = tokenizeCode("SELECT nome FROM t WHERE x = 'a' -- nota", 'sql');
  const kinds = Object.fromEntries(t.map((x) => [x.text.trim(), x.kind]));
  assert.equal(kinds.SELECT, 'keyword');
  assert.equal(kinds["'a'"], 'string');
  assert.equal(kinds['-- nota'], 'comment');
});

test('colorazione generica per gli altri linguaggi', () => {
  const t = tokenizeCode('const x = 1; // via', 'js');
  assert.equal(t.find((x) => x.text === 'const')?.kind, 'keyword');
  assert.equal(t.find((x) => x.text === '1')?.kind, 'number');
  assert.equal(t.find((x) => x.text.startsWith('//'))?.kind, 'comment');
});
