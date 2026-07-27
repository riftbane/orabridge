import React, { useState } from 'react';
import { History, Pencil, Plus, Power, Trash2 } from 'lucide-react';
import { useStore } from '../store.js';
import { api } from '../api.js';
import ObjectTree from './ObjectTree.jsx';
import ConnectionModal from './ConnectionModal.jsx';

function ConnectionRow({ conn }) {
  const active = useStore((s) => s.active[conn.id]);
  const { connect, disconnect, openWorksheet, refreshConnections, toast } = useStore.getState();
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const connected = active?.status === 'connected';
  const connecting = active?.status === 'connecting';

  const remove = async () => {
    if (!window.confirm(`Eliminare la connessione "${conn.name}"?`)) return;
    try {
      await api.deleteConnection(conn.id);
      await refreshConnections();
      toast('Connessione eliminata', 'ok');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <div className={`conn-block ${connected ? 'connected' : ''}`}>
      <div className="conn-row" onClick={() => connected && setExpanded((e) => !e)}>
        <span className="conn-dot" style={{ background: conn.color }} />
        <div className="conn-names">
          <span className="conn-name">{conn.name}</span>
          <span className="conn-sub">
            {conn.user}@{conn.serviceType === 'custom' ? conn.service : `${conn.host}:${conn.port}/${conn.service}`}
          </span>
        </div>
        <div className="conn-actions" onClick={(e) => e.stopPropagation()}>
          {connected && (
            <button
              className="icon-btn"
              title="Nuovo foglio SQL"
              onClick={() => openWorksheet(conn.id)}
            >
              <Plus size={14} />
            </button>
          )}
          <button
            className={`icon-btn plug ${connected ? 'on' : ''}`}
            title={connected ? 'Disconnetti' : 'Connetti'}
            disabled={connecting}
            onClick={() => (connected ? disconnect(conn.id) : connect(conn.id))}
          >
            {connecting ? '…' : <Power size={14} />}
          </button>
          <button className="icon-btn" title="Modifica" onClick={() => setEditing(true)}>
            <Pencil size={13} />
          </button>
          <button className="icon-btn danger" title="Elimina" onClick={remove}>
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      {connected && active.txnOpen && (
        <div className="txn-badge" title="Transazione aperta (commit/rollback dal foglio SQL)">
          <span className="txn-dot" />
          transazione aperta
        </div>
      )}
      {connected && expanded && <ObjectTree connId={conn.id} />}
      {editing && <ConnectionModal conn={conn} onClose={() => setEditing(false)} />}
    </div>
  );
}

export default function Sidebar() {
  const conns = useStore((s) => s.conns);
  const [creating, setCreating] = useState(false);
  const openHistory = useStore((s) => s.openHistory);

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span className="logo">
          <span className="logo-ora">Ora</span>bridge
        </span>
        <button className="icon-btn" title="Cronologia query" onClick={() => openHistory(null)}>
          <History size={14} />
        </button>
        <button className="icon-btn add-conn" title="Nuova connessione" onClick={() => setCreating(true)}>
          <Plus size={16} />
        </button>
      </div>
      <div className="conn-list">
        {!conns.length && (
          <div className="empty-conns">
            Nessuna connessione.
            <button className="btn primary" onClick={() => setCreating(true)}>
              Crea la prima
            </button>
          </div>
        )}
        {conns.map((c) => (
          <ConnectionRow key={c.id} conn={c} />
        ))}
      </div>
      {creating && <ConnectionModal onClose={() => setCreating(false)} />}
    </aside>
  );
}
