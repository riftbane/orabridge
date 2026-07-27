import React, { useState } from 'react';
import { CheckCircle2, X, XCircle } from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.js';

const COLORS = ['#e8734a', '#e5c07b', '#98c379', '#56b6c2', '#61afef', '#c678dd', '#e06c75', '#9aa2b1'];

export default function ConnectionModal({ conn, onClose }) {
  const isEdit = !!conn?.id;
  const [form, setForm] = useState({
    name: conn?.name || '',
    host: conn?.host || 'localhost',
    port: conn?.port || 1521,
    serviceType: conn?.serviceType || 'service',
    service: conn?.service || '',
    user: conn?.user || '',
    password: '',
    color: conn?.color || COLORS[0],
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const refreshConnections = useStore((s) => s.refreshConnections);
  const toast = useStore((s) => s.toast);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const custom = form.serviceType === 'custom';

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
    if (!form.name.trim() || !form.user.trim()) {
      toast('Nome e utente sono obbligatori', 'error');
      return;
    }
    if (!isEdit && !form.password) {
      toast('Password obbligatoria', 'error');
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
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal conn-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>{isEdit ? 'Modifica connessione' : 'Nuova connessione'}</span>
          <button className="icon-btn" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="modal-body">
          <label>
            Nome
            <input value={form.name} onChange={set('name')} placeholder="es. DEV — HR" autoFocus />
          </label>
          <div className="color-row">
            {COLORS.map((c) => (
              <button
                key={c}
                className={`color-dot ${form.color === c ? 'sel' : ''}`}
                style={{ background: c }}
                onClick={() => setForm((f) => ({ ...f, color: c }))}
              />
            ))}
          </div>
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
          <div className="form-row">
            <label style={{ flex: 1 }}>
              Tipo
              <select value={form.serviceType} onChange={set('serviceType')}>
                <option value="service">Service name</option>
                <option value="sid">SID</option>
                <option value="custom">Connect string</option>
              </select>
            </label>
            <label style={{ flex: 2 }}>
              {custom ? 'Connect string' : form.serviceType === 'sid' ? 'SID' : 'Service name'}
              <input
                value={form.service}
                onChange={set('service')}
                placeholder={custom ? 'host:1521/service oppure descrittore TNS' : 'es. FREEPDB1'}
              />
            </label>
          </div>
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
