import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { EditorView } from '@codemirror/view';
import { AlertTriangle, Hammer, Lock, Pencil, RefreshCw, Upload, X } from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.js';
import Grid, { DecodeEntitiesToggle } from './Grid.jsx';
import Editor from './Editor.jsx';
import { TypeIcon } from './ObjectTree.jsx';
import ObjectCreateDialog from './ObjectDialogs.jsx';
import TableEditDialog from './TableDialogs.jsx';
import ExportDialog from './ExportDialog.jsx';
import ImportDataDialog from './ImportDataDialog.jsx';
import { buildCellUpdateSql, buildRowDeleteSql, buildRowInsertSql } from '../ddl.js';

const SOURCE_TYPES = new Set([
  'PROCEDURE',
  'FUNCTION',
  'PACKAGE',
  'PACKAGE BODY',
  'TRIGGER',
  'TYPE',
  'TYPE BODY',
]);

// Spiegazione unica del perché un pulsante che scrive è spento: la si mette
// come `title` ovunque, così l'utente non deve indovinare se è un difetto.
export const READONLY_TITLE =
  'La connessione è aperta in sola lettura: le operazioni di scrittura sono disabilitate';

function subtabsFor(type) {
  // Le partizioni valgono solo per le tabelle: una vista materializzata ha la
  // sua tabella contenitore ma non si amministra da qui, e la linguetta resta
  // sempre accesa per le TABLE — la rotta risponde con una griglia vuota
  // quando la tabella non è partizionata, che è già la risposta giusta.
  if (type === 'TABLE')
    return [
      'Colonne',
      'Dati',
      'Vincoli',
      'Indici',
      'Statistiche',
      'Partizioni',
      'Trigger',
      'Dipendenze',
      'Permessi',
      'DDL',
    ];
  if (type === 'MATERIALIZED VIEW')
    return [
      'Colonne',
      'Dati',
      'Vincoli',
      'Indici',
      'Statistiche',
      'Trigger',
      'Dipendenze',
      'Permessi',
      'DDL',
    ];
  if (type === 'VIEW') return ['Colonne', 'Dati', 'Dipendenze', 'Permessi', 'DDL'];
  if (SOURCE_TYPES.has(type)) return ['Sorgente', 'Dipendenze', 'Permessi', 'DDL'];
  // I permessi si concedono su sequenze e sinonimi, non su un indice (che
  // eredita quelli della tabella): la linguetta va dove ha un senso. In cambio
  // l'indice è l'unico di questi tre ad avere statistiche proprie.
  if (type === 'SEQUENCE' || type === 'SYNONYM') return ['Dettagli', 'Permessi', 'DDL'];
  if (type === 'INDEX') return ['Dettagli', 'Statistiche', 'DDL'];
  return ['DDL'];
}

// Un errore del dizionario non è una griglia vuota: su un'utenza normale metà
// delle viste di sistema non sono leggibili, e il messaggio che dice quale
// privilegio manca è l'informazione utile della scheda.
export function DetailMessage({ text }) {
  return (
    <div className="detail-msg">
      <AlertTriangle size={15} />
      <span>{text}</span>
    </div>
  );
}

// Scheda «una richiesta, una griglia»: la usano quasi tutte le linguette di
// dettaglio, comprese quelle degli oggetti di sistema. `emptyText` sostituisce
// la griglia senza righe con una frase che dice perché è vuota (una tabella
// non partizionata, un oggetto senza dipendenti).
export function GridTab({ loader, emptyText }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let alive = true;
    setData(null);
    setErr(null);
    loader()
      .then((r) => alive && setData(r))
      .catch((e) => alive && setErr(e.message));
    return () => {
      alive = false;
    };
  }, [loader]);
  if (err) return <DetailMessage text={err} />;
  if (!data) return <div className="grid-empty">Caricamento…</div>;
  if (data.error) return <DetailMessage text={data.error} />;
  if (emptyText && !data.rows?.length) return <div className="grid-empty">{emptyText}</div>;
  return (
    <>
      <Grid columns={data.columns} rows={data.rows} />
      {data.note && <div className="detail-note">{data.note}</div>}
      {data.truncated && (
        <div className="detail-note">
          Elenco troncato: il database ne ha altre oltre alle {data.rows.length} mostrate.
        </div>
      )}
    </>
  );
}

