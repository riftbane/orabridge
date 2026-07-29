import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  KeyRound,
  LayoutGrid,
  Maximize2,
  Plus,
  Redo2,
  RefreshCw,
  Search,
  Undo2,
  Upload,
} from 'lucide-react';
import { api } from '../../api.js';
import { useStore, setCloseGuard } from '../../store.js';
import { autoLayout, boundsOf, fitViewport, nodeSize } from '../../graph/layout.js';
import { changeSummary, revertTable } from '../../graph/changes.js';
import { validateDraft } from '../../graph/validate.js';
import {
  addForeignKey,
  addTable,
  deleteTable,
  emptyTable,
  foreignKeys,
  liveTables,
  pkColumnUids,
  removeConstraint,
} from '../../graph/mutations.js';
import Canvas from './Canvas.jsx';
import Edges from './Edges.jsx';
import TableNode, { LOD, lodFor } from './TableNode.jsx';
import ChangesPanel from './ChangesPanel.jsx';
import FkPanel from './FkPanel.jsx';
import ApplyModal from './ApplyModal.jsx';
import OpenGraphModal from './OpenGraphModal.jsx';

/* ---- stato del modello, con annulla/ripeti ---- */

const MAX_UNDO = 60;

function reducer(state, action) {
  switch (action.type) {
    case 'load':
      return { draft: action.draft, initial: action.draft, undo: [], redo: [] };
    case 'apply': {
      const draft = action.fn(state.draft);
      if (draft === state.draft) return state;
      return {
        ...state,
        draft,
        // Ogni modifica clona solo la tabella toccata: lo stack costa quanto
        // una tabella per passo, non quanto lo schema.
        undo: [...state.undo, state.draft].slice(-MAX_UNDO),
        redo: [],
      };
    }
    case 'undo': {
      if (!state.undo.length) return state;
      const prev = state.undo.at(-1);
      return { ...state, draft: prev, undo: state.undo.slice(0, -1), redo: [...state.redo, state.draft] };
    }
    case 'redo': {
      if (!state.redo.length) return state;
      const next = state.redo.at(-1);
      return { ...state, draft: next, undo: [...state.undo, state.draft], redo: state.redo.slice(0, -1) };
    }
    default:
      return state;
  }
}

/* ---- misura dell'area, per inquadrare e per scartare il fuori campo ---- */

function useSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      // La scheda inattiva è `hidden`: misura zero, e inquadrare su zero
      // manderebbe la vista all'infinito.
      if (width > 0 && height > 0) setSize({ width, height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/* ---- vista ---- */

export default function GraphView({ tab }) {
  const [session, setSession] = useState(null);
  const [model, dispatch] = useReducer(reducer, { draft: null, initial: null, undo: [], redo: [] });
  const [layout, setLayout] = useState({});
  const [view, setView] = useState({});
  const [viewport, setViewport] = useState({ x: 0, y: 0, z: 1 });
  const [selection, setSelection] = useState(() => new Set());
  const [selectedEdge, setSelectedEdge] = useState(null);
  const [editing, setEditing] = useState(null);
  const [fkPanel, setFkPanel] = useState(null);
  const [linking, setLinking] = useState(null);
  const [applying, setApplying] = useState(false);
  const [keysOnly, setKeysOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [opening, setOpening] = useState(true);

  const wrap = useRef(null);
  const canvas = useRef(null);
  const area = useSize(wrap);
  const toast = useStore((s) => s.toast);
  const oracleVersion = useStore((s) => (session ? s.active[session.connId]?.version : null));
  const setTabTitle = useStore((s) => s.setTabTitle);

  const draft = model.draft;
  const apply = useCallback((fn) => dispatch({ type: 'apply', fn }), []);
  // I gestori registrati su window vivono più a lungo del render che li ha
  // creati: leggono il diagramma da qui invece che dalla chiusura.
  const draftRef = useRef(draft);
  draftRef.current = draft;

  /* ---- apertura ---- */

  const onOpened = useCallback(
    (r) => {
      // Il filtro fa parte della sessione: rileggendo, il diagramma deve
      // ritrovare lo stesso sottoinsieme, non l'intero schema.
      setSession({ sessionId: r.sessionId, connId: r.connId, owner: r.owner, filter: r.filter ?? '' });
      dispatch({ type: 'load', draft: r.draft });
      setOpening(false);
      // Il layout salvato è indicizzato per nome: gli id vivono solo dentro
      // una sessione, e da una sessione all'altra non significherebbero nulla.
      const saved = r.layout?.nodes || {};
      const pos = {};
      const views = {};
      let missing = 0;
      for (const t of Object.values(r.draft.tables)) {
        const s = saved[t.name];
        if (s && Number.isFinite(s.x)) {
          pos[t.uid] = { x: s.x, y: s.y };
          views[t.uid] = { collapsed: !!s.collapsed, w: s.w || 0 };
        } else missing++;
      }
      const auto = missing ? autoLayout(r.draft, views) : {};
      for (const t of Object.values(r.draft.tables)) if (!pos[t.uid]) pos[t.uid] = auto[t.uid] || { x: 0, y: 0 };
      setLayout(pos);
      setView(views);
      setTabTitle(tab.id, `${r.owner} — diagramma`);
    },
    [setTabTitle, tab.id]
  );

  /* ---- salvataggio del layout, in differita ---- */

  useEffect(() => {
    if (!session || !draft) return undefined;
    const timer = setTimeout(() => {
      const nodes = {};
      for (const t of Object.values(draft.tables)) {
        const p = layout[t.uid];
        if (!p) continue;
        const v = view[t.uid] || {};
        nodes[t.name] = { x: Math.round(p.x), y: Math.round(p.y), collapsed: !!v.collapsed, w: v.w || 0 };
      }
      api.saveGraphLayout(session.connId, session.owner, { viewport, nodes }).catch(() => {});
    }, 900);
    return () => clearTimeout(timer);
  }, [session, draft, layout, view, viewport]);

  /* ---- derivati ---- */

  const viewWith = useMemo(() => {
    if (!draft) return {};
    const out = {};
    for (const t of Object.values(draft.tables)) out[t.uid] = { ...(view[t.uid] || {}), keysOnly };
    return out;
  }, [draft, view, keysOnly]);

  const edges = useMemo(() => (draft ? foreignKeys(draft) : []), [draft]);
  const changes = useMemo(
    () => (draft ? changeSummary(draft, model.initial) : []),
    [draft, model.initial]
  );
  const issues = useMemo(
    () => (draft ? validateDraft(draft, { oracleVersion }) : []),
    [draft, oracleVersion]
  );
  const issuesByTable = useMemo(() => {
    const map = new Map();
    for (const i of issues) {
      if (!i.tableUid) continue;
      if (!map.has(i.tableUid)) map.set(i.tableUid, []);
      map.get(i.tableUid).push(i);
    }
    return map;
  }, [issues]);
  const changedTables = useMemo(() => new Set(changes.map((c) => c.tableUid)), [changes]);

  const lod = lodFor(viewport.z);

  // Le modifiche in sospeso non si persistono: chiudere la scheda le perde, e
  // va detto prima di farlo.
  useEffect(() => {
    setCloseGuard(
      tab.id,
      changes.length
        ? () =>
            window.confirm(
              `Il diagramma ha ${changes.length} modifiche non applicate: chiudendolo vanno perse. Chiudere?`
            )
        : null
    );
    return () => setCloseGuard(tab.id, null);
  }, [tab.id, changes.length]);

  // Si disegna solo quello che si vede, allargato di un margine: sotto le
  // duemila tabelle basta un ciclo, senza strutture di supporto.
  const visible = useMemo(() => {
    if (!draft) return [];
    const tables = liveTables(draft);
    if (!area.width) return tables;
    const m = 400;
    const x0 = (-viewport.x - m) / viewport.z;
    const y0 = (-viewport.y - m) / viewport.z;
    const x1 = (-viewport.x + area.width + m) / viewport.z;
    const y1 = (-viewport.y + area.height + m) / viewport.z;
    return tables.filter((t) => {
      const p = layout[t.uid];
      if (!p) return false;
      const { w, h } = nodeSize(t, viewWith[t.uid] || {});
      return p.x < x1 && p.x + w > x0 && p.y < y1 && p.y + h > y0;
    });
  }, [draft, layout, viewWith, viewport, area]);

  const worldBox = useMemo(() => {
    const b = draft ? boundsOf(draft, layout, viewWith) : null;
    return b ? { x: b.x - 300, y: b.y - 300, w: b.w + 600, h: b.h + 600 } : { x: 0, y: 0, w: 0, h: 0 };
  }, [draft, layout, viewWith]);

  /* ---- inquadratura ---- */

  const fit = useCallback(
    (uids = null) => {
      if (!draft || !area.width) return;
      const box = boundsOf(draft, layout, viewWith, uids);
      const vp = fitViewport(box, area);
      if (vp) setViewport(vp);
    },
    [draft, layout, viewWith, area]
  );

  const focusTable = useCallback(
    (uid) => {
      setSelection(new Set([uid]));
      fit(new Set([uid]));
    },
    [fit]
  );

  // Alla prima misura utile dell'area si inquadra tutto.
  const fitted = useRef(false);
  useEffect(() => {
    if (!fitted.current && draft && area.width) {
      fitted.current = true;
      fit();
    }
  }, [draft, area, fit]);

  /* ---- trascinamento dei nodi ---- */

  const drag = useRef(null);

  const onNodePointerDown = (e, uid) => {
    if (e.button !== 0) return;
    if (e.target.closest('.gnode-port, .gedit')) return;
    e.stopPropagation();
    setSelectedEdge(null);
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    let next = selection;
    if (additive) {
      next = new Set(selection);
      next.has(uid) ? next.delete(uid) : next.add(uid);
    } else if (!selection.has(uid)) {
      next = new Set([uid]);
    }
    setSelection(next);
    drag.current = {
      uids: [...next],
      start: canvas.current.toGraph(e.clientX, e.clientY),
      origin: Object.fromEntries([...next].map((u) => [u, layout[u]])),
    };
  };

  useEffect(() => {
    const move = (e) => {
      if (drag.current) {
        const now = canvas.current.toGraph(e.clientX, e.clientY);
        const dx = now.x - drag.current.start.x;
        const dy = now.y - drag.current.start.y;
        setLayout((l) => {
          const next = { ...l };
          for (const uid of drag.current.uids) {
            const o = drag.current.origin[uid];
            if (o) next[uid] = { x: Math.round(o.x + dx), y: Math.round(o.y + dy) };
          }
          return next;
        });
      }
      if (linking) setLinking((k) => k && { ...k, to: canvas.current.toGraph(e.clientX, e.clientY) });
    };

    const up = (e) => {
      drag.current = null;
      if (!linking) return;
      // Il bersaglio si trova da quello che c'è davvero sotto il puntatore:
      // più affidabile che rincorrere gli eventi sui figli.
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const node = el?.closest('[data-table-uid]');
      const row = el?.closest('[data-column-uid]');
      const toTableUid = node?.getAttribute('data-table-uid');
      const toColumnUid = row?.getAttribute('data-column-uid');
      setLinking(null);
      if (!toTableUid || toTableUid === linking.fromTableUid) return;

      // Le verifiche stanno qui e non dentro `apply`: il reducer deve restare
      // puro, e un avviso è un effetto a tutti gli effetti.
      const current = draftRef.current;
      const parent = current.tables[toTableUid];
      const target = toColumnUid ? [toColumnUid] : pkColumnUids(parent);
      if (!target.length) {
        toast(`${parent.name} non ha una chiave primaria su cui puntare`, 'error');
        return;
      }
      const args = {
        fromTableUid: linking.fromTableUid,
        fromColumnUids: [linking.fromColumnUid],
        toTableUid,
        toColumnUids: target,
      };
      if (addForeignKey(current, args) === current) {
        toast('Le colonne non combaciano: la foreign key non è stata creata', 'error');
        return;
      }
      apply((d) => addForeignKey(d, args));
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [linking, apply, toast]);

  /* ---- tastiera ---- */

  useEffect(() => {
    const onKey = (e) => {
      if (!draft) return;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? 'redo' : 'undo' });
        return;
      }
      if (typing) return;
      if (e.key === 'Escape') {
        setEditing(null);
        setFkPanel(null);
        return;
      }
      if (e.key === 'Delete' && selectedEdge) {
        e.preventDefault();
        const edge = edges.find((x) => x.uid === selectedEdge);
        if (edge) apply((d) => removeConstraint(d, edge.fromTable.uid, selectedEdge));
        setSelectedEdge(null);
        return;
      }
      if (e.key === 'Delete' && selection.size) {
        e.preventDefault();
        apply((d) => [...selection].reduce((acc, uid) => deleteTable(acc, uid), d));
        setSelection(new Set());
        return;
      }
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        fit(e.shiftKey || !selection.size ? null : selection);
        return;
      }
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        newTable();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, selection, selectedEdge, edges, apply, fit]);

  const newTable = () => {
    const table = emptyTable('NUOVA_TABELLA');
    const center = area.width
      ? { x: (area.width / 2 - viewport.x) / viewport.z, y: (area.height / 2 - viewport.y) / viewport.z }
      : { x: 0, y: 0 };
    apply((d) => addTable(d, table));
    setLayout((l) => ({ ...l, [table.uid]: { x: Math.round(center.x), y: Math.round(center.y) } }));
    setSelection(new Set([table.uid]));
    setEditing(table.uid);
  };

  const relayout = () => {
    const target = selection.size > 1 ? selection : null;
    const pos = autoLayout(draft, viewWith, target);
    setLayout((l) => ({ ...l, ...pos }));
  };

  const onRubberBand = (rect, additive) => {
    const hit = liveTables(draft).filter((t) => {
      const p = layout[t.uid];
      if (!p) return false;
      const { w, h } = nodeSize(t, viewWith[t.uid] || {});
      return p.x < rect.x + rect.w && p.x + w > rect.x && p.y < rect.y + rect.h && p.y + h > rect.y;
    });
    setSelection((s) => new Set(additive ? [...s, ...hit.map((t) => t.uid)] : hit.map((t) => t.uid)));
  };

  const reload = async () => {
    if (!session) return;
    const r = await api.graphSession({
      connId: session.connId,
      owner: session.owner,
      filter: session.filter,
    });
    // Le posizioni salvate restano: si rilegge lo schema, non il disegno.
    onOpened({ ...r, connId: session.connId, owner: session.owner, filter: session.filter });
    toast('Diagramma riletto dal database', 'ok');
  };

  const search = (text) => {
    setQuery(text);
    const q = text.trim().toUpperCase();
    if (!q) return;
    const hit = liveTables(draft).find((t) => t.name.toUpperCase().includes(q));
    if (hit) focusTable(hit.uid);
  };

  if (opening)
    return (
      <OpenGraphModal
        defaults={{ connId: tab.connId, owner: tab.owner }}
        onClose={() => setOpening(false)}
        onOpen={onOpened}
      />
    );
  if (!draft)
    return (
      <div className="empty-state">
        <p>Nessun diagramma aperto.</p>
        <button className="btn primary" onClick={() => setOpening(true)}>
          Apri un diagramma
        </button>
      </div>
    );

  const errors = issues.filter((i) => i.level === 'error').length;

  return (
    <div className="graph-view">
      <div className="graph-toolbar">
        <span className="beta-badge">beta</span>
        <span className="graph-schema">{session.owner}</span>
        <div className="graph-search">
          <Search size={13} />
          <input placeholder="Cerca una tabella…" value={query} onChange={(e) => search(e.target.value)} />
        </div>
        <button className="icon-btn" title="Nuova tabella (N)" onClick={newTable}>
          <Plus size={14} />
        </button>
        <button className="icon-btn" title="Disponi automaticamente" onClick={relayout}>
          <LayoutGrid size={14} />
        </button>
        <button className="icon-btn" title="Inquadra tutto (Maiusc+F)" onClick={() => fit()}>
          <Maximize2 size={14} />
        </button>
        <button
          className={`icon-btn ${keysOnly ? 'on' : ''}`}
          title="Mostra solo le colonne chiave"
          onClick={() => setKeysOnly((v) => !v)}
        >
          <KeyRound size={14} />
        </button>
        <button className="icon-btn" title="Annulla (Ctrl+Z)" disabled={!model.undo.length} onClick={() => dispatch({ type: 'undo' })}>
          <Undo2 size={14} />
        </button>
        <button className="icon-btn" title="Ripeti (Ctrl+Maiusc+Z)" disabled={!model.redo.length} onClick={() => dispatch({ type: 'redo' })}>
          <Redo2 size={14} />
        </button>
        <button className="icon-btn" title="Rileggi dal database" onClick={reload}>
          <RefreshCw size={14} />
        </button>
        <div style={{ flex: 1 }} />
        <span className="graph-zoom">{Math.round(viewport.z * 100)}%</span>
        <button
          className="btn primary"
          disabled={!changes.length}
          title={errors ? 'Ci sono errori da correggere' : 'Genera lo script e applicalo'}
          onClick={() => setApplying(true)}
        >
          <Upload size={13} /> Applica{changes.length ? ` (${changes.length})` : ''}
        </button>
      </div>

      <div className="graph-body">
        <div className="graph-canvas-wrap" ref={wrap}>
          <Canvas
            ref={canvas}
            viewport={viewport}
            onViewport={setViewport}
            onRubberBand={onRubberBand}
            onBackgroundDown={(e, additive) => {
              setSelectedEdge(null);
              setEditing(null);
              if (!additive) setSelection(new Set());
            }}
          >
            <Edges
              draft={draft}
              edges={edges}
              layout={layout}
              view={viewWith}
              selected={selectedEdge}
              box={worldBox}
              linking={linking}
              onSelect={setSelectedEdge}
              onOpen={(uid) => {
                const e = edges.find((x) => x.uid === uid);
                if (e) setFkPanel({ tableUid: e.fromTable.uid, constraintUid: uid });
              }}
            />
            {visible.map((t) => (
              <TableNode
                key={t.uid}
                table={t}
                pos={layout[t.uid] || { x: 0, y: 0 }}
                view={viewWith[t.uid] || {}}
                lod={editing === t.uid ? LOD.FULL : lod}
                selected={selection.has(t.uid)}
                editing={editing === t.uid}
                issues={issuesByTable.get(t.uid) || []}
                changed={changedTables.has(t.uid)}
                apply={apply}
                onPointerDown={(e) => onNodePointerDown(e, t.uid)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setEditing(t.uid);
                }}
                onToggleCollapse={() =>
                  setView((v) => ({ ...v, [t.uid]: { ...(v[t.uid] || {}), collapsed: !v[t.uid]?.collapsed } }))
                }
                onStartLink={(e, tableUid, columnUid) => {
                  e.stopPropagation();
                  const from = canvas.current.toGraph(e.clientX, e.clientY);
                  setLinking({ fromTableUid: tableUid, fromColumnUid: columnUid, from, to: from });
                }}
                onOpenFk={(constraintUid) => setFkPanel({ tableUid: t.uid, constraintUid })}
                onCloseEditor={() => setEditing(null)}
              />
            ))}
          </Canvas>

          {fkPanel && (
            <FkPanel
              draft={draft}
              tableUid={fkPanel.tableUid}
              constraintUid={fkPanel.constraintUid}
              apply={apply}
              onClose={() => setFkPanel(null)}
            />
          )}
        </div>

        <ChangesPanel
          changes={changes}
          issues={issues}
          onFocus={focusTable}
          onRevert={(uid) => apply((d) => revertTable(d, model.initial, uid))}
        />
      </div>

      {applying && (
        <ApplyModal
          sessionId={session.sessionId}
          connId={session.connId}
          owner={session.owner}
          draft={draft}
          schemaLabel={session.owner}
          onClose={() => setApplying(false)}
          onApplied={() => {
            setApplying(false);
            reload().catch((err) => toast(err.message, 'error'));
          }}
        />
      )}
    </div>
  );
}
