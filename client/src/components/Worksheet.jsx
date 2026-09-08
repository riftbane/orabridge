import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  ChevronDown,
  FastForward,
  FolderOpen,
  History,
  Lock,
  Play,
  Save,
  Square,
  Variable,
} from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.js';
import { applySubstitutions, findBinds, findSubstitutions } from '../binds.js';
import { canUseNativeDialogs, openSqlFile, saveSqlFile } from '../sqlFiles.js';
import { splitStatements, statementAt, executableSql } from '../sqlSplit.js';
import BindVarsDialog from './BindVarsDialog.jsx';
import Editor from './Editor.jsx';
import ExportDialog from './ExportDialog.jsx';
import Grid, { exportCsv, DecodeEntitiesToggle } from './Grid.jsx';
import PlanTree from './PlanTree.jsx';
import Resizer from './Resizer.jsx';

function firstLine(sql) {
  const l = sql.trim().split('\n')[0];
  return l.length > 80 ? l.slice(0, 80) + '…' : l;
}

// I valori confermati nella finestra delle variabili stanno tutti in una mappa
// sola (è quella che lo store ricorda per il foglio): le sostituzioni come
// stringhe, i bind come oggetti `{ val, type, dir }`. Le due funzioni qui sotto
// la rileggono nelle due forme che servono al momento dell'esecuzione.
function subMap(values) {
  const out = {};
  for (const [k, v] of Object.entries(values || {})) out[k] = v && typeof v === 'object' ? v.val : v;
  return out;
}

// I bind si ricavano dall'SQL **dopo** la sostituzione, perché è quello che
// Oracle riceve: se una sostituzione ne ha portato dentro uno che non era
// stato chiesto, mandarlo come NULL è meglio dell'ORA-01008 «non tutte le
// variabili sono associate», che non dice quale manca.
function bindMap(sql, values) {
  const out = {};
  for (const b of findBinds(sql)) {
    const v = values?.[b.name.toUpperCase()];
    if (v && typeof v === 'object') {
      out[b.name] = { val: v.val === undefined ? null : v.val, type: v.type || 'string', dir: v.dir || 'in' };
    } else {
      out[b.name] = { val: v === undefined ? null : v, type: 'string', dir: 'in' };
    }
  }
  // Niente bind, niente campo: le istruzioni normali continuano a viaggiare
  // con lo stesso corpo di richiesta di prima.
  return Object.keys(out).length ? out : undefined;
}

function outBindsText(outBinds) {
  return Object.entries(outBinds)
    .map(([k, v]) => `  :${k} = ${v === null || v === undefined ? 'NULL' : v}`)
    .join('\n');
}

