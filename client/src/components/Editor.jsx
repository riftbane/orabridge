import React, { useCallback, useEffect, useRef, useState } from 'react';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, rectangularSelection, highlightSpecialChars } from '@codemirror/view';
import { EditorState, Compartment, Prec } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { autocompletion, acceptCompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { bracketMatching, indentOnInput, syntaxHighlighting, HighlightStyle, LanguageSupport } from '@codemirror/language';
import { highlightSelectionMatches } from '@codemirror/search';
import { PLSQL } from '@codemirror/lang-sql';
import { tags as t } from '@lezer/highlight';
import { sqlCompletionSource } from '../completion.js';
import { useStore } from '../store.js';
import { safeFormatSql } from '../sqlFormat.js';
import {
  applyScope,
  emptySearchSpec,
  findNext,
  findPrevious,
  getSearchState,
  replaceAll,
  replaceCurrent,
  revealCurrent,
  scopeFromSelection,
  searchExtension,
  updateSpec,
} from '../editorSearch.js';
import FindWidget from './FindWidget.jsx';

const theme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'var(--bg-editor)',
      color: 'var(--fg)',
      fontSize: '13px',
      height: '100%',
    },
    '.cm-content': { fontFamily: 'var(--mono)', caretColor: 'var(--accent)' },
    '.cm-cursor': { borderLeftColor: 'var(--accent)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
      backgroundColor: '#2d4f67 !important',
    },
    '.cm-gutters': {
      backgroundColor: 'var(--bg-editor)',
      color: '#5c6370',
      border: 'none',
      borderRight: '1px solid var(--border)',
    },
    '.cm-activeLine': { backgroundColor: '#ffffff08' },
    '.cm-activeLineGutter': { backgroundColor: '#ffffff08', color: '#9aa2b1' },
    '.cm-tooltip': {
      backgroundColor: 'var(--bg-panel)',
      border: '1px solid var(--border)',
      color: 'var(--fg)',
    },
    '.cm-tooltip-autocomplete ul li[aria-selected]': {
      backgroundColor: 'var(--accent)',
      color: '#fff',
    },
    '.cm-tooltip-autocomplete ul li[aria-selected] .cm-completionDetail': { color: '#e8ecf3' },
    '.cm-completionDetail': { color: '#8b93a1', fontStyle: 'normal', marginLeft: '1em' },
    '.cm-completionInfo': {
      backgroundColor: 'var(--bg-panel)',
      border: '1px solid var(--border)',
      color: '#c8cfdb',
      maxWidth: '32em',
    },
    // Risultati della ricerca (vedi editorSearch.js)
    '.cm-obMatch': {
      backgroundColor: '#5a4a1f',
      outline: '1px solid #6d5a26',
      borderRadius: '2px',
    },
    '.cm-obMatch-current': {
      backgroundColor: '#9e6a30',
      outline: '1px solid #e8a05a',
    },
    '.cm-obScopeLine': { backgroundColor: '#ffffff0f' },
    // Occorrenze della parola selezionata: devono restare sotto tono, così
    // durante una ricerca non si confondono con i risultati.
    '.cm-selectionMatch': { backgroundColor: '#ffffff14' },
    '.cm-tooltip-autocomplete > ul > completion-section': {
      backgroundColor: '#ffffff0d',
      color: '#8b93a1',
      fontSize: '10px',
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      padding: '2px 6px',
      borderBottom: '1px solid var(--border)',
    },
  },
  { dark: true }
);

const highlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: t.keyword, color: '#c678dd' },
    { tag: t.operator, color: '#56b6c2' },
    { tag: t.string, color: '#98c379' },
    { tag: [t.number, t.bool, t.null], color: '#d19a66' },
    { tag: t.comment, color: '#5c6370', fontStyle: 'italic' },
    { tag: t.function(t.variableName), color: '#61afef' },
    { tag: t.typeName, color: '#e5c07b' },
    { tag: t.propertyName, color: '#e06c75' },
    { tag: t.punctuation, color: '#abb2bf' },
  ])
);

// Un'unica sorgente di completamento (parole chiave incluse): così può
// ordinare fra loro colonne, tabelle e keyword in base al contesto.
function sqlExt(connId) {
  return new LanguageSupport(PLSQL.language, [
    PLSQL.language.data.of({ autocomplete: sqlCompletionSource(connId) }),
  ]);
}

