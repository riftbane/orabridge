import test from 'node:test';
import assert from 'node:assert/strict';
import { formatSql, safeFormatSql, tokenize } from '../src/sqlFormat.js';

test('indenta un package body con blocchi annidati', () => {
  const out = safeFormatSql(
    `create or replace package body pkg is
procedure p(a in number) is v number; begin
if a > 1 then v := 1; elsif a = 0 then v := 2; else v := 0; end if;
end p;
end pkg;`
  );
  assert.equal(
    out,
    [
      'CREATE OR REPLACE PACKAGE BODY pkg IS',
      '  PROCEDURE p(a IN NUMBER) IS',
      '    v NUMBER;',
      '  BEGIN',
      '    IF a > 1 THEN',
      '      v := 1;',
      '    ELSIF a = 0 THEN',
      '      v := 2;',
      '    ELSE',
      '      v := 0;',
      '    END IF;',
      '  END p;',
      'END pkg;',
    ].join('\n')
  );
});

test('rientra il corpo dei gestori di eccezione', () => {
  const out = safeFormatSql(`begin null; exception when others then rollback; raise; end;`);
  assert.equal(
    out,
    ['BEGIN', '  NULL;', 'EXCEPTION', '  WHEN OTHERS THEN', '    ROLLBACK;', '    RAISE;', 'END;'].join('\n')
  );
});

test('spezza le clausole SQL e tiene insieme i join', () => {
  const out = safeFormatSql(
    `select a.x from t a left outer join u b on a.id = b.id where a.y = 1 and b.z = 2 order by 1`
  );
  assert.equal(
    out,
    [
      'SELECT a.x',
      'FROM t a',
      'LEFT OUTER JOIN u b ON a.id = b.id',
      'WHERE a.y = 1 AND b.z = 2',
      'ORDER BY 1',
    ].join('\n')
  );
});

test('non spezza BETWEEN … AND né le funzioni con FROM', () => {
  const out = safeFormatSql(`select extract(year from d) from t where x between 1 and 2`);
  assert.equal(out, ['SELECT EXTRACT(YEAR FROM d)', 'FROM t', 'WHERE x BETWEEN 1 AND 2'].join('\n'));
});

test('IS di un cursore o di un tipo non apre un blocco', () => {
  const out = safeFormatSql(`declare cursor c is select 1 from dual; subtype s is number; begin null; end;`);
  assert.equal(
    out,
    [
      'DECLARE',
      '  CURSOR c IS',
      '  SELECT 1',
      '  FROM dual;',
      '  SUBTYPE s IS NUMBER;',
      'BEGIN',
      '  NULL;',
      'END;',
    ].join('\n')
  );
});

test('preserva stringhe, q-string e commenti', () => {
  const src = `-- testa
select q'[a'b]', 'c''d' /* dentro */ from dual; -- coda`;
  const out = safeFormatSql(src);
  assert.match(out, /-- testa/);
  assert.match(out, /q'\[a'b\]'/);
  assert.match(out, /'c''d'/);
  assert.match(out, /\/\* dentro \*\//);
  assert.match(out, /-- coda/);
});

test('manda a capo le righe troppo lunghe sulle virgole', () => {
  const cols = Array.from({ length: 12 }, (_, i) => `colonna_molto_lunga_${i}`).join(', ');
  const out = safeFormatSql(`select ${cols} from t`);
  assert.ok(out.split('\n').length > 3);
  assert.ok(out.split('\n').every((l) => l.length <= 100));
});

test('è idempotente', () => {
  const src = `create or replace function f(p in varchar2) return number is
begin
for r in (select id from t where name = p order by id) loop
if r.id > 0 then return r.id; end if;
end loop;
return 0;
end f;`;
  const once = safeFormatSql(src);
  assert.equal(safeFormatSql(once), once);
});

test('safeFormatSql rifiuta un risultato che perde token', () => {
  const src = 'select 1 from dual';
  assert.equal(safeFormatSql(src), 'SELECT 1\nFROM dual');
  // La verifica confronta i token: un output alterato deve far fallire.
  const tokens = tokenize(formatSql(src));
  assert.deepEqual(
    tokens.map((t) => t.text.toUpperCase()),
    ['SELECT', '1', 'FROM', 'DUAL']
  );
});

test('non altera il numero di token su un corpo complesso', () => {
  const src = `create or replace package body p is
  procedure a is begin merge into t using (select 1 x from dual) s on (t.id = s.x)
    when matched then update set t.v = 1
    when not matched then insert (id, v) values (s.x, 0);
  commit; end a;
end p;`;
  const before = tokenize(src).map((t) => t.text.toUpperCase());
  const after = tokenize(safeFormatSql(src)).map((t) => t.text.toUpperCase());
  assert.deepEqual(after, before);
});
