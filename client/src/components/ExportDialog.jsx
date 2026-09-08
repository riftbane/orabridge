import React, { useMemo, useState } from 'react';
import { Download, TriangleAlert, X } from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.js';
import {
  EXPORT_FORMATS,
  downloadBlob,
  toCsv,
  toHtml,
  toInserts,
  toJson,
  toXlsx,
} from '../exporters.js';

// Finestra di esportazione: qui si sceglie *cosa* esportare e *come*, mentre a
// scrivere il file pensa exporters.js. La divisione conta perché i formati sono
// logica pura e collaudata dai test, questa invece è solo interfaccia.

// Estensione e MIME stanno in questo elenco e non fra i formati di exporters.js
// perché il TSV non è un esportatore a sé (è `toCsv` con la tabulazione) e
// perché l'ordine in cui i formati si presentano è una scelta della finestra.
// L'elenco è quello di `exporters.js`: qui se ne teneva una copia, che al
// primo formato aggiunto sarebbe rimasta indietro.
const FORMATS = EXPORT_FORMATS;

const DELIMITERS = [
  { id: ',', label: 'Virgola   ,' },
  { id: ';', label: 'Punto e virgola   ;' },
  { id: '\t', label: 'Tabulazione' },
  { id: '|', label: 'Barra verticale   |' },
];

// Stessi limiti di server/src/routes/data.js: chiedere di più sarebbe inutile,
// il server taglia comunque a 200 000.
const MAX_ROWS = 200000;
const DEFAULT_ROWS = 10000;
// Oltre questa soglia l'avvertenza smette di essere un suggerimento: un CSV da
// centomila righe si apre ancora, un XLSX o un HTML molto meno.
const HEAVY_ROWS = 50000;
const PREVIEW_ROWS = 5;

// Su Windows i caratteri riservati fanno fallire il salvataggio senza dire
// perché: meglio sostituirli qui che lasciare il download a metà.
const safeName = (s) =>
  (String(s ?? '').trim() || 'export').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);

