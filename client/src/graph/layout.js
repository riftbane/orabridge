// Geometria e disposizione automatica del diagramma.
//
// Regola che tiene tutto insieme: le posizioni si calcolano dal modello, mai
// misurando il DOM. Altrimenti gli archi arriverebbero un fotogramma dopo i
// nodi durante il trascinamento, e non si potrebbe scartare quello che sta
// fuori dallo schermo senza prima averlo disegnato.

import { liveColumns, liveConstraints, liveIndexes, liveTables, fkColumnUids, pkColumnUids } from './mutations.js';

export const HEAD_H = 26;
export const ROW_H = 20;
export const FOOT_H = 18;
export const MIN_W = 180;
export const MAX_W = 360;

// Spaziatura fra i livelli e fra i nodi dello stesso livello.
const GAP_X = 110;
const GAP_Y = 34;

/* --------------------------------------------------------------- misure -- */

// Larghezza stimata dal testo: il carattere è monospaziato nella griglia delle
// colonne, quindi una stima a caratteri è abbastanza precisa.
export function nodeWidth(table) {
  let longest = table.name.length + 4;
  for (const c of liveColumns(table)) longest = Math.max(longest, c.name.length + c.type.length + 6);
  return Math.min(MAX_W, Math.max(MIN_W, Math.round(longest * 6.6) + 24));
}

/**
 * Le righe che il nodo mostra davvero, con quante ne restano fuori.
 * `keysOnly` tiene solo le colonne che sono chiave o partecipano a una FK:
 * è ciò che rende leggibile un diagramma di cinquanta tabelle.
 */
export function visibleRows(table, view = {}) {
  if (view.collapsed) return { rows: [], hidden: liveColumns(table).length };
  const columns = liveColumns(table);
  if (!view.keysOnly) return { rows: columns, hidden: 0 };
  const keys = new Set([...pkColumnUids(table), ...fkColumnUids(table)]);
  const rows = columns.filter((c) => keys.has(c.uid));
  return { rows, hidden: columns.length - rows.length };
}

export function nodeSize(table, view = {}) {
  const { rows, hidden } = visibleRows(table, view);
  const extra = hidden > 0 ? ROW_H : 0;
  const foot = liveConstraints(table).length || liveIndexes(table).length ? FOOT_H : 0;
  return {
    w: view.w || nodeWidth(table),
    h: HEAD_H + rows.length * ROW_H + extra + foot,
  };
}

// Indice della riga di una colonna fra quelle visibili, o null se il nodo la
// tiene nascosta (chiuso, oppure in modalità sole chiavi).
export function rowIndex(table, columnUid, view = {}) {
  const { rows } = visibleRows(table, view);
  const i = rows.findIndex((c) => c.uid === columnUid);
  return i === -1 ? null : i;
}

/* ---------------------------------------------------- disposizione auto -- */

// Livello di una tabella: quanto è lontana da un «padre puro», cioè da una
// tabella che non punta a nessun altro. I padri stanno a sinistra, i figli a
// destra: è il verso in cui si legge uno schema.
function depths(tables, parentsOf) {
  const depth = new Map();
  const visiting = new Set();
  const walk = (uid) => {
    if (depth.has(uid)) return depth.get(uid);
    // Un ciclo di FK non ha un livello: si ferma la ricorsione a 0 e ci pensa
    // l'ordinamento per baricentro a metterlo in un posto sensato.
    if (visiting.has(uid)) return 0;
    visiting.add(uid);
    let d = 0;
    for (const p of parentsOf.get(uid) || []) d = Math.max(d, walk(p) + 1);
    visiting.delete(uid);
    depth.set(uid, d);
    return d;
  };
  for (const t of tables) walk(t.uid);
  return depth;
}

/**
 * Posizioni per tutte le tabelle vive del diagramma.
 *
 * @param draft il diagramma
 * @param view  { [uid]: { collapsed, keysOnly, w } } — le misure dipendono da
 *              come i nodi sono mostrati
 * @param only  insieme facoltativo di uid da disporre (il resto resta fermo)
 * @returns { [uid]: { x, y } }
 */
