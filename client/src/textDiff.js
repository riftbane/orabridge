// Confronto riga per riga di due testi (viste, sorgenti PL/SQL), per la vista
// affiancata di DB Diff.
//
// Algoritmo di Myers (O(ND)): il costo dipende dal numero di differenze, non
// dalla dimensione dei file — su due versioni simili di un package da migliaia
// di righe resta immediato. Prima si tagliano le righe uguali in testa e in
// coda, così il caso tipico (una modifica in mezzo a tanto codice identico)
// arriva all'algoritmo già ridotto a poche righe.

// Oltre questo numero di differenze si smette di cercare l'allineamento
// ottimo: i due testi non hanno più abbastanza in comune perché un diff
// puntuale sia leggibile, e si mostrano come un unico blocco sostituito.
const MAX_DIFF = 800;

const splitLines = (text) => String(text ?? '').replace(/\r\n?/g, '\n').split('\n');

// Cammino minimo di edit; null se supera il limite.
function shortestEdit(a, b, max) {
  const n = a.length;
  const m = b.length;
  const offset = max;
  const v = new Int32Array(2 * max + 1);
  const trace = [];
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
          ? v[offset + k + 1]
          : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return trace;
    }
  }
  return null;
}

// Operazioni di edit fra due array di righe: '=' riga uguale, '-' solo a
// sinistra, '+' solo a destra. Si ripercorre il cammino a ritroso dall'angolo
// finale, seguendo per ogni d la diagonale da cui si era arrivati.
function diffOps(a, b) {
  if (!a.length && !b.length) return [];
  if (!a.length) return b.map((_, i) => ({ op: '+', bi: i }));
  if (!b.length) return a.map((_, i) => ({ op: '-', ai: i }));

  const max = Math.min(MAX_DIFF, a.length + b.length);
  const trace = shortestEdit(a, b, max);
  if (!trace) return null;

  // Il backtrack riparte dall'angolo finale.
  const ops = [];
  const offset = max;
  let x = a.length;
  let y = b.length;
  for (let d = trace.length - 1; d >= 0; d--) {
    const v = trace[d];
    const k = x - y;
    const prevK =
      k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? k + 1 : k - 1;
    const prevX = v[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) ops.push({ op: '=', ai: --x, bi: --y });
    if (d > 0) {
      if (x === prevX) ops.push({ op: '+', bi: --y });
      else ops.push({ op: '-', ai: --x });
    }
  }
  ops.reverse();
  return ops;
}

// Righe affiancate: { type, left, right, ln, rn }
//   same  riga identica     mod  riga cambiata
//   del   solo a sinistra   add  solo a destra
export function diffRows(leftText, rightText) {
  const a = splitLines(leftText);
  const b = splitLines(rightText);

  // righe uguali in testa e in coda: fuori dal calcolo
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  )
    tail++;

  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);
  const rows = [];
  const push = (type, left, right, ln, rn) => rows.push({ type, left, right, ln, rn });

  for (let i = 0; i < head; i++) push('same', a[i], b[i], i + 1, i + 1);

  const ops = diffOps(midA, midB);
  if (ops === null) {
    // troppo diversi: un unico blocco sostituito
    const n = Math.max(midA.length, midB.length);
    for (let i = 0; i < n; i++) {
      const l = midA[i];
      const r = midB[i];
      const ln = l === undefined ? null : head + i + 1;
      const rn = r === undefined ? null : head + i + 1;
      push(l === undefined ? 'add' : r === undefined ? 'del' : 'mod', l ?? null, r ?? null, ln, rn);
    }
  } else {
    // Le cancellazioni e le aggiunte consecutive si affiancano a coppie: è
    // così che una riga modificata si legge come una riga sola.
    let i = 0;
    while (i < ops.length) {
      const op = ops[i];
      if (op.op === '=') {
        push('same', midA[op.ai], midB[op.bi], head + op.ai + 1, head + op.bi + 1);
        i++;
        continue;
      }
      const dels = [];
      const adds = [];
      while (i < ops.length && ops[i].op === '-') dels.push(ops[i++]);
      while (i < ops.length && ops[i].op === '+') adds.push(ops[i++]);
      const n = Math.max(dels.length, adds.length);
      for (let j = 0; j < n; j++) {
        const d = dels[j];
        const s = adds[j];
        push(
          d && s ? 'mod' : d ? 'del' : 'add',
          d ? midA[d.ai] : null,
          s ? midB[s.bi] : null,
          d ? head + d.ai + 1 : null,
          s ? head + s.bi + 1 : null
        );
      }
    }
  }

  const baseA = a.length - tail;
  const baseB = b.length - tail;
  for (let i = 0; i < tail; i++) push('same', a[baseA + i], b[baseB + i], baseA + i + 1, baseB + i + 1);

  return rows;
}

// Comprime i blocchi di righe uguali lasciando `context` righe di contorno.
// Al posto delle righe nascoste resta una voce { type: 'fold', count, from },
// che la UI mostra come separatore espandibile.
export function foldRows(rows, context = 3) {
  const keep = new Array(rows.length).fill(false);
  rows.forEach((r, i) => {
    if (r.type === 'same') return;
    for (let j = Math.max(0, i - context); j <= Math.min(rows.length - 1, i + context); j++)
      keep[j] = true;
  });
  const out = [];
  let i = 0;
  while (i < rows.length) {
    if (keep[i]) {
      out.push(rows[i++]);
      continue;
    }
    const from = i;
    while (i < rows.length && !keep[i]) i++;
    out.push({ type: 'fold', count: i - from, from, to: i });
  }
  return out;
}

export function diffStats(rows) {
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const r of rows) {
    if (r.type === 'add') added++;
    else if (r.type === 'del') removed++;
    else if (r.type === 'mod') changed++;
  }
  return { added, removed, changed };
}
