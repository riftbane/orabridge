import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addColumn,
  addForeignKey,
  addTable,
  deleteTable,
  emptyColumn,
  emptyTable,
  foreignKeys,
  liveColumns,
  patchColumn,
  patchTable,
  pkColumnUids,
  proposeFkName,
  removeColumn,
} from '../src/graph/mutations.js';
import { autoLayout, boundsOf, nodeSize, rowIndex, visibleRows, HEAD_H, ROW_H } from '../src/graph/layout.js';
import { anchor, edgePath, routeEdges } from '../src/graph/routing.js';
import { nameLimit, validateDraft } from '../src/graph/validate.js';
import { changeSummary, countChanges, revertTable } from '../src/graph/changes.js';

/* ---- costruzione di un diagramma di prova ---- */

function build() {
  let draft = { owner: 'APP', tables: {}, sequences: {}, rest: {} };
  const clienti = emptyTable('CLIENTI');
  const ordini = emptyTable('ORDINI');
  draft = addTable(addTable(draft, clienti), ordini);
  draft = addColumn(draft, ordini.uid, emptyColumn('CLIENTE_ID', 'NUMBER(10)'));
  const clienteId = draft.tables[ordini.uid].columns.at(-1);
  draft = addForeignKey(draft, {
    fromTableUid: ordini.uid,
    fromColumnUids: [clienteId.uid],
    toTableUid: clienti.uid,
    toColumnUids: pkColumnUids(clienti),
  });
  return { draft, clientiUid: clienti.uid, ordiniUid: ordini.uid, clienteId };
}

// Un diagramma appena letto dal database: ogni oggetto ha il suo `base`.
const asExisting = (draft) => ({
  ...draft,
  tables: Object.fromEntries(
    Object.entries(draft.tables).map(([uid, t]) => [
      uid,
      {
        ...t,
        base: t.name,
        columns: t.columns.map((c) => ({ ...c, base: c.name })),
        constraints: t.constraints.map((c) => ({ ...c, base: c.name })),
        indexes: t.indexes.map((i) => ({ ...i, base: i.name })),
      },
    ])
  ),
});

/* ---------------------------------------------------------- mutazioni -- */

test('modificare una tabella non tocca le altre', () => {
  const { draft, clientiUid, ordiniUid } = build();
  const next = patchTable(draft, clientiUid, { comment: 'anagrafica' });
  assert.notEqual(next.tables[clientiUid], draft.tables[clientiUid]);
  // la condivisione strutturale è ciò che rende economico lo stack di undo
  assert.equal(next.tables[ordiniUid], draft.tables[ordiniUid]);
});

test('una colonna mai esistita si toglie, una già nel database si marca', () => {
  const { draft, ordiniUid, clienteId } = build();
  const nuova = removeColumn(draft, ordiniUid, clienteId.uid);
  assert.equal(nuova.tables[ordiniUid].columns.some((c) => c.uid === clienteId.uid), false);

  const esistente = asExisting(draft);
  const marcata = removeColumn(esistente, ordiniUid, clienteId.uid);
  const column = marcata.tables[ordiniUid].columns.find((c) => c.uid === clienteId.uid);
  assert.equal(column.deleted, true);
  assert.equal(liveColumns(marcata.tables[ordiniUid]).length, 1);
});

test('la FK disegnata collega le colonne giuste e prende un nome parlante', () => {
  const { draft, ordiniUid, clientiUid, clienteId } = build();
  const [edge] = foreignKeys(draft);
  assert.equal(edge.fromTable.uid, ordiniUid);
  assert.equal(edge.toTable.uid, clientiUid);
  assert.deepEqual(edge.fromColumnUids, [clienteId.uid]);
  assert.equal(edge.constraint.name, 'ORDINI_FK_CLIENTI');
});

test('un nome di vincolo già preso prende un suffisso', () => {
  const { draft } = build();
  assert.equal(proposeFkName(draft, 'ORDINI', 'CLIENTI'), 'ORDINI_FK_CLIENTI_2');
});

test('eliminando la tabella padre sparisce anche il suo arco', () => {
  const { draft, clientiUid } = build();
  assert.equal(foreignKeys(deleteTable(asExisting(draft), clientiUid)).length, 0);
});

/* -------------------------------------------------------------- misure -- */