export function autoLayout(draft, view = {}, only = null) {
  const all = liveTables(draft);
  const tables = only ? all.filter((t) => only.has(t.uid)) : all;
  if (!tables.length) return {};
  const inSet = new Set(tables.map((t) => t.uid));

  const parentsOf = new Map();
  const degree = new Map();
  for (const t of tables) {
    parentsOf.set(t.uid, new Set());
    degree.set(t.uid, 0);
  }
  for (const t of tables) {
    for (const c of liveConstraints(t)) {
      if (c.type !== 'R' || !c.refTableUid || c.refTableUid === t.uid) continue;
      if (!inSet.has(c.refTableUid)) continue;
      parentsOf.get(t.uid).add(c.refTableUid);
      degree.set(t.uid, degree.get(t.uid) + 1);
      degree.set(c.refTableUid, degree.get(c.refTableUid) + 1);
    }
  }

  // Le tabelle senza alcun collegamento vanno in una griglia a parte: dentro
  // la struttura sporcherebbero i livelli senza aggiungere informazione.
  const islands = tables.filter((t) => !degree.get(t.uid)).sort(byName);
  const linked = tables.filter((t) => degree.get(t.uid));

  const depth = depths(linked, parentsOf);
  const layers = [];
  for (const t of linked) {
    const d = depth.get(t.uid) ?? 0;
    (layers[d] ??= []).push(t);
  }
  for (const layer of layers) layer?.sort(byName);

  // Ordinamento per baricentro: ogni nodo si avvicina alla media delle
  // posizioni dei suoi vicini nel livello precedente. Due passate bastano a
  // togliere la maggior parte degli incroci.
  for (let pass = 0; pass < 2; pass++) {
    for (let d = 1; d < layers.length; d++) {
      const prev = layers[d - 1];
      const layer = layers[d];
      if (!prev || !layer) continue;
      const rank = new Map(prev.map((t, i) => [t.uid, i]));
      const bary = new Map(
        layer.map((t) => {
          const ranks = [...(parentsOf.get(t.uid) || [])]
            .map((p) => rank.get(p))
            .filter((r) => r != null);
          return [t.uid, ranks.length ? ranks.reduce((a, b) => a + b, 0) / ranks.length : Infinity];
        })
      );
      layer.sort((a, b) => bary.get(a.uid) - bary.get(b.uid) || cmpName(a, b));
    }
  }

  const pos = {};
  let x = 0;
  for (const layer of layers) {
    if (!layer?.length) continue;
    let y = 0;
    let widest = MIN_W;
    for (const t of layer) {
      const { w, h } = nodeSize(t, view[t.uid] || {});
      pos[t.uid] = { x, y };
      y += h + GAP_Y;
      widest = Math.max(widest, w);
    }
    x += widest + GAP_X;
  }

  // Le isole in colonne da sei, alla destra di tutto il resto.
  const PER_COLUMN = 6;
  let islandY = 0;
  let islandX = x;
  let widest = MIN_W;
  islands.forEach((t, i) => {
    if (i && i % PER_COLUMN === 0) {
      islandX += widest + GAP_X;
      islandY = 0;
      widest = MIN_W;
    }
    const { w, h } = nodeSize(t, view[t.uid] || {});
    pos[t.uid] = { x: islandX, y: islandY };
    islandY += h + GAP_Y;
    widest = Math.max(widest, w);
  });

  return pos;
}

const cmpName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
const byName = cmpName;

/* ------------------------------------------------------------ inquadra -- */

// Riquadro che contiene i nodi indicati, con un margine.
export function boundsOf(draft, layout, view = {}, uids = null) {
  const tables = liveTables(draft).filter((t) => (uids ? uids.has(t.uid) : true));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const t of tables) {
    const p = layout[t.uid];
    if (!p) continue;
    const { w, h } = nodeSize(t, view[t.uid] || {});
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + w);
    maxY = Math.max(maxY, p.y + h);
  }
  if (minX === Infinity) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// Vista che inquadra un riquadro dentro un'area, con un po' d'aria intorno.
export function fitViewport(box, area, { padding = 60, maxZoom = 1.2 } = {}) {
  if (!box || !area?.width || !area?.height) return null;
  const z = Math.min(
    maxZoom,
    (area.width - padding * 2) / Math.max(1, box.w),
    (area.height - padding * 2) / Math.max(1, box.h)
  );
  const zoom = Math.max(0.08, z);
  return {
    z: zoom,
    x: area.width / 2 - (box.x + box.w / 2) * zoom,
    y: area.height / 2 - (box.y + box.h / 2) * zoom,
  };
}
