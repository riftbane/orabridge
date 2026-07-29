// Costruttori di snapshot finti, condivisi dai test dell'editor a nodi.
// Il nome non finisce in `.test.js`: `node --test test/*.test.js` non lo
// raccoglie come suite.

export const col = (name, type, extra = {}) => ({
  name,
  id: null,
  type,
  notNull: false,
  default: null,
  identity: null,
  virtual: false,
  comment: null,
  ...extra,
});

export const cons = (name, type, columns, extra = {}) => ({
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

export const fk = (name, columns, refTable, refColumns, extra = {}) =>
  cons(name, 'R', columns, { refOwner: 'APP', refTable, refColumns, ...extra });

export const idx = (name, columns, extra = {}) => ({
  name,
  unique: false,
  type: 'NORMAL',
  columns,
  generated: false,
  unusable: false,
  ...extra,
});

export const table = (name, columns, extra = {}) => ({
  name,
  comment: null,
  temporary: false,
  onCommit: null,
  columns,
  constraints: [],
  indexes: [],
  ...extra,
});

export const seq = (name, extra = {}) => ({
  name,
  min: '1',
  max: '9999999999',
  increment: '1',
  cycle: false,
  order: false,
  cache: '20',
  lastNumber: '1',
  ...extra,
});

export const byName = (list) => Object.fromEntries(list.map((x) => [x.name, x]));

export const snapshot = (owner, parts = {}) => ({
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

// Lo schema di riferimento dei test: CLIENTI (padre) e ORDINI (figlia), con
// chiave primaria, FK, indice e commenti — abbastanza da esercitare ogni
// riferimento che il modello deve saper tradurre.
export const demo = () =>
  snapshot('APP', {
    tables: byName([
      table(
        'CLIENTI',
        [
          col('ID', 'NUMBER(10)', { id: 1, notNull: true, identity: 'BY DEFAULT' }),
          col('NOME', 'VARCHAR2(80 CHAR)', { id: 2, notNull: true, comment: 'Ragione sociale' }),
          col('STATO', 'CHAR(1)', { id: 3, default: "'A'" }),
        ],
        {
          comment: 'Anagrafica clienti',
          constraints: [
            cons('CLIENTI_PK', 'P', ['ID']),
            cons('CLIENTI_CK_STATO', 'C', ['STATO'], { condition: "STATO IN ('A','S')" }),
          ],
          indexes: [idx('CLIENTI_PK', ['ID'], { unique: true }), idx('CLIENTI_IX_NOME', ['NOME'])],
        }
      ),
      table(
        'ORDINI',
        [
          col('ID', 'NUMBER(10)', { id: 1, notNull: true }),
          col('CLIENTE_ID', 'NUMBER(10)', { id: 2, notNull: true }),
          col('TOTALE', 'NUMBER(12,2)', { id: 3 }),
        ],
        {
          constraints: [
            cons('ORDINI_PK', 'P', ['ID']),
            fk('ORDINI_FK_CLIENTI', ['CLIENTE_ID'], 'CLIENTI', ['ID'], { deleteRule: 'CASCADE' }),
          ],
          indexes: [
            idx('ORDINI_PK', ['ID'], { unique: true }),
            idx('ORDINI_IX_CLIENTE', ['CLIENTE_ID']),
          ],
        }
      ),
    ]),
    sequences: byName([seq('SEQ_ORDINI')]),
  });

// Percorso comodo verso una tabella del draft, per nome di partenza.
export const draftTable = (draft, baseName) =>
  Object.values(draft.tables).find((t) => t.base === baseName);

export const draftColumn = (draft, baseTable, baseColumn) =>
  draftTable(draft, baseTable).columns.find((c) => c.base === baseColumn);
