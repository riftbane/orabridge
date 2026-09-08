import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

// Il piano di esecuzione disegnato come albero invece che come blocco di testo.
// Le colonne numeriche stanno tutte a destra e incolonnate: un piano si legge
// scorrendo quella colonna, non rileggendo le operazioni una per una.
//
// `nodes` è la forma restituita da /explain (e da /autotrace, che aggiunge i
// numeri veri: starts, aRows, buffers). `text` è il testo di dbms_xplan, che
// resta disponibile in fondo perché è quello che si incolla in un ticket.

const nf = new Intl.NumberFormat('it-IT');

const fmtInt = (v) => (v == null || v === '' ? '' : nf.format(Math.round(Number(v))));

function fmtBytes(v) {
  if (v == null || v === '') return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  if (n < 1024) return `${nf.format(n)} B`;
  if (n < 1024 * 1024) return `${nf.format(Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${nf.format(Math.round(n / (1024 * 1024)))} MB`;
  return `${nf.format(Math.round(n / (1024 * 1024 * 1024)))} GB`;
}

// La colonna TIME del piano sono secondi, e dbms_xplan li mostra come durata:
// «01:14» dice più di «74».
function fmtTime(v) {
  if (v == null || v === '') return '';
  const s = Math.round(Number(v));
  if (!Number.isFinite(s)) return '';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (n) => String(n).padStart(2, '0');
  return h ? `${two(h)}:${two(m)}:${two(sec)}` : `${two(m)}:${two(sec)}`;
}

// Stima contro realtà. Oracle conta le righe stimate **per esecuzione** del
// passo, quindi il confronto onesto è cardinality × starts contro aRows: senza
// moltiplicare, ogni nodo dentro un loop annidato sembrerebbe sbagliato.
// Sotto la riga (0 o 1) il rapporto perde senso, per questo il minimo è 1.
function deviation(n) {
  if (n.aRows == null || n.cardinality == null) return 0;
  const est = Math.max(1, Number(n.cardinality) * Math.max(1, Number(n.starts ?? 1)));
  const act = Math.max(1, Number(n.aRows));
  if (!Number.isFinite(est) || !Number.isFinite(act)) return 0;
  const ratio = est > act ? est / act : act / est;
  return ratio > 10 ? ratio : 0;
}

// Il legame padre-figlio serve solo per richiudere i rami: `parentId` non
// c'è in tutte le risposte, mentre `depth` sì, e una pila di profondità lo
// ricostruisce comunque (le righe arrivano già in ordine di piano).
function buildRows(nodes) {
  const rows = (nodes || []).map((n, i) => ({ ...n, i, depth: Number(n.depth) || 0, parent: null, kids: 0 }));
  const stack = [];
  for (const r of rows) {
    while (stack.length && stack[stack.length - 1].depth >= r.depth) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) {
      r.parent = parent;
      parent.kids++;
    }
    stack.push(r);
  }
  return rows;
}

