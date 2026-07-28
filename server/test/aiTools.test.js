import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { objectsText, overviewText, requiredPermission, ToolError } from '../src/ai/tools.js';
import { parseArgs } from '../src/ai/providers.js';
import { buildSystemPrompt } from '../src/ai/sessions.js';

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

// ---- elenchi letti dal modello ----

test('elenco di oggetti: conteggio, stato non valido e troncamento', () => {
  const r = { rows: [['CLIENTI', 'VALID'], ['ORDINI_V', 'INVALID']], truncated: false };
  assert.equal(objectsText('TABLE', 'WSS', r), 'TABLE in WSS: 2\nCLIENTI, ORDINI_V (INVALID)');
  assert.match(objectsText('TABLE', 'WSS', { rows: [], truncated: false }), /\(nessuno\)/);
  assert.match(objectsText('TABLE', 'WSS', { ...r, truncated: true }), /2\+ \(elenco troncato\)/);
});

// L'inventario finisce nel prompt di sistema: senza, i modelli piccoli
// chiedono all'utente quale tabella usare invece di guardare da soli.
const rows = (type, ...names) => names.map((n) => [type, n]);

test('inventario dello schema: tabelle e viste separate', () => {
  const text = overviewText('WSS', [...rows('TABLE', 'CLIENTI', 'ORDINI'), ...rows('VIEW', 'V_TOP')]);
  assert.equal(text, 'Tabelle in WSS (2): CLIENTI, ORDINI\nViste in WSS (1): V_TOP');
});

test('inventario dello schema: elenco lungo troncato con il totale intero', () => {
  const many = rows('TABLE', ...Array.from({ length: 10 }, (_, i) => `T${i}`));
  const text = overviewText('WSS', many, 4);
  assert.match(text, /Tabelle in WSS \(10\): T0, T1, T2, T3, … e altri 6/);
});

test('inventario dello schema: budget esaurito prima delle viste', () => {
  const text = overviewText('WSS', [...rows('TABLE', 'A', 'B'), ...rows('VIEW', 'V1')], 2);
  assert.match(text, /Viste in WSS \(1\): elenco troppo lungo/);
});

test('schema vuoto: indirizza su list_schemas invece di lasciare il vuoto', () => {
  assert.match(overviewText('WSS', []), /non contiene tabelle.*list_schemas/s);
});

// ---- prompt di sistema ----

// Le due istruzioni che i modelli piccoli sbagliavano: fermarsi all'elenco
// delle tabelle e chiedere all'utente quale usare.
test('prompt con connessione: inventario, procedura e divieto di fermarsi', () => {
  const p = buildSystemPrompt({
    entry: { user: 'WSS', currentSchema: 'WSS', version: '19.3' },
    permissions: { read: true, write: false },
    overview: 'Tabelle in WSS (2): CLIENTI, ORDINI',
  });
  assert.match(p, /Tabelle in WSS \(2\): CLIENTI, ORDINI/);
  assert.match(p, /Permessi concessi in questa sessione: lettura\./);
  assert.match(p, /describe_table/);
  assert.match(p, /Non fermarti a metà/);
  assert.match(p, /Non chiedere all'utente/);
});

test('prompt senza connessione: niente procedura sugli strumenti', () => {
  const p = buildSystemPrompt({ entry: null, permissions: {} });
  assert.match(p, /Nessuna connessione attiva/);
  assert.match(p, /Permessi concessi in questa sessione: nessuno\./);
  assert.doesNotMatch(p, /describe_table/);
  assert.match(p, /dialetto Oracle/);
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
