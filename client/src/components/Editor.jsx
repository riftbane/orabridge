import React, { useCallback, useEffect, useRef, useState } from 'react';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, rectangularSelection, highlightSpecialChars } from '@codemirror/view';
import { EditorState, Compartment, Prec } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab, toggleBlockComment, toggleComment } from '@codemirror/commands';
import {
  autocompletion,
  acceptCompletion,
  clearSnippet,
  completionKeymap,
  closeBrackets,
  closeBracketsKeymap,
  nextSnippetField,
  prevSnippetField,
  snippetKeymap,
} from '@codemirror/autocomplete';
import {
  bracketMatching,
  codeFolding,
  foldGutter,
  foldKeymap,
  foldService,
  indentOnInput,
  syntaxHighlighting,
  HighlightStyle,
  LanguageSupport,
} from '@codemirror/language';
import { highlightSelectionMatches } from '@codemirror/search';
import { PLSQL } from '@codemirror/lang-sql';
import { tags as t } from '@lezer/highlight';
import { X } from 'lucide-react';
import { sqlCompletionSource } from '../completion.js';
import { api } from '../api.js';
import { useStore } from '../store.js';
import { safeFormatSql } from '../sqlFormat.js';
import {
  DESCRIBABLE,
  capitalizeSelection,
  lowerCaseSelection,
  resolveObject,
  sqlFoldService,
  upperCaseSelection,
  wordAt,
} from '../editorActions.js';
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
    // Ripiegatura: le frecce restano smorzate finché non ci si passa sopra,
    // altrimenti competono con i numeri di riga.
    '.cm-foldGutter': { minWidth: '14px' },
    '.cm-foldGutter .cm-gutterElement': {
      color: 'var(--fg-dim)',
      cursor: 'pointer',
      padding: '0 2px',
      opacity: 0.55,
    },
    '.cm-foldGutter .cm-gutterElement:hover': { color: 'var(--accent)', opacity: 1 },
    '.cm-foldPlaceholder': {
      backgroundColor: 'var(--bg-hover)',
      border: '1px solid var(--border)',
      borderRadius: '3px',
      color: 'var(--fg-dim)',
      margin: '0 2px',
      padding: '0 4px',
    },
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
// I `commentTokens` non servono: PLSQL è definito con SQLDialect.define, che
// dichiara già `-- ` e `/* */` fra i dati del linguaggio (verificato in
// @codemirror/lang-sql), quindi Ctrl+/ trova da solo come commentare.
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

const TYPE_LABEL = {
  TABLE: 'tabella',
  VIEW: 'vista',
  'MATERIALIZED VIEW': 'vista materializzata',
  PROCEDURE: 'procedura',
  FUNCTION: 'funzione',
  PACKAGE: 'package',
  SEQUENCE: 'sequenza',
  SYNONYM: 'sinonimo',
};

// L'identificatore non attraversa mai un a capo: guardare solo la riga evita
// di convertire in stringa tutto il documento a ogni movimento del mouse.
function wordAtPos(state, pos) {
  const line = state.doc.lineAt(pos);
  return wordAt(line.text, pos - line.from);
}

// Dai metadati già in memoria all'oggetto, senza aspettare niente: serve al
// puntatore «mano», che deve rispondere subito. Uno schema non ancora
// caricato conta come risolvibile — sarà il clic a scaricarlo.
function resolveSync(connId, word) {
  if (!word) return null;
  const meta = useStore.getState().sqlMeta[connId];
  const hit = resolveObject(meta, word.qualified || { owner: null, name: word.name });
  if (hit) return hit;
  if (!word.qualified) return null;
  // `alias.colonna`: il qualificatore non è uno schema, si prova con i due
  // pezzi presi da soli. Se invece il qualificatore *è* uno schema noto, il
  // ripiego va evitato: `ALTRO.CLIENTI` che lì non esiste aprirebbe la
  // `CLIENTI` dello schema di lavoro, cioè un'altra tabella con lo stesso
  // nome — l'errore peggiore che possa fare un «vai alla definizione».
  const owner = word.qualified.owner;
  const knownSchema =
    owner === meta?.owner || (meta?.schemas || []).includes(owner) || !!meta?.byOwner?.[owner];
  if (knownSchema) return null;
  return (
    resolveObject(meta, { owner: null, name: word.qualified.name }) ||
    resolveObject(meta, { owner: null, name: owner })
  );
}

