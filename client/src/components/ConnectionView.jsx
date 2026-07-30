import React, { useEffect, useState } from 'react';
import { GitCompare, History, Network, Plug, Plus, RefreshCw, Search, Unplug } from 'lucide-react';
import { useStore } from '../store.js';
import ObjectTree from './ObjectTree.jsx';

// Vista «Connessione»: tutto quello che riguarda una sola connessione — stato,
// azioni, schema di lavoro e albero degli oggetti — senza l'elenco delle altre
// intorno. La connessione è quella selezionata nello store (`selectedConnId`),
// scelta cliccandola nella vista Connessioni o da questo selettore.
export default function ConnectionView() {
  const conns = useStore((s) => s.conns);
  const connId = useStore((s) => s.selectedConnId);
  const conn = conns.find((c) => c.id === connId) || null;
  const active = useStore((s) => (connId ? s.active[connId] : null));
  const schemas = useStore((s) => (connId ? s.sqlMeta[connId]?.schemas : null));
  const loadSchemas = useStore((s) => s.loadSchemas);
  const connected = active?.status === 'connected';

  // Schema mostrato dall'albero: parte da quello di lavoro della connessione.
  const [owner, setOwner] = useState('');
  useEffect(() => setOwner(''), [connId]);
  useEffect(() => {
    if (connected) loadSchemas(connId);
  }, [connected, connId, loadSchemas]);

  const schema = owner || active?.currentSchema || '';

  const head = (
    <div className="view-head">
      <span className="view-title">Connessione</span>
      {connected && (
        <>
          <button
            className="icon-btn"
            title="Nuovo foglio SQL"
            onClick={() => useStore.getState().openWorksheet(connId)}
          >
            <Plus size={15} />
          </button>
          <button
            className="icon-btn"
            title="Ricarica metadati e albero"
            onClick={() => {
              const st = useStore.getState();
              st.bumpTree(connId);
              st.loadAutocomplete(connId);
            }}
          >
            <RefreshCw size={13} />
          </button>
        </>
      )}
    </div>
  );

  if (!conn) {
    return (
      <>
        {head}
        <div className="view-empty">
          {conns.length
            ? 'Nessuna connessione selezionata: scegline una dalla vista Connessioni.'
            : 'Nessuna connessione salvata.'}
          {!!conns.length && (
            <button
              className="btn"
              onClick={() => useStore.getState().openSidebarView('connections')}
            >
              Vai alle connessioni
            </button>
          )}
        </div>
      </>
    );
  }

  const service =
    conn.serviceType === 'custom' ? conn.service : `${conn.host}:${conn.port}/${conn.service}`;

  return (
    <>
      {head}
      <div className="conn-view">
        <select
          className="conn-view-picker"
          value={connId}
          onChange={(e) => useStore.getState().selectConnection(e.target.value)}
          title="Connessione mostrata"
        >
          {conns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.connected ? '● ' : '○ '}
              {c.name}
            </option>
          ))}
        </select>

        <div className="conn-view-meta">
          <div>
            <span className={`conn-dot status-${connected ? 'connected' : active?.status || 'idle'}`} />
            <span className="mono">
              {conn.user}@{service}
            </span>
          </div>
          {connected && (
            <div className="conn-view-facts">
              <span title="Versione del server Oracle">Oracle {active.version}</span>
              <span title="Schema di lavoro della sessione">schema {active.currentSchema}</span>
            </div>
          )}
          {active?.status === 'error' && <div className="conn-view-err">{active.error}</div>}
        </div>

        {!connected ? (
          <div className="view-empty">
            Connessione non attiva.
            <button
              className="btn primary"
              disabled={active?.status === 'connecting'}
              onClick={() => useStore.getState().connect(connId)}
            >
              <Plug size={13} /> {active?.status === 'connecting' ? 'Connessione…' : 'Connetti'}
            </button>
          </div>
        ) : (
          <>
            <div className="conn-view-actions">
              <button
                className="mini-btn"
                onClick={() => useStore.getState().openSidebarView('search')}
                title="Cerca nel codice PL/SQL di questo database"
              >
                <Search size={12} /> Cerca nel codice
              </button>
              <button
                className="mini-btn"
                onClick={() => useStore.getState().openGraph(connId, schema)}
                title="Diagramma — editor a nodi (beta)"
              >
                <Network size={12} /> Diagramma
              </button>
              <button
                className="mini-btn"
                onClick={() => useStore.getState().openHistory(connId)}
                title="Cronologia delle query di questa connessione"
              >
                <History size={12} /> Cronologia
              </button>
              <button
                className="mini-btn"
                onClick={() => useStore.getState().openDiff()}
                title="Confronta due database"
              >
                <GitCompare size={12} /> Confronta
              </button>
              <button
                className="mini-btn danger"
                onClick={() => useStore.getState().disconnect(connId)}
                title="Chiudi la connessione"
              >
                <Unplug size={12} /> Disconnetti
              </button>
            </div>

            <label className="conn-view-schema">
              <span>Schema</span>
              <select value={schema} onChange={(e) => setOwner(e.target.value)}>
                {/* Lo schema di lavoro è sempre selezionabile, anche se
                    l'elenco completo non è ancora arrivato. */}
                {!schemas?.includes(active.currentSchema) && (
                  <option value={active.currentSchema}>{active.currentSchema}</option>
                )}
                {schemas?.map((s) => (
                  <option key={s} value={s}>
                    {s}
                    {s === active.currentSchema ? ' (di lavoro)' : ''}
                  </option>
                ))}
              </select>
            </label>

            <ObjectTree
              key={`${connId}:${schema}`}
              connId={connId}
              owner={schema}
              showOthers={false}
              className="flush"
            />
          </>
        )}
      </div>
    </>
  );
}
