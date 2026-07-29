import React, { useEffect, useState } from 'react';
import { AlertTriangle, FileCode, Play, RefreshCw, X, XCircle } from 'lucide-react';
import { api } from '../../api.js';
import { useStore } from '../../store.js';
import { splitStatements, executableSql } from '../../sqlSplit.js';

// Anteprima e applicazione delle modifiche.
//
// Due strade, in ordine di preferenza: portare lo script in un foglio SQL e
// lanciarlo a mano (la stessa disciplina del DB Diff), oppure eseguirlo qui.
// In entrambi i casi l'SQL si vede prima: nessuna istruzione parte al buio.

// Le tabelle che verranno eliminate: prima di confermare si vuole sapere
// quante righe ci sono dentro.
function useRowCounts(connId, owner, names) {
  const [counts, setCounts] = useState({});
  useEffect(() => {
    let alive = true;
    if (!names.length) return undefined;
    Promise.all(
      names.map((name) =>
        api
          .tableCount(connId, { owner, name })
          .then((r) => [name, r.error ? null : Number(r.count)])
          .catch(() => [name, null])
      )
    ).then((pairs) => alive && setCounts(Object.fromEntries(pairs)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connId, owner, names.join(',')]);
  return counts;
}

export default function ApplyModal({ sessionId, connId, owner, draft, schemaLabel, onClose, onApplied }) {
  const [includeDrops, setIncludeDrops] = useState(true);
  const [plan, setPlan] = useState(null);
  const [drift, setDrift] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(null);
  const [error, setError] = useState(null);
  const [partial, setPartial] = useState(false);
  const [confirm, setConfirm] = useState('');
  const toast = useStore((s) => s.toast);

  const load = async (ignoreDrift = false) => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.graphPlan(sessionId, { draft, includeDrops, schemaLabel, ignoreDrift });
      if (r.drift) {
        setDrift(r.drift);
        setPlan(null);
      } else {
        setDrift(null);
        setPlan(r);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeDrops]);

  // I DROP TABLE che lo script contiene davvero: è su quelli che si chiede
  // conferma, non su quello che l'utente crede di aver cancellato.
  const dropped = plan?.sql
    ? [...plan.sql.matchAll(/DROP TABLE "[^"]+"\."([^"]+)"/g)].map((m) => m[1])
    : [];
  const counts = useRowCounts(connId, owner, dropped);
  const withRows = dropped.filter((n) => counts[n] > 0);
  const needsConfirm = withRows.length > 0;
  const confirmed = !needsConfirm || confirm.trim().toUpperCase() === 'ELIMINA';

  const openInWorksheet = () => {
    useStore.getState().openWorksheet(connId, plan.sql);
    onClose();
  };

  const run = async () => {
    const statements = splitStatements(plan.sql)
      .map(executableSql)
      .filter((s) => s && s.trim());
    setRunning({ done: 0, total: statements.length });
    setError(null);
    try {
      for (let i = 0; i < statements.length; i++) {
        const r = await api.execute(connId, { sql: statements[i] });
        if (r.txnOpen != null) useStore.getState().setTxnOpen(connId, r.txnOpen);
        if (r.error) throw new Error(`istruzione ${i + 1} di ${statements.length}: ${r.error.message}`);
        setRunning({ done: i + 1, total: statements.length });
      }
      toast(`${statements.length} istruzioni eseguite`, 'ok');
      onApplied();
    } catch (err) {
      setError(err.message);
      // Il DDL fa commit implicito: quello che è passato prima dell'errore è
      // già nel database. Il diagramma va riletto — ma dopo che l'errore è
      // stato letto, non chiudendogli la finestra in faccia.
      setPartial(true);
    } finally {
      setRunning(null);
    }
  };

  const close = () => (partial ? onApplied() : onClose());

  return (
    <div className="modal-overlay">
      <div className="modal ddl-modal wide">
        <div className="modal-head">
          <span>Applica le modifiche — {schemaLabel}</span>
          <button className="icon-btn" onClick={close}>
            <X size={14} />
          </button>
        </div>
        <div className="modal-body">
          {loading && <div className="tree-info">Lettura dello schema e confronto…</div>}

          {drift && (
            <div className="test-result err">
              <AlertTriangle size={15} />
              <div>
                <strong>Il database è cambiato da quando hai aperto il diagramma.</strong>
                <ul className="gdrift">
                  {drift.slice(0, 12).map((d, i) => (
                    <li key={i}>
                      {d.type} {d.name} — {d.status === 'only-source' ? 'eliminato' : d.status === 'only-target' ? 'aggiunto' : 'modificato'}
                    </li>
                  ))}
                  {drift.length > 12 && <li>…e altri {drift.length - 12}</li>}
                </ul>
                <div className="tedit-actions">
                  <button className="btn" onClick={() => load(true)}>
                    Genera comunque
                  </button>
                  <button className="btn primary" onClick={onApplied}>
                    <RefreshCw size={13} /> Rileggi il diagramma
                  </button>
                </div>
                <div className="tree-info">
                  «Rileggi» riparte dallo stato attuale del database: le modifiche non applicate vanno perse.
                </div>
              </div>
            </div>
          )}

          {plan && !plan.sql && !plan.errors.length && (
            <div className="tree-info">Non c'è niente da applicare: il diagramma è già come il database.</div>
          )}

          {!!plan?.errors?.length && (
            <div className="test-result err">
              <XCircle size={15} />
              <div>
                {plan.errors.map((e, i) => (
                  <div key={i}>{e}</div>
                ))}
              </div>
            </div>
          )}

          {plan?.sql && (
            <>
              <div className="gapply-stats">
                <span>{plan.stats.statements} istruzioni</span>
                {!!plan.stats.renames && <span>{plan.stats.renames} rinomine</span>}
                {!!plan.stats.created && <span>{plan.stats.created} creazioni</span>}
                {!!plan.stats.dropped && <span className="err">{plan.stats.dropped} eliminazioni</span>}
              </div>

              <label className="check-label">
                <span>Applica anche le eliminazioni</span>
                <input
                  type="checkbox"
                  checked={includeDrops}
                  onChange={(e) => setIncludeDrops(e.target.checked)}
                />
              </label>

              {!!withRows.length && (
                <div className="test-result err">
                  <AlertTriangle size={15} />
                  <div>
                    <strong>Tabelle che verranno eliminate, con dati dentro:</strong>
                    <ul className="gdrift">
                      {withRows.map((n) => (
                        <li key={n}>
                          {n} — {counts[n]} righe
                        </li>
                      ))}
                    </ul>
                    <label>
                      Scrivi ELIMINA per confermare
                      <input value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                    </label>
                  </div>
                </div>
              )}

              <div className="sql-preview">
                <div className="sql-preview-head">SQL generato</div>
                <pre>{plan.sql}</pre>
              </div>
            </>
          )}

          {error && (
            <div className="test-result err">
              <XCircle size={15} />
              <div>
                <div>{error}</div>
                {partial && (
                  <div>
                    Il DDL conferma le modifiche mano a mano: quello che è passato prima
                    dell'errore è già nel database. Chiudendo, il diagramma viene riletto.
                  </div>
                )}
              </div>
            </div>
          )}
          {running && (
            <div className="tree-info">
              Esecuzione… {running.done} di {running.total}
            </div>
          )}
        </div>
        <div className="modal-foot">
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={close}>
            {partial ? 'Chiudi' : 'Annulla'}
          </button>
          <button className="btn danger" disabled={!plan?.sql || !!running || !confirmed} onClick={run}>
            <Play size={13} /> {running ? 'Esecuzione…' : 'Esegui'}
          </button>
          <button className="btn primary" disabled={!plan?.sql} onClick={openInWorksheet}>
            <FileCode size={13} /> Apri nel foglio SQL
          </button>
        </div>
      </div>
    </div>
  );
}
