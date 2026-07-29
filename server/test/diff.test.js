import test from 'node:test';
import assert from 'node:assert/strict';
import { compareSnapshots } from '../src/diff/compare.js';
import { buildSyncScript } from '../src/diff/script.js';
import { columnType, nameMatcher, sourceKey, isIdentitySequence } from '../src/diff/snapshot.js';

// ---- costruttori di snapshot finti ----

const col = (name, type, extra = {}) => ({
  name,
  type,
  notNull: false,
  default: null,
  comment: null,
  ...extra,
});

const table = (name, columns, extra = {}) => ({
  name,
  comment: null,
  temporary: false,
  onCommit: null,
  columns,
  constraints: [],
  indexes: [],
  ...extra,
});

const cons = (name, type, columns, extra = {}) => ({
  name,
  type,
  columns,
  condition: null,
  refOwner: null,
  refTable: null,
  refColumns: [],
  deleteRule: null,
  disabled: false,
  generated: false,
  ...extra,
});

const idx = (name, columns, extra = {}) => ({
  name,
  unique: false,
  type: 'NORMAL',
  columns,
  generated: false,
  unusable: false,
  ...extra,
});

const snapshot = (owner, parts = {}) => ({
  owner,
  tables: {},
  views: {},
  mviews: {},
  sequences: {},
  synonyms: {},
  triggers: {},
  sources: {},
  ...parts,
});

const byName = (list) => Object.fromEntries(list.map((x) => [x.name, x]));
const find = (items, type, name) => items.find((i) => i.type === type && i.name === name);

// ---- snapshot.js ----

test('columnType costruisce il tipo canonico', () => {
  assert.equal(
    columnType({ dataType: 'VARCHAR2', charLength: 30, charUsed: 'B', dataLength: 30 }),
    'VARCHAR2(30 BYTE)'
  );
  assert.equal(columnType({ dataType: 'NUMBER', precision: 10, scale: 2 }), 'NUMBER(10,2)');
  assert.equal(columnType({ dataType: 'NUMBER', precision: 10, scale: 0 }), 'NUMBER(10)');
  assert.equal(columnType({ dataType: 'NUMBER', precision: null, scale: null }), 'NUMBER');
  assert.equal(columnType({ dataType: 'TIMESTAMP(6) WITH TIME ZONE' }), 'TIMESTAMP(6) WITH TIME ZONE');
  assert.equal(columnType({ dataType: 'T_INDIRIZZO', typeOwner: 'APP' }), 'APP.T_INDIRIZZO');
});

test('le sequenze di identità si riconoscono dal nome', () => {
  assert.ok(isIdentitySequence('ISEQ$$_176443'));
  assert.ok(!isIdentitySequence('SEQ_ID_RFQ'));
  assert.ok(!isIdentitySequence('ISEQ_CLIENTI'));
});

test('nameMatcher: sottostringa o pattern LIKE', () => {
  assert.ok(nameMatcher('cli')('CLIENTI'));
  assert.ok(!nameMatcher('cli')('ORDINI'));
  assert.ok(nameMatcher('CLI%')('CLIENTI'));
  assert.ok(!nameMatcher('CLI%')('DETT_CLIENTI'));
  assert.ok(nameMatcher('')('QUALSIASI'));
});

// ---- confronto ----

test('oggetti presenti da un lato solo', () => {
  const src = snapshot('A', { tables: byName([table('CLIENTI', [col('ID', 'NUMBER')])]) });
  const tgt = snapshot('A', { tables: byName([table('ORDINI', [col('ID', 'NUMBER')])]) });
  const { items, counts } = compareSnapshots(src, tgt);
  assert.equal(find(items, 'TABLE', 'CLIENTI').status, 'only-source');
  assert.equal(find(items, 'TABLE', 'ORDINI').status, 'only-target');
  assert.deepEqual(counts, { onlySource: 1, onlyTarget: 1, different: 0, same: 0 });
});