test("l'altezza del nodo segue il numero di colonne mostrate", () => {
  const { draft, ordiniUid } = build();
  const table = draft.tables[ordiniUid];
  assert.equal(nodeSize(table, {}).h, HEAD_H + 2 * ROW_H + 18);
  assert.equal(nodeSize(table, { collapsed: true }).h, HEAD_H + ROW_H + 18);
});

test('la modalità sole chiavi tiene le colonne chiave e conta le altre', () => {
  const { draft, ordiniUid } = build();
  let next = addColumn(draft, ordiniUid, emptyColumn('NOTE', 'VARCHAR2(10)'));
  const { rows, hidden } = visibleRows(next.tables[ordiniUid], { keysOnly: true });
  assert.deepEqual(rows.map((c) => c.name), ['ID', 'CLIENTE_ID']);
  assert.equal(hidden, 1);
});

/* ---------------------------------------------------------- disposizione -- */

test('la disposizione è deterministica', () => {
  const { draft } = build();
  assert.deepEqual(autoLayout(draft), autoLayout(draft));
});

test('il padre sta a sinistra del figlio', () => {
  const { draft, clientiUid, ordiniUid } = build();
  const pos = autoLayout(draft);
  assert.ok(pos[clientiUid].x < pos[ordiniUid].x);
});

test('due nodi dello stesso livello non si sovrappongono', () => {
  let { draft, clientiUid } = build();
  // tre figli dello stesso padre finiscono impilati nello stesso livello
  for (const name of ['FATTURE', 'CONTATTI', 'INDIRIZZI']) {
    const t = emptyTable(name);
    draft = addTable(draft, t);
    draft = addColumn(draft, t.uid, emptyColumn('CLIENTE_ID', 'NUMBER(10)'));
    draft = addForeignKey(draft, {
      fromTableUid: t.uid,
      fromColumnUids: [draft.tables[t.uid].columns.at(-1).uid],
      toTableUid: clientiUid,
      toColumnUids: pkColumnUids(draft.tables[clientiUid]),
    });
  }
  const pos = autoLayout(draft);
  const boxes = Object.entries(pos).map(([uid, p]) => ({
    ...p,
    ...nodeSize(draft.tables[uid], {}),
  }));
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const overlap =
        a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      assert.equal(overlap, false, 'due nodi si sovrappongono');
    }
});

test('le tabelle senza collegamenti finiscono a destra di quelle collegate', () => {
  let { draft, ordiniUid } = build();
  const isola = emptyTable('PARAMETRI');
  draft = addTable(draft, isola);
  const pos = autoLayout(draft);
  assert.ok(pos[isola.uid].x > pos[ordiniUid].x);
});

test('un ciclo di FK non manda in ricorsione infinita la disposizione', () => {
  let { draft, clientiUid, ordiniUid } = build();
  draft = addColumn(draft, clientiUid, emptyColumn('ORDINE_ID', 'NUMBER(10)'));
  draft = addForeignKey(draft, {
    fromTableUid: clientiUid,
    fromColumnUids: [draft.tables[clientiUid].columns.at(-1).uid],
    toTableUid: ordiniUid,
    toColumnUids: pkColumnUids(draft.tables[ordiniUid]),
  });
  const pos = autoLayout(draft);
  assert.equal(Object.keys(pos).length, 2);
});

test('il riquadro contiene tutti i nodi', () => {
  const { draft } = build();
  const pos = autoLayout(draft);
  const box = boundsOf(draft, pos, {});
  for (const [uid, p] of Object.entries(pos)) {
    const { w, h } = nodeSize(draft.tables[uid], {});
    assert.ok(p.x >= box.x && p.x + w <= box.x + box.w);
    assert.ok(p.y >= box.y && p.y + h <= box.y + box.h);
  }
});

/* --------------------------------------------------------------- archi -- */

test("l'ancora di una colonna cade a metà della sua riga", () => {
  const { draft, ordiniUid } = build();
  const table = draft.tables[ordiniUid];
  const layout = { [ordiniUid]: { x: 100, y: 50 } };
  const second = table.columns[1];
  const a = anchor(table, layout, {}, second.uid, 'right');
  assert.equal(a.y, 50 + HEAD_H + 1 * ROW_H + ROW_H / 2);
  assert.equal(a.x, 100 + nodeSize(table, {}).w);
});

