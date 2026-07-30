import React, { useEffect, useState } from 'react';
import {
  BookOpen,
  Check,
  Copy,
  Download,
  HardDrive,
  Info,
  KeyRound,
  Plug,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.js';
import AboutPanel from './AboutPanel.jsx';
import GuideView from './GuideView.jsx';

const PERMISSIONS = [
  {
    key: 'read',
    label: 'Lettura',
    hint: 'Struttura del database, DDL e SELECT sui dati.',
  },
  {
    key: 'write',
    label: 'Scrittura',
    hint: 'INSERT, UPDATE, MERGE, CREATE, ALTER. Nessun commit automatico.',
  },
  {
    key: 'danger',
    label: 'DELETE e DROP',
    hint: 'Cancellazione di righe e di oggetti: da concedere solo se sai cosa stai facendo.',
    danger: true,
  },
];

const gb = (n) => `${(n / 1e9).toFixed(1)} GB`;

// Modelli che girano sul computer: niente chiave, niente costi, ma il file dei
// pesi va scaricato una volta (qualche GB). Il download prosegue lato server,
// quindi si può chiudere questa finestra senza interromperlo.
function LocalModels({ toast, onInstalledChange }) {
  const [engine, setEngine] = useState(null); // null = ancora da sapere
  const [models, setModels] = useState([]);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    let alive = true;
    api
      .aiLocalModels()
      .then((r) => {
        if (!alive) return;
        setEngine(r.engine);
        setModels(r.models || []);
      })
      .catch((err) => toast(err.message, 'error'));

    // L'avanzamento arriva dal server: così la barra è giusta anche se il
    // download era già in corso quando si è aperta la finestra.
    const es = new EventSource(api.aiLocalEventsUrl());
    es.onmessage = (ev) => {
      const d = JSON.parse(ev.data);
      if (d.type === 'models') setModels(d.models);
      else if (d.type === 'model') {
        setModels((cur) => cur.map((m) => (m.id === d.model.id ? d.model : m)));
      }
    };
    return () => {
      alive = false;
      es.close();
    };
  }, [toast]);

  // Scaricare o cancellare un modello cambia l'elenco di quelli selezionabili.
  // La callback arriva inline dal genitore (identità nuova a ogni render): si
  // tiene in un ref, altrimenti l'effetto si riattiverebbe all'infinito.
  const installed = models.filter((m) => m.installed).length;
  const notify = React.useRef(onInstalledChange);
  notify.current = onInstalledChange;
  const known = React.useRef(null);
  useEffect(() => {
    // Il primo conteggio è solo lo stato iniziale, non un cambiamento.
    if (known.current !== null && known.current !== installed) notify.current?.(installed);
    known.current = installed;
  }, [installed]);

  const act = async (id, fn, done) => {
    setBusy(id);
    try {
      await fn(id);
      if (done) toast(done, 'ok');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="settings-section">
      <h4>
        <HardDrive size={13} /> Modelli sul tuo computer
      </h4>
      <p className="settings-hint">
        Girano dentro Orabridge, senza internet e senza costi: nessuna chiave da inserire e nessun
        dato che esce dal tuo computer. In cambio sono molto più lenti e meno precisi dei modelli
        online, soprattutto su SQL complesso. Il motore è già installato, va scaricato una volta
        solo il file del modello.
      </p>
      {engine === false && (
        <p className="settings-warn">
          Il motore per i modelli locali non è disponibile in questa installazione: è incluso
          nell'app desktop per Windows, non nella versione in Docker.
        </p>
      )}
      <div className="local-models">
        {models.map((m) => {
          const pct = m.bytes ? Math.min(100, Math.round((m.partialBytes / m.bytes) * 100)) : 0;
          return (
            <div key={m.id} className={`local-model ${m.installed ? 'on' : ''}`}>
              <div className="local-model-head">
                <span className="local-model-name">
                  {m.label}
                  {m.installed && (
                    <span className="local-model-badge">
                      <Check size={10} /> scaricato
                    </span>
                  )}
                </span>
                <span className="local-model-size">{gb(m.bytes)}</span>
              </div>
              <p className="local-model-note">
                {m.note} Servono almeno {m.minRamGb} GB di RAM.
              </p>
              {m.downloading && (
                <div className="local-progress">
                  <div className="local-progress-bar" style={{ width: `${pct}%` }} />
                  <span>
                    {pct}% — {gb(m.partialBytes)} di {gb(m.bytes)}
                  </span>
                </div>
              )}
              {m.error && <p className="settings-warn">{m.error}</p>}
              <div className="local-model-actions">
                {m.downloading ? (
                  <button className="btn" onClick={() => act(m.id, api.aiLocalCancel)}>
                    Interrompi
                  </button>
                ) : m.installed ? (
                  <button
                    className="btn danger"
                    disabled={busy === m.id}
                    onClick={() => {
                      if (!window.confirm(`Eliminare il file di ${m.label} (${gb(m.bytes)})?`)) return;
                      act(m.id, api.aiLocalRemove, 'Modello eliminato');
                    }}
                  >
                    <Trash2 size={12} /> Elimina
                  </button>
                ) : (
                  <button
                    className="btn primary"
                    disabled={busy === m.id || engine === false}
                    onClick={() =>
                      act(m.id, api.aiLocalDownload, 'Download avviato: puoi chiudere le impostazioni')
                    }
                  >
                    <Download size={12} />
                    {m.partialBytes > 0 ? ' Riprendi il download' : ' Scarica'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function AiSettings({ toast }) {
  const [cfg, setCfg] = useState(null);
  const [provider, setProvider] = useState(null);
  const [key, setKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [models, setModels] = useState([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .aiSettings()
      .then((s) => {
        setCfg(s);
        setProvider(s.provider);
      })
      .catch((err) => toast(err.message, 'error'));
  }, [toast]);

  // Cambiando piattaforma si azzera il campo chiave (non torna mai dal server)
  // e si ricarica l'elenco modelli di quella piattaforma.
  useEffect(() => {
    if (!cfg || !provider) return;
    setKey('');
    setBaseUrl(cfg.baseUrls?.[provider] || '');
    loadModels(provider, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, cfg]);

  const loadModels = async (p, refresh) => {
    setLoadingModels(true);
    setModelsError(null);
    try {
      const r = await api.aiModels(p, refresh);
      setModels(r.models || []);
      if (r.error) setModelsError(r.error);
    } catch (err) {
      setModelsError(err.message);
      setModels([]);
    } finally {
      setLoadingModels(false);
    }
  };

  const patch = (p) => setCfg((c) => ({ ...c, ...p }));

  const persist = async (body, silent) => {
    setSaving(true);
    try {
      const next = await api.saveAiSettings(body);
      setCfg((c) => ({ ...next, info: c.info }));
      if (!silent) toast('Impostazioni salvate', 'ok');
      return next;
    } catch (err) {
      toast(err.message, 'error');
      return null;
    } finally {
      setSaving(false);
    }
  };

  if (!cfg) return <div className="settings-loading">Caricamento…</div>;

  const info = cfg.info[provider] || {};
  const hasKey = cfg.providers.find((p) => p.id === provider)?.hasKey;
  const model = cfg.models[provider] || '';
  // Il modello locale non ha né chiave né endpoint: al loro posto va la
  // gestione dei file scaricati.
  const keyless = !!info.keyless;

  const saveKey = async () => {
    if (!key.trim()) return;
    const next = await persist({ keys: { [provider]: key.trim() } }, true);
    if (next) {
      setKey('');
      toast(`Chiave ${info.label} salvata`, 'ok');
      loadModels(provider, true);
    }
  };

  const removeKey = async () => {
    if (!window.confirm(`Rimuovere la chiave API di ${info.label}?`)) return;
    const next = await persist({ keys: { [provider]: null } }, true);
    if (next) {
      toast('Chiave rimossa', 'ok');
      setModels([]);
    }
  };

  return (
    <div className="settings-body">
      <section className="settings-section">
        <h4>Piattaforma</h4>
        <p className="settings-hint">
          L'assistente parla con la piattaforma scelta qui. Le chiavi restano cifrate sul server e
          non vengono mai inviate al browser.
        </p>
        <div className="provider-grid">
          {cfg.providers.map((p) => (
            <button
              key={p.id}
              className={`provider-card ${p.id === provider ? 'on' : ''}`}
              onClick={() => setProvider(p.id)}
            >
              <span className="provider-name">{cfg.info[p.id]?.label || p.id}</span>
              <span className={`provider-state ${p.hasKey ? 'ok' : ''}`}>
                {p.keyless ? (
                  <>
                    <Check size={11} /> gratis, senza chiave
                  </>
                ) : p.hasKey ? (
                  <>
                    <Check size={11} /> configurata
                  </>
                ) : (
                  'nessuna chiave'
                )}
              </span>
            </button>
          ))}
        </div>
        <label className="settings-row">
          <span>Piattaforma predefinita per le nuove sessioni</span>
          <select
            value={cfg.provider}
            onChange={(e) => persist({ provider: e.target.value })}
          >
            {cfg.providers.map((p) => (
              <option key={p.id} value={p.id}>
                {cfg.info[p.id]?.label || p.id}
              </option>
            ))}
          </select>
        </label>
      </section>

      {keyless ? (
        <LocalModels toast={toast} onInstalledChange={() => loadModels(provider, true)} />
      ) : (
      <section className="settings-section">
        <h4>
          <KeyRound size={13} /> {info.keyLabel || 'API key'}
        </h4>
        <p className="settings-hint">{info.keyHint}</p>
        <div className="key-row">
          <input
            type="password"
            placeholder={hasKey ? '•••••••••••••••• (chiave salvata)' : 'Incolla qui la chiave'}
            value={key}
            autoComplete="off"
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && saveKey()}
          />
          <button className="btn primary" onClick={saveKey} disabled={!key.trim() || saving}>
            Salva
          </button>
          {hasKey && (
            <button className="btn danger" onClick={removeKey} disabled={saving}>
              Rimuovi
            </button>
          )}
        </div>
        <label className="settings-row">
          <span>Endpoint personalizzato (opzionale)</span>
          <input
            placeholder={info.defaultBaseUrl}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            onBlur={() => {
              if ((cfg.baseUrls?.[provider] || '') !== baseUrl) {
                persist({ baseUrls: { [provider]: baseUrl } }, true);
              }
            }}
          />
        </label>
      </section>
      )}

      <section className="settings-section">
        <h4>
          <Sparkles size={13} /> Modello predefinito
        </h4>
        <div className="key-row">
          <select
            value={model}
            onChange={(e) => persist({ models: { [provider]: e.target.value } }, true)}
          >
            <option value="">— nessuno —</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label || m.id}
                {m.context ? ` — ${Math.round(m.context / 1000)}k` : ''}
              </option>
            ))}
            {model && !models.some((m) => m.id === model) && <option value={model}>{model}</option>}
          </select>
          <button
            className="btn"
            onClick={() => loadModels(provider, true)}
            disabled={loadingModels}
            title="Ricarica l'elenco dei modelli"
          >
            <RefreshCw size={13} className={loadingModels ? 'spin' : ''} /> Aggiorna
          </button>
        </div>
        <p className="settings-hint">
          {loadingModels
            ? 'Lettura dei modelli disponibili…'
            : modelsError
              ? `Elenco non disponibile (${modelsError}). Sono proposti i modelli noti.`
              : keyless && !models.length
                ? 'Nessun modello scaricato: scaricane uno qui sopra per poterlo scegliere.'
                : `${models.length} modelli disponibili.`}
        </p>
      </section>

      <section className="settings-section">
        <h4>Permessi predefiniti</h4>
        <p className="settings-hint">
          Valgono per le nuove sessioni e si possono cambiare sessione per sessione. Se l'assistente
          prova un'operazione fuori dai permessi, la conferma viene chiesta in chat.
        </p>
        {PERMISSIONS.map((p) => (
          <label key={p.key} className={`perm-row ${p.danger ? 'danger' : ''}`}>
            <input
              type="checkbox"
              checked={!!cfg.permissions[p.key]}
              onChange={(e) => persist({ permissions: { [p.key]: e.target.checked } }, true)}
            />
            <span>
              <strong>{p.label}</strong>
              <em>{p.hint}</em>
            </span>
          </label>
        ))}
        <label className="settings-row">
          <span>Righe massime restituite all'assistente</span>
          <select
            value={cfg.maxRows}
            onChange={(e) => persist({ maxRows: Number(e.target.value) }, true)}
          >
            {[20, 50, 100, 200, 500, 1000].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </section>
    </div>
  );
}

// "C:\Program Files\Orabridge\Orabridge.exe" → "/mnt/c/Program Files/…":
// da un workspace WSL il ponte si lancia per percorso Linux, ma resta un
// processo Windows (è l'interop che lo permette, ed è quello che ci serve —
// solo dal lato Windows si raggiunge il loopback dell'app).
const toWslPath = (p) =>
  p.replace(/^([A-Za-z]):\\/, (_, drive) => `/mnt/${drive.toLowerCase()}/`).replace(/\\/g, '/');

const asJson = (server) => JSON.stringify({ servers: { orabridge: server } }, null, 2);

function mcpSnippets(desktop, origin) {
  if (!desktop) {
    // Server avviato a mano o in Docker: la porta è fissa e non c'è token, si
    // può puntare VS Code direttamente all'endpoint.
    return [
      {
        id: 'http',
        label: 'HTTP',
        json: asJson({ type: 'http', url: `${origin}/api/mcp` }),
        note: 'Il server risponde su una porta fissa: VS Code può parlarci senza intermediari.',
      },
    ];
  }
  const stdio = {
    type: 'stdio',
    command: desktop.execPath,
    args: [desktop.bridgePath],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  };
  return [
    {
      id: 'win',
      label: 'Windows',
      json: asJson(stdio),
      note: 'Da mettere nella configurazione utente di VS Code (comando «MCP: Open User Configuration»).',
    },
    {
      id: 'wsl',
      label: 'WSL',
      json: asJson({
        ...stdio,
        command: toWslPath(desktop.execPath),
        // Senza WSLENV la variabile non attraversa il confine e l'eseguibile
        // aprirebbe Orabridge invece di comportarsi da Node.
        env: { ELECTRON_RUN_AS_NODE: '1', WSLENV: 'ELECTRON_RUN_AS_NODE' },
      }),
      note: 'Per un workspace aperto in WSL: va in .vscode/mcp.json, oppure nella configurazione utente remota.',
    },
  ];
}

// Integrazione con gli editor esterni: Copilot legge i database già collegati
// in Orabridge, in sola lettura. L'interruttore è spento finché non lo si
// accende: apre una seconda porta verso i database, e la decisione è dell'utente.
function McpSettings({ toast }) {
  const [status, setStatus] = useState(null);
  const [variant, setVariant] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .mcpStatus()
      .then(setStatus)
      .catch((err) => toast(err.message, 'error'));
  }, [toast]);

  if (!status) return <div className="settings-loading">Caricamento…</div>;

  const snippets = mcpSnippets(status.desktop, window.location.origin);
  const shown = snippets.find((s) => s.id === variant) || snippets[0];

  const toggle = async (enabled) => {
    setSaving(true);
    try {
      const next = await api.setMcpEnabled(enabled);
      setStatus((s) => ({ ...s, ...next }));
      toast(enabled ? 'Integrazione attiva' : 'Integrazione disattivata', 'ok');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shown.json);
      toast('Configurazione copiata', 'ok');
    } catch {
      toast('Copia non riuscita', 'error');
    }
  };

  return (
    <div className="settings-body">
      <section className="settings-section">
        <h4>
          <Plug size={13} /> GitHub Copilot in VS Code
        </h4>
        <p className="settings-hint">
          Orabridge può farsi interrogare da Copilot (e da qualunque altro editor che parli MCP) sui
          database <strong>già collegati qui dentro</strong>: Copilot vede struttura, DDL, sorgenti
          PL/SQL e il risultato delle SELECT, così ha il contesto del database accanto al codice.
          Le connessioni si aprono e si chiudono solo da Orabridge, e le credenziali non escono
          dall'applicazione in nessuna forma.
        </p>
        <label className="perm-row">
          <input
            type="checkbox"
            checked={!!status.enabled}
            disabled={saving}
            onChange={(e) => toggle(e.target.checked)}
          />
          <span>
            <strong>Consenti la lettura dagli editor esterni</strong>
            <em>
              Sola lettura: nessuno strumento per modificare dati o oggetti viene esposto. Le
              modifiche restano una cosa da fare dal foglio SQL.
            </em>
          </span>
        </label>
        {status.enabled && (
          <p className="settings-warn">
            Attenzione: quello che Copilot legge finisce nel contesto del suo modello, quindi i dati
            interrogati lasciano questo computer. Tienilo presente sui database di produzione.
          </p>
        )}
      </section>

      {status.enabled && (
        <section className="settings-section">
          <h4>Configurazione di VS Code</h4>
          <p className="settings-hint">
            Incolla questo in <code>mcp.json</code>, poi apri la chat di Copilot in modalità agente:
            gli strumenti di Orabridge compaiono nell'elenco.
          </p>
          {snippets.length > 1 && (
            <div className="mcp-variants">
              {snippets.map((s) => (
                <button
                  key={s.id}
                  className={`mcp-variant ${s.id === shown.id ? 'on' : ''}`}
                  onClick={() => setVariant(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
          <div className="mcp-snippet">
            <button className="icon-btn mcp-copy" onClick={copy} title="Copia">
              <Copy size={13} />
            </button>
            <pre>{shown.json}</pre>
          </div>
          <p className="settings-hint">{shown.note}</p>
        </section>
      )}

      <section className="settings-section">
        <h4>Strumenti esposti</h4>
        <p className="settings-hint">
          {status.tools.join(', ')}.
          {' '}Nessuno di questi scrive: <code>execute_sql</code>, che nel pannello AI esiste, qui
          non è nell'elenco.
        </p>
        <p className="settings-hint">
          {status.activeConnections === 0
            ? 'Nessuna connessione attiva: collega un database perché Copilot abbia qualcosa da leggere.'
            : `${status.activeConnections} ${
                status.activeConnections === 1 ? 'connessione attiva' : 'connessioni attive'
              }. Con più di una, Copilot chiede quale usare.`}
        </p>
      </section>
    </div>
  );
}

export default function SettingsModal({ onClose, initialTab = 'ai' }) {
  const [tab, setTab] = useState(initialTab);
  const toast = useStore((s) => s.toast);
  const openGuide = useStore((s) => s.openGuide);

  // Dalla guida delle impostazioni si passa alla scheda a tutta area, aperta
  // sulla stessa sezione che si stava leggendo.
  const openGuideTab = (sectionId) => {
    openGuide(sectionId);
    onClose();
  };

  return (
    <div className="modal-overlay">
      <div className="modal settings-modal">
        <div className="modal-head">
          <span>Impostazioni</span>
          <button className="icon-btn" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="settings-layout">
          <nav className="settings-nav">
            <button className={tab === 'ai' ? 'on' : ''} onClick={() => setTab('ai')}>
              <Sparkles size={13} /> Assistente AI
            </button>
            <button className={tab === 'mcp' ? 'on' : ''} onClick={() => setTab('mcp')}>
              <Plug size={13} /> Copilot e MCP
            </button>
            <button className={tab === 'guide' ? 'on' : ''} onClick={() => setTab('guide')}>
              <BookOpen size={13} /> Guida
            </button>
            <button className={tab === 'about' ? 'on' : ''} onClick={() => setTab('about')}>
              <Info size={13} /> Informazioni
            </button>
          </nav>
          <div className={`settings-content ${tab === 'guide' ? 'flush' : ''}`}>
            {tab === 'ai' ? (
              <AiSettings toast={toast} />
            ) : tab === 'mcp' ? (
              <McpSettings toast={toast} />
            ) : tab === 'guide' ? (
              <GuideView compact onOpenFull={openGuideTab} />
            ) : (
              <AboutPanel onOpenGuide={openGuideTab} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
