// Lettura di un CSV da caricare in tabella. Modulo puro (nessun DOM): chi
// apre il file legge il testo e passa di qui.
//
// Il parser segue la RFC 4180 — virgolette doppie, virgolette raddoppiate
// dentro il campo, campi su più righe, CRLF o LF — perché un CSV esportato da
// Excel usa esattamente quelle regole.

// Separatori riconosciuti, in ordine di preferenza: a parità di conteggio
// vince il primo, cioè la virgola.
const CANDIDATES = [',', ';', '\t', '|'];

const stripBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

// Prima riga "logica": ci si ferma al primo a capo che sta fuori dalle
// virgolette, altrimenti un campo multiriga falserebbe il conteggio.
function firstLine(text) {
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      // Le virgolette raddoppiate non aprono né chiudono nulla.
      if (inQuotes && text[i + 1] === '"') i++;
      else inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && (ch === '\n' || ch === '\r')) return text.slice(0, i);
  }
  return text;
}

export function sniffDelimiter(text) {
  const line = firstLine(stripBom(String(text ?? '')));
  let best = ',';
  let bestCount = 0;
  for (const d of CANDIDATES) {
    let n = 0;
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') i++;
        else inQuotes = !inQuotes;
        continue;
      }
      if (!inQuotes && ch === d) n++;
    }
    if (n > bestCount) {
      best = d;
      bestCount = n;
    }
  }
  return best;
}

// Nomi di colonna: vuoti e doppioni renderebbero la griglia ambigua, quindi
// diventano COL<n> e NOME_2.
function makeNames(raw, width) {
  const out = [];
  const seen = new Map();
  for (let i = 0; i < width; i++) {
    const base = String(raw?.[i] ?? '').trim() || `COL${i + 1}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    out.push(n === 1 ? base : `${base}_${n}`);
  }
  return out;
}

export function parseCsv(text, opts = {}) {
  const src = stripBom(String(text ?? ''));
  const header = opts.header !== false;
  const delimiter = opts.delimiter || sniffDelimiter(src);
  const limit = Number.isFinite(opts.limit) && opts.limit > 0 ? opts.limit : Infinity;
  // Con l'intestazione serve una riga in più prima di poter smettere.
  const wanted = limit === Infinity ? Infinity : limit + (header ? 1 : 0);

  const rows = [];
  let row = [];
  let field = '';
  let quoted = false; // il campo corrente è nato con le virgolette
  let inQuotes = false;

  // Un campo vuoto senza virgolette è una cella mancante (null); "" scritto
  // fra virgolette è una stringa vuota voluta, e la distinzione conta a chi
  // poi costruisce l'INSERT.
  const endField = () => {
    row.push(quoted ? field : field === '' ? null : field);
    field = '';
    quoted = false;
  };
  const endRow = () => {
    // Riga bianca: un solo campo mancante e nient'altro. Saltarla evita di
    // importare righe fantasma dalla fine del file o dalle spaziature.
    if (!(row.length === 1 && row[0] === null)) rows.push(row);
    row = [];
  };

  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
        continue;
      }
      if (ch === '\r') {
        // Un a capo dentro le virgolette resta nel valore, ma normalizzato:
        // il CRLF di Excel diventerebbe altrimenti un \r di troppo nella cella.
        field += '\n';
        if (src[i + 1] === '\n') i++;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === '') {
      inQuotes = true;
      quoted = true;
      i++;
      continue;
    }
    if (ch === delimiter) {
      endField();
      i++;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      endField();
      endRow();
      if (ch === '\r' && src[i + 1] === '\n') i++;
      i++;
      if (rows.length >= wanted) break;
      continue;
    }
    field += ch;
    i++;
  }
  // Ultima riga senza a capo finale.
  if (rows.length < wanted && (field !== '' || quoted || row.length)) {
    endField();
    endRow();
  }

  // Il file può essere frastagliato: la larghezza è quella della riga più
  // lunga, così nessun valore va perso, e le righe corte si pareggiano a null.
  const dataStart = header ? 1 : 0;
  let width = 0;
  for (const r of rows) width = Math.max(width, r.length);
  const columns = makeNames(header ? rows[0] : null, width);
  const data = rows.slice(dataStart, limit === Infinity ? undefined : dataStart + limit);
  for (const r of data) while (r.length < width) r.push(null);
  return { columns, rows: data };
}
