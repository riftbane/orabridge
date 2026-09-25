import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Check,
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
import { isMultiCell, pasteIntoRows, resolvePaste, toTsv } from '../gridClipboard.js';
import { useStore } from '../store.js';
import ContextMenu from './ContextMenu.jsx';

const ROW_H = 26;
const HEADER_H = 28;
// Altezza della riga dei filtri: entra fra intestazione e dati, quindi si
// somma a HEADER_H in tutti i calcoli di posizione (vedi `headH`).
const FILTER_H = 28;
const ROWNUM_W = 46;
const MAX_PASTE_ROWS = 500;
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
// `onRowsInsert(list)` riceve un array di righe, ognuna parallela a `columns`
// (undefined = colonna omessa), e risolve a `{ ok, done }` con quante ne sono
// state scritte prima dell'eventuale errore. `onRowDelete(origIndexes)` riceve
// gli indici **originali** delle righe scelte e risolve a `{ ok:true }` o
// `{ error:true }`. `onExport(columns, rows)` riceve le righe così come si
// vedono, cioè già filtrate e ordinate. `columnTypes` (parallelo a `columns`)
// è facoltativo e serve solo ad arricchire la vista a record singolo e le
// righe nuove con default e obbligatorietà.
//
// Righe nuove: come in SQL Developer si compilano dentro la griglia, in righe
// segnate con «+» sopra i dati, e vanno nel database solo con «Salva» (o
// Invio). Il chiamante può salvarle da fuori — il Commit lo fa prima di
// confermare — tramite il ref: `saveNew()` e `pendingCount()`; con
// `onPendingChange(n)` sa quante ce ne sono in sospeso.
//
// Ordinamento sul server: se il chiamante passa `onSortChange`, il clic
// sull'intestazione non riordina le righe in memoria ma chiama
// `onSortChange({ col, dir } | null)`, e la freccia segue `sort` (stessa
// forma). Serve quando le righe a video sono solo la prima pagina: ordinare
// quelle metterebbe in fila le righe caricate, mentre chi clicca vuole le
// prime della tabella intera per quella colonna — il chiamante rifà la query
// con un ORDER BY.
// Ultima copia fatta da una griglia: se negli appunti c'è ancora quel testo,
// l'incolla usa i valori grezzi invece di rileggerlo (vedi resolvePaste).
let lastCopy = null;

function copyRows(rawRows, show) {
  const text = toTsv(rawRows.map((r) => r.map((v) => (v == null ? null : show(v)))));
  lastCopy = { text, rows: rawRows.map((r) => r.slice()) };
  navigator.clipboard?.writeText(text);
}

