import React, { useEffect, useRef, useState } from 'react';
import { ChevronRight, Plus, RefreshCw } from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.js';
import ObjectCreateDialog, { DropDialog } from './ObjectDialogs.jsx';
import TableEditDialog from './TableDialogs.jsx';

const TYPE_FOLDERS = [
  ['Tabelle', 'TABLE'],
  ['Viste', 'VIEW'],
  ['Viste materializzate', 'MATERIALIZED VIEW'],
  ['Indici', 'INDEX'],
  ['Sequenze', 'SEQUENCE'],
  ['Procedure', 'PROCEDURE'],
  ['Funzioni', 'FUNCTION'],
  ['Package', 'PACKAGE'],
  ['Package Body', 'PACKAGE BODY'],
  ['Trigger', 'TRIGGER'],
  ['Tipi', 'TYPE'],
  ['Sinonimi', 'SYNONYM'],
];

const TYPE_ICON = {
  TABLE: ['T', '#4ec9b0'],
  VIEW: ['V', '#61afef'],
  'MATERIALIZED VIEW': ['M', '#61afef'],
  INDEX: ['I', '#9aa2b1'],
  SEQUENCE: ['S', '#d19a66'],
  PROCEDURE: ['P', '#c678dd'],
  FUNCTION: ['F', '#c678dd'],
  PACKAGE: ['K', '#e5c07b'],
  'PACKAGE BODY': ['B', '#e5c07b'],
  TRIGGER: ['G', '#e06c75'],
  TYPE: ['Y', '#56b6c2'],
  'TYPE BODY': ['Y', '#3f9aa3'],
  SYNONYM: ['N', '#98c379'],
};

// Types with a guided creation dialog.
const CREATABLE = new Set([
  'TABLE',
  'VIEW',
  'INDEX',
  'SEQUENCE',
  'PROCEDURE',
  'FUNCTION',
  'PACKAGE',
  'TRIGGER',
  'TYPE',
  'SYNONYM',
]);

export function TypeIcon({ type }) {
  const [ch, color] = TYPE_ICON[type] || ['?', '#888'];
  return (
    <span className="type-icon" style={{ color, borderColor: color }}>
      {ch}
    </span>
  );
}

// Quanti nodi si disegnano per volta: il resto arriva col tasto "Carica altro".
const PAGE_SIZE = 300;

function Folder({ connId, owner, label, type, filter }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [creating, setCreating] = useState(false);
  const [menu, setMenu] = useState(null); // { x, y, name }
  const [dropping, setDropping] = useState(null); // object name
  const [editing, setEditing] = useState(null); // object name (TABLE only)
  const openObject = useStore((s) => s.openObject);
  const toast = useStore((s) => s.toast);
  const bump = useStore((s) => s.treeBump[connId] || 0);
  const prevBump = useRef(bump);

  const load = async (force = false) => {
    if (loading || (items && !force)) return;
    setLoading(true);
    try {
      const data = await api.objects(connId, owner, type);
      setItems(data.items);
      setTruncated(data.truncated);
      setLimit(PAGE_SIZE);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  // reload after DDL executed elsewhere (worksheet, detail tabs, dialogs)
  useEffect(() => {
    if (prevBump.current !== bump) {
      prevBump.current = bump;
      if (items) load(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bump]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) load();
  };

  const created = (name) => {
    load(true);
    if (type === 'TABLE' || type === 'VIEW') useStore.getState().loadAutocomplete(connId);
    if (name) openObject(connId, owner, name, type);
  };

  const dropped = (name) => {
    load(true);
    if (type === 'TABLE' || type === 'VIEW') useStore.getState().loadAutocomplete(connId);
    useStore.getState().closeTab(`obj-${connId}-${owner}.${name}-${type}`);
  };

  // TableEditDialog edited `editing` (may have been renamed to a new name).
  const edited = (origName, newName) => {
    load(true);
    const st = useStore.getState();
    st.loadAutocomplete(connId);
    if (newName) {
      const oldId = `obj-${connId}-${owner}.${origName}-TABLE`;
      if (st.tabs.some((tt) => tt.id === oldId)) {
        st.closeTab(oldId);
        st.openObject(connId, owner, newName, 'TABLE');
      }
    }
  };

  // Cambiando filtro si riparte dalla prima pagina.
  useEffect(() => setLimit(PAGE_SIZE), [filter]);

  const f = filter.toLowerCase();
  const filtered = items ? (f ? items.filter((it) => it.name.toLowerCase().includes(f)) : items) : [];
  const shown = filtered.slice(0, limit);
  const remaining = filtered.length - shown.length;

  return (
    <div className="tree-folder">
      <div className="tree-row" onClick={toggle}>
        <span className={`tree-arrow ${open ? 'open' : ''}`}><ChevronRight size={12} /></span>
        <span className="folder-label">{label}</span>
        {items && <span className="tree-count">{filtered.length}{truncated ? '+' : ''}</span>}
        <span className="tree-actions">
          {CREATABLE.has(type) && (
            <button
              className="icon-btn tree-hover-btn"
              title={`Nuovo — ${label}`}
              onClick={(e) => {
                e.stopPropagation();
                setCreating(true);
              }}
            >
              <Plus size={12} />
            </button>
          )}
          {open && items && (
            <button
              className="icon-btn tree-hover-btn"
              title="Ricarica"
              onClick={(e) => {
                e.stopPropagation();
                load(true);
              }}
            >
              <RefreshCw size={12} />
            </button>
          )}
        </span>
      </div>
      {open && (
        <div className="tree-children">
          {loading && !items && <div className="tree-info">Caricamento…</div>}
          {items && !shown.length && <div className="tree-info">Nessun oggetto</div>}
          {shown.map((it) => (
            <div
              key={it.name}
              className="tree-row tree-leaf"
              title={it.name}
              onClick={() => openObject(connId, owner, it.name, type)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, name: it.name });
              }}
            >
              <TypeIcon type={type} />
              <span className="leaf-name">{it.name}</span>
              {it.status && it.status !== 'VALID' && (
                <span className="invalid-dot" title={it.status} />
              )}
            </div>
          ))}
          {remaining > 0 && (
            <button
              className="tree-more"
              onClick={() => setLimit((n) => n + PAGE_SIZE)}
            >
              Carica altro ({remaining})
            </button>
          )}
          {!remaining && truncated && (
            <div className="tree-info">elenco troncato dal server</div>
          )}
        </div>
      )}
      {menu && (
        <div
          className="ctx-overlay"
          onClick={() => setMenu(null)}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu(null);
          }}
        >
          <div className="ctx-menu" style={{ left: menu.x, top: menu.y }}>
            <button
              onClick={() => {
                openObject(connId, owner, menu.name, type);
                setMenu(null);
              }}
            >
              Apri
            </button>
            {type === 'TABLE' && (
              <button
                onClick={() => {
                  useStore.getState().openGraph(connId, owner);
                  setMenu(null);
                }}
              >
                Apri nel diagramma
              </button>
            )}
            {type === 'TABLE' && (
              <button
                onClick={() => {
                  setEditing(menu.name);
                  setMenu(null);
                }}
              >
                Modifica…
              </button>
            )}
            <button
              className="danger"
              onClick={() => {
                setDropping(menu.name);
                setMenu(null);
              }}
            >
              Elimina…
            </button>
          </div>
        </div>
      )}
      {creating && (
        <ObjectCreateDialog
          connId={connId}
          owner={owner}
          type={type}
          onClose={() => setCreating(false)}
          onDone={created}
        />
      )}
      {dropping && (
        <DropDialog
          connId={connId}
          owner={owner}
          name={dropping}
          type={type}
          onClose={() => setDropping(null)}
          onDone={() => dropped(dropping)}
        />
      )}
      {editing && (
        <TableEditDialog
          connId={connId}
          owner={owner}
          table={editing}
          onClose={() => setEditing(null)}
          onDone={(newName) => edited(editing, newName)}
        />
      )}
    </div>
  );
}

