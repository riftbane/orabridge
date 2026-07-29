// Script DDL che allinea la destinazione all'origine.
//
// Tutto viene generato dagli snapshot (nessuna chiamata a DBMS_METADATA): così
// lo script si può produrre anche senza il privilegio SELECT_CATALOG_ROLE, i
// riferimenti allo schema vengono rimappati sulla destinazione, e la funzione
// resta pura — quindi testabile.
//
// Lo script non viene mai eseguito da Orabridge: si apre in un foglio SQL, si
// rilegge e si lancia a mano.

import { tableDelta, diffOptions, describeColumn, isIdentityDefault } from './compare.js';
import { sourceKey } from './snapshot.js';

// Gli identificatori arrivano dal dizionario, quindi già nella forma esatta in
// cui Oracle li ha memorizzati: si citano sempre, così anche i nomi che sono
// parole riservate o in minuscolo restano validi.
const ident = (n) => '"' + String(n ?? '').replace(/"/g, '""') + '"';
const qual = (owner, name) => `${ident(owner)}.${ident(name)}`;
const lit = (s) => "'" + String(s ?? '').replace(/'/g, "''") + "'";

const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// "ORIGINE.TABELLA" → "DESTINAZIONE".TABELLA dentro un testo DDL.
function remapDdl(text, from, to) {
  if (!from || !to || from === to) return text;
  const rx = new RegExp(`(^|[^A-Za-z0-9_$#."])"?${escapeRx(from)}"?\\s*\\.`, 'gi');
  return String(text).replace(rx, `$1${ident(to)}.`);
}

// Il DEFAULT di una colonna può citare una sequenza dello schema di origine
// (`"DEV"."SEQ_ID"."NEXTVAL"`): va rimappato come tutto il resto, altrimenti
// la tabella creata nella destinazione continua a pescare dall'origine.
function columnDdl(c, srcOwner, tgtOwner) {
  const def = c.default == null ? null : remapDdl(c.default, srcOwner, tgtOwner);
  // Se il dizionario non ha detto quali colonne sono di identità, il default
  // che punta a una ISEQ$$ lo tradisce: ricopiarlo creerebbe una tabella
  // agganciata a una sequenza che nella destinazione non esiste.
  const identity = c.identity || (isIdentityDefault(c.default) ? 'BY DEFAULT' : null);
  // Per identità e colonne virtuali il valore non è un DEFAULT: la sequenza
  // di sistema e l'espressione di calcolo hanno una sintassi tutta loro.
  // Il tipo di una colonna virtuale lo deduce Oracle dall'espressione:
  // dichiararlo può solo entrare in conflitto.
  if (c.virtual && def != null)
    return `${ident(c.name)} AS (${def}) VIRTUAL${c.notNull ? ' NOT NULL' : ''}`;
  let s = `${ident(c.name)} ${c.type}`;
  // Una colonna di identità è già obbligatoria: ripetere NOT NULL è superfluo.
  if (identity) return `${s} GENERATED ${identity} AS IDENTITY`;
  if (def != null) s += ` DEFAULT ${def}`;
  if (c.notNull) s += ' NOT NULL';
  return s;
}

// Clausola di vincolo. I vincoli con nome generato dal sistema si creano senza
// nome: ricopiare un SYS_C0012345 nella destinazione non ha senso.
function constraintClause(c, srcOwner, tgtOwner) {
  const prefix = c.generated ? '' : `CONSTRAINT ${ident(c.name)} `;
  const cols = c.columns.map(ident).join(', ');
  let body;
  if (c.type === 'P') body = `PRIMARY KEY (${cols})`;
  else if (c.type === 'U') body = `UNIQUE (${cols})`;
  else if (c.type === 'R') {
    const owner = c.refOwner === srcOwner ? tgtOwner : c.refOwner;
    body = `FOREIGN KEY (${cols}) REFERENCES ${qual(owner, c.refTable)}`;
    if (c.refColumns.length) body += ` (${c.refColumns.map(ident).join(', ')})`;
    if (c.deleteRule) body += ` ON DELETE ${c.deleteRule}`;
  } else body = `CHECK (${remapDdl(c.condition ?? '', srcOwner, tgtOwner)})`;
  return prefix + body + (c.disabled ? ' DISABLE' : '');
}

// Le colonne di un indice possono essere espressioni (indice funzionale):
// quelle vanno lasciate come sono — a parte lo schema, che va rimappato —
// mentre i nomi semplici vanno citati.
function indexColumnDdl(col, srcOwner, tgtOwner) {
  const m = /^(.*?)( DESC)?$/.exec(col);
  const expr = m[1];
  const plain = /^[A-Za-z][A-Za-z0-9_$#]*$/.test(expr);
  return (plain ? ident(expr) : remapDdl(expr, srcOwner, tgtOwner)) + (m[2] || '');
}

const createIndexDdl = (i, table, owner, srcOwner) =>
  `CREATE ${i.unique ? 'UNIQUE ' : ''}${i.type === 'BITMAP' ? 'BITMAP ' : ''}INDEX ` +
  `${qual(owner, i.name)} ON ${qual(owner, table)} ` +
  `(${i.columns.map((c) => indexColumnDdl(c, srcOwner, owner)).join(', ')})`;

function createTableDdl(t, owner, srcOwner) {
  const lines = t.columns.map((c) => columnDdl(c, srcOwner, owner));
  for (const c of t.constraints) {
    if (c.type === 'R') continue; // le FK arrivano dopo, a tabelle create
    lines.push(constraintClause(c, srcOwner, owner));
  }
  let sql = `CREATE ${t.temporary ? 'GLOBAL TEMPORARY ' : ''}TABLE ${qual(owner, t.name)} (\n  `;
  sql += lines.join(',\n  ') + '\n)';
  if (t.temporary && t.onCommit) sql += `\nON COMMIT ${t.onCommit} ROWS`;
  return sql;
}

function createSequenceDdl(s, owner) {
  const parts = [`CREATE SEQUENCE ${qual(owner, s.name)}`];
  if (s.lastNumber) parts.push(`  START WITH ${s.lastNumber}`);
  parts.push(`  MINVALUE ${s.min}`);
  parts.push(`  MAXVALUE ${s.max}`);
  parts.push(`  INCREMENT BY ${s.increment}`);
  parts.push(`  ${Number(s.cache) > 1 ? `CACHE ${s.cache}` : 'NOCACHE'}`);
  parts.push(`  ${s.cycle ? 'CYCLE' : 'NOCYCLE'} ${s.order ? 'ORDER' : 'NOORDER'}`);
  return parts.join('\n');
}

// Solo le proprietà che cambiano davvero: un ALTER SEQUENCE completo può
// fallire (es. MINVALUE oltre il valore corrente).
function alterSequenceDdl(s, t, owner) {
  const parts = [];
  if (s.increment !== t.increment) parts.push(`INCREMENT BY ${s.increment}`);
  if (s.min !== t.min) parts.push(`MINVALUE ${s.min}`);
  if (s.max !== t.max) parts.push(`MAXVALUE ${s.max}`);
  if (s.cache !== t.cache) parts.push(Number(s.cache) > 1 ? `CACHE ${s.cache}` : 'NOCACHE');
  if (s.cycle !== t.cycle) parts.push(s.cycle ? 'CYCLE' : 'NOCYCLE');
  if (s.order !== t.order) parts.push(s.order ? 'ORDER' : 'NOORDER');
  return parts.length ? `ALTER SEQUENCE ${qual(owner, s.name)}\n  ${parts.join('\n  ')}` : null;
}

// MODIFY minimale: elencare attributi già uguali fa fallire l'istruzione
// (ORA-01442 se la colonna è già NOT NULL).
function modifyColumnDdl(a, b, srcOwner, tgtOwner) {
  const def = a.default == null ? null : remapDdl(a.default, srcOwner, tgtOwner);
  let s = ident(a.name);
  if (a.type !== b.type) s += ` ${a.type}`;
  // Il confronto è sul default già rimappato: uno che cita lo schema di
  // origine e uno che cita quello di destinazione sono lo stesso default.
  if (def !== (b.default ?? null)) s += ` DEFAULT ${def ?? 'NULL'}`;
  if (a.notNull !== b.notNull) s += a.notNull ? ' NOT NULL' : ' NULL';
  return s;
}

const DROP_KEYWORD = {
  TABLE: 'TABLE',
  VIEW: 'VIEW',
  'MATERIALIZED VIEW': 'MATERIALIZED VIEW',
  SEQUENCE: 'SEQUENCE',
  SYNONYM: 'SYNONYM',
  PROCEDURE: 'PROCEDURE',
  FUNCTION: 'FUNCTION',
  PACKAGE: 'PACKAGE',
  'PACKAGE BODY': 'PACKAGE BODY',
  TRIGGER: 'TRIGGER',
  TYPE: 'TYPE',
};

const PLSQL_TYPES = new Set([
  'PROCEDURE',
  'FUNCTION',
  'PACKAGE',
  'PACKAGE BODY',
  'TYPE',
  'TRIGGER',
]);

const pad2 = (n) => String(n).padStart(2, '0');
const stamp = (d) =>
  `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ` +
  `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

/**
 * @param src   snapshot dell'origine
 * @param tgt   snapshot della destinazione
 * @param items voci di confronto selezionate (da compareSnapshots)
 * @param options { includeDrops, sourceLabel, targetLabel, ...opzioni di confronto }
 */
export function buildSyncScript(src, tgt, items, options = {}) {
  const opts = diffOptions(src, tgt, options);
  const includeDrops = !!options.includeDrops;
  const srcOwner = src.owner;
  const owner = tgt.owner; // tutto ciò che si crea va nello schema di destinazione

  const sections = new Map();
  // Le sezioni si riempiono fuori ordine (una tabella produce insieme
  // colonne, vincoli e commenti) ma vanno emesse in ordine di dipendenza.
  const ORDER = [
    'SEQUENZE',
    'TABELLE',
    'VINCOLI E INDICI',
    'COMMENTI',
    'VISTE',
    'VISTE MATERIALIZZATE',
    'TIPI E PACKAGE',
    'PROCEDURE E FUNZIONI',
    'TRIGGER',
    'SINONIMI',
    'OGGETTI DA ELIMINARE',
  ];
  const put = (section, sql, plsql = false) => {
    if (!sql) return;
    if (!sections.has(section)) sections.set(section, []);
    sections.get(section).push({ sql, plsql });
  };
  const note = (section, text) => {
    if (!sections.has(section)) sections.set(section, []);
    sections.get(section).push({ note: text });
  };

  let created = 0;
  let dropped = 0;
  let skippedDrops = 0;

  for (const it of items) {
    const { type, name, status } = it;

    if (status === 'only-target') {
      if (!includeDrops) {
        skippedDrops++;
        continue;
      }
      const kw = DROP_KEYWORD[type];
      if (!kw) continue;
      dropped++;
      put(
        'OGGETTI DA ELIMINARE',
        `DROP ${kw} ${qual(owner, name)}${type === 'TABLE' ? ' CASCADE CONSTRAINTS' : ''}`
      );
      continue;
    }

    if (type === 'SEQUENCE') {
      const s = src.sequences[name];
      if (!s) continue;
      if (status === 'only-source') {
        created++;
        put('SEQUENZE', createSequenceDdl(s, owner));
      } else {
        put('SEQUENZE', alterSequenceDdl(s, tgt.sequences[name], owner));
      }
      continue;
    }

    if (type === 'TABLE') {
      const s = src.tables[name];
      if (!s) continue;
      if (status === 'only-source') {
        created++;
        put('TABELLE', createTableDdl(s, owner, srcOwner));
        for (const c of s.constraints)
          if (c.type === 'R')
            put(
              'VINCOLI E INDICI',
              `ALTER TABLE ${qual(owner, name)}\n  ADD ${constraintClause(c, srcOwner, owner)}`
            );
        for (const i of s.indexes) {
          const backing = s.constraints.some(
            (c) => (c.type === 'P' || c.type === 'U') && c.name === i.name
          );
          if (!backing) put('VINCOLI E INDICI', createIndexDdl(i, name, owner, srcOwner));
        }
        if (s.comment) put('COMMENTI', `COMMENT ON TABLE ${qual(owner, name)} IS ${lit(s.comment)}`);
        for (const c of s.columns)
          if (c.comment)
            put(
              'COMMENTI',
              `COMMENT ON COLUMN ${qual(owner, name)}.${ident(c.name)} IS ${lit(c.comment)}`
            );
        continue;
      }

      // tabella presente in entrambi ma diversa
      const t = tgt.tables[name];
      if (!t) continue;
      const d = tableDelta(s, t, opts);
      const table = qual(owner, name);

      if (d.columns.onlySource.length) {
        // Una colonna obbligatoria senza valore di riempimento fa fallire
        // l'ADD se la tabella ha già delle righe: meglio dirlo prima.
        const senzaDefault = d.columns.onlySource.filter(
          (c) => c.notNull && c.default == null && !c.identity && !c.virtual
        );
        if (senzaDefault.length)
          note(
            'TABELLE',
            `${name}: colonne NOT NULL senza DEFAULT — l'ADD fallisce se la tabella contiene già righe ` +
              `(${senzaDefault.map((c) => c.name).join(', ')})`
          );
        put(
          'TABELLE',
          `ALTER TABLE ${table} ADD (\n  ` +
            d.columns.onlySource.map((c) => columnDdl(c, srcOwner, owner)).join(',\n  ') +
            `\n)`
        );
      }
      for (const [a, b] of d.columns.changed) {
        // Identità ed espressione di una colonna virtuale non si cambiano con
        // un MODIFY: la colonna va rifatta, decidendo cosa fare dei dati.
        if (a.identity || b.identity || a.virtual || b.virtual) {
          note(
            'TABELLE',
            `${name}.${a.name}: colonna di identità o virtuale diversa — va ricreata a mano ` +
              `(origine: ${describeColumn(a)} / destinazione: ${describeColumn(b)})`
          );
          continue;
        }
        put('TABELLE', `ALTER TABLE ${table} MODIFY (${modifyColumnDdl(a, b, srcOwner, owner)})`);
      }
      if (d.columns.onlyTarget.length) {
        if (includeDrops) {
          dropped += d.columns.onlyTarget.length;
          put('TABELLE', `ALTER TABLE ${table} DROP (${d.columns.onlyTarget.map((c) => ident(c.name)).join(', ')})`);
        } else {
          skippedDrops += d.columns.onlyTarget.length;
          note('TABELLE', `${name}: colonne solo nella destinazione non eliminate — ${d.columns.onlyTarget.map((c) => c.name).join(', ')}`);
        }
      }

      // Un vincolo o un indice cambiato va rifatto: prima si toglie quello
      // vecchio, altrimenti l'ADD fallisce (non dipende dall'opzione DROP,
      // fa parte dell'allineamento).
      for (const [, b] of d.constraints.changed)
        put('VINCOLI E INDICI', `ALTER TABLE ${table} DROP CONSTRAINT ${ident(b.name)}`);
      for (const [a] of d.constraints.changed)
        put('VINCOLI E INDICI', `ALTER TABLE ${table}\n  ADD ${constraintClause(a, srcOwner, owner)}`);
      for (const c of d.constraints.onlySource)
        put('VINCOLI E INDICI', `ALTER TABLE ${table}\n  ADD ${constraintClause(c, srcOwner, owner)}`);
      if (d.constraints.onlyTarget.length) {
        if (includeDrops) {
          dropped += d.constraints.onlyTarget.length;
          for (const c of d.constraints.onlyTarget)
            put('VINCOLI E INDICI', `ALTER TABLE ${table} DROP CONSTRAINT ${ident(c.name)}`);
        } else {
          skippedDrops += d.constraints.onlyTarget.length;
          note('VINCOLI E INDICI', `${name}: vincoli solo nella destinazione non eliminati — ${d.constraints.onlyTarget.map((c) => c.name).join(', ')}`);
        }
      }

      for (const [, b] of d.indexes.changed)
        put('VINCOLI E INDICI', `DROP INDEX ${qual(owner, b.name)}`);
      for (const [a] of d.indexes.changed)
        put('VINCOLI E INDICI', createIndexDdl(a, name, owner, srcOwner));
      for (const i of d.indexes.onlySource)
        put('VINCOLI E INDICI', createIndexDdl(i, name, owner, srcOwner));
      if (d.indexes.onlyTarget.length) {
        if (includeDrops) {
          dropped += d.indexes.onlyTarget.length;
          for (const i of d.indexes.onlyTarget) put('VINCOLI E INDICI', `DROP INDEX ${qual(owner, i.name)}`);
        } else {
          skippedDrops += d.indexes.onlyTarget.length;
          note('VINCOLI E INDICI', `${name}: indici solo nella destinazione non eliminati — ${d.indexes.onlyTarget.map((i) => i.name).join(', ')}`);
        }
      }

      if (d.tableComment)
        put('COMMENTI', `COMMENT ON TABLE ${table} IS ${lit(d.tableComment[0] ?? '')}`);
      for (const [a] of d.columnComments)
        put('COMMENTI', `COMMENT ON COLUMN ${table}.${ident(a.name)} IS ${lit(a.comment ?? '')}`);
      continue;
    }

    if (type === 'VIEW') {
      const v = src.views[name];
      if (!v) continue;
      if (status === 'only-source') created++;
      put(
        'VISTE',
        `CREATE OR REPLACE FORCE VIEW ${qual(owner, name)} AS\n` +
          remapDdl(String(v.text).trim().replace(/;\s*$/, ''), srcOwner, owner)
      );
      continue;
    }

    if (type === 'MATERIALIZED VIEW') {
      const m = src.mviews[name];
      if (!m) continue;
      // Una vista materializzata non si sostituisce: va rifatta.
      if (status !== 'only-source') {
        note('VISTE MATERIALIZZATE', `${name}: modificata — ricreata da zero (i dati vengono ricaricati)`);
        put('VISTE MATERIALIZZATE', `DROP MATERIALIZED VIEW ${qual(owner, name)}`);
      } else created++;
      let refresh = '';
      if (m.refreshMethod === 'NEVER') refresh = '  NEVER REFRESH\n';
      else if (m.refreshMethod && m.refreshMode && m.refreshMode !== 'NEVER')
        refresh = `  REFRESH ${m.refreshMethod} ON ${m.refreshMode}\n`;
      put(
        'VISTE MATERIALIZZATE',
        `CREATE MATERIALIZED VIEW ${qual(owner, name)}\n${refresh}AS\n` +
          remapDdl(String(m.query).trim().replace(/;\s*$/, ''), srcOwner, owner)
      );
      continue;
    }

    if (type === 'TRIGGER') {
      const g = src.triggers[name];
      if (!g?.text?.trim()) continue;
      if (status === 'only-source') created++;
      put('TRIGGER', remapDdl(g.text.trim().replace(/[\s/]*$/, ''), srcOwner, owner), true);
      if (g.disabled) put('TRIGGER', `ALTER TRIGGER ${qual(owner, name)} DISABLE`);
      continue;
    }

    if (type === 'SYNONYM') {
      const s = src.synonyms[name];
      if (!s) continue;
      if (status === 'only-source') created++;
      const refOwner = s.tableOwner === srcOwner ? owner : s.tableOwner;
      put(
        'SINONIMI',
        `CREATE OR REPLACE SYNONYM ${qual(owner, name)} FOR ` +
          `${qual(refOwner, s.tableName)}${s.dbLink ? '@' + s.dbLink : ''}`
      );
      continue;
    }

    // oggetti con sorgente PL/SQL
    const source = src.sources[sourceKey(type, name)];
    if (!source) continue;
    if (!source.text?.trim()) {
      note(
        type === 'PROCEDURE' || type === 'FUNCTION' ? 'PROCEDURE E FUNZIONI' : 'TIPI E PACKAGE',
        `${type} ${name}: sorgente non leggibile nell'origine (oggetto wrapped o privilegi insufficienti)`
      );
      continue;
    }
    if (status === 'only-source') created++;
    const section =
      type === 'PROCEDURE' || type === 'FUNCTION' ? 'PROCEDURE E FUNZIONI' : 'TIPI E PACKAGE';
    put(
      section,
      'CREATE OR REPLACE ' +
        remapDdl(source.text.trim().replace(/[\s/]*$/, ''), srcOwner, owner),
      PLSQL_TYPES.has(type)
    );
  }

  // ---- resa finale ----
  const line = '-'.repeat(72);
  const head = [
    `-- Script di sincronizzazione generato da Orabridge`,
    `-- Origine ........ ${options.sourceLabel || ''} [${srcOwner}]`,
    `-- Destinazione ... ${options.targetLabel || ''} [${owner}]`,
    `-- Generato ....... ${stamp(new Date())}`,
    `--`,
    `-- Porta la DESTINAZIONE allo stato dell'origine. Da rileggere prima di`,
    `-- eseguirlo: nessuna istruzione viene lanciata in automatico.`,
  ];
  if (skippedDrops)
    head.push(
      `-- ${skippedDrops} elementi presenti solo nella destinazione NON vengono eliminati`,
      `-- (attiva "includi le eliminazioni" per generarli).`
    );

  const out = [head.join('\n')];
  for (const section of ORDER) {
    const list = sections.get(section);
    if (!list?.length) continue;
    out.push(`${line}\n-- ${section}\n${line}`);
    for (const b of list) {
      if (b.note) out.push(`-- ${b.note}`);
      else out.push(b.plsql ? `${b.sql.trimEnd()}\n/` : `${b.sql.trimEnd()};`);
    }
  }

  const statements = [...sections.values()].reduce(
    (n, list) => n + list.filter((b) => !b.note).length,
    0
  );
  return {
    sql: out.join('\n\n') + '\n',
    stats: { statements, created, dropped, skippedDrops },
  };
}