// Maschera di inserimento con i valori di una riga già dentro. Duplicare una
// riga scrivendola subito fallirebbe quasi sempre sulla chiave primaria: prima
// di eseguire l'INSERT si passa di qui e si cambia quel che deve cambiare.
function DuplicateRowDialog({ columns, values, onCancel, onConfirm }) {
  // Stesso tri-stato del modulo a record singolo della griglia: 'set' scrive
  // il testo, 'null' scrive NULL, 'omit' tiene la colonna fuori dall'INSERT
  // (ci pensa il DEFAULT della tabella, o la sequenza della chiave). Una cella
  // vuota nell'originale parte da 'null': una copia deve restare una copia.
  const [draft, setDraft] = useState(() =>
    columns.map((_, i) =>
      values[i] == null ? { state: 'null', text: '' } : { state: 'set', text: String(values[i]) }
    )
  );
  const [busy, setBusy] = useState(false);

  const setField = (i, patch) =>
    setDraft((d) => d.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    const r = await onConfirm(
      draft.map((f) => (f.state === 'omit' ? undefined : f.state === 'null' ? null : f.text))
    );
    if (r?.error) setBusy(false);
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-head">
          <span>Duplica riga</span>
          <button className="icon-btn" onClick={onCancel}>
            <X size={14} />
          </button>
        </div>
        <div className="modal-body">
          <div className="pane-info">
            I valori arrivano dalla riga scelta: cambia quelli che devono essere diversi (di solito
            la chiave). «NULL» scrive un vuoto esplicito, «DEFAULT» lascia la colonna fuori
            dall&apos;INSERT e il valore lo decide il database.
          </div>
          <div className="dup-form">
            {columns.map((c, i) => {
              const f = draft[i];
              return (
                <div className="dup-field" key={`${c.name}-${i}`}>
                  <span className="dup-name" title={`${c.name} (${c.type})`}>
                    {c.name}
                  </span>
                  <input
                    value={f.text}
                    disabled={busy || f.state !== 'set'}
                    placeholder={f.state === 'null' ? '(null)' : '(valore predefinito)'}
                    onChange={(e) =>
                      setField(i, {
                        text: e.target.value,
                        state: e.target.value === '' ? 'omit' : 'set',
                      })
                    }
                  />
                  <button
                    className={`mini-btn ${f.state === 'null' ? 'on' : ''}`}
                    disabled={busy}
                    title="NULL esplicito, invece del valore predefinito"
                    onClick={() => setField(i, { state: f.state === 'null' ? 'set' : 'null' })}
                  >
                    NULL
                  </button>
                  <button
                    className={`mini-btn ${f.state === 'omit' ? 'on' : ''}`}
                    disabled={busy}
                    title="Non scrivere questa colonna: prende il valore predefinito (o la sequenza) del database"
                    onClick={() => setField(i, { state: f.state === 'omit' ? 'set' : 'omit' })}
                  >
                    DEFAULT
                  </button>
                </div>
              );
            })}
          </div>
        </div>
        <div className="modal-foot">
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onCancel} disabled={busy}>
            Annulla
          </button>
          <button className="btn primary" onClick={confirm} disabled={busy}>
            {busy ? 'Inserimento…' : 'Inserisci'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Due elenchi di colonne che descrivono la stessa cosa: nome e tipo uguali,
// nello stesso ordine. Serve a non cambiare l'identità dell'array quando non è
// cambiato niente — è l'identità di `columns` che dice alla griglia se ha
// davanti un dataset nuovo (e quindi se azzerare filtro, ordinamento e colonne
// bloccate). Un ALTER TABLE cambia sempre lunghezza, nome o tipo, quindi non
// può restare a schermo una colonna che non esiste più.
function sameColumns(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((c, i) => c.name === b[i].name && c.type === b[i].type);
}

function DataTab({ tab, readOnly }) {
  const [where, setWhere] = useState('');
  const [data, setData] = useState(null);
  const [count, setCount] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dirtyResetSeq, setDirtyResetSeq] = useState(0);
  // Cambia a ogni rilettura completa: la griglia butta la selezione di righe
  // (fatta di indici, che dopo una rilettura puntano ad altre righe) senza
  // perdere filtro, ordinamento e colonne bloccate.
  const [datasetSeq, setDatasetSeq] = useState(0);
  // Una finestra per volta: { kind: 'export' | 'import' | 'dup', … }
  const [dlg, setDlg] = useState(null);
  const toast = useStore((s) => s.toast);
  const txnOpen = useStore((s) => s.active[tab.connId]?.txnOpen);
  const PAGE = 200;
  // La modifica in linea (doppio clic su una cella) e tutte le scritture di
  // riga hanno bisogno di un ROWID per mirare la riga giusta: solo le tabelle
  // ne hanno uno stabile, e su una connessione in sola lettura non si scrive.
  const isTable = tab.type === 'TABLE';
  const editable = isTable && !readOnly;

  const load = useCallback(
    async (offset = 0, append = false, limit = PAGE) => {
      setLoading(true);
      try {
        const r = await api.tableData(tab.connId, {
          owner: tab.owner,
          name: tab.name,
          offset,
          limit,
          where,
          rowid: editable ? 1 : undefined,
          // Sulle tabelle modificabili si legge dalla sessione del foglio, non
          // dal pool: righe appena inserite o eliminate vivono nella
          // transazione aperta lì, e una connessione qualunque non le vedrebbe
          // — dopo un inserimento la griglia mostrerebbe lo stato di prima.
          // …ma solo a transazione aperta: altrimenti si legge dal pool come
          // sempre, senza mettersi in coda dietro una query lunga del foglio.
          session: editable && txnOpen ? 1 : undefined,
        });
        if (r.error) {
          toast(r.error, 'error');
          return;
        }
        setData((prev) => {
          // La griglia riparte da zero (filtro, ordinamento, colonne bloccate)
          // quando cambia l'identità di `columns`: dopo una scrittura le
          // colonne sono le stesse, quindi si riusa l'array di prima.
          const columns = prev && sameColumns(prev.columns, r.columns) ? prev.columns : r.columns;
          const next = { ...r, columns };
          return append && prev
            ? {
                ...next,
                rows: [...prev.rows, ...r.rows],
                rowids: [...(prev.rowids || []), ...(r.rowids || [])],
              }
            : next;
        });
        if (!append) setDatasetSeq((n) => n + 1);
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        setLoading(false);
      }
    },
    [tab.connId, tab.owner, tab.name, where, editable, txnOpen, toast]
  );

  useEffect(() => {
    load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Obbligatorietà e valore predefinito di ogni colonna: servono solo ad
  // arricchire il modulo a record singolo della griglia (l'asterisco sulle
  // colonne NOT NULL, il default come suggerimento). Se la lettura fallisce si
  // va avanti senza: il modulo funziona lo stesso.
  const [colMeta, setColMeta] = useState(null);
  useEffect(() => {
    if (!isTable) return undefined;
    let alive = true;
    api
      .tableColumns(tab.connId, tab.owner, tab.name)
      .then((r) => {
        if (!alive || r.error || !r.columns) return;
        const at = (label) => r.columns.findIndex((c) => c.name === label);
        const [iName, iType, iNull, iDef] = ['Colonna', 'Tipo', 'Null', 'Default'].map(at);
        if (iName === -1) return;
        const byName = {};
        for (const row of r.rows) {
          byName[row[iName]] = {
            type: iType === -1 ? null : row[iType],
            nullable: iNull === -1 ? undefined : row[iNull] !== 'NOT NULL',
            dataDefault: iDef === -1 ? null : row[iDef],
          };
        }
        setColMeta(byName);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [tab.connId, tab.owner, tab.name, isTable]);

  // Il dizionario elenca anche le colonne invisibili, che una SELECT * non
  // restituisce: l'allineamento si fa per nome, non per posizione.
  const columnTypes = useMemo(
    () => (colMeta && data ? data.columns.map((c) => colMeta[c.name] || null) : undefined),
    [colMeta, data]
  );

  // Dopo una scrittura la griglia va riletta: una riga appena inserita non ha
  // un ROWID finché non la si rilegge, e una cancellata lascerebbe una riga
  // fantasma. Si rilegge tanto quanto era già caricato, così a chi aveva
  // premuto «Carica altre» non spariscono le pagine sotto.
  const reload = useCallback(() => {
    const loaded = data?.rows.length || 0;
    const limit = Math.min(5000, Math.max(PAGE, Math.ceil(loaded / PAGE) * PAGE));
    return load(0, false, limit);
  }, [data, load]);

  const doCount = async () => {
    const r = await api.tableCount(tab.connId, {
      owner: tab.owner,
      name: tab.name,
      where,
      session: editable && txnOpen ? 1 : undefined,
    });
    if (r.error) toast(r.error, 'error');
    else setCount(r.count);
  };

  // Ogni scrittura passa dalla sessione del foglio (la stessa transazione dei
  // Commit/Rollback qui in barra): l'esito aggiorna sempre `txnOpen`, che è
  // quello che accende il pallino delle modifiche non confermate.
  const runWrite = useCallback(
    async (sql) => {
      const r = await api.execute(tab.connId, { sql });
      if (r.txnOpen != null) useStore.getState().setTxnOpen(tab.connId, r.txnOpen);
      return r;
    },
    [tab.connId]
  );

  // Persists one edited cell as an UPDATE on the dedicated worksheet session
  // (same connection-wide transaction the SQL sheet uses), then patches the
  // loaded row in place — keeping the same `columns` reference so the grid
  // doesn't lose its scroll/sort/selection state over an in-place edit.
  const onCellEdit = useCallback(
    async (origIndex, colIndex, newValue, col) => {
      const rowid = data?.rowids?.[origIndex];
      if (!rowid) {
        toast('Riga non identificabile (ROWID mancante)', 'error');
        return { error: true };
      }
      let sql;
      try {
        sql = buildCellUpdateSql(tab.owner, tab.name, col.name, col.type, rowid, newValue);
      } catch (err) {
        toast(err.message, 'error');
        return { error: true };
      }
      try {
        const r = await runWrite(sql);
        if (r.error) {
          toast(r.error.message, 'error');
          return { error: true };
        }
        setData((prev) => {
          if (!prev) return prev;
          const rows = prev.rows.slice();
          const row = rows[origIndex].slice();
          row[colIndex] = newValue;
          rows[origIndex] = row;
          return { ...prev, rows };
        });
        return { ok: true };
      } catch (err) {
        toast(err.message, 'error');
        if (err.status === 409) useStore.getState().markDisconnected(tab.connId);
        return { error: true };
      }
    },
    [data, tab.connId, tab.owner, tab.name, toast, runWrite]
  );

  const onRowInsert = useCallback(
    async (values) => {
      if (!data) return { error: true };
      let sql;
      try {
        sql = buildRowInsertSql(tab.owner, tab.name, data.columns, values);
      } catch (err) {
        toast(err.message, 'error');
        return { error: true };
      }
      if (!sql) {
        toast('Nessuna colonna valorizzata: niente da inserire', 'error');
        return { error: true };
      }
      try {
        const r = await runWrite(sql);
        if (r.error) {
          toast(r.error.message, 'error');
          return { error: true };
        }
        toast('Riga inserita (da confermare con Commit)', 'ok');
        await reload();
        return { ok: true };
      } catch (err) {
        toast(err.message, 'error');
        if (err.status === 409) useStore.getState().markDisconnected(tab.connId);
        return { error: true };
      }
    },
    [data, tab.connId, tab.owner, tab.name, toast, runWrite, reload]
  );

  const onRowDelete = useCallback(
    async (origIndexes) => {
      if (!origIndexes?.length) return { error: true };
      const rowids = origIndexes.map((i) => data?.rowids?.[i]);
      if (rowids.some((id) => !id)) {
        toast('Righe non identificabili (ROWID mancante)', 'error');
        return { error: true };
      }
      // Una DELETE per riga, in sequenza: al primo errore ci si ferma e si
      // dice quante ne sono passate, perché le precedenti restano scritte
      // nella transazione (e il Rollback in barra è lì per quello).
      let done = 0;
      try {
        for (const rowid of rowids) {
          const r = await runWrite(buildRowDeleteSql(tab.owner, tab.name, rowid));
          if (r.error) {
            toast(
              `${r.error.message} — eliminate ${done} righe su ${rowids.length}`,
              'error'
            );
            await reload();
            return { error: true };
          }
          done++;
        }
      } catch (err) {
        toast(`${err.message} — eliminate ${done} righe su ${rowids.length}`, 'error');
        if (err.status === 409) useStore.getState().markDisconnected(tab.connId);
        await reload();
        return { error: true };
      }
      toast(
        done === 1 ? 'Riga eliminata (da confermare con Commit)' : `${done} righe eliminate (da confermare con Commit)`,
        'ok'
      );
      await reload();
      return { ok: true };
    },
    [data, tab.connId, tab.owner, tab.name, toast, runWrite, reload]
  );

  // La duplicazione non scrive subito: apre l'inserimento con i valori
  // copiati e la promessa resta in sospeso finché l'utente non conferma o
  // annulla, così la griglia sa com'è finita.
  const onRowDuplicate = useCallback(
    (origIndex) => {
      const row = data?.rows?.[origIndex];
      if (!row) return Promise.resolve({ error: true });
      return new Promise((resolve) => {
        setDlg({ kind: 'dup', values: row.slice(), resolve });
      });
    },
    [data]
  );

  // Chi ha chiesto la duplicazione sta aspettando la promessa: chiudere la
  // finestra senza risolverla lascerebbe la griglia in attesa per sempre.
  const closeDup = (result) => {
    if (dlg?.kind === 'dup') dlg.resolve?.(result);
    setDlg(null);
  };

  const doCommit = async () => {
    try {
      await api.commit(tab.connId);
      useStore.getState().setTxnOpen(tab.connId, false);
      setDirtyResetSeq((n) => n + 1);
      toast('Commit eseguito', 'ok');
      // Dopo il commit la griglia va riletta: le righe inserite prendono ora
      // un ROWID (e quindi tornano modificabili) e i valori calcolati da
      // trigger o default arrivano quelli veri.
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const doRollback = async () => {
    try {
      await api.rollback(tab.connId);
      useStore.getState().setTxnOpen(tab.connId, false);
      setDirtyResetSeq((n) => n + 1);
      toast('Rollback eseguito (ricarico i dati)', 'ok');
      load(0);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <div className="data-tab">
      <div className="data-toolbar">
        <span className="where-label">WHERE</span>
        <input
          className="where-input"
          value={where}
          onChange={(e) => setWhere(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load(0)}
          placeholder="condizione facoltativa… (Invio per applicare)"
        />
        <button className="btn" onClick={() => load(0)} disabled={loading}>
          {loading ? '…' : 'Applica'}
        </button>
        <button className="btn" onClick={() => load(0)} title="Ricarica">
          <RefreshCw size={13} />
        </button>
        {editable && (
          <>
            <span className="ws-sep" />
            <button className="btn" onClick={doCommit} disabled={!txnOpen} title="Commit">
              Commit
            </button>
            <button className="btn" onClick={doRollback} disabled={!txnOpen} title="Rollback">
              Rollback
            </button>
            {txnOpen && <span className="txn-dot" title="Modifiche non ancora committate" />}
          </>
        )}
        {isTable && (
          <button
            className="btn"
            onClick={() => setDlg({ kind: 'import' })}
            disabled={readOnly}
            title={readOnly ? READONLY_TITLE : 'Carica righe da un file CSV'}
          >
            <Upload size={13} /> Importa…
          </button>
        )}
        <div style={{ flex: 1 }} />
        {data && (
          <span className="pane-info">
            {data.rows.length} righe{data.truncated ? '+' : ''}
            {count != null && ` / ${count} totali`}
          </span>
        )}
        {data?.truncated && (
          <button className="btn" onClick={() => load(data.rows.length, true)} disabled={loading}>
            Carica altre
          </button>
        )}
        <button className="mini-btn" onClick={doCount}>
          Conta
        </button>
        {/* L'esportazione sta nella barra interna della griglia, che esporta
            «quello che si vede» (righe filtrate e ordinate): ripeterla qui
            darebbe due pulsanti uguali a un centimetro di distanza. */}
        {data && <DecodeEntitiesToggle />}
      </div>
      {data ? (
        <Grid
          columns={data.columns}
          rows={data.rows}
          editable={editable}
          rowIds={data.rowids}
          onCellEdit={onCellEdit}
          dirtyResetKey={dirtyResetSeq}
          datasetKey={datasetSeq}
          onRowInsert={editable ? onRowInsert : undefined}
          onRowDelete={editable ? onRowDelete : undefined}
          onRowDuplicate={editable ? onRowDuplicate : undefined}
          onExport={(columns, rows) => setDlg({ kind: 'export', columns, rows })}
          columnTypes={columnTypes}
        />
      ) : (
        <div className="grid-empty">{loading ? 'Caricamento…' : 'Nessun dato'}</div>
      )}

      {dlg?.kind === 'export' && (
        <ExportDialog
          connId={tab.connId}
          columns={dlg.columns}
          rows={dlg.rows}
          // Con `source` la finestra può andare oltre le righe già caricate e
          // rifare la query sul server: il filtro WHERE deve viaggiare con lei.
          source={{ kind: 'table', owner: tab.owner, name: tab.name, where }}
          defaultName={tab.name}
          onClose={() => setDlg(null)}
        />
      )}
      {dlg?.kind === 'import' && (
        <ImportDataDialog
          connId={tab.connId}
          owner={tab.owner}
          table={tab.name}
          onClose={() => setDlg(null)}
          onDone={() => reload()}
        />
      )}
      {dlg?.kind === 'dup' && data && (
        <DuplicateRowDialog
          columns={data.columns}
          values={dlg.values}
          onCancel={() => closeDup({ error: true })}
          onConfirm={async (values) => {
            const r = await onRowInsert(values);
            if (r.ok) closeDup(r);
            return r;
          }}
        />
      )}
    </div>
  );
}

// Le dipendenze sono l'unica scheda a due sensi: «Usa» sono gli oggetti che
// servono a questo per compilare, «Usato da» quelli che si rompono se questo
// cambia. La direzione arriva al server come `uses` / `usedby`.
// Le statistiche dell'oggetto e quelle delle sue colonne rispondono a due
// domande diverse — «quanto è grande e quando è stata analizzata» contro «cosa
// sa l'ottimizzatore di ogni colonna» — e sono due query separate: stessa
// linguetta, due viste.
function StatsTab({ connId, owner, name, type }) {
  const [view, setView] = useState('object');
  const loader = useCallback(
    () =>
      view === 'object'
        ? api.objectStats(connId, { owner, name, type })
        : api.objectColumnStats(connId, { owner, name }),
    [connId, owner, name, type, view]
  );
  return (
    <div className="detail-sub">
      <div className="obj-toolbar">
        <div className="sub-switch">
          <button className={view === 'object' ? 'on' : ''} onClick={() => setView('object')}>
            Oggetto
          </button>
          <button className={view === 'columns' ? 'on' : ''} onClick={() => setView('columns')}>
            Colonne
          </button>
        </div>
        <span className="pane-info">
          {view === 'object'
            ? "Quello che l'ottimizzatore sa dell'oggetto: se l'ultima analisi è vecchia, i piani sbagliati hanno già una spiegazione."
            : 'Valori distinti, nulli e densità di ogni colonna.'}
        </span>
      </div>
      <GridTab
        key={view}
        loader={loader}
        emptyText={
          view === 'object'
            ? 'Nessuna statistica raccolta per questo oggetto.'
            : 'Nessuna statistica di colonna raccolta.'
        }
      />
    </div>
  );
}

function DependenciesTab({ connId, owner, name, type }) {
  const [dir, setDir] = useState('uses');
  const loader = useCallback(
    () => api.dependencies(connId, { owner, name, type, direction: dir }),
    [connId, owner, name, type, dir]
  );
  return (
    <div className="detail-sub">
      <div className="obj-toolbar">
        <div className="sub-switch">
          <button className={dir === 'uses' ? 'on' : ''} onClick={() => setDir('uses')}>
            Usa
          </button>
          <button className={dir === 'usedby' ? 'on' : ''} onClick={() => setDir('usedby')}>
            Usato da
          </button>
        </div>
        <span className="pane-info">
          {dir === 'uses'
            ? 'Oggetti a cui questo fa riferimento.'
            : 'Oggetti che diventano non validi se questo cambia.'}
        </span>
      </div>
      <GridTab
        key={dir}
        loader={loader}
        emptyText={
          dir === 'uses'
            ? 'Non fa riferimento a nessun altro oggetto.'
            : 'Nessun oggetto dipende da questo.'
        }
      />
    </div>
  );
}

// Nome della partizione dentro la griglia: l'intestazione è quella scritta
// dalla query del server, ma se un giorno cambiasse si ripiega sulla prima
// colonna, che resta comunque il nome.
function partitionNameIndex(columns) {
  const i = columns.findIndex((c) => /partizione/i.test(c.name));
  return i === -1 ? 0 : i;
}

function PartitionsTab({ connId, owner, name }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [part, setPart] = useState(null);

  useEffect(() => {
    let alive = true;
    api
      .partitions(connId, { owner, name })
      .then((r) => alive && setData(r))
      .catch((e) => alive && setErr(e.message));
    return () => {
      alive = false;
    };
  }, [connId, owner, name]);

  const subLoader = useCallback(
    () => api.partitions(connId, { owner, name, partition: part }),
    [connId, owner, name, part]
  );

  if (err) return <DetailMessage text={err} />;
  if (!data) return <div className="grid-empty">Caricamento…</div>;
  if (data.error) return <DetailMessage text={data.error} />;
  if (!data.rows.length)
    return <div className="grid-empty">La tabella non è partizionata.</div>;

  const nameIdx = partitionNameIndex(data.columns);
  const names = data.rows.map((r) => r[nameIdx]);

  return (
    <div className="detail-sub">
      <div className="obj-toolbar">
        {data.keyColumns?.length > 0 && (
          <span className="pane-info">
            Chiave di partizionamento: <b>{data.keyColumns.join(', ')}</b>
          </span>
        )}
        <div style={{ flex: 1 }} />
        {part && (
          <button className="btn" onClick={() => setPart(null)}>
            Tutte le partizioni
          </button>
        )}
      </div>
      <div className="part-split">
        <div className="part-list">
          {names.map((n, i) => (
            <button
              key={`${n}-${i}`}
              className={n === part ? 'on' : ''}
              title="Mostra le sottopartizioni"
              onClick={() => setPart(n)}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="part-main">
          {part ? (
            <>
              <div className="part-head">Sottopartizioni di {part}</div>
              <GridTab
                key={part}
                loader={subLoader}
                emptyText={`La partizione ${part} non ha sottopartizioni.`}
              />
            </>
          ) : (
            <Grid columns={data.columns} rows={data.rows} />
          )}
        </div>
      </div>
    </div>
  );
}

function CodeTab({ loader }) {
  const [text, setText] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let alive = true;
    loader()
      .then((r) => {
        if (!alive) return;
        if (r.error) setErr(r.error);
        else setText(r.text || '-- (vuoto)');
      })
      .catch((e) => alive && setErr(e.message));
    return () => {
      alive = false;
    };
  }, [loader]);
  if (err) return <DetailMessage text={err} />;
  if (text == null) return <div className="grid-empty">Caricamento…</div>;
  return (
    <div className="code-view">
      <Editor value={text} readOnly />
    </div>
  );
}

// Porta il cursore su una riga del sorgente e ci evidenzia il testo trovato.
// I numeri di riga della ricerca sono quelli di ALL_SOURCE e coincidono con
// quelli mostrati: `CREATE OR REPLACE ` si aggiunge in testa alla prima riga,
// senza spostarne nessuna.
function focusLine(view, focus) {
  const doc = view.state.doc;
  const line = doc.line(Math.max(1, Math.min(focus.line || 1, doc.lines)));
  let from = line.from;
  let to = line.from;
  if (focus.text) {
    let i = line.text.indexOf(focus.text);
    if (i === -1) i = line.text.toUpperCase().indexOf(focus.text.toUpperCase());
    if (i !== -1) {
      from = line.from + i;
      to = from + focus.text.length;
    }
  }
  view.dispatch({
    selection: { anchor: from, head: to },
    effects: EditorView.scrollIntoView(from, { y: 'center' }),
  });
  view.focus();
}

// Editable PL/SQL source with compile (CREATE OR REPLACE) + errors from ALL_ERRORS.
function SourceTab({ tab, readOnly }) {
  const { connId, owner, name, type } = tab;
  const toast = useStore((s) => s.toast);
  const [text, setText] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const [errors, setErrors] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const draft = useRef('');
  const viewRef = useRef(null);

  const load = useCallback(async () => {
    setText(null);
    setLoadErr(null);
    setErrors(null);
    setDirty(false);
    try {
      const r = await api.source(connId, owner, name, type);
      draft.current = r.text || '';
      setText(r.text || '');
      const e = await api.errors(connId, owner, name, type).catch(() => null);
      if (e?.errors?.length) setErrors(e.errors);
    } catch (err) {
      setLoadErr(err.message);
    }
  }, [connId, owner, name, type]);

  useEffect(() => {
    load();
  }, [load]);

  // Salto alla riga chiesto dalla ricerca globale: al primo caricamento e a
  // ogni nuovo risultato aperto sulla stessa scheda (cambia `seq`).
  const focusSeq = tab.focus?.seq;
  useEffect(() => {
    if (text == null || !tab.focus?.line) return;
    const view = viewRef.current;
    if (view) focusLine(view, tab.focus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, focusSeq]);

  const compile = async () => {
    const sqlText = draft.current.trim();
    if (!sqlText || busy || readOnly) return;
    setBusy(true);
    setErrors(null);
    try {
      const r = await api.execute(connId, { sql: sqlText });
      if (r.error) {
        let line = null;
        if (r.error.offset != null)
          line = sqlText.slice(0, Math.min(r.error.offset, sqlText.length)).split('\n').length;
        setErrors([{ line, position: null, text: r.error.message }]);
        toast(r.error.message, 'error');
      } else {
        const e = await api.errors(connId, owner, name, type).catch(() => ({ errors: [] }));
        const real = e.errors.filter((x) => !x.warning);
        setErrors(e.errors.length ? e.errors : []);
        if (real.length) {
          toast(`Compilato con ${real.length} errori`, 'error');
        } else {
          setDirty(false);
          toast('Compilato correttamente', 'ok');
        }
        useStore.getState().bumpTree(connId);
      }
    } catch (err) {
      toast(err.message, 'error');
      if (err.status === 409) useStore.getState().markDisconnected(connId);
    } finally {
      setBusy(false);
    }
  };

  const jump = (line) => {
    const view = viewRef.current;
    if (!view || !line) return;
    const doc = view.state.doc;
    const l = doc.line(Math.max(1, Math.min(line, doc.lines)));
    view.dispatch({ selection: { anchor: l.from }, scrollIntoView: true });
    view.focus();
  };

  if (loadErr) return <DetailMessage text={loadErr} />;
  if (text == null) return <div className="grid-empty">Caricamento…</div>;

  return (
    <div className="code-view">
      <div className="obj-toolbar">
        <button
          className="btn run"
          onClick={compile}
          disabled={busy || readOnly}
          title={readOnly ? READONLY_TITLE : 'Compila (Ctrl+Invio)'}
        >
          <Hammer size={13} /> Compila
        </button>
        <button className="btn" onClick={load} disabled={busy} title="Ricarica dal database (scarta le modifiche)">
          <RefreshCw size={13} /> Ripristina
        </button>
        {dirty && (
          <span className="pane-info dirty-info">
            <span className="txn-dot" /> modificato
          </span>
        )}
        <div style={{ flex: 1 }} />
        {errors && (
          <span className="pane-info">
            {errors.length ? `${errors.length} problemi` : 'nessun errore'}
          </span>
        )}
      </div>
      <Editor
        initialDoc={text}
        connId={connId}
        onChange={(t) => {
          draft.current = t;
          setDirty(true);
        }}
        onRun={compile}
        onViewReady={(v) => (viewRef.current = v)}
      />
      {errors?.length > 0 && (
        <div className="src-errors">
          {errors.map((e, i) => (
            <div key={i} className={`src-err ${e.warning ? 'warn' : ''}`} onClick={() => jump(e.line)}>
              <span className="loc">
                {e.line != null ? `riga ${e.line}` : ''}
                {e.position != null ? `:${e.position}` : ''}
              </span>
              <span>{e.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Etichetta della sola lettura accanto al nome dell'oggetto: la si vede prima
// di scoprire che i pulsanti sono spenti.
export function ReadOnlyBadge() {
  return (
    <span className="obj-readonly" title={READONLY_TITLE}>
      <Lock size={11} /> sola lettura
    </span>
  );
}

export default function ObjectDetail({ tab }) {
  const active = useStore((s) => s.active[tab.connId]);
  const connect = useStore((s) => s.connect);
  const subtabs = subtabsFor(tab.type);
  const [sub, setSub] = useState(subtabs[0]);
  const [dlg, setDlg] = useState(null);
  const [ver, setVer] = useState(0);
  const connected = active?.status === 'connected';
  const readOnly = !!active?.readOnly;

  const { connId, owner, name, type } = tab;

  // Arrivando da un risultato della ricerca la scheda può essere già aperta su
  // un'altra linguetta: il sorgente è quello che si vuole vedere.
  const focusSeq = tab.focus?.seq;
  useEffect(() => {
    if (focusSeq && SOURCE_TYPES.has(type)) setSub('Sorgente');
  }, [focusSeq, type]);

  const loaders = {
    Colonne: useCallback(() => api.tableColumns(connId, owner, name), [connId, owner, name]),
    Vincoli: useCallback(() => api.tableConstraints(connId, owner, name), [connId, owner, name]),
    Indici: useCallback(() => api.tableIndexes(connId, owner, name), [connId, owner, name]),
    Trigger: useCallback(() => api.tableTriggers(connId, owner, name), [connId, owner, name]),
    Permessi: useCallback(() => api.grants(connId, { owner, name }), [connId, owner, name]),
    Dettagli: useCallback(() => {
      if (type === 'SEQUENCE') return api.sequenceDetails(connId, owner, name);
      if (type === 'SYNONYM') return api.synonymDetails(connId, owner, name);
      return api.indexDetails(connId, owner, name);
    }, [connId, owner, name, type]),
    DDL: useCallback(() => api.ddl(connId, owner, name, type), [connId, owner, name, type]),
  };

  // after a DDL from this tab: refresh grids, tree and autocomplete
  const done = () => {
    setVer((v) => v + 1);
    const st = useStore.getState();
    st.bumpTree(connId);
    if (type === 'TABLE' || type === 'VIEW') st.loadAutocomplete(connId);
  };

  const renamed = (newName) => {
    const st = useStore.getState();
    st.bumpTree(connId);
    st.loadAutocomplete(connId);
    st.closeTab(tab.id);
    st.openObject(connId, owner, newName, 'TABLE');
  };

  if (!connected) {
    return (
      <div className="ws-banner">
        Connessione non attiva.
        <button className="btn primary" onClick={() => connect(connId)}>
          Connetti
        </button>
      </div>
    );
  }

  const isTable = type === 'TABLE';
  const writeTitle = (label) => (readOnly ? READONLY_TITLE : label);

  return (
    <div className="object-detail">
      <div className="obj-head">
        <TypeIcon type={type} />
        <span className="obj-title">
          {owner}.{name}
        </span>
        <span className="obj-type">{type}</span>
        {readOnly && <ReadOnlyBadge />}
        <div style={{ flex: 1 }} />
        {type === 'VIEW' && (
          <button
            className="btn"
            onClick={() => setDlg('editview')}
            disabled={readOnly}
            title={writeTitle('Cambia la query della vista')}
          >
            <Pencil size={13} /> Modifica vista
          </button>
        )}
        {type === 'SEQUENCE' && (
          <button
            className="btn"
            onClick={() => setDlg('altseq')}
            disabled={readOnly}
            title={writeTitle('Cambia i parametri della sequenza')}
          >
            <Pencil size={13} /> Modifica sequenza
          </button>
        )}
        {isTable && (
          <button
            className="btn"
            onClick={() => setDlg('edittable')}
            disabled={readOnly}
            title={writeTitle('Colonne, vincoli e indici della tabella')}
          >
            <Pencil size={13} /> Modifica tabella
          </button>
        )}
      </div>
      <div className="pane-tabs">
        {subtabs.map((s) => (
          <button key={s} className={sub === s ? 'on' : ''} onClick={() => setSub(s)}>
            {s}
          </button>
        ))}
      </div>
      <div className="pane-body">
        {sub === 'Dati' ? (
          <DataTab tab={tab} readOnly={readOnly} />
        ) : sub === 'Sorgente' ? (
          <SourceTab key={`src-${ver}`} tab={tab} readOnly={readOnly} />
        ) : sub === 'DDL' ? (
          <CodeTab key={`ddl-${ver}`} loader={loaders.DDL} />
        ) : sub === 'Statistiche' ? (
          <StatsTab key={`stat-${ver}`} connId={connId} owner={owner} name={name} type={type} />
        ) : sub === 'Dipendenze' ? (
          <DependenciesTab key={`dep-${ver}`} connId={connId} owner={owner} name={name} type={type} />
        ) : sub === 'Partizioni' ? (
          <PartitionsTab key={`part-${ver}`} connId={connId} owner={owner} name={name} />
        ) : (
          <GridTab key={`${sub}-${ver}`} loader={loaders[sub]} />
        )}
      </div>

      {dlg === 'edittable' && (
        <TableEditDialog
          connId={connId}
          owner={owner}
          table={name}
          onClose={() => setDlg(null)}
          onDone={(renamedTo) => (renamedTo ? renamed(renamedTo) : done())}
        />
      )}
      {dlg === 'editview' && (
        <ObjectCreateDialog type="VIEW" mode="edit" name={name} connId={connId} owner={owner} onClose={() => setDlg(null)} onDone={done} />
      )}
      {dlg === 'altseq' && (
        <ObjectCreateDialog type="SEQUENCE" mode="alter" name={name} connId={connId} owner={owner} onClose={() => setDlg(null)} onDone={done} />
      )}
    </div>
  );
}
