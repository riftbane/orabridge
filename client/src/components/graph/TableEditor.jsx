import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Plus, Trash2, Undo2, X } from 'lucide-react';
import { COL_TYPES, dictName } from '../../ddl.js';
import {
  addColumn,
  addConstraint,
  addIndex,
  emptyColumn,
  emptyConstraint,
  emptyIndex,
  liveColumns,
  moveColumn,
  patchColumn,
  patchConstraint,
  patchIndex,
  patchTable,
  removeColumn,
  removeConstraint,
  removeIndex,
} from '../../graph/mutations.js';

// Superficie di modifica di una tabella, indipendente da chi la ospita: oggi
// vive dentro il nodo del diagramma, domani può sostituire i riquadri di
// TableDialogs.jsx (che oggi lavorano su una forma di dati tutta loro e
// generano SQL da sé).
//
// Ogni modifica finisce dritta nel draft: non c'è un secondo livello di
// «salva», perché nulla tocca il database prima dell'applicazione e
// l'annullamento globale (Ctrl+Z) copre già tutto.

const TYPE_LIST = 'g-col-types';

// Il tipo si scrive per esteso invece di essere spezzato in tipo/dimensione/
// scala: il dizionario lo restituisce già in forma canonica
// («VARCHAR2(80 CHAR)», «TIMESTAMP(6) WITH TIME ZONE»), e rimontarlo da tre
// campi lo perderebbe pezzo per pezzo.
export function TypeDatalist() {
  return (
    <datalist id={TYPE_LIST}>
      {COL_TYPES.map((t) => (
        <option key={t.name} value={t.size ? `${t.name}(50)` : t.prec ? `${t.name}(10)` : t.name} />
      ))}
    </datalist>
  );
}

