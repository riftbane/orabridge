import fs from 'fs';
import path from 'path';

// Lettura di tnsnames.ora. Serve a due cose: proporre gli alias nella finestra
// di connessione (scriverli a memoria è la fonte di metà degli errori di
// connessione) e sapere quale cartella passare al driver come `configDir` —
// in modalità thin node-oracledb non legge da solo la variabile TNS_ADMIN.

const TNS_FILE = 'tnsnames.ora';

// TNS_ADMIN vince su tutto, come per sqlplus; se non c'è si guarda la cartella
// di rete dell'ORACLE_HOME. Si restituisce solo una cartella che esiste
// davvero: passare al driver un percorso inventato produce un errore oscuro
// molto più tardi, al primo tentativo di connessione.
export function findTnsAdmin() {
  const candidates = [];
  if (process.env.TNS_ADMIN) candidates.push(process.env.TNS_ADMIN);
  if (process.env.ORACLE_HOME) {
    candidates.push(path.join(process.env.ORACLE_HOME, 'network', 'admin'));
  }
  for (const dir of candidates) {
    try {
      if (fs.statSync(dir).isDirectory()) return dir;
    } catch {
      /* cartella inesistente o non leggibile: si prova la prossima */
    }
  }
  return '';
}

// `#` apre un commento fino a fine riga. Si toglie prima di ogni altra cosa,
// così una parentesi commentata non sbilancia il conteggio.
function stripComments(text) {
  return text.replace(/#[^\n]*/g, '');
}

// Indice della parentesi che chiude quella aperta in `start`, oppure -1 se il
// file finisce prima: i tnsnames.ora scritti a mano sono spesso troncati.
function closingParen(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return i;
  }
  return -1;
}

// Caratteri ammessi in un alias (il punto serve per il dominio: ORCL.WORLD).
// La virgola è un token a sé perché separa gli alias di una stessa voce.
const NAME_TOKEN = /[A-Za-z0-9_.$-]+|,/g;

// Dall'intestazione che precede il descrittore («… ALIAS1, ALIAS2 =») si
// prendono i nomi partendo dal fondo, fermandosi al primo token che non fa
// parte della sequenza `NOME (, NOME)*`. Quello che viene prima appartiene a
// un'altra direttiva — tipicamente un `IFILE=/percorso/altro.ora` o un
// `NAMES.DEFAULT_DOMAIN = world` — e non va confuso con l'alias.
function headerNames(header) {
  const eq = header.lastIndexOf('=');
  if (eq === -1) return [];
  const tokens = header.slice(0, eq).match(NAME_TOKEN) || [];
  const names = [];
  let wantName = true;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = tokens[i];
    if (wantName === (token === ',')) break;
    if (wantName) names.unshift(token);
    wantName = !wantName;
  }
  return names;
}

// Il descrittore torna su una riga sola: gli a capo e i rientri di
// tnsnames.ora sono impaginazione, e così ci sta nella riga di anteprima sotto
// l'elenco degli alias.
function normalizeDescriptor(text) {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s*([()=])\s*/g, '$1')
    .trim();
}

// Analizza il contenuto di un tnsnames.ora e restituisce [{ name, descriptor }].
// Non lancia mai: un file malformato produce al più un elenco più corto.
export function parseTnsNames(text) {
  const src = stripComments(String(text ?? ''));
  const aliases = [];
  const seen = new Set();
  let header = '';
  let pos = 0;
  while (pos < src.length) {
    const open = src.indexOf('(', pos);
    if (open === -1) break;
    header += src.slice(pos, open);
    const close = closingParen(src, open);
    const descriptor = normalizeDescriptor(src.slice(open, close === -1 ? src.length : close + 1));
    for (const name of headerNames(header)) {
      // Oracle risolve gli alias senza distinguere maiuscole e minuscole e
      // tiene la prima definizione: qui si fa lo stesso, così un file con
      // doppioni non riempie l'elenco di voci apparentemente identiche.
      const key = name.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      aliases.push({ name: key, descriptor });
    }
    header = '';
    if (close === -1) break;
    pos = close + 1;
  }
  return aliases;
}

// Legge tnsnames.ora dalla cartella indicata. L'errore è un campo della
// risposta, non un'eccezione: la finestra di connessione lo mostra sotto
// l'elenco vuoto e l'utente corregge la cartella senza che la richiesta fallisca.
export function readTnsAliases(dir) {
  const folder = String(dir || '').trim();
  const fail = (error) => ({ dir: folder, file: '', aliases: [], error });
  if (!folder) {
    return fail(
      'Nessuna cartella TNS_ADMIN trovata: indica qui la cartella che contiene tnsnames.ora.'
    );
  }
  let entries;
  try {
    entries = fs.readdirSync(folder);
  } catch {
    return fail(`Cartella non trovata o non leggibile: ${folder}`);
  }
  // Su Linux il file può chiamarsi TNSNAMES.ORA: si cerca senza distinguere
  // maiuscole e minuscole, altrimenti un file valido risulterebbe assente.
  const found = entries.find((f) => f.toLowerCase() === TNS_FILE);
  if (!found) return fail(`Nessun tnsnames.ora in ${folder}`);
  const file = path.join(folder, found);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    return { dir: folder, file, aliases: [], error: `Impossibile leggere ${file}: ${err.message}` };
  }
  const aliases = parseTnsNames(text).sort((a, b) => a.name.localeCompare(b.name));
  const result = { dir: folder, file, aliases };
  if (!aliases.length) result.error = `Nessun alias riconosciuto in ${file}`;
  return result;
}
