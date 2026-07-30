import React, { useEffect, useRef, useState } from 'react';
import {
  CaseSensitive,
  ChevronRight,
  Loader2,
  Plug,
  Regex,
  Search,
  SlidersHorizontal,
  WholeWord,
  X,
} from 'lucide-react';
import { useStore } from '../store.js';
import { SEARCH_TYPES } from '../searchTypes.js';
import { TypeIcon } from './ObjectTree.jsx';

const keyOf = (o) => `${o.owner}.${o.name}.${o.type}`;

// Una riga di risultato con il testo trovato evidenziato. Gli estremi arrivano
// dal server (li ha calcolati sulla riga vera); se mancano — regex che Oracle
// capisce e JavaScript no — si mostra la riga senza evidenziazione.
function MatchLine({ m, onOpen }) {
  const hit = m.from != null && m.to > m.from;
  return (
    <div className="csr-line" onClick={onOpen} title={`Riga ${m.line}`}>
      <span className="csr-lineno">{m.line}</span>
      <span className="csr-text">
        {hit ? (
          <>
            {m.text.slice(0, m.from)}
            <mark>{m.text.slice(m.from, m.to)}</mark>
            {m.text.slice(m.to)}
          </>
        ) : (
          m.text
        )}
      </span>
    </div>
  );
}

