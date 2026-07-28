import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { requiredPermission, ToolError } from '../src/ai/tools.js';
import { parseArgs } from '../src/ai/providers.js';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

// ---- parametri obbligatori ----

test('chiamata senza i parametri obbligatori: errore esplicito', () => {
  assert.throws(() => requiredPermission('describe_table', {}), (err) => {
    assert.ok(err instanceof ToolError);
    assert.match(err.message, /describe_table.*name/s);
    return true;
  });
  assert.throws(() => requiredPermission('run_query', { sql: '   ' }), ToolError);
  assert.throws(() => requiredPermission('list_objects', { owner: 'WSS' }), ToolError);
});

test('chiamata completa: permesso calcolato normalmente', () => {
  assert.deepEqual(requiredPermission('describe_table', { name: 'TS_TIMESHEET' }), {
    level: 'read',
  });
  assert.equal(requiredPermission('run_query', { sql: 'SELECT 1 FROM dual' }).level, 'read');
  assert.equal(requiredPermission('execute_sql', { sql: 'UPDATE t SET a = 1' }).level, 'write');
});

// ---- argomenti troncati dal modello ----

test('argomenti validi: passano così come sono', () => {
  assert.deepEqual(parseArgs('{"name":"TS_TIMESHEET"}'), { input: { name: 'TS_TIMESHEET' } });
  assert.deepEqual(parseArgs(''), { input: {} });
});

test('argomenti troncati: segnalati invece di diventare un oggetto vuoto', () => {
  const r = parseArgs('{"sql":"SELECT * FROM TS_TIME');
  assert.deepEqual(r.input, {});
  assert.ok(r.invalid, 'la chiamata deve risultare non valida');
});

// ---- nomi dei bind ----

// Oracle rifiuta i bind che si chiamano come una parola riservata: `:like`
// faceva fallire list_objects con ORA-01745 a ogni ricerca filtrata.
const RESERVED = new Set(
  `ACCESS ADD ALL ALTER AND ANY AS ASC AUDIT BETWEEN BY CHAR CHECK CLUSTER COLUMN COMMENT
   COMPRESS CONNECT CREATE CURRENT DATE DECIMAL DEFAULT DELETE DESC DISTINCT DROP ELSE
   EXCLUSIVE EXISTS FILE FLOAT FOR FROM GRANT GROUP HAVING IDENTIFIED IMMEDIATE IN INCREMENT
   INDEX INITIAL INSERT INTEGER INTERSECT INTO IS LEVEL LIKE LOCK LONG MAXEXTENTS MINUS
   MLSLABEL MODE MODIFY NOAUDIT NOCOMPRESS NOT NOWAIT NULL NUMBER OF OFFLINE ON ONLINE OPTION
   OR ORDER PCTFREE PRIOR PUBLIC RAW RENAME RESOURCE REVOKE ROW ROWID ROWNUM ROWS SELECT
   SESSION SET SHARE SIZE SMALLINT START SUCCESSFUL SYNONYM SYSDATE TABLE THEN TO TRIGGER UID
   UNION UNIQUE UPDATE USER VALIDATE VALUES VARCHAR VARCHAR2 VIEW WHENEVER WHERE WITH`.split(
    /\s+/
  )
);

function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return jsFiles(full);
    return e.name.endsWith('.js') ? [full] : [];
  });
}

test('nessun bind si chiama come una parola riservata Oracle', () => {
  const bad = [];
  for (const file of jsFiles(SRC)) {
    const code = fs.readFileSync(file, 'utf8');
    // Esclude i `(?:` delle regex e i `}:` delle URL costruite con i template.
    for (const m of code.matchAll(/(?<![?\w}]):([A-Za-z_][A-Za-z0-9_]*)/g)) {
      if (RESERVED.has(m[1].toUpperCase())) bad.push(`${path.basename(file)}: :${m[1]}`);
    }
  }
  assert.deepEqual(bad, []);
});
