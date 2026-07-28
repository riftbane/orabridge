import React, { useEffect, useState } from 'react';
import { BookOpen, Check, Info, KeyRound, RefreshCw, Sparkles, X } from 'lucide-react';
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
                {p.hasKey ? (
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
