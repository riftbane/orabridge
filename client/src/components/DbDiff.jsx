import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronRight,
  Copy,
  FileCode,
  Play,
  RefreshCw,
  Search,
} from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.js';
import Editor from './Editor.jsx';
import { TypeIcon } from './ObjectTree.jsx';
import { diffRows, foldRows } from '../textDiff.js';

const TYPES = [
  ['TABLE', 'Tabelle'],
  ['VIEW', 'Viste'],
  ['MATERIALIZED VIEW', 'Viste materializzate'],
  ['SEQUENCE', 'Sequenze'],
  ['SYNONYM', 'Sinonimi'],
  ['PROCEDURE', 'Procedure'],
  ['FUNCTION', 'Funzioni'],
  ['PACKAGE', 'Package'],
  ['PACKAGE BODY', 'Package Body'],
  ['TRIGGER', 'Trigger'],
  ['TYPE', 'Tipi'],
];

const STATUS = {
  'only-source': ['solo in origine', 'src'],
  'only-target': ['solo in destinazione', 'tgt'],
  different: ['diverso', 'mod'],
  same: ['uguale', 'same'],
};

// Filtri per stato, con l'etichetta corta usata sui chip e la chiave del
// conteggio restituito dal server.
const STATUS_FILTERS = [
  ['only-source', 'solo origine', 'onlySource'],
  ['only-target', 'solo destinazione', 'onlyTarget'],
  ['different', 'diversi', 'different'],
  ['same', 'uguali', 'same'],
];

// All'apertura del risultato interessano le differenze: gli oggetti identici
// si mostrano solo se richiesti.
const DEFAULT_STATUSES = ['only-source', 'only-target', 'different'];

// Confronto sul testo: il diff riga per riga si chiede al server solo per
// l'oggetto aperto.
const TEXT_TYPES = new Set([
  'VIEW',
  'MATERIALIZED VIEW',
  'TRIGGER',
  'PROCEDURE',
  'FUNCTION',
  'PACKAGE',
  'PACKAGE BODY',
  'TYPE',
]);

const OPTIONS = [
  ['ignoreGeneratedNames', 'Ignora i nomi generati dal sistema', 'Accoppia i vincoli e gli indici chiamati SYS_C… in base alla loro definizione invece che al nome.'],
  ['ignoreWhitespace', 'Ignora indentazione e righe vuote', 'Nel confronto del codice sorgente. I cambi di riga restano differenze.'],
  ['ignoreCase', 'Ignora maiuscole e minuscole', 'Nel confronto del codice sorgente.'],
  ['remapSchema', 'Rimappa lo schema', "Un riferimento allo schema di origine equivale al corrispondente riferimento allo schema di destinazione."],
  ['compareConstraints', 'Confronta i vincoli', ''],
  ['compareIndexes', 'Confronta gli indici', ''],
  ['compareComments', 'Confronta i commenti', ''],
];

const DEFAULT_OPTIONS = {
  ignoreGeneratedNames: true,
  ignoreWhitespace: true,
  ignoreCase: false,
  remapSchema: true,
  compareConstraints: true,
  compareIndexes: true,
  compareComments: true,
};

function useSchemas(connId) {
  const [list, setList] = useState(null);
  useEffect(() => {
    let alive = true;
    setList(null);
    if (!connId) return undefined;
    api
      .schemas(connId)
      .then((r) => alive && setList(r.schemas))
      .catch(() => alive && setList([]));
    return () => {
      alive = false;
    };
  }, [connId]);
  return list;
}