// La chiave porta dentro lo schema: cambiando schema le cartelle ripartono
// vuote invece di restare con gli oggetti di quello precedente.
function SchemaFolders({ connId, owner, filter }) {
  return TYPE_FOLDERS.map(([label, type]) => (
    <Folder
      key={`${owner}:${type}`}
      connId={connId}
      owner={owner}
      label={label}
      type={type}
      filter={filter}
    />
  ));
}

function OtherUsers({ connId, filter }) {
  const [open, setOpen] = useState(false);
  const [schemas, setSchemas] = useState(null);
  const [expanded, setExpanded] = useState({});
  const toast = useStore((s) => s.toast);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && !schemas) {
      try {
        const data = await api.schemas(connId);
        setSchemas(data.schemas);
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  };

  return (
    <div className="tree-folder">
      <div className="tree-row" onClick={toggle}>
        <span className={`tree-arrow ${open ? 'open' : ''}`}><ChevronRight size={12} /></span>
        <span className="folder-label">Altri utenti</span>
        {schemas && <span className="tree-count">{schemas.length}</span>}
      </div>
      {open && (
        <div className="tree-children">
          {!schemas && <div className="tree-info">Caricamento…</div>}
          {schemas?.map((s) => (
            <div key={s} className="tree-folder">
              <div
                className="tree-row"
                onClick={() => setExpanded((e) => ({ ...e, [s]: !e[s] }))}
              >
                <span className={`tree-arrow ${expanded[s] ? 'open' : ''}`}><ChevronRight size={12} /></span>
                <span className="folder-label schema-label">{s}</span>
              </div>
              {expanded[s] && (
                <div className="tree-children">
                  <SchemaFolders connId={connId} owner={s} filter={filter} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// `owner`: schema da mostrare (senza, quello di lavoro della connessione).
// `showOthers`: la cartella «Altri utenti»; la vista «Connessione» non ne ha
// bisogno, ha già un selettore di schema.
export default function ObjectTree({ connId, owner, showOthers = true, className = '' }) {
  const active = useStore((s) => s.active[connId]);
  const [filter, setFilter] = useState('');
  if (!active || active.status !== 'connected') return null;

  return (
    <div className={`object-tree ${className}`}>
      <input
        className="tree-filter"
        placeholder="Filtra oggetti…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <SchemaFolders connId={connId} owner={owner || active.currentSchema} filter={filter} />
      {showOthers && <OtherUsers connId={connId} filter={filter} />}
    </div>
  );
}