test('una colonna nascosta si attacca allintestazione invece di sparire', () => {
  const { draft, ordiniUid } = build();
  const table = draft.tables[ordiniUid];
  const layout = { [ordiniUid]: { x: 0, y: 0 } };
  assert.equal(rowIndex(table, table.columns[1].uid, { collapsed: true }), null);
  assert.equal(anchor(table, layout, { collapsed: true }, table.columns[1].uid, 'left').y, HEAD_H / 2);
});

test('archi che escono dallo stesso lato prendono corsie diverse', () => {
  let { draft, clientiUid } = build();
  for (const name of ['FATTURE', 'CONTATTI']) {
    const t = emptyTable(name);
    draft = addTable(draft, t);
    draft = addColumn(draft, t.uid, emptyColumn('CLIENTE_ID', 'NUMBER(10)'));
    draft = addForeignKey(draft, {
      fromTableUid: t.uid,
      fromColumnUids: [draft.tables[t.uid].columns.at(-1).uid],
      toTableUid: clientiUid,
      toColumnUids: pkColumnUids(draft.tables[clientiUid]),
    });
  }
  const layout = autoLayout(draft);
  const routed = routeEdges(foreignKeys(draft), layout, {});
  assert.equal(routed.length, 3);
  for (const e of routed) assert.ok(e.d.startsWith('M '), 'ogni arco ha un percorso');
  // tre archi verso lo stesso padre, tutti distinti
  assert.equal(new Set(routed.map((e) => e.d)).size, 3);
});

test('un auto-riferimento diventa un cappio, non una linea degenere', () => {
  let { draft, ordiniUid } = build();
  draft = addColumn(draft, ordiniUid, emptyColumn('PADRE_ID', 'NUMBER(10)'));
  draft = addForeignKey(draft, {
    fromTableUid: ordiniUid,
    fromColumnUids: [draft.tables[ordiniUid].columns.at(-1).uid],
    toTableUid: ordiniUid,
    toColumnUids: pkColumnUids(draft.tables[ordiniUid]),
  });
  const routed = routeEdges(foreignKeys(draft), autoLayout(draft), {});
  const loop = routed.find((e) => e.self);
  assert.ok(loop, 'manca il cappio');
  assert.ok(loop.d.includes('Q'), 'il cappio deve essere arrotondato');
});

test('due punti sulla stessa altezza si collegano con una retta', () => {
  const d = edgePath({ x: 0, y: 10 }, { x: 100, y: 10 }, 'right', 'left');
  assert.equal(d, 'M 0 10 L 100 10');
});

/* ---------------------------------------------------------- validazione -- */

test('il limite dei nomi dipende dalla versione di Oracle', () => {
  assert.equal(nameLimit('11.2.0.4.0'), 30);
  assert.equal(nameLimit('12.1.0.2.0'), 30);
  assert.equal(nameLimit('12.2.0.1.0'), 128);
  assert.equal(nameLimit('19.0.0.0.0'), 128);
});

const texts = (issues) => issues.map((i) => i.text);

test('due tabelle con lo stesso nome sono un errore', () => {
  let { draft } = build();
  const doppia = emptyTable('CLIENTI');
  draft = addTable(draft, doppia);
  assert.ok(texts(validateDraft(draft)).some((t) => /Due tabelle si chiamano CLIENTI/.test(t)));
});

test('un nome troppo lungo per la versione in uso è un errore', () => {
  const { draft, ordiniUid } = build();
  const next = patchTable(draft, ordiniUid, { name: 'T'.repeat(40) });
  const issues = validateDraft(next, { oracleVersion: '11.2.0.4.0' });
  assert.ok(texts(issues).some((t) => /supera i 30 caratteri/.test(t)));
  assert.equal(
    texts(validateDraft(next, { oracleVersion: '19.0.0.0.0' })).some((t) => /supera i/.test(t)),
    false
  );
});

test('una FK fra tipi di famiglie diverse è un errore', () => {
  const { draft, ordiniUid, clienteId } = build();
  const next = patchColumn(draft, ordiniUid, clienteId.uid, { type: 'VARCHAR2(10)' });
  assert.ok(texts(validateDraft(next)).some((t) => /non sono dello stesso tipo/.test(t)));
});

