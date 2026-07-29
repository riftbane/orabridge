import React from 'react';
import { AlertTriangle, Crosshair, FilePlus2, Pencil, Trash2, Undo2, XCircle } from 'lucide-react';

// Modifiche in sospeso e validazione: la stessa lettura del DB Diff, ma
// applicata alle proprie modifiche invece che a quelle fra due database.

const ICON = {
  new: <FilePlus2 size={12} className="ok" />,
  deleted: <Trash2 size={12} className="err" />,
  modified: <Pencil size={12} className="warn" />,
};

export default function ChangesPanel({ changes, issues, onFocus, onRevert }) {
  const errors = issues.filter((i) => i.level === 'error');
  const warns = issues.filter((i) => i.level === 'warn');

  return (
    <div className="gchanges">
      <div className="gchanges-head">
        Modifiche in sospeso
        <span className="gchanges-count">{changes.length}</span>
      </div>

      <div className="gchanges-list">
        {!changes.length && <div className="tree-info">Nessuna modifica: il diagramma è come il database.</div>}
        {changes.map((c) => (
          <div key={c.tableUid} className={`gchange ${c.kind}`}>
            <div className="gchange-head">
              {ICON[c.kind]}
              <span className="gchange-name">{c.name}</span>
              <button className="icon-btn" title="Mostra nel diagramma" onClick={() => onFocus(c.tableUid)}>
                <Crosshair size={12} />
              </button>
              <button className="icon-btn" title="Annulla queste modifiche" onClick={() => onRevert(c.tableUid)}>
                <Undo2 size={12} />
              </button>
            </div>
            <ul className="gchange-details">
              {c.details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {(errors.length > 0 || warns.length > 0) && (
        <div className="gissues">
          <div className="gchanges-head">
            Controlli
            {!!errors.length && <span className="gchanges-count err">{errors.length}</span>}
            {!!warns.length && <span className="gchanges-count warn">{warns.length}</span>}
          </div>
          <div className="gchanges-list">
            {[...errors, ...warns].map((i, n) => (
              <button
                key={n}
                className={`gissue ${i.level}`}
                onClick={() => i.tableUid && onFocus(i.tableUid)}
              >
                {i.level === 'error' ? <XCircle size={12} /> : <AlertTriangle size={12} />}
                <span>{i.text}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