export default function PlanTree({ nodes, stats, text }) {
  const rows = useMemo(() => buildRows(nodes), [nodes]);
  const [closed, setClosed] = useState(() => new Set());
  const [open, setOpen] = useState(() => new Set());

  // Rami richiusi e nodi aperti sono indicati per posizione: con un piano
  // nuovo quelle posizioni sono di altre operazioni, quindi si riparte pulito.
  useEffect(() => {
    setClosed((s) => (s.size ? new Set() : s));
    setOpen((s) => (s.size ? new Set() : s));
  }, [nodes]);

  const actual = rows.some((r) => r.aRows != null || r.starts != null || r.buffers != null);
  const cols = actual ? 9 : 6;

  const toggle = (set, apply) => (i) => {
    const next = new Set(set);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    apply(next);
  };
  const toggleClosed = toggle(closed, setClosed);
  const toggleOpen = toggle(open, setOpen);

  const hidden = (r) => {
    for (let p = r.parent; p; p = p.parent) if (closed.has(p.i)) return true;
    return false;
  };

  if (!rows.length && !text) {
    return <div className="grid-empty">Nessun piano da mostrare</div>;
  }

  return (
    <div className="plan-view">
      {rows.length > 0 && (
        <table className="plan-table">
          <thead>
            <tr>
              <th className="plan-op">Operazione</th>
              <th className="plan-obj">Oggetto</th>
              <th className="num">Righe stimate</th>
              <th className="num">Byte</th>
              <th className="num">Costo</th>
              <th className="num">Tempo</th>
              {actual && <th className="num">Starts</th>}
              {actual && <th className="num">Righe reali</th>}
              {actual && <th className="num">Buffer</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              if (hidden(r)) return null;
              const off = deviation(r);
              const offTitle = off
                ? `Stima e realtà differiscono di ${nf.format(Math.round(off))} volte`
                : undefined;
              const detail = open.has(r.i);
              return (
                <React.Fragment key={r.i}>
                  <tr className={detail ? 'on' : ''} onClick={() => toggleOpen(r.i)}>
                    <td className="plan-op">
                      <span className="plan-indent" style={{ paddingLeft: r.depth * 14 }}>
                        {r.kids > 0 ? (
                          <button
                            type="button"
                            className="plan-fold"
                            title={closed.has(r.i) ? 'Espandi il ramo' : 'Richiudi il ramo'}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleClosed(r.i);
                            }}
                          >
                            {closed.has(r.i) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                          </button>
                        ) : (
                          <span className="plan-fold empty" />
                        )}
                        <span className="plan-name">{r.operation}</span>
                        {r.options && <span className="plan-opt">{r.options}</span>}
                      </span>
                    </td>
                    <td className="plan-obj" title={r.objectOwner ? `${r.objectOwner}.${r.objectName}` : ''}>
                      {r.objectName || ''}
                    </td>
                    <td className={`num ${off ? 'off' : ''}`} title={offTitle}>
                      {fmtInt(r.cardinality)}
                    </td>
                    <td className="num">{fmtBytes(r.bytes)}</td>
                    <td className="num">{fmtInt(r.cost)}</td>
                    <td className="num">{fmtTime(r.time)}</td>
                    {actual && <td className="num">{fmtInt(r.starts)}</td>}
                    {actual && (
                      <td className={`num ${off ? 'off' : ''}`} title={offTitle}>
                        {fmtInt(r.aRows)}
                      </td>
                    )}
                    {actual && <td className="num">{fmtInt(r.buffers)}</td>}
                  </tr>
                  {detail && (
                    <tr className="plan-detail">
                      <td colSpan={cols}>
                        <PlanDetail node={r} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      )}

      {stats?.length > 0 && (
        <div className="plan-stats">
          <div className="plan-block-head">Statistiche della sessione</div>
          <table className="plan-stats-table">
            <tbody>
              {stats.map((s, i) => (
                <tr key={i}>
                  <td>{s.name}</td>
                  <td className="num">{typeof s.value === 'number' ? fmtInt(s.value) : s.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {text && (
        <details className="plan-text">
          <summary>Testo di dbms_xplan</summary>
          <pre>{text}</pre>
        </details>
      )}
    </div>
  );
}

// I predicati sono la ragione per cui si apre un nodo: dicono quali condizioni
// l'indice ha davvero usato (accesso) e quali sono state applicate dopo aver
// letto la riga (filtro), che è quasi sempre dove sta lo spreco.
function PlanDetail({ node }) {
  const rows = [
    ['Accesso', node.accessPredicates],
    ['Filtro', node.filterPredicates],
    ['Tipo oggetto', node.objectType],
    ['Proprietario', node.objectOwner],
    [
      'Partizioni',
      node.partitionStart || node.partitionStop
        ? `${node.partitionStart ?? ''} → ${node.partitionStop ?? ''}`
        : '',
    ],
    ['Tempo reale', node.aTimeMs == null ? '' : `${nf.format(Math.round(node.aTimeMs))} ms`],
  ].filter(([, v]) => v != null && v !== '');

  if (!rows.length) return <div className="plan-empty">Nessun predicato su questo passo.</div>;

  return (
    <dl className="plan-preds">
      {rows.map(([k, v]) => (
        <React.Fragment key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}
