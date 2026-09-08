import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ChevronRight, Plus, RefreshCw, Trash2, X, XCircle } from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.js';
import { dictName } from '../ddl.js';
import { SYSTEM_TYPES, systemTypesFor } from '../systemObjects.js';
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
  // Le lettere degli oggetti di sistema le decide il registro condiviso: si
  // rovesciano qui dentro perché `TypeIcon` (che le schede usano per il proprio
  // titolo) non deve sapere da quale dei due mondi arriva il tipo che riceve.
  ...Object.fromEntries(SYSTEM_TYPES.map((t) => [t.type, t.icon])),
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

// Pausa prima di rifare la richiesta quando è il server a filtrare: una query
// su ALL_SYNONYMS per ogni tasto premuto non la regge nessun database.
const FILTER_DELAY = 350;

// Apertura pigra, ricarica dopo un DDL altrui, paginazione e filtro: è tutto
// quello che una cartella dell'albero fa a prescindere da cosa contiene.
// `fetch` restituisce la forma comune a /objects e /objects/extra
// (`{ items, truncated, note }`); con `serverFilter` il filtro digitato viaggia
// dentro `fetch` e ogni modifica vale una richiesta nuova.
function useFolderItems(connId, filter, fetch, { serverFilter = false } = {}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [note, setNote] = useState(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const toast = useStore((s) => s.toast);
  const bump = useStore((s) => s.treeBump[connId] || 0);
  const prevBump = useRef(bump);
  // `fetch` è una closure nuova a ogni render (si porta dentro owner e filtro):
  // tenerla in un ref evita che `load` legga valori vecchi senza doverla
  // ricreare a ogni giro.
  const fetchRef = useRef(fetch);
  fetchRef.current = fetch;
  // Filtro con cui si è chiesto l'elenco l'ultima volta: serve alle cartelle
  // che filtrano da remoto per non ripetere la richiesta appena fatta.
  const asked = useRef(null);
  // Le risposte possono tornare fuori ordine (il filtro cambia mentre una
  // richiesta è in volo): vince sempre l'ultima partita.
  const reqId = useRef(0);

  const load = async (force = false) => {
    if (!force && (items || loading)) return;
    const id = ++reqId.current;
    asked.current = filter;
    setLoading(true);
    try {
      const data = await fetchRef.current();
      if (reqId.current !== id) return;
      setItems(data.items || []);
      setTruncated(!!data.truncated);
      setNote(data.note || null);
      setLimit(PAGE_SIZE);
    } catch (err) {
      if (reqId.current === id) toast(err.message, 'error');
    } finally {
      if (reqId.current === id) setLoading(false);
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

  // Cambiando filtro si riparte dalla prima pagina.
  useEffect(() => setLimit(PAGE_SIZE), [filter]);

  // Cartelle troppo grandi per scaricarle intere: il filtro lo applica il
  // server, quindi ogni modifica è una richiesta — dopo la pausa, e senza
  // ripeterla per il filtro con cui l'elenco è appena arrivato (altrimenti
  // aprire la cartella ne farebbe due).
  useEffect(() => {
    if (!serverFilter || !open || asked.current === filter) return undefined;
    const t = setTimeout(() => load(true), FILTER_DELAY);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, open, serverFilter]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) load();
  };

  const f = filter.trim().toLowerCase();
  const filtered = items ? (f ? items.filter((it) => it.name.toLowerCase().includes(f)) : items) : [];
  const shown = filtered.slice(0, limit);

  return {
    open,
    items,
    loading,
    truncated,
    note,
    count: filtered.length,
    shown,
    remaining: filtered.length - shown.length,
    load,
    toggle,
    more: () => setLimit((n) => n + PAGE_SIZE),
  };
}

// L'intestazione di una cartella: freccia, nome, conteggio e i pulsanti che
// compaiono passandoci sopra (`children`).
function FolderHead({ open, label, count, truncated, onToggle, children }) {
  return (
    <div className="tree-row" onClick={onToggle}>
      <span className={`tree-arrow ${open ? 'open' : ''}`}><ChevronRight size={12} /></span>
      <span className="folder-label">{label}</span>
      {count != null && (
        <span className="tree-count">
          {count}
          {truncated ? '+' : ''}
        </span>
      )}
      <span className="tree-actions">{children}</span>
    </div>
  );
}

function Folder({ connId, owner, label, type, filter }) {
  const [creating, setCreating] = useState(false);
  const [menu, setMenu] = useState(null); // { x, y, name }
  const [dropping, setDropping] = useState(null); // object name
  const [editing, setEditing] = useState(null); // object name (TABLE only)
  const openObject = useStore((s) => s.openObject);
  const st = useFolderItems(connId, filter, () => api.objects(connId, owner, type));

  const created = (name) => {
    st.load(true);
    if (type === 'TABLE' || type === 'VIEW') useStore.getState().loadAutocomplete(connId);
    if (name) openObject(connId, owner, name, type);
  };

  const dropped = (name) => {
    st.load(true);
    if (type === 'TABLE' || type === 'VIEW') useStore.getState().loadAutocomplete(connId);
    useStore.getState().closeTab(`obj-${connId}-${owner}.${name}-${type}`);
  };

  // TableEditDialog edited `editing` (may have been renamed to a new name).
  const edited = (origName, newName) => {
    st.load(true);
    const store = useStore.getState();
    store.loadAutocomplete(connId);
    if (newName) {
      const oldId = `obj-${connId}-${owner}.${origName}-TABLE`;
      if (store.tabs.some((tt) => tt.id === oldId)) {
        store.closeTab(oldId);
        store.openObject(connId, owner, newName, 'TABLE');
      }
    }
  };

  return (
    <div className="tree-folder">
      <FolderHead
        open={st.open}
        label={label}
        count={st.items ? st.count : null}
        truncated={st.truncated}
        onToggle={st.toggle}
      >
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
        {st.open && st.items && (
          <button
            className="icon-btn tree-hover-btn"
            title="Ricarica"
            onClick={(e) => {
              e.stopPropagation();
              st.load(true);
            }}
          >
            <RefreshCw size={12} />
          </button>
        )}
      </FolderHead>
      {st.open && (
        <div className="tree-children">
          {st.loading && !st.items && <div className="tree-info">Caricamento…</div>}
          {st.items && !st.shown.length && <div className="tree-info">Nessun oggetto</div>}
          {st.shown.map((it) => (
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
          {st.remaining > 0 && (
            <button className="tree-more" onClick={st.more}>
              Carica altro ({st.remaining})
            </button>
          )}
          {!st.remaining && st.truncated && (
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

// ---------------------------------------------------------------------------
// Oggetti di sistema (DB link, job, code, cestino, directory, utenti, …)
// ---------------------------------------------------------------------------

// Il cestino manda in `extra` "NOME_ORIGINALE · data di eliminazione": il nome
// di prima è la proposta giusta quando si ripristina con un altro nome.
const originalName = (item) => String(item.extra || '').split('·')[0].trim();

// Avviso ricorrente dei due dialoghi del cestino: FLASHBACK e PURGE sono DDL,
// quindi si portano dietro il COMMIT di quel che è aperto sul foglio.
function DdlWarning({ connId }) {
  const txnOpen = useStore((s) => s.active[connId]?.txnOpen);
  if (!txnOpen) return null;
  return (
    <div className="test-result err">
      <AlertTriangle size={15} />
      <span>
        C'è una transazione aperta sul foglio SQL: questa operazione è DDL ed esegue anche il
        COMMIT implicito delle modifiche pendenti.
      </span>
    </div>
  );
}

function FlashbackDialog({ connId, item, onClose, onDone }) {
  const original = originalName(item);
  const [rename, setRename] = useState(false);
  const [newName, setNewName] = useState(original);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const valid = !rename || !!newName.trim();

  const submit = async (e) => {
    e.preventDefault();
    if (busy || !valid) return;
    setBusy(true);
    setError(null);
    try {
      // `dictName` porta il nome nella forma in cui finirà nel dizionario: il
      // server lo mette fra doppi apici, quindi senza maiuscole si otterrebbe
      // una tabella scritta in minuscolo da citare sempre virgolettata.
      const target = rename ? dictName(newName) : null;
      const r = await api.recyclebinFlashback(connId, { name: item.name, newName: target });
      if (r?.error) throw new Error(r.error.message || r.error);
      onDone(target ? `Tabella ripristinata come ${target}` : `Ripristinata ${original}`);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay">
      <form className="modal bin-modal" onSubmit={submit}>
        <div className="modal-head">
          <span>Ripristina dal cestino</span>
          <button type="button" className="icon-btn" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="modal-body">
          <div className="bin-target">
            <span className="bin-orig">{original || item.name}</span>
            <span className="bin-bin">{item.name}</span>
          </div>
          <div className="bin-hint">
            FLASHBACK TABLE … TO BEFORE DROP rimette la tabella al suo posto con indici e
            vincoli. Se nel frattempo è nato un altro oggetto con lo stesso nome, serve un nome
            nuovo.
          </div>
          <label className="check-label">
            <span>Ripristina con un altro nome</span>
            <input type="checkbox" checked={rename} onChange={(e) => setRename(e.target.checked)} />
          </label>
          {rename && (
            <label>
              Nuovo nome
              <input value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
            </label>
          )}
          <DdlWarning connId={connId} />
          {error && (
            <div className="test-result err">
              <XCircle size={15} />
              <span>{error}</span>
            </div>
          )}
        </div>
        <div className="modal-foot">
          <div style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={onClose}>
            Annulla
          </button>
          <button className="btn primary" type="submit" disabled={busy || !valid}>
            {busy ? 'Ripristino…' : 'Ripristina'}
          </button>
        </div>
      </form>
    </div>
  );
}

// `item` assente = svuota tutto il cestino dell'utenza collegata.
function PurgeDialog({ connId, item, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const original = item ? originalName(item) : '';

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.recyclebinPurge(connId, item ? { name: item.name } : { all: true });
      if (r?.error) throw new Error(r.error.message || r.error);
      onDone(item ? `Eliminata definitivamente ${original || item.name}` : 'Cestino svuotato');
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal bin-modal">
        <div className="modal-head">
          <span>{item ? 'Elimina definitivamente' : 'Svuota il cestino'}</span>
          <button className="icon-btn" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="modal-body">
          {item ? (
            <>
              <div className="bin-target">
                <span className="bin-orig">{original || item.name}</span>
                <span className="bin-bin">{item.name}</span>
              </div>
              <div className="bin-hint danger">
                Dopo il PURGE la tabella non è più ripristinabile: lo spazio torna al tablespace
                e del contenuto non resta niente.
              </div>
            </>
          ) : (
            <div className="bin-hint danger">
              PURGE RECYCLEBIN elimina definitivamente <b>tutte</b> le tabelle nel cestino
              dell'utenza collegata. Nessuna di queste sarà più ripristinabile.
            </div>
          )}
          <DdlWarning connId={connId} />
          {error && (
            <div className="test-result err">
              <XCircle size={15} />
              <span>{error}</span>
            </div>
          )}
        </div>
        <div className="modal-foot">
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            Annulla
          </button>
          <button className="btn danger" disabled={busy} onClick={run}>
            {busy ? 'Eliminazione…' : item ? 'Elimina definitivamente' : 'Svuota il cestino'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Cartella di un tipo «di sistema»: stessa apertura pigra delle altre, ma
// l'elenco arriva da /objects/extra e il click apre una scheda `sysobject`.
// `def` è la voce del registro (`client/src/systemObjects.js`).
function SystemFolder({ connId, owner, def, filter }) {
  const { type, folder, owned } = def;
  // I sinonimi pubblici sono decine di migliaia: scaricarli tutti per buttarne
  // via il 99% è tempo perso da entrambe le parti, il filtro va al server (che
  // cerca per prefisso e taglia in SQL).
  const serverFilter = type === 'PUBLIC_SYNONYM';
  const [menu, setMenu] = useState(null); // { x, y, item }
  const [flashing, setFlashing] = useState(null); // voce da ripristinare
  const [purging, setPurging] = useState(null); // { item } | { all: true }
  const active = useStore((s) => s.active[connId]);
  const st = useFolderItems(
    connId,
    filter,
    () =>
      api.extraObjects(connId, {
        type,
        owner: owned ? owner : undefined,
        filter: serverFilter ? filter.trim() : undefined,
      }),
    { serverFilter }
  );

  // FLASHBACK e PURGE non portano lo schema davanti al nome (il BIN$… si
  // risolve nel cestino di chi esegue): sul cestino di un altro schema si può
  // solo guardare.
  const ownBin =
    type === 'RECYCLEBIN' && !!active && (owner === active.currentSchema || owner === active.user);

  const openItem = (name) =>
    useStore.getState().openSystemObject(connId, type, name, owned ? owner : '');

  // Dopo un ripristino o un'eliminazione definitiva cambia molto più del
  // cestino: la tabella ricompare (o sparisce) anche sotto «Tabelle», da cui
  // `bumpTree`, e torna a esistere per l'autocomplete, che altrimenti
  // continuerebbe a ignorarla.
  const done = (msg) => {
    const store = useStore.getState();
    store.toast(msg, 'ok');
    // Il commit implicito del DDL ha già chiuso quel che era aperto sul foglio.
    store.setTxnOpen(connId, false);
    st.load(true);
    store.bumpTree(connId);
    store.loadAutocomplete(connId);
  };

  const emptyText =
    type === 'RECYCLEBIN'
      ? 'Cestino vuoto'
      : serverFilter && !filter.trim()
        ? 'Nessun sinonimo pubblico'
        : 'Nessun oggetto';

  return (
    <div className="tree-folder">
      <FolderHead
        open={st.open}
        label={folder}
        count={st.items ? st.count : null}
        truncated={st.truncated}
        onToggle={st.toggle}
      >
        {ownBin && st.open && !!st.items?.length && (
          <button
            className="icon-btn tree-hover-btn"
            title="Svuota il cestino"
            onClick={(e) => {
              e.stopPropagation();
              setPurging({ all: true });
            }}
          >
            <Trash2 size={12} />
          </button>
        )}
        {st.open && st.items && (
          <button
            className="icon-btn tree-hover-btn"
            title="Ricarica"
            onClick={(e) => {
              e.stopPropagation();
              st.load(true);
            }}
          >
            <RefreshCw size={12} />
          </button>
        )}
      </FolderHead>
      {st.open && (
        <div className="tree-children">
          {st.loading && !st.items && <div className="tree-info">Caricamento…</div>}
          {st.note && <div className="tree-info tree-note">{st.note}</div>}
          {st.items && !st.shown.length && !st.note && (
            <div className="tree-info">{emptyText}</div>
          )}
          {st.shown.map((it) => (
            <div
              key={it.name}
              className="tree-row tree-leaf sys-leaf"
              title={it.extra ? `${it.name} — ${it.extra}` : it.name}
              onClick={() => openItem(it.name)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, item: it });
              }}
            >
              <TypeIcon type={type} />
              <span className="leaf-name">{it.name}</span>
              {it.extra && <span className="leaf-extra">{it.extra}</span>}
              {it.status && it.status !== 'VALID' && (
                <span className="invalid-dot" title={it.status} />
              )}
            </div>
          ))}
          {st.remaining > 0 && (
            <button className="tree-more" onClick={st.more}>
              Carica altro ({st.remaining})
            </button>
          )}
          {!st.remaining && st.truncated && (
            <div className="tree-info">
              {serverFilter
                ? 'Elenco troncato dal server: scrivi nel filtro in cima all\'albero per cercarne uno.'
                : 'elenco troncato dal server'}
            </div>
          )}
          {st.loading && st.items && <div className="tree-info">Aggiornamento…</div>}
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
                openItem(menu.item.name);
                setMenu(null);
              }}
            >
              Apri
            </button>
            {type === 'RECYCLEBIN' && (
              <>
                <button
                  disabled={!ownBin}
                  title={ownBin ? '' : 'Si ripristina solo dal cestino dell\'utenza collegata'}
                  onClick={() => {
                    setFlashing(menu.item);
                    setMenu(null);
                  }}
                >
                  Ripristina…
                </button>
                <button
                  className="danger"
                  disabled={!ownBin}
                  title={ownBin ? '' : 'Si svuota solo il cestino dell\'utenza collegata'}
                  onClick={() => {
                    setPurging({ item: menu.item });
                    setMenu(null);
                  }}
                >
                  Elimina definitivamente…
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {flashing && (
        <FlashbackDialog
          connId={connId}
          item={flashing}
          onClose={() => setFlashing(null)}
          onDone={done}
        />
      )}
      {purging && (
        <PurgeDialog
          connId={connId}
          item={purging.item}
          onClose={() => setPurging(null)}
          onDone={done}
        />
      )}
    </div>
  );
}

// La chiave porta dentro lo schema: cambiando schema le cartelle ripartono
// vuote invece di restare con gli oggetti di quello precedente.
function SchemaFolders({ connId, owner, filter }) {
  return (
    <>
      {TYPE_FOLDERS.map(([label, type]) => (
        <Folder
          key={`${owner}:${type}`}
          connId={connId}
          owner={owner}
          label={label}
          type={type}
          filter={filter}
        />
      ))}
      {systemTypesFor('schema').map((def) => (
        <SystemFolder
          key={`${owner}:${def.type}`}
          connId={connId}
          owner={owner}
          def={def}
          filter={filter}
        />
      ))}
    </>
  );
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

// Le cartelle che non appartengono a nessuno schema (directory, utenti, ruoli,
// tablespace, sinonimi pubblici, edition). Le chiavi non portano l'owner: sono
// gli stessi oggetti da qualunque schema li si guardi, e cambiare schema non
// deve far ripartire questo ramo da capo.
function DatabaseGroup({ connId, filter }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="tree-folder tree-group">
      <div className="tree-row" onClick={() => setOpen(!open)}>
        <span className={`tree-arrow ${open ? 'open' : ''}`}><ChevronRight size={12} /></span>
        <span className="folder-label">Database</span>
      </div>
      {open && (
        <div className="tree-children">
          {systemTypesFor('database').map((def) => (
            <SystemFolder key={def.type} connId={connId} def={def} filter={filter} />
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
      <DatabaseGroup connId={connId} filter={filter} />
    </div>
  );
}
