import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CopyPlus,
  Download,
  Filter,
  Pin,
  Plus,
  Rows3,
  Trash2,
  X,
} from 'lucide-react';
import { EDITABLE_CELL_TYPES } from '../ddl.js';
import { decodeEntities } from '../htmlEntities.js';
import { useStore } from '../store.js';

const ROW_H = 26;
const HEADER_H = 28;
// Altezza della riga dei filtri: entra fra intestazione e dati, quindi si
// somma a HEADER_H in tutti i calcoli di posizione (vedi `headH`).
const FILTER_H = 28;
const ROWNUM_W = 46;
// Matches the "…(N caratteri)" suffix serializeValue() appends when a CLOB
// is too long to fetch in full: editing that truncated preview would corrupt
// the real value, so those cells fall back to the read-only value modal.
const TRUNCATED_RE = /… \(\d+ caratteri\)$/;

function computeWidths(columns, rows, show) {
  return columns.map((c, i) => {
    let max = c.name.length;
    const sample = Math.min(rows.length, 50);
    for (let r = 0; r < sample; r++) {
      const v = rows[r][i];
      if (v != null) max = Math.max(max, show(v).length);
    }
    return Math.min(480, Math.max(60, max * 7.2 + 20));
  });
}

function cmp(a, b) {
  if (a == null) return b == null ? 0 : 1;
  if (b == null) return -1;
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && a !== '' && b !== '') return na - nb;
  return String(a).localeCompare(String(b));
}

function canEditCell(col, value) {
  if (!EDITABLE_CELL_TYPES.has(col.type)) return false;
  if ((col.type === 'CLOB' || col.type === 'NCLOB') && typeof value === 'string' && TRUNCATED_RE.test(value)) {
    return false;
  }
  return true;
}

const CMP_OPS = {
  '>': (a, b) => a > b,
  '>=': (a, b) => a >= b,
  '<': (a, b) => a < b,
  '<=': (a, b) => a <= b,
  '=': (a, b) => a === b,
  '!=': (a, b) => a !== b,
  '<>': (a, b) => a !== b,
};

// Traduce il testo scritto in un filtro di colonna in un predicato sul valore
// grezzo. Il caso normale è «contiene», insensibile alle maiuscole: è quello
// che serve nel 90% dei casi e non richiede di conoscere una sintassi. Sopra
// ci sono due scorciatoie: `(null)` per le celle vuote e un prefisso di
// confronto (`>`, `>=`, `<`, `<=`, `=`, `!=`) per i numeri, perché su una
// colonna numerica «contiene 10» non vuol dire niente di utile.
// Se dopo l'operatore non c'è un numero si ripiega sul confronto testuale
// (solo per `=` e `!=`, gli unici che hanno senso su del testo).
function makeFilterTest(raw) {
  const q = String(raw ?? '').trim();
  if (!q) return null;
  if (/^\(null\)$/i.test(q)) return (v) => v == null;
  if (/^!\(null\)$/i.test(q)) return (v) => v != null;
  const m = /^(>=|<=|!=|<>|>|<|=)\s*(.*)$/.exec(q);
  if (m && m[2] !== '') {
    const op = CMP_OPS[m[1]];
    const num = Number(m[2]);
    if (Number.isFinite(num)) {
      return (v) => {
        if (v == null) return false;
        const n = Number(v);
        return Number.isFinite(n) && op(n, num);
      };
    }
    if (m[1] === '=' || m[1] === '!=' || m[1] === '<>') {
      const needle = m[2].toLowerCase();
      const eq = m[1] === '=';
      return (v) => (v == null ? !eq : (String(v).toLowerCase() === needle) === eq);
    }
  }
  const needle = q.toLowerCase();
  return (v) => v != null && String(v).toLowerCase().includes(needle);
}

