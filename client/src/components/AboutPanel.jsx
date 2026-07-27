import React, { useEffect, useState } from 'react';
import { CheckCircle2, Download, RefreshCw, XCircle } from 'lucide-react';

function statusLine(status, info) {
  switch (status) {
    case 'checking':
      return { text: 'Controllo aggiornamenti…', kind: 'info' };
    case 'available':
      return { text: `Aggiornamento trovato (v${info.version}): download in corso…`, kind: 'info' };
    case 'downloading':
      return { text: `Download in corso… ${info.percent ?? 0}%`, kind: 'info' };
    case 'downloaded':
      return { text: `Versione ${info.version} scaricata: segui la finestra per riavviare e installare.`, kind: 'ok' };
    case 'not-available':
      return { text: 'Hai già l\'ultima versione disponibile.', kind: 'ok' };
    case 'error':
      return { text: `Errore durante il controllo: ${info.message || 'sconosciuto'}`, kind: 'err' };
    case 'unsupported':
      return { text: 'Gli aggiornamenti automatici funzionano solo nella versione installata.', kind: 'err' };
    default:
      return null;
  }
}

// Contenuto della scheda «Informazioni» delle impostazioni: versione dell'app
// e aggiornamenti (questi ultimi solo nella versione desktop).
export default function AboutPanel() {
  const isDesktop = typeof window !== 'undefined' && !!window.orabridge;
  const [version, setVersion] = useState(null);
  const [status, setStatus] = useState(null);
  const [statusInfo, setStatusInfo] = useState({});
  const busy = status === 'checking' || status === 'downloading';

  useEffect(() => {
    if (!isDesktop) return undefined;
    window.orabridge.getAppInfo().then((info) => setVersion(info.version));
    return window.orabridge.onUpdateStatus(({ status: s, ...info }) => {
      setStatus(s);
      setStatusInfo(info);
    });
  }, [isDesktop]);

  const checkForUpdates = () => {
    setStatus('checking');
    setStatusInfo({});
    window.orabridge.checkForUpdates();
  };

  const line = status ? statusLine(status, statusInfo) : null;

  return (
    <div className="about-panel">
      <div className="about-logo">
        <span className="logo-ora">Ora</span>bridge
      </div>
      <p className="about-version">{isDesktop ? `Versione desktop ${version || '…'}` : 'Client web'}</p>
      <p className="settings-hint">SQL veloce per Oracle, senza zavorra.</p>
      {isDesktop && (
        <>
          <button className="btn primary" onClick={checkForUpdates} disabled={busy}>
            <RefreshCw size={14} className={busy ? 'spin' : ''} /> Verifica aggiornamenti
          </button>
          {line && (
            <div className={`test-result ${line.kind === 'err' ? 'err' : line.kind === 'ok' ? 'ok' : ''}`}>
              {line.kind === 'ok' && <CheckCircle2 size={15} />}
              {line.kind === 'err' && <XCircle size={15} />}
              {line.kind === 'info' && <Download size={15} />}
              <span>{line.text}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
