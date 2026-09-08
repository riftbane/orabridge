import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, TriangleAlert, Upload, X } from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.js';
import { parseCsv, sniffDelimiter } from '../csvParse.js';

// Caricamento di un file (CSV, TSV, testo delimitato, Excel) dentro una
// tabella, in tre passi: si sceglie il file, si abbinano le colonne, si guarda
// l'anteprima e si carica. I passi stanno in una finestra sola perché sono
// legati: cambiare il separatore al primo cambia gli abbinamenti del secondo.

const BATCH = 1000; // righe per richiesta: il server ne rifiuta più di 5000
const PREVIEW_ROWS = 20;
// Tetto di righe lette dal file: oltre, il browser tiene in memoria il file,
// il testo, le righe analizzate e le righe convertite tutti insieme.
const MAX_FILE_ROWS = 200000;
// Errori mostrati nel riepilogo: l'elenco serve a capire *cosa* è andato
// storto, non a rileggere il file riga per riga.
const MAX_SHOWN_ERRORS = 20;

const STEPS = ['File', 'Colonne', 'Caricamento'];

const ENCODINGS = [
  { id: 'utf-8', label: 'UTF-8' },
  { id: 'windows-1252', label: 'Windows-1252 (ANSI)' },
  { id: 'iso-8859-1', label: 'ISO-8859-1' },
  { id: 'utf-16le', label: 'UTF-16 LE' },
];

const DELIMITERS = [
  { id: ',', label: 'Virgola   ,' },
  { id: ';', label: 'Punto e virgola   ;' },
  { id: '\t', label: 'Tabulazione' },
  { id: '|', label: 'Barra verticale   |' },
];

// ------------------------------------------------------- lettura di un .xlsx
//
// Un .xlsx è uno ZIP di file XML, e il browser sa già fare entrambe le cose:
// decomprimere (DecompressionStream 'deflate-raw') e leggere XML (DOMParser).
// Bastano un centinaio di righe e non serve trascinarsi dietro una libreria.
// Leggiamo il primo foglio e nient'altro: sui casi strani (più fogli, formule,
// tabelle pivot) preferiamo rifiutare e chiedere un CSV piuttosto che
// importare qualcosa di diverso da quello che l'utente vede in Excel.

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

function zipIndex(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // La directory centrale si trova partendo dall'EOCD, che sta in fondo dopo
  // un commento lungo al più 64 KB: si cerca la firma all'indietro.
  let eocd = -1;
  const floor = Math.max(0, bytes.length - 66000);
  for (let i = bytes.length - 22; i >= floor; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Il file non è un archivio ZIP valido: un .xlsx dovrebbe esserlo.');
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const files = new Map();
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== SIG_CENTRAL) break;
    const nameLen = view.getUint16(at + 28, true);
    files.set(dec.decode(bytes.subarray(at + 46, at + 46 + nameLen)), {
      method: view.getUint16(at + 10, true),
      compSize: view.getUint32(at + 20, true),
      localAt: view.getUint32(at + 42, true),
    });
    at += 46 + nameLen + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  if (!files.size) {
    throw new Error("L'archivio è vuoto, oppure è scritto in una variante di ZIP che non sappiamo leggere.");
  }
  return { files, view };
}

async function zipRead(bytes, view, entry, label) {
  if (view.getUint32(entry.localAt, true) !== SIG_LOCAL) {
    throw new Error(`La voce «${label}» dell'archivio è danneggiata.`);
  }
  // La lunghezza dei campi «nome» ed «extra» dell'intestazione locale può
  // essere diversa da quella della directory centrale: i dati cominciano dopo
  // quelli, non dopo quelli dichiarati in fondo al file.
  const start =
    entry.localAt + 30 + view.getUint16(entry.localAt + 26, true) + view.getUint16(entry.localAt + 28, true);
  const data = bytes.subarray(start, start + entry.compSize);
  if (entry.method === 0) return new TextDecoder().decode(data); // voce non compressa
  if (entry.method !== 8) {
    throw new Error(`La voce «${label}» usa un metodo di compressione (${entry.method}) che non gestiamo.`);
  }
  if (!entry.compSize) {
    throw new Error(`La voce «${label}» non dichiara la propria dimensione: è uno ZIP scritto in streaming.`);
  }
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Questo browser non sa decomprimere gli archivi ZIP (manca DecompressionStream).');
  }
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