// Formatta l'intervallo indicato mantenendo il rientro di base della prima
// riga: usato sia per la selezione sia per l'intero documento.
function formatRange(view, from, to, baseIndent) {
  const src = view.state.doc.sliceString(from, to);
  if (!src.trim()) return false;
  let out = safeFormatSql(src);
  if (baseIndent) out = out.split('\n').map((l, i) => (i === 0 || !l ? l : baseIndent + l)).join('\n');
  // Il formattatore taglia le righe vuote finali: se erano nella selezione
  // vanno rimesse, altrimenti formattare "mangia" una riga.
  const tail = /\n*$/.exec(src)[0];
  if (tail) out += tail;
  if (out === src) return true;
  view.dispatch({
    changes: { from, to, insert: out },
    selection: { anchor: from, head: from + out.length },
    userEvent: 'input.format',
  });
  return true;
}

// Ctrl+Maiusc+F formatta la selezione (estesa a righe intere), Ctrl+Alt+F
// tutto il foglio. Se il codice non viene riconosciuto non si tocca nulla.
function runFormat(view, selectionOnly) {
  if (view.state.readOnly) return false;
  const { toast } = useStore.getState();
  const sel = view.state.selection.main;
  try {
    if (selectionOnly && !sel.empty) {
      const line = view.state.doc.lineAt(sel.from);
      const base = /^[ \t]*/.exec(line.text)[0];
      formatRange(view, line.from + base.length, view.state.doc.lineAt(sel.to).to, base);
    } else {
      const lineNo = view.state.doc.lineAt(sel.from).number;
      if (formatRange(view, 0, view.state.doc.length, '')) {
        const doc = view.state.doc;
        const pos = doc.line(Math.min(lineNo, doc.lines)).from;
        view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
      }
    }
  } catch (err) {
    toast(err.message, 'error');
  }
  return true;
}