test('una FK verso colonne non uniche è un errore', () => {
  let { draft, clientiUid, ordiniUid, clienteId } = build();
  draft = addColumn(draft, clientiUid, emptyColumn('CODICE', 'NUMBER(10)'));
  const codice = draft.tables[clientiUid].columns.at(-1);
  // si ripunta la FK su una colonna qualunque del padre
  draft = {
    ...draft,
    tables: {
      ...draft.tables,
      [ordiniUid]: {
        ...draft.tables[ordiniUid],
        constraints: draft.tables[ordiniUid].constraints.map((c) =>
          c.type === 'R' ? { ...c, refColumns: [{ columnUid: codice.uid }] } : c
        ),
      },
    },
  };
  assert.ok(texts(validateDraft(draft)).some((t) => /non sono chiave né UNIQUE/.test(t)));
});

test('una parola riservata come nome di colonna è solo un avviso', () => {
  const { draft, ordiniUid, clienteId } = build();
  const next = patchColumn(draft, ordiniUid, clienteId.uid, { name: 'LEVEL' });
  const issue = validateDraft(next).find((i) => /parola riservata/.test(i.text));
  assert.equal(issue.level, 'warn');
});

test('una tabella senza chiave primaria è un avviso, non un errore', () => {
  let { draft, ordiniUid } = build();
  const pk = draft.tables[ordiniUid].constraints.find((c) => c.type === 'P');
  draft = {
    ...draft,
    tables: {
      ...draft.tables,
      [ordiniUid]: {
        ...draft.tables[ordiniUid],
        constraints: draft.tables[ordiniUid].constraints.filter((c) => c.uid !== pk.uid),
      },
    },
  };
  const issue = validateDraft(draft).find((i) => /non ha chiave primaria/.test(i.text));
  assert.equal(issue.level, 'warn');
});

test('una FK senza indice sulle colonne figlie avvisa del rischio di blocchi', () => {
  const { draft } = build();
  assert.ok(texts(validateDraft(draft)).some((t) => /bloccheranno la tabella/.test(t)));
});

/* ------------------------------------------------------------ modifiche -- */

test('un diagramma non toccato non ha modifiche in sospeso', () => {
  const initial = asExisting(build().draft);
  assert.equal(countChanges(initial, initial), 0);
  assert.deepEqual(changeSummary(initial, initial), []);
});

test('il riepilogo distingue nuova, rinominata, modificata ed eliminata', () => {
  const { draft, clientiUid, ordiniUid, clienteId } = build();
  const initial = asExisting(draft);

  let next = patchTable(initial, clientiUid, { name: 'ANAGRAFICHE' });
  next = patchColumn(next, ordiniUid, clienteId.uid, { type: 'NUMBER(12)' });
  next = addTable(next, emptyTable('NOTE'));
  const nuovaUid = Object.values(next.tables).find((t) => t.name === 'NOTE').uid;

  const summary = changeSummary(next, initial);
  const by = Object.fromEntries(summary.map((s) => [s.name, s]));
  assert.equal(by.ANAGRAFICHE.kind, 'modified');
  assert.ok(by.ANAGRAFICHE.details.some((d) => /rinominata da CLIENTI/.test(d)));
  assert.equal(by.ORDINI.kind, 'modified');
  assert.ok(by.ORDINI.details.some((d) => /colonna CLIENTE_ID: tipo modificato/.test(d)));
  assert.equal(by.NOTE.kind, 'new');

  const eliminata = deleteTable(next, ordiniUid);
  assert.equal(changeSummary(eliminata, initial).find((s) => s.name === 'ORDINI').kind, 'deleted');
  assert.ok(nuovaUid);
});

test('annullare una voce riporta la tabella com era all apertura', () => {
  const { draft, ordiniUid, clienteId } = build();
  const initial = asExisting(draft);
  const next = patchColumn(patchTable(initial, ordiniUid, { name: 'X' }), ordiniUid, clienteId.uid, {
    type: 'DATE',
  });
  assert.equal(changeSummary(next, initial).length, 1);
  assert.deepEqual(revertTable(next, initial, ordiniUid).tables[ordiniUid], initial.tables[ordiniUid]);
});

test('annullare una tabella creata la fa sparire', () => {
  const initial = asExisting(build().draft);
  const nuova = emptyTable('NOTE');
  const next = addTable(initial, nuova);
  assert.equal(revertTable(next, initial, nuova.uid).tables[nuova.uid], undefined);
});
