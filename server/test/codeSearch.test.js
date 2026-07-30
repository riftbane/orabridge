import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCodeSearch,
  groupMatches,
  matchRange,
  snippet,
  SEARCH_TYPES,
  DEFAULT_TYPES,
  SYSTEM_SCHEMAS,
} from '../src/routes/search.js';
// Le due build sono separate e non condividono moduli: se un elenco si sposta
// senza l'altro, il client chiederebbe tipi che il server rifiuta. L'unica cosa
// che se ne accorge è questo test, perciò l'importazione attraversa i pacchetti
// (a runtime non succede mai).
import {
  SEARCH_TYPES as CLIENT_TYPES,
  DEFAULT_SEARCH_TYPES,
} from '../../client/src/searchTypes.js';

const base = { q: 'saldo', currentSchema: 'HR' };

test('ricerca semplice: INSTR su UPPER, tipi predefiniti, schema di lavoro', () => {
  const { sql, binds, limit } = buildCodeSearch(base);
  assert.match(sql, /FROM all_source/);
  assert.match(sql, /INSTR\(UPPER\(s\.text\), :q\) > 0/);
  assert.equal(binds.q, 'SALDO'); // confronto in maiuscolo su entrambi i lati
  assert.equal(binds.owner, 'HR');
  assert.match(sql, /s\.owner = :owner/);
  assert.match(sql, /BIN\$%/); // niente oggetti nel cestino
  assert.deepEqual(
    DEFAULT_TYPES.map((_, i) => binds[`t${i}`]),
    DEFAULT_TYPES
  );
  assert.equal(limit, 1000);
});

test('maiuscole/minuscole rispettate: nessun UPPER e testo passato com’è', () => {
  const { sql, binds } = buildCodeSearch({ ...base, caseSensitive: true });
  assert.match(sql, /INSTR\(s\.text, :q\) > 0/);
  assert.equal(binds.q, 'saldo');
});

test('parola intera: regexp con confini sui caratteri non identificatori', () => {
  const { sql, binds } = buildCodeSearch({ ...base, q: 'v_x$', wholeWord: true });
  assert.match(sql, /REGEXP_LIKE\(s\.text, :q, 'i'\)/);
  // il $ del nome è un metacarattere: va escapato, non lasciato come àncora
  assert.equal(binds.q, '(^|[^A-Za-z0-9_$#])v_x\\$($|[^A-Za-z0-9_$#])');
});

test('regex: il testo arriva a Oracle senza modifiche', () => {
  const { sql, binds } = buildCodeSearch({
    ...base,
    q: '^\\s*RETURN',
    regex: true,
    caseSensitive: true,
  });
  assert.equal(binds.q, '^\\s*RETURN');
  assert.match(sql, /REGEXP_LIKE\(s\.text, :q, 'c'\)/);
});

test('ambiti: schema scelto, tutti gli utenti, tutti compresi quelli di Oracle', () => {
  const one = buildCodeSearch({ ...base, scope: 'one', owner: 'paghe' });
  assert.equal(one.binds.owner, 'PAGHE');

  const user = buildCodeSearch({ ...base, scope: 'user' });
  assert.match(user.sql, /s\.owner NOT IN \(:x0/);
  assert.equal(user.binds.x0, SYSTEM_SCHEMAS[0]);
  assert.ok(SYSTEM_SCHEMAS.includes('SYS'));

  const all = buildCodeSearch({ ...base, scope: 'all' });
  const whereOf = (sql) => sql.split('WHERE')[1].split('ORDER BY')[0];
  assert.doesNotMatch(whereOf(all.sql), /s\.owner/); // nessun filtro sullo schema
  assert.equal(all.binds.owner, undefined);
});

test('input rifiutati: testo vuoto, tipo sconosciuto, ambito sconosciuto', () => {
  assert.throws(() => buildCodeSearch({ ...base, q: '' }), /Testo da cercare/);
  assert.throws(() => buildCodeSearch({ ...base, types: ['TABLE'] }), /Tipo non valido/);
  assert.throws(() => buildCodeSearch({ ...base, scope: 'boh' }), /Ambito non valido/);
  assert.throws(() => buildCodeSearch({ q: 'x', scope: 'one', owner: '' }), /Schema mancante/);
});

test('limite: valore predefinito, minimo e tetto massimo', () => {
  assert.equal(buildCodeSearch({ ...base, limit: 50 }).limit, 50);
  assert.equal(buildCodeSearch({ ...base, limit: 99999 }).limit, 5000);
  assert.equal(buildCodeSearch({ ...base, limit: 0 }).limit, 1000);
  assert.equal(buildCodeSearch({ ...base, limit: 'boh' }).limit, 1000);
});

test('posizione del testo trovato dentro la riga', () => {
  assert.deepEqual(matchRange('  v_saldo := 0;', { q: 'SALDO' }), { from: 4, to: 9 });
  assert.equal(matchRange('  v_saldo := 0;', { q: 'SALDO', caseSensitive: true }), null);
  // parola intera: v_saldo non è "saldo"
  assert.equal(matchRange('  v_saldo := 0;', { q: 'saldo', wholeWord: true }), null);
  assert.deepEqual(matchRange('  saldo := 0;', { q: 'saldo', wholeWord: true }), {
    from: 2,
    to: 7,
  });
  assert.deepEqual(matchRange('RETURN x;', { q: '^RET\\w+', regex: true }), { from: 0, to: 6 });
  // sintassi accettata da Oracle ma non da JS: si perde l'evidenziazione, non il risultato
  assert.equal(matchRange('abc', { q: '[[:alpha:]]+', regex: true }), null);
});

test('riga mostrata: senza a capo, senza rientro, con offset riallineati', () => {
  const s = snippet('      v_saldo := 0;\n', matchRange('      v_saldo := 0;\n', { q: 'saldo' }));
  assert.equal(s.text, 'v_saldo := 0;');
  assert.equal(s.text.slice(s.from, s.to), 'saldo');
});

test('riga lunghissima: finestra centrata sul testo trovato', () => {
  const raw = 'x'.repeat(2000) + ' saldo ' + 'y'.repeat(2000);
  const s = snippet(raw, matchRange(raw, { q: 'saldo' }));
  assert.ok(s.text.length < 300);
  assert.ok(s.text.startsWith('…') && s.text.endsWith('…'));
  assert.equal(s.text.slice(s.from, s.to), 'saldo');
});

test('i tipi cercabili sono gli stessi da una parte e dall’altra', () => {
  assert.deepEqual(
    CLIENT_TYPES.map(([t]) => t).sort(),
    [...SEARCH_TYPES].sort()
  );
  assert.deepEqual([...DEFAULT_SEARCH_TYPES].sort(), [...DEFAULT_TYPES].sort());
});

test('righe raggruppate per oggetto, nell’ordine di arrivo', () => {
  const rows = [
    ['HR', 'CALC', 'FUNCTION', 3, '  v := saldo;\n'],
    ['HR', 'CALC', 'FUNCTION', 9, '  saldo := 1;\n'],
    ['HR', 'PKG', 'PACKAGE BODY', 42, '  -- saldo\n'],
  ];
  const objects = groupMatches(rows, { q: 'saldo' });
  assert.equal(objects.length, 2);
  assert.deepEqual(objects[0].matches.map((m) => m.line), [3, 9]);
  assert.equal(objects[1].type, 'PACKAGE BODY');
  assert.equal(objects[1].matches[0].text, '-- saldo');
});
