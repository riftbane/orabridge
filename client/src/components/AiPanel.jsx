import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Database,
  Loader2,
  Maximize2,
  Minimize2,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Square,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.js';
import AiMarkdown from './AiMarkdown.jsx';

const PERMISSIONS = [
  { key: 'read', label: 'Lettura', hint: 'Struttura, DDL e SELECT' },
  { key: 'write', label: 'Scrittura', hint: 'INSERT, UPDATE, CREATE, ALTER' },
  { key: 'danger', label: 'DELETE e DROP', hint: 'Operazioni distruttive', danger: true },
];

const LEVEL_LABEL = { read: 'lettura', write: 'scrittura', danger: 'DELETE/DROP' };

const TOOL_LABEL = {
  list_schemas: 'Elenco schemi',
  list_objects: 'Elenco oggetti',
  describe_table: 'Struttura tabella',
  get_source: 'Sorgente',
  get_ddl: 'DDL',
  run_query: 'Query',
  execute_sql: 'Esecuzione SQL',
};

// Riepilogo di una chiamata su una riga sola, come la barra attività di Copilot.
function toolSummary(name, input = {}) {
  if (input.sql) return String(input.sql).replace(/\s+/g, ' ').slice(0, 120);
  const parts = [input.owner, input.name || input.type].filter(Boolean);
  return parts.join('.') || TOOL_LABEL[name] || name;
}

function Menu({ open, onClose, children, align = 'left' }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const esc = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className={`ai-menu ${align}`} ref={ref}>
      {children}
    </div>
  );
}

function ToolCard({ call, result }) {
  const [open, setOpen] = useState(false);
  const running = !result;
  return (
    <div className={`ai-tool ${running ? 'running' : result.isError ? 'err' : 'ok'}`}>
      <button className="ai-tool-head" onClick={() => setOpen((o) => !o)}>
        {running ? <Loader2 size={12} className="spin" /> : <Terminal size={12} />}
        <span className="ai-tool-name">{TOOL_LABEL[call.name] || call.name}</span>
        <span className="ai-tool-sum">{toolSummary(call.name, call.input)}</span>
        <ChevronDown size={12} className={`ai-chev ${open ? 'open' : ''}`} />
      </button>
      {open && (
        <div className="ai-tool-body">
          {call.input?.sql && <pre className="ai-tool-sql">{call.input.sql}</pre>}
          <pre className="ai-tool-out">{running ? 'In esecuzione…' : result.content}</pre>
        </div>
      )}
    </div>
  );
}

function Approval({ pending, onDecide, busy }) {
  const sql = pending.input?.sql;
  return (
    <div className={`ai-approval ${pending.level === 'danger' ? 'danger' : ''}`}>
      <div className="ai-approval-head">
        {pending.level === 'danger' ? <AlertTriangle size={14} /> : <ShieldCheck size={14} />}
        <span>
          L'assistente chiede il permesso di <strong>{LEVEL_LABEL[pending.level]}</strong>
          {pending.statement ? ` (${pending.statement})` : ''}
        </span>
      </div>
      {sql ? (
        <pre className="ai-approval-sql">{sql}</pre>
      ) : (
        <p className="ai-approval-sub">{TOOL_LABEL[pending.name] || pending.name}</p>
      )}
      <div className="ai-approval-actions">
        <button className="btn primary" disabled={busy} onClick={() => onDecide(true, false)}>
          Consenti una volta
        </button>
        <button className="btn" disabled={busy} onClick={() => onDecide(true, true)}>
          Consenti sempre
        </button>
        <button className="btn danger" disabled={busy} onClick={() => onDecide(false, false)}>
          Rifiuta
        </button>
      </div>
    </div>
  );
}