export default function ExportDialog({ connId, columns = [], rows = [], source, defaultName, onClose }) {
  const uiFormat = useStore((s) => s.ui.exportFormat);
  const toast = useStore((s) => s.toast);

  const [format, setFormat] = useState(() =>
    FORMATS.some((f) => f.id === uiFormat) ? uiFormat : 'csv'
  );
  // Senza `source` non c'è modo di rileggere la query: resta solo quello che la
  // griglia ha già in mano.
  const canFetch = !!source?.kind;
  const [scope, setScope] = useState(() => (rows.length || !canFetch ? 'loaded' : 'all'));
  const [limit, setLimit] = useState(DEFAULT_ROWS);
  // Il TSV è un CSV con la tabulazione: se il formato ricordato è quello, il
  // separatore deve partire già giusto, altrimenti esce un file .tsv separato
  // da virgole.
  const [delimiter, setDelimiter] = useState(() => (uiFormat === 'tsv' ? '\t' : ','));
  const [header, setHeader] = useState(true);
  const [pretty, setPretty] = useState(true);
  const [insTable, setInsTable] = useState(() =>
    source?.kind === 'table' && source.owner && source.name
      ? `${source.owner}.${source.name}`
      : 'TABELLA'
  );
  const [commitEvery, setCommitEvery] = useState(0);
  const [sheet, setSheet] = useState(() => String(defaultName || 'Dati').slice(0, 31));
  const [name, setName] = useState(() => safeName(defaultName));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null); // { kind: 'err' | 'warn', text }

  const fmt = FORMATS.find((f) => f.id === format) || FORMATS[0];
  const filename = `${safeName(name)}.${fmt.ext}`;
  const isText = format !== 'xlsx';

  const pickFormat = (id) => {
    setFormat(id);
    useStore.getState().setUi({ exportFormat: id });
    // Il TSV è un CSV con la tabulazione: cambiando formato il separatore deve
    // seguire, altrimenti si scaricherebbe un .tsv separato da virgole.
    if (id === 'tsv') setDelimiter('\t');
    else if (id === 'csv' && delimiter === '\t') setDelimiter(',');
  };

  // `forPreview` toglie il BOM: nell'anteprima si vedrebbe come un carattere
  // spurio in testa alla prima intestazione.
  const build = (cols, data, forPreview) => {
    switch (format) {
      case 'csv':
      case 'tsv':
        return toCsv(cols, data, { delimiter, header, bom: !forPreview });
      case 'json':
        return toJson(cols, data, { pretty });
      case 'insert':
        return toInserts(cols, data, { table: insTable, commitEvery: Number(commitEvery) || 0 });
      case 'html':
        return toHtml(cols, data, { title: name || 'Esportazione Orabridge' });
      case 'xlsx':
        return toXlsx(cols, data, { sheet });
      default:
        return '';
    }
  };

  const preview = useMemo(() => {
    if (!isText) return null;
    try {
      return build(columns, rows.slice(0, PREVIEW_ROWS), true);
    } catch (err) {
      return `-- anteprima non disponibile: ${err.message}`;
    }
  }, [format, columns, rows, delimiter, header, pretty, insTable, commitEvery, name]);

  const clampLimit = () => {
    const n = Math.floor(Number(limit));
    setLimit(!Number.isFinite(n) || n <= 0 ? DEFAULT_ROWS : Math.min(MAX_ROWS, n));
  };

  const doExport = async () => {
    if (busy) return;
    setNotice(null);
    let cols = columns;
    let data = rows;
    let truncated = false;

    if (scope === 'all') {
      const maxRows = Math.min(MAX_ROWS, Math.max(1, Math.floor(Number(limit)) || DEFAULT_ROWS));
      setBusy(true);
      try {
        const r = await api.exportData(connId, { source, maxRows });
        if (r.error) {
          setNotice({ kind: 'err', text: r.error.message });
          return;
        }
        cols = r.columns || [];
        data = r.rows || [];
        truncated = !!r.truncated;
      } catch (err) {
        setNotice({ kind: 'err', text: err.message });
        if (err.status === 409) useStore.getState().markDisconnected(connId);
        return;
      } finally {
        setBusy(false);
      }
    }

    let content;
    try {
      content = build(cols, data, false);
    } catch (err) {
      setNotice({ kind: 'err', text: `Non è stato possibile generare il file: ${err.message}` });
      return;
    }
    downloadBlob(content, filename, fmt.mime);
    toast(`Esportate ${data.length} rig${data.length === 1 ? 'a' : 'he'} in ${filename}`, 'ok');
    if (truncated) {
      // Il file c'è ma è parziale: chiudere la finestra vorrebbe dire far
      // sparire l'unica riga di testo che lo dice.
      setNotice({
        kind: 'warn',
        text: `Il file è stato scaricato, ma l'esportazione si è fermata al tetto di ${data.length} righe: nel database ce ne sono altre.`,
      });
      return;
    }
    onClose();
  };

  return (
    <div className="modal-overlay">
      <div className="modal export-modal">
        <div className="modal-head">
          <span>Esporta dati</span>
          <button className="icon-btn" onClick={onClose}><X size={14} /></button>
        </div>

        <div className="modal-body">
          <div className="exp-field">
            Formato
            <div className="exp-formats">
              {FORMATS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={`exp-format ${format === f.id ? 'on' : ''}`}
                  onClick={() => pickFormat(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="exp-field">
            Righe da esportare
            <div className="exp-scope">
              <label className="check-label">
                <input
                  type="radio"
                  name="exp-scope"
                  checked={scope === 'loaded'}
                  onChange={() => setScope('loaded')}
                />
                Le righe caricate ({rows.length})
              </label>
              <label className="check-label">
                <input
                  type="radio"
                  name="exp-scope"
                  checked={scope === 'all'}
                  disabled={!canFetch}
                  onChange={() => setScope('all')}
                />
                Tutte le righe della query
              </label>
            </div>
          </div>

          {scope === 'all' && (
            <>
              <div className="form-row">
                <label style={{ width: 160 }}>
                  Massimo righe
                  <input
                    type="number"
                    min="1"
                    max={MAX_ROWS}
                    value={limit}
                    onChange={(e) => setLimit(e.target.value)}
                    onBlur={clampLimit}
                  />
                </label>
                <div className="exp-hint">
                  Il server non va comunque oltre {MAX_ROWS.toLocaleString('it-IT')} righe. Oltre
                  qualche decina di migliaia il file diventa lento da aprire — e un XLSX o un HTML
                  molto prima di un CSV.
                </div>
              </div>
              {Number(limit) > HEAVY_ROWS && (
                <div className="test-result err">
                  <TriangleAlert size={15} />
                  <span>
                    {Number(limit).toLocaleString('it-IT')} righe sono tante: la lettura può durare
                    minuti e il file risultante essere ingestibile per il programma che lo aprirà.
                  </span>
                </div>
              )}
            </>
          )}

          {(format === 'csv' || format === 'tsv') && (
            <div className="form-row">
              <label style={{ flex: 1 }}>
                Separatore
                <select value={delimiter} onChange={(e) => setDelimiter(e.target.value)}>
                  {DELIMITERS.map((d) => (
                    <option key={d.id} value={d.id}>{d.label}</option>
                  ))}
                </select>
              </label>
              <label className="check-label exp-check">
                <input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} />
                Prima riga con i nomi delle colonne
              </label>
            </div>
          )}

          {format === 'insert' && (
            <div className="form-row">
              <label style={{ flex: 1 }}>
                Tabella di destinazione
                <input value={insTable} onChange={(e) => setInsTable(e.target.value)} />
              </label>
              <label style={{ width: 170 }}>
                COMMIT ogni N righe (0 = mai)
                <input
                  type="number"
                  min="0"
                  value={commitEvery}
                  onChange={(e) => setCommitEvery(e.target.value)}
                />
              </label>
            </div>
          )}

          {format === 'xlsx' && (
            <label>
              Nome del foglio
              <input value={sheet} onChange={(e) => setSheet(e.target.value)} maxLength={31} />
            </label>
          )}

          {format === 'json' && (
            <label>
              Indentazione
              <select value={pretty ? '2' : '0'} onChange={(e) => setPretty(e.target.value === '2')}>
                <option value="2">Due spazi (leggibile)</option>
                <option value="0">Nessuna (file compatto)</option>
              </select>
            </label>
          )}

          <label>
            Nome del file
            <div className="exp-filename">
              <input value={name} onChange={(e) => setName(e.target.value)} />
              <span className="exp-ext">.{fmt.ext}</span>
            </div>
          </label>

          <div className="sql-preview">
            <div className="sql-preview-head">
              Anteprima {isText ? `(prime ${PREVIEW_ROWS} righe)` : ''}
            </div>
            <pre>
              {isText
                ? preview || '(nessuna riga da esportare)'
                : "Excel non ha anteprima: l'.xlsx è un archivio binario, si vede solo aprendolo."}
            </pre>
          </div>
          {scope === 'all' && isText && (
            <div className="exp-hint">
              L'anteprima è calcolata sulle righe già caricate; il file conterrà quelle rilette dal
              database.
            </div>
          )}

          {busy && (
            <div className="exp-progress">
              <div className="exp-progress-bar" />
              <span>Lettura delle righe dal database…</span>
            </div>
          )}

          {notice && (
            <div className={`test-result ${notice.kind === 'warn' ? 'warn' : 'err'}`}>
              <TriangleAlert size={15} />
              <span>{notice.text}</span>
            </div>
          )}
        </div>

        <div className="modal-foot">
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Chiudi</button>
          <button className="btn primary" onClick={doExport} disabled={busy}>
            <Download size={13} /> {busy ? 'Lettura…' : 'Esporta'}
          </button>
        </div>
      </div>
    </div>
  );
}