test('tabella identica: nessuna differenza', () => {
  const t = () => table('CLIENTI', [col('ID', 'NUMBER', { notNull: true }), col('NOME', 'VARCHAR2(50 BYTE)')]);
  const { items } = compareSnapshots(
    snapshot('A', { tables: byName([t()]) }),
    snapshot('A', { tables: byName([t()]) })
  );
  assert.equal(find(items, 'TABLE', 'CLIENTI').status, 'same');
});

test('differenze di colonna: aggiunta, rimossa, modificata', () => {
  const src = snapshot('A', {
    tables: byName([
      table('CLIENTI', [
        col('ID', 'NUMBER', { notNull: true }),
        col('NOME', 'VARCHAR2(100 BYTE)'),
        col('EMAIL', 'VARCHAR2(200 BYTE)'),
      ]),
    ]),
  });
  const tgt = snapshot('A', {
    tables: byName([
      table('CLIENTI', [
        col('ID', 'NUMBER', { notNull: true }),
        col('NOME', 'VARCHAR2(50 BYTE)'),
        col('OBSOLETA', 'DATE'),
      ]),
    ]),
  });
  const item = find(compareSnapshots(src, tgt).items, 'TABLE', 'CLIENTI');
  assert.equal(item.status, 'different');
  const kinds = item.changes.map((c) => `${c.name}:${c.change}`);
  assert.deepEqual(kinds.sort(), ['EMAIL:only-source', 'NOME:different', 'OBSOLETA:only-target']);

  const { sql } = buildSyncScript(src, tgt, [item], {});
  assert.match(sql, /ALTER TABLE "A"\."CLIENTI" ADD \(\n\s+"EMAIL" VARCHAR2\(200 BYTE\)\n\)/);
  assert.match(sql, /ALTER TABLE "A"\."CLIENTI" MODIFY \("NOME" VARCHAR2\(100 BYTE\)\)/);
  // senza l'opzione di eliminazione la colonna di troppo resta, ma va segnalata
  assert.doesNotMatch(sql, /DROP \("OBSOLETA"\)/);
  assert.match(sql, /colonne solo nella destinazione non eliminate — OBSOLETA/);

  const conDrops = buildSyncScript(src, tgt, [item], { includeDrops: true }).sql;
  assert.match(conDrops, /ALTER TABLE "A"\."CLIENTI" DROP \("OBSOLETA"\);/);
});

test('MODIFY elenca solo gli attributi che cambiano davvero', () => {
  const src = snapshot('A', {
    tables: byName([table('T', [col('C', 'NUMBER', { notNull: true, default: '0' })])]),
  });
  const tgt = snapshot('A', {
    tables: byName([table('T', [col('C', 'NUMBER', { notNull: false, default: '0' })])]),
  });
  const item = find(compareSnapshots(src, tgt).items, 'TABLE', 'T');
  const { sql } = buildSyncScript(src, tgt, [item], {});
  // il tipo e il default sono uguali: nell'istruzione non devono comparire
  assert.match(sql, /MODIFY \("C" NOT NULL\)/);
});

test('colonne di identità: id di sequenza diversi non sono una differenza', () => {
  const t = (kind) =>
    table('ACQUISTO_RFQ', [col('ID', 'NUMBER', { notNull: true, identity: kind })]);
  const src = snapshot('SSPE', { tables: byName([t('BY DEFAULT')]) });
  const tgt = snapshot('SS', { tables: byName([t('BY DEFAULT')]) });
  assert.equal(find(compareSnapshots(src, tgt).items, 'TABLE', 'ACQUISTO_RFQ').status, 'same');

  // il tipo di generazione, invece, è una differenza vera
  const diverse = compareSnapshots(
    snapshot('SSPE', { tables: byName([t('ALWAYS')]) }),
    snapshot('SS', { tables: byName([t('BY DEFAULT')]) })
  );
  const item = find(diverse.items, 'TABLE', 'ACQUISTO_RFQ');
  assert.equal(item.status, 'different');
  assert.match(item.changes[0].source, /GENERATED ALWAYS AS IDENTITY/);
  // non si prova a rifarla con un MODIFY: viene segnalata e basta
  const { sql } = buildSyncScript(
    snapshot('SSPE', { tables: byName([t('ALWAYS')]) }),
    snapshot('SS', { tables: byName([t('BY DEFAULT')]) }),
    [item],
    {}
  );
  assert.doesNotMatch(sql, /MODIFY/);
  assert.match(sql, /va ricreata a mano/);
});

