import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { EDITABLE_CELL_TYPES } from '../ddl.js';

const ROW_H = 26;
const HEADER_H = 28;
// Matches the "…(N caratteri)" suffix serializeValue() appends when a CLOB
// is too long to fetch in full: editing that truncated preview would corrupt
// the real value, so those cells fall back to the read-only value modal.
const TRUNCATED_RE = /… \(\d+ caratteri\)$/;

function computeWidths(columns, rows) {
  return columns.map((c, i) => {
    let max = c.name.length;
    const sample = Math.min(rows.length, 50);
    for (let r = 0; r < sample; r++) {
      const v = rows[r][i];
      if (v != null) max = Math.max(max, String(v).length);
    }
    return Math.min(480, Math.max(60, max * 7.2 + 20));
  });
}

function cmp(a, b) {
  if (a == null) return b == null ? 0 : 1;
  if (b == null) return -1;
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && a !== '' && b !== '') return na - nb;
  return String(a).localeCompare(String(b));
}

function canEditCell(col, value) {
  if (!EDITABLE_CELL_TYPES.has(col.type)) return false;
  if ((col.type === 'CLOB' || col.type === 'NCLOB') && typeof value === 'string' && TRUNCATED_RE.test(value)) {
    return false;
  }
  return true;
}

