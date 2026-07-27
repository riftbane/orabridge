// Confronto fra due snapshot di schema (vedi snapshot.js).
//
// Funzioni pure, senza dipendenze dal database: prendono due snapshot e
// restituiscono la lista degli oggetti con lo stato del confronto. Il verso è
// sempre "origine → destinazione": `only-source` significa che l'oggetto va
// creato nella destinazione, `only-target` che lì è di troppo.

import { DIFF_TYPES } from './snapshot.js';

// Chiave opaca di un oggetto nel risultato: non viene mai ri-spezzata (tipo e
// nome viaggiano separati quando servono), serve solo a identificare la voce.
export const objKey = (type, name) => `${type}\u0000${name}`;

const ORDER = new Map(DIFF_TYPES.map((t, i) => [t, i]));

const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Riferimenti allo schema di origine e a quello di destinazione diventano lo
// stesso segnaposto: confrontando DEV.APP con PROD.APP2, `APP.T` e `APP2.T`
// sono la stessa cosa (equivale al REMAP_SCHEMA di DBMS_METADATA).
function remapOwners(s, srcOwner, tgtOwner) {
  if (!srcOwner || !tgtOwner || srcOwner === tgtOwner) return s;
  for (const owner of [srcOwner, tgtOwner]) {
    const rx = new RegExp(`(^|[^A-Za-z0-9_$#."])"?${escapeRx(owner)}"?\\s*\\.`, 'gi');
    s = s.replace(rx, '$1__SCHEMA__.');
  }
  return s;
}

export function normalizeText(text, opts = {}) {
  let s = String(text ?? '').replace(/\r\n?/g, '\n');
  if (opts.remapSchema) s = remapOwners(s, opts.srcOwner, opts.tgtOwner);
  if (opts.ignoreWhitespace) {
    s = s
      .split('\n')
      .map((l) => l.replace(/[ \t]+/g, ' ').trim())
      .filter((l) => l !== '')
      .join('\n');
  } else {
    s = s.replace(/[ \t]+$/gm, '');
  }
  if (opts.ignoreCase) s = s.toUpperCase();
  return s.trim();
}

const sameText = (a, b, opts) => normalizeText(a, opts) === normalizeText(b, opts);

// ---- descrizioni leggibili, usate sia nella UI sia per decidere l'uguaglianza ----

export function describeColumn(c) {
  let s = c.type;
  if (c.default != null) s += ` DEFAULT ${c.default}`;
  if (c.notNull) s += ' NOT NULL';
  return s;
}

export function describeConstraint(c) {
  const cols = c.columns.join(', ');
  let s;
  if (c.type === 'P') s = `PRIMARY KEY (${cols})`;
  else if (c.type === 'U') s = `UNIQUE (${cols})`;
  else if (c.type === 'R') {
    s = `FOREIGN KEY (${cols}) REFERENCES ${c.refOwner}.${c.refTable}`;
    if (c.refColumns.length) s += ` (${c.refColumns.join(', ')})`;
    if (c.deleteRule) s += ` ON DELETE ${c.deleteRule}`;
  } else s = `CHECK (${c.condition ?? ''})`;
  if (c.disabled) s += ' [DISABILITATO]';
  return s;
}

export function describeIndex(i) {
  let s = `${i.unique ? 'UNIQUE ' : ''}(${i.columns.join(', ')})`;
  if (i.type && i.type !== 'NORMAL') s += ` [${i.type}]`;
  if (i.unusable) s += ' [UNUSABLE]';
  return s;
}

const describeSequence = (s) =>
  `INCREMENT BY ${s.increment} START/MIN ${s.min} MAXVALUE ${s.max} CACHE ${s.cache}` +
  `${s.cycle ? ' CYCLE' : ' NOCYCLE'}${s.order ? ' ORDER' : ''}`;

const describeSynonym = (s) =>
  `${s.tableOwner}.${s.tableName}${s.dbLink ? '@' + s.dbLink : ''}`;

// Firma indipendente dal nome: serve ad accoppiare vincoli/indici che i due
// database hanno chiamato SYS_C… in modo diverso pur essendo identici.
const constraintSignature = (c, opts) =>
  [
    c.type,
    c.columns.join(','),
    normalizeText(c.condition ?? '', opts),
    c.refTable ?? '',
    c.refColumns.join(','),
  ].join('|');

const indexSignature = (i) => `${i.unique ? 'U' : 'N'}|${i.type}|${i.columns.join(',')}`;

