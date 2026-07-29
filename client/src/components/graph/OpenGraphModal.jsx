import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../../api.js';
import { useStore } from '../../store.js';

// Cosa caricare nel diagramma.
//
// Un canvas con quattrocento tabelle non serve a nessuno: si sceglie un
// sottoinsieme, e da lì si espande. Il diagramma però tiene comunque lo schema
// intero — quello che non è disegnato non è eliminato, altrimenti applicare
// proporrebbe di cancellare tutto il resto.

export default function OpenGraphModal({ defaults = {}, onClose, onOpen }) {
  const conns = useStore((s) => s.conns);
  const active = useStore((s) => s.active);
  const connected = conns.filter((c) => active[c.id]?.status === 'connected');

  const first = defaults.connId && active[defaults.connId] ? defaults.connId : connected[0]?.id;
  const [connId, setConnId] = useState(first ?? '');
  const [owner, setOwner] = useState(defaults.owner || active[first]?.currentSchema || '');
  const [schemas, setSchemas] = useState([]);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Cambiando connessione lo schema riparte da quello di lavoro; al primo giro
  // no, altrimenti si perderebbe quello con cui la scheda è stata aperta.
  const firstRun = useRef(true);
  useEffect(() => {
    if (!connId) return;
    if (firstRun.current) firstRun.current = false;
    else setOwner(active[connId]?.currentSchema ?? '');
    api
      .schemas(connId)
      .then((r) => setSchemas(r.schemas || []))
      .catch(() => setSchemas([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connId]);

  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.graphSession({ connId, owner, filter: filter.trim() });
      onOpen({ ...r, connId, owner });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-head">
          <span>Apri il diagramma</span>
          <button className="icon-btn" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="modal-body">
          {!connected.length ? (
            <div className="tree-info">Connettiti a un database per aprire un diagramma.</div>
          ) : (
            <>
              <label>
                Connessione
                <select value={connId} onChange={(e) => setConnId(e.target.value)}>
                  {connected.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Schema
                <select value={owner} onChange={(e) => setOwner(e.target.value)}>
                  {!schemas.includes(owner) && owner && <option value={owner}>{owner}</option>}
                  {schemas.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Filtro sui nomi (facoltativo)
                <input
                  value={filter}
                  placeholder="es. ORD%  oppure  fattur"
                  onChange={(e) => setFilter(e.target.value)}
                />
              </label>
              <div className="tree-info">
                Con % o _ vale come LIKE di Oracle, altrimenti basta che il nome contenga il testo.
                Su schemi grandi conviene partire da un filtro: il diagramma si può sempre allargare.
              </div>
              {error && <div className="test-result err">{error}</div>}
            </>
          )}
        </div>
        <div className="modal-foot">
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            Annulla
          </button>
          <button className="btn primary" disabled={!connId || !owner || busy} onClick={open}>
            {busy ? 'Lettura dello schema…' : 'Apri'}
          </button>
        </div>
      </div>
    </div>
  );
}
