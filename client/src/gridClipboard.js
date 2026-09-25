// Copia e incolla di righe della griglia. Modulo puro (nessun DOM): la griglia
// legge e scrive gli appunti, qui si decide solo il testo e dove vanno i valori.
//
// Il formato è quello di Excel e di SQL Developer — celle separate da
// tabulazione, righe da a capo — così una riga copiata qui si incolla in un
// foglio di calcolo e viceversa. Una cella che contiene tabulazioni o a capo
// va fra virgolette (raddoppiando quelle interne), altrimenti rileggendola si
// spezzerebbe in più celle.
import { parseCsv } from './csvParse.js';

export function tsvField(v) {
  if (v == null) return '';
  const s = String(v);
  return /[\t\n\r]/.test(s) || s.startsWith('"') ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toTsv(rows) {
  return rows.map((r) => r.map(tsvField).join('\t')).join('\n');
}

// Righe di celle dal testo degli appunti. La cella vuota torna `null`: in
// Oracle la stringa vuota è NULL, quindi è l'unica lettura che non perde niente.
export function parseTsv(text) {
  const src = String(text ?? '').replace(/\r?\n$/, '');
  if (!src) return [];
  return parseCsv(src, { header: false, delimiter: '\t' }).rows;
}

// Il testo negli appunti può essere quello che la griglia stessa ha appena
// copiato: in quel caso si incollano i valori grezzi (non decodificati, NULL
// distinto da tutto il resto) invece di rileggere il testo.
export function resolvePaste(text, lastCopy) {
  if (lastCopy && lastCopy.text === text) return lastCopy.rows.map((r) => r.slice());
  return parseTsv(text);
}

// Un incolla porta più di una cella (o più di una riga)? Solo allora la
// griglia se ne occupa: un valore singolo dentro un campo lo incolla il campo.
export function isMultiCell(text) {
  return /[\t\n\r]/.test(String(text ?? '').replace(/\r?\n$/, ''));
}

// Distribuisce le righe incollate sulle righe nuove a partire da
// `start` (indice nella lista) e dalla colonna `col`, creando le righe che
// mancano. Una riga copiata intera (tante celle quante colonne) va sempre
// dalla prima colonna: ogni valore finisce nella colonna da cui era partito,
// qualunque sia la cella in cui si è incollato. Le colonne che `canSet` scarta
// (tipi che l'editor non sa scrivere) restano omesse e prendono il default.
// Restituisce la lista nuova, senza toccare quella ricevuta.
export function pasteIntoRows(list, start, col, cells, width, canSet = () => true, makeRow) {
  const out = list.slice();
  const blank = () => (makeRow ? makeRow() : { values: new Array(width).fill(undefined) });
  cells.forEach((line, k) => {
    const from = line.length === width ? 0 : col;
    const at = start + k;
    while (out.length <= at) out.push(blank());
    const values = out[at].values.slice();
    line.forEach((v, j) => {
      const c = from + j;
      if (c >= width || !canSet(c)) return;
      values[c] = v;
    });
    out[at] = { ...out[at], values };
  });
  return out;
}
