import React, { useEffect, useRef } from 'react';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, rectangularSelection, highlightSpecialChars } from '@codemirror/view';
import { EditorState, Compartment, Prec } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { autocompletion, acceptCompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { bracketMatching, indentOnInput, syntaxHighlighting, HighlightStyle, LanguageSupport } from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { PLSQL } from '@codemirror/lang-sql';
import { tags as t } from '@lezer/highlight';
import { sqlCompletionSource } from '../completion.js';

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
  cbRef.current = { onChange, onRun, onRunScript };

  const schemaComp = useRef(new Compartment());

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

    const state = EditorState.create({
      doc: initialDoc,
      extensions: [
        ...runKeys,
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
        highlightSelectionMatches(),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
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

  return <div className="editor-host" ref={containerRef} />;
}
