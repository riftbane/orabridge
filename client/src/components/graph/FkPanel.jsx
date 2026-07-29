import React, { useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { dictName } from '../../ddl.js';
import {
  addIndex,
  emptyIndex,
  liveColumns,
  liveConstraints,
  liveIndexes,
  patchConstraint,
  removeConstraint,
} from '../../graph/mutations.js';

// Impostazioni di una foreign key: doppio clic sull'arco.

const DELETE_RULES = [
  ['', '(no action)'],
  ['CASCADE', 'CASCADE'],
  ['SET NULL', 'SET NULL'],
];

export default function FkPanel({ draft, tableUid, constraintUid, apply, onClose }) {
  const table = draft.tables[tableUid];
  const constraint = table?.constraints.find((c) => c.uid === constraintUid);
  const parent = constraint?.refTableUid ? draft.tables[constraint.refTableUid] : null;
  const [name, setName] = useState(constraint?.name ?? '');
  if (!constraint) return null;

  const nameOf = (t, uid) => t?.columns.find((c) => c.uid === uid)?.name ?? '?';
  const childUids = constraint.columns.map((r) => r.columnUid).filter(Boolean);

  // Una FK senza indice sulle colonne figlie fa sì che ogni DELETE sul padre
  // blocchi la tabella figlia: è la trappola più comune di Oracle, e da qui si
  // chiude in un clic.
  const indexed = [...liveIndexes(table), ...liveConstraints(table).filter((c) => c.type === 'P' || c.type === 'U')].some(
    (i) => i.columns.map((r) => r.columnUid).slice(0, childUids.length).join(',') === childUids.join(',')
  );

  const addChildIndex = () => {
    const base = `${dictName(table.name)}_IX_${dictName(parent?.name || 'FK')}`.slice(0, 30);
    apply((d) => addIndex(d, tableUid, emptyIndex(base, childUids.map((uid) => ({ columnUid: uid, desc: false })))));
  };

  return (
    <div className="gpanel gfk-panel">
      <div className="gpanel-head">
        <span>Foreign key</span>
        <button className="icon-btn" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      <div className="gpanel-body">
        <label>
          Nome del vincolo
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => apply((d) => patchConstraint(d, tableUid, constraintUid, { name: dictName(name) }))}
          />
        </label>

        <div className="gfk-pairs">
          <div className="gfk-pairs-head">
            <span>{table.name}</span>
            <span>{parent ? parent.name : `${constraint.refOwner}.${constraint.refTable}`}</span>
          </div>
          {constraint.columns.map((r, i) => (
            <div key={i} className="gfk-pair">
              <span>{r.columnUid ? nameOf(table, r.columnUid) : r.name}</span>
              <span className="gfk-arrow">→</span>
              <span>
                {constraint.refColumns[i]?.columnUid
                  ? nameOf(parent, constraint.refColumns[i].columnUid)
                  : constraint.refColumns[i]?.name ?? '?'}
              </span>
            </div>
          ))}
        </div>

        <label>
          ON DELETE
          <select
            value={constraint.deleteRule ?? ''}
            onChange={(e) =>
              apply((d) => patchConstraint(d, tableUid, constraintUid, { deleteRule: e.target.value || null }))
            }
          >
            {DELETE_RULES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>

        <label className="check-label">
          <span>Vincolo disabilitato</span>
          <input
            type="checkbox"
            checked={constraint.disabled}
            onChange={(e) => apply((d) => patchConstraint(d, tableUid, constraintUid, { disabled: e.target.checked }))}
          />
        </label>

        {!indexed && (
          <div className="gfk-hint">
            <span>
              Le colonne figlie non sono indicizzate: ogni DELETE su {parent?.name ?? 'il padre'} bloccherà{' '}
              {table.name}.
            </span>
            <button className="btn" onClick={addChildIndex}>
              Crea l'indice
            </button>
          </div>
        )}

        {!liveColumns(table).length && <div className="tree-info">La tabella non ha colonne.</div>}
      </div>
      <div className="gpanel-foot">
        <button
          className="btn danger"
          onClick={() => {
            apply((d) => removeConstraint(d, tableUid, constraintUid));
            onClose();
          }}
        >
          <Trash2 size={13} /> Elimina la foreign key
        </button>
      </div>
    </div>
  );
}