function Endpoint({ label, conns, connId, owner, onConn, onOwner }) {
  const schemas = useSchemas(connId);
  const defaultOwner = useStore((s) => s.active[connId]?.currentSchema);

  // Alla scelta della connessione si parte dallo schema di lavoro.
  useEffect(() => {
    if (!owner && defaultOwner) onOwner(defaultOwner);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connId, defaultOwner]);

  return (
    <div className="diff-endpoint">
      <span className="diff-endpoint-label">{label}</span>
      <select value={connId || ''} onChange={(e) => onConn(e.target.value)}>
        {!connId && <option value="">— scegli —</option>}
        {conns.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <select value={owner || ''} onChange={(e) => onOwner(e.target.value)} disabled={!connId}>
        {!owner && <option value="">— schema —</option>}
        {(schemas || (owner ? [owner] : [])).map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      {connId && !schemas && <span className="diff-loading">…</span>}
    </div>
  );
}

// ---- dettaglio: differenze strutturali ----

function ChangeTable({ changes }) {
  return (
    <div className="diff-changes">
      <div className="diff-change diff-change-head">
        <span>Elemento</span>
        <span>Nome</span>
        <span>Origine</span>
        <span>Destinazione</span>
      </div>
      {changes.map((c, i) => (
        <div key={i} className={`diff-change ${STATUS[c.change][1]}`}>
          <span className="diff-change-kind">{c.kind}</span>
          <span className="diff-change-name">{c.name}</span>
          <span className="diff-change-val">{c.source ?? <em>assente</em>}</span>
          <span className="diff-change-val">{c.target ?? <em>assente</em>}</span>
        </div>
      ))}
    </div>
  );
}

// ---- dettaglio: confronto del testo, affiancato ----

const MAX_RENDER = 2000;

function TextDiff({ left, right }) {
  const rows = useMemo(() => diffRows(left, right), [left, right]);
  const folded = useMemo(() => foldRows(rows, 3), [rows]);
  const [expanded, setExpanded] = useState(() => new Set());

  const list = useMemo(() => {
    const out = [];
    for (const r of folded) {
      if (r.type === 'fold' && !expanded.has(r.from)) out.push(r);
      else if (r.type === 'fold') out.push(...rows.slice(r.from, r.to));
      else out.push(r);
    }
    return out;
  }, [folded, expanded, rows]);

  const shown = list.slice(0, MAX_RENDER);

  return (
    <div className="tdiff">
      {shown.map((r, i) =>
        r.type === 'fold' ? (
          <button
            key={`f${r.from}`}
            className="tdiff-fold"
            onClick={() => setExpanded((s) => new Set(s).add(r.from))}
          >
            ⋯ {r.count} righe uguali
          </button>
        ) : (
          <div key={i} className={`tdiff-row ${r.type}`}>
            <span className="tdiff-no">{r.ln ?? ''}</span>
            <pre className="tdiff-txt">{r.left ?? ''}</pre>
            <span className="tdiff-no">{r.rn ?? ''}</span>
            <pre className="tdiff-txt">{r.right ?? ''}</pre>
          </div>
        )
      )}
      {list.length > MAX_RENDER && (
        <div className="tree-info">…altre {list.length - MAX_RENDER} righe non mostrate</div>
      )}
    </div>
  );
}

function Detail({ runId, item, source, target }) {
  const [detail, setDetail] = useState(null);
  const [err, setErr] = useState(null);
  // Anche gli oggetti presenti da un lato solo hanno un dettaglio da mostrare:
  // il sorgente di quello che c'è, o l'elenco delle colonne per le tabelle.
  const needsDetail =
    !!item &&
    item.status !== 'same' &&
    (TEXT_TYPES.has(item.type) || (item.type === 'TABLE' && item.status !== 'different'));

  useEffect(() => {
    let alive = true;
    setDetail(null);
    setErr(null);
    if (!needsDetail) return undefined;
    api
      .diffDetail(runId, item.type, item.name)
      .then((r) => alive && setDetail(r))
      .catch((e) => alive && setErr(e.message));
    return () => {
      alive = false;
    };
  }, [runId, needsDetail, item?.type, item?.name]);

  if (!item) return <div className="grid-empty">Scegli un oggetto per vedere le differenze</div>;

  const [label, cls] = STATUS[item.status];
  const structural = [
    ...(item.changes?.filter((c) => c.kind !== 'Sorgente') || []),
    ...(detail?.changes || []),
  ];
  const hasText = !!detail && (detail.source || detail.target);

  return (
    <div className="diff-detail">
      <div className="diff-detail-head">
        <TypeIcon type={item.type} />
        <span className="obj-title">{item.name}</span>
        <span className="obj-type">{item.type}</span>
        <span className={`diff-badge ${cls}`}>{label}</span>
        <div style={{ flex: 1 }} />
        <span className="diff-sides">
          <span className="diff-side-src">{source.owner}</span>
          <ArrowLeftRight size={12} />
          <span className="diff-side-tgt">{target.owner}</span>
        </span>
      </div>
      <div className="diff-detail-body">
        {item.status === 'only-source' && (
          <div className="tree-info">
            Presente solo in origine: nella destinazione va creato.
          </div>
        )}
        {item.status === 'only-target' && (
          <div className="tree-info">
            Presente solo nella destinazione: nell'origine non esiste.
          </div>
        )}
        {!!structural.length && <ChangeTable changes={structural} />}
        {needsDetail &&
          (err ? (
            <div className="grid-empty error">{err}</div>
          ) : !detail ? (
            <div className="grid-empty">Caricamento del sorgente…</div>
          ) : hasText ? (
            <TextDiff left={detail.source} right={detail.target} />
          ) : null)}
        {item.status === 'same' && <div className="tree-info">Nessuna differenza.</div>}
      </div>
    </div>
  );
}

// ---- pannello dello script ----

// Lo script vive nella scheda, non qui: passando alle differenze e tornando
// indietro resta quello già generato, e non serve rifarlo per rileggerlo.
function ScriptPane({
  runId,
  count,
  selected,
  source,
  target,
  connLabel,
  includeDrops,
  setIncludeDrops,
  script,
  setScript,
}) {
  const toast = useStore((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const generate = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.diffScript(runId, {
        keys: [...selected],
        includeDrops,
        sourceLabel: connLabel(source.connId),
        targetLabel: connLabel(target.connId),
      });
      setScript(r);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(script.sql);
      toast('Script copiato', 'ok');
    } catch {
      toast('Copia non riuscita', 'error');
    }
  };

  return (
    <div className="diff-script">
      <div className="obj-toolbar">
        <button className="btn run" onClick={generate} disabled={busy || !count}>
          <FileCode size={13} /> {busy ? 'Generazione…' : 'Genera script'}
        </button>
        <label className="diff-check">
          <input
            type="checkbox"
            checked={includeDrops}
            onChange={(e) => setIncludeDrops(e.target.checked)}
          />
          includi le eliminazioni (DROP)
        </label>
        <span className="pane-info">
          {count} {count === 1 ? 'oggetto selezionato' : 'oggetti selezionati'}
        </span>
        <div style={{ flex: 1 }} />
        {script && (
          <>
            <span className="pane-info">{script.stats.statements} istruzioni</span>
            <button className="btn" onClick={copy}>
              <Copy size={13} /> Copia
            </button>
            <button
              className="btn"
              title="Apre lo script in un foglio SQL sulla connessione di destinazione"
              onClick={() => useStore.getState().openWorksheet(target.connId, script.sql)}
            >
              Apri in un foglio SQL
            </button>
          </>
        )}
      </div>
      {err && <div className="grid-empty error">{err}</div>}
      {script ? (
        <div className="code-view">
          <Editor value={script.sql} readOnly />
        </div>
      ) : (
        !err && (
          <div className="grid-empty">
            Lo script porta la <b>destinazione</b> allo stato dell'origine. Viene solo generato:
            va riletto ed eseguito a mano.
          </div>
        )
      )}
    </div>
  );
}

// ---- scheda DB Diff ----

export default function DbDiff({ tab }) {
  const conns = useStore((s) => s.conns);
  const active = useStore((s) => s.active);
  const toast = useStore((s) => s.toast);
  const connected = useMemo(
    () => conns.filter((c) => active[c.id]?.status === 'connected'),
    [conns, active]
  );
  const connLabel = useCallback(
    (id) => conns.find((c) => c.id === id)?.name || '',
    [conns]
  );

  const [src, setSrc] = useState({ connId: connected[0]?.id || '', owner: '' });
  const [tgt, setTgt] = useState({
    connId: connected[1]?.id || connected[0]?.id || '',
    owner: '',
  });
  const [types, setTypes] = useState(() => new Set(TYPES.map(([t]) => t)));
  const [opts, setOpts] = useState(DEFAULT_OPTIONS);
  const [filter, setFilter] = useState('');
  const [setupOpen, setSetupOpen] = useState(true);

  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [current, setCurrent] = useState(null);
  const [pane, setPane] = useState('Differenze');
  const [statuses, setStatuses] = useState(() => new Set(DEFAULT_STATUSES));
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [listFilter, setListFilter] = useState('');
  const [includeDrops, setIncludeDrops] = useState(false);
  const [script, setScript] = useState(null);

  // Uno script generato con un'altra selezione è peggio di nessuno script:
  // meglio rifarlo che rischiare di copiarne uno che non corrisponde più.
  useEffect(() => {
    setScript(null);
  }, [selected, includeDrops]);

  const toggleType = (t) =>
    setTypes((s) => {
      const n = new Set(s);
      n.has(t) ? n.delete(t) : n.add(t);
      return n;
    });

  const swap = () => {
    setSrc(tgt);
    setTgt(src);
  };

  const run = async () => {
    if (!src.connId || !src.owner || !tgt.connId || !tgt.owner) {
      setError('Scegli connessione e schema per origine e destinazione');
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const r = await api.diffRun({
        sourceConnId: src.connId,
        sourceOwner: src.owner,
        targetConnId: tgt.connId,
        targetOwner: tgt.owner,
        types: [...types],
        filter,
        ...opts,
      });
      setResult(r);
      const diffs = r.items.filter((i) => i.status !== 'same');
      setSelected(new Set(diffs.map((i) => i.key)));
      setCurrent(diffs[0]?.key ?? null);
      setPane('Differenze');
      setStatuses(new Set(DEFAULT_STATUSES));
      setCollapsed(new Set());
      setListFilter('');
      setSetupOpen(false);
      useStore
        .getState()
        .setTabTitle(tab.id, `${connLabel(src.connId)} → ${connLabel(tgt.connId)}`);
      if (!diffs.length) toast('Nessuna differenza fra i due schemi', 'ok');
    } catch (err) {
      setError(err.message);
      if (err.status === 409) {
        useStore.getState().refreshConnections().catch(() => {});
      }
    } finally {
      setRunning(false);
    }
  };

  const { groups, visible } = useMemo(() => {
    if (!result) return { groups: [], visible: [] };
    const q = listFilter.trim().toLowerCase();
    const visible = result.items.filter(
      (i) => statuses.has(i.status) && (!q || i.name.toLowerCase().includes(q))
    );
    const byType = new Map();
    for (const it of visible) {
      if (!byType.has(it.type)) byType.set(it.type, []);
      byType.get(it.type).push(it);
    }
    const groups = TYPES.filter(([t]) => byType.has(t)).map(([t, label]) => ({
      type: t,
      label,
      items: byType.get(t),
    }));
    return { groups, visible };
  }, [result, statuses, listFilter]);

  const toggleSel = (key) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });

  // Gli oggetti identici non entrano mai nello script: restano fuori dal
  // conteggio, altrimenti il gruppo non si deselezionerebbe mai quando sono
  // visibili.
  const selectable = (items) => items.filter((i) => i.status !== 'same');

  const groupState = (items) => {
    const list = selectable(items);
    const n = list.filter((i) => selected.has(i.key)).length;
    return { all: list.length > 0 && n === list.length, some: n > 0 && n < list.length };
  };

  const toggleGroup = (items) =>
    setSelected((s) => {
      const n = new Set(s);
      const list = selectable(items);
      const all = list.length > 0 && list.every((i) => n.has(i.key));
      for (const i of list) (all ? n.delete(i.key) : n.add(i.key));
      return n;
    });

  // Selezione di massa: agisce su ciò che è in elenco in quel momento, così
  // filtrando per stato o per nome si sceglie un blocco intero in un colpo
  // solo invece di spuntare gruppo per gruppo.
  const bulkSelect = (mode) =>
    setSelected((s) => {
      const n = new Set(s);
      for (const i of selectable(visible)) {
        if (mode === 'all') n.add(i.key);
        else if (mode === 'none') n.delete(i.key);
        else n.has(i.key) ? n.delete(i.key) : n.add(i.key);
      }
      return n;
    });

  const toggleStatus = (st) =>
    setStatuses((s) => {
      const n = new Set(s);
      n.has(st) ? n.delete(st) : n.add(st);
      return n;
    });

  const allCollapsed = groups.length > 0 && groups.every((g) => collapsed.has(g.type));
  const toggleAllGroups = () =>
    setCollapsed(allCollapsed ? new Set() : new Set(groups.map((g) => g.type)));

  const selectedCount = useMemo(
    () => (result ? result.items.filter((i) => i.status !== 'same' && selected.has(i.key)).length : 0),
    [result, selected]
  );
  const visibleSelectable = selectable(visible).length;

  const currentItem = result?.items.find((i) => i.key === current) || null;

  return (
    <div className="dbdiff">
      <div className="diff-setup">
        <div className="diff-setup-head">
          <Endpoint
            label="Origine"
            conns={connected}
            connId={src.connId}
            owner={src.owner}
            onConn={(connId) => setSrc({ connId, owner: '' })}
            onOwner={(owner) => setSrc((s) => ({ ...s, owner }))}
          />
          <button className="icon-btn" title="Inverti origine e destinazione" onClick={swap}>
            <ArrowLeftRight size={14} />
          </button>
          <Endpoint
            label="Destinazione"
            conns={connected}
            connId={tgt.connId}
            owner={tgt.owner}
            onConn={(connId) => setTgt({ connId, owner: '' })}
            onOwner={(owner) => setTgt((s) => ({ ...s, owner }))}
          />
          <button className="btn primary" onClick={run} disabled={running}>
            {running ? (
              <>
                <RefreshCw size={13} className="spin" /> Confronto…
              </>
            ) : (
              <>
                <Play size={13} /> Confronta
              </>
            )}
          </button>
          <div style={{ flex: 1 }} />
          {result && (
            <button className="mini-btn" onClick={() => setSetupOpen((v) => !v)}>
              {setupOpen ? 'Nascondi opzioni' : 'Opzioni'}
            </button>
          )}
        </div>

        {setupOpen && (
          <div className="diff-setup-body">
            <div className="diff-opt-group">
              <span className="diff-opt-title">
                Tipi di oggetto
                <button className="mini-btn" onClick={() => setTypes(new Set(TYPES.map(([t]) => t)))}>
                  tutti
                </button>
                <button className="mini-btn" onClick={() => setTypes(new Set())}>
                  nessuno
                </button>
              </span>
              <div className="diff-types">
                {TYPES.map(([t, label]) => (
                  <button
                    key={t}
                    className={`col-chip ${types.has(t) ? 'on' : ''}`}
                    onClick={() => toggleType(t)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="diff-opt-group">
              <span className="diff-opt-title">Opzioni</span>
              <div className="diff-opts">
                {OPTIONS.map(([k, label, hint]) => (
                  <label key={k} className="diff-check" title={hint}>
                    <input
                      type="checkbox"
                      checked={opts[k]}
                      onChange={(e) => setOpts((o) => ({ ...o, [k]: e.target.checked }))}
                    />
                    {label}
                  </label>
                ))}
                <label className="diff-check diff-filter">
                  Solo i nomi che contengono
                  <input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="tutti — accetta % e _"
                  />
                </label>
              </div>
            </div>
          </div>
        )}
        {error && <div className="test-result err">{error}</div>}
      </div>

      {!result ? (
        <div className="grid-empty">
          {running
            ? 'Lettura dei due dizionari in corso…'
            : 'Scegli origine e destinazione, poi «Confronta».'}
        </div>
      ) : (
        <>
          <div className="pane-tabs">
            {['Differenze', 'Script di sincronizzazione'].map((p) => (
              <button key={p} className={pane === p ? 'on' : ''} onClick={() => setPane(p)}>
                {p}
              </button>
            ))}
            <div style={{ flex: 1 }} />
            <span className="diff-counts">
              <span className="diff-badge src">{result.counts.onlySource} solo in origine</span>
              <span className="diff-badge tgt">
                {result.counts.onlyTarget} solo in destinazione
              </span>
              <span className="diff-badge mod">{result.counts.different} diversi</span>
              <span className="diff-badge same">{result.counts.same} uguali</span>
            </span>
            <span className="pane-info">{result.ms} ms</span>
          </div>
          <div className="pane-body">
            {pane === 'Differenze' ? (
              <div className="diff-split">
                <div className="diff-list">
                  <div className="diff-list-head">
                    <Search size={12} />
                    <input
                      value={listFilter}
                      onChange={(e) => setListFilter(e.target.value)}
                      placeholder="filtra per nome…"
                    />
                  </div>
                  <div className="diff-list-tools">
                    {STATUS_FILTERS.map(([st, label, countKey]) => (
                      <button
                        key={st}
                        className={`col-chip ${statuses.has(st) ? 'on' : ''}`}
                        title={`Mostra o nascondi gli oggetti «${STATUS[st][0]}»`}
                        onClick={() => toggleStatus(st)}
                      >
                        {label} <span className="tree-count">{result.counts[countKey]}</span>
                      </button>
                    ))}
                  </div>
                  <div className="diff-list-tools">
                    <span className="diff-tools-label">selezione</span>
                    <button
                      className="mini-btn"
                      title="Seleziona tutti gli oggetti in elenco"
                      disabled={!visibleSelectable}
                      onClick={() => bulkSelect('all')}
                    >
                      tutti
                    </button>
                    <button
                      className="mini-btn"
                      title="Togli la selezione da tutti gli oggetti in elenco"
                      disabled={!visibleSelectable}
                      onClick={() => bulkSelect('none')}
                    >
                      nessuno
                    </button>
                    <button
                      className="mini-btn"
                      title="Inverti la selezione degli oggetti in elenco"
                      disabled={!visibleSelectable}
                      onClick={() => bulkSelect('invert')}
                    >
                      inverti
                    </button>
                    <div style={{ flex: 1 }} />
                    <button
                      className="mini-btn"
                      disabled={!groups.length}
                      onClick={toggleAllGroups}
                    >
                      {allCollapsed ? 'espandi' : 'comprimi'}
                    </button>
                  </div>
                  <div className="diff-list-body">
                    {!groups.length && <div className="tree-info">Nessun oggetto da mostrare</div>}
                    {groups.map((g) => (
                      <div key={g.type} className="diff-group">
                        <div className="diff-group-head">
                          <input
                            type="checkbox"
                            checked={groupState(g.items).all}
                            ref={(el) => {
                              if (el) el.indeterminate = groupState(g.items).some;
                            }}
                            disabled={!selectable(g.items).length}
                            title="Seleziona o deseleziona tutta la categoria"
                            onChange={() => toggleGroup(g.items)}
                          />
                          <button
                            className="diff-group-toggle"
                            onClick={() =>
                              setCollapsed((s) => {
                                const n = new Set(s);
                                n.has(g.type) ? n.delete(g.type) : n.add(g.type);
                                return n;
                              })
                            }
                          >
                            {collapsed.has(g.type) ? (
                              <ChevronRight size={11} />
                            ) : (
                              <ChevronDown size={11} />
                            )}
                            <span className="diff-group-title">{g.label}</span>
                            <span className="tree-count">{g.items.length}</span>
                          </button>
                        </div>
                        {!collapsed.has(g.type) &&
                          g.items.map((it) => (
                            <div
                              key={it.key}
                              className={`diff-row ${current === it.key ? 'on' : ''}`}
                              onClick={() => setCurrent(it.key)}
                            >
                              <input
                                type="checkbox"
                                checked={selected.has(it.key)}
                                disabled={it.status === 'same'}
                                onClick={(e) => e.stopPropagation()}
                                onChange={() => toggleSel(it.key)}
                              />
                              <TypeIcon type={it.type} />
                              <span className="diff-row-name">{it.name}</span>
                              <span className={`diff-badge ${STATUS[it.status][1]}`}>
                                {STATUS[it.status][0]}
                              </span>
                            </div>
                          ))}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="diff-detail-wrap">
                  <Detail
                    runId={result.runId}
                    item={currentItem}
                    source={result.source}
                    target={result.target}
                  />
                </div>
              </div>
            ) : (
              <ScriptPane
                runId={result.runId}
                count={selectedCount}
                selected={selected}
                source={result.source}
                target={result.target}
                connLabel={connLabel}
                includeDrops={includeDrops}
                setIncludeDrops={setIncludeDrops}
                script={script}
                setScript={setScript}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