export default function Worksheet({ tab }) {
  const connId = tab.connId;
  const conn = useStore((s) => s.conns.find((c) => c.id === connId));
  const active = useStore((s) => s.active[connId]);
  const maxRows = useStore((s) => s.maxRows);
  const ui = useStore((s) => s.ui);
  const setUi = useStore((s) => s.setUi);
  const file = useStore((s) => s.files[tab.id]);
  // Le scorciatoie dei file vivono su window: se rispondessero anche dalle
  // schede in secondo piano (sono tutte montate, solo nascoste), un Ctrl+S
  // salverebbe tutti i fogli aperti insieme.
  const isActive = useStore((s) => s.activeTabId === tab.id);
  const {
    setDraft,
    setMaxRows,
    setTxnOpen,
    setTabFile,
    setTabTitle,
    setBindValues,
    openWorksheet,
    toast,
    connect,
    openHistory,
  } = useStore.getState();
  const draft = useRef(useStore.getState().drafts[tab.id] ?? '');

  const viewRef = useRef(null);
  const [running, setRunning] = useState(false);
  const [pane, setPane] = useState('results');
  const [res, setRes] = useState(null); // { columns, rows, truncated, elapsedMs }
  const [messages, setMessages] = useState([]);
  const [scriptLog, setScriptLog] = useState('');
  const [dbmsOut, setDbmsOut] = useState('');
  const [plan, setPlan] = useState(null); // { nodes, stats, text, note, autotrace }
  // Ultima istruzione finita in griglia, già sostituita e con i suoi bind:
  // serve all'esportazione «tutte le righe», che la rilancia sul server.
  const [lastRun, setLastRun] = useState(null);
  const [exporting, setExporting] = useState(null); // { columns, rows }
  const [varsPrompt, setVarsPrompt] = useState(null); // { vars, values, plsql, resolve }
  const [dirty, setDirty] = useState(() => {
    const st = useStore.getState();
    const f = st.files[tab.id];
    return !!f && (st.drafts[tab.id] ?? '') !== f.savedText;
  });
  const connected = active?.status === 'connected';
  const readOnly = !!active?.readOnly;
  const native = canUseNativeDialogs();

  const fileRef = useRef(file);
  fileRef.current = file;

  const addMsg = (text, type = 'info') =>
    setMessages((m) => [...m, { text, type, ts: new Date().toLocaleTimeString() }]);

  const currentText = () =>
    viewRef.current ? viewRef.current.state.doc.toString() : (useStore.getState().drafts[tab.id] ?? '');

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

  // ---- variabili di bind e di sostituzione ----

  // Chiede i valori se ce n'è bisogno e restituisce la mappa confermata,
  // oppure `null` se l'utente ha annullato (e allora non si esegue niente).
  const resolveVars = (sql, plsql) => {
    const vars = [...findSubstitutions(sql), ...findBinds(sql)];
    const stored = useStore.getState().bindValues[tab.id] || {};
    if (!vars.length) return Promise.resolve(stored);
    // `&&nome` in SQL*Plus vuol dire «chiedimelo una volta sola»: se le uniche
    // variabili sono di quelle e un valore ce l'hanno già, si parte diretti.
    const toAsk = vars.some(
      (v) => !(v.kind === 'sub' && v.persistent && stored[v.name.toUpperCase()] != null)
    );
    if (!toAsk) return Promise.resolve(stored);
    return new Promise((resolve) => setVarsPrompt({ vars, values: stored, plsql: !!plsql, resolve }));
  };

  const submitVars = (values) => {
    // Si uniscono ai valori già noti invece di sostituirli: le variabili di
    // un'altra istruzione dello stesso foglio non vanno perse.
    const merged = { ...(useStore.getState().bindValues[tab.id] || {}), ...values };
    setBindValues(tab.id, merged);
    varsPrompt?.resolve(merged);
    setVarsPrompt(null);
  };

  const cancelVars = () => {
    varsPrompt?.resolve(null);
    setVarsPrompt(null);
  };

  // Riapre la finestra senza eseguire niente: serve per correggere un valore
  // prima di lanciare la query, non dopo aver visto l'errore.
  const editVars = () => {
    if (varsPrompt) return;
    const stmt = currentStatement();
    const sql = stmt ? executableSql(stmt) : '';
    const vars = [...findSubstitutions(sql), ...findBinds(sql)];
    if (!vars.length) {
      toast("L'istruzione al cursore non ha variabili", 'info');
      return;
    }
    setVarsPrompt({
      vars,
      values: useStore.getState().bindValues[tab.id] || {},
      plsql: !!stmt?.plsql,
      resolve: () => {},
    });
  };

  // Testo pronto per il server: sostituzioni espanse e bind separati.
  const prepare = async (stmt) => {
    const raw = executableSql(stmt);
    const values = await resolveVars(raw, stmt.plsql);
    if (!values) return null;
    const sql = applySubstitutions(raw, subMap(values));
    return { sql, binds: bindMap(sql, values) };
  };

  const handleResult = (r, stmt, prepared) => {
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
    if (r.outBinds && Object.keys(r.outBinds).length) {
      addMsg('Parametri restituiti:\n' + outBindsText(r.outBinds), 'binds');
    }
    if (r.columns) {
      setRes(r);
      setLastRun(prepared || null);
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
    // Con la finestra delle variabili aperta si aspetta la risposta: un
    // secondo lancio la sostituirebbe e il primo resterebbe appeso.
    if (running || !connected || varsPrompt) return;
    const stmt = currentStatement();
    if (!stmt || !stmt.text.trim()) {
      toast('Nessuna istruzione al cursore', 'error');
      return;
    }
    const prepared = await prepare(stmt);
    if (!prepared) return;
    setRunning(true);
    try {
      const r = await api.execute(connId, { sql: prepared.sql, maxRows, binds: prepared.binds });
      handleResult(r, stmt, prepared);
    } catch (err) {
      addMsg(err.message, 'error');
      setPane('messages');
      if (err.status === 409) useStore.getState().markDisconnected(connId);
    } finally {
      setRunning(false);
    }
  };

  const runScript = async () => {
    if (running || !connected || varsPrompt || !viewRef.current) return;
    const doc = viewRef.current.state.doc.toString();
    const stmts = splitStatements(doc);
    if (!stmts.length) return;
    // Le variabili si chiedono una volta sola per tutto lo script: una finestra
    // per istruzione trasformerebbe un lancio in un interrogatorio.
    const values = await resolveVars(doc, stmts.some((s) => s.plsql));
    if (!values) return;
    const subs = subMap(values);
    setRunning(true);
    setPane('script');
    let log = `-- Script: ${stmts.length} istruzioni — ${new Date().toLocaleTimeString()}\n\n`;
    setScriptLog(log);
    let lastGrid = null;
    try {
      for (const [i, stmt] of stmts.entries()) {
        log += `[${i + 1}/${stmts.length}] ${firstLine(stmt.text)}\n`;
        const sql = applySubstitutions(executableSql(stmt), subs);
        const binds = bindMap(sql, values);
        try {
          const r = await api.execute(connId, { sql, maxRows, binds });
          if (r.txnOpen != null) setTxnOpen(connId, r.txnOpen);
          if (r.dbmsOutput?.length) setDbmsOut((o) => o + r.dbmsOutput.join('\n') + '\n');
          if (r.outBinds && Object.keys(r.outBinds).length) {
            log += outBindsText(r.outBinds) + '\n';
          }
          if (r.error) {
            log += `    ERRORE: ${r.error.message}\n`;
          } else if (r.columns) {
            log += `    ${r.rows.length} righe (${r.elapsedMs} ms)\n`;
            lastGrid = { result: r, prepared: { sql, binds } };
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
      if (lastGrid) {
        setRes(lastGrid.result);
        setLastRun(lastGrid.prepared);
      }
    } finally {
      setRunning(false);
    }
  };

  // Con l'autotrace acceso l'istruzione viene eseguita davvero e il piano
  // riporta i numeri reali; da spenta è il solo EXPLAIN PLAN, che non esegue
  // niente (e quindi si può lanciare anche su una DELETE).
  const explain = async () => {
    if (running || !connected || varsPrompt) return;
    const stmt = currentStatement();
    if (!stmt?.text.trim()) {
      toast('Nessuna istruzione al cursore', 'error');
      return;
    }
    const prepared = await prepare(stmt);
    if (!prepared) return;
    const trace = ui.autotrace;
    setRunning(true);
    try {
      const r = trace
        ? await api.autotrace(connId, { sql: prepared.sql, binds: prepared.binds, maxRows })
        : await api.explain(connId, { sql: prepared.sql, binds: prepared.binds });
      if (r.txnOpen != null) setTxnOpen(connId, r.txnOpen);
      if (r.dbmsOutput?.length) setDbmsOut((o) => o + r.dbmsOutput.join('\n') + '\n');
      if (r.error) {
        addMsg(r.error.message, 'error');
        setPane('messages');
        return;
      }
      setPlan({
        nodes: r.nodes || [],
        stats: r.stats || [],
        text: r.text || '',
        note: r.note || '',
        autotrace: trace,
      });
      setPane('plan');
      if (trace) {
        addMsg(
          `${firstLine(stmt.text)} — autotrace: ${r.rowsFetched ?? 0} righe lette in ${r.elapsedMs} ms`,
          'ok'
        );
      }
    } catch (err) {
      addMsg(err.message, 'error');
      setPane('messages');
      if (err.status === 409) useStore.getState().markDisconnected(connId);
    } finally {
      setRunning(false);
    }
  };

  // ---- file .sql ----

  const suggestedName = () => `${(conn?.name || 'foglio').replace(/[\\/:*?"<>|]+/g, '-')}.sql`;

  const doOpen = async () => {
    try {
      const f = await openSqlFile();
      if (!f) return;
      // Scheda nuova, non il foglio corrente: quello che si sta scrivendo non
      // va perso solo perché si è aperto un file per guardarlo.
      openWorksheet(connId, f.text, { file: { path: f.path, name: f.name, savedText: f.text } });
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const saveTo = async (target) => {
    const text = currentText();
    try {
      const saved = await saveSqlFile({ ...target, text });
      if (!saved) return;
      setTabFile(tab.id, { path: saved.path, name: saved.name, savedText: text });
      setTabTitle(tab.id, saved.name);
      setDirty(false);
      toast(`Salvato in ${saved.name}`, 'ok');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  // Con un file già legato al foglio si salva lì senza chiedere niente; senza,
  // «Salva» e «Salva con nome…» sono la stessa cosa.
  const doSave = () =>
    saveTo(fileRef.current ? { path: fileRef.current.path, name: fileRef.current.name } : { name: suggestedName() });
  const doSaveAs = () => saveTo({ name: fileRef.current?.name || suggestedName() });

  // Le scorciatoie vengono registrate una volta sola e chiamano l'ultima
  // versione delle funzioni: senza il riferimento vedrebbero il nome del file
  // com'era al momento della registrazione.
  const actionsRef = useRef({});
  actionsRef.current = { doOpen, doSave, doSaveAs };

  useEffect(() => {
    if (!isActive) return undefined;
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = (e.key || '').toLowerCase();
      if (k === 'o') {
        e.preventDefault();
        actionsRef.current.doOpen();
      } else if (k === 's') {
        e.preventDefault();
        if (e.shiftKey) actionsRef.current.doSaveAs();
        else actionsRef.current.doSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isActive]);

  const onEditorChange = (text) => {
    setDraft(tab.id, text);
    const saved = fileRef.current?.savedText;
    setDirty(saved != null && text !== saved);
  };

  // ---- transazione ----

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

  const txnTitle = readOnly
    ? 'Connessione in sola lettura: non ci sono modifiche da confermare o annullare'
    : null;

  return (
    <div className="worksheet">
      <div className="ws-toolbar">
        <button className="btn run" onClick={run} disabled={running || !connected} title="Esegui istruzione (Ctrl+Invio / F9)">
          <Play size={13} /> Esegui
        </button>
        <button className="btn" onClick={runScript} disabled={running || !connected} title="Esegui script (F5)">
          <FastForward size={13} /> Script
        </button>
        <button
          className="btn"
          onClick={explain}
          disabled={running || !connected}
          title={
            ui.autotrace
              ? "Esegue l'istruzione e ne mostra il piano con i numeri reali (autotrace)"
              : "Piano di esecuzione stimato (EXPLAIN PLAN): non esegue l'istruzione"
          }
        >
          Piano
        </button>
        <button
          className={`btn ws-toggle ${ui.autotrace ? 'on' : ''}`}
          onClick={() => setUi({ autotrace: !ui.autotrace })}
          aria-pressed={ui.autotrace}
          title={
            ui.autotrace
              ? "Autotrace acceso: il pulsante Piano esegue davvero l'istruzione"
              : 'Autotrace spento: il pulsante Piano si ferma alla stima'
          }
        >
          <Activity size={13} /> Autotrace
        </button>
        <button className="icon-btn" onClick={editVars} title="Variabili di bind e di sostituzione">
          <Variable size={14} />
        </button>
        <span className="ws-sep" />
        <button className="btn" onClick={doOpen} title="Apri un file .sql in una nuova scheda (Ctrl+O)">
          <FolderOpen size={13} /> Apri…
        </button>
        <button
          className="btn"
          onClick={doSave}
          title={
            native
              ? 'Salva il foglio nel file .sql (Ctrl+S)'
              : 'Salva il foglio: nel browser il file viene scaricato (Ctrl+S)'
          }
        >
          <Save size={13} /> Salva
        </button>
        <button className="btn" onClick={doSaveAs} title="Salva con nome… (Ctrl+Maiusc+S)">
          Salva con nome…
        </button>
        <span className="ws-sep" />
        <button className="btn" onClick={() => openHistory(connId)} title="Cronologia query di questa connessione">
          <History size={13} /> Cronologia
        </button>
        <span className="ws-sep" />
        <button className="btn" onClick={doCommit} disabled={!connected || readOnly} title={txnTitle || 'Commit'}>
          Commit
        </button>
        <button className="btn" onClick={doRollback} disabled={!connected || readOnly} title={txnTitle || 'Rollback'}>
          Rollback
        </button>
        {running && (
          <button className="btn danger" onClick={doCancel}>
            <Square size={12} /> Annulla
          </button>
        )}
        <div style={{ flex: 1 }} />
        {/* Nel browser `path` è la chiave interna dell'handle (`fsa:…`), che
            non vuol dire niente per chi legge: si mostra solo un percorso vero. */}
        {file && (
          <span
            className="ws-file"
            title={file.path?.startsWith('fsa:') ? file.name : file.path || file.name}
          >
            {file.name}
            {dirty && <span className="ws-file-dot" title="Modifiche non salvate" />}
          </span>
        )}
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
        {readOnly && (
          <span
            className="ws-readonly"
            title="Connessione aperta in sola lettura: il server rifiuta le istruzioni che scrivono"
          >
            <Lock size={11} /> sola lettura
          </span>
        )}
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
          connId={connId}
          onChange={onEditorChange}
          onRun={run}
          onRunScript={runScript}
          onViewReady={(v) => (viewRef.current = v)}
        />
      </div>

      {ui.results && (
        <Resizer
          direction="up"
          value={ui.resultsHeight}
          onChange={(v) => setUi({ resultsHeight: v })}
          onReset={() => setUi({ resultsHeight: 280 })}
          min={90}
          max={900}
        />
      )}

      <div className="ws-results" style={{ height: ui.results ? ui.resultsHeight : undefined }}>
        <div className="pane-tabs">
          <button className={pane === 'results' ? 'on' : ''} onClick={() => setPane('results')}>
            Risultati
            {res && <span className="pane-info">{res.rows.length}{res.truncated ? '+' : ''}</span>}
          </button>
          <button className={pane === 'messages' ? 'on' : ''} onClick={() => setPane('messages')}>
            Messaggi{messages.length ? ` (${messages.length})` : ''}
          </button>
          <button className={pane === 'plan' ? 'on' : ''} onClick={() => setPane('plan')}>
            Piano
            {plan?.autotrace && <span className="pane-info">autotrace</span>}
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
              <DecodeEntitiesToggle />
              <button className="mini-btn" onClick={() => exportCsv(res.columns, res.rows)}>
                CSV
              </button>
              <button
                className="mini-btn"
                onClick={() => setExporting({ columns: res.columns, rows: res.rows })}
                title="Esporta in altri formati, anche oltre le righe già caricate"
              >
                Esporta…
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
          <button
            className="icon-btn"
            title={ui.results ? 'Riduci i risultati (Ctrl+J)' : 'Mostra i risultati (Ctrl+J)'}
            onClick={() => setUi({ results: !ui.results })}
          >
            <ChevronDown size={13} className={`ai-chev ${ui.results ? '' : 'open'}`} />
          </button>
        </div>
        <div className="pane-body" hidden={!ui.results}>
          {pane === 'results' &&
            (res ? (
              <Grid
                columns={res.columns}
                rows={res.rows}
                onExport={(columns, rows) => setExporting({ columns, rows })}
              />
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
          {pane === 'plan' &&
            (plan ? (
              <div className="plan-pane">
                {/* Il piano c'è lo stesso: la nota dice solo che mancano i
                    privilegi per la parte più ricca (di solito le statistiche
                    reali), e non è un errore da schermata rossa. */}
                {plan.note && <div className="plan-note">{plan.note}</div>}
                <PlanTree nodes={plan.nodes} stats={plan.stats} text={plan.text} />
              </div>
            ) : (
              <div className="grid-empty">Premi «Piano» per il piano di esecuzione dell'istruzione al cursore</div>
            ))}
          {pane === 'script' && (
            <pre className="script-log">{scriptLog || 'Nessuno script eseguito'}</pre>
          )}
          {pane === 'dbms' && <pre className="script-log">{dbmsOut || 'Nessun output'}</pre>}
        </div>
      </div>

      {varsPrompt && (
        <BindVarsDialog
          vars={varsPrompt.vars}
          values={varsPrompt.values}
          plsql={varsPrompt.plsql}
          onSubmit={submitVars}
          onClose={cancelVars}
        />
      )}

      {exporting && (
        <ExportDialog
          connId={connId}
          columns={exporting.columns}
          rows={exporting.rows}
          source={lastRun ? { kind: 'sql', sql: lastRun.sql, binds: lastRun.binds } : undefined}
          defaultName="risultato"
          onClose={() => setExporting(null)}
        />
      )}
    </div>
  );
}
