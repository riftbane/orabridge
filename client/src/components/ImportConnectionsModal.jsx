import React, { useMemo, useRef, useState } from 'react';
import { FileJson, Lock, TriangleAlert, Upload, X } from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.js';

export default function ImportConnectionsModal({ onClose }) {
  const [fileName, setFileName] = useState('');
  const [content, setContent] = useState('');
  const [rows, setRows] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [group, setGroup] = useState('');
  const [key, setKey] = useState('');
  const [keyVerify, setKeyVerify] = useState('');
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  const conns = useStore((s) => s.conns);
  const refreshConnections = useStore((s) => s.refreshConnections);
  const toast = useStore((s) => s.toast);

  const groupOptions = useMemo(
    () => [...new Set(conns.map((c) => c.group).filter((g) => g?.trim()))].sort((a, b) => a.localeCompare(b)),
    [conns]
  );

  const needsKey = !!rows?.some((r) => r.hasPassword);
  const keyMismatch = needsKey && keyVerify.length > 0 && key !== keyVerify;

  const pickFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setLoading(true);
    setRows(null);
    setSelected(new Set());
    try {
      const text = await file.text();
      const res = await api.previewImportConnections(text);
      setContent(text);
      setFileName(file.name);
      setRows(res.connections);
      setSelected(new Set(res.connections.map((_, i) => i)));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggle = (i) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((s) => (s.size === rows.length ? new Set() : new Set(rows.map((_, i) => i))));
  };

  const doImport = async () => {
    if (!selected.size) {
      toast('Seleziona almeno una connessione', 'error');
      return;
    }
    if (needsKey && !key) {
      toast('Inserisci la chiave di cifratura', 'error');
      return;
    }
    if (keyMismatch) {
      toast('Le due chiavi non coincidono', 'error');
      return;
    }
    setImporting(true);
    setError('');
    try {
      const res = await api.importConnections({
        content,
        key: needsKey ? key : undefined,
        group: group || undefined,
        selected: [...selected],
      });
      await refreshConnections();
      toast(`Importate ${res.created.length} connessioni`, 'ok');
      if (res.warnings?.length) {
        toast(`${res.warnings.length} da controllare: vedi le icone di avviso nell'anteprima`, 'info');
      }
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal import-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>Importa connessioni</span>
          <button className="icon-btn" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="modal-body">
          <label>
            File di export (SQL Developer, .json)
            <div className="import-file-row">
              <button className="btn" onClick={() => fileRef.current?.click()}>
                <Upload size={13} /> Scegli file…
              </button>
              <span className="import-file-name">{fileName || 'Nessun file selezionato'}</span>
              <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={pickFile} />
            </div>
          </label>

          {loading && <div className="grid-empty">Analisi del file…</div>}
          {error && (
            <div className="test-result err">
              <TriangleAlert size={15} />
              <span>{error}</span>
            </div>
          )}

          {rows && !loading && (
            <>
              <div className="import-summary">
                <FileJson size={13} /> {rows.length} connessioni trovate
              </div>

              {needsKey && (
                <div className="form-row">
                  <label style={{ flex: 1 }}>
                    Chiave di cifratura
                    <input
                      type="password"
                      value={key}
                      onChange={(e) => setKey(e.target.value)}
                      autoFocus
                    />
                  </label>
                  <label style={{ flex: 1 }}>
                    Verifica chiave
                    <input type="password" value={keyVerify} onChange={(e) => setKeyVerify(e.target.value)} />
                  </label>
                </div>
              )}
              {keyMismatch && (
                <div className="test-result err">
                  <TriangleAlert size={15} />
                  <span>Le due chiavi non coincidono</span>
                </div>
              )}

              <label>
                Gruppo (applicato a tutte le connessioni importate)
                <input
                  value={group}
                  onChange={(e) => setGroup(e.target.value)}
                  list="import-group-options"
                  placeholder="opzionale"
                />
                <datalist id="import-group-options">
                  {groupOptions.map((g) => (
                    <option key={g} value={g} />
                  ))}
                </datalist>
              </label>

              <div className="import-table">
                <div className="import-row import-head">
                  <input type="checkbox" checked={selected.size === rows.length} onChange={toggleAll} />
                  <span>Nome</span>
                  <span>Utente</span>
                  <span>Connessione</span>
                  <span />
                </div>
                {rows.map((r, i) => (
                  <div className="import-row" key={i}>
                    <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} />
                    <span className="import-name" title={r.name}>{r.name}</span>
                    <span title={r.user}>{r.user}</span>
                    <span className="import-conn" title={r.serviceType === 'custom' ? r.service : `${r.host}:${r.port}/${r.service}`}>
                      {r.serviceType === 'custom' ? r.service : `${r.host}:${r.port}/${r.service}`}
                    </span>
                    <span className="import-flags">
                      {r.hasPassword && <Lock size={12} title="Password cifrata" />}
                      {r.warning && <TriangleAlert size={12} title={r.warning} />}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Annulla</button>
          <div style={{ flex: 1 }} />
          <button
            className="btn primary"
            onClick={doImport}
            disabled={!rows || importing || !selected.size || keyMismatch}
          >
            {importing ? 'Importazione…' : `Importa${selected.size ? ` (${selected.size})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
