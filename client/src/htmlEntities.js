// Decodifica delle entità HTML nei valori mostrati nella griglia.
//
// Alcuni applicativi legacy salvano il testo già codificato in entità
// (`Attivit&agrave; in corso`), a volte senza il punto e virgola finale come
// facevano i vecchi encoder (`Attivit&agrave in corso`). Il dato nel database
// resta quello: questa decodifica è opt-in e vale solo per la
// visualizzazione, mai per editing, export CSV o filtri.

// Chiavi minuscole: le varianti maiuscole (&Agrave;, &ETH;) sono ricavate dal
// primo carattere del riferimento, vedi sotto.
const NAMED = {
  // XML/HTML di base
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  // Latin-1: segni
  nbsp: '\u00a0', // spazio unificatore
  iexcl: '¡',
  cent: '¢',
  pound: '£',
  curren: '¤',
  yen: '¥',
  brvbar: '¦',
  sect: '§',
  uml: '¨',
  copy: '©',
  ordf: 'ª',
  laquo: '«',
  not: '¬',
  shy: '\u00ad', // trattino morbido (invisibile)
  reg: '®',
  macr: '¯',
  deg: '°',
  plusmn: '±',
  sup2: '²',
  sup3: '³',
  acute: '´',
  micro: 'µ',
  para: '¶',
  middot: '·',
  cedil: '¸',
  sup1: '¹',
  ordm: 'º',
  raquo: '»',
  frac14: '¼',
  frac12: '½',
  frac34: '¾',
  iquest: '¿',
  times: '×',
  divide: '÷',
  // Latin-1: lettere accentate
  agrave: 'à',
  aacute: 'á',
  acirc: 'â',
  atilde: 'ã',
  auml: 'ä',
  aring: 'å',
  aelig: 'æ',
  ccedil: 'ç',
  egrave: 'è',
  eacute: 'é',
  ecirc: 'ê',
  euml: 'ë',
  igrave: 'ì',
  iacute: 'í',
  icirc: 'î',
  iuml: 'ï',
  eth: 'ð',
  ntilde: 'ñ',
  ograve: 'ò',
  oacute: 'ó',
  ocirc: 'ô',
  otilde: 'õ',
  ouml: 'ö',
  oslash: 'ø',
  ugrave: 'ù',
  uacute: 'ú',
  ucirc: 'û',
  uuml: 'ü',
  yacute: 'ý',
  thorn: 'þ',
  yuml: 'ÿ',
  szlig: 'ß',
  // punteggiatura tipografica che ricorre nei testi importati dal web
  euro: '€',
  hellip: '…',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  sbquo: '‚',
  bdquo: '„',
  bull: '•',
  dagger: '†',
  permil: '‰',
  lsaquo: '‹',
  rsaquo: '›',
  trade: '™',
  minus: '−',
  larr: '←',
  uarr: '↑',
  rarr: '→',
  darr: '↓',
};

// Entità in cui la variante maiuscola non è la maiuscola della minuscola.
const EXACT = { Dagger: '‡', OElig: 'Œ', oelig: 'œ', Scaron: 'Š', scaron: 'š', Yuml: 'Ÿ' };

// Il `;` è facoltativo: i valori che arrivano dai vecchi encoder spesso non ce
// l'hanno. Il nome deve però combaciare esattamente con una voce della tabella,
// così `R&D` o `&notizie` restano intatti.
const RE = /&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,7});?/g;

function fromCodePoint(cp) {
  if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff) return null;
  if (cp >= 0xd800 && cp <= 0xdfff) return null; // surrogati: non rappresentabili
  return String.fromCodePoint(cp);
}

export function decodeEntities(text) {
  if (typeof text !== 'string' || !text.includes('&')) return text;
  return text.replace(RE, (match, ref) => {
    if (ref[0] === '#') {
      const hex = ref[1] === 'x' || ref[1] === 'X';
      const cp = parseInt(hex ? ref.slice(2) : ref.slice(1), hex ? 16 : 10);
      return fromCodePoint(cp) ?? match;
    }
    if (EXACT[ref]) return EXACT[ref];
    const ch = NAMED[ref.toLowerCase()];
    if (!ch) return match;
    // `&Agrave;` → À, `&agrave;` → à. `&szlig;` maiuscolo darebbe "SS" (due
    // caratteri): in quel caso si resta sulla minuscola.
    if (ref[0] === ref[0].toUpperCase() && ref[0] !== ref[0].toLowerCase()) {
      const up = ch.toUpperCase();
      if (up.length === 1) return up;
    }
    return ch;
  });
}