// Accoppia due liste di elementi: prima per nome, poi — se la voce ha un nome
// generato dal sistema e l'opzione è attiva — per firma.
function pairItems(srcList, tgtList, signature, opts) {
  const pairs = [];
  const tgtByName = new Map(tgtList.map((x) => [x.name, x]));
  const usedSrc = new Set();
  const usedTgt = new Set();

  for (const s of srcList) {
    const t = tgtByName.get(s.name);
    if (t && !usedTgt.has(t)) {
      usedSrc.add(s);
      usedTgt.add(t);
      pairs.push([s, t]);
    }
  }
  const leftoverSrc = srcList.filter((s) => !usedSrc.has(s));
  const leftoverTgt = tgtList.filter((t) => !usedTgt.has(t));

  if (opts.ignoreGeneratedNames) {
    const bySig = new Map();
    for (const t of leftoverTgt) {
      if (!t.generated) continue;
      const sig = signature(t, opts);
      if (!bySig.has(sig)) bySig.set(sig, []);
      bySig.get(sig).push(t);
    }
    for (const s of leftoverSrc.slice()) {
      if (!s.generated) continue;
      const bucket = bySig.get(signature(s, opts));
      const t = bucket?.shift();
      if (!t) continue;
      pairs.push([s, t]);
      leftoverSrc.splice(leftoverSrc.indexOf(s), 1);
      leftoverTgt.splice(leftoverTgt.indexOf(t), 1);
    }
  }

  return { pairs, onlySource: leftoverSrc, onlyTarget: leftoverTgt };
}

const change = (kind, name, change, source, target) => ({ kind, name, change, source, target });

// Differenze di una tabella in forma strutturata: qui restano gli oggetti veri
// (colonne, vincoli, indici), non le loro descrizioni. Lo usano sia il
// riepilogo mostrato nella UI sia il generatore dello script (script.js), così
// l'accoppiamento fra le due tabelle è calcolato una volta sola.
export function tableDelta(s, t, opts) {
  const columns = pairItems(s.columns, t.columns, () => '', { ignoreGeneratedNames: false });
  columns.changed = columns.pairs.filter(([a, b]) => describeColumn(a) !== describeColumn(b));

  const constraints = opts.compareConstraints
    ? pairItems(s.constraints, t.constraints, constraintSignature, opts)
    : { pairs: [], onlySource: [], onlyTarget: [] };
  constraints.changed = constraints.pairs.filter(
    ([a, b]) =>
      (describeConstraint(a) !== describeConstraint(b) &&
        constraintSignature(a, opts) !== constraintSignature(b, opts)) ||
      a.disabled !== b.disabled
  );

  // Gli indici che Oracle crea da sé per PK/UNIQUE sono già coperti dal
  // vincolo corrispondente: confrontarli genererebbe differenze doppie.
  const idxOf = (tab) =>
    tab.indexes.filter(
      (i) => !tab.constraints.some((c) => (c.type === 'P' || c.type === 'U') && c.name === i.name)
    );
  const indexes = opts.compareIndexes
    ? pairItems(idxOf(s), idxOf(t), indexSignature, opts)
    : { pairs: [], onlySource: [], onlyTarget: [] };
  indexes.changed = indexes.pairs.filter(([a, b]) => describeIndex(a) !== describeIndex(b));

  const columnComments = opts.compareComments
    ? columns.pairs.filter(([a, b]) => (a.comment ?? '') !== (b.comment ?? ''))
    : [];
  const tableComment =
    opts.compareComments && (s.comment ?? '') !== (t.comment ?? '') ? [s.comment, t.comment] : null;

  return { columns, constraints, indexes, columnComments, tableComment };
}

function diffTable(s, t, opts) {
  const d = tableDelta(s, t, opts);
  const changes = [];

  for (const c of d.columns.onlySource)
    changes.push(change('Colonna', c.name, 'only-source', describeColumn(c), null));
  for (const c of d.columns.onlyTarget)
    changes.push(change('Colonna', c.name, 'only-target', null, describeColumn(c)));
  for (const [a, b] of d.columns.changed)
    changes.push(change('Colonna', a.name, 'different', describeColumn(a), describeColumn(b)));
  for (const [a, b] of d.columnComments)
    changes.push(change('Commento colonna', a.name, 'different', a.comment, b.comment));

  for (const c of d.constraints.onlySource)
    changes.push(change('Vincolo', c.name, 'only-source', describeConstraint(c), null));
  for (const c of d.constraints.onlyTarget)
    changes.push(change('Vincolo', c.name, 'only-target', null, describeConstraint(c)));
  for (const [a, b] of d.constraints.changed)
    changes.push(
      change('Vincolo', a.name, 'different', describeConstraint(a), describeConstraint(b))
    );

  for (const i of d.indexes.onlySource)
    changes.push(change('Indice', i.name, 'only-source', describeIndex(i), null));
  for (const i of d.indexes.onlyTarget)
    changes.push(change('Indice', i.name, 'only-target', null, describeIndex(i)));
  for (const [a, b] of d.indexes.changed)
    changes.push(change('Indice', a.name, 'different', describeIndex(a), describeIndex(b)));

  if (d.tableComment)
    changes.push(change('Commento tabella', s.name, 'different', d.tableComment[0], d.tableComment[1]));

  return changes;
}

// Opzioni di confronto complete a partire da quelle scelte nella UI.
export function diffOptions(src, tgt, options = {}) {
  return {
    ignoreGeneratedNames: true,
    ignoreWhitespace: true,
    ignoreCase: false,
    remapSchema: true,
    compareConstraints: true,
    compareIndexes: true,
    compareComments: true,
    ...options,
    srcOwner: src.owner,
    tgtOwner: tgt.owner,
  };
}