function ObjectResult({ connId, obj, collapsed, onToggle }) {
  const openObject = useStore((s) => s.openObject);
  return (
    <div className="csr-obj">
      <div className="csr-obj-head" onClick={onToggle}>
        <span className={`tree-arrow ${collapsed ? '' : 'open'}`}>
          <ChevronRight size={12} />
        </span>
        <TypeIcon type={obj.type} />
        <span className="csr-obj-name" title={`${obj.owner}.${obj.name} (${obj.type})`}>
          {obj.name}
        </span>
        <span className="csr-obj-owner">{obj.owner}</span>
        <span className="tree-count">{obj.matches.length}</span>
      </div>
      {!collapsed && (
        <div className="csr-lines">
          {obj.matches.map((m, i) => (
            <MatchLine
              key={`${m.line}-${i}`}
              m={m}
              onOpen={() =>
                openObject(connId, obj.owner, obj.name, obj.type, {
                  line: m.line,
                  text: m.from != null ? m.text.slice(m.from, m.to) : '',
                })
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Vista «Ricerca nel codice»: cerca dentro il sorgente PL/SQL di tutto il
// database (procedure, funzioni, trigger, package body…) e porta con un clic
// alla riga esatta dell'oggetto.
export default function CodeSearchView() {
  const cs = useStore((s) => s.codeSearch);
  const connId = useStore((s) => s.selectedConnId);
  const conns = useStore((s) => s.conns);
  const active = useStore((s) => (connId ? s.active[connId] : null));
  const schemas = useStore((s) => (connId ? s.sqlMeta[connId]?.schemas : null));
  const loadSchemas = useStore((s) => s.loadSchemas);
  const setCodeSearch = useStore((s) => s.setCodeSearch);
  const runCodeSearch = useStore((s) => s.runCodeSearch);
  const connected = active?.status === 'connected';

  const [showFilters, setShowFilters] = useState(true);
  const [collapsed, setCollapsed] = useState({});
  const inputRef = useRef(null);

  // Il fuoco arriva all'apertura della vista e a ogni Ctrl+Maiusc+F.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [cs.focusToken]);

  useEffect(() => {
    if (connected) loadSchemas(connId);
  }, [connected, connId, loadSchemas]);

  // Risultato nuovo: tutti gli oggetti tornano aperti.
  useEffect(() => setCollapsed({}), [cs.result]);

  const toggleType = (t) => {
    const types = cs.types.includes(t) ? cs.types.filter((x) => x !== t) : [...cs.types, t];
    if (types.length) setCodeSearch({ types });
  };

  const result = cs.result;
  // I risultati appartengono alla connessione su cui sono stati cercati:
  // cambiando connessione si svuota l'elenco invece di aprire oggetti altrui.
  const stale = result && result.connId !== connId;

  return (
    <>
      <div className="view-head">
        <span className="view-title">Ricerca nel codice</span>
        {(result || cs.error) && (
          <button
            className="icon-btn"
            title="Pulisci i risultati"
            onClick={() => useStore.getState().clearCodeSearch()}
          >
            <X size={14} />
          </button>
        )}
        <button
          className={`icon-btn ${showFilters ? 'on' : ''}`}
          title="Ambito e tipi di oggetto"
          onClick={() => setShowFilters((v) => !v)}
        >
          <SlidersHorizontal size={13} />
        </button>
      </div>

      <div className="csr-form">
        <select
          className="conn-view-picker"
          value={connId || ''}
          onChange={(e) => useStore.getState().selectConnection(e.target.value)}
          title="Database in cui cercare"
        >
          {!connId && <option value="">Nessuna connessione</option>}
          {conns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.connected ? '● ' : '○ '}
              {c.name}
            </option>
          ))}
        </select>

        <div className="csr-input">
          <input
            ref={inputRef}
            value={cs.query}
            spellCheck={false}
            placeholder="Cerca nel PL/SQL…"
            onChange={(e) => setCodeSearch({ query: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                runCodeSearch();
              }
            }}
          />
          <button
            type="button"
            className={`find-toggle ${cs.caseSensitive ? 'on' : ''}`}
            title="Maiuscole/minuscole"
            onClick={() => setCodeSearch({ caseSensitive: !cs.caseSensitive })}
          >
            <CaseSensitive size={14} />
          </button>
          <button
            type="button"
            className={`find-toggle ${cs.wholeWord ? 'on' : ''}`}
            title="Parola intera"
            disabled={cs.regex}
            onClick={() => setCodeSearch({ wholeWord: !cs.wholeWord })}
          >
            <WholeWord size={14} />
          </button>
          <button
            type="button"
            className={`find-toggle ${cs.regex ? 'on' : ''}`}
            title="Espressione regolare (sintassi Oracle)"
            onClick={() => setCodeSearch({ regex: !cs.regex })}
          >
            <Regex size={14} />
          </button>
        </div>

        {showFilters && (
          <div className="csr-filters">
            <select
              value={cs.scope === 'one' ? `one:${cs.owner}` : cs.scope}
              onChange={(e) => {
                const v = e.target.value;
                if (v.startsWith('one:')) setCodeSearch({ scope: 'one', owner: v.slice(4) });
                else setCodeSearch({ scope: v, owner: '' });
              }}
              title="Dove cercare"
            >
              <option value="current">
                Schema di lavoro{active?.currentSchema ? ` (${active.currentSchema})` : ''}
              </option>
              <option value="user">Tutti gli schemi applicativi</option>
              <option value="all">Tutti, compresi quelli di Oracle</option>
              {!!schemas?.length && (
                <optgroup label="Un solo schema">
                  {schemas.map((s) => (
                    <option key={s} value={`one:${s}`}>
                      {s}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <div className="csr-types">
              {SEARCH_TYPES.map(([type, label]) => (
                <button
                  key={type}
                  type="button"
                  className={`csr-chip ${cs.types.includes(type) ? 'on' : ''}`}
                  onClick={() => toggleType(type)}
                  title={type}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="csr-actions">
          <button
            className="btn primary"
            onClick={runCodeSearch}
            disabled={!cs.query || !connected || cs.running}
          >
            {cs.running ? <Loader2 size={13} className="spin" /> : <Search size={13} />}
            {cs.running ? 'Ricerca…' : 'Cerca'}
          </button>
          {!connected && connId && (
            <button className="mini-btn" onClick={() => useStore.getState().connect(connId)}>
              <Plug size={12} /> Connetti
            </button>
          )}
          {result && !stale && (
            <span className="csr-summary">
              {result.total === 0
                ? 'Nessun risultato'
                : `${result.total} righe in ${result.objectCount} oggetti`}
              {result.truncated ? ' (limite raggiunto)' : ''}
              {result.elapsedMs != null ? ` · ${(result.elapsedMs / 1000).toFixed(1)} s` : ''}
            </span>
          )}
        </div>

        {cs.error && <div className="csr-error">{cs.error}</div>}
      </div>

      <div className="csr-results">
        {!connected && !cs.error && (
          <div className="view-empty">
            {connId ? 'Connessione non attiva.' : 'Nessuna connessione selezionata.'}
          </div>
        )}
        {connected && !result && !cs.error && (
          <div className="view-empty">
            Cerca dentro il sorgente PL/SQL del database: procedure, funzioni, trigger e package
            body. Il clic su un risultato apre l'oggetto alla riga trovata.
          </div>
        )}
        {result && !stale && result.truncated && (
          <div className="csr-note">
            Fermata a {result.total} righe: restringi la ricerca per vederle tutte.
          </div>
        )}
        {result &&
          !stale &&
          result.objects.map((o) => {
            const k = keyOf(o);
            return (
              <ObjectResult
                key={k}
                connId={result.connId}
                obj={o}
                collapsed={!!collapsed[k]}
                onToggle={() => setCollapsed((c) => ({ ...c, [k]: !c[k] }))}
              />
            );
          })}
      </div>
    </>
  );
}
