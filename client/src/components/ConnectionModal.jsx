import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, RefreshCw, X, XCircle } from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.js';

const ROLES = [
  { value: '', label: 'Normale' },
  { value: 'SYSDBA', label: 'SYSDBA' },
  { value: 'SYSOPER', label: 'SYSOPER' },
];

export default function ConnectionModal({ conn, onClose }) {
  const isEdit = !!conn?.id;
  const [form, setForm] = useState({
    name: conn?.name || '',
    host: conn?.host || 'localhost',
    port: conn?.port || 1521,
    serviceType: conn?.serviceType || 'service',
    service: conn?.service || '',
    tnsAlias: conn?.tnsAlias || '',
    tnsAdmin: conn?.tnsAdmin || '',
    user: conn?.user || '',
    password: '',
    group: conn?.group || '',
    role: conn?.role || '',
    proxyUser: conn?.proxyUser || '',
    walletPath: conn?.walletPath || '',
    walletPassword: '',
    readOnly: !!conn?.readOnly,
  });
  // Le opzioni avanzate stanno chiuse: chi crea una connessione normale non
  // deve vedere niente più di prima. Su una connessione che ne usa già una si
  // aprono da sole, altrimenti sembrerebbero sparite.
  const [advanced, setAdvanced] = useState(
    () =>
      !!(conn?.role || conn?.proxyUser || conn?.walletPath || conn?.hasWalletPassword || conn?.readOnly)
  );
  const [tns, setTns] = useState({ loading: false, aliases: [], file: '', error: '' });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const conns = useStore((s) => s.conns);
  const refreshConnections = useStore((s) => s.refreshConnections);
  const toast = useStore((s) => s.toast);
  const groupOptions = useMemo(
    () => [...new Set(conns.map((c) => c.group).filter((g) => g?.trim()))].sort((a, b) => a.localeCompare(b)),
    [conns]
  );

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const check = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.checked }));
  const custom = form.serviceType === 'custom';
  const isTns = form.serviceType === 'tns';

  const loadAliases = useCallback(async (dir) => {
    setTns((t) => ({ ...t, loading: true, error: '' }));
    try {
      const r = await api.tnsAliases(dir);
      // La cartella non si ricopia nel campo: lasciandolo vuoto la connessione
      // resta portabile (ogni macchina risolve il suo TNS_ADMIN). Dove sia il
      // file lo dice comunque la riga qui sotto.
      setTns({ loading: false, aliases: r.aliases || [], file: r.file || '', error: r.error || '' });
    } catch (err) {
      setTns({ loading: false, aliases: [], file: '', error: err.message });
    }
  }, []);

  // Il primo elenco si carica quando si sceglie il tipo TNS; dopo, a ricaricare
  // ci pensa il pulsante (leggere il file a ogni tasto premuto nella cartella
  // sarebbe una richiesta per carattere).
  useEffect(() => {
    if (isTns) loadAliases(form.tnsAdmin);
  }, [isTns]);

  const selectedAlias = useMemo(
    () => tns.aliases.find((x) => x.name === form.tnsAlias) || null,
    [tns.aliases, form.tnsAlias]
  );

  // Una riga che dice cosa si sta per salvare: con alias TNS, ruoli, proxy e
  // wallet il modulo da solo non lo rende più evidente.
  const summary = useMemo(() => {
    const target = isTns
      ? form.tnsAlias || '(alias da scegliere)'
      : custom
        ? form.service || '(connect string vuota)'
        : `${form.host || '(host)'}:${form.port}/${form.service || '(servizio)'}`;
    const parts = [`${form.user || '(utente)'}@${target}`];
    if (isTns) parts.push('alias TNS');
    else if (form.serviceType === 'sid') parts.push('SID');
    if (form.role) parts.push(`ruolo ${form.role}`);
    if (form.proxyUser.trim()) parts.push(`tramite il proxy ${form.proxyUser.trim()}`);
    if (form.walletPath.trim()) parts.push('con wallet');
    parts.push(form.readOnly ? 'sola lettura' : 'lettura e scrittura');
    return parts.join(' · ');
  }, [form, custom, isTns]);

  // Gli stessi controlli del server, fatti prima di partire: l'errore arriva
  // subito e senza un giro di rete.
  const problem = () => {
    if (!form.name.trim() || !form.user.trim()) return 'Nome e utente sono obbligatori';
    if (isTns && !form.tnsAlias.trim()) return 'Scegli un alias di tnsnames.ora';
    if (form.walletPassword.trim() && !form.walletPath.trim()) {
      return 'Indica la cartella del wallet, non solo la password';
    }
    // Con un wallet la password può stare dentro il wallet: pretenderla qui
    // impedirebbe di salvare una connessione perfettamente valida.
    if (!isEdit && !form.password && !form.walletPath.trim()) return 'Password obbligatoria';
    return '';
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await api.testConnection({ ...form, id: conn?.id });
      setTestResult(r);
    } catch (err) {
      setTestResult({ ok: false, error: err.message });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    const invalid = problem();
    if (invalid) {
      toast(invalid, 'error');
      return;
    }
    setSaving(true);
    try {
      if (isEdit) await api.updateConnection(conn.id, form);
      else await api.createConnection(form);
      await refreshConnections();
      toast(isEdit ? 'Connessione aggiornata' : 'Connessione creata', 'ok');
      onClose();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal conn-modal">
        <div className="modal-head">
          <span>{isEdit ? 'Modifica connessione' : 'Nuova connessione'}</span>
          <button className="icon-btn" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="modal-body">
          <label>
            Nome
            <input value={form.name} onChange={set('name')} placeholder="es. DEV — HR" autoFocus />
          </label>
          <label>
            Gruppo
            <input
              value={form.group}
              onChange={set('group')}
              list="conn-group-options"
              placeholder="es. Produzione (opzionale)"
            />
            <datalist id="conn-group-options">
              {groupOptions.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
          </label>
          {!isTns && (
            <div className="form-row">
              <label style={{ flex: 2 }}>
                Host
                <input value={form.host} onChange={set('host')} disabled={custom} />
              </label>
              <label style={{ flex: 1 }}>
                Porta
                <input type="number" value={form.port} onChange={set('port')} disabled={custom} />
              </label>
            </div>
          )}
          <div className="form-row">
            <label style={{ flex: 1 }}>
              Tipo
              <select value={form.serviceType} onChange={set('serviceType')}>
                <option value="service">Service name</option>
                <option value="sid">SID</option>
                <option value="tns">TNS (tnsnames.ora)</option>
                <option value="custom">Connect string</option>
              </select>
            </label>
            {isTns ? (
              <label style={{ flex: 2 }}>
                Alias
                <select value={form.tnsAlias} onChange={set('tnsAlias')}>
                  <option value="">
                    {tns.loading ? 'Lettura di tnsnames.ora…' : '— scegli un alias —'}
                  </option>
                  {/* L'alias salvato resta selezionabile anche se il file non
                      si legge (cartella di un'altra macchina, file spostato). */}
                  {form.tnsAlias && !selectedAlias && (
                    <option value={form.tnsAlias}>{form.tnsAlias} (non nell'elenco)</option>
                  )}
                  {tns.aliases.map((x) => (
                    <option key={x.name} value={x.name}>{x.name}</option>
                  ))}
                </select>
              </label>
            ) : (
              <label style={{ flex: 2 }}>
                {custom ? 'Connect string' : form.serviceType === 'sid' ? 'SID' : 'Service name'}
                <input
                  value={form.service}
                  onChange={set('service')}
                  placeholder={custom ? 'host:1521/service oppure descrittore TNS' : 'es. FREEPDB1'}
                />
              </label>
            )}
          </div>
          {isTns && (
            <>
              <div className="form-row conn-tns-dir">
                <label style={{ flex: 1 }}>
                  Cartella TNS_ADMIN
                  <input
                    value={form.tnsAdmin}
                    onChange={set('tnsAdmin')}
                    placeholder="vuota = TNS_ADMIN o ORACLE_HOME/network/admin"
                  />
                </label>
                <button
                  className="btn"
                  onClick={() => loadAliases(form.tnsAdmin)}
                  disabled={tns.loading}
                  title="Rileggi tnsnames.ora da questa cartella"
                >
                  <RefreshCw size={13} />
                  {tns.loading ? 'Lettura…' : 'Ricarica'}
                </button>
              </div>
              {tns.error ? (
                <div className="conn-tns-note err">{tns.error}</div>
              ) : tns.file ? (
                <div className="conn-tns-note">
                  {tns.aliases.length} alias da {tns.file}
                </div>
              ) : null}
              {selectedAlias && <div className="conn-tns-desc">{selectedAlias.descriptor}</div>}
            </>
          )}
          <div className="form-row">
            <label style={{ flex: 1 }}>
              Utente
              <input value={form.user} onChange={set('user')} />
            </label>
            <label style={{ flex: 1 }}>
              Password
              <input
                type="password"
                value={form.password}
                onChange={set('password')}
                placeholder={isEdit ? '(invariata)' : ''}
              />
            </label>
          </div>
          <button
            type="button"
            className="conn-adv-toggle"
            onClick={() => setAdvanced((v) => !v)}
            aria-expanded={advanced}
          >
            {advanced ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            Avanzate
          </button>
          {advanced && (
            <div className="conn-adv">
              <div className="form-row">
                <label style={{ flex: 1 }}>
                  Ruolo
                  <select value={form.role} onChange={set('role')}>
                    {ROLES.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </label>
                <label style={{ flex: 2 }}>
                  Utente proxy
                  <input
                    value={form.proxyUser}
                    onChange={set('proxyUser')}
                    placeholder="es. APP_PROXY (opzionale)"
                  />
                </label>
              </div>
              <div className="conn-note">
                Con un utente proxy ci si autentica con la password del proxy e si lavora nello
                schema di «{form.user || 'utente'}»: Oracle lo scrive <code>proxy[utente]</code>.
              </div>
              <div className="form-row">
                <label style={{ flex: 2 }}>
                  Wallet (cartella)
                  <input
                    value={form.walletPath}
                    onChange={set('walletPath')}
                    placeholder="cartella con cwallet.sso / ewallet.pem"
                  />
                </label>
                <label style={{ flex: 1 }}>
                  Password wallet
                  <input
                    type="password"
                    value={form.walletPassword}
                    onChange={set('walletPassword')}
                    placeholder={conn?.hasWalletPassword ? '(invariata)' : ''}
                  />
                </label>
              </div>
              <label className="conn-check">
                <input type="checkbox" checked={form.readOnly} onChange={check('readOnly')} />
                <span>Connessione in sola lettura</span>
              </label>
              <div className="conn-note">
                Orabridge rifiuta INSERT, UPDATE, DELETE e DDL su questa connessione.
              </div>
            </div>
          )}
          <div className="conn-summary">
            <span className="conn-summary-label">Riassunto</span>
            <span className="conn-summary-text">{summary}</span>
          </div>
          {testResult && (
            <div className={`test-result ${testResult.ok ? 'ok' : 'err'}`}>
              {testResult.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
              <span>
                {testResult.ok
                  ? `Connessione riuscita in ${testResult.ms} ms — Oracle ${testResult.version}`
                  : testResult.error}
              </span>
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={test} disabled={testing}>
            {testing ? 'Test…' : 'Prova connessione'}
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Annulla</button>
          <button className="btn primary" onClick={save} disabled={saving}>
            Salva
          </button>
        </div>
      </div>
    </div>
  );
}
