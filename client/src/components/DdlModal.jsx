import React, { useEffect, useState } from 'react';
import { AlertTriangle, X, XCircle } from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.js';

// Generic modal for guided DDL: form (children) + live SQL preview + execute.
// Statements run sequentially on the worksheet session; DDL autocommits.
export default function DdlModal({
  title,
  connId,
  statements,
  valid = true,
  execLabel = 'Esegui',
  danger = false,
  wide = false,
  extraClass = '',
  onClose,
  onDone,
  children,
}) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const toast = useStore((s) => s.toast);
  const txnOpen = useStore((s) => s.active[connId]?.txnOpen);

  const preview = statements
    .map((s) => (/;\s*$/.test(s) ? s.trimEnd() + '\n/' : s.trimEnd() + ';'))
    .join('\n\n');

  const run = async () => {
    if (!statements.length || running) return;
    setRunning(true);
    setError(null);
    try {
      for (const sql of statements) {
        const r = await api.execute(connId, { sql });
        if (r.txnOpen != null) useStore.getState().setTxnOpen(connId, r.txnOpen);
        if (r.error) throw new Error(r.error.message);
      }
      toast('Operazione completata', 'ok');
      onDone?.();
      onClose();
    } catch (err) {
      setError(err.message);
      if (err.status === 409) useStore.getState().markDisconnected(connId);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className={`modal ddl-modal ${wide ? 'wide' : ''} ${extraClass}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span>{title}</span>
          <button className="icon-btn" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="modal-body">
          {children}
          <div className="sql-preview">
            <div className="sql-preview-head">SQL generato</div>
            <pre>{statements.length ? preview : '-- compila i campi del modulo'}</pre>
          </div>
          {txnOpen && (
            <div className="test-result err">
              <AlertTriangle size={15} />
              <span>
                C'è una transazione aperta sul foglio SQL: le istruzioni DDL eseguono anche il
                COMMIT implicito delle modifiche pendenti.
              </span>
            </div>
          )}
          {error && (
            <div className="test-result err">
              <XCircle size={15} />
              <span>{error}</span>
            </div>
          )}
        </div>
        <div className="modal-foot">
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Annulla</button>
          <button
            className={`btn ${danger ? 'danger' : 'primary'}`}
            disabled={running || !valid || !statements.length}
            onClick={run}
          >
            {running ? 'Esecuzione…' : execLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// Ordered multi-select of the columns of owner.table (click order = position).
export function ColumnPicker({ connId, owner, table, value, onChange }) {
  const [cols, setCols] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setCols(null);
    setFailed(false);
    if (!table?.trim()) return undefined;
    api
      .tableColumns(connId, owner, table.trim())
      .then((r) => {
        if (!alive) return;
        const names = (r.rows || []).map((row) => row[1]);
        if (names.length) setCols(names);
        else setFailed(true);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [connId, owner, table]);

  if (!table?.trim()) return <div className="tree-info">Indica prima la tabella</div>;
  if (failed)
    return (
      <input
        placeholder="colonne separate da virgola…"
        value={value.join(', ')}
        onChange={(e) => onChange(e.target.value.split(',').map((c) => c.trim()).filter(Boolean))}
      />
    );
  if (!cols) return <div className="tree-info">Caricamento colonne…</div>;

  const toggle = (c) =>
    onChange(value.includes(c) ? value.filter((x) => x !== c) : [...value, c]);

  return (
    <div className="col-picker">
      {cols.map((c) => {
        const idx = value.indexOf(c);
        return (
          <button
            key={c}
            type="button"
            className={`col-chip ${idx >= 0 ? 'on' : ''}`}
            onClick={() => toggle(c)}
          >
            {idx >= 0 && <span className="ord">{idx + 1}</span>}
            {c}
          </button>
        );
      })}
    </div>
  );
}
