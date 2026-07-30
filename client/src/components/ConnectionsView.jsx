import React, { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Pencil, Plug, Plus, Search, Trash2, Unplug, Upload } from 'lucide-react';
import { useStore } from '../store.js';
import { api } from '../api.js';
import ObjectTree from './ObjectTree.jsx';
import ConnectionModal from './ConnectionModal.jsx';
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

// «poco fa», per l'ultima cosa letta da Copilot: la riga della barra laterale
// deve dire da quanto, non a che ora.
function since(at) {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 5) return 'adesso';
  if (s < 60) return `${s} s fa`;
  if (s < 3600) return `${Math.round(s / 60)} min fa`;
  return `${Math.round(s / 3600)} h fa`;
}

// Attività MCP di una connessione: mentre Copilot legge, e per qualche minuto
// dopo. Passato quel tempo la riga sparisce da sola — è un indicatore di
// «adesso», non una cronologia (quella è nelle impostazioni).
const RECENT_MS = 5 * 60 * 1000;

// Nella barra laterale c'è spazio per poche parole: il nome dello strumento
// dice già tutto, gli altri fatti hanno bisogno di essere tradotti.
const KIND_LABEL = { open: 'collegamento aperto', denied: 'richiesta rifiutata', error: 'errore' };
const whatHappened = (entry) => entry.tool || KIND_LABEL[entry.kind] || entry.kind;

function McpRowActivity({ connId }) {
  const busy = useStore((s) => s.mcpBusy[connId] || 0);
  const last = useStore((s) => s.mcpLast[connId]);
  // Senza un tick, «12 s fa» resterebbe «12 s fa» finché non cambia altro.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!last) return undefined;
    const t = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, [last]);

  if (!last) return null;
  if (!busy && Date.now() - last.at > RECENT_MS) return null;

  const failed = !busy && (last.ok === false || last.kind === 'denied' || last.kind === 'error');
  return (
    <div
      className={`mcp-activity ${busy ? 'busy' : ''} ${failed ? 'failed' : ''}`}
      title={
        failed ? last.error : `${whatHappened(last)} — ${new Date(last.at).toLocaleTimeString()}`
      }
    >
      <span className="mcp-activity-dot" />
      {busy
        ? `Copilot sta leggendo${last.tool ? ` — ${last.tool}` : ''}`
        : `Copilot: ${whatHappened(last)}${failed && last.ok === false ? ' non riuscito' : ''} · ${since(last.at)}`}
    </div>
  );
}

