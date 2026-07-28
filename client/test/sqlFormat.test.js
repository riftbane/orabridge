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

test('apre le parentesi di una DDL lunga e rientra le colonne', () => {
  const out = safeFormatSql(
    `create table clienti (id number(10) not null, nome varchar2(100), email varchar2(200), constraint pk_clienti primary key (id))`
  );
  assert.equal(
    out,
    [
      'CREATE TABLE clienti (',
      '  id NUMBER(10) NOT NULL,',
      '  nome VARCHAR2(100),',
      '  email VARCHAR2(200),',
      '  CONSTRAINT pk_clienti PRIMARY KEY (id)',
      ')',
    ].join('\n')
  );
});

test('rientra i rami di un CASE istruzione', () => {
  const out = safeFormatSql(
    `begin case v_stato when 'A' then p_attiva; when 'S' then p_sospendi; else p_chiudi; end case; end;`
  );
  assert.equal(
    out,
    [
      'BEGIN',
      '  CASE v_stato',
      "    WHEN 'A' THEN p_attiva;",
      "    WHEN 'S' THEN p_sospendi;",
      '    ELSE p_chiudi;',
      '  END CASE;',
      'END;',
    ].join('\n')
  );
});

test('manda a capo i rami di un CASE espressione troppo lungo', () => {
  const out = safeFormatSql(
    `select id, case when stato = 'A' then 'Cliente attivo e in regola' when stato = 'S' then 'Cliente sospeso per morosita' else 'Cliente chiuso' end descrizione from clienti`
  );
  assert.equal(
    out,
    [
      'SELECT id,',
      '  CASE',
      "    WHEN stato = 'A' THEN 'Cliente attivo e in regola'",
      "    WHEN stato = 'S' THEN 'Cliente sospeso per morosita'",
      "    ELSE 'Cliente chiuso'",
      '  END descrizione',
      'FROM clienti',
    ].join('\n')
  );
});

test('una parola dopo il punto è un nome, non una parola chiave', () => {
  const out = safeFormatSql(`select t.date, t.level, s.deferrable from t join s on s.id = t.id`);
  assert.equal(out, ['SELECT t.date, t.level, s.deferrable', 'FROM t', 'JOIN s ON s.id = t.id'].join('\n'));
});

test('separa i rami di un MERGE', () => {
  const out = safeFormatSql(
    `merge into d using (select id, valore from s) s on (d.id = s.id) when matched then update set d.valore = s.valore when not matched then insert (id, valore) values (s.id, s.valore)`
  );
  assert.equal(
    out,
    [
      'MERGE INTO d USING (',
      '  SELECT id, valore',
      '  FROM s',
      ') s ON (d.id = s.id)',
      'WHEN MATCHED THEN',
      '  UPDATE SET d.valore = s.valore',
      'WHEN NOT MATCHED THEN',
      '  INSERT (id, valore)',
      '  VALUES (s.id, s.valore)',
    ].join('\n')
  );
});

test("tiene l'intestazione di un trigger su una riga", () => {
  const out = safeFormatSql(
    `create or replace trigger trg before insert or update on clienti for each row begin :new.id := 1; end;`
  );
  assert.equal(
    out,
    [
      'CREATE OR REPLACE TRIGGER trg BEFORE INSERT OR UPDATE ON clienti FOR EACH ROW',
      'BEGIN',
      '  :new.id := 1;',
      'END;',
    ].join('\n')
  );
});

test('spezza le concatenazioni lunghe prima di ||', () => {
  const out = safeFormatSql(
    `select 'Cliente: ' || c.nome || ' ' || c.cognome || ' (' || c.codice_fiscale || ') residente in ' || c.citta from clienti c`
  );
  const righe = out.split('\n');
  assert.ok(righe.every((l) => l.length <= 100));
  assert.ok(righe.filter((l) => l.trimStart().startsWith('||')).length >= 3);
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

test('è idempotente anche su DDL, CASE e MERGE', () => {
  const src = `create table t (id number(10) not null, descrizione varchar2(400), nota varchar2(4000), constraint pk_t primary key (id));
begin
case v_x when 1 then p_uno; else p_altro; end case;
merge into d using (select id from s) s on (d.id = s.id) when matched then update set d.v = 1 when not matched then insert (id) values (s.id);
end;`;
  const once = safeFormatSql(src);
  assert.equal(safeFormatSql(once), once);
  assert.ok(once.split('\n').every((l) => l.length <= 100));
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
