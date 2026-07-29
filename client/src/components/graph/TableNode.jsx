import React from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, KeyRound, Link2, Table2, Trash2 } from 'lucide-react';
import { HEAD_H, ROW_H, nodeSize, visibleRows } from '../../graph/layout.js';
import { fkColumnUids, liveConstraints, liveIndexes, pkColumnUids } from '../../graph/mutations.js';
import TableEditor from './TableEditor.jsx';

// Un nodo del diagramma.
//
// Tre livelli di dettaglio a seconda dello zoom: da lontano basta il nome, più
// vicino compaiono le colonne chiave, da vicino tutto. È quello che permette a
// uno schema da centinaia di tabelle di restare navigabile.

export const LOD = { FULL: 2, KEYS: 1, NAME: 0 };

export function lodFor(zoom) {
  if (zoom >= 0.6) return LOD.FULL;
  if (zoom >= 0.25) return LOD.KEYS;
  return LOD.NAME;
}

function Row({ column, isPk, isFk, onStartLink }) {
  return (
    <div className="gnode-row" data-column-uid={column.uid} style={{ height: ROW_H }}>
      <span className="gnode-port left" onPointerDown={(e) => onStartLink(e, column.uid, 'left')} />
      <span className="gnode-key">
        {isPk ? <KeyRound size={10} className="pk" /> : isFk ? <Link2 size={10} className="fk" /> : null}
      </span>
      <span className="gnode-colname">{column.name}</span>
      <span className="gnode-coltype">{column.type}</span>
      {column.notNull && <span className="gnode-nn" title="Obbligatoria">•</span>}
      <span className="gnode-port right" onPointerDown={(e) => onStartLink(e, column.uid, 'right')} />
    </div>
  );
}

export default function TableNode({
  table,
  pos,
  view,
  lod,
  selected,
  editing,
  issues,
  changed,
  onPointerDown,
  onDoubleClick,
  onToggleCollapse,
  onStartLink,
  onDelete,
  apply,
  onOpenFk,
  onCloseEditor,
}) {
  const { w, h } = nodeSize(table, view);
  const { rows, hidden } = visibleRows(table, editing ? { ...view, collapsed: false } : view);
  const pk = new Set(pkColumnUids(table));
  const fks = fkColumnUids(table);
  const errors = issues.filter((i) => i.level === 'error').length;
  const warns = issues.length - errors;

  const style = editing
    ? { left: pos.x, top: pos.y, width: 620 }
    : { left: pos.x, top: pos.y, width: w, height: lod === LOD.NAME ? undefined : h };

  return (
    <div
      className={[
        'gnode',
        selected ? 'on' : '',
        editing ? 'editing' : '',
        table.deleted ? 'deleted' : '',
        table.base == null ? 'created' : '',
        changed ? 'changed' : '',
        errors ? 'has-error' : warns ? 'has-warn' : '',
        lod === LOD.NAME ? 'far' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={style}
      data-table-uid={table.uid}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
    >
      <div className="gnode-head" style={{ height: HEAD_H }}>
        {lod !== LOD.NAME && (
          <button
            className="gnode-chev"
            title={view.collapsed ? 'Espandi' : 'Comprimi'}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onToggleCollapse}
          >
            {view.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          </button>
        )}
        <Table2 size={12} className="gnode-icon" />
        <span className="gnode-title">{table.name}</span>
        {!!errors && <AlertTriangle size={12} className="gnode-alert err" />}
        {!errors && !!warns && <AlertTriangle size={12} className="gnode-alert warn" />}
        {table.deleted && <Trash2 size={12} className="gnode-alert err" />}
      </div>

      {editing ? (
        <TableEditor table={table} apply={apply} onOpenFk={onOpenFk} onClose={onCloseEditor} />
      ) : (
        lod !== LOD.NAME && (
          <>
            <div className="gnode-rows">
              {rows.map((c) => (
                <Row
                  key={c.uid}
                  column={c}
                  isPk={pk.has(c.uid)}
                  isFk={fks.has(c.uid)}
                  onStartLink={(e, uid, side) => onStartLink(e, table.uid, uid, side)}
                />
              ))}
              {hidden > 0 && (
                <div className="gnode-row more" style={{ height: ROW_H }}>
                  +{hidden} altre colonne
                </div>
              )}
            </div>
            {(liveConstraints(table).length || liveIndexes(table).length) > 0 && (
              <div className="gnode-foot">
                {liveConstraints(table).length} vincoli · {liveIndexes(table).length} indici
              </div>
            )}
          </>
        )
      )}
      {/* Bersaglio d'arrivo dei collegamenti: rilasciando qui la FK punta alla
          chiave primaria, senza dover centrare la riga giusta. */}
      <span className="gnode-droptarget" data-table-uid={table.uid} />
    </div>
  );
}
