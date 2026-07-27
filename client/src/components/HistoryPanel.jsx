import React, { useEffect, useState } from 'react';
import { CheckCircle2, History, RefreshCw, Trash2, XCircle } from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.js';

function formatTs(ts) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : d.toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function firstLine(sql) {
  const l = sql.trim().split('\n')[0];
  return l.length > 140 ? l.slice(0, 140) + '…' : l;
}

function HistoryRow({ entry, conn, expanded, onToggle, onDeleted }) {
  const { toast, openWorksheet } = useStore.getState();
  const multiline = entry.sql.includes('\n');

  const copy = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(entry.sql).then(
      () => toast('Copiato negli appunti', 'ok'),
      () => toast('Copia non riuscita', 'error')
    );
  };

  const openInWorksheet = (e) => {
    e.stopPropagation();
    if (!conn) {
      toast('Connessione non più disponibile', 'error');
      return;
    }
    openWorksheet(conn.id, entry.sql);
  };

  const remove = async (e) => {
    e.stopPropagation();
    try {
      await api.deleteHistoryEntry(entry.id);
      onDeleted(entry.id);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <div
      className={`history-row ${entry.ok ? '' : 'err'} ${multiline ? 'expandable' : ''}`}
      onClick={multiline ? onToggle : undefined}
    >
      <span className={`history-badge ${entry.ok ? 'ok' : 'err'}`}>
        {entry.ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
      </span>
      <span className="history-ts">{formatTs(entry.ts)}</span>
      <span className="conn-dot" title={conn?.name || entry.connId} />
      <span className="history-sql" title={expanded ? undefined : entry.sql}>
        {expanded ? <pre>{entry.sql}</pre> : firstLine(entry.sql)}
        {!entry.ok && entry.errorMessage && <div className="history-err-msg">{entry.errorMessage}</div>}
      </span>
      <span className="history-meta">
        {entry.ok
          ? entry.rows != null
            ? `${entry.rows} righe`
            : entry.rowsAffected != null
              ? `${entry.rowsAffected} interessate`
              : ''
          : ''}
        {entry.elapsedMs != null && ` · ${entry.elapsedMs} ms`}
      </span>
      <span className="history-actions" onClick={(e) => e.stopPropagation()}>
        <button className="mini-btn" onClick={copy} title="Copia SQL">Copia</button>
        <button className="mini-btn" onClick={openInWorksheet} title="Apri in un nuovo foglio">Apri</button>
        <button className="icon-btn danger" onClick={remove} title="Elimina questa voce"><Trash2 size={13} /></button>
      </span>
    </div>
  );
}

export default function HistoryPanel() {
  const conns = useStore((s) => s.conns);
  const filterConnId = useStore((s) => s.historyFilterConnId);
  const toast = useStore((s) => s.toast);

  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setQuery(queryInput), 300);
    return () => clearTimeout(t);
  }, [queryInput]);

  const load = () => {
    api
      .history({ connId: filterConnId || undefined, q: query || undefined, limit: 300 })
      .then(setEntries)
      .catch((err) => toast(err.message, 'error'));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterConnId, query]);

  const clear = async () => {
    const label = filterConnId
      ? `Cancellare la cronologia della connessione selezionata?`
      : 'Cancellare tutta la cronologia di tutte le connessioni?';
    if (!window.confirm(label)) return;
    try {
      await api.clearHistory(filterConnId || undefined);
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <div className="history-panel">
      <div className="obj-head">
        <span className="obj-title">
          <History size={14} /> Cronologia query
        </span>
        <div style={{ flex: 1 }} />
        <input
          className="history-search"
          placeholder="Cerca nel testo SQL…"
          value={queryInput}
          onChange={(e) => setQueryInput(e.target.value)}
        />
        <select
          value={filterConnId || ''}
          onChange={(e) => useStore.getState().setHistoryFilter(e.target.value || null)}
        >
          <option value="">Tutte le connessioni</option>
          {conns.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <button className="btn" onClick={load} title="Aggiorna"><RefreshCw size={13} /></button>
        <button className="btn danger" onClick={clear} title="Cancella cronologia"><Trash2 size={13} /> Cancella</button>
      </div>
      <div className="history-list">
        {entries === null && <div className="grid-empty">Caricamento…</div>}
        {entries?.length === 0 && (
          <div className="grid-empty">
            {query || filterConnId ? 'Nessuna voce corrisponde ai filtri' : 'Nessuna query eseguita finora'}
          </div>
        )}
        {entries?.map((e) => (
          <HistoryRow
            key={e.id}
            entry={e}
            conn={conns.find((c) => c.id === e.connId)}
            expanded={expandedId === e.id}
            onToggle={() => setExpandedId((cur) => (cur === e.id ? null : e.id))}
            onDeleted={(id) => setEntries((cur) => cur.filter((x) => x.id !== id))}
          />
        ))}
      </div>
    </div>
  );
}
