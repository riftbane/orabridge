// Ricerca/sostituzione in stile VS Code per gli editor CodeMirror.
//
// Lo stato della ricerca (testo, opzioni, area limitata) vive in un campo di
// stato dell'editor: da lì derivano sia le evidenziazioni sia il conteggio
// "N di M" mostrato dal widget React (FindWidget.jsx).
import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';

// Oltre questa soglia smettiamo di contare: il widget mostra "10000+".
export const MAX_MATCHES = 10000;

export const emptySearchSpec = {
  query: '',
  replace: '',
  caseSensitive: false,
  wholeWord: false,
  regexp: false,
};

export const setSearchSpec = StateEffect.define();
export const setSearchScope = StateEffect.define();
export const setCurrentMatch = StateEffect.define();

const WORD = /\w/;

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// `false` = espressione regolare non valida (il widget lo segnala in rosso).
function buildRegExp(spec) {
  if (!spec.query) return null;
  const source = spec.regexp ? spec.query : escapeRe(spec.query);
  try {
    return new RegExp(source, spec.caseSensitive ? 'gm' : 'gim');
  } catch {
    return false;
  }
}

function isWholeWord(doc, from, to) {
  const before = from > 0 ? doc.sliceString(from - 1, from) : '';
  const after = to < doc.length ? doc.sliceString(to, to + 1) : '';
  return !WORD.test(before) && !WORD.test(after);
}

function computeMatches(state, spec, scope) {
  const re = buildRegExp(spec);
  if (!re) return { matches: [], invalid: re === false, capped: false };
  const from = scope ? Math.min(scope.from, state.doc.length) : 0;
  const to = scope ? Math.min(scope.to, state.doc.length) : state.doc.length;
  if (to <= from) return { matches: [], invalid: false, capped: false };
  const text = state.doc.sliceString(from, to);
  const matches = [];
  let capped = false;
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(text))) {
    // Un match vuoto (es. `a*`) non avanza: lo saltiamo a mano.
    if (m[0].length === 0) {
      re.lastIndex += 1;
      if (re.lastIndex > text.length) break;
      continue;
    }
    const start = from + m.index;
    const end = start + m[0].length;
    if (!spec.wholeWord || isWholeWord(state.doc, start, end)) {
      matches.push({ from: start, to: end, groups: m.slice(), named: m.groups });
    }
    if (matches.length >= MAX_MATCHES) {
      capped = true;
      break;
    }
  }
  return { matches, invalid: false, capped };
}

// Il match "corrente" è quello selezionato, altrimenti il primo dal cursore
// in avanti (con giro alla fine): stessa logica di VS Code quando si digita.
function currentFor(state, matches) {
  if (!matches.length) return -1;
  const sel = state.selection.main;
  const exact = matches.findIndex((m) => m.from === sel.from && m.to === sel.to);
  if (exact >= 0) return exact;
  const after = matches.findIndex((m) => m.from >= sel.from);
  return after >= 0 ? after : 0;
}

const initialState = {
  spec: emptySearchSpec,
  scope: null,
  matches: [],
  current: -1,
  invalid: false,
  capped: false,
};

export const searchState = StateField.define({
  create: () => initialState,
  update(value, tr) {
    let { spec, scope, current } = value;
    let dirty = tr.docChanged;
    let explicitCurrent = null;
    for (const e of tr.effects) {
      if (e.is(setSearchSpec)) {
        spec = { ...spec, ...e.value };
        dirty = true;
      } else if (e.is(setSearchScope)) {
        scope = e.value;
        dirty = true;
      } else if (e.is(setCurrentMatch)) {
        explicitCurrent = e.value;
      }
    }
    if (tr.docChanged && scope) {
      scope = { from: tr.changes.mapPos(scope.from, 1), to: tr.changes.mapPos(scope.to, -1) };
      if (scope.to <= scope.from) scope = null;
    }
    if (!dirty) {
      if (explicitCurrent == null || explicitCurrent === current) return value;
      return { ...value, current: explicitCurrent };
    }
    const { matches, invalid, capped } = computeMatches(tr.state, spec, scope);
    current = explicitCurrent != null ? explicitCurrent : currentFor(tr.state, matches);
    if (current >= matches.length) current = matches.length ? 0 : -1;
    return { spec, scope, matches, current, invalid, capped };
  },
});

export function getSearchState(state) {
  return state.field(searchState, false) || initialState;
}

// ---- evidenziazioni ----

const matchMark = Decoration.mark({ class: 'cm-obMatch' });
const currentMark = Decoration.mark({ class: 'cm-obMatch cm-obMatch-current' });
const scopeLine = Decoration.line({ class: 'cm-obScopeLine' });