// `editable` turns on double-click-to-edit for the Dati tab of a TABLE:
// `rowIds` (parallel to `rows`) supplies the ROWID used to persist each edit,
// and `onCellEdit(origIndex, colIndex, newValue, col)` performs the UPDATE,
// resolving to `{ ok:true }` or `{ error:true }` (never rejects).
// `dirtyResetKey` clears the "modified, not yet committed" highlight when it changes.
export default function Grid({
  columns,
  rows,
  emptyText = 'Nessuna riga',
  editable = false,
  rowIds,
  onCellEdit,
  dirtyResetKey,
}) {
  const scrollRef = useRef(null);
  const [range, setRange] = useState([0, 80]);
  const [widths, setWidths] = useState(() => computeWidths(columns, rows));
  const [sort, setSort] = useState(null); // { col, dir }
  const [sel, setSel] = useState(null); // { r1, c1, r2, c2 }
  const [dragging, setDragging] = useState(false);
  const [modal, setModal] = useState(null);
  const [edit, setEdit] = useState(null); // { r, c, value, saving }
  const [dirtyCells, setDirtyCells] = useState(() => new Set());
  const [dirtyRows, setDirtyRows] = useState(() => new Set());
  const skipBlurRef = useRef(false);
  const commitLockRef = useRef(false);

  // Only reset on a genuine new dataset (new `columns` identity), not on the
  // in-place row patch a successful cell edit applies — that would otherwise
  // wipe sort/selection/scroll and the dirty highlight right after every edit.
  useEffect(() => {
    setWidths(computeWidths(columns, rows));
    setSort(null);
    setSel(null);
    setEdit(null);
    setDirtyCells(new Set());
    setDirtyRows(new Set());
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setRange([0, 80]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns]);

  useEffect(() => {
    setDirtyCells(new Set());
    setDirtyRows(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirtyResetKey]);

  useEffect(() => {
    if (!dragging) return;
    const up = () => setDragging(false);
    document.addEventListener('mouseup', up);
    return () => document.removeEventListener('mouseup', up);
  }, [dragging]);

  // Original-index permutation for the current sort, so edits can address the
  // caller's `rows`/`rowIds` arrays regardless of on-screen order.
  const order = useMemo(() => {
    const idx = rows.map((_, i) => i);
    if (!sort) return idx;
    const mul = sort.dir === 'desc' ? -1 : 1;
    const col = sort.col;
    return idx.sort((x, y) => mul * cmp(rows[x][col], rows[y][col]) || x - y);
  }, [rows, sort]);

  const sorted = useMemo(() => order.map((i) => rows[i]), [order, rows]);

  const totalW = useMemo(() => widths.reduce((a, b) => a + b, 46), [widths]);

  const onScroll = useCallback(
    (e) => {
      const el = e.target;
      const from = Math.max(0, Math.floor(el.scrollTop / ROW_H) - 10);
      const to = Math.min(sorted.length, from + Math.ceil(el.clientHeight / ROW_H) + 25);
      setRange([from, to]);
    },
    [sorted.length]
  );

  const startResize = (e, i) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widths[i];
    const move = (ev) => {
      setWidths((w) => {
        const next = [...w];
        next[i] = Math.max(40, startW + ev.clientX - startX);
        return next;
      });
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };

  const onKeyDown = (e) => {
    if (edit) return; // let the in-cell input handle its own keys
    if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
      e.preventDefault();
      if (sorted.length) setSel({ r1: 0, c1: 0, r2: sorted.length - 1, c2: columns.length - 1 });
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'c' && sel) {
      const r1 = Math.min(sel.r1, sel.r2);
      const r2 = Math.max(sel.r1, sel.r2);
      const c1 = Math.min(sel.c1, sel.c2);
      const c2 = Math.max(sel.c1, sel.c2);
      const text = [];
      for (let r = r1; r <= r2; r++) {
        const cells = [];
        for (let c = c1; c <= c2; c++) {
          const v = sorted[r]?.[c];
          cells.push(v == null ? '' : String(v));
        }
        text.push(cells.join('\t'));
      }
      navigator.clipboard?.writeText(text.join('\n'));
      e.preventDefault();
    }
  };

  const startSel = (r, c) => {
    setDragging(true);
    setSel({ r1: r, c1: c, r2: r, c2: c });
  };
  const extendSel = (r, c) => {
    if (!dragging) return;
    setSel((s) => (s ? { ...s, r2: r, c2: c } : { r1: r, c1: c, r2: r, c2: c }));
  };
  const inSel = (r, c) => {
    if (!sel) return false;
    const r1 = Math.min(sel.r1, sel.r2);
    const r2 = Math.max(sel.r1, sel.r2);
    const c1 = Math.min(sel.c1, sel.c2);
    const c2 = Math.max(sel.c1, sel.c2);
    return r >= r1 && r <= r2 && c >= c1 && c <= c2;
  };

  const beginEdit = (r, c, v) => {
    commitLockRef.current = false;
    setEdit({ r, c, value: v == null ? '' : String(v) });
  };

  const cancelEdit = () => {
    skipBlurRef.current = true;
    setEdit(null);
  };

  const commitEdit = useCallback(async () => {
    if (!edit || commitLockRef.current) return;
    commitLockRef.current = true;
    try {
      const { r, c, value } = edit;
      const origIndex = order[r];
      const original = rows[origIndex][c];
      const originalStr = original == null ? '' : String(original);
      if (value === originalStr) {
        setEdit(null);
        return;
      }
      setEdit((s) => (s ? { ...s, saving: true } : s));
      const newValue = value === '' ? null : value;
      const result = await onCellEdit(origIndex, c, newValue, columns[c]);
      if (result?.ok) {
        setDirtyCells((d) => new Set(d).add(`${origIndex}:${c}`));
        setDirtyRows((d) => new Set(d).add(origIndex));
      }
      setEdit(null);
    } finally {
      commitLockRef.current = false;
    }
  }, [edit, order, rows, columns, onCellEdit]);

  const handleDoubleClick = (r, c, v) => {
    const origIndex = order[r];
    const col = columns[c];
    const canEdit = editable && canEditCell(col, v) && rowIds?.[origIndex] != null;
    if (canEdit) {
      beginEdit(r, c, v);
      return;
    }
    if (v != null) setModal({ col: col.name, value: v });
  };

  if (!columns.length) return <div className="grid-empty">{emptyText}</div>;

  const [from, to] = range;
  const visible = sorted.slice(from, to);

  return (
    <div className={`grid-wrap ${dragging ? 'dragging' : ''}`} tabIndex={0} onKeyDown={onKeyDown}>
      <div className="grid-scroll" ref={scrollRef} onScroll={onScroll}>
        <div style={{ width: totalW, height: HEADER_H + sorted.length * ROW_H, position: 'relative' }}>
          <div className="grid-header" style={{ width: totalW, height: HEADER_H }}>
            <div className="grid-cell grid-rownum" style={{ width: 46 }}>
              #
            </div>
            {columns.map((c, i) => (
              <div
                key={i}
                className="grid-cell grid-head-cell"
                style={{ width: widths[i] }}
                title={`${c.name} (${c.type})`}
                onClick={() =>
                  setSort((s) =>
                    s?.col === i
                      ? s.dir === 'asc'
                        ? { col: i, dir: 'desc' }
                        : null
                      : { col: i, dir: 'asc' }
                  )
                }
              >
                <span className="grid-head-name">{c.name}</span>
                {sort?.col === i && (
                  <span className="grid-sort">
                    {sort.dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  </span>
                )}
                <div className="grid-resize" onMouseDown={(e) => startResize(e, i)} onClick={(e) => e.stopPropagation()} />
              </div>
            ))}
          </div>
          {visible.map((row, vi) => {
            const r = from + vi;
            const origIndex = order[r];
            const rowDirty = editable && dirtyRows.has(origIndex);
            return (
              <div
                key={r}
                className={`grid-row ${r % 2 ? 'odd' : ''} ${rowDirty ? 'row-dirty' : ''}`}
                style={{ top: HEADER_H + r * ROW_H, height: ROW_H, width: totalW }}
              >
                <div className="grid-cell grid-rownum" style={{ width: 46 }}>
                  {r + 1}
                </div>
                {row.map((v, c) => {
                  const isEditingThis = edit && edit.r === r && edit.c === c;
                  const cellDirty = editable && dirtyCells.has(`${origIndex}:${c}`);
                  return (
                    <div
                      key={c}
                      className={`grid-cell ${inSel(r, c) ? 'sel' : ''} ${cellDirty ? 'dirty' : ''} ${isEditingThis ? 'editing' : ''}`}
                      style={{ width: widths[c] }}
                      onMouseDown={() => !isEditingThis && startSel(r, c)}
                      onMouseEnter={() => extendSel(r, c)}
                      onDoubleClick={() => handleDoubleClick(r, c, v)}
                    >
                      {isEditingThis ? (
                        <input
                          className="grid-edit-input"
                          autoFocus
                          value={edit.value}
                          disabled={edit.saving}
                          onChange={(e) => setEdit((s) => ({ ...s, value: e.target.value }))}
                          onMouseDown={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              commitEdit();
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              cancelEdit();
                            }
                          }}
                          onBlur={() => {
                            if (skipBlurRef.current) {
                              skipBlurRef.current = false;
                              return;
                            }
                            commitEdit();
                          }}
                        />
                      ) : v == null ? (
                        <span className="null">(null)</span>
                      ) : (
                        String(v)
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal value-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <span>{modal.col}</span>
              <button className="icon-btn" onClick={() => setModal(null)}>
                <X size={14} />
              </button>
            </div>
            <pre className="value-pre">{String(modal.value)}</pre>
            <div className="modal-foot">
              <button
                className="btn"
                onClick={() => navigator.clipboard?.writeText(String(modal.value))}
              >
                Copia
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function exportCsv(columns, rows, filename = 'orabridge.csv') {
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [columns.map((c) => esc(c.name)).join(',')];
  for (const r of rows) lines.push(r.map(esc).join(','));
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