export default function AiPanel({ hidden, onOpenSettings }) {
  const conns = useStore((s) => s.conns);
  const active = useStore((s) => s.active);
  const sessionId = useStore((s) => s.aiSessionId);
  const ui = useStore((s) => s.ui);
  const { setAiSession, toggleUi, openWorksheet, toast } = useStore.getState();

  const [sessions, setSessions] = useState([]);
  const [session, setSession] = useState(null);
  const [draft, setDraft] = useState('');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [menu, setMenu] = useState(null); // 'model' | 'perms' | 'conn'
  const [models, setModels] = useState([]);
  const [modelSearch, setModelSearch] = useState('');
  const [loadingModels, setLoadingModels] = useState(false);
  const [cfg, setCfg] = useState(null);
  const [liveResults, setLiveResults] = useState({});
  const scroller = useRef(null);

  const refreshSessions = useCallback(async () => {
    try {
      const r = await api.aiSessions();
      setSessions(r.sessions);
      return r.sessions;
    } catch {
      return [];
    }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      setCfg(await api.aiSettings());
    } catch {
      /* server non raggiungibile: il pannello mostra comunque lo stato vuoto */
    }
  }, []);

  useEffect(() => {
    refreshSessions();
    loadSettings();
  }, [refreshSessions, loadSettings]);

  // Flusso di eventi della sessione aperta. Il server continua a lavorare anche
  // a pannello chiuso: alla riapertura lo snapshot iniziale riallinea tutto.
  useEffect(() => {
    if (!sessionId) {
      setSession(null);
      return undefined;
    }
    setDraft('');
    setLiveResults({});
    const es = new EventSource(api.aiEventsUrl(sessionId));
    es.onmessage = (e) => {
      let ev;
      try {
        ev = JSON.parse(e.data);
      } catch {
        return;
      }
      if (ev.type === 'session') {
        setSession(ev.session);
        setDraft('');
      } else if (ev.type === 'message') {
        setSession((s) => (s ? { ...s, messages: [...s.messages, ev.message] } : s));
        setDraft('');
      } else if (ev.type === 'delta') {
        setDraft((d) => d + ev.text);
      } else if (ev.type === 'status') {
        setSession((s) => (s ? { ...s, status: ev.status, pending: ev.pending, error: ev.error } : s));
        if (ev.status !== 'running') setDraft('');
        refreshSessions();
      } else if (ev.type === 'tool_result') {
        setLiveResults((r) => ({ ...r, [ev.id]: { content: ev.content, isError: ev.isError } }));
      }
    };
    return () => es.close();
  }, [sessionId, refreshSessions]);

  // Elenco modelli della piattaforma della sessione corrente.
  const loadModels = useCallback(async (provider, refresh) => {
    if (!provider) return;
    setLoadingModels(true);
    try {
      const r = await api.aiModels(provider, refresh);
      setModels(r.models || []);
    } catch {
      setModels([]);
    } finally {
      setLoadingModels(false);
    }
  }, []);

  useEffect(() => {
    if (session?.provider) loadModels(session.provider, false);
  }, [session?.provider, loadModels]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [session?.messages?.length, draft, session?.pending]);

  const connected = conns.filter((c) => active[c.id]?.status === 'connected');

  const newSession = async () => {
    const connId = session?.connId || connected[0]?.id || null;
    try {
      const s = await api.aiCreateSession({ connId });
      setAiSession(s.id);
      setSession(s);
      refreshSessions();
      setListOpen(false);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const patchSession = async (patch) => {
    if (!session) return;
    try {
      const s = await api.aiUpdateSession(session.id, patch);
      setSession((cur) => ({ ...cur, ...s }));
      refreshSessions();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const removeSession = async (id) => {
    if (!window.confirm('Eliminare questa sessione?')) return;
    await api.aiDeleteSession(id).catch(() => {});
    const list = await refreshSessions();
    if (id === sessionId) setAiSession(list[0]?.id || null);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    let target = session;
    if (!target) {
      try {
        target = await api.aiCreateSession({ connId: connected[0]?.id || null });
        setAiSession(target.id);
        setSession(target);
      } catch (err) {
        toast(err.message, 'error');
        return;
      }
    }
    setBusy(true);
    setInput('');
    try {
      await api.aiSend(target.id, text);
      refreshSessions();
    } catch (err) {
      setInput(text);
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const decide = async (approve, remember) => {
    setBusy(true);
    try {
      await api.aiApprove(session.id, { approve, remember });
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  // Esito di ogni chiamata: dai messaggi salvati, con in più quelli arrivati
  // in diretta prima che il messaggio venisse chiuso.
  const results = useMemo(() => {
    const map = { ...liveResults };
    for (const m of session?.messages || []) {
      for (const b of m.content || []) {
        if (b.type === 'tool_result') map[b.toolUseId] = { content: b.content, isError: b.isError };
      }
    }
    return map;
  }, [session?.messages, liveResults]);

  const filteredSessions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? sessions.filter((s) => s.title.toLowerCase().includes(q)) : sessions;
  }, [sessions, search]);

  const filteredModels = useMemo(() => {
    const q = modelSearch.trim().toLowerCase();
    return (q ? models.filter((m) => `${m.id} ${m.label}`.toLowerCase().includes(q)) : models).slice(
      0,
      200
    );
  }, [models, modelSearch]);

  const running = session?.status === 'running';
  const conn = conns.find((c) => c.id === session?.connId);
  const providerLabel = cfg?.info?.[session?.provider]?.label || session?.provider || '—';
  const hasKey = cfg?.providers?.find((p) => p.id === session?.provider)?.hasKey;

  return (
    <aside
      className={`ai-panel ${ui.aiFull ? 'full' : ''}`}
      style={{ width: ui.aiFull ? undefined : ui.aiWidth, display: hidden ? 'none' : undefined }}
    >
      <div className="ai-head">
        <span className="ai-head-title">CHAT</span>
        <div className="ai-head-actions">
          <button className="icon-btn" title="Nuova sessione" onClick={newSession}>
            <Plus size={14} />
          </button>
          <button className="icon-btn" title="Impostazioni assistente" onClick={onOpenSettings}>
            <Settings size={13} />
          </button>
          <button
            className={`icon-btn ${listOpen ? 'on' : ''}`}
            title="Sessioni"
            onClick={() => setListOpen((o) => !o)}
          >
            <Search size={13} />
          </button>
          <button
            className="icon-btn"
            title={ui.aiFull ? 'Riduci il pannello' : 'Allarga il pannello'}
            onClick={() => toggleUi('aiFull')}
          >
            {ui.aiFull ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
          <button className="icon-btn" title="Chiudi il pannello" onClick={() => toggleUi('ai')}>
            <X size={14} />
          </button>
        </div>
      </div>

      {listOpen && (
        <div className="ai-sessions">
          <div className="ai-sessions-head">
            <span>SESSIONI</span>
            <button className="icon-btn" title="Aggiorna" onClick={refreshSessions}>
              <RefreshCw size={12} />
            </button>
          </div>
          <div className="sidebar-search">
            <Search size={12} className="sidebar-search-icon" />
            <input
              className="sidebar-search-input"
              placeholder="Cerca sessioni…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="ai-session-list">
            {!filteredSessions.length && <div className="ai-empty-small">Nessuna sessione</div>}
            {filteredSessions.map((s) => (
              <div
                key={s.id}
                className={`ai-session-row ${s.id === sessionId ? 'on' : ''}`}
                onClick={() => {
                  setAiSession(s.id);
                  setListOpen(false);
                }}
              >
                <span className={`ai-dot ${s.status}`} title={s.status} />
                <span className="ai-session-title">{s.title}</span>
                <span className="ai-session-meta">{s.messages}</span>
                <button
                  className="icon-btn danger"
                  title="Elimina"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeSession(s.id);
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="ai-messages" ref={scroller}>
        {!session && (
          <div className="ai-welcome">
            <Sparkle />
            <h3>Assistente Orabridge</h3>
            <p>
              Chiedi di esplorare lo schema, scrivere una query o preparare una modifica. Gli
              strumenti girano sulla connessione scelta qui sotto, nei limiti dei permessi concessi.
            </p>
            <div className="ai-examples">
              {[
                'Quali tabelle contengono i dati dei clienti?',
                'Scrivi una query con le fatture non pagate degli ultimi 30 giorni',
                'Descrivi la struttura della tabella ORDINI e le sue foreign key',
              ].map((t) => (
                <button key={t} className="ai-example" onClick={() => setInput(t)}>
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}

        {session?.messages?.map((m, i) => {
          const texts = (m.content || []).filter((b) => b.type === 'text');
          const calls = (m.content || []).filter((b) => b.type === 'tool_use');
          if (!texts.length && !calls.length) return null;
          return (
            <div key={i} className={`ai-msg ${m.role}`}>
              {texts.map((b, j) =>
                m.role === 'user' ? (
                  <div key={j} className="ai-user-text">
                    {b.text}
                  </div>
                ) : (
                  <AiMarkdown
                    key={j}
                    text={b.text}
                    onOpenSql={(sql) =>
                      session.connId
                        ? openWorksheet(session.connId, sql)
                        : toast('Nessuna connessione associata alla sessione', 'error')
                    }
                  />
                )
              )}
              {calls.map((c) => (
                <ToolCard key={c.id} call={c} result={results[c.id]} />
              ))}
            </div>
          );
        })}

        {draft && (
          <div className="ai-msg assistant">
            <AiMarkdown text={draft} />
          </div>
        )}
        {running && !draft && (
          <div className="ai-thinking">
            <Loader2 size={13} className="spin" /> L'assistente sta lavorando…
          </div>
        )}
        {session?.error && (
          <div className="ai-error">
            <AlertTriangle size={13} /> {session.error}
          </div>
        )}
        {session?.pending && <Approval pending={session.pending} onDecide={decide} busy={busy} />}
      </div>

      {session && !hasKey && cfg && (
        <div className="ai-warn">
          Nessuna API key per {providerLabel}.{' '}
          <button className="link-btn" onClick={onOpenSettings}>
            Configurala nelle impostazioni
          </button>
        </div>
      )}

      <div className="ai-composer">
        <textarea
          rows={3}
          placeholder="Descrivi cosa vuoi fare…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="ai-composer-bar">
          <div className="ai-pick">
            <button className="ai-chip" onClick={() => setMenu(menu === 'conn' ? null : 'conn')}>
              <Database size={11} />
              {conn ? conn.name : 'Nessun DB'}
              <ChevronDown size={10} />
            </button>
            <Menu open={menu === 'conn'} onClose={() => setMenu(null)}>
              <div className="ai-menu-head">Connessione</div>
              <button
                className={`ai-menu-item ${!session?.connId ? 'on' : ''}`}
                onClick={() => {
                  patchSession({ connId: null });
                  setMenu(null);
                }}
              >
                {!session?.connId && <Check size={11} />} Nessuna (solo conversazione)
              </button>
              {conns.map((c) => (
                <button
                  key={c.id}
                  className={`ai-menu-item ${session?.connId === c.id ? 'on' : ''}`}
                  onClick={() => {
                    patchSession({ connId: c.id });
                    setMenu(null);
                  }}
                >
                  {session?.connId === c.id && <Check size={11} />}
                  <span>{c.name}</span>
                  <span className={`ai-dot ${active[c.id]?.status === 'connected' ? 'idle' : 'off'}`} />
                </button>
              ))}
            </Menu>
          </div>

          <div className="ai-pick">
            <button className="ai-chip" onClick={() => setMenu(menu === 'model' ? null : 'model')}>
              {session?.model || 'Scegli modello'}
              <ChevronDown size={10} />
            </button>
            <Menu open={menu === 'model'} onClose={() => setMenu(null)}>
              <div className="ai-menu-head">Piattaforma</div>
              <div className="ai-provider-row">
                {(cfg?.providers || []).map((p) => (
                  <button
                    key={p.id}
                    className={`ai-provider ${session?.provider === p.id ? 'on' : ''} ${p.hasKey ? '' : 'nokey'}`}
                    onClick={() => patchSession({ provider: p.id })}
                    title={p.hasKey ? '' : 'Nessuna API key configurata'}
                  >
                    {cfg.info[p.id]?.label || p.id}
                  </button>
                ))}
              </div>
              <div className="ai-menu-search">
                <Search size={11} />
                <input
                  autoFocus
                  placeholder="Cerca modelli"
                  value={modelSearch}
                  onChange={(e) => setModelSearch(e.target.value)}
                />
                <button
                  className="icon-btn"
                  title="Ricarica l'elenco"
                  onClick={() => loadModels(session?.provider, true)}
                >
                  <RefreshCw size={11} className={loadingModels ? 'spin' : ''} />
                </button>
              </div>
              <div className="ai-menu-list">
                {loadingModels && <div className="ai-empty-small">Caricamento…</div>}
                {!loadingModels && !filteredModels.length && (
                  <div className="ai-empty-small">Nessun modello: controlla la API key.</div>
                )}
                {filteredModels.map((m) => (
                  <button
                    key={m.id}
                    className={`ai-menu-item ${session?.model === m.id ? 'on' : ''}`}
                    onClick={() => {
                      patchSession({ model: m.id });
                      setMenu(null);
                    }}
                  >
                    {session?.model === m.id && <Check size={11} />}
                    <span className="ai-model-name">{m.label || m.id}</span>
                    {m.context ? <span className="ai-model-ctx">{Math.round(m.context / 1000)}k</span> : null}
                  </button>
                ))}
              </div>
            </Menu>
          </div>

          <div className="ai-pick">
            <button className="ai-chip" onClick={() => setMenu(menu === 'perms' ? null : 'perms')}>
              <ShieldCheck size={11} />
              {PERMISSIONS.filter((p) => session?.permissions?.[p.key]).length || 0}/3
              <ChevronDown size={10} />
            </button>
            <Menu open={menu === 'perms'} onClose={() => setMenu(null)} align="right">
              <div className="ai-menu-head">Permessi di esecuzione</div>
              {PERMISSIONS.map((p) => (
                <label key={p.key} className={`ai-perm ${p.danger ? 'danger' : ''}`}>
                  <input
                    type="checkbox"
                    checked={!!session?.permissions?.[p.key]}
                    disabled={!session}
                    onChange={(e) => patchSession({ permissions: { [p.key]: e.target.checked } })}
                  />
                  <span>
                    <strong>{p.label}</strong>
                    <em>{p.hint}</em>
                  </span>
                </label>
              ))}
              <div className="ai-menu-foot">
                Quello che manca viene chiesto in chat al momento del bisogno.
              </div>
            </Menu>
          </div>

          <div style={{ flex: 1 }} />

          {running ? (
            <button
              className="btn danger ai-send"
              onClick={() => api.aiStop(session.id).catch(() => {})}
              title="Interrompi"
            >
              <Square size={12} /> Stop
            </button>
          ) : (
            <button
              className="btn primary ai-send"
              onClick={send}
              disabled={!input.trim() || busy}
              title="Invia (Invio)"
            >
              <Send size={12} />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}

function Sparkle() {
  return (
    <div className="ai-welcome-logo">
      <span className="logo-ora">Ora</span>bridge AI
    </div>
  );
}
