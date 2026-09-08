import React, { useEffect, useRef, useState } from 'react';
import { Variable, X } from 'lucide-react';

// Finestra dei valori da dare alle variabili dell'istruzione prima di
// eseguirla. Le due specie di variabile non si chiedono allo stesso modo (vedi
// binds.js): una sostituzione è testo che entra nell'SQL così com'è, un bind è
// un parametro che Oracle riceve a parte e per cui servono anche tipo,
// direzione e la possibilità di dire «NULL» (che non è la stringa vuota).

const TYPES = [
  { id: 'string', label: 'Testo' },
  { id: 'number', label: 'Numero' },
  { id: 'date', label: 'Data' },
];

const DIRS = [
  { id: 'in', label: 'IN' },
  { id: 'out', label: 'OUT' },
  { id: 'inout', label: 'IN OUT' },
];

// I valori tornano dallo store come li ha lasciati l'esecuzione precedente:
// una stringa per le sostituzioni, un oggetto `{ val, type, dir }` per i bind.
// Tipo e direzione vanno ricordati insieme al valore, altrimenti a ogni
// riapertura una data tornerebbe a essere «Testo IN».
function toRow(v, values) {
  const stored = values?.[v.name.toUpperCase()] ?? values?.[v.name];
  const base = { name: v.name, kind: v.kind, persistent: !!v.persistent };
  if (v.kind === 'sub') {
    const val = stored && typeof stored === 'object' ? (stored.val ?? '') : (stored ?? '');
    return { ...base, val: String(val), type: 'string', dir: 'in', isNull: false };
  }
  if (stored && typeof stored === 'object') {
    return {
      ...base,
      val: stored.val == null ? '' : String(stored.val),
      type: stored.type || 'string',
      dir: stored.dir || 'in',
      isNull: stored.val === null,
    };
  }
  return { ...base, val: stored == null ? '' : String(stored), type: 'string', dir: 'in', isNull: false };
}

// Un bind numerico con dentro qualcosa che numero non è farebbe fallire
// l'esecuzione a metà: meglio bloccare la conferma e dirlo subito. La stringa
// vuota conta come errore perché per «niente» esiste già la spunta NULL.
function badNumber(r) {
  if (r.kind !== 'bind' || r.type !== 'number' || r.isNull || r.dir === 'out') return false;
  const t = r.val.trim();
  return t === '' || !Number.isFinite(Number(t));
}