test("se all_tab_identity_cols non è leggibile, il default ISEQ$$ viene comunque neutralizzato", () => {
  const t = (owner, seq) =>
    snapshot(owner, {
      tables: byName([
        table('T', [col('ID', 'NUMBER', { notNull: true, default: `"${owner}"."${seq}".nextval` })]),
      ]),
    });
  const src = t('SSPE', 'ISEQ$$_176443');
  const tgt = t('SS', 'ISEQ$$_593557');
  const { items } = compareSnapshots(src, tgt);
  assert.equal(find(items, 'TABLE', 'T').status, 'same');

  // e se la tabella va creata, la colonna torna a essere di identità invece
  // di puntare a una sequenza di sistema che nella destinazione non esiste
  const vuoto = snapshot('SS');
  const { sql } = buildSyncScript(src, vuoto, compareSnapshots(src, vuoto).items, {});
  assert.match(sql, /"ID" NUMBER GENERATED BY DEFAULT AS IDENTITY/);
  assert.doesNotMatch(sql, /ISEQ\$\$/);
});

test('il DEFAULT che cita una sequenza viene rimappato sulla destinazione', () => {
  const src = snapshot('SPASS', {
    tables: byName([
      table('ACQUISTO_RFQ', [
        col('ID_RFQ_ACQUISTO', 'NUMBER', {
          notNull: true,
          default: '"SPASS"."SEQ_ID_RFQ"."NEXTVAL"',
        }),
      ]),
    ]),
  });
  const tgt = snapshot('SPAEC');

  const { sql } = buildSyncScript(src, tgt, compareSnapshots(src, tgt).items, {});
  assert.match(sql, /CREATE TABLE "SPAEC"\."ACQUISTO_RFQ"/);
  assert.match(sql, /DEFAULT "SPAEC"\."SEQ_ID_RFQ"\."NEXTVAL"/);
  assert.doesNotMatch(sql, /"SPASS"/);

  // e lo stesso default, letto dai due schemi, non è una differenza
  const stessa = compareSnapshots(src, {
    ...src,
    owner: 'SPAEC',
    tables: byName([
      table('ACQUISTO_RFQ', [
        col('ID_RFQ_ACQUISTO', 'NUMBER', {
          notNull: true,
          default: '"SPAEC"."SEQ_ID_RFQ"."NEXTVAL"',
        }),
      ]),
    ]),
  });
  assert.equal(find(stessa.items, 'TABLE', 'ACQUISTO_RFQ').status, 'same');
});

test('colonne virtuali: espressione, non DEFAULT', () => {
  const src = snapshot('DEV', {
    tables: byName([
      table('T', [
        col('A', 'NUMBER'),
        col('TOT', 'NUMBER', { virtual: true, default: '"A"*2' }),
      ]),
    ]),
  });
  const { sql } = buildSyncScript(src, snapshot('PROD'), compareSnapshots(src, snapshot('PROD')).items, {});
  assert.match(sql, /"TOT" AS \("A"\*2\) VIRTUAL/);
  assert.doesNotMatch(sql, /DEFAULT "A"\*2/);
});

test("l'espressione di un indice funzionale si rimappa sulla destinazione", () => {
  const src = snapshot('DEV', {
    tables: byName([
      table('T', [col('C', 'VARCHAR2(10 BYTE)')], {
        indexes: [idx('IX_T_FN', ['"DEV"."PULISCI"("C")'])],
      }),
    ]),
  });
  const tgt = snapshot('PROD');
  const { sql } = buildSyncScript(src, tgt, compareSnapshots(src, tgt).items, {});
  assert.match(sql, /CREATE INDEX "PROD"\."IX_T_FN" ON "PROD"\."T" \("PROD"\."PULISCI"\("C"\)\)/);
});