function buildDecorations(state) {
  const { matches, current, scope } = getSearchState(state);
  const ranges = [];
  if (scope) {
    const first = state.doc.lineAt(Math.min(scope.from, state.doc.length));
    const last = state.doc.lineAt(Math.min(scope.to, state.doc.length));
    for (let n = first.number; n <= last.number; n++) {
      ranges.push(scopeLine.range(state.doc.line(n).from));
    }
  }
  matches.forEach((m, i) => {
    ranges.push((i === current ? currentMark : matchMark).range(m.from, m.to));
  });
  return Decoration.set(ranges, true);
}

const searchHighlighter = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildDecorations(view.state);
    }
    update(u) {
      if (u.docChanged || u.state.field(searchState) !== u.startState.field(searchState)) {
        this.decorations = buildDecorations(u.state);
      }
    }
  },
  { decorations: (v) => v.decorations }
);

export const searchExtension = [searchState, searchHighlighter];

// ---- comandi ----

function selectMatch(view, index) {
  const { matches } = getSearchState(view.state);
  const m = matches[index];
  if (!m) return false;
  view.dispatch({
    selection: { anchor: m.from, head: m.to },
    effects: [setCurrentMatch.of(index), EditorView.scrollIntoView(m.from, { y: 'center' })],
  });
  return true;
}

// Porta la selezione sul match corrente mentre si digita nella barra (come
// VS Code): così Invio passa già al successivo.
export function revealCurrent(view) {
  const { matches, current } = getSearchState(view.state);
  const m = matches[current];
  if (!m) return false;
  const sel = view.state.selection.main;
  if (sel.from === m.from && sel.to === m.to) return true;
  view.dispatch({
    selection: { anchor: m.from, head: m.to },
    effects: EditorView.scrollIntoView(m.from, { y: 'center' }),
  });
  return true;
}

export function findNext(view) {
  const { matches } = getSearchState(view.state);
  if (!matches.length) return false;
  const pos = view.state.selection.main.from;
  let idx = matches.findIndex((m) => m.from > pos);
  if (idx < 0) idx = 0;
  return selectMatch(view, idx);
}

export function findPrevious(view) {
  const { matches } = getSearchState(view.state);
  if (!matches.length) return false;
  const pos = view.state.selection.main.from;
  let idx = -1;
  for (let i = matches.length - 1; i >= 0; i--) {
    if (matches[i].from < pos) {
      idx = i;
      break;
    }
  }
  if (idx < 0) idx = matches.length - 1;
  return selectMatch(view, idx);
}

// $& / $1…$9 / $<nome> come in VS Code; le sequenze \n \t \\ solo in regex.
function expandReplacement(spec, match) {
  if (!spec.regexp) return spec.replace;
  return spec.replace
    .replace(/\\([nrt\\])/g, (_, c) => (c === 'n' ? '\n' : c === 'r' ? '\r' : c === 't' ? '\t' : '\\'))
    .replace(/\$(\$|&|\d{1,2}|<[^>]+>)/g, (whole, ref) => {
      if (ref === '$') return '$';
      if (ref === '&') return match.groups[0];
      if (ref.startsWith('<')) return match.named?.[ref.slice(1, -1)] ?? '';
      const n = Number(ref);
      return match.groups[n] ?? whole;
    });
}

export function replaceCurrent(view) {
  if (view.state.readOnly) return false;
  const { matches, spec } = getSearchState(view.state);
  if (!matches.length) return false;
  const sel = view.state.selection.main;
  const idx = matches.findIndex((m) => m.from === sel.from && m.to === sel.to);
  // Il primo invio porta sul match, il secondo lo sostituisce.
  if (idx < 0) return findNext(view);
  const m = matches[idx];
  const text = expandReplacement(spec, m);
  view.dispatch({
    changes: { from: m.from, to: m.to, insert: text },
    selection: { anchor: m.from + text.length },
    userEvent: 'input.replace',
  });
  findNext(view);
  return true;
}

export function replaceAll(view) {
  if (view.state.readOnly) return 0;
  const { matches, spec } = getSearchState(view.state);
  if (!matches.length) return 0;
  view.dispatch({
    changes: matches.map((m) => ({ from: m.from, to: m.to, insert: expandReplacement(spec, m) })),
    userEvent: 'input.replace.all',
  });
  return matches.length;
}

// L'area si estende sempre a righe intere: così `^`/`$` e l'evidenziazione
// dell'area si comportano come ci si aspetta.
export function scopeFromSelection(state) {
  const sel = state.selection.main;
  if (sel.empty) return null;
  return { from: state.doc.lineAt(sel.from).from, to: state.doc.lineAt(sel.to).to };
}

export function applyScope(view, scope) {
  view.dispatch({ effects: setSearchScope.of(scope) });
}

export function updateSpec(view, patch) {
  view.dispatch({ effects: setSearchSpec.of(patch) });
}
