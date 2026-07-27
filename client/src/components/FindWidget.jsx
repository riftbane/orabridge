import React, { useEffect, useRef } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CaseSensitive,
  ChevronRight,
  Regex,
  Replace,
  ReplaceAll,
  TextSelect,
  WholeWord,
  X,
} from 'lucide-react';
import { MAX_MATCHES } from '../editorSearch.js';

function Toggle({ on, title, onClick, children }) {
  return (
    <button type="button" className={`find-toggle ${on ? 'on' : ''}`} title={title} onClick={onClick}>
      {children}
    </button>
  );
}

// Barra di ricerca/sostituzione in stile VS Code: sta sopra l'editor in alto a
// destra e pilota il campo di stato definito in editorSearch.js.
export default function FindWidget({
  spec,
  onSpec,
  info,
  showReplace,
  onToggleReplace,
  readOnly,
  scoped,
  canScope,
  onToggleScope,
  onFindNext,
  onFindPrev,
  onReplace,
  onReplaceAll,
  onClose,
  focusToken,
}) {
  const findRef = useRef(null);
  const replaceRef = useRef(null);

  // Ogni Ctrl+F/Ctrl+H rimette il fuoco nel campo giusto e seleziona il testo.
  useEffect(() => {
    const el = focusToken?.field === 'replace' ? replaceRef.current : findRef.current;
    el?.focus();
    el?.select();
  }, [focusToken]);

  const count = info.invalid
    ? 'Espressione non valida'
    : !spec.query
      ? 'Nessun risultato'
      : info.total === 0
        ? 'Nessun risultato'
        : `${info.current + 1} di ${info.total}${info.capped ? '+' : ''}`;

  const keys = (e) => {
    // Ctrl+F / Ctrl+H funzionano anche con il fuoco dentro la barra.
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'f') {
        e.preventDefault();
        findRef.current?.focus();
        findRef.current?.select();
        return;
      }
      if (k === 'h' && !readOnly) {
        e.preventDefault();
        if (!showReplace) onToggleReplace();
        requestAnimationFrame(() => {
          const el = spec.query ? replaceRef.current : findRef.current;
          el?.focus();
          el?.select();
        });
        return;
      }
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      const k = e.key.toLowerCase();
      const toggles = { c: 'caseSensitive', w: 'wholeWord', r: 'regexp' };
      if (toggles[k]) {
        e.preventDefault();
        onSpec({ [toggles[k]]: !spec[toggles[k]] });
        return;
      }
      if (k === 'l') {
        e.preventDefault();
        onToggleScope();
        return;
      }
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.target === replaceRef.current) {
        if (e.ctrlKey || e.altKey) onReplaceAll();
        else onReplace();
      } else if (e.shiftKey) onFindPrev();
      else onFindNext();
    } else if (e.key === 'F3') {
      e.preventDefault();
      if (e.shiftKey) onFindPrev();
      else onFindNext();
    }
  };

  return (
    <div className={`find-widget ${showReplace ? 'with-replace' : ''}`} onKeyDown={keys}>
      <button
        type="button"
        className={`find-expand ${showReplace ? 'open' : ''}`}
        title={showReplace ? 'Nascondi sostituzione' : 'Mostra sostituzione (Ctrl+H)'}
        onClick={onToggleReplace}
        disabled={readOnly}
      >
        <ChevronRight size={14} />
      </button>
      <div className="find-rows">
        <div className="find-row">
          <div className={`find-input ${info.invalid ? 'invalid' : ''}`}>
            <input
              ref={findRef}
              value={spec.query}
              placeholder="Cerca"
              spellCheck={false}
              onChange={(e) => onSpec({ query: e.target.value })}
            />
            <Toggle
              on={spec.caseSensitive}
              title="Maiuscole/minuscole (Alt+C)"
              onClick={() => onSpec({ caseSensitive: !spec.caseSensitive })}
            >
              <CaseSensitive size={14} />
            </Toggle>
            <Toggle
              on={spec.wholeWord}
              title="Parola intera (Alt+W)"
              onClick={() => onSpec({ wholeWord: !spec.wholeWord })}
            >
              <WholeWord size={14} />
            </Toggle>
            <Toggle
              on={spec.regexp}
              title="Espressione regolare (Alt+R)"
              onClick={() => onSpec({ regexp: !spec.regexp })}
            >
              <Regex size={14} />
            </Toggle>
          </div>
          <span className={`find-count ${info.invalid ? 'invalid' : ''}`}>{count}</span>
          <button type="button" className="find-btn" title="Precedente (Maiusc+Invio)" onClick={onFindPrev} disabled={!info.total}>
            <ArrowUp size={14} />
          </button>
          <button type="button" className="find-btn" title="Successivo (Invio)" onClick={onFindNext} disabled={!info.total}>
            <ArrowDown size={14} />
          </button>
          <Toggle
            on={scoped}
            title={
              scoped
                ? 'Cerca in tutto il documento (Alt+L)'
                : canScope
                  ? 'Cerca solo nelle righe selezionate (Alt+L)'
                  : 'Seleziona delle righe per limitare la ricerca (Alt+L)'
            }
            onClick={onToggleScope}
          >
            <TextSelect size={14} />
          </Toggle>
          <button type="button" className="find-btn" title="Chiudi (Esc)" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        {showReplace && (
          <div className="find-row">
            <div className="find-input">
              <input
                ref={replaceRef}
                value={spec.replace}
                placeholder="Sostituisci"
                spellCheck={false}
                onChange={(e) => onSpec({ replace: e.target.value })}
              />
            </div>
            <button
              type="button"
              className="find-btn"
              title="Sostituisci (Invio)"
              onClick={onReplace}
              disabled={readOnly || !info.total}
            >
              <Replace size={14} />
            </button>
            <button
              type="button"
              className="find-btn"
              title="Sostituisci tutto (Ctrl+Invio)"
              onClick={onReplaceAll}
              disabled={readOnly || !info.total}
            >
              <ReplaceAll size={14} />
            </button>
            {info.capped && <span className="find-count">oltre {MAX_MATCHES} risultati</span>}
          </div>
        )}
      </div>
    </div>
  );
}
