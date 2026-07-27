import React, { useMemo, useState } from 'react';
import { ChevronRight, History, Info, Pencil, Plus, Trash2, Unplug, Upload } from 'lucide-react';
import { useStore } from '../store.js';
import { api } from '../api.js';
import ObjectTree from './ObjectTree.jsx';
import ConnectionModal from './ConnectionModal.jsx';
import ImportConnectionsModal from './ImportConnectionsModal.jsx';
import AboutModal from './AboutModal.jsx';

function statusInfo(active) {
  const status = active?.status;
  if (status === 'connecting') return { cls: 'connecting', label: 'Connessione in corso…' };
  if (status === 'connected') return { cls: 'connected', label: 'Connesso' };
  if (status === 'error') {
    return { cls: 'error', label: active.error ? `Errore di connessione: ${active.error}` : 'Errore di connessione' };
  }
  return { cls: 'idle', label: 'Non connesso — doppio click per connettersi' };
}

function ConnectionRow({ conn }) {
  const active = useStore((s) => s.active[conn.id]);
  const { connect, disconnect, openWorksheet, refreshConnections, toast } = useStore.getState();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const connected = active?.status === 'connected';
  const connecting = active?.status === 'connecting';
  const status = statusInfo(active);

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
      <div
        className="conn-row"
        onClick={() => connected && setExpanded((e) => !e)}
        onDoubleClick={() => !connected && !connecting && connect(conn.id)}
      >
        <span className={`conn-dot status-${status.cls}`} title={status.label} />
        <div className="conn-names">
          <span className="conn-name">{conn.name}</span>
          <span className="conn-sub">
            {conn.user}@{conn.serviceType === 'custom' ? conn.service : `${conn.host}:${conn.port}/${conn.service}`}
          </span>
        </div>
        <div
          className="conn-actions"
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {connected && (
            <button
              className="icon-btn"
              title="Nuovo foglio SQL"
              onClick={() => openWorksheet(conn.id)}
            >
              <Plus size={14} />
            </button>
          )}
          {connected && (
            <button className="icon-btn" title="Disconnetti" onClick={() => disconnect(conn.id)}>
              <Unplug size={13} />
            </button>
          )}
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

function ConnGroup({ title, items, collapsed, onToggle, emptyLabel }) {
  return (
    <div className="conn-group">
      <button className="conn-group-head" onClick={onToggle}>
        <span className={`tree-arrow ${collapsed ? '' : 'open'}`}>
          <ChevronRight size={12} />
        </span>
        <span className="conn-group-title">{title}</span>
        <span className="conn-group-count">{items.length}</span>
      </button>
      {!collapsed &&
        (items.length ? (
          items.map((c) => <ConnectionRow key={c.id} conn={c} />)
        ) : (
          emptyLabel && <div className="conn-group-empty">{emptyLabel}</div>
        ))}
    </div>
  );
}

export default function Sidebar() {
  const conns = useStore((s) => s.conns);
  const active = useStore((s) => s.active);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [collapsed, setCollapsed] = useState({});
  const openHistory = useStore((s) => s.openHistory);

  const activeConns = useMemo(
    () => conns.filter((c) => active[c.id]?.status === 'connected'),
    [conns, active]
  );

  const groups = useMemo(() => {
    const map = new Map();
    for (const c of conns) {
      const key = c.group?.trim() || '';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(c);
    }
    const named = [...map.keys()].filter(Boolean).sort((a, b) => a.localeCompare(b));
    const keys = map.has('') ? [...named, ''] : named;
    return keys.map((key) => ({ key: key || '__none__', title: key || 'Senza gruppo', items: map.get(key) }));
  }, [conns]);

  const toggleGroup = (key) => setCollapsed((s) => ({ ...s, [key]: !s[key] }));

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span className="logo">
          <span className="logo-ora">Ora</span>bridge
        </span>
        <button className="icon-btn" title="Informazioni su Orabridge" onClick={() => setAboutOpen(true)}>
          <Info size={14} />
        </button>
        <button className="icon-btn" title="Cronologia query" onClick={() => openHistory(null)}>
          <History size={14} />
        </button>
        <button className="icon-btn" title="Importa connessioni" onClick={() => setImporting(true)}>
          <Upload size={14} />
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
            <button className="btn" onClick={() => setImporting(true)}>
              Importa da file
            </button>
          </div>
        )}
        {!!conns.length && (
          <ConnGroup
            title="Attivi"
            items={activeConns}
            collapsed={!!collapsed.__active__}
            onToggle={() => toggleGroup('__active__')}
            emptyLabel="Nessuna connessione attiva"
          />
        )}
        {groups.map((g) => (
          <ConnGroup
            key={g.key}
            title={g.title}
            items={g.items}
            collapsed={!!collapsed[g.key]}
            onToggle={() => toggleGroup(g.key)}
          />
        ))}
      </div>
      {creating && <ConnectionModal onClose={() => setCreating(false)} />}
      {importing && <ImportConnectionsModal onClose={() => setImporting(false)} />}
      {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
    </aside>
  );
}
