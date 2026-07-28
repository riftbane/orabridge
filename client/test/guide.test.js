import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGuide, highlightsMd, searchGuide, RELEASE_HIGHLIGHTS } from '../src/guide.js';
import { parseMarkdown } from '../src/markdown.js';

const guide = buildGuide({ version: '1.2.3', desktop: true });

test('ogni sezione ha id univoco, titolo, sommario e testo', () => {
  const ids = new Set();
  for (const s of guide) {
    assert.ok(s.id && !ids.has(s.id), `id mancante o duplicato: ${s.id}`);
    ids.add(s.id);
    assert.ok(s.title.length > 0);
    assert.ok(s.summary.length > 0);
    assert.ok(s.md.length > 100, `sezione troppo corta: ${s.id}`);
  }
});

test('i collegamenti interni puntano a sezioni esistenti', () => {
  const ids = new Set(guide.map((s) => s.id));
  for (const s of guide) {
    for (const [, target] of s.md.matchAll(/\]\(#([\w-]+)\)/g)) {
      assert.ok(ids.has(target), `${s.id} rimanda a #${target}, che non esiste`);
    }
  }
});

test('il testo è Markdown valido per il renderer dell\'app', () => {
  for (const s of guide) {
    const blocks = parseMarkdown(s.md);
    assert.ok(blocks.length > 0, `nessun blocco in ${s.id}`);
  }
});

test('la sezione aggiornamenti riporta versione e modalità di installazione', () => {
  const desktop = buildGuide({ version: '1.2.3', desktop: true }).find(
    (s) => s.id === 'aggiornamenti'
  );
  assert.match(desktop.md, /1\.2\.3/);
  assert.match(desktop.md, /App desktop/);
  assert.match(desktop.md, /si aggiorna da sola/);

  const web = buildGuide({ version: '1.2.3', desktop: false }).find(
    (s) => s.id === 'aggiornamenti'
  );
  assert.match(web.md, /Client web/);
  assert.match(web.md, /docker compose/);
});

test('le novità diventano un elenco markdown, righe successive rientrate', () => {
  const md = highlightsMd(2);
  const items = parseMarkdown(md);
  assert.equal(items.length, 1);
  assert.equal(items[0].type, 'list');
  assert.equal(items[0].items.length, 2);
  assert.match(md, new RegExp(`\\*\\*${RELEASE_HIGHLIGHTS[0].version}\\*\\*`));
});

test('la ricerca filtra per parole, ignorando maiuscole e accenti', () => {
  assert.equal(searchGuide(guide, '').length, guide.length);
  assert.deepEqual(
    searchGuide(guide, 'DB Diff').map((s) => s.id),
    searchGuide(guide, 'db diff').map((s) => s.id)
  );
  assert.ok(searchGuide(guide, 'piu').some((s) => s.md.includes('più')));
  assert.equal(searchGuide(guide, 'zzz-non-esiste').length, 0);

  const scorciatoie = searchGuide(guide, 'Ctrl+Alt+I');
  assert.ok(scorciatoie.some((s) => s.id === 'scorciatoie'));
});