function diffProps(pairs) {
  const changes = [];
  for (const [label, a, b] of pairs) {
    const va = a == null ? null : String(a);
    const vb = b == null ? null : String(b);
    if (va !== vb) changes.push(change('Proprietà', label, 'different', va, vb));
  }
  return changes;
}

// Voce di riepilogo per gli oggetti confrontati sul testo: il diff riga per
// riga lo calcola il client, qui basta sapere che c'è.
const textChange = (a, b) =>
  change(
    'Sorgente',
    'testo',
    'different',
    `${String(a ?? '').split('\n').length} righe`,
    `${String(b ?? '').split('\n').length} righe`
  );

export function compareSnapshots(src, tgt, options = {}) {
  const opts = diffOptions(src, tgt, options);
  const types = new Set(options.types || DIFF_TYPES);
  const items = [];

  const add = (type, name, status, changes = [], extra = {}) =>
    items.push({ key: objKey(type, name), type, name, status, changes, ...extra });

  // Confronto generico per una famiglia di oggetti indicizzata per nome.
  const walk = (type, srcMap, tgtMap, diff) => {
    if (!types.has(type)) return;
    const names = new Set([...Object.keys(srcMap), ...Object.keys(tgtMap)]);
    for (const name of [...names].sort()) {
      const s = srcMap[name];
      const t = tgtMap[name];
      if (s && !t) add(type, name, 'only-source');
      else if (!s && t) add(type, name, 'only-target');
      else {
        const { changes = [], ...extra } = diff(s, t) || {};
        add(type, name, changes.length ? 'different' : 'same', changes, extra);
      }
    }
  };

  walk('TABLE', src.tables, tgt.tables, (s, t) => ({ changes: diffTable(s, t, opts) }));

  walk('VIEW', src.views, tgt.views, (s, t) =>
    sameText(s.text, t.text, opts)
      ? {}
      : { changes: [textChange(s.text, t.text)], text: true }
  );

  walk('MATERIALIZED VIEW', src.mviews, tgt.mviews, (s, t) => {
    const changes = diffProps([
      ['Modalità refresh', s.refreshMode, t.refreshMode],
      ['Metodo refresh', s.refreshMethod, t.refreshMethod],
    ]);
    const sameQuery = sameText(s.query, t.query, opts);
    if (!sameQuery) changes.unshift(textChange(s.query, t.query));
    return { changes, text: !sameQuery };
  });

  walk('SEQUENCE', src.sequences, tgt.sequences, (s, t) => ({
    changes: diffProps([
      ['Incremento', s.increment, t.increment],
      ['Valore minimo', s.min, t.min],
      ['Valore massimo', s.max, t.max],
      ['Cache', s.cache, t.cache],
      ['Ciclo', s.cycle, t.cycle],
      ['Ordine', s.order, t.order],
    ]),
  }));

  walk('SYNONYM', src.synonyms, tgt.synonyms, (s, t) => {
    const da = describeSynonym(s);
    const db = describeSynonym(t);
    const equal =
      da === db ||
      (opts.remapSchema && normalizeText(da + '.', opts) === normalizeText(db + '.', opts));
    return { changes: equal ? [] : [change('Riferimento', s.name, 'different', da, db)] };
  });

  walk('TRIGGER', src.triggers, tgt.triggers, (s, t) => {
    const changes = diffProps([['Stato', s.disabled ? 'DISABILITATO' : 'ABILITATO', t.disabled ? 'DISABILITATO' : 'ABILITATO']]);
    const same = sameText(s.text, t.text, opts);
    if (!same) changes.unshift(textChange(s.text, t.text));
    return { changes, text: !same };
  });

  // Oggetti con sorgente PL/SQL: le chiavi degli snapshot sono già "TIPO\0NOME".
  const srcKeys = new Set(Object.keys(src.sources));
  const tgtKeys = new Set(Object.keys(tgt.sources));
  for (const key of [...new Set([...srcKeys, ...tgtKeys])].sort()) {
    const s = src.sources[key];
    const t = tgt.sources[key];
    const type = (s || t).type;
    const name = (s || t).name;
    if (!types.has(type)) continue;
    if (s && !t) add(type, name, 'only-source');
    else if (!s && t) add(type, name, 'only-target');
    else if (sameText(s.text, t.text, opts)) add(type, name, 'same');
    else add(type, name, 'different', [textChange(s.text, t.text)], { text: true });
  }

  items.sort(
    (a, b) =>
      (ORDER.get(a.type) ?? 99) - (ORDER.get(b.type) ?? 99) || (a.name < b.name ? -1 : 1)
  );

  const counts = { onlySource: 0, onlyTarget: 0, different: 0, same: 0 };
  const byStatus = {
    'only-source': 'onlySource',
    'only-target': 'onlyTarget',
    different: 'different',
    same: 'same',
  };
  for (const it of items) counts[byStatus[it.status]]++;

  return { items, counts };
}
