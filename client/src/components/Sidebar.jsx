import React, { useMemo, useState } from 'react';
import {
  ChevronRight,
  GitCompare,
  History,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Unplug,
  Upload,
} from 'lucide-react';
import { useStore } from '../store.js';
import { api } from '../api.js';
import ObjectTree from './ObjectTree.jsx';
import ConnectionModal from './ConnectionModal.jsx';
import ImportConnectionsModal from './ImportConnectionsModal.jsx';
import ContextMenu from './ContextMenu.jsx';

function statusInfo(active) {
  const status = active?.status;
  if (status === 'connecting') return { cls: 'connecting', label: 'Connessione in corso…' };
  if (status === 'connected') return { cls: 'connected', label: 'Connesso' };
  if (status === 'error') {
    return { cls: 'error', label: active.error ? `Errore di connessione: ${active.error}` : 'Errore di connessione' };
  }
  return { cls: 'idle', label: 'Non connesso — doppio click per connettersi' };
}

function ConnectionRow({ conn, groups }) {
  const active = useStore((s) => s.active[conn.id]);
  const { connect, disconnect, openWorksheet, refreshConnections, toast } = useStore.getState();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState(null);
  const connected = active?.status === 'connected';
  const connecting = active?.status === 'connecting';
  const status = statusInfo(active);
  const current = conn.group?.trim() || '';

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

  const moveTo = async (group) => {
    if (group === current) return;
    try {
      await api.updateConnection(conn.id, { group });
      await refreshConnections();
      toast(group ? `"${conn.name}" spostata in ${group}` : `"${conn.name}" rimossa dal gruppo`, 'ok');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const menuItems = [
    ...(connected
      ? [
          { label: 'Nuovo foglio SQL', onClick: () => openWorksheet(conn.id) },
          { label: 'Disconnetti', onClick: () => disconnect(conn.id) },
        ]
      : [{ label: 'Connetti', disabled: connecting, onClick: () => connect(conn.id) }]),
    { separator: true },
    {
      label: 'Sposta in…',
      submenu: [
        ...groups.map((g) => ({ label: g, checked: g === current, onClick: () => moveTo(g) })),
        ...(groups.length ? [{ separator: true }] : []),
        { label: 'Senza gruppo', checked: !current, onClick: () => moveTo('') },
        { input: true, placeholder: 'Nuovo gruppo…', autoFocus: false, onSubmit: (g) => moveTo(g) },
      ],
    },
    { label: 'Modifica…', onClick: () => setEditing(true) },
    { separator: true },
    { label: 'Elimina…', danger: true, onClick: remove },
  ];

  return (
    <div className={`conn-block ${connected ? 'connected' : ''}`}>
      <div
        className="conn-row"
        onClick={() => connected && setExpanded((e) => !e)}
        onDoubleClick={() => !connected && !connecting && connect(conn.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
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
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
    </div>
  );
}

// Colore stabile per gruppo (dal nome): serve a distinguerli a colpo d'occhio.
const GROUP_HUES = [12, 200, 145, 275, 45, 330, 95, 240];
function groupHue(title) {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) >>> 0;
  return GROUP_HUES[h % GROUP_HUES.length];
}

function ConnGroup({ title, items, collapsed, onToggle, groups, plain }) {
  const hue = plain ? null : groupHue(title);
  return (
    <div
      className={`conn-group ${collapsed ? 'collapsed' : ''} ${plain ? 'plain' : ''}`}
      style={hue == null ? undefined : { '--group-hue': hue }}
    >
      <button className="conn-group-head" onClick={onToggle}>
        <span className={`tree-arrow ${collapsed ? '' : 'open'}`}>
          <ChevronRight size={12} />
        </span>
        <span className="conn-group-title">{title}</span>
        <span className="conn-group-count">{items.length}</span>
      </button>
      {!collapsed && (
        <div className="conn-group-body">
          {items.map((c) => (
            <ConnectionRow key={c.id} conn={c} groups={groups} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function Sidebar() {
  const conns = useStore((s) => s.conns);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [collapsed, setCollapsed] = useState({});
  const [search, setSearch] = useState('');
  const openHistory = useStore((s) => s.openHistory);
  const openDiff = useStore((s) => s.openDiff);
  const width = useStore((s) => s.ui.sidebarWidth);
  const toggleUi = useStore((s) => s.toggleUi);

  const searching = !!search.trim();

  const filteredConns = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conns;
    return conns.filter((c) => {
      const service = c.serviceType === 'custom' ? c.service : `${c.host}:${c.port}/${c.service}`;
      return [c.name, c.group, c.user, service].some((v) => v?.toLowerCase().includes(q));
    });
  }, [conns, search]);

  // Elenco dei gruppi esistenti, per la voce "Sposta in…" del menu di contesto.
  const groupNames = useMemo(
    () => [...new Set(conns.map((c) => c.group?.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [conns]
  );

  const groups = useMemo(() => {
    const map = new Map();
    for (const c of filteredConns) {
      const key = c.group?.trim() || '';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(c);
    }
    const named = [...map.keys()].filter(Boolean).sort((a, b) => a.localeCompare(b));
    const keys = map.has('') ? [...named, ''] : named;
    return keys.map((key) => ({ key: key || '__none__', title: key || 'Senza gruppo', items: map.get(key) }));
  }, [filteredConns]);

  const toggleGroup = (key) => setCollapsed((s) => ({ ...s, [key]: !s[key] }));

  return (
    <aside className="sidebar" style={{ width, minWidth: width }}>
      <div className="sidebar-head">
        <span className="logo">
          <span className="logo-ora">Ora</span>bridge
        </span>
        <button
          className="icon-btn"
          title="Assistente AI (Ctrl+Alt+I)"
          onClick={() => toggleUi('ai')}
        >
          <Sparkles size={14} />
        </button>
        <button className="icon-btn" title="DB Diff — confronta due database" onClick={openDiff}>
          <GitCompare size={14} />
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
      {!!conns.length && (
        <div className="sidebar-search">
          <Search size={13} className="sidebar-search-icon" />
          <input
            className="sidebar-search-input"
            placeholder="Cerca connessioni…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}
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
        {!!conns.length && searching && !filteredConns.length && (
          <div className="conn-group-empty">Nessuna connessione trovata</div>
        )}
        {groups.map((g) => (
          <ConnGroup
            key={g.key}
            title={g.title}
            items={g.items}
            groups={groupNames}
            plain={g.key === '__none__'}
            collapsed={!searching && !!collapsed[g.key]}
            onToggle={() => toggleGroup(g.key)}
          />
        ))}
      </div>
      {creating && <ConnectionModal onClose={() => setCreating(false)} />}
      {importing && <ImportConnectionsModal onClose={() => setImporting(false)} />}
    </aside>
  );
}