// `editable` turns on double-click-to-edit for the Dati tab of a TABLE:
// `rowIds` (parallel to `rows`) supplies the ROWID used to persist each edit,
// and `onCellEdit(origIndex, colIndex, newValue, col)` performs the UPDATE,
// resolving to `{ ok:true }` or `{ error:true }` (never rejects).
// `dirtyResetKey` clears the "modified, not yet committed" highlight when it changes.
//
// Le funzionalità aggiunte dopo (barra interna, selezione di righe, filtro per
// colonna, vista a record singolo, blocco delle colonne) si accendono **solo**
// se il chiamante passa almeno una delle callback di riga o di esportazione:
// la griglia è usata da sei posti diversi e chi non chiede niente di nuovo
// deve continuare a vedere esattamente la griglia di prima.
// `onRowInsert(values)` riceve un array parallelo a `columns` (undefined =
// colonna omessa), `onRowDelete(origIndexes)` gli indici **originali** delle
// righe scelte, `onRowDuplicate(origIndex)` una riga sola; tutte risolvono a
// `{ ok:true }` o `{ error:true }`. `onExport(columns, rows)` riceve le righe
// così come si vedono, cioè già filtrate e ordinate. `columnTypes` (parallelo
// a `columns`) è facoltativo e serve solo ad arricchire la vista a record
// singolo con default e obbligatorietà.
export default function Grid({
  columns,
  rows,
  emptyText = 'Nessuna riga',
  editable = false,
  rowIds,
  onCellEdit,
  dirtyResetKey,
  datasetKey,
  onRowInsert,
  onRowDelete,
  onRowDuplicate,
  onExport,
  columnTypes,
}) {
  // Decodifica opt-in delle entità HTML (vedi ui.decodeEntities): riguarda
  // solo ciò che si vede — celle, modale del valore e copia della selezione.
  // Ordinamento, editing ed export CSV lavorano sempre sul valore grezzo che
  // arriva dal database.
  const decode = useStore((s) => s.ui.decodeEntities);
  const show = useCallback((v) => (decode ? decodeEntities(String(v)) : String(v)), [decode]);

  const scrollRef = useRef(null);
  const [range, setRange] = useState([0, 80]);
  const [widths, setWidths] = useState(() => computeWidths(columns, rows, show));
  const [sort, setSort] = useState(null); // { col, dir }
  const [sel, setSel] = useState(null); // { r1, c1, r2, c2 }
  const [dragging, setDragging] = useState(false);
  const [modal, setModal] = useState(null);
  const [edit, setEdit] = useState(null); // { r, c, value, saving }
  const [dirtyCells, setDirtyCells] = useState(() => new Set());
  const [dirtyRows, setDirtyRows] = useState(() => new Set());
  const skipBlurRef = useRef(false);
  const commitLockRef = useRef(false);

  // Selezione di righe intere: tenuta con gli indici **originali** così
  // sopravvive a ordinamento e filtro (che cambiano solo la posizione a
  // video). L'ancora dello Maiusc+clic invece è un indice a video, perché
  // l'intervallo che l'utente vede è quello.
  const [rowSel, setRowSel] = useState(() => new Set());
  const rowAnchorRef = useRef(null);
  const [filterOn, setFilterOn] = useState(false);
  const [filters, setFilters] = useState(() => ({})); // { indiceColonna: testo }
  const [record, setRecord] = useState(null); // { mode: 'view'|'insert', at }
  const [frozen, setFrozen] = useState(0); // quante colonne restano ferme a sinistra
  const [headMenu, setHeadMenu] = useState(null); // { x, y, col }
  const [busy, setBusy] = useState(false);

  const enhanced = !!(onRowInsert || onRowDelete || onRowDuplicate || onExport);

  // Only reset on a genuine new dataset (new `columns` identity), not on the
  // in-place row patch a successful cell edit applies — that would otherwise
  // wipe sort/selection/scroll and the dirty highlight right after every edit.
  useEffect(() => {
    setWidths(computeWidths(columns, rows, show));
    setSort(null);
    setSel(null);
    setEdit(null);
    setDirtyCells(new Set());
    setDirtyRows(new Set());
    setRowSel(new Set());
    setFilters({});
    setFrozen(0);
    setHeadMenu(null);
    setRecord(null);
    rowAnchorRef.current = null;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setRange([0, 80]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns]);

  useEffect(() => {
    setDirtyCells(new Set());
    setDirtyRows(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirtyResetKey]);

  // Righe rilette dal database: sono le stesse colonne (quindi filtro,
  // ordinamento e colonne bloccate restano, ed è quello che si vuole dopo un
  // inserimento) ma le righe possono essere altre, e la selezione — che è
  // fatta di indici — punterebbe a righe mai scelte. Va buttata.
  useEffect(() => {
    if (datasetKey === undefined) return;
    setRowSel(new Set());
    setSel(null);
    setEdit(null);
    setRecord(null);
    rowAnchorRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetKey]);

  // Il testo decodificato è più corto: ricalcola le larghezze quando si
  // accende o spegne la decodifica, senza toccare ordinamento e selezione.
  useEffect(() => {
    setWidths(computeWidths(columns, rows, show));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decode]);

  useEffect(() => {
    if (!dragging) return;
    const up = () => setDragging(false);
    document.addEventListener('mouseup', up);
    return () => document.removeEventListener('mouseup', up);
  }, [dragging]);

  // Un predicato per colonna, `null` dove non c'è filtro. Ricalcolato solo
  // quando il testo dei filtri cambia: una modifica di cella non lo tocca, e
  // quindi non fa ripartire nemmeno l'effetto che azzera lo scorrimento.
  const tests = useMemo(() => {
    if (!filterOn) return columns.map(() => null);
    return columns.map((_, i) => makeFilterTest(filters[i]));
  }, [columns, filters, filterOn]);

  // Original-index permutation for the current sort **and filter**, so edits
  // can address the caller's `rows`/`rowIds` arrays regardless of on-screen
  // order: `order[rigaAVideo]` resta sempre l'indice in `rows`, ed è l'unico
  // riferimento che le callback ricevono.
  const order = useMemo(() => {
    let idx = rows.map((_, i) => i);
    const active = [];
    tests.forEach((t, c) => {
      if (t) active.push([c, t]);
    });
    if (active.length) idx = idx.filter((i) => active.every(([c, t]) => t(rows[i][c])));
    if (sort) {
      const mul = sort.dir === 'desc' ? -1 : 1;
      const col = sort.col;
      idx.sort((x, y) => mul * cmp(rows[x][col], rows[y][col]) || x - y);
    }
    return idx;
  }, [rows, sort, tests]);

  const sorted = useMemo(() => order.map((i) => rows[i]), [order, rows]);
  const filtering = sorted.length !== rows.length;
  // Quante delle righe selezionate sono ancora a video: la selezione è fatta
  // di indici originali e sopravvive al filtro, ma su ciò che non si vede non
  // si agisce (vedi doDelete/doDuplicate).
  const selVisible = useMemo(() => {
    if (!rowSel.size) return 0;
    let n = 0;
    for (const i of order) if (rowSel.has(i)) n++;
    return n;
  }, [order, rowSel]);

  // Cambiare filtro rimescola le posizioni a video: la selezione rettangolare
  // (che è fatta di indici a video) non vuol più dire niente e la finestra
  // virtualizzata può puntare oltre la fine dell'elenco.
  useEffect(() => {
    setSel(null);
    setEdit(null);
    // L'ancora di Maiusc+clic è una posizione a video: dopo un filtro (o un
    // ordinamento) punta a un'altra riga, e un intervallo esteso da lì
    // sarebbe sbagliato.
    rowAnchorRef.current = null;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setRange([0, 80]);
  }, [tests, sort]);

  const headH = HEADER_H + (filterOn ? FILTER_H : 0);
  const totalW = useMemo(() => widths.reduce((a, b) => a + b, ROWNUM_W), [widths]);
  // Ascissa a cui incollare ogni colonna bloccata: il numero di riga è già
  // fermo a sinistra, quindi si parte dalla sua larghezza.
  const lefts = useMemo(() => {
    const out = [];
    let acc = ROWNUM_W;
    for (const w of widths) {
      out.push(acc);
      acc += w;
    }
    return out;
  }, [widths]);

  const onScroll = useCallback(
    (e) => {
      const el = e.target;
      const from = Math.max(0, Math.floor(el.scrollTop / ROW_H) - 10);
      const to = Math.min(sorted.length, from + Math.ceil(el.clientHeight / ROW_H) + 25);
      setRange([from, to]);
    },
    [sorted.length]
  );

  const startResize = (e, i) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widths[i];
    const move = (ev) => {
      setWidths((w) => {
        const next = [...w];
        next[i] = Math.max(40, startW + ev.clientX - startX);
        return next;
      });
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };

  const onKeyDown = (e) => {
    if (edit) return; // let the in-cell input handle its own keys
    if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
      e.preventDefault();
      if (sorted.length) setSel({ r1: 0, c1: 0, r2: sorted.length - 1, c2: columns.length - 1 });
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'c' && sel) {
      const r1 = Math.min(sel.r1, sel.r2);
      const r2 = Math.max(sel.r1, sel.r2);
      const c1 = Math.min(sel.c1, sel.c2);
      const c2 = Math.max(sel.c1, sel.c2);
      const text = [];
      for (let r = r1; r <= r2; r++) {
        const cells = [];
        for (let c = c1; c <= c2; c++) {
          const v = sorted[r]?.[c];
          cells.push(v == null ? '' : show(v));
        }
        text.push(cells.join('\t'));
      }
      navigator.clipboard?.writeText(text.join('\n'));
      e.preventDefault();
    }
  };

  const startSel = (r, c) => {
    setDragging(true);
    setSel({ r1: r, c1: c, r2: r, c2: c });
    // Le due selezioni (celle e righe intere) sono alternative: tenerle
    // accese insieme renderebbe impossibile capire su cosa agisce «Elimina».
    if (rowSel.size) setRowSel(new Set());
    if (record?.mode === 'view') setRecord({ mode: 'view', at: r });
  };
  const extendSel = (r, c) => {
    if (!dragging) return;
    setSel((s) => (s ? { ...s, r2: r, c2: c } : { r1: r, c1: c, r2: r, c2: c }));
  };
  const inSel = (r, c) => {
    if (!sel) return false;
    const r1 = Math.min(sel.r1, sel.r2);
    const r2 = Math.max(sel.r1, sel.r2);
    const c1 = Math.min(sel.c1, sel.c2);
    const c2 = Math.max(sel.c1, sel.c2);
    return r >= r1 && r <= r2 && c >= c1 && c <= c2;
  };

  const selectRow = (e, r) => {
    e.preventDefault();
    const orig = order[r];
    const additive = e.ctrlKey || e.metaKey;
    let next;
    if (e.shiftKey && rowAnchorRef.current != null) {
      // L'ancora può essere rimasta indietro rispetto all'elenco filtrato:
      // fuori dai limiti `order[i]` è `undefined`, e un `undefined` in
      // `rowSel` renderebbe impossibile eliminare (nessun ROWID corrisponde).
      const a = Math.max(0, Math.min(rowAnchorRef.current, r));
      const b = Math.min(order.length - 1, Math.max(rowAnchorRef.current, r));
      next = additive ? new Set(rowSel) : new Set();
      for (let i = a; i <= b; i++) {
        const oi = order[i];
        if (oi != null) next.add(oi);
      }
    } else {
      next = additive ? new Set(rowSel) : new Set();
      if (additive && next.has(orig)) next.delete(orig);
      else next.add(orig);
      rowAnchorRef.current = r;
    }
    setRowSel(next);
    setSel(null);
    if (record?.mode === 'view') setRecord({ mode: 'view', at: r });
  };

  // Scrittura di una cella comune all'editor in linea e a quello a record
  // singolo: il confronto con il valore di partenza evita l'UPDATE inutile e
  // l'evidenziazione "modificata" quando in realtà non è cambiato niente.
  const saveCell = useCallback(
    async (origIndex, c, newValue) => {
      if (!onCellEdit) return { error: true };
      const original = rows[origIndex]?.[c];
      const originalStr = original == null ? '' : String(original);
      const nextStr = newValue == null ? '' : String(newValue);
      if (nextStr === originalStr) return { ok: true };
      const result = await onCellEdit(origIndex, c, newValue, columns[c]);
      if (result?.ok) {
        setDirtyCells((d) => new Set(d).add(`${origIndex}:${c}`));
        setDirtyRows((d) => new Set(d).add(origIndex));
      }
      return result;
    },
    [rows, columns, onCellEdit]
  );

  const beginEdit = (r, c, v) => {
    commitLockRef.current = false;
    setEdit({ r, c, value: v == null ? '' : String(v) });
  };

  const cancelEdit = () => {
    skipBlurRef.current = true;
    setEdit(null);
  };

  const commitEdit = useCallback(async () => {
    if (!edit || commitLockRef.current) return;
    commitLockRef.current = true;
    try {
      const { r, c, value } = edit;
      const origIndex = order[r];
      const original = rows[origIndex][c];
      const originalStr = original == null ? '' : String(original);
      if (value === originalStr) {
        setEdit(null);
        return;
      }
      setEdit((s) => (s ? { ...s, saving: true } : s));
      await saveCell(origIndex, c, value === '' ? null : value);
      setEdit(null);
    } finally {
      commitLockRef.current = false;
    }
  }, [edit, order, rows, saveCell]);

  const handleDoubleClick = (r, c, v) => {
    const origIndex = order[r];
    const col = columns[c];
    const canEdit = editable && canEditCell(col, v) && rowIds?.[origIndex] != null;
    if (canEdit) {
      beginEdit(r, c, v);
      return;
    }
    if (v != null) setModal({ col: col.name, value: v });
  };

  // Senza ROWID non c'è modo di dire *quale* riga colpire: meglio non fare
  // niente che cancellare la riga sbagliata (il pulsante è già disabilitato,
  // questo è il paracadute).
  const doDelete = async () => {
    if (!onRowDelete || !rowSel.size || !rowIds || busy) return;
    // La selezione è fatta di indici originali e sopravvive a un cambio di
    // filtro: senza questo si cancellerebbero righe che non sono più a video,
    // con una conferma che dice solo quante sono.
    const visible = new Set(order);
    const idx = [...rowSel].filter((i) => visible.has(i)).sort((a, b) => a - b);
    const hidden = rowSel.size - idx.length;
    if (!idx.length) return;
    const quante = idx.length === 1 ? 'la riga selezionata' : `${idx.length} righe`;
    const question = hidden
      ? `Eliminare ${quante}? (${hidden} selezionate non sono a video per via del filtro e non verranno toccate)`
      : `Eliminare ${quante}?`;
    if ((idx.length > 1 || hidden) && !window.confirm(question)) return;
    setBusy(true);
    try {
      await onRowDelete(idx);
    } finally {
      // Anche in caso di errore: il chiamante ricarica comunque, e una
      // selezione rimasta lì punterebbe a righe che non ci sono più.
      setRowSel(new Set());
      setSel(null);
      rowAnchorRef.current = null;
      setBusy(false);
    }
  };

  const doDuplicate = async () => {
    if (!onRowDuplicate || rowSel.size !== 1 || !rowIds || busy) return;
    const only = [...rowSel][0];
    // Stessa cautela dell'eliminazione: se la riga selezionata è finita fuori
    // dal filtro, duplicarla senza vederla non aiuta nessuno.
    if (!order.includes(only)) return;
    setBusy(true);
    try {
      await onRowDuplicate(only);
    } finally {
      setBusy(false);
    }
  };

  const doInsert = async (values) => {
    if (!onRowInsert || busy) return;
    setBusy(true);
    try {
      const r = await onRowInsert(values);
      if (r?.ok) setRecord(null);
    } finally {
      setBusy(false);
    }
  };

  // Bloccare più colonne di quante ne stanno a video lascerebbe lo
  // scorrimento orizzontale senza spazio: si ferma a due terzi della
  // larghezza visibile.
  const canFreeze = (col) => {
    const view = scrollRef.current?.clientWidth || 0;
    return !view || lefts[col] + widths[col] <= view * 0.66;
  };

  if (!columns.length) return <div className="grid-empty">{emptyText}</div>;

  const [from, to] = range;
  const visible = sorted.slice(from, to);
  const recAt = record ? Math.min(Math.max(record.at ?? 0, 0), Math.max(sorted.length - 1, 0)) : null;
  const recOrig = record?.mode === 'view' && sorted.length ? order[recAt] : null;

  const frozenClass = (i) => (i < frozen ? ` grid-frozen${i === frozen - 1 ? ' grid-frozen-edge' : ''}` : '');
  const frozenStyle = (i, base) => (i < frozen ? { ...base, left: lefts[i] } : base);

  return (
    <div className={`grid-wrap ${dragging ? 'dragging' : ''}`} tabIndex={0} onKeyDown={onKeyDown}>
      {enhanced && (
        <div className="grid-bar">
          {onRowInsert && (
            <button
              className="mini-btn"
              onClick={() => setRecord({ mode: 'insert', at: 0 })}
              disabled={busy}
              title="Compila una nuova riga nel modulo a record singolo"
            >
              <Plus size={12} /> Nuova riga
            </button>
          )}
          {onRowDuplicate && (
            <button
              className="mini-btn"
              onClick={doDuplicate}
              disabled={busy || rowSel.size !== 1 || selVisible !== 1 || !rowIds}
              title={
                rowIds
                  ? 'Duplica la riga selezionata (seleziona il numero di riga)'
                  : 'Senza ROWID non si sa quale riga duplicare'
              }
            >
              <CopyPlus size={12} /> Duplica
            </button>
          )}
          {onRowDelete && (
            <button
              className="mini-btn danger"
              onClick={doDelete}
              disabled={busy || !selVisible || !rowIds}
              title={
                !selVisible && rowSel.size
                  ? 'Le righe selezionate non sono a video per via del filtro'
                  : rowIds
                  ? 'Elimina le righe selezionate (seleziona il numero di riga)'
                  : 'Senza ROWID non si sa quale riga eliminare'
              }
            >
              <Trash2 size={12} /> Elimina
            </button>
          )}
          <span className="ws-sep" />
          <button
            className={`mini-btn ${filterOn ? 'on' : ''}`}
            onClick={() => {
              setFilterOn((v) => !v);
              if (filterOn) setFilters({});
            }}
            title="Filtro per colonna sulle righe già caricate: «contiene», oppure >, >=, <, <=, =, != sui numeri e (null) per i vuoti"
          >
            <Filter size={12} /> Filtro
          </button>
          <button
            className={`mini-btn ${record ? 'on' : ''}`}
            onClick={() => setRecord((s) => (s ? null : { mode: 'view', at: sel ? sel.r1 : 0 }))}
            disabled={!sorted.length && !record}
            title="Vista a record singolo: una riga alla volta, in verticale"
          >
            <Rows3 size={12} /> Record
          </button>
          <div style={{ flex: 1 }} />
          {rowSel.size > 0 && (
            <span className="grid-bar-count">
              {rowSel.size} selezionate
              {selVisible !== rowSel.size && ` (${selVisible} a video)`}
            </span>
          )}
          <span className="grid-bar-count">
            {filtering ? `${sorted.length} di ${rows.length} righe` : `${rows.length} righe`}
          </span>
          {onExport && (
            <button
              className="mini-btn"
              onClick={() => onExport(columns, sorted)}
              title="Esporta esattamente le righe che si vedono, nell'ordine in cui si vedono"
            >
              <Download size={12} /> Esporta
            </button>
          )}
        </div>
      )}
      <div className="grid-body">
        <div className="grid-scroll" ref={scrollRef} onScroll={onScroll}>
          <div style={{ width: totalW, height: headH + sorted.length * ROW_H, position: 'relative' }}>
            <div className="grid-header" style={{ width: totalW, height: HEADER_H }}>
              <div className="grid-cell grid-rownum" style={{ width: ROWNUM_W }}>
                #
              </div>
              {columns.map((c, i) => (
                <div
                  key={i}
                  className={`grid-cell grid-head-cell${frozenClass(i)}`}
                  style={frozenStyle(i, { width: widths[i] })}
                  title={`${c.name} (${c.type})`}
                  onClick={() =>
                    setSort((s) =>
                      s?.col === i
                        ? s.dir === 'asc'
                          ? { col: i, dir: 'desc' }
                          : null
                        : { col: i, dir: 'asc' }
                    )
                  }
                  onContextMenu={
                    enhanced
                      ? (e) => {
                          e.preventDefault();
                          setHeadMenu({ x: e.clientX, y: e.clientY, col: i });
                        }
                      : undefined
                  }
                >
                  <span className="grid-head-name">{c.name}</span>
                  {sort?.col === i && (
                    <span className="grid-sort">
                      {sort.dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </span>
                  )}
                  <div className="grid-resize" onMouseDown={(e) => startResize(e, i)} onClick={(e) => e.stopPropagation()} />
                </div>
              ))}
            </div>
            {filterOn && (
              <div className="grid-filter-row" style={{ width: totalW, height: FILTER_H, top: HEADER_H }}>
                <div className="grid-cell grid-rownum grid-filter-num" style={{ width: ROWNUM_W }}>
                  <Filter size={11} />
                </div>
                {columns.map((c, i) => (
                  <div
                    key={i}
                    className={`grid-cell grid-filter-cell${frozenClass(i)}`}
                    style={frozenStyle(i, { width: widths[i] })}
                  >
                    <input
                      className="grid-filter-input"
                      value={filters[i] ?? ''}
                      placeholder="filtra…"
                      title={`Filtro su ${c.name}: testo contenuto, oppure >100, <=0, =X, != X, (null)`}
                      onChange={(e) => setFilters((f) => ({ ...f, [i]: e.target.value }))}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Escape') setFilters((f) => ({ ...f, [i]: '' }));
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
            {visible.map((row, vi) => {
              const r = from + vi;
              const origIndex = order[r];
              const rowDirty = editable && dirtyRows.has(origIndex);
              const rowPicked = rowSel.has(origIndex);
              return (
                <div
                  key={r}
                  className={`grid-row ${r % 2 ? 'odd' : ''} ${rowDirty ? 'row-dirty' : ''} ${
                    rowPicked ? 'row-picked' : ''
                  } ${recOrig === origIndex ? 'row-current' : ''}`}
                  style={{ top: headH + r * ROW_H, height: ROW_H, width: totalW }}
                >
                  <div
                    className="grid-cell grid-rownum"
                    style={{ width: ROWNUM_W }}
                    onMouseDown={enhanced ? (e) => selectRow(e, r) : undefined}
                    title={enhanced ? 'Seleziona la riga (Ctrl aggiunge, Maiusc estende)' : undefined}
                  >
                    {r + 1}
                  </div>
                  {row.map((v, c) => {
                    const isEditingThis = edit && edit.r === r && edit.c === c;
                    const cellDirty = editable && dirtyCells.has(`${origIndex}:${c}`);
                    return (
                      <div
                        key={c}
                        className={`grid-cell ${inSel(r, c) ? 'sel' : ''} ${cellDirty ? 'dirty' : ''} ${
                          isEditingThis ? 'editing' : ''
                        }${frozenClass(c)}`}
                        style={frozenStyle(c, { width: widths[c] })}
                        onMouseDown={() => !isEditingThis && startSel(r, c)}
                        onMouseEnter={() => extendSel(r, c)}
                        onDoubleClick={() => handleDoubleClick(r, c, v)}
                      >
                        {isEditingThis ? (
                          <input
                            className="grid-edit-input"
                            autoFocus
                            value={edit.value}
                            disabled={edit.saving}
                            onChange={(e) => setEdit((s) => ({ ...s, value: e.target.value }))}
                            onMouseDown={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                commitEdit();
                              } else if (e.key === 'Escape') {
                                e.preventDefault();
                                cancelEdit();
                              }
                            }}
                            onBlur={() => {
                              if (skipBlurRef.current) {
                                skipBlurRef.current = false;
                                return;
                              }
                              commitEdit();
                            }}
                          />
                        ) : v == null ? (
                          <span className="null">(null)</span>
                        ) : (
                          show(v)
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
        {record && (
          <RecordPanel
            columns={columns}
            columnTypes={columnTypes}
            show={show}
            mode={record.mode}
            values={record.mode === 'view' ? sorted[recAt] : null}
            rowKey={recOrig}
            position={{ n: sorted.length ? recAt + 1 : 0, total: sorted.length }}
            busy={busy}
            onPrev={() => setRecord({ mode: 'view', at: Math.max(0, recAt - 1) })}
            onNext={() => setRecord({ mode: 'view', at: Math.min(sorted.length - 1, recAt + 1) })}
            canEdit={(c, v) =>
              editable && !!onCellEdit && canEditCell(columns[c], v) && rowIds?.[recOrig] != null
            }
            onSaveCell={(c, v) => saveCell(recOrig, c, v)}
            onInsert={doInsert}
            onClose={() => setRecord(null)}
          />
        )}
      </div>
      {headMenu && (
        <div className="ctx-overlay" onMouseDown={() => setHeadMenu(null)} onContextMenu={(e) => e.preventDefault()}>
          <div className="ctx-menu" style={{ left: headMenu.x, top: headMenu.y }} onMouseDown={(e) => e.stopPropagation()}>
            <button
              disabled={!canFreeze(headMenu.col)}
              title={
                canFreeze(headMenu.col)
                  ? undefined
                  : 'Le colonne bloccate coprirebbero quasi tutta la larghezza visibile'
              }
              onClick={() => {
                setFrozen(headMenu.col + 1);
                setHeadMenu(null);
              }}
            >
              <Pin size={13} />
              <span className="ctx-label">Blocca fino a questa colonna</span>
            </button>
            <button
              disabled={!frozen}
              onClick={() => {
                setFrozen(0);
                setHeadMenu(null);
              }}
            >
              <X size={13} />
              <span className="ctx-label">Sblocca</span>
            </button>
          </div>
        </div>
      )}
      {modal && (
        <div className="modal-overlay">
          <div className="modal value-modal">
            <div className="modal-head">
              <span>{modal.col}</span>
              <button className="icon-btn" onClick={() => setModal(null)}>
                <X size={14} />
              </button>
            </div>
            <pre className="value-pre">{show(modal.value)}</pre>
            <div className="modal-foot">
              <button
                className="btn"
                onClick={() => navigator.clipboard?.writeText(show(modal.value))}
              >
                Copia
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Pannello laterale con una riga alla volta in verticale. È l'unica vista
// utilizzabile con cento colonne (l'elenco scorre) ed è anche il modulo con
// cui si compila una riga nuova: le due modalità condividono la stessa
// impaginazione perché è la stessa cosa, una volta piena e una volta vuota.
function RecordPanel({
  columns,
  columnTypes,
  show,
  mode,
  values,
  rowKey,
  position,
  busy,
  onPrev,
  onNext,
  canEdit,
  onSaveCell,
  onInsert,
  onClose,
}) {
  const insert = mode === 'insert';
  // Tri-stato per colonna: 'omit' = non toccata (prenderà il DEFAULT della
  // tabella), 'null' = NULL esplicito, 'set' = il testo scritto. Cancellare
  // il testo riporta a 'omit': in Oracle la stringa vuota è NULL, quindi non
  // si perde nessun valore rappresentabile.
  const [draft, setDraft] = useState(() => columns.map(() => ({ state: 'omit', text: '' })));

  useEffect(() => {
    setDraft(columns.map(() => ({ state: 'omit', text: '' })));
  }, [columns, insert]);

  const setField = (i, patch) =>
    setDraft((d) => d.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  const submit = () =>
    onInsert(draft.map((f) => (f.state === 'omit' ? undefined : f.state === 'null' ? null : f.text)));

  const filled = draft.some((f) => f.state !== 'omit');

  return (
    <div className="grid-record" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="grid-record-head">
        {insert ? (
          <span className="grid-record-title">Nuova riga</span>
        ) : (
          <>
            <button className="icon-btn" onClick={onPrev} disabled={position.n <= 1} title="Riga precedente">
              <ChevronLeft size={14} />
            </button>
            <span className="grid-record-title">
              {position.total ? `${position.n} / ${position.total}` : 'Nessuna riga'}
            </span>
            <button
              className="icon-btn"
              onClick={onNext}
              disabled={position.n >= position.total}
              title="Riga successiva"
            >
              <ChevronRight size={14} />
            </button>
          </>
        )}
        <div style={{ flex: 1 }} />
        <button className="icon-btn" onClick={onClose} title="Chiudi il pannello">
          <X size={14} />
        </button>
      </div>
      <div className="grid-record-body">
        {columns.map((col, i) => {
          const meta = columnTypes?.[i];
          const req = meta && (meta.nullable === false || meta.nullable === 'N');
          return (
            <div className="grid-record-field" key={i}>
              <label className="grid-record-label" title={`${col.name} (${col.type})`}>
                {col.name}
                {req && <span className="grid-record-req" title="Colonna obbligatoria"> *</span>}
                <span className="grid-record-type">{meta?.type || col.type}</span>
              </label>
              {insert ? (
                <InsertField
                  col={col}
                  meta={meta}
                  field={draft[i]}
                  disabled={busy}
                  onChange={(patch) => setField(i, patch)}
                />
              ) : (
                <ViewField
                  key={`${rowKey}:${i}`}
                  value={values?.[i]}
                  editable={!!values && canEdit(i, values[i])}
                  show={show}
                  onCommit={(v) => onSaveCell(i, v)}
                />
              )}
            </div>
          );
        })}
        {!insert && !values && <div className="grid-record-none">Nessuna riga da mostrare.</div>}
      </div>
      {insert && (
        <div className="grid-record-foot">
          <span className="pane-info">Vuoto = valore di default</span>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose} disabled={busy}>
            Annulla
          </button>
          <button className="btn primary" onClick={submit} disabled={busy || !filled}>
            Inserisci
          </button>
        </div>
      )}
    </div>
  );
}

// Un campo della riga esistente: si scrive nel database allo stesso modo
// dell'editor in linea (Invio o uscita dal campo), così le due strade
// producono lo stesso UPDATE.
function ViewField({ value, editable, show, onCommit }) {
  const orig = value == null ? '' : String(value);
  const [text, setText] = useState(orig);
  const [saving, setSaving] = useState(false);

  // Se la riga viene modificata da un'altra strada (l'editor in linea) il
  // campo deve mostrare il valore vero, non la bozza vecchia.
  useEffect(() => {
    setText(value == null ? '' : String(value));
  }, [value]);

  const commit = async (next) => {
    const v = next === undefined ? text : next;
    if (saving || v === orig) return;
    setSaving(true);
    const r = await onCommit(v === '' ? null : v);
    setSaving(false);
    // Se il database ha rifiutato, il valore a video deve tornare quello vero.
    if (!r?.ok) setText(orig);
  };

  if (!editable) {
    return (
      <div className="grid-record-value" title={value == null ? '' : show(value)}>
        {value == null ? <span className="null">(null)</span> : show(value)}
      </div>
    );
  }
  return (
    <div className="grid-record-edit">
      <input
        value={text}
        disabled={saving}
        placeholder={value == null ? '(null)' : ''}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => commit()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') setText(orig);
        }}
      />
      <button className="mini-btn" disabled={saving || value == null} title="Imposta a NULL" onClick={() => commit('')}>
        NULL
      </button>
    </div>
  );
}

// Un campo della riga da inserire. I tipi che l'editor non sa riportare in SQL
// (BLOB, RAW, timestamp con fuso…) restano fuori: la colonna si omette e
// prende il default, che è l'unica cosa sensata da fare senza un letterale.
function InsertField({ col, meta, field, disabled, onChange }) {
  const supported = EDITABLE_CELL_TYPES.has(col.type);
  if (!supported) {
    return (
      <div className="grid-record-value" title={`Tipo ${col.type}: non compilabile da qui`}>
        <span className="null">(default)</span>
      </div>
    );
  }
  const isNull = field.state === 'null';
  return (
    <div className="grid-record-edit">
      <input
        value={isNull ? '' : field.text}
        disabled={disabled || isNull}
        placeholder={isNull ? '(null)' : meta?.dataDefault ? String(meta.dataDefault) : '(default)'}
        onChange={(e) =>
          onChange({ text: e.target.value, state: e.target.value === '' ? 'omit' : 'set' })
        }
        onKeyDown={(e) => e.stopPropagation()}
      />
      <button
        className={`mini-btn ${isNull ? 'on' : ''}`}
        disabled={disabled}
        title="NULL esplicito (invece del valore di default)"
        onClick={() => onChange({ state: isNull ? 'omit' : 'null', text: '' })}
      >
        NULL
      </button>
    </div>
  );
}

// Interruttore della decodifica delle entità HTML: preferenza globale (vale
// per tutte le griglie) e persistita insieme al resto della disposizione.
export function DecodeEntitiesToggle() {
  const on = useStore((s) => s.ui.decodeEntities);
  const setUi = useStore((s) => s.setUi);
  return (
    <button
      className={`mini-btn ${on ? 'on' : ''}`}
      onClick={() => setUi({ decodeEntities: !on })}
      title={
        on
          ? 'Entità HTML decodificate: clicca per rivedere il dato grezzo del database'
          : 'Mostra le entità HTML decodificate (&agrave; → à): solo a video, il dato non cambia'
      }
    >
      &amp;→à
    </button>
  );
}

export function exportCsv(columns, rows, filename = 'orabridge.csv') {
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [columns.map((c) => esc(c.name)).join(',')];
  for (const r of rows) lines.push(r.map(esc).join(','));
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
