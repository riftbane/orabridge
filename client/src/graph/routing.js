// Percorso degli archi fra due colonne di due nodi.
//
// Instradamento ortogonale a tre segmenti con angoli arrotondati: esce di
// fianco al nodo, corre in verticale a metà strada, entra di fianco all'altro.
// Gli archi che escono dallo stesso lato dello stesso nodo si scostano l'uno
// dall'altro (corsie): è ciò che distingue un diagramma leggibile da una
// matassa.

import { HEAD_H, ROW_H, nodeSize, rowIndex } from './layout.js';

const LANE = 9; // scostamento fra due corsie vicine
const RADIUS = 8; // raggio degli angoli

/**
 * Punto d'attacco di una colonna sul bordo del nodo.
 * Una colonna che il nodo non sta mostrando (chiuso, o modalità sole chiavi)
 * si attacca all'intestazione invece che sparire.
 */
export function anchor(table, layout, view, columnUid, side) {
  const p = layout[table.uid];
  if (!p) return null;
  const { w } = nodeSize(table, view);
  const i = columnUid ? rowIndex(table, columnUid, view) : null;
  const y = i == null ? p.y + HEAD_H / 2 : p.y + HEAD_H + i * ROW_H + ROW_H / 2;
  return { x: side === 'right' ? p.x + w : p.x, y };
}

// Da che lato conviene uscire: quello che accorcia il percorso.
export function sidesFor(from, to, fromLayout, toLayout, fromView, toView) {
  const a = fromLayout[from.uid];
  const b = toLayout[to.uid];
  if (!a || !b) return ['right', 'left'];
  const aw = nodeSize(from, fromView).w;
  const bw = nodeSize(to, toView).w;
  // Il figlio esce a destra se il padre gli sta a destra, e viceversa.
  return a.x + aw / 2 <= b.x + bw / 2 ? ['right', 'left'] : ['left', 'right'];
}

const dir = (side) => (side === 'right' ? 1 : -1);

/**
 * Percorso SVG fra due punti d'attacco.
 * @param lane numero di corsia: scosta il tratto verticale per non
 *             sovrapporsi agli altri archi che escono dallo stesso lato
 */
export function edgePath(a, b, aSide, bSide, lane = 0) {
  if (!a || !b) return '';
  const out = 16 + lane * LANE; // quanto si esce prima di girare
  const ax = a.x + dir(aSide) * out;
  const bx = b.x + dir(bSide) * out;

  // Sullo stesso asse orizzontale non serve girare: una linea e via.
  if (Math.abs(a.y - b.y) < 1.5) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;

  const mx = (ax + bx) / 2;
  const r = Math.min(RADIUS, Math.abs(b.y - a.y) / 2, Math.max(1, Math.abs(mx - a.x)));
  const down = b.y > a.y ? 1 : -1;
  const toMid = mx > a.x ? 1 : -1;
  const fromMid = b.x > mx ? 1 : -1;

  return [
    `M ${a.x} ${a.y}`,
    `L ${mx - toMid * r} ${a.y}`,
    `Q ${mx} ${a.y} ${mx} ${a.y + down * r}`,
    `L ${mx} ${b.y - down * r}`,
    `Q ${mx} ${b.y} ${mx + fromMid * r} ${b.y}`,
    `L ${b.x} ${b.y}`,
  ].join(' ');
}

// Auto-riferimento: cappio fuori dal fianco destro del nodo.
export function selfLoopPath(a, b) {
  const x = Math.max(a.x, b.x) + 26;
  return [
    `M ${a.x} ${a.y}`,
    `L ${x - RADIUS} ${a.y}`,
    `Q ${x} ${a.y} ${x} ${a.y + (b.y > a.y ? RADIUS : -RADIUS)}`,
    `L ${x} ${b.y + (b.y > a.y ? -RADIUS : RADIUS)}`,
    `Q ${x} ${b.y} ${x - RADIUS} ${b.y}`,
    `L ${b.x} ${b.y}`,
  ].join(' ');
}

/**
 * Geometria di tutti gli archi, corsie comprese.
 *
 * @param edges  da `foreignKeys(draft)`
 * @param layout posizioni dei nodi
 * @param view   { [uid]: { collapsed, keysOnly, w } }
 */
export function routeEdges(edges, layout, view = {}) {
  const viewOf = (uid) => view[uid] || {};
  const prepared = [];

  for (const e of edges) {
    const self = e.fromTable.uid === e.toTable.uid;
    const [aSide, bSide] = self
      ? ['right', 'right']
      : sidesFor(e.fromTable, e.toTable, layout, layout, viewOf(e.fromTable.uid), viewOf(e.toTable.uid));
    const a = anchor(e.fromTable, layout, viewOf(e.fromTable.uid), e.fromColumnUids[0], aSide);
    const b = anchor(e.toTable, layout, viewOf(e.toTable.uid), e.toColumnUids[0], bSide);
    if (!a || !b) continue;
    prepared.push({ ...e, self, a, b, aSide, bSide });
  }

  // Le corsie si assegnano per lato di uscita: gli archi che partono dallo
  // stesso fianco si ordinano per altezza d'arrivo, così non si incrociano
  // fra loro prima ancora di essere partiti.
  const lanes = new Map();
  const bucket = new Map();
  for (const e of prepared) {
    if (e.self) continue;
    const k = `${e.fromTable.uid}:${e.aSide}`;
    if (!bucket.has(k)) bucket.set(k, []);
    bucket.get(k).push(e);
  }
  for (const list of bucket.values()) {
    list.sort((x, y) => x.b.y - y.b.y);
    list.forEach((e, i) => lanes.set(e, list.length > 1 ? i : 0));
  }

  return prepared.map((e) => ({
    ...e,
    d: e.self ? selfLoopPath(e.a, e.b) : edgePath(e.a, e.b, e.aSide, e.bSide, lanes.get(e) || 0),
  }));
}