function parseXml(xml, label) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error(`Il contenuto di ${label} non è XML valido.`);
  return doc;
}

// I fogli usano un namespace predefinito: cercando per nome locale il lettore
// funziona anche con i file che invece lo dichiarano con un prefisso.
const tags = (node, name) => node.getElementsByTagNameNS('*', name);

// Formati numerici predefiniti di Excel che rappresentano date od orari.
const BUILTIN_DATE_FMT = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

function isDateFormat(id, code) {
  if (BUILTIN_DATE_FMT.has(id)) return true;
  if (!code) return false;
  // d/m/y/h/s contano solo fuori dal testo letterale: le parentesi quadre
  // ([Rosso], [$-409]) e le virgolette ne sono piene senza essere date.
  const bare = code.replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, '').replace(/\\./g, '');
  return /[dmyhs]/i.test(bare);
}

// Indici degli stili (attributo `s` delle celle) che formattano una data: senza
// questa informazione una data di Excel arriverebbe come numero seriale, e
// finirebbe nel database come tale.
function parseDateStyles(xml) {
  const doc = parseXml(xml, 'styles.xml');
  const custom = new Map();
  for (const f of tags(doc, 'numFmt')) {
    custom.set(Number(f.getAttribute('numFmtId')), f.getAttribute('formatCode') || '');
  }
  const out = new Set();
  const cellXfs = tags(doc, 'cellXfs')[0];
  if (!cellXfs) return out;
  let i = 0;
  for (const xf of tags(cellXfs, 'xf')) {
    const id = Number(xf.getAttribute('numFmtId') || 0);
    if (isDateFormat(id, custom.get(id))) out.add(i);
    i++;
  }
  return out;
}

// Excel conta i giorni a partire dal 30/12/1899: quella data (e non il
// 31/12/1899) compensa il 1900 bisestile che nel foglio esiste e nella realtà no.
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const pad = (n) => String(n).padStart(2, '0');

function serialToText(n) {
  const d = new Date(EXCEL_EPOCH + Math.round(n * 86400000));
  if (Number.isNaN(d.getTime())) return String(n);
  const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const secs = d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
  // L'ora si scrive solo se c'è: una data pura non deve diventare «… 00:00:00».
  return secs
    ? `${day} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
    : day;
}

// «AB12» → 27. Serve perché le celle vuote non vengono scritte affatto: senza
// il riferimento i valori scivolerebbero a sinistra di una colonna.
function refToIndex(ref) {
  const s = String(ref || '').toUpperCase();
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

function cellValue(c, shared, dateStyles) {
  const t = c.getAttribute('t') || 'n';
  if (t === 'inlineStr') {
    const is = tags(c, 'is')[0];
    return is ? is.textContent : null;
  }
  const v = tags(c, 'v')[0];
  const raw = v ? v.textContent : '';
  if (raw === '') return null;
  if (t === 's') return shared[Number(raw)] ?? null;
  if (t === 'str') return raw;
  if (t === 'b') return raw === '1' ? '1' : '0';
  // Errore di formula (#N/D, #DIV/0!): meglio un NULL che il testo dell'errore.
  if (t === 'e') return null;
  const style = Number(c.getAttribute('s') || 0);
  if (dateStyles.has(style)) {
    const n = Number(raw);
    if (Number.isFinite(n)) return serialToText(n);
  }
  return raw;
}

// Nomi di colonna utilizzabili: vuoti e doppioni renderebbero ambiguo
// l'abbinamento del secondo passo.
function uniqueNames(raw, width) {
  const out = [];
  const seen = new Map();
  for (let i = 0; i < width; i++) {
    const base = String(raw?.[i] ?? '').trim() || `COL${i + 1}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    out.push(n === 1 ? base : `${base}_${n}`);
  }
  return out;
}

function parseSheet(xml, shared, dateStyles, header) {
  const doc = parseXml(xml, 'il foglio di lavoro');
  const rows = [];
  let width = 0;
  let truncated = false;
  for (const row of tags(doc, 'row')) {
    const cells = [];
    for (const c of tags(row, 'c')) {
      const idx = refToIndex(c.getAttribute('r'));
      const at = idx >= 0 ? idx : cells.length;
      while (cells.length < at) cells.push(null);
      cells[at] = cellValue(c, shared, dateStyles);
    }
    // Una riga solo formattata (bordi, sfondo) esiste nel foglio ma non ha
    // dati: importarla vorrebbe dire inserire una riga di NULL.
    if (!cells.some((x) => x !== null && x !== '')) continue;
    rows.push(cells);
    width = Math.max(width, cells.length);
    if (rows.length > MAX_FILE_ROWS) {
      truncated = true;
      break;
    }
  }
  for (const r of rows) while (r.length < width) r.push(null);
  const names = header ? rows.shift() : null;
  return { columns: uniqueNames(names, width), rows, truncated };
}

