// Colorazione dei blocchi di codice mostrati in chat.
//
// Non è un vero parser: divide il testo in token abbastanza buoni da leggere
// (commenti, stringhe, numeri, parole chiave) come fa l'anteprima di VS Code.
// L'SQL riusa l'elenco di parole chiave del formattatore, così i due restano
// allineati.

import { KEYWORDS as SQL_KEYWORDS } from './sqlFormat.js';

const SQL_LANGS = /^(sql|plsql|pl\/sql|oracle|oraclesql|plsqldev|psql)$/i;

// Parole chiave dei linguaggi che capitano nelle risposte (script di supporto,
// snippet di configurazione): un elenco solo, condiviso.
const CODE_KEYWORDS = new Set(
  `abstract and as async await break case catch class const continue def default delete do elif
   else elseif except export extends finally for from function global if import in instanceof
   interface is lambda let new not or pass print private public raise return self static super
   switch this throw try type typeof var void while with yield true false null undefined none
   True False None echo fi then esac done local export unset`.split(/\s+/)
);

const SQL_RE =
  /(--[^\n]*|\/\*[\s\S]*?\*\/)|(q'\[[\s\S]*?\]'|q'\{[\s\S]*?\}'|'(?:[^']|'')*'|"[^"\n]*")|(:\w+)|(\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|([A-Za-z_][\w$#]*)/g;

const CODE_RE =
  /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|([A-Za-z_$][\w$]*)/g;

// Restituisce [{ text, kind }] con kind fra:
// 'plain' | 'comment' | 'string' | 'number' | 'keyword' | 'bind' | 'fn'
export function tokenizeCode(code, lang) {
  const src = String(code ?? '');
  if (!src) return [];
  const sql = SQL_LANGS.test(lang || '');
  const re = sql ? SQL_RE : CODE_RE;
  const out = [];
  let last = 0;
  let m;
  re.lastIndex = 0;
  const push = (text, kind) => {
    if (!text) return;
    const prev = out[out.length - 1];
    if (prev && prev.kind === kind) prev.text += text;
    else out.push({ text, kind });
  };
  while ((m = re.exec(src))) {
    if (m.index > last) push(src.slice(last, m.index), 'plain');
    last = m.index + m[0].length;
    if (m[1]) push(m[1], 'comment');
    else if (m[2]) push(m[2], 'string');
    else if (sql && m[3]) push(m[3], 'bind');
    else if (sql ? m[4] : m[3]) push(m[0], 'number');
    else {
      const word = m[0];
      if (sql) {
        if (SQL_KEYWORDS.has(word.toUpperCase())) push(word, 'keyword');
        else if (src[last] === '(') push(word, 'fn');
        else push(word, 'plain');
      } else if (CODE_KEYWORDS.has(word)) {
        push(word, 'keyword');
      } else if (src[last] === '(') {
        push(word, 'fn');
      } else {
        push(word, 'plain');
      }
    }
  }
  if (last < src.length) push(src.slice(last), 'plain');
  return out;
}