function ChipPicker({ columns, value, onChange }) {
  if (!columns.length) return <div className="tree-info">Nessuna colonna</div>;
  const toggle = (uid) =>
    onChange(value.includes(uid) ? value.filter((x) => x !== uid) : [...value, uid]);
  return (
    <div className="col-picker">
      {columns.map((c) => {
        const i = value.indexOf(c.uid);
        return (
          <button
            key={c.uid}
            type="button"
            className={`col-chip ${i >= 0 ? 'on' : ''}`}
            onClick={() => toggle(c.uid)}
          >
            {i >= 0 && <span className="ord">{i + 1}</span>}
            {c.name}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- colonne ---------- */

function ColumnsPane({ table, apply }) {
  const pk = table.constraints.find((c) => c.type === 'P' && !c.deleted);
  const inPk = new Set(pk ? pk.columns.map((r) => r.columnUid) : []);

  // La casella PK è una scorciatoia sul vincolo sottostante: spuntarla lo
  // ricompone, e una colonna di chiave è per forza obbligatoria.
  const togglePk = (columnUid) => {
    apply((draft) => {
      const t = draft.tables[table.uid];
      const current = t.constraints.find((c) => c.type === 'P' && !c.deleted);
      const uids = current ? current.columns.map((r) => r.columnUid) : [];
      const adding = !uids.includes(columnUid);
      const next = adding ? [...uids, columnUid] : uids.filter((u) => u !== columnUid);

      let out = draft;
      if (!next.length) {
        out = removeConstraint(out, t.uid, current.uid);
      } else if (current) {
        // Si modifica il vincolo esistente invece di rifarlo: il suo id è ciò
        // che lo lega a quello del database, e ricrearlo lo farebbe apparire
        // come «eliminato e riaggiunto».
        out = patchConstraint(out, t.uid, current.uid, {
          columns: next.map((u) => ({ columnUid: u })),
        });
      } else {
        out = addConstraint(
          out,
          t.uid,
          emptyConstraint('P', `${dictName(t.name)}_PK`, next.map((u) => ({ columnUid: u })))
        );
      }
      // Una colonna di chiave è per forza obbligatoria.
      if (adding) out = patchColumn(out, t.uid, columnUid, { notNull: true });
      return out;
    });
  };

  return (
    <div className="gedit-cols">
      <div className="coldef-grid gnode-cols-grid">
        {['PK', 'Nome', 'Tipo', 'NN', 'Predefinito', 'Commento', ''].map((h, i) => (
          <span key={i} className="hd">
            {h}
          </span>
        ))}
        {table.columns.map((c) =>
          c.deleted ? (
            <React.Fragment key={c.uid}>
              <span />
              <span className="gedit-dropped">{c.name}</span>
              <span className="gedit-dropped" style={{ gridColumn: 'span 4' }}>
                da eliminare
              </span>
              <button
                className="icon-btn"
                title="Annulla eliminazione"
                onClick={() => apply((d) => patchColumn(d, table.uid, c.uid, { deleted: false }))}
              >
                <Undo2 size={13} />
              </button>
            </React.Fragment>
          ) : (
            <React.Fragment key={c.uid}>
              <input
                type="checkbox"
                checked={inPk.has(c.uid)}
                onChange={() => togglePk(c.uid)}
                title="Chiave primaria"
              />
              <input
                value={c.name}
                onChange={(e) => apply((d) => patchColumn(d, table.uid, c.uid, { name: e.target.value }))}
                onBlur={(e) =>
                  apply((d) => patchColumn(d, table.uid, c.uid, { name: dictName(e.target.value) }))
                }
              />
              <input
                list={TYPE_LIST}
                value={c.type}
                onChange={(e) => apply((d) => patchColumn(d, table.uid, c.uid, { type: e.target.value }))}
              />
              <input
                type="checkbox"
                checked={c.notNull}
                disabled={inPk.has(c.uid)}
                onChange={(e) =>
                  apply((d) => patchColumn(d, table.uid, c.uid, { notNull: e.target.checked }))
                }
              />
              <input
                value={c.default ?? ''}
                placeholder="es. SYSDATE"
                onChange={(e) =>
                  apply((d) => patchColumn(d, table.uid, c.uid, { default: e.target.value || null }))
                }
              />
              <input
                value={c.comment ?? ''}
                onChange={(e) =>
                  apply((d) => patchColumn(d, table.uid, c.uid, { comment: e.target.value || null }))
                }
              />
              <span className="gedit-rowbtns">
                <button className="icon-btn" title="Su" onClick={() => apply((d) => moveColumn(d, table.uid, c.uid, -1))}>
                  <ChevronUp size={12} />
                </button>
                <button className="icon-btn" title="Giù" onClick={() => apply((d) => moveColumn(d, table.uid, c.uid, 1))}>
                  <ChevronDown size={12} />
                </button>
                <button
                  className="icon-btn danger"
                  title="Elimina colonna"
                  onClick={() => apply((d) => removeColumn(d, table.uid, c.uid))}
                >
                  <Trash2 size={12} />
                </button>
              </span>
            </React.Fragment>
          )
        )}
      </div>
      <button className="btn" onClick={() => apply((d) => addColumn(d, table.uid, emptyColumn()))}>
        <Plus size={13} /> Aggiungi colonna
      </button>
    </div>
  );
}

/* ---------- vincoli ---------- */

const CTYPES = [
  ['P', 'Primary Key'],
  ['U', 'Unique'],
  ['C', 'Check'],
];

const describeType = (t) =>
  ({ P: 'Primary Key', U: 'Unique', R: 'Foreign Key', C: 'Check' })[t] || t;

function ConstraintAddForm({ table, onAdd, onCancel }) {
  const [type, setType] = useState('U');
  const [name, setName] = useState(`${dictName(table.name)}_UK`);
  const [cols, setCols] = useState([]);
  const [condition, setCondition] = useState('');
  const valid = name.trim() && (type === 'C' ? condition.trim() : cols.length);

  return (
    <div className="tedit-add-form">
      <div className="form-row">
        <label style={{ flex: 1 }}>
          Tipo
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setName(`${dictName(table.name)}_${e.target.value === 'C' ? 'CK' : e.target.value === 'P' ? 'PK' : 'UK'}`);
            }}
          >
            {CTYPES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label style={{ flex: 2 }}>
          Nome
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
      </div>
      {type === 'C' ? (
        <label>
          Condizione
          <input value={condition} placeholder="es. STATO IN ('A','S')" onChange={(e) => setCondition(e.target.value)} />
        </label>
      ) : (
        <label>
          Colonne (clicca in ordine)
          <ChipPicker columns={liveColumns(table)} value={cols} onChange={setCols} />
        </label>
      )}
      <div className="tedit-actions">
        <button className="btn" onClick={onCancel}>
          Annulla
        </button>
        <button
          className="btn primary"
          disabled={!valid}
          onClick={() => {
            const c = emptyConstraint(
              type,
              dictName(name),
              type === 'C' ? [] : cols.map((uid) => ({ columnUid: uid }))
            );
            if (type === 'C') c.condition = condition.trim();
            onAdd(c);
          }}
        >
          Aggiungi
        </button>
      </div>
    </div>
  );
}

function ConstraintsPane({ table, apply, onOpenFk }) {
  const [adding, setAdding] = useState(false);
  const nameOf = (uid) => table.columns.find((c) => c.uid === uid)?.name ?? '?';

  return (
    <div>
      <table className="tedit-list">
        <thead>
          <tr>
            <th>Tipo</th>
            <th>Nome</th>
            <th>Colonne</th>
            <th>Dettagli</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {table.constraints.map((c) => (
            <tr key={c.uid} className={c.deleted ? 'pending-drop' : c.base == null ? 'pending-add' : ''}>
              <td>{describeType(c.type)}</td>
              <td>{c.name}</td>
              <td>{c.columns.map((r) => (r.columnUid ? nameOf(r.columnUid) : r.name)).join(', ')}</td>
              <td>
                {c.type === 'R' ? (
                  <button className="linkish" onClick={() => onOpenFk(c.uid)}>
                    {c.refTable}
                    {c.deleteRule ? ` · ON DELETE ${c.deleteRule}` : ''}
                  </button>
                ) : (
                  c.condition || ''
                )}
              </td>
              <td>
                {c.deleted ? (
                  <button
                    className="icon-btn"
                    title="Annulla eliminazione"
                    onClick={() => apply((d) => patchConstraint(d, table.uid, c.uid, { deleted: false }))}
                  >
                    <Undo2 size={13} />
                  </button>
                ) : (
                  <button
                    className="icon-btn danger"
                    title="Elimina vincolo"
                    onClick={() => apply((d) => removeConstraint(d, table.uid, c.uid))}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </td>
            </tr>
          ))}
          {!table.constraints.length && (
            <tr>
              <td colSpan={5} className="tree-info">
                Nessun vincolo
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="tree-info">Le foreign key si creano trascinando una colonna su un'altra tabella.</div>
      {adding ? (
        <ConstraintAddForm
          table={table}
          onCancel={() => setAdding(false)}
          onAdd={(c) => {
            apply((d) => addConstraint(d, table.uid, c));
            setAdding(false);
          }}
        />
      ) : (
        <button className="btn" onClick={() => setAdding(true)}>
          <Plus size={13} /> Aggiungi vincolo
        </button>
      )}
    </div>
  );
}

/* ---------- indici ---------- */

function IndexesPane({ table, apply }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [unique, setUnique] = useState(false);
  const [cols, setCols] = useState([]);
  const nameOf = (uid) => table.columns.find((c) => c.uid === uid)?.name ?? '?';

  return (
    <div>
      <table className="tedit-list">
        <thead>
          <tr>
            <th>Nome</th>
            <th>Univoco</th>
            <th>Colonne</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {table.indexes.map((i) => (
            <tr key={i.uid} className={i.deleted ? 'pending-drop' : i.base == null ? 'pending-add' : ''}>
              <td>{i.name}</td>
              <td>{i.unique ? 'UNIQUE' : ''}</td>
              <td>
                {i.columns
                  .map((r) => (r.columnUid ? nameOf(r.columnUid) : r.expr) + (r.desc ? ' DESC' : ''))
                  .join(', ')}
              </td>
              <td>
                {i.deleted ? (
                  <button
                    className="icon-btn"
                    title="Annulla eliminazione"
                    onClick={() => apply((d) => patchIndex(d, table.uid, i.uid, { deleted: false }))}
                  >
                    <Undo2 size={13} />
                  </button>
                ) : (
                  <button className="icon-btn danger" onClick={() => apply((d) => removeIndex(d, table.uid, i.uid))} title="Elimina indice">
                    <Trash2 size={13} />
                  </button>
                )}
              </td>
            </tr>
          ))}
          {!table.indexes.length && (
            <tr>
              <td colSpan={4} className="tree-info">
                Nessun indice
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="tree-info">
        Gli indici che reggono una chiave primaria o un vincolo UNIQUE li fa Oracle: si eliminano togliendo il vincolo.
      </div>
      {adding ? (
        <div className="tedit-add-form">
          <div className="form-row">
            <label style={{ flex: 2 }}>
              Nome
              <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </label>
            <label className="check-label" style={{ flex: 1 }}>
              <span>Univoco</span>
              <input type="checkbox" checked={unique} onChange={(e) => setUnique(e.target.checked)} />
            </label>
          </div>
          <label>
            Colonne (clicca in ordine)
            <ChipPicker columns={liveColumns(table)} value={cols} onChange={setCols} />
          </label>
          <div className="tedit-actions">
            <button className="btn" onClick={() => setAdding(false)}>
              Annulla
            </button>
            <button
              className="btn primary"
              disabled={!name.trim() || !cols.length}
              onClick={() => {
                const i = emptyIndex(dictName(name), cols.map((uid) => ({ columnUid: uid, desc: false })));
                i.unique = unique;
                apply((d) => addIndex(d, table.uid, i));
                setAdding(false);
                setName('');
                setCols([]);
                setUnique(false);
              }}
            >
              Aggiungi
            </button>
          </div>
        </div>
      ) : (
        <button className="btn" onClick={() => setAdding(true)}>
          <Plus size={13} /> Aggiungi indice
        </button>
      )}
    </div>
  );
}

/* ---------- editor completo ---------- */

const PANES = [
  ['cols', 'Colonne'],
  ['cons', 'Vincoli'],
  ['idx', 'Indici'],
  ['cmt', 'Commento'],
];

export default function TableEditor({ table, apply, onOpenFk, onClose }) {
  const [pane, setPane] = useState('cols');

  return (
    <div className="gedit" onPointerDown={(e) => e.stopPropagation()}>
      <TypeDatalist />
      <div className="gedit-head">
        <input
          className="gedit-name"
          value={table.name}
          onChange={(e) => apply((d) => patchTable(d, table.uid, { name: e.target.value }))}
          onBlur={(e) => apply((d) => patchTable(d, table.uid, { name: dictName(e.target.value) }))}
        />
        <div className="tedit-nav">
          {PANES.map(([key, label]) => (
            <button key={key} className={pane === key ? 'on' : ''} onClick={() => setPane(key)}>
              {label}
            </button>
          ))}
        </div>
        <button className="icon-btn" title="Chiudi (Esc)" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      <div className="gedit-body">
        {pane === 'cols' && <ColumnsPane table={table} apply={apply} />}
        {pane === 'cons' && <ConstraintsPane table={table} apply={apply} onOpenFk={onOpenFk} />}
        {pane === 'idx' && <IndexesPane table={table} apply={apply} />}
        {pane === 'cmt' && (
          <label>
            Commento sulla tabella
            <textarea
              className="sql-textarea"
              rows={4}
              value={table.comment ?? ''}
              onChange={(e) => apply((d) => patchTable(d, table.uid, { comment: e.target.value || null }))}
            />
          </label>
        )}
      </div>
    </div>
  );
}