export default function BindVarsDialog({ vars = [], values = {}, plsql = false, onSubmit, onClose }) {
  const [rows, setRows] = useState(() => vars.map((v) => toRow(v, values)));
  // Il fuoco va sulla prima variabile ancora senza valore, ma va deciso una
  // volta sola: ricalcolarlo mentre si digita lo farebbe saltare via da solo.
  // Il campo di un bind OUT o messo a NULL è disabilitato: puntare lì
  // lascerebbe la finestra senza fuoco, e Invio/Esc finirebbero nell'editor
  // sotto invece che qui.
  const focusIdx = useRef(
    rows.findIndex((r) => !r.val && !(r.kind === 'bind' && (r.isNull || r.dir === 'out')))
  );
  const formRef = useRef(null);

  // Se nessun campo è a fuoco (tutti disabilitati, o già tutti valorizzati) la
  // finestra si prende il fuoco da sé: è lei a gestire Invio ed Esc.
  useEffect(() => {
    const t = setTimeout(() => {
      const form = formRef.current;
      if (form && !form.contains(document.activeElement)) form.focus();
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const patch = (i, p) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const indexed = rows.map((r, i) => ({ r, i }));
  const subs = indexed.filter((x) => x.r.kind === 'sub');
  const binds = indexed.filter((x) => x.r.kind === 'bind');
  const invalid = rows.some(badNumber);
  const autoFocus = (i) => i === focusIdx.current || (focusIdx.current < 0 && i === 0);

  const submit = (e) => {
    e.preventDefault();
    if (invalid) return;
    // Chiave in maiuscolo: per Oracle `:id` e `:ID` sono lo stesso parametro,
    // e la sostituzione confronta i nomi allo stesso modo.
    const out = {};
    for (const r of rows) {
      const key = r.name.toUpperCase();
      if (r.kind === 'sub') out[key] = r.val;
      // Un bind di sola uscita non ha un valore da mandare: il posto lo
      // riempie il PL/SQL.
      else out[key] = { val: r.isNull || r.dir === 'out' ? null : r.val, type: r.type, dir: r.dir };
    }
    onSubmit?.(out);
  };

  return (
    <div className="modal-overlay">
      <form
        className="modal binds-modal"
        ref={formRef}
        tabIndex={-1}
        onSubmit={submit}
        onKeyDown={(e) => {
          // Col fuoco sul <form> (nessun campo abilitato) Invio non farebbe
          // niente, mentre il piè di pagina promette che conferma.
          if (e.key === 'Enter' && !e.shiftKey && e.target === e.currentTarget) {
            e.preventDefault();
            e.currentTarget.requestSubmit();
            return;
          }
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose?.();
          }
        }}
      >
        <div className="modal-head">
          <span className="binds-title">
            <Variable size={13} /> Variabili dell'istruzione
          </span>
          <button type="button" className="icon-btn" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="modal-body">
          {subs.length > 0 && (
            <div className="bind-group">
              <div className="bind-group-head">Sostituzioni</div>
              <div className="bind-hint">
                Il valore prende il posto di <code>&amp;nome</code> nel testo dell'istruzione
                esattamente com'è scritto: se deve diventare una stringa, mettilo fra apici.
              </div>
              {subs.map(({ r, i }) => (
                <div key={`s${i}`} className="bind-row sub">
                  <span className="bind-name" title={r.persistent ? 'Chiesta una volta sola (&&)' : ''}>
                    {r.persistent ? '&&' : '&'}
                    {r.name}
                  </span>
                  <input
                    value={r.val}
                    autoFocus={autoFocus(i)}
                    onChange={(e) => patch(i, { val: e.target.value })}
                  />
                  {r.persistent && <span className="bind-badge">memorizzata</span>}
                </div>
              ))}
            </div>
          )}

          {binds.length > 0 && (
            <div className="bind-group">
              <div className="bind-group-head">Variabili di bind</div>
              {binds.map(({ r, i }) => {
                const noValue = r.isNull || r.dir === 'out';
                return (
                  <div key={`b${i}`} className={`bind-row ${plsql ? 'plsql' : ''}`}>
                    <span className="bind-name">:{r.name}</span>
                    <input
                      value={noValue ? '' : r.val}
                      disabled={noValue}
                      className={badNumber(r) ? 'bad' : ''}
                      placeholder={
                        r.dir === 'out' ? 'valore restituito dal blocco' : r.type === 'date' ? 'AAAA-MM-GG HH:MI:SS' : ''
                      }
                      autoFocus={autoFocus(i)}
                      onChange={(e) => patch(i, { val: e.target.value })}
                    />
                    <select value={r.type} onChange={(e) => patch(i, { type: e.target.value })}>
                      {TYPES.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    {plsql && (
                      <select value={r.dir} onChange={(e) => patch(i, { dir: e.target.value })}>
                        {DIRS.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.label}
                          </option>
                        ))}
                      </select>
                    )}
                    <label className="bind-null">
                      <input
                        type="checkbox"
                        checked={r.isNull}
                        disabled={r.dir === 'out'}
                        onChange={(e) => patch(i, { isNull: e.target.checked })}
                      />
                      NULL
                    </label>
                  </div>
                );
              })}
              {invalid && (
                <div className="bind-hint err">
                  Un bind numerico vuole un numero: correggilo o spunta NULL.
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal-foot">
          <span className="bind-hint foot">Invio conferma, Esc annulla.</span>
          <div style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={onClose}>
            Annulla
          </button>
          <button className="btn primary" type="submit" disabled={invalid}>
            Conferma
          </button>
        </div>
      </form>
    </div>
  );
}