async function readXlsx(bytes, header) {
  const { files, view } = zipIndex(bytes);
  const sheet = files.has('xl/worksheets/sheet1.xml')
    ? 'xl/worksheets/sheet1.xml'
    : [...files.keys()].filter((n) => /^xl\/worksheets\/[^/]+\.xml$/i.test(n)).sort()[0];
  if (!sheet) {
    throw new Error("Nell'archivio non c'è nessun foglio di lavoro: non sembra una cartella di Excel.");
  }
  const sharedEntry = files.get('xl/sharedStrings.xml');
  const shared = [];
  if (sharedEntry) {
    const doc = parseXml(await zipRead(bytes, view, sharedEntry, 'sharedStrings.xml'), 'sharedStrings.xml');
    for (const si of tags(doc, 'si')) shared.push(si.textContent ?? '');
  }
  let dateStyles = new Set();
  const stylesEntry = files.get('xl/styles.xml');
  if (stylesEntry) {
    try {
      dateStyles = parseDateStyles(await zipRead(bytes, view, stylesEntry, 'styles.xml'));
    } catch {
      // Gli stili servono solo a riconoscere le date: senza, si perde la
      // conversione (e il server lo dirà riga per riga), non tutto il file.
    }
  }
  return parseSheet(await zipRead(bytes, view, files.get(sheet), sheet), shared, dateStyles, header);
}

// -------------------------------------------------------------- il dialogo

const decodeText = (bytes, encoding) => {
  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch {
    // Etichetta sconosciuta al browser: meglio leggere in UTF-8 che fermarsi.
    return new TextDecoder().decode(bytes);
  }
};

// Confronto largo per l'abbinamento automatico: «Data ordine» e «DATA_ORDINE»
// sono la stessa colonna scritta da due programmi diversi.
const loose = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const cellText = (v) => (v === null || v === undefined ? null : String(v));

