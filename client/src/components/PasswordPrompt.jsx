import React, { useState } from 'react';
import { KeyRound, X, XCircle } from 'lucide-react';
import { useStore } from '../store.js';

// Chiesta quando si prova a connettersi e la password manca o non è più valida.
// Se il login riesce il server la salva sulla connessione, quindi la volta
// dopo il doppio click basta da solo.
export default function PasswordPrompt({ prompt }) {
  const conn = useStore((s) => s.conns.find((c) => c.id === prompt.connId));
  const closePasswordPrompt = useStore((s) => s.closePasswordPrompt);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  if (!conn) return null;

  const target =
    conn.serviceType === 'custom' ? conn.service : `${conn.host}:${conn.port}/${conn.service}`;

  const submit = async (e) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    try {
      // Non lancia: esito e messaggi passano dallo store (toast o nuovo prompt).
      await useStore.getState().connect(conn.id, password);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay">
      <form className="modal pwd-modal" onSubmit={submit}>
        <div className="modal-head">
          <span>
            <KeyRound size={13} /> Password richiesta
          </span>
          <button type="button" className="icon-btn" onClick={closePasswordPrompt}>
            <X size={14} />
          </button>
        </div>
        <div className="modal-body">
          <div className="pwd-target">
            <span className="pwd-conn-name">{conn.name}</span>
            <span>
              {conn.user}@{target}
            </span>
          </div>
          {prompt.error ? (
            <div className="test-result err">
              <XCircle size={15} />
              <span>{prompt.error}</span>
            </div>
          ) : (
            <div className="pwd-hint">Questa connessione non ha ancora una password salvata.</div>
          )}
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
          </label>
          <div className="pwd-hint">Verrà salvata nella connessione se il login riesce.</div>
        </div>
        <div className="modal-foot">
          <div style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={closePasswordPrompt}>
            Annulla
          </button>
          <button className="btn primary" type="submit" disabled={busy || !password}>
            {busy ? 'Connessione…' : 'Connetti e salva'}
          </button>
        </div>
      </form>
    </div>
  );
}