test('una colonna NOT NULL senza default viene segnalata', () => {
  const src = snapshot('A', {
    tables: byName([table('T', [col('ID', 'NUMBER'), col('NUOVA', 'DATE', { notNull: true })])]),
  });
  const tgt = snapshot('A', { tables: byName([table('T', [col('ID', 'NUMBER')])]) });
  const item = find(compareSnapshots(src, tgt).items, 'TABLE', 'T');
  const { sql } = buildSyncScript(src, tgt, [item], {});
  assert.match(sql, /colonne NOT NULL senza DEFAULT/);
  const avviso = sql.indexOf('colonne NOT NULL senza DEFAULT');
  assert.ok(avviso > 0 && avviso < sql.indexOf('ALTER TABLE "A"."T" ADD'), 'prima dell\'istruzione');
});

test('i vincoli con nome generato si accoppiano per firma', () => {
  const withCheck = (name) =>
    table('T', [col('C', 'NUMBER')], {
      constraints: [cons(name, 'C', ['C'], { condition: 'C > 0', generated: true })],
    });
  const { items } = compareSnapshots(
    snapshot('A', { tables: byName([withCheck('SYS_C0011111')]) }),
    snapshot('A', { tables: byName([withCheck('SYS_C0022222')]) })
  );
  assert.equal(find(items, 'TABLE', 'T').status, 'same');

  // con l'opzione disattivata i due nomi diversi sono una differenza
  const strict = compareSnapshots(
    snapshot('A', { tables: byName([withCheck('SYS_C0011111')]) }),
    snapshot('A', { tables: byName([withCheck('SYS_C0022222')]) }),
    { ignoreGeneratedNames: false }
  );
  assert.equal(find(strict.items, 'TABLE', 'T').status, 'different');
});

test('un vincolo modificato viene prima eliminato e poi ricreato', () => {
  const src = snapshot('A', {
    tables: byName([
      table('T', [col('A', 'NUMBER'), col('B', 'NUMBER')], {
        constraints: [cons('UQ_T', 'U', ['A', 'B'])],
      }),
    ]),
  });
  const tgt = snapshot('A', {
    tables: byName([
      table('T', [col('A', 'NUMBER'), col('B', 'NUMBER')], {
        constraints: [cons('UQ_T', 'U', ['A'])],
      }),
    ]),
  });
  const item = find(compareSnapshots(src, tgt).items, 'TABLE', 'T');
  assert.equal(item.status, 'different');
  const { sql } = buildSyncScript(src, tgt, [item], {});
  const drop = sql.indexOf('DROP CONSTRAINT "UQ_T"');
  const add = sql.indexOf('ADD CONSTRAINT "UQ_T" UNIQUE ("A", "B")');
  assert.ok(drop > 0 && add > drop, 'il DROP deve precedere l\'ADD');
});

test("l'indice che regge una PK non viene confrontato due volte", () => {
  const t = () =>
    table('T', [col('ID', 'NUMBER')], {
      constraints: [cons('PK_T', 'P', ['ID'])],
      indexes: [idx('PK_T', ['ID'], { unique: true })],
    });
  const { items } = compareSnapshots(
    snapshot('A', { tables: byName([t()]) }),
    snapshot('A', { tables: byName([t()]) })
  );
  assert.equal(find(items, 'TABLE', 'T').status, 'same');
});

test('viste: indentazione e righe vuote si ignorano, il contenuto no', () => {
  const view = (text) => snapshot('A', { views: { V: { name: 'V', text } } });
  assert.equal(
    find(
      compareSnapshots(view('SELECT   1\n\n     FROM dual  '), view('SELECT 1\nFROM dual')).items,
      'VIEW',
      'V'
    ).status,
    'same'
  );
  const diverse = compareSnapshots(view('SELECT 1 FROM dual'), view('SELECT 2 FROM dual'));
  assert.equal(find(diverse.items, 'VIEW', 'V').status, 'different');
  assert.equal(find(diverse.items, 'VIEW', 'V').text, true);
});