// Come sopra, ma può caricare i metadati dello schema citato prima di
// arrendersi (`{ pending }` arriva da resolveObject).
async function resolveObjectAt(connId, word) {
  if (!word) return null;
  let hit = resolveSync(connId, word);
  if (hit?.pending) {
    await useStore.getState().loadSchemaMeta(connId, hit.pending);
    hit = resolveSync(connId, word);
  }
  return hit && !hit.pending ? hit : null;
}

// Le colonne arrivano nella forma griglia del server (intestazioni italiane):
// qui diventano le quattro che il pannello mostra davvero.
function describeColumns(grid) {
  const at = (label) => (grid.columns || []).findIndex((c) => c.name === label);
  const iName = at('Colonna');
  const iType = at('Tipo');
  const iNull = at('Null');
  const iKey = at('Chiave');
  return (grid.rows || []).map((r) => ({
    name: iName < 0 ? '' : r[iName],
    type: iType < 0 ? '' : r[iType],
    notNull: iNull >= 0 && r[iNull] === 'NOT NULL',
    key: iKey < 0 ? '' : r[iKey] || '',
  }));
}

// Describe rapido (Maiusc+F4). Come la barra di ricerca è un componente React
// accanto all'editor e non un tooltip di CodeMirror: deve restare dov'è
// mentre si continua a scrivere e a scorrere.
function DescribePanel({ info, onClose, onOpen }) {
  const title = info.owner ? `${info.owner}.${info.name}` : info.word || 'Describe';
  const empty = !info.loading && !info.error;
  return (
    <div
      className="describe-panel"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div className="describe-head">
        <span className="describe-title" title={title}>
          {title}
        </span>
        {info.type && <span className="describe-type">{TYPE_LABEL[info.type] || info.type}</span>}
        <button type="button" className="icon-btn" title="Chiudi (Esc)" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      <div className="describe-body">
        {info.loading && <div className="describe-note">Caricamento…</div>}
        {info.error && <div className="describe-note err">{info.error}</div>}
        {empty && !info.owner && (
          <div className="describe-note">
            {info.word
              ? `«${info.word}» non è un oggetto noto in questa connessione.`
              : 'Il cursore non è su un nome di oggetto.'}
          </div>
        )}
        {empty && info.owner && !info.cols && (
          <div className="describe-note">Questo tipo di oggetto non ha colonne da mostrare.</div>
        )}
        {empty && info.cols?.length === 0 && (
          <div className="describe-note">Nessuna colonna leggibile.</div>
        )}
        {info.cols?.length > 0 && (
          <table className="describe-cols">
            <thead>
              <tr>
                <th>Colonna</th>
                <th>Tipo</th>
                <th>Null</th>
                <th>Chiave</th>
              </tr>
            </thead>
            <tbody>
              {info.cols.map((c) => (
                <tr key={c.name}>
                  <td className="c-name">{c.name}</td>
                  <td className="c-type">{c.type}</td>
                  <td className="c-null">{c.notNull ? 'NOT NULL' : ''}</td>
                  <td className="c-key">{c.key}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {info.owner && (
        <div className="describe-foot">
          <span className="describe-hint">Ctrl+clic su un nome per aprirlo</span>
          <button type="button" className="btn" onClick={onOpen}>
            Apri scheda
          </button>
        </div>
      )}
    </div>
  );
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
  const [describe, setDescribe] = useState(null); // { word, owner, name, type, cols, loading, error }
  const findOpen = useRef(false);
  const describeOpen = useRef(false);
  const specRef = useRef(spec);
  // Ultima posizione del mouse: serve per accendere il puntatore «mano»
  // quando Ctrl viene premuto senza muovere il mouse.
  const pointer = useRef(null);
  // Numera le richieste del describe: una risposta vecchia non deve
  // sovrascrivere un pannello già riaperto su un altro oggetto.
  const describeSeq = useRef(0);
  findOpen.current = !!find;
  describeOpen.current = !!describe;
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

  const closeDescribe = useCallback(() => {
    if (!describeOpen.current) return false;
    describeOpen.current = false;
    describeSeq.current++; // le risposte ancora in volo non riaprono il pannello
    setDescribe(null);
    viewRef.current?.focus();
    return true;
  }, []);

  // Maiusc+F4: colonne dell'oggetto sotto il cursore, senza lasciare il foglio.
  const openDescribe = () => {
    const view = viewRef.current;
    // Senza connessione non c'è nessuno schema da interrogare: succede negli
    // editor di sola lettura (DDL, viste) che montano `Editor` senza `connId`.
    if (!view || !connId) return true;
    const seq = ++describeSeq.current;
    const word = wordAtPos(view.state, view.state.selection.main.head);
    const shown = (patch) => {
      if (seq === describeSeq.current) setDescribe((d) => ({ ...(d || {}), ...patch }));
    };
    describeOpen.current = true;
    setDescribe({ word: word?.word || '', loading: true });
    (async () => {
      const hit = await resolveObjectAt(connId, word);
      if (seq !== describeSeq.current) return;
      if (!hit) return shown({ loading: false });
      shown({ ...hit, loading: DESCRIBABLE.has(hit.type) });
      if (!DESCRIBABLE.has(hit.type)) return;
      try {
        const grid = await api.tableColumns(connId, hit.owner, hit.name);
        shown({ loading: false, cols: describeColumns(grid) });
      } catch (err) {
        shown({ loading: false, error: err.message });
      }
    })();
    return true;
  };

  // Ctrl+clic: apre la scheda dell'oggetto sotto il puntatore. Se il nome non
  // si risolve lo dice, invece di non fare niente e sembrare rotto.
  const goToDefinition = async (pos) => {
    const view = viewRef.current;
    if (!view || !connId) return;
    const st = useStore.getState();
    const word = wordAtPos(view.state, pos);
    if (!word) return st.toast('Il cursore non è su un nome di oggetto', 'info');
    const hit = await resolveObjectAt(connId, word);
    if (!hit) return st.toast(`«${word.word}» non è un oggetto noto in questa connessione`, 'info');
    st.openObject(connId, hit.owner, hit.name, hit.type);
  };

  cbRef.current = { connId, onChange, onRun, onRunScript, openFind, closeFind, closeDescribe, openDescribe, goToDefinition };

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
          // Commento di riga e di blocco. Su tastiera italiana "/" è Maiusc+7,
          // quindi Ctrl+Maiusc+/ non è distinguibile da Ctrl+/: resta Alt+A
          // (dal keymap predefinito) come alternativa per il blocco.
          { key: 'Mod-/', run: toggleComment, preventDefault: true },
          { key: 'Mod-Shift-/', run: toggleBlockComment, preventDefault: true },
          // Maiuscole/minuscole. Ctrl+Maiusc+F e Ctrl+F/H sono già prese;
          // su macOS Cmd+Maiusc+U sarebbe "ripeti selezione", ma qui la
          // precedenza più alta ce lo lascia.
          { key: 'Mod-Shift-u', run: upperCaseSelection, preventDefault: true },
          { key: 'Mod-Shift-l', run: lowerCaseSelection, preventDefault: true },
          { key: 'Mod-Alt-u', run: capitalizeSelection, preventDefault: true },
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
            // Il describe serve anche in sola lettura: un sorgente PL/SQL è
            // il posto in cui più spesso ci si chiede com'è fatta una tabella.
            { key: 'Shift-F4', run: () => cbRef.current.openDescribe(), preventDefault: true },
            // Esc chiude prima il pannello, poi la barra di ricerca, e solo
            // alla fine lascia lavorare i comandi predefiniti.
            { key: 'Escape', run: () => cbRef.current.closeDescribe() || cbRef.current.closeFind() },
          ])
        ),
        searchExtension,
        lineNumbers(),
        highlightActiveLineGutter(),
        // Ripiegatura: il gutter sta subito a destra dei numeri di riga.
        // Resta attiva anche in sola lettura, dove serve di più (i sorgenti
        // PL/SQL sono lunghi).
        codeFolding(),
        foldGutter(),
        foldService.of(sqlFoldService),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        rectangularSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion({ icons: true, maxRenderedOptions: 60 }),
        // Dentro un modello (SELECT … FROM …) il Tab salta di campo in campo,
        // ma se c'è un suggerimento aperto lo accetta: altrimenti scegliere la
        // tabella da completare porterebbe via al campo successivo.
        snippetKeymap.of([
          {
            key: 'Tab',
            run: (view) => acceptCompletion(view) || nextSnippetField(view),
            shift: prevSnippetField,
          },
          { key: 'Escape', run: clearSnippet },
        ]),
        highlightActiveLine(),
        selMatchComp.current.of(highlightSelectionMatches()),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...completionKeymap,
          ...foldKeymap,
          // Tab accetta il suggerimento; se il popup è chiuso indenta.
          { key: 'Tab', run: acceptCompletion },
          indentWithTab,
        ]),
        // Ctrl+clic sul nome di un oggetto ne apre la scheda; finché Ctrl è
        // premuto sopra un nome riconosciuto il puntatore diventa una mano.
        EditorView.domEventHandlers({
          mousedown(e, view) {
            if (e.button !== 0 || e.altKey || !(e.ctrlKey || e.metaKey)) return false;
            // Negli editor senza connessione (DDL, viste in sola lettura)
            // Ctrl+clic deve restare un clic normale: intercettarlo per poi
            // dire «non è un oggetto noto» sarebbe solo fastidioso.
            if (!cbRef.current.connId) return false;
            const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
            if (pos == null) return false;
            e.preventDefault();
            view.dom.classList.remove('ob-ctrl-link');
            cbRef.current.goToDefinition(pos);
            return true;
          },
          mousemove(e, view) {
            pointer.current = { x: e.clientX, y: e.clientY };
            updateLinkCursor(view, e);
            return false;
          },
          mouseleave(e, view) {
            pointer.current = null;
            view.dom.classList.remove('ob-ctrl-link');
            return false;
          },
          keydown(e, view) {
            if (e.key === 'Control' || e.key === 'Meta') updateLinkCursor(view, e);
            return false;
          },
          keyup(e, view) {
            if (!e.ctrlKey && !e.metaKey) view.dom.classList.remove('ob-ctrl-link');
            return false;
          },
        }),
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

  // La classe va sul nodo dell'editor invece che nello stato React: si
  // aggiorna a ogni movimento del mouse e un re-render per volta sarebbe
  // sprecato.
  function updateLinkCursor(view, e) {
    const at = pointer.current;
    let on = false;
    if (at && cbRef.current.connId && (e.ctrlKey || e.metaKey) && !e.altKey) {
      const pos = view.posAtCoords(at);
      if (pos != null) on = !!resolveSync(cbRef.current.connId, wordAtPos(view.state, pos));
    }
    view.dom.classList.toggle('ob-ctrl-link', on);
  }

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

  const openDescribed = () => {
    if (describe?.owner) {
      useStore.getState().openObject(connId, describe.owner, describe.name, describe.type);
    }
    closeDescribe();
  };

  return (
    <div className="editor-host">
      <div className="editor-cm" ref={containerRef} />
      {describe && <DescribePanel info={describe} onClose={closeDescribe} onOpen={openDescribed} />}
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
