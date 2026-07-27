import React, { useRef, useState } from 'react';
import { FastForward, History, Play, Square } from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.js';
import { splitStatements, statementAt, executableSql } from '../sqlSplit.js';
import Editor from './Editor.jsx';
import Grid, { exportCsv } from './Grid.jsx';

function firstLine(sql) {
  const l = sql.trim().split('\n')[0];
  return l.length > 80 ? l.slice(0, 80) + '…' : l;
}

export default function Worksheet({ tab }) {
  const connId = tab.connId;
  const conn = useStore((s) => s.conns.find((c) => c.id === connId));
  const active = useStore((s) => s.active[connId]);
  const schema = useStore((s) => s.autocomplete[connId]);
  const maxRows = useStore((s) => s.maxRows);
  const { setDraft, setMaxRows, setTxnOpen, toast, connect, openHistory } = useStore.getState();
  const draft = useRef(useStore.getState().drafts[tab.id] ?? '');

  const viewRef = useRef(null);
  const [running, setRunning] = useState(false);
  const [pane, setPane] = useState('results');
  const [res, setRes] = useState(null); // { columns, rows, truncated, elapsedMs }
  const [messages, setMessages] = useState([]);
  const [scriptLog, setScriptLog] = useState('');
  const [dbmsOut, setDbmsOut] = useState('');
  const connected = active?.status === 'connected';

  const addMsg = (text, type = 'info') =>
    setMessages((m) => [...m, { text, type, ts: new Date().toLocaleTimeString() }]);

  const currentStatement = () => {
    const view = viewRef.current;
    if (!view) return null;
    const { from, to } = view.state.selection.main;
    const doc = view.state.doc.toString();
    if (from !== to) {
      const sel = doc.slice(from, to);
      const stmts = splitStatements(sel);
      return stmts.length === 1 ? { ...stmts[0], start: from } : { text: sel, start: from, plsql: stmts[0]?.plsql ?? false };
    }
    const stmt = statementAt(doc, from);
    return stmt;
  };

  const handleResult = (r, stmt) => {
    if (r.txnOpen != null) setTxnOpen(connId, r.txnOpen);
    if (r.dbmsOutput?.length) {
      setDbmsOut((o) => o + r.dbmsOutput.join('\n') + '\n');
    }
    if (r.error) {
      let msg = r.error.message;
      if (r.error.offset != null && viewRef.current && stmt?.start != null) {
        const pos = Math.min(stmt.start + r.error.offset, viewRef.current.state.doc.length);
        const line = viewRef.current.state.doc.lineAt(pos);
        msg += `  (riga ${line.number})`;
        viewRef.current.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
        viewRef.current.focus();
      }
      addMsg(msg, 'error');
      setPane('messages');
      return;
    }
    if (r.columns) {
      setRes(r);
      setPane('results');
      addMsg(
        `${firstLine(stmt?.text || '')} — ${r.rows.length} righe${r.truncated ? ' (limite raggiunto)' : ''} in ${r.elapsedMs} ms`,
        'ok'
      );
    } else {
      addMsg(`${firstLine(stmt?.text || '')} — ${r.rowsAffected} righe interessate in ${r.elapsedMs} ms`, 'ok');
      setPane('messages');
    }
  };

  const run = async () => {
    if (running || !connected) return;
    const stmt = currentStatement();
    if (!stmt || !stmt.text.trim()) {
      toast('Nessuna istruzione al cursore', 'error');
      return;
    }
    setRunning(true);
    try {
      const r = await api.execute(connId, { sql: executableSql(stmt), maxRows });
      handleResult(r, stmt);
    } catch (err) {
      addMsg(err.message, 'error');
      setPane('messages');
      if (err.status === 409) useStore.getState().markDisconnected(connId);
    } finally {
      setRunning(false);
    }
  };

  const runScript = async () => {
    if (running || !connected || !viewRef.current) return;
    const doc = viewRef.current.state.doc.toString();
    const stmts = splitStatements(doc);
    if (!stmts.length) return;
    setRunning(true);
    setPane('script');
    let log = `-- Script: ${stmts.length} istruzioni — ${new Date().toLocaleTimeString()}\n\n`;
    setScriptLog(log);
    let lastGrid = null;
    try {
      for (const [i, stmt] of stmts.entries()) {
        log += `[${i + 1}/${stmts.length}] ${firstLine(stmt.text)}\n`;
        try {
          const r = await api.execute(connId, { sql: executableSql(stmt), maxRows });
          if (r.txnOpen != null) setTxnOpen(connId, r.txnOpen);
          if (r.dbmsOutput?.length) setDbmsOut((o) => o + r.dbmsOutput.join('\n') + '\n');
          if (r.error) {
            log += `    ERRORE: ${r.error.message}\n`;
          } else if (r.columns) {
            log += `    ${r.rows.length} righe (${r.elapsedMs} ms)\n`;
            lastGrid = r;
          } else {
            log += `    OK — ${r.rowsAffected} righe interessate (${r.elapsedMs} ms)\n`;
          }
        } catch (err) {
          log += `    ERRORE: ${err.message}\n`;
          if (err.status === 409) {
            useStore.getState().markDisconnected(connId);
            break;
          }
        }
        setScriptLog(log);
      }
      log += '\n-- Fine script\n';
      setScriptLog(log);
      if (lastGrid) setRes(lastGrid);
    } finally {
      setRunning(false);
    }
  };

  const explain = async () => {
    if (running || !connected) return;
    const stmt = currentStatement();
    if (!stmt?.text.trim()) return;
    setRunning(true);
    try {
      const r = await api.explain(connId, { sql: executableSql(stmt) });
      if (r.error) {
        addMsg(r.error.message, 'error');
      } else {
        addMsg('Explain plan:\n' + r.plan, 'plan');
      }
      setPane('messages');
    } catch (err) {
      addMsg(err.message, 'error');
    } finally {
      setRunning(false);
    }
  };

  const doCommit = async () => {
    try {
      await api.commit(connId);
      setTxnOpen(connId, false);
      toast('Commit eseguito', 'ok');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const doRollback = async () => {
    try {
      await api.rollback(connId);
      setTxnOpen(connId, false);
      toast('Rollback eseguito', 'ok');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const doCancel = async () => {
    try {
      const r = await api.cancel(connId);
      if (!r.ok && r.message) toast(r.message, 'error');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  if (!conn) return <div className="ws-missing">Connessione eliminata</div>;

  return (
    <div className="worksheet">
      <div className="ws-toolbar">
        <button className="btn run" onClick={run} disabled={running || !connected} title="Esegui istruzione (Ctrl+Invio / F9)">
          <Play size={13} /> Esegui
        </button>
        <button className="btn" onClick={runScript} disabled={running || !connected} title="Esegui script (F5)">
          <FastForward size={13} /> Script
        </button>
        <button className="btn" onClick={explain} disabled={running || !connected} title="Explain plan">
          Piano
        </button>
        <button className="btn" onClick={() => openHistory(connId)} title="Cronologia query di questa connessione">
          <History size={13} /> Cronologia
        </button>
        <span className="ws-sep" />
        <button className="btn" onClick={doCommit} disabled={!connected} title="Commit">
          Commit
        </button>
        <button className="btn" onClick={doRollback} disabled={!connected} title="Rollback">
          Rollback
        </button>
        {running && (
          <button className="btn danger" onClick={doCancel}>
            <Square size={12} /> Annulla
          </button>
        )}
        <div style={{ flex: 1 }} />
        <label className="maxrows">
          Righe max
          <select value={maxRows} onChange={(e) => setMaxRows(Number(e.target.value))}>
            {[100, 500, 1000, 5000, 10000].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <span className="conn-badge">
          <span className="conn-dot" />
          {conn.name}
          {active?.txnOpen && <span className="txn-dot" title="Transazione aperta" />}
        </span>
      </div>

      {!connected && (
        <div className="ws-banner">
          Connessione non attiva.
          <button className="btn primary" onClick={() => connect(connId)}>
            Connetti
          </button>
        </div>
      )}

      <div className="ws-editor">
        <Editor
          initialDoc={draft.current}
          schema={schema}
          onChange={(text) => setDraft(tab.id, text)}
          onRun={run}
          onRunScript={runScript}
          onViewReady={(v) => (viewRef.current = v)}
        />
      </div>

      <div className="ws-results">
        <div className="pane-tabs">
          <button className={pane === 'results' ? 'on' : ''} onClick={() => setPane('results')}>
            Risultati
            {res && <span className="pane-info">{res.rows.length}{res.truncated ? '+' : ''}</span>}
          </button>
          <button className={pane === 'messages' ? 'on' : ''} onClick={() => setPane('messages')}>
            Messaggi{messages.length ? ` (${messages.length})` : ''}
          </button>
          <button className={pane === 'script' ? 'on' : ''} onClick={() => setPane('script')}>
            Script
          </button>
          <button className={pane === 'dbms' ? 'on' : ''} onClick={() => setPane('dbms')}>
            DBMS Output
          </button>
          <div style={{ flex: 1 }} />
          {running && <span className="running-ind">Esecuzione…</span>}
          {pane === 'results' && res && (
            <>
              <span className="pane-info">{res.elapsedMs} ms</span>
              <button className="mini-btn" onClick={() => exportCsv(res.columns, res.rows)}>
                CSV
              </button>
            </>
          )}
          {pane === 'messages' && messages.length > 0 && (
            <button className="mini-btn" onClick={() => setMessages([])}>
              Pulisci
            </button>
          )}
          {pane === 'dbms' && dbmsOut && (
            <button className="mini-btn" onClick={() => setDbmsOut('')}>
              Pulisci
            </button>
          )}
        </div>
        <div className="pane-body">
          {pane === 'results' &&
            (res ? (
              <Grid columns={res.columns} rows={res.rows} />
            ) : (
              <div className="grid-empty">Esegui una query per vedere i risultati</div>
            ))}
          {pane === 'messages' && (
            <div className="messages">
              {!messages.length && <div className="grid-empty">Nessun messaggio</div>}
              {messages.map((m, i) => (
                <div key={i} className={`msg ${m.type}`}>
                  <span className="msg-ts">{m.ts}</span>
                  <pre>{m.text}</pre>
                </div>
              ))}
            </div>
          )}
          {pane === 'script' && (
            <pre className="script-log">{scriptLog || 'Nessuno script eseguito'}</pre>
          )}
          {pane === 'dbms' && <pre className="script-log">{dbmsOut || 'Nessun output'}</pre>}
        </div>
      </div>
    </div>
  );
}