test('i riferimenti allo schema si rimappano fra origine e destinazione', () => {
  const src = snapshot('DEV', { views: { V: { name: 'V', text: 'SELECT * FROM DEV.CLIENTI' } } });
  const tgt = snapshot('PROD', { views: { V: { name: 'V', text: 'SELECT * FROM PROD.CLIENTI' } } });
  assert.equal(find(compareSnapshots(src, tgt).items, 'VIEW', 'V').status, 'same');
  assert.equal(
    find(compareSnapshots(src, tgt, { remapSchema: false }).items, 'VIEW', 'V').status,
    'different'
  );
});

test('sequenze: ALTER solo per le proprietà cambiate, last_number ignorato', () => {
  const seq = (extra) => ({
    name: 'S',
    min: '1',
    max: '999',
    increment: '1',
    cycle: false,
    order: false,
    cache: '20',
    lastNumber: '41',
    ...extra,
  });
  const src = snapshot('A', { sequences: { S: seq({ increment: '2', lastNumber: '100' }) } });
  const tgt = snapshot('A', { sequences: { S: seq({}) } });
  const item = find(compareSnapshots(src, tgt).items, 'SEQUENCE', 'S');
  assert.equal(item.status, 'different');
  assert.deepEqual(item.changes.map((c) => c.name), ['Incremento']);

  const { sql } = buildSyncScript(src, tgt, [item], {});
  assert.match(sql, /ALTER SEQUENCE "A"\."S"\n\s+INCREMENT BY 2;/);
  assert.doesNotMatch(sql, /MAXVALUE/);
});

test('la sequenza nuova parte dal valore corrente in origine', () => {
  const src = snapshot('A', {
    sequences: {
      S: { name: 'S', min: '1', max: '999', increment: '1', cycle: false, order: false, cache: '20', lastNumber: '500' },
    },
  });
  const tgt = snapshot('A');
  const items = compareSnapshots(src, tgt).items;
  const { sql, stats } = buildSyncScript(src, tgt, items, {});
  assert.match(sql, /CREATE SEQUENCE "A"\."S"\n\s+START WITH 500/);
  assert.equal(stats.created, 1);
});