export default function ImportDataDialog({ connId, owner, table, onClose, onDone }) {
  // Chiudere la finestra mentre i lotti partono non deve lasciare
  // l'importazione a correre in sottofondo — men che meno arrivare al COMMIT
  // con nessuno che guarda.
  const abortRef = useRef(false);
  // Chiudere durante il caricamento vale come «interrompi»: i lotti già
  // inseriti restano nella transazione aperta, che si conferma o si annulla
  // dalla barra della scheda Dati.
  const close = () => {
    abortRef.current = true;
    onClose();
  };
  const toast = useStore((s) => s.toast);
  const fileRef = useRef(null);

  const [step, setStep] = useState(0);
  const [src, setSrc] = useState(null); // { name, bytes, xlsx }
  const [delimiter, setDelimiter] = useState(',');
  const [header, setHeader] = useState(true);
  const [encoding, setEncoding] = useState('utf-8');
  const [data, setData] = useState(null); // { columns, rows, truncated }
  const [parsing, setParsing] = useState(false);
  const [fileError, setFileError] = useState('');

  const [tableCols, setTableCols] = useState(null);
  const [colsError, setColsError] = useState('');
  const [map, setMap] = useState([]);

  const [continueOnError, setContinueOnError] = useState(true);
  const [commit, setCommit] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null); // { inserted, failed, errors, stopped }
  const [runError, setRunError] = useState('');

  // Le colonne della tabella: senza queste il secondo passo non ha senso,
  // quindi si caricano subito e non quando ci si arriva.
  useEffect(() => {
    let alive = true;
    api
      .tableColumns(connId, owner, table)
      .then((r) => {
        if (!alive) return;
        const cols = (r.rows || []).map((row) => ({
          name: row[1],
          type: row[2] || '',
          notNull: row[3] === 'NOT NULL',
          hasDefault: String(row[5] ?? '').trim() !== '',
        }));
        if (cols.length) setTableCols(cols);
        else setColsError(`Nessuna colonna leggibile per ${owner}.${table}.`);
      })
      .catch((err) => {
        if (!alive) return;
        setColsError(err.message);
        if (err.status === 409) useStore.getState().markDisconnected(connId);
      });
    return () => {
      alive = false;
    };
  }, [connId, owner, table]);

  // Rilettura del file a ogni cambio di opzione: il separatore sbagliato si
  // riconosce solo guardando il risultato, quindi deve costare un clic.
  useEffect(() => {
    if (!src) {
      setData(null);
      return undefined;
    }
    let alive = true;
    setParsing(true);
    setFileError('');
    (async () => {
      try {
        const out = src.xlsx
          ? await readXlsx(src.bytes, header)
          : parseCsv(decodeText(src.bytes, encoding), {
              delimiter,
              header,
              limit: MAX_FILE_ROWS + 1,
            });
        if (!alive) return;
        const rows = out.rows || [];
        const truncated = out.truncated || rows.length > MAX_FILE_ROWS;
        setData({ columns: out.columns || [], rows: truncated ? rows.slice(0, MAX_FILE_ROWS) : rows, truncated });
      } catch (err) {
        if (!alive) return;
        setData(null);
        setFileError(
          `${err.message} Se il file arriva da Excel e il problema resta, salvalo come CSV: ` +
            'è il formato su cui possiamo garantire il risultato.'
        );
      } finally {
        if (alive) setParsing(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [src, delimiter, header, encoding]);

  // Abbinamento automatico per nome: prima l'uguaglianza esatta (a meno delle
  // maiuscole), poi quella larga, così «ID» non ruba il posto a «ID_CLIENTE».
  useEffect(() => {
    if (!data || !tableCols) return;
    const exact = new Map(tableCols.map((c) => [c.name.toUpperCase(), c.name]));
    const wide = new Map();
    for (const c of tableCols) if (!wide.has(loose(c.name))) wide.set(loose(c.name), c.name);
    const used = new Set();
    setMap(
      data.columns.map((n) => {
        const hit = exact.get(String(n).trim().toUpperCase()) || wide.get(loose(n));
        if (!hit || used.has(hit)) return '';
        used.add(hit);
        return hit;
      })
    );
  }, [data, tableCols]);

  const used = useMemo(() => new Set(map.filter(Boolean)), [map]);

  // Colonne di destinazione e indici delle colonne del file da cui prenderle.
  const plan = useMemo(() => {
    const idx = [];
    const cols = [];
    map.forEach((t, i) => {
      if (t) {
        idx.push(i);
        cols.push(t);
      }
    });
    return { idx, cols };
  }, [map]);

  const missingRequired = useMemo(
    () => (tableCols || []).filter((c) => c.notNull && !c.hasDefault && !used.has(c.name)).map((c) => c.name),
    [tableCols, used]
  );

  const pickFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setFileError('');
    setResult(null);
    setRunError('');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      // Il vecchio .xls non è uno ZIP ma un contenitore OLE: leggerlo come
      // testo produrrebbe righe di caratteri illeggibili invece di un errore.
      if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
        setSrc(null);
        setFileError(
          'Questo è un foglio nel vecchio formato .xls, che non sappiamo leggere: ' +
            'riaprilo in Excel e salvalo come .xlsx o come CSV.'
        );
        return;
      }
      // La firma dell'header locale ZIP vale più dell'estensione: un .xlsx
      // rinominato .txt resta uno ZIP, e un CSV chiamato .xlsx resta testo.
      // Servono tutti e quattro i byte: «PK» da soli capitano anche in un CSV
      // che comincia con un codice prodotto (PK03;…), e quello verrebbe
      // rifiutato come archivio rotto.
      const xlsx =
        bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
      // Il separatore si indovina una volta sola, all'apertura: dopo comanda
      // quello scelto a mano. Basta l'inizio del file — sniffDelimiter guarda
      // solo la prima riga — e su un CSV da cento megabyte si risparmia una
      // decodifica intera.
      if (!xlsx) setDelimiter(sniffDelimiter(decodeText(bytes.subarray(0, 65536), encoding)));
      setSrc({ name: file.name, bytes, xlsx });
    } catch (err) {
      setFileError(err.message);
    }
  };

  const setMapAt = (i, value) => {
    setMap((m) => {
      const next = [...m];
      // Una colonna di destinazione può ricevere un solo valore: assegnarla di
      // nuovo la toglie a chi ce l'aveva prima.
      if (value) for (let k = 0; k < next.length; k++) if (next[k] === value) next[k] = '';
      next[i] = value;
      return next;
    });
  };

  const run = async () => {
    if (running || !data || !plan.cols.length) return;
    setRunning(true);
    setRunError('');
    setResult(null);
    setProgress(0);
    const total = data.rows.length;
    const errors = [];
    let inserted = 0;
    let failed = 0;
    let stopped = false;
    // Quando il driver si ferma a metà lotto non dice quante righe erano già
    // passate: il conteggio diventa un minimo, non un totale.
    let partial = false;
    let committed = false;
    try {
      for (let start = 0; start < total; start += BATCH) {
        if (abortRef.current) {
          stopped = true;
          break;
        }
        const slice = data.rows.slice(start, start + BATCH);
        const last = start + BATCH >= total;
        const r = await api.importData(connId, {
          owner,
          name: table,
          columns: plan.cols,
          rows: slice.map((row) => plan.idx.map((i) => cellText(row[i]))),
          continueOnError,
          // Il COMMIT si chiede solo con l'ultimo lotto: a metà strada
          // renderebbe definitivo un caricamento ancora incompleto.
          commit: commit && last,
        });
        if (r.txnOpen != null) useStore.getState().setTxnOpen(connId, r.txnOpen);
        if (r.inserted == null) partial = true;
        else inserted += r.inserted;
        if (commit && last && r.inserted > 0) committed = true;
        failed += r.failed || 0;
        for (const e of r.errors || []) {
          if (errors.length >= MAX_SHOWN_ERRORS) break;
          // `row: null` = il server non sa a quale riga attribuire l'errore.
          errors.push({
            row: e.row == null ? null : start + e.row + 1,
            message: e.message,
          });
        }
        setProgress(Math.min(start + BATCH, total));
        if (r.error) {
          setRunError(r.error.message);
          stopped = true;
          break;
        }
        if (!continueOnError && (r.failed || 0) > 0) {
          stopped = true;
          break;
        }
      }
      // Il server esegue il COMMIT solo insieme a un lotto che ha davvero
      // inserito qualcosa (per non confermare a vuoto il lavoro del foglio):
      // se l'ultimo lotto era tutto scartato, il commit tocca a noi. Sta
      // dentro lo stesso `try`, così la finestra resta occupata finché non è
      // finito anche questo — altrimenti un clic su «Carica» reimporterebbe
      // tutto il file mentre il commit è in volo.
      if (commit && !stopped && !abortRef.current && inserted > 0 && !committed) {
        try {
          await api.commit(connId);
          useStore.getState().setTxnOpen(connId, false);
          committed = true;
        } catch (err) {
          setRunError(`Righe inserite, ma il Commit è fallito: ${err.message}`);
        }
      }
    } catch (err) {
      setRunError(err.message);
      stopped = true;
      if (err.status === 409) useStore.getState().markDisconnected(connId);
    } finally {
      setRunning(false);
    }
    // A finestra chiusa il riepilogo non ha più dove comparire, ma le righe
    // già inserite esistono: il toast e la ricarica della griglia servono
    // proprio in quel caso, per non far credere che non sia successo niente.
    if (!abortRef.current) setResult({ inserted, failed, errors, stopped, partial, committed });
    if (inserted || partial) {
      const quante = partial ? `almeno ${inserted}` : inserted;
      toast(
        `Importate ${quante} rig${inserted === 1 && !partial ? 'a' : 'he'} in ${table}` +
          (committed ? '' : ' — da confermare con Commit'),
        failed || !committed ? 'info' : 'ok'
      );
    }
    onDone?.();
  };

  // Tornare indietro dopo un caricamento vuol dire volerlo rifare: il
  // riepilogo va via, altrimenti resterebbe a raccontare l'esito di prima.
  const goBack = () => {
    setResult(null);
    setRunError('');
    setProgress(0);
    setStep((s) => s - 1);
  };

  const canNext = step === 0 ? !!data && !!data.columns.length : plan.cols.length > 0;
  const preview = data ? data.rows.slice(0, PREVIEW_ROWS) : [];

  return (
    <div className="modal-overlay">
      <div className="modal import-data-modal">
        <div className="modal-head">
          <span>Importa dati in {owner}.{table}</span>
          <button className="icon-btn" onClick={close}><X size={14} /></button>
        </div>

        <div className="imp-steps">
          {STEPS.map((s, i) => (
            <div key={s} className={`imp-step ${i === step ? 'on' : ''} ${i < step ? 'done' : ''}`}>
              <span className="imp-step-n">{i < step ? <Check size={11} /> : i + 1}</span>
              {s}
            </div>
          ))}
        </div>

        <div className="modal-body">
          {colsError && (
            <div className="test-result err">
              <TriangleAlert size={15} />
              <span>Colonne della tabella non leggibili: {colsError}</span>
            </div>
          )}

          {step === 0 && (
            <>
              <label>
                File da caricare (.csv, .txt, .tsv, .xlsx)
                <div className="import-file-row">
                  <button className="btn" onClick={() => fileRef.current?.click()}>
                    <Upload size={13} /> Scegli file…
                  </button>
                  <span className="import-file-name">{src?.name || 'Nessun file selezionato'}</span>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".csv,.txt,.tsv,.xlsx"
                    hidden
                    onChange={pickFile}
                  />
                </div>
              </label>

              {src && !src.xlsx && (
                <div className="form-row">
                  <label style={{ flex: 1 }}>
                    Separatore
                    <select value={delimiter} onChange={(e) => setDelimiter(e.target.value)}>
                      {DELIMITERS.map((d) => (
                        <option key={d.id} value={d.id}>{d.label}</option>
                      ))}
                    </select>
                  </label>
                  <label style={{ flex: 1 }}>
                    Codifica
                    <select value={encoding} onChange={(e) => setEncoding(e.target.value)}>
                      {ENCODINGS.map((c) => (
                        <option key={c.id} value={c.id}>{c.label}</option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
              {src && (
                <label className="check-label">
                  <input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} />
                  La prima riga contiene i nomi delle colonne
                </label>
              )}
              {src?.xlsx && (
                <div className="imp-hint">
                  Del foglio Excel leggiamo solo il primo foglio di lavoro e i valori delle celle
                  (le formule arrivano come risultato, non come formula).
                </div>
              )}

              {parsing && <div className="grid-empty">Lettura del file…</div>}
              {fileError && (
                <div className="test-result err">
                  <TriangleAlert size={15} />
                  <span>{fileError}</span>
                </div>
              )}
              {data && !parsing && (
                <>
                  <div className="import-summary">
                    {data.rows.length} rig{data.rows.length === 1 ? 'a' : 'he'} · {data.columns.length} colonn
                    {data.columns.length === 1 ? 'a' : 'e'}
                  </div>
                  {data.truncated && (
                    <div className="test-result err">
                      <TriangleAlert size={15} />
                      <span>
                        Il file ha più di {MAX_FILE_ROWS.toLocaleString('it-IT')} righe: verranno
                        importate solo le prime. Per il resto conviene dividere il file.
                      </span>
                    </div>
                  )}
                  <PreviewTable columns={data.columns} rows={data.rows.slice(0, 5)} />
                </>
              )}
            </>
          )}

          {step === 1 && (
            <>
              {!tableCols && !colsError && <div className="grid-empty">Caricamento delle colonne…</div>}
              {tableCols && (
                <>
                  <div className="imp-hint">
                    Ogni colonna del file va in una colonna della tabella. Le colonne lasciate su
                    «non importare» vengono ignorate.
                  </div>
                  <div className="imp-map">
                    <div className="imp-map-head">
                      <span>Colonna del file</span>
                      <span />
                      <span>Colonna di {table}</span>
                    </div>
                    {(data?.columns || []).map((c, i) => (
                      <div className="imp-map-row" key={`${c}-${i}`}>
                        <span className="imp-map-src" title={c}>
                          {c}
                          <em>{cellText(data.rows[0]?.[i]) ?? '(vuoto)'}</em>
                        </span>
                        <ArrowRight size={13} className={map[i] ? '' : 'imp-map-off'} />
                        <select value={map[i] || ''} onChange={(e) => setMapAt(i, e.target.value)}>
                          <option value="">— non importare —</option>
                          {tableCols.map((tc) => (
                            <option key={tc.name} value={tc.name}>
                              {tc.name} · {tc.type}{tc.notNull ? ' · NOT NULL' : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                  {!plan.cols.length && (
                    <div className="test-result err">
                      <TriangleAlert size={15} />
                      <span>Nessuna colonna abbinata: non c'è niente da importare.</span>
                    </div>
                  )}
                  {!!missingRequired.length && (
                    <div className="test-result warn">
                      <TriangleAlert size={15} />
                      <span>
                        Obbligatorie e senza corrispondenza: {missingRequired.join(', ')}. Sono
                        colonne NOT NULL senza valore predefinito: le righe verranno rifiutate dal
                        database.
                      </span>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <div className="import-summary">
                {data?.rows.length ?? 0} rig{(data?.rows.length ?? 0) === 1 ? 'a' : 'he'} da inserire in{' '}
                {owner}.{table} su {plan.cols.length} colonn{plan.cols.length === 1 ? 'a' : 'e'}
              </div>
              <PreviewTable
                columns={plan.cols}
                rows={preview.map((row) => plan.idx.map((i) => cellText(row[i])))}
                caption={`Anteprima delle prime ${Math.min(PREVIEW_ROWS, preview.length)} righe come verranno inserite`}
              />

              <label className="check-label">
                <input
                  type="checkbox"
                  checked={continueOnError}
                  onChange={(e) => setContinueOnError(e.target.checked)}
                />
                Continua in caso di errore su una riga
              </label>
              <label className="check-label">
                <input type="checkbox" checked={commit} onChange={(e) => setCommit(e.target.checked)} />
                Esegui COMMIT alla fine
              </label>
              {!commit && (
                <div className="imp-hint">
                  Senza COMMIT le righe restano nella transazione del foglio SQL: le vedi solo tu,
                  finché non premi Commit (o Rollback per buttarle via). La griglia della tabella
                  legge da un'altra connessione, quindi non le mostrerà prima del COMMIT.
                </div>
              )}

              {(running || progress > 0) && data && (
                <div className="imp-progress">
                  <div
                    className="imp-progress-bar"
                    style={{ width: `${data.rows.length ? Math.round((progress / data.rows.length) * 100) : 0}%` }}
                  />
                  <span>
                    {progress} / {data.rows.length} righe
                  </span>
                </div>
              )}

              {runError && (
                <div className="test-result err">
                  <TriangleAlert size={15} />
                  <span>{runError}</span>
                </div>
              )}

              {result && (
                <div className="imp-result">
                  <div className={`test-result ${result.failed ? 'warn' : 'ok'}`}>
                    <Check size={15} />
                    <span>
                      {result.partial
                        ? `Almeno ${result.inserted} righe inserite`
                        : `Inserite ${result.inserted} righe`}
                      , {result.failed} rifiutate
                      {result.stopped ? ' (caricamento interrotto)' : ''}.
                      {result.inserted || result.partial
                        ? result.committed
                          ? ' Confermate con Commit.'
                          : ' Restano nella transazione aperta: confermale con Commit o annullale con Rollback.'
                        : ''}
                    </span>
                  </div>
                  {!!result.errors.length && (
                    <div className="sql-preview">
                      <div className="sql-preview-head">
                        Primi errori (il numero è la posizione fra le righe di dati del file)
                      </div>
                      <pre>
                        {result.errors
                          .map((e) => (e.row == null ? e.message : `riga ${e.row}: ${e.message}`))
                          .join('\n')}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn" onClick={goBack} disabled={step === 0 || running}>
            Indietro
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={close}>
            {result ? 'Chiudi' : running ? 'Interrompi' : 'Annulla'}
          </button>
          {step < 2 ? (
            <button className="btn primary" onClick={() => setStep((s) => s + 1)} disabled={!canNext}>
              Avanti
            </button>
          ) : (
            <button
              className="btn primary"
              onClick={run}
              disabled={running || !plan.cols.length || !data?.rows.length || !!result}
            >
              {running ? 'Caricamento…' : 'Carica'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Tabellina di anteprima condivisa dal primo e dal terzo passo: cambia solo
// quali colonne mostra.
function PreviewTable({ columns, rows, caption }) {
  if (!columns.length) return null;
  return (
    <div className="imp-preview">
      {caption && <div className="imp-preview-head">{caption}</div>}
      <div className="imp-preview-scroll">
        <table>
          <thead>
            <tr>{columns.map((c, i) => <th key={`${c}-${i}`}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {columns.map((c, k) => (
                  <td key={k} className={r[k] === null || r[k] === undefined ? 'null' : ''}>
                    {r[k] === null || r[k] === undefined ? '(null)' : String(r[k])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
