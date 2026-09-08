import React, { useCallback, useState } from 'react';
import { RotateCcw, Trash2, X } from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.js';
import { SYSTEM_BY_TYPE } from '../systemObjects.js';
import { dictName } from '../ddl.js';
import { DetailMessage, GridTab, READONLY_TITLE, ReadOnlyBadge } from './ObjectDetail.jsx';

// Scheda di dettaglio degli oggetti «di sistema» dell'albero: stessa struttura
// di ObjectDetail (testata, linguette, griglia), ma linguette e query le decide
// il registro condiviso `systemObjects.js` — la stringa della sezione viaggia
// tale e quale fino al server, che ha la stessa tabella.

function SystemIcon({ type }) {
  const [ch, color] = SYSTEM_BY_TYPE[type]?.icon || ['?', '#888'];
  return (
    <span className="type-icon" style={{ color, borderColor: color }}>
      {ch}
    </span>
  );
}

// Il ripristino può ridare alla tabella un nome diverso: serve quando nel
// frattempo qualcuno ne ha creata un'altra con lo stesso nome, che è proprio
// il caso in cui il FLASHBACK fallirebbe.
function RestoreDialog({ name, busy, onCancel, onConfirm }) {
  const [newName, setNewName] = useState('');
  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-head">
          <span>Ripristina dal cestino</span>
          <button className="icon-btn" onClick={onCancel}>
            <X size={14} />
          </button>
        </div>
        <div className="modal-body">
          <div>
            La tabella <b>{name}</b> torna al suo posto con il nome che aveva prima
            dell&apos;eliminazione.
          </div>
          <label>
            <span>Nuovo nome (facoltativo)</span>
            <input
              value={newName}
              placeholder="lascia vuoto per riprendere il nome originale"
              onChange={(e) => setNewName(e.target.value)}
            />
          </label>
          <div className="pane-info">
            Indici e trigger caduti nel cestino insieme alla tabella tornano indietro con lei, ma
            con i nomi di sistema BIN$…: vanno rinominati a mano.
          </div>
        </div>
        <div className="modal-foot">
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onCancel} disabled={busy}>
            Annulla
          </button>
          <button className="btn primary" onClick={() => onConfirm(newName.trim())} disabled={busy}>
            {busy ? 'Ripristino…' : 'Ripristina'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PurgeDialog({ name, busy, onCancel, onConfirm }) {
  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-head">
          <span>Elimina definitivamente</span>
          <button className="icon-btn" onClick={onCancel}>
            <X size={14} />
          </button>
        </div>
        <div className="modal-body">
          <div>
            <b>{name}</b> viene tolta dal cestino e lo spazio restituito al tablespace. Dopo il
            PURGE non c&apos;è più niente da ripristinare.
          </div>
        </div>
        <div className="modal-foot">
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onCancel} disabled={busy}>
            Annulla
          </button>
          <button className="btn danger" onClick={onConfirm} disabled={busy}>
            {busy ? 'Eliminazione…' : 'Elimina definitivamente'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SystemObjectDetail({ tab }) {
  const { connId, owner, name, type } = tab;
  const meta = SYSTEM_BY_TYPE[type];
  const sections = meta?.sections || [];
  const [sec, setSec] = useState(sections[0] || '');
  const [dlg, setDlg] = useState(null);
  const [busy, setBusy] = useState(false);
  const active = useStore((s) => s.active[connId]);
  const connect = useStore((s) => s.connect);
  const toast = useStore((s) => s.toast);
  const connected = active?.status === 'connected';
  const readOnly = !!active?.readOnly;

  const loader = useCallback(
    () => api.extraDetail(connId, { type, owner, name, section: sec }),
    [connId, type, owner, name, sec]
  );

  // FLASHBACK e PURGE sono DDL: chiudono la scheda perché l'oggetto che
  // descrive non esiste più (ripristinato o cancellato), e l'albero va
  // riletto per farlo sparire dal cestino.
  const runRecyclebin = async (fn, okMessage, { autocomplete } = {}) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r.error) {
        toast(r.error.message, 'error');
        setBusy(false);
        setDlg(null);
        return;
      }
      toast(okMessage, 'ok');
      const st = useStore.getState();
      // FLASHBACK e PURGE sono DDL: Oracle committa implicitamente, quindi la
      // transazione che il foglio segnalava come aperta non esiste più.
      st.setTxnOpen(connId, false);
      st.bumpTree(connId);
      if (autocomplete) st.loadAutocomplete(connId);
      st.closeTab(tab.id);
    } catch (err) {
      toast(err.message, 'error');
      if (err.status === 409) useStore.getState().markDisconnected(connId);
      setBusy(false);
      setDlg(null);
    }
  };

  if (!meta) {
    return <DetailMessage text={`Tipo di oggetto di sistema sconosciuto: ${type}`} />;
  }

  if (!connected) {
    return (
      <div className="ws-banner">
        Connessione non attiva.
        <button className="btn primary" onClick={() => connect(connId)}>
          Connetti
        </button>
      </div>
    );
  }

  const isRecyclebin = type === 'RECYCLEBIN';
  // FLASHBACK e PURGE non portano lo schema: agiscono su quello dell'utenza
  // collegata. Sul cestino di un altro schema i due pulsanti fallirebbero
  // sempre — o, peggio, colpirebbero un omonimo nel proprio.
  const ownBin =
    !!active && (owner === active.currentSchema || owner === active.user || !owner);
  const binDisabled = readOnly || !ownBin || busy;
  const binTitle = readOnly
    ? READONLY_TITLE
    : !ownBin
      ? `Il ripristino agisce solo sul cestino di ${active?.currentSchema || 'questo utente'}`
      : null;

  return (
    <div className="object-detail">
      <div className="obj-head">
        <SystemIcon type={type} />
        <span className="obj-title">{meta.owned && owner ? `${owner}.${name}` : name}</span>
        <span className="obj-type">{meta.label}</span>
        {readOnly && <ReadOnlyBadge />}
        <div style={{ flex: 1 }} />
        {isRecyclebin && (
          <>
            <button
              className="btn"
              onClick={() => setDlg('restore')}
              disabled={binDisabled}
              title={binTitle || 'FLASHBACK TABLE … TO BEFORE DROP'}
            >
              <RotateCcw size={13} /> Ripristina
            </button>
            <button
              className="btn danger"
              onClick={() => setDlg('purge')}
              disabled={binDisabled}
              title={binTitle || 'PURGE TABLE: elimina definitivamente'}
            >
              <Trash2 size={13} /> Elimina definitivamente
            </button>
          </>
        )}
      </div>
      <div className="pane-tabs">
        {sections.map((s) => (
          <button key={s} className={sec === s ? 'on' : ''} onClick={() => setSec(s)}>
            {s}
          </button>
        ))}
      </div>
      <div className="pane-body">
        {sec ? (
          <GridTab key={sec} loader={loader} />
        ) : (
          <div className="grid-empty">Nessun dettaglio previsto per questo tipo.</div>
        )}
      </div>

      {dlg === 'restore' && (
        <RestoreDialog
          name={name}
          busy={busy}
          onCancel={() => setDlg(null)}
          onConfirm={(newName) => {
            // Senza `dictName` un nome scritto in minuscolo verrebbe quotato
            // dal server e nascerebbe una tabella citabile solo fra doppi
            // apici: è la stessa normalizzazione dell'albero.
            const target = dictName(newName);
            return runRecyclebin(
              () => api.recyclebinFlashback(connId, { name, newName: target || undefined }),
              target ? `Tabella ripristinata come ${target}` : 'Tabella ripristinata',
              { autocomplete: true }
            );
          }}
        />
      )}
      {dlg === 'purge' && (
        <PurgeDialog
          name={name}
          busy={busy}
          onCancel={() => setDlg(null)}
          onConfirm={() =>
            runRecyclebin(
              () => api.recyclebinPurge(connId, { name }),
              'Oggetto eliminato definitivamente'
            )
          }
        />
      )}
    </div>
  );
}