function ConnectionRow({ conn, groups }) {
  const active = useStore((s) => s.active[conn.id]);
  const selected = useStore((s) => s.selectedConnId === conn.id);
  const mcpBusy = useStore((s) => !!s.mcpBusy[conn.id]);
  const { connect, disconnect, openWorksheet, refreshConnections, toast } = useStore.getState();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState(null);
  const connected = active?.status === 'connected';
  const connecting = active?.status === 'connecting';
  const status = statusInfo(active);
  const current = conn.group?.trim() || '';
  const mcpOn = !!conn.mcp?.enabled;

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

  // Porta la connessione nelle viste dedicate della barra laterale.
  const showIn = (view) => {
    const st = useStore.getState();
    st.selectConnection(conn.id);
    st.openSidebarView(view);
  };

  // Esporre (o togliere) una connessione da Copilot senza passare dalla
  // finestra di modifica: è un interruttore, e si usa spesso da qui.
  const toggleMcp = async () => {
    try {
      await api.setConnectionMcp(conn.id, { enabled: !mcpOn });
      await refreshConnections();
      toast(mcpOn ? `"${conn.name}" non è più esposta a Copilot` : `"${conn.name}" esposta a Copilot`, 'ok');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const menuItems = [
    ...(connected
      ? [
          { label: 'Nuovo foglio SQL', onClick: () => openWorksheet(conn.id) },
          { label: 'Esplora nella vista Connessione', onClick: () => showIn('connection') },
          { label: 'Cerca nel codice…', onClick: () => showIn('search') },
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
    { label: 'Esponi a Copilot (MCP)', checked: mcpOn, onClick: toggleMcp },
    { label: 'Modifica…', onClick: () => setEditing(true) },
    { separator: true },
    { label: 'Elimina…', danger: true, onClick: remove },
  ];

  return (
    <div className={`conn-block ${connected ? 'connected' : ''} ${selected ? 'selected' : ''}`}>
      <div
        className="conn-row"
        onClick={() => {
          useStore.getState().selectConnection(conn.id);
          if (connected) setExpanded((e) => !e);
        }}
        // Non connessa: il doppio clic collega (come sempre). Già connessa:
        // porta alla vista con tutto il contenuto del database.
        onDoubleClick={() => (connected ? showIn('connection') : !connecting && connect(conn.id))}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <span className={`conn-dot status-${status.cls}`} title={status.label} />
        <div className="conn-names">
          <span className="conn-name">
            {conn.name}
            {mcpOn && (
              <span
                className={`mcp-badge ${mcpBusy ? 'busy' : ''}`}
                title={
                  mcpBusy
                    ? 'Copilot sta leggendo questo database'
                    : 'Esposta agli editor esterni (MCP), in sola lettura'
                }
              >
                <Plug size={10} />
              </span>
            )}
          </span>
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
            <button
              className="icon-btn"
              title="Cerca nel codice di questo database"
              onClick={() => showIn('search')}
            >
              <Search size={13} />
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
      {mcpOn && <McpRowActivity connId={conn.id} />}
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
  // Quante connessioni del gruppo sono aperte: a gruppo chiuso è l'unico modo
  // per capire dove si trovano le connessioni attive.
  const activeCount = useStore((s) =>
    items.reduce((n, c) => n + (s.active[c.id]?.status === 'connected' ? 1 : 0), 0)
  );
  return (
    <div
      className={`conn-group ${collapsed ? 'collapsed' : ''} ${plain ? 'plain' : ''} ${
        activeCount ? 'has-active' : ''
      }`}
      style={hue == null ? undefined : { '--group-hue': hue }}
    >
      <button className="conn-group-head" onClick={onToggle}>
        <span className={`tree-arrow ${collapsed ? '' : 'open'}`}>
          <ChevronRight size={12} />
        </span>
        <span className="conn-group-title">{title}</span>
        {!!activeCount && (
          <span
            className="conn-group-active"
            title={activeCount === 1 ? '1 connessione attiva' : `${activeCount} connessioni attive`}
          >
            <span className="conn-dot status-connected" />
            {activeCount}
          </span>
        )}
        <span
          className="conn-group-count"
          title={items.length === 1 ? '1 connessione' : `${items.length} connessioni`}
        >
          {items.length}
        </span>
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

// Vista «Connessioni»: l'elenco delle connessioni salvate, raggruppate.
export default function ConnectionsView({ onNewConnection, onImportConnections }) {
  const conns = useStore((s) => s.conns);
  const [open, setOpen] = useState({});
  const [search, setSearch] = useState('');

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

  // I gruppi partono chiusi, così all'avvio la sidebar resta compatta e si apre
  // solo quello che serve. "Senza gruppo" non è un vero gruppo: resta aperto,
  // altrimenti con nessun gruppo definito la lista sarebbe vuota all'avvio.
  const isOpen = (key) => open[key] ?? key === '__none__';
  const toggleGroup = (key) =>
    setOpen((s) => ({ ...s, [key]: !(s[key] ?? key === '__none__') }));

  return (
    <>
      <div className="view-head">
        <span className="view-title">Connessioni</span>
        <button className="icon-btn" title="Importa connessioni" onClick={onImportConnections}>
          <Upload size={13} />
        </button>
        <button className="icon-btn add-conn" title="Nuova connessione" onClick={onNewConnection}>
          <Plus size={15} />
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
            <button className="btn primary" onClick={onNewConnection}>
              Crea la prima
            </button>
            <button className="btn" onClick={onImportConnections}>
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
            collapsed={!searching && !isOpen(g.key)}
            onToggle={() => toggleGroup(g.key)}
          />
        ))}
      </div>
    </>
  );
}
