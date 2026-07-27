import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Hammer, Pencil, RefreshCw } from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.js';
import Grid, { exportCsv } from './Grid.jsx';
import Editor from './Editor.jsx';
import { TypeIcon } from './ObjectTree.jsx';
import ObjectCreateDialog from './ObjectDialogs.jsx';
import TableEditDialog from './TableDialogs.jsx';
import { buildCellUpdateSql } from '../ddl.js';

const SOURCE_TYPES = new Set(['PROCEDURE', 'FUNCTION', 'PACKAGE', 'PACKAGE BODY', 'TRIGGER', 'TYPE']);

function subtabsFor(type) {
  if (type === 'TABLE' || type === 'MATERIALIZED VIEW')
    return ['Colonne', 'Dati', 'Vincoli', 'Indici', 'Trigger', 'DDL'];
  if (type === 'VIEW') return ['Colonne', 'Dati', 'DDL'];
  if (SOURCE_TYPES.has(type)) return ['Sorgente', 'DDL'];
  if (type === 'SEQUENCE' || type === 'SYNONYM' || type === 'INDEX') return ['Dettagli', 'DDL'];
  return ['DDL'];
}

function DataTab({ tab }) {
  const [where, setWhere] = useState('');
  const [data, setData] = useState(null);
  const [count, setCount] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dirtyResetSeq, setDirtyResetSeq] = useState(0);
  const toast = useStore((s) => s.toast);
  const txnOpen = useStore((s) => s.active[tab.connId]?.txnOpen);
  const PAGE = 200;
  // Inline editing (double-click a cell) needs a ROWID per row to target the
  // UPDATE; only real tables have a stable one, so it's opt-in per object type.
  const editable = tab.type === 'TABLE';

  const load = useCallback(
    async (offset = 0, append = false) => {
      setLoading(true);
      try {
        const r = await api.tableData(tab.connId, {
          owner: tab.owner,
          name: tab.name,
          offset,
          limit: PAGE,
          where,
          rowid: editable ? 1 : undefined,
        });
        if (r.error) {
          toast(r.error, 'error');
          return;
        }
        setData((prev) =>
          append && prev
            ? { ...r, rows: [...prev.rows, ...r.rows], rowids: [...(prev.rowids || []), ...(r.rowids || [])] }
            : r
        );
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        setLoading(false);
      }
    },
    [tab.connId, tab.owner, tab.name, where, editable, toast]
  );

  useEffect(() => {
    load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doCount = async () => {
    const r = await api.tableCount(tab.connId, { owner: tab.owner, name: tab.name, where });
    if (r.error) toast(r.error, 'error');
    else setCount(r.count);
  };

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
        const r = await api.execute(tab.connId, { sql });
        if (r.txnOpen != null) useStore.getState().setTxnOpen(tab.connId, r.txnOpen);
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
    [data, tab.connId, tab.owner, tab.name, toast]
  );

  const doCommit = async () => {
    try {
      await api.commit(tab.connId);
      useStore.getState().setTxnOpen(tab.connId, false);
      setDirtyResetSeq((n) => n + 1);
      toast('Commit eseguito', 'ok');
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
        <div style={{ flex: 1 }} />
        {data && (
          <span className="pane-info">
            {data.rows.length} righe{data.truncated ? '+' : ''}
            {count != null && ` / ${count} totali`}
          </span>
        )}
        {data?.truncated && (
          <button className="btn" onClick={() => load(data.offset + PAGE, true)} disabled={loading}>
            Carica altre
          </button>
        )}
        <button className="mini-btn" onClick={doCount}>
          Conta
        </button>
        {data && (
          <button
            className="mini-btn"
            onClick={() => exportCsv(data.columns, data.rows, `${tab.name}.csv`)}
          >
            CSV
          </button>
        )}
      </div>
      {data ? (
        <Grid
          columns={data.columns}
          rows={data.rows}
          editable={editable}
          rowIds={data.rowids}
          onCellEdit={onCellEdit}
          dirtyResetKey={dirtyResetSeq}
        />
      ) : (
        <div className="grid-empty">{loading ? 'Caricamento…' : 'Nessun dato'}</div>
      )}
    </div>
  );
}

function GridTab({ loader }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let alive = true;
    loader()
      .then((r) => alive && setData(r))
      .catch((e) => alive && setErr(e.message));
    return () => {
      alive = false;
    };
  }, [loader]);
  if (err) return <div className="grid-empty error">{err}</div>;
  if (!data) return <div className="grid-empty">Caricamento…</div>;
  if (data.error) return <div className="grid-empty error">{data.error}</div>;
  return <Grid columns={data.columns} rows={data.rows} />;
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
  if (err) return <div className="grid-empty error">{err}</div>;
  if (text == null) return <div className="grid-empty">Caricamento…</div>;
  return (
    <div className="code-view">
      <Editor value={text} readOnly />
    </div>
  );
}

// Editable PL/SQL source with compile (CREATE OR REPLACE) + errors from ALL_ERRORS.
function SourceTab({ tab }) {
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

  const compile = async () => {
    const sqlText = draft.current.trim();
    if (!sqlText || busy) return;
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

  if (loadErr) return <div className="grid-empty error">{loadErr}</div>;
  if (text == null) return <div className="grid-empty">Caricamento…</div>;

  return (
    <div className="code-view">
      <div className="obj-toolbar">
        <button className="btn run" onClick={compile} disabled={busy} title="Compila (Ctrl+Invio)">
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

export default function ObjectDetail({ tab }) {
  const active = useStore((s) => s.active[tab.connId]);
  const connect = useStore((s) => s.connect);
  const subtabs = subtabsFor(tab.type);
  const [sub, setSub] = useState(subtabs[0]);
  const [dlg, setDlg] = useState(null);
  const [ver, setVer] = useState(0);
  const connected = active?.status === 'connected';

  const { connId, owner, name, type } = tab;

  const loaders = {
    Colonne: useCallback(() => api.tableColumns(connId, owner, name), [connId, owner, name]),
    Vincoli: useCallback(() => api.tableConstraints(connId, owner, name), [connId, owner, name]),
    Indici: useCallback(() => api.tableIndexes(connId, owner, name), [connId, owner, name]),
    Trigger: useCallback(() => api.tableTriggers(connId, owner, name), [connId, owner, name]),
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

  return (
    <div className="object-detail">
      <div className="obj-head">
        <TypeIcon type={type} />
        <span className="obj-title">
          {owner}.{name}
        </span>
        <span className="obj-type">{type}</span>
        <div style={{ flex: 1 }} />
        {type === 'VIEW' && (
          <button className="btn" onClick={() => setDlg('editview')}>
            <Pencil size={13} /> Modifica vista
          </button>
        )}
        {type === 'SEQUENCE' && (
          <button className="btn" onClick={() => setDlg('altseq')}>
            <Pencil size={13} /> Modifica sequenza
          </button>
        )}
        {isTable && (
          <button className="btn" onClick={() => setDlg('edittable')}>
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
          <DataTab tab={tab} />
        ) : sub === 'Sorgente' ? (
          <SourceTab key={`src-${ver}`} tab={tab} />
        ) : sub === 'DDL' ? (
          <CodeTab key={`ddl-${ver}`} loader={loaders.DDL} />
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