export default function Editor({
  initialDoc = '',
  value,
  connId,
  readOnly = false,
  onChange,
  onRun,
  onRunScript,
  onViewReady,
}) {
  const containerRef = useRef(null);
  const viewRef = useRef(null);
  const cbRef = useRef({});
  const schemaComp = useRef(new Compartment());
  const selMatchComp = useRef(new Compartment());

  const [find, setFind] = useState(null); // { replace: bool, token: {} }
  const [spec, setSpec] = useState(emptySearchSpec);
  const [info, setInfo] = useState({ total: 0, current: -1, invalid: false, capped: false, scoped: false });
  const [canScope, setCanScope] = useState(false);
  const findOpen = useRef(false);
  const specRef = useRef(spec);
  findOpen.current = !!find;
  specRef.current = spec;

  // Apre la barra: con una selezione su una riga la usa come testo da cercare,
  // se invece copre più righe limita la ricerca a quell'area (come VS Code).
  const openFind = useCallback((replace) => {
    const view = viewRef.current;
    if (view) {
      const sel = view.state.selection.main;
      const multiline = !sel.empty && view.state.doc.lineAt(sel.from).number !== view.state.doc.lineAt(sel.to).number;
      if (multiline) applyScope(view, scopeFromSelection(view.state));
      else if (!sel.empty) setSpec((s) => ({ ...s, query: view.state.doc.sliceString(sel.from, sel.to) }));
    }
    findOpen.current = true;
    const withReplace = !readOnly && (replace || false);
    // Con Ctrl+H il fuoco va su "Sostituisci" solo se c'è già cosa cercare.
    const field = withReplace && specRef.current.query ? 'replace' : 'find';
    setFind((f) => ({
      replace: withReplace || f?.replace || false,
      token: { field, n: Date.now() },
    }));
    return true;
  }, [readOnly]);

  const closeFind = useCallback(() => {
    if (!findOpen.current) return false;
    findOpen.current = false;
    setFind(null);
    const view = viewRef.current;
    if (view) {
      applyScope(view, null);
      updateSpec(view, { query: '' });
      view.focus();
    }
    return true;
  }, []);

  cbRef.current = { onChange, onRun, onRunScript, openFind, closeFind };

  useEffect(() => {
    const runKeys = readOnly
      ? []
      : [
          Prec.highest(
            keymap.of([
              { key: 'Mod-Enter', run: () => (cbRef.current.onRun?.(), true) },
              { key: 'F9', run: () => (cbRef.current.onRun?.(), true) },
              { key: 'F5', run: () => (cbRef.current.onRunScript?.(), true) },
            ])
          ),
        ];

    const editKeys = readOnly
      ? []
      : [
          { key: 'Mod-Shift-f', run: (v) => runFormat(v, true), preventDefault: true },
          { key: 'Mod-Alt-f', run: (v) => runFormat(v, false), preventDefault: true },
        ];

    const state = EditorState.create({
      doc: initialDoc,
      extensions: [
        ...runKeys,
        Prec.highest(
          keymap.of([
            ...editKeys,
            { key: 'Mod-f', run: () => (cbRef.current.openFind(false), true), preventDefault: true },
            { key: 'Mod-h', run: () => (cbRef.current.openFind(true), true), preventDefault: true },
            { key: 'F3', run: findNext, shift: findPrevious, preventDefault: true },
            { key: 'Mod-g', run: findNext, shift: findPrevious, preventDefault: true },
            // Esc chiude la barra di ricerca prima di ridurre la selezione.
            { key: 'Escape', run: () => cbRef.current.closeFind() },
          ])
        ),
        searchExtension,
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        rectangularSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion({ icons: true, maxRenderedOptions: 60 }),
        highlightActiveLine(),
        selMatchComp.current.of(highlightSelectionMatches()),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...completionKeymap,
          // Tab accetta il suggerimento; se il popup è chiuso indenta.
          { key: 'Tab', run: acceptCompletion },
          indentWithTab,
        ]),
        schemaComp.current.of(sqlExt(connId)),
        highlight,
        theme,
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) cbRef.current.onChange?.(u.state.doc.toString());
          if (u.docChanged || u.selectionSet || u.transactions.some((tr) => tr.effects.length)) {
            const st = getSearchState(u.state);
            setInfo({
              total: st.matches.length,
              current: st.current,
              invalid: st.invalid,
              capped: st.capped,
              scoped: !!st.scope,
            });
            const sel = u.state.selection.main;
            setCanScope(
              !sel.empty &&
                u.state.doc.lineAt(sel.from).number !== u.state.doc.lineAt(sel.to).number
            );
          }
        }),
      ],
    });
    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;
    onViewReady?.(view);
    return () => view.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // I metadati vengono letti dallo store a ogni completamento: qui basta
  // riconfigurare se cambia la connessione dell'editor.
  useEffect(() => {
    if (viewRef.current) {
      viewRef.current.dispatch({
        effects: schemaComp.current.reconfigure(sqlExt(connId)),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connId]);

  // controlled content (read-only viewers with async loading)
  useEffect(() => {
    const view = viewRef.current;
    if (view && value != null && value !== view.state.doc.toString()) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    }
  }, [value]);

  // La barra di ricerca è la fonte di verità: ogni modifica viene spinta nel
  // campo di stato dell'editor, che ricalcola risultati ed evidenziazioni.
  useEffect(() => {
    if (viewRef.current && find) {
      updateSpec(viewRef.current, spec);
      revealCurrent(viewRef.current);
    }
  }, [spec, find]);

  // Con la barra aperta l'evidenziazione della parola selezionata si spegne:
  // gli unici riquadri colorati devono essere i risultati della ricerca.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: selMatchComp.current.reconfigure(find ? [] : highlightSelectionMatches()),
    });
  }, [!!find]);

  const withView = (fn) => () => {
    const view = viewRef.current;
    if (view) fn(view);
  };

  const toggleScope = withView((view) => {
    const st = getSearchState(view.state);
    applyScope(view, st.scope ? null : scopeFromSelection(view.state));
  });

  const doReplaceAll = withView((view) => {
    const n = replaceAll(view);
    if (n) useStore.getState().toast(`${n} occorrenze sostituite`, 'ok');
  });

  return (
    <div className="editor-host">
      <div className="editor-cm" ref={containerRef} />
      {find && (
        <FindWidget
          spec={spec}
          onSpec={(patch) => setSpec((s) => ({ ...s, ...patch }))}
          info={info}
          showReplace={find.replace}
          onToggleReplace={() => setFind((f) => ({ ...f, replace: !f.replace }))}
          readOnly={readOnly}
          scoped={info.scoped}
          canScope={canScope}
          onToggleScope={toggleScope}
          onFindNext={withView(findNext)}
          onFindPrev={withView(findPrevious)}
          onReplace={withView(replaceCurrent)}
          onReplaceAll={doReplaceAll}
          onClose={closeFind}
          focusToken={find.token}
        />
      )}
    </div>
  );
}