test('CREATE TABLE completo, con FK e indici a parte', () => {
  const src = snapshot('DEV', {
    tables: byName([
      table(
        'ORDINI',
        [
          col('ID', 'NUMBER', { notNull: true }),
          col('CLIENTE_ID', 'NUMBER'),
          col('CREATO_IL', 'DATE', { default: 'SYSDATE', comment: 'quando' }),
        ],
        {
          comment: 'testata ordini',
          constraints: [
            cons('PK_ORDINI', 'P', ['ID']),
            cons('FK_ORD_CLI', 'R', ['CLIENTE_ID'], {
              refOwner: 'DEV',
              refTable: 'CLIENTI',
              refColumns: ['ID'],
              deleteRule: 'CASCADE',
            }),
          ],
          indexes: [idx('IX_ORD_CLI', ['CLIENTE_ID']), idx('PK_ORDINI', ['ID'], { unique: true })],
        }
      ),
    ]),
  });
  const tgt = snapshot('PROD');
  const items = compareSnapshots(src, tgt).items;
  const { sql } = buildSyncScript(src, tgt, items, {});

  // creata nello schema di destinazione, non in quello di origine
  assert.match(sql, /CREATE TABLE "PROD"\."ORDINI" \(/);
  assert.match(sql, /"CREATO_IL" DATE DEFAULT SYSDATE/);
  assert.match(sql, /CONSTRAINT "PK_ORDINI" PRIMARY KEY \("ID"\)/);
  // la FK arriva dopo la CREATE, e punta allo schema di destinazione
  const create = sql.indexOf('CREATE TABLE');
  const fk = sql.indexOf('FOREIGN KEY ("CLIENTE_ID") REFERENCES "PROD"."CLIENTI" ("ID") ON DELETE CASCADE');
  assert.ok(fk > create);
  // l'indice della PK non va ricreato a mano, quello normale sì
  assert.match(sql, /CREATE INDEX "PROD"\."IX_ORD_CLI" ON "PROD"\."ORDINI" \("CLIENTE_ID"\)/);
  assert.doesNotMatch(sql, /CREATE UNIQUE INDEX "PROD"\."PK_ORDINI"/);
  assert.match(sql, /COMMENT ON TABLE "PROD"\."ORDINI" IS 'testata ordini'/);
  assert.match(sql, /COMMENT ON COLUMN "PROD"\."ORDINI"\."CREATO_IL" IS 'quando'/);
});

test('una colonna aggiunta si porta dietro il suo commento', () => {
  const base = (columns) =>
    snapshot('DEV', { tables: byName([table('T', columns)]) });
  const src = base([col('ID', 'NUMBER'), col('NOTE', 'VARCHAR2(10)', { comment: 'appunti' })]);
  const tgt = { ...base([col('ID', 'NUMBER')]), owner: 'PROD' };

  const items = compareSnapshots(src, tgt).items;
  const { sql } = buildSyncScript(src, tgt, items, {});
  assert.match(sql, /ALTER TABLE "PROD"\."T" ADD \(/);
  assert.match(sql, /COMMENT ON COLUMN "PROD"\."T"\."NOTE" IS 'appunti'/);
});

test('sorgenti PL/SQL: CREATE OR REPLACE chiuso da /', () => {
  const pkg = (body) =>
    snapshot('DEV', {
      sources: {
        [sourceKey('PACKAGE', 'P')]: { type: 'PACKAGE', name: 'P', text: body, invalid: false },
      },
    });
  const src = pkg('PACKAGE P AS\n  PROCEDURE fai;\nEND P;');
  const tgt = pkg('PACKAGE P AS\n  PROCEDURE fai_altro;\nEND P;');
  const item = find(compareSnapshots(src, tgt).items, 'PACKAGE', 'P');
  assert.equal(item.status, 'different');

  const { sql } = buildSyncScript(src, tgt, [item], {});
  assert.match(sql, /CREATE OR REPLACE PACKAGE P AS/);
  assert.match(sql, /END P;\n\/$/m);
});

test('gli oggetti solo nella destinazione si eliminano solo se richiesto', () => {
  const src = snapshot('A');
  const tgt = snapshot('A', {
    tables: byName([table('VECCHIA', [col('ID', 'NUMBER')])]),
    views: { V_VECCHIA: { name: 'V_VECCHIA', text: 'SELECT 1 FROM dual' } },
  });
  const items = compareSnapshots(src, tgt).items;

  const senza = buildSyncScript(src, tgt, items, {});
  assert.doesNotMatch(senza.sql, /DROP /);
  assert.equal(senza.stats.skippedDrops, 2);

  const con = buildSyncScript(src, tgt, items, { includeDrops: true });
  assert.match(con.sql, /DROP TABLE "A"\."VECCHIA" CASCADE CONSTRAINTS;/);
  assert.match(con.sql, /DROP VIEW "A"\."V_VECCHIA";/);
  assert.equal(con.stats.dropped, 2);
});

test('i sinonimi che puntano al proprio schema non risultano diversi', () => {
  const src = snapshot('DEV', {
    synonyms: { S: { name: 'S', tableOwner: 'DEV', tableName: 'T', dbLink: null } },
  });
  const tgt = snapshot('PROD', {
    synonyms: { S: { name: 'S', tableOwner: 'PROD', tableName: 'T', dbLink: null } },
  });
  assert.equal(find(compareSnapshots(src, tgt).items, 'SYNONYM', 'S').status, 'same');
});

test('il filtro dei tipi limita gli oggetti confrontati', () => {
  const src = snapshot('A', {
    tables: byName([table('T', [col('ID', 'NUMBER')])]),
    views: { V: { name: 'V', text: 'SELECT 1 FROM dual' } },
  });
  const { items } = compareSnapshots(src, snapshot('A'), { types: ['VIEW'] });
  assert.deepEqual(items.map((i) => i.type), ['VIEW']);
});