const Grid = forwardRef(function Grid(
  {
    columns,
    rows,
    emptyText = 'Nessuna riga',
    editable = false,
    rowIds,
    onCellEdit,
    dirtyResetKey,
    datasetKey,
    onRowsInsert,
    onRowDelete,
    onPendingChange,
    onExport,
    columnTypes,
    sort: extSort,
    onSortChange,
  },
  ref
) {
  // Decodifica opt-in delle entità HTML (vedi ui.decodeEntities): riguarda
  // solo ciò che si vede — celle, modale del valore e copia della selezione.
  // Ordinamento, editing ed export CSV lavorano sempre sul valore grezzo che
  // arriva dal database.
  const decode = useStore((s) => s.ui.decodeEntities);
  const toast = useStore((s) => s.toast);
  const show = useCallback((v) => (decode ? decodeEntities(String(v)) : String(v)), [decode]);

  const scrollRef = useRef(null);
  const [range, setRange] = useState([0, 80]);
  const [widths, setWidths] = useState(() => computeWidths(columns, rows, show));
  const [localSort, setLocalSort] = useState(null); // { col, dir }
  const serverSort = !!onSortChange;
  const sort = serverSort ? extSort || null : localSort;
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
  const [record, setRecord] = useState(null); // { at }
  const [frozen, setFrozen] = useState(0); // quante colonne restano ferme a sinistra
  const [headMenu, setHeadMenu] = useState(null); // { x, y, col }
  const [cellMenu, setCellMenu] = useState(null); // { x, y, r, c }
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef(null);

  // Righe nuove non ancora scritte: `values` è parallelo a `columns`, con
  // undefined = colonna omessa (prende il DEFAULT), null = NULL esplicito.
  // `newAt` è la riga nuova su cui va un incolla fatto dalla griglia (clic sul
  // suo «+» o su una sua cella).
  const [pending, setPending] = useState([]); // [{ key, values }]
  const [newAt, setNewAt] = useState(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const newKeyRef = useRef(0);
  const focusNewRef = useRef(null); // { key, c } da mettere a fuoco dopo il render
  const pasteTimerRef = useRef(null);
  const savingRef = useRef(false);

  const enhanced = !!(onRowsInsert || onRowDelete || onExport);

  // Only reset on a genuine new dataset (new `columns` identity), not on the
  // in-place row patch a successful cell edit applies — that would otherwise
  // wipe sort/selection/scroll and the dirty highlight right after every edit.
  useEffect(() => {
    setWidths(computeWidths(columns, rows, show));
    setLocalSort(null);
    setSel(null);
    setEdit(null);
    setDirtyCells(new Set());
    setDirtyRows(new Set());
    setRowSel(new Set());
    setFilters({});
    setFrozen(0);
    setHeadMenu(null);
    setCellMenu(null);
    setRecord(null);
    // Colonne diverse (un ALTER TABLE, un'altra tabella): i valori delle righe
    // nuove, che sono per posizione, finirebbero nelle colonne sbagliate.
    setPending([]);
    setNewAt(null);
    rowAnchorRef.current = null;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setRange([0, 80]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns]);

  // Commit e Rollback: il Commit salva le righe nuove prima di confermare,
  // quindi qui ne restano solo dopo un Rollback, che le deve buttare come
  // butta tutto il resto.
  useEffect(() => {
    setDirtyCells(new Set());
    setDirtyRows(new Set());
    setPending([]);
    setNewAt(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirtyResetKey]);

  useEffect(() => {
    onPendingChange?.(pending.length);
  }, [pending.length, onPendingChange]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => onPendingChange?.(0), []);

  useEffect(() => {
    const want = focusNewRef.current;
    if (!want) return;
    focusNewRef.current = null;
    const el = scrollRef.current?.querySelector(`[data-new="${want.key}:${want.c}"]`);
    el?.focus();
  }, [pending]);

  useEffect(() => () => clearTimeout(pasteTimerRef.current), []);

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
    // Con l'ordinamento sul server le righe arrivano già in ordine: riordinarle
    // qui con `cmp` rischierebbe solo di contraddire le regole di Oracle
    // (collazione, NLS) sulle stesse righe.
    if (sort && !serverSort) {
      const mul = sort.dir === 'desc' ? -1 : 1;
      const col = sort.col;
      idx.sort((x, y) => mul * cmp(rows[x][col], rows[y][col]) || x - y);
    }
    return idx;
  }, [rows, sort, tests, serverSort]);

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
  // Le righe nuove stanno fra l'intestazione e i dati: spostano in giù tutto.
  const pendH = pending.length * ROW_H;
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
      const from = Math.max(0, Math.floor((el.scrollTop - pendH) / ROW_H) - 10);
      const to = Math.min(sorted.length, from + Math.ceil(el.clientHeight / ROW_H) + 25);
      setRange([from, to]);
    },
    [sorted.length, pendH]
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

  // ---- righe nuove ----

  // Nelle righe nuove si scrivono gli stessi tipi dell'editor in linea: per
  // gli altri (BLOB, RAW…) non c'è un letterale da mettere nell'INSERT e la
  // colonna resta al suo default.
  const canSetNew = useCallback((c) => EDITABLE_CELL_TYPES.has(columns[c]?.type), [columns]);
  const blankNew = useCallback(
    () => ({ key: ++newKeyRef.current, values: columns.map(() => undefined) }),
    [columns]
  );
  const firstSettable = () => Math.max(0, columns.findIndex((_, c) => canSetNew(c)));

  // Aggiunge righe nuove in fondo a quelle già in sospeso (vuote, o con i
  // valori di righe esistenti per Duplica) e mette il fuoco sulla prima.
  const addNew = (valuesList = [null]) => {
    if (!onRowsInsert || busy) return;
    const made = valuesList.map((vals) => {
      const row = blankNew();
      if (vals) row.values = columns.map((_, c) => (canSetNew(c) ? vals[c] : undefined));
      return row;
    });
    focusNewRef.current = { key: made[0].key, c: firstSettable() };
    setNewAt(pendingRef.current.length);
    setPending((p) => [...p, ...made]);
    setSel(null);
    setRowSel(new Set());
  };

  const setNewValue = (key, c, v) =>
    setPending((list) =>
      list.map((p) => (p.key === key ? { ...p, values: p.values.map((x, j) => (j === c ? v : x)) } : p))
    );

  const discardNew = (key) => {
    setPending((list) => list.filter((p) => p.key !== key));
    setNewAt(null);
  };

  // Incolla sulle righe nuove a partire dalla riga `at` (null = in coda, cioè
  // righe tutte nuove) e dalla colonna `c`. Vedi pasteIntoRows per la regola
  // delle «stesse posizioni».
  const pasteNew = (text, at, c = 0) => {
    if (!onRowsInsert || savingRef.current) return false;
    const cells = resolvePaste(text, lastCopy);
    if (!cells.length) return false;
    // Le righe nuove non sono virtualizzate: migliaia di righe incollate
    // bloccherebbero la griglia, e per quello c'è l'importazione da file.
    if (cells.length > MAX_PASTE_ROWS) {
      toast(`Troppe righe da incollare (${cells.length}): per più di ${MAX_PASTE_ROWS} usa «Importa…»`, 'error');
      return true;
    }
    const list = pendingRef.current;
    const start = at != null && at < list.length ? at : list.length;
    setPending(pasteIntoRows(list, start, c, cells, columns.length, canSetNew, blankNew));
    setNewAt(start);
    setSel(null);
    setRowSel(new Set());
    return true;
  };

  // Scrive le righe nuove, in ordine. Al primo errore ci si ferma: quelle
  // già passate spariscono dall'elenco (sono nel database, nella transazione
  // aperta), quella rifiutata e le successive restano lì da correggere.
  const saveNew = useCallback(async () => {
    const list = pendingRef.current;
    if (!onRowsInsert || !list.length) return { ok: true, done: 0 };
    if (savingRef.current) return { ok: false, done: 0 };
    // Una riga lasciata vuota non ha niente da scrivere (Oracle non ha un
    // INSERT … DEFAULT VALUES): si butta e basta.
    const isFull = (p) => p.values.some((v) => v !== undefined);
    const full = list.filter(isFull);
    if (!full.length) {
      setPending([]);
      setNewAt(null);
      return { ok: true, done: 0 };
    }
    savingRef.current = true;
    setBusy(true);
    try {
      const r = await onRowsInsert(full.map((p) => p.values));
      const done = r?.done ?? 0;
      const gone = new Set(full.slice(0, done).map((p) => p.key));
      if (done < full.length) focusNewRef.current = { key: full[done].key, c: firstSettable() };
      setPending((cur) => cur.filter((p) => !gone.has(p.key) && isFull(p)));
      setNewAt(null);
      return { ok: !!r?.ok && done === full.length, done };
    } finally {
      savingRef.current = false;
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onRowsInsert, columns]);

  useImperativeHandle(ref, () => ({ saveNew, pendingCount: () => pendingRef.current.length }), [saveNew]);

  // ---- selezione e appunti ----

  // Copia: un rettangolo di celle trascinato si copia così com'è; altrimenti
  // (un clic su una cella o sul numero di riga) si copiano le righe intere
  // selezionate, nell'ordine in cui si vedono — è quello che serve per
  // incollarle in una riga nuova o in un foglio di calcolo.
  const copySelection = (what) => {
    const rect = sel && (sel.r1 !== sel.r2 || sel.c1 !== sel.c2);
    if (rect && what !== 'row') {
      const r1 = Math.min(sel.r1, sel.r2);
      const r2 = Math.max(sel.r1, sel.r2);
      const c1 = Math.min(sel.c1, sel.c2);
      const c2 = Math.max(sel.c1, sel.c2);
      const out = [];
      for (let r = r1; r <= r2; r++) out.push((sorted[r] || []).slice(c1, c2 + 1));
      copyRows(out, show);
      return true;
    }
    if (enhanced && rowSel.size) {
      copyRows(order.filter((i) => rowSel.has(i)).map((i) => rows[i]), show);
      return true;
    }
    if (sel) {
      const v = sorted[sel.r1]?.[sel.c1];
      lastCopy = null;
      navigator.clipboard?.writeText(v == null ? '' : show(v));
      return true;
    }
    return false;
  };

  const onKeyDown = (e) => {
    if (edit) return; // let the in-cell input handle its own keys
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === 'a') {
      e.preventDefault();
      if (sorted.length) setSel({ r1: 0, c1: 0, r2: sorted.length - 1, c2: columns.length - 1 });
      setRowSel(new Set());
      return;
    }
    if (mod && key === 'c') {
      if (copySelection()) e.preventDefault();
      return;
    }
    if (mod && key === 'v' && onRowsInsert) {
      // Di norma arriva l'evento `paste` (vedi onPaste), che non chiede
      // permessi. Se il browser non lo manda a un elemento non modificabile,
      // si ripiega sulla lettura degli appunti.
      clearTimeout(pasteTimerRef.current);
      const at = newAt;
      pasteTimerRef.current = setTimeout(async () => {
        pasteTimerRef.current = null;
        try {
          const text = await navigator.clipboard.readText();
          if (text) pasteNew(text, at);
        } catch {
          /* appunti non leggibili: niente da incollare */
        }
      }, 80);
    }
  };

  const onPaste = (e) => {
    clearTimeout(pasteTimerRef.current);
    pasteTimerRef.current = null;
    if (!onRowsInsert) return;
    // Filtri, editor in linea e celle delle righe nuove incollano da sé.
    if (e.target.closest?.('input, textarea')) return;
    const text = e.clipboardData?.getData('text/plain');
    if (text && pasteNew(text, newAt)) e.preventDefault();
  };

  const pasteFromMenu = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text || !pasteNew(text, null)) toast("Negli appunti non c'è niente da incollare", 'error');
    } catch {
      toast('Appunti non leggibili: usa Ctrl+V', 'error');
    }
  };

  const rowsBetween = (a, b) => {
    const out = new Set();
    for (let i = Math.max(0, Math.min(a, b)); i <= Math.min(order.length - 1, Math.max(a, b)); i++) {
      if (order[i] != null) out.add(order[i]);
    }
    return out;
  };

  // Clic su una cella: nelle griglie con la barra sceglie anche la riga
  // intera (evidenziata, ed è quella che copiano Ctrl+C, Duplica ed Elimina);
  // Ctrl+clic aggiunge righe, Maiusc+clic estende dalla cella di partenza.
  // Il tasto destro dentro la selezione non la cambia, così il menu agisce su
  // quello che si vede evidenziato.
  const startSel = (e, r, c) => {
    const orig = order[r];
    if (e.button === 2 && (inSel(r, c) || (enhanced && rowSel.has(orig)))) return;
    setNewAt(null);
    if (e.shiftKey && sel) {
      setSel({ ...sel, r2: r, c2: c });
      if (enhanced) setRowSel(rowsBetween(sel.r1, r));
      return;
    }
    if (e.button === 0) setDragging(true);
    setSel({ r1: r, c1: c, r2: r, c2: c });
    if (enhanced) {
      const additive = e.ctrlKey || e.metaKey;
      const next = additive ? new Set(rowSel) : new Set();
      next.add(orig);
      setRowSel(next);
      rowAnchorRef.current = r;
    }
    if (record) setRecord({ at: r });
  };
  const extendSel = (r, c) => {
    if (!dragging || !sel) return;
    setSel({ ...sel, r2: r, c2: c });
    if (enhanced) setRowSel(rowsBetween(sel.r1, r));
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
    // Il preventDefault evita la selezione del testo ma toglie anche il fuoco
    // alla griglia: senza, Ctrl+C subito dopo non arriverebbe a onKeyDown.
    wrapRef.current?.focus({ preventScroll: true });
    setNewAt(null);
    const orig = order[r];
    const additive = e.ctrlKey || e.metaKey;
    let next;
    if (e.shiftKey && rowAnchorRef.current != null) {
      // L'ancora può essere rimasta indietro rispetto all'elenco filtrato:
      // fuori dai limiti `order[i]` è `undefined`, e un `undefined` in
      // `rowSel` renderebbe impossibile eliminare (nessun ROWID corrisponde).
      next = additive ? new Set(rowSel) : new Set();
      for (const oi of rowsBetween(rowAnchorRef.current, r)) next.add(oi);
    } else {
      next = additive ? new Set(rowSel) : new Set();
      if (additive && next.has(orig)) next.delete(orig);
      else next.add(orig);
      rowAnchorRef.current = r;
    }
    setRowSel(next);
    setSel(null);
    if (record) setRecord({ at: r });
  };

  // Clic sul «+» di una riga nuova: diventa la destinazione di Ctrl+V.
  const selectNew = (e, p) => {
    e.preventDefault();
    wrapRef.current?.focus({ preventScroll: true });
    setNewAt(p);
    setSel(null);
    setRowSel(new Set());
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

  // Duplica non scrive niente: mette le righe selezionate fra le righe nuove,
  // dove si cambia quel che deve cambiare (di solito la chiave) prima di
  // salvare. Come per l'eliminazione, quello che il filtro nasconde non conta.
  const doDuplicate = () => {
    const picked = order.filter((i) => rowSel.has(i));
    if (picked.length) addNew(picked.map((i) => rows[i]));
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
  const recOrig = record && sorted.length ? order[recAt] : null;

  const frozenClass = (i) => (i < frozen ? ` grid-frozen${i === frozen - 1 ? ' grid-frozen-edge' : ''}` : '');
  const frozenStyle = (i, base) => (i < frozen ? { ...base, left: lefts[i] } : base);

  return (
    <div
      ref={wrapRef}
      className={`grid-wrap ${dragging ? 'dragging' : ''}`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
    >
      {enhanced && (
        <div className="grid-bar">
          {onRowsInsert && (
            <button
              className="mini-btn"
              onClick={() => addNew()}
              disabled={busy}
              title="Aggiunge una riga vuota da compilare nella griglia (Ctrl+V vi incolla una riga copiata)"
            >
              <Plus size={12} /> Nuova riga
            </button>
          )}
          {onRowsInsert && (
            <button
              className="mini-btn"
              onClick={doDuplicate}
              disabled={busy || !selVisible}
              title="Copia le righe selezionate fra le righe nuove, da modificare prima di salvare"
            >
              <CopyPlus size={12} /> Duplica
            </button>
          )}
          {pending.length > 0 && (
            <>
              <button
                className="mini-btn primary"
                onClick={saveNew}
                disabled={busy}
                title="Scrive le righe nuove nel database (Invio da una cella); restano da confermare con Commit"
              >
                <Check size={12} /> Salva {pending.length === 1 ? 'riga nuova' : `${pending.length} righe nuove`}
              </button>
              <button
                className="mini-btn"
                onClick={() => {
                  setPending([]);
                  setNewAt(null);
                }}
                disabled={busy}
                title="Butta le righe nuove non ancora salvate"
              >
                <X size={12} /> Scarta
              </button>
            </>
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
                  ? 'Elimina le righe selezionate (clic su una riga; Ctrl aggiunge, Maiusc estende)'
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
            onClick={() => setRecord((s) => (s ? null : { at: sel ? sel.r1 : 0 }))}
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
          <div style={{ width: totalW, height: headH + pendH + sorted.length * ROW_H, position: 'relative' }}>
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
                  onClick={() => {
                    const next =
                      sort?.col === i
                        ? sort.dir === 'asc'
                          ? { col: i, dir: 'desc' }
                          : null
                        : { col: i, dir: 'asc' };
                    if (serverSort) onSortChange(next);
                    else setLocalSort(next);
                  }}
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
            {pending.map((p, pi) => (
              <div
                key={`new-${p.key}`}
                className={`grid-row row-new ${newAt === pi ? 'row-picked' : ''}`}
                style={{ top: headH + pi * ROW_H, height: ROW_H, width: totalW }}
              >
                <div
                  className="grid-cell grid-rownum grid-new-num"
                  style={{ width: ROWNUM_W }}
                  onMouseDown={(e) => selectNew(e, pi)}
                  title="Riga nuova, non ancora nel database: clic per incollarci con Ctrl+V"
                >
                  <Plus size={11} />
                  <button
                    className="grid-new-drop"
                    title="Scarta questa riga nuova"
                    disabled={busy}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => discardNew(p.key)}
                  >
                    <X size={11} />
                  </button>
                </div>
                {columns.map((col, c) => {
                  const v = p.values[c];
                  if (!canSetNew(c)) {
                    return (
                      <div
                        key={c}
                        className={`grid-cell grid-new-cell${frozenClass(c)}`}
                        style={frozenStyle(c, { width: widths[c] })}
                        title={`Tipo ${col.type}: non compilabile da qui, prende il valore predefinito`}
                      >
                        <span className="null">(default)</span>
                      </div>
                    );
                  }
                  const meta = columnTypes?.[c];
                  const req = meta && (meta.nullable === false || meta.nullable === 'N');
                  return (
                    <div
                      key={c}
                      className={`grid-cell grid-new-cell grid-new-edit${frozenClass(c)}`}
                      style={frozenStyle(c, { width: widths[c] })}
                    >
                      <input
                        className={`grid-edit-input${v === null ? ' is-null' : ''}`}
                        data-new={`${p.key}:${c}`}
                        value={v == null ? '' : String(v)}
                        disabled={busy}
                        // Vuoto = colonna omessa (prende il DEFAULT); «(null)» =
                        // NULL esplicito, che arriva incollando una cella vuota
                        // o con Ctrl+Canc.
                        placeholder={
                          v === null
                            ? '(null)'
                            : meta?.dataDefault
                            ? String(meta.dataDefault).trim()
                            : req
                            ? 'obbligatoria'
                            : ''
                        }
                        title={`${col.name} (${meta?.type || col.type})${req ? ' — obbligatoria' : ''}`}
                        onFocus={() => setNewAt(pi)}
                        onChange={(e) => setNewValue(p.key, c, e.target.value === '' ? undefined : e.target.value)}
                        onPaste={(e) => {
                          const text = e.clipboardData?.getData('text/plain');
                          // Un valore solo lo incolla il campo; più celle (una
                          // riga copiata) si distribuiscono sulle colonne.
                          if (text && isMultiCell(text) && pasteNew(text, pi, c)) e.preventDefault();
                        }}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            saveNew();
                          } else if (e.key === 'Escape') {
                            e.preventDefault();
                            if (p.values.every((x) => x === undefined)) discardNew(p.key);
                            else e.currentTarget.blur();
                          } else if (e.key === 'Delete' && (e.ctrlKey || e.metaKey)) {
                            e.preventDefault();
                            setNewValue(p.key, c, v === null ? undefined : null);
                          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                            const to = pending[pi + (e.key === 'ArrowUp' ? -1 : 1)];
                            if (to) {
                              e.preventDefault();
                              scrollRef.current?.querySelector(`[data-new="${to.key}:${c}"]`)?.focus();
                            }
                          }
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            ))}
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
                  style={{ top: headH + pendH + r * ROW_H, height: ROW_H, width: totalW }}
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
                        onMouseDown={(e) => !isEditingThis && startSel(e, r, c)}
                        onContextMenu={
                          enhanced && !isEditingThis
                            ? (e) => {
                                e.preventDefault();
                                setCellMenu({ x: e.clientX, y: e.clientY, r, c });
                              }
                            : undefined
                        }
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
            values={sorted[recAt]}
            rowKey={recOrig}
            position={{ n: sorted.length ? recAt + 1 : 0, total: sorted.length }}
            onPrev={() => setRecord({ at: Math.max(0, recAt - 1) })}
            onNext={() => setRecord({ at: Math.min(sorted.length - 1, recAt + 1) })}
            canEdit={(c, v) =>
              editable && !!onCellEdit && canEditCell(columns[c], v) && rowIds?.[recOrig] != null
            }
            onSaveCell={(c, v) => saveCell(recOrig, c, v)}
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
      {cellMenu && (
        <ContextMenu
          x={cellMenu.x}
          y={cellMenu.y}
          onClose={() => setCellMenu(null)}
          items={[
            {
              label: rowSel.size > 1 ? `Copia ${rowSel.size} righe` : 'Copia riga',
              hint: 'Ctrl+C',
              onClick: () => copySelection(rowSel.size ? 'row' : undefined),
            },
            {
              label: 'Copia solo la cella',
              onClick: () => {
                const v = sorted[cellMenu.r]?.[cellMenu.c];
                lastCopy = null;
                navigator.clipboard?.writeText(v == null ? '' : show(v));
              },
            },
            ...(onRowsInsert
              ? [
                  { separator: true },
                  { label: 'Duplica come riga nuova', disabled: busy, onClick: doDuplicate },
                  { label: 'Incolla come riga nuova', hint: 'Ctrl+V', disabled: busy, onClick: pasteFromMenu },
                ]
              : []),
          ]}
        />
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
});

export default Grid;

// Pannello laterale con una riga alla volta in verticale: è l'unica vista
// utilizzabile con cento colonne (l'elenco scorre). Le righe nuove invece si
// compilano dentro la griglia.
function RecordPanel({
  columns,
  columnTypes,
  show,
  values,
  rowKey,
  position,
  onPrev,
  onNext,
  canEdit,
  onSaveCell,
  onClose,
}) {
  return (
    <div className="grid-record" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="grid-record-head">
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
              <ViewField
                key={`${rowKey}:${i}`}
                value={values?.[i]}
                editable={!!values && canEdit(i, values[i])}
                show={show}
                onCommit={(v) => onSaveCell(i, v)}
              />
            </div>
          );
        })}
        {!values && <div className="grid-record-none">Nessuna riga da mostrare.</div>}
      </div>
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
