import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanNotes, shape, summarize } from '../src/routes/releases.js';

// Le note di una release sono la voce di CHANGELOG.md pubblicata dalla CI:
// arrivano con i fine riga di Windows, l'intestazione della versione, la riga
// dell'installer e i trailer dei commit.
const NOTES = [
  '## v1.19.0 — 2026-07-28',
  '',
  '- **Nuovo:** modello Gemma 4 locale',
  '',
  '  Gira sul computer dell\'utente, senza chiave e senza costi.',
  '',
  '  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>',
  '',
  '- Build: [`Orabridge Setup 1.19.0.exe`](https://example/x.exe) (2026-07-28).',
].join('\r\n');

test('note della release: via intestazione, riga Build, trailer e CRLF', () => {
  const out = cleanNotes(NOTES);
  assert.doesNotMatch(out, /## v1\.19/);
  assert.doesNotMatch(out, /Build:/);
  assert.doesNotMatch(out, /Co-Authored-By/);
  assert.doesNotMatch(out, /\r/);
  assert.match(out, /- \*\*Nuovo:\*\* modello Gemma 4 locale/);
  assert.match(out, /Gira sul computer dell'utente/);
});

test('riassunto: solo il primo punto, troncato sulla parola', () => {
  assert.equal(summarize(cleanNotes(NOTES)), '**Nuovo:** modello Gemma 4 locale');
  const long = `- ${'parola '.repeat(60)}`;
  const short = summarize(long, 40);
  assert.ok(short.length <= 41, `troppo lungo: ${short.length}`);
  assert.match(short, /…$/);
  assert.doesNotMatch(short, /parol…/);
});

test('release di GitHub: campi essenziali, bozze escluse', () => {
  const list = shape([
    { tag_name: 'v1.19.0', html_url: 'u1', published_at: '2026-07-28T15:25:07Z', body: NOTES },
    { tag_name: 'v1.20.0', draft: true, body: '' },
    { tag_name: '', body: '' },
  ]);
  assert.equal(list.length, 1);
  assert.deepEqual(
    { version: list[0].version, url: list[0].url, prerelease: list[0].prerelease },
    { version: '1.19.0', url: 'u1', prerelease: false }
  );
  assert.equal(list[0].summary, '**Nuovo:** modello Gemma 4 locale');
});

test('risposta inattesa da GitHub: elenco vuoto invece di un errore', () => {
  assert.deepEqual(shape(null), []);
  assert.deepEqual(shape({ message: 'Not Found' }), []);
});
