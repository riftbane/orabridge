// Formati di esportazione di una griglia (CSV, JSON, INSERT, HTML, XLSX).
// Modulo puro: l'unica funzione che tocca il DOM è downloadBlob, così i
// formati restano collaudabili con node:test senza un finto browser.
//
// `columns` è [{ name, type }] come lo restituisce il server, `rows` è un
// array di array di stringhe/numeri/null: le celle arrivano già serializzate
// da server/src/oracle.js (serializeValue), quindi le date sono testo nel
// formato 'YYYY-MM-DD HH24:MI:SS[.FF]'.

import { ident, lit } from './ddl.js';

// Elenco dei formati offerti dalla finestra di esportazione: estensione e
// MIME appartengono al formato, non alla finestra, quindi stanno qui.
// I formati offerti dall'esportazione, con l'estensione e il tipo MIME da dare
// al file. Stanno qui e non nella finestra perché sono un fatto del modulo che
// li produce: due elenchi separati divergono al primo formato aggiunto.
export const EXPORT_FORMATS = [
  { id: 'csv', label: 'CSV', ext: 'csv', mime: 'text/csv;charset=utf-8' },
  {
    id: 'xlsx',
    label: 'Excel (.xlsx)',
    ext: 'xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  { id: 'json', label: 'JSON', ext: 'json', mime: 'application/json;charset=utf-8' },
  { id: 'insert', label: 'INSERT', ext: 'sql', mime: 'text/plain;charset=utf-8' },
  { id: 'html', label: 'HTML', ext: 'html', mime: 'text/html;charset=utf-8' },
  { id: 'tsv', label: 'TSV', ext: 'tsv', mime: 'text/tab-separated-values;charset=utf-8' },
];

const colName = (c) => String((c && typeof c === 'object' ? c.name : c) ?? '');

// Del tipo conta la prima parola: dbTypeName può arrivare come
// "TIMESTAMP(6) WITH TIME ZONE" e a noi interessa solo la famiglia.
const baseType = (t) => String(t ?? '').trim().toUpperCase().split(/[\s(]/)[0];

const NUMERIC_TYPES = new Set([
  'NUMBER',
  'FLOAT',
  'INTEGER',
  'INT',
  'BINARY_FLOAT',
  'BINARY_DOUBLE',
  'DECIMAL',
  'NUMERIC',
  'SMALLINT',
]);

const isNumericType = (t) => NUMERIC_TYPES.has(baseType(t));

// Un numero scritto per intero lo teniamo verbatim invece di passarlo da
// Number(): un NUMBER(38) perderebbe le cifre finali.
const NUMBER_TEXT = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

// ------------------------------------------------------------------- CSV

export function toCsv(columns, rows, opts = {}) {
  const { delimiter = ',', header = true, nullText = '', bom = true } = opts;
  const cols = columns || [];
  // Le virgolette servono solo se il valore contiene il separatore, un apice
  // doppio o un a capo: per il resto il campo resta nudo, più leggibile.
  const needsQuote = new RegExp(`["\\r\\n${delimiter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}]`);
  const esc = (v) => {
    const s = v === null || v === undefined ? nullText : String(v);
    return needsQuote.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [];
  if (header) lines.push(cols.map((c) => esc(colName(c))).join(delimiter));
  for (const r of rows || []) lines.push((r || []).map(esc).join(delimiter));
  // CRLF come vuole la RFC 4180 ed Excel su Windows; il nostro parser accetta
  // comunque entrambi i fine riga.
  const text = lines.join('\r\n');
  return bom ? '\ufeff' + text : text;
}

// ------------------------------------------------------------------ JSON

export function toJson(columns, rows, opts = {}) {
  const { pretty = true } = opts;
  // Due colonne omonime (tipico di una join senza alias) si sovrascriverebbero
  // in silenzio dentro l'oggetto: la seconda diventa NOME_2.
  const keys = [];
  const seen = new Map();
  for (const c of columns || []) {
    const base = colName(c) || 'COL' + (keys.length + 1);
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    keys.push(n === 1 ? base : `${base}_${n}`);
  }
  const out = (rows || []).map((r) => {
    const o = {};
    keys.forEach((k, i) => {
      o[k] = r?.[i] === undefined ? null : r[i];
    });
    return o;
  });
  return JSON.stringify(out, null, pretty ? 2 : 0);
}

// ---------------------------------------------------------------- INSERT

// Il nome può arrivare come "SCHEMA.TABELLA": va diviso, altrimenti ident()
// lo quoterebbe tutto insieme producendo "SCHEMA.TABELLA".
function tableSql(table) {
  const s = String(table ?? '').trim() || 'TABELLA';
  return /^[A-Za-z][A-Za-z0-9_$#]*\.[A-Za-z][A-Za-z0-9_$#]*$/.test(s)
    ? s.split('.').map(ident).join('.')
    : ident(s);
}

// Espressione SQL per un valore nel formato in cui il server l'ha serializzato
// (vedi fmtDate in server/src/oracle.js).
function valueSql(type, v) {
  if (v === null || v === undefined) return 'NULL';
  const t = baseType(type);
  if (isNumericType(t)) {
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
    const s = String(v).trim();
    if (s === '') return 'NULL';
    // Se il valore non è un numero (colonna tipizzata male, testo residuo)
    // meglio un letterale fra apici che un'istruzione che non compila.
    return NUMBER_TEXT.test(s) ? s : lit(s);
  }
  if (t === 'DATE') {
    return `TO_DATE(${lit(String(v).replace(/\.\d+$/, ''))}, 'YYYY-MM-DD HH24:MI:SS')`;
  }
  if (t === 'TIMESTAMP') {
    const s = String(v);
    return `TO_TIMESTAMP(${lit(s.includes('.') ? s : s + '.0')}, 'YYYY-MM-DD HH24:MI:SS.FF')`;
  }
  return lit(v);
}

export function toInserts(columns, rows, opts = {}) {
  const { table = 'TABELLA', types = [], batch = 0, commitEvery = 0 } = opts;
  const cols = columns || [];
  const target = tableSql(table);
  const colList = cols.map((c) => ident(colName(c))).join(', ');
  const typeOf = (i) => types[i] ?? (cols[i] && typeof cols[i] === 'object' ? cols[i].type : '');
  const values = (r) => cols.map((c, i) => valueSql(typeOf(i), r?.[i])).join(', ');

  const out = [];
  const all = rows || [];
  const size = batch > 0 ? batch : 1;
  let sinceCommit = 0;
  for (let i = 0; i < all.length; i += size) {
    const chunk = all.slice(i, i + size);
    if (size === 1) {
      out.push(`INSERT INTO ${target} (${colList}) VALUES (${values(chunk[0])});`);
    } else {
      // INSERT ALL raggruppa N righe in un solo viaggio; Oracle lo accetta
      // solo con la SELECT finale su DUAL.
      out.push(
        'INSERT ALL\n' +
          chunk.map((r) => `  INTO ${target} (${colList}) VALUES (${values(r)})`).join('\n') +
          '\nSELECT * FROM DUAL;'
      );
    }
    sinceCommit += chunk.length;
    if (commitEvery > 0 && sinceCommit >= commitEvery) {
      out.push('COMMIT;');
      sinceCommit = 0;
    }
  }
  // Il COMMIT finale si aggiunge solo se resta qualcosa da confermare: subito
  // dopo un COMMIT appena emesso sarebbe rumore.
  if (commitEvery > 0 && sinceCommit > 0) out.push('COMMIT;');
  return out.join('\n');
}

// ------------------------------------------------------------------ HTML

const htmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function toHtml(columns, rows, opts = {}) {
  const { title = 'Esportazione Orabridge' } = opts;
  const cols = columns || [];
  const head = cols.map((c) => `<th>${htmlEsc(colName(c))}</th>`).join('');
  const body = (rows || [])
    .map((r) => {
      const tds = cols
        .map((c, i) => {
          const v = r?.[i];
          return v === null || v === undefined
            ? '<td class="null">(null)</td>'
            : `<td>${htmlEsc(v)}</td>`;
        })
        .join('');
      return `<tr>${tds}</tr>`;
    })
    .join('\n');
  const n = (rows || []).length;
  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${htmlEsc(title)}</title>
<style>
  body { font: 13px/1.45 system-ui, -apple-system, sans-serif; color: #1c1c1c; background: #fff; margin: 24px; }
  h1 { font-size: 17px; margin: 0 0 4px; }
  p.meta { margin: 0 0 16px; color: #666; font-size: 12px; }
  table { border-collapse: collapse; font-size: 12px; }
  th, td { border: 1px solid #d4d4d4; padding: 3px 8px; text-align: left; vertical-align: top; white-space: pre-wrap; }
  th { background: #f0f0f0; font-weight: 600; position: sticky; top: 0; }
  tbody tr:nth-child(even) { background: #fafafa; }
  td.null { color: #9a9a9a; font-style: italic; }
</style>
</head>
<body>
<h1>${htmlEsc(title)}</h1>
<p class="meta">${n} rig${n === 1 ? 'a' : 'he'} &middot; ${cols.length} colonn${cols.length === 1 ? 'a' : 'e'}</p>
<table>
<thead><tr>${head}</tr></thead>
<tbody>
${body}
</tbody>
</table>
</body>
</html>
`;
}

// ------------------------------------------------------------------ XLSX

// CRC-32 (polinomio 0xEDB88320) con tabella precalcolata: serve alle voci
// dello ZIP. Vettore di prova standard: crc32('123456789') === 0xCBF43926.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Indice di colonna → lettere del riferimento A1 (0 → A, 25 → Z, 26 → AA).
export function colRef(i) {
  let s = '';
  let n = i;
  for (;;) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
    if (n < 0) return s;
  }
}

// XML non ammette i caratteri di controllo né i surrogati spaiati (il server
// tronca le celle lunghe e può spezzare una coppia): se restano, Excel
// dichiara il file corrotto e non lo apre affatto.
function xmlText(v) {
  const s = String(v).replace(
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\uD800-\uDFFF]/g,
    (ch, i, all) => {
      const c = ch.charCodeAt(0);
      if (c < 0x20) return '';
      if (c <= 0xdbff) {
        const next = all.charCodeAt(i + 1);
        return next >= 0xdc00 && next <= 0xdfff ? ch : '';
      }
      const prev = all.charCodeAt(i - 1);
      return prev >= 0xd800 && prev <= 0xdbff ? ch : '';
    }
  );
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const u16 = (n) => [n & 0xff, (n >>> 8) & 0xff];
const u32 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];

// ZIP con voci STORED (metodo 0): senza compressione bastano il CRC-32 e gli
// header, e non serve trascinarsi dietro una libreria di deflate.
function zipStored(entries) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  const push = (arr) => {
    const b = arr instanceof Uint8Array ? arr : new Uint8Array(arr);
    parts.push(b);
    offset += b.length;
  };
  for (const [name, content] of entries) {
    const nameBytes = enc.encode(name);
    const data = typeof content === 'string' ? enc.encode(content) : content;
    const crc = crc32(data);
    const localAt = offset;
    // Data e ora fisse (1980-01-01): a parità di dati il file deve uscire
    // identico byte per byte.
    push([
      0x50, 0x4b, 0x03, 0x04,
      ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0x21),
      ...u32(crc), ...u32(data.length), ...u32(data.length),
      ...u16(nameBytes.length), ...u16(0),
    ]);
    push(nameBytes);
    push(data);
    central.push([
      0x50, 0x4b, 0x01, 0x02,
      ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0x21),
      ...u32(crc), ...u32(data.length), ...u32(data.length),
      ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(localAt),
      ...nameBytes,
    ]);
  }
  const cdAt = offset;
  for (const c of central) push(c);
  const cdSize = offset - cdAt;
  push([
    0x50, 0x4b, 0x05, 0x06,
    ...u16(0), ...u16(0), ...u16(central.length), ...u16(central.length),
    ...u32(cdSize), ...u32(cdAt), ...u16(0),
  ]);
  const out = new Uint8Array(offset);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// Il nome del foglio non può superare i 31 caratteri né contenere : \ / ? * [ ]
const sheetName = (s) => (String(s ?? '').replace(/[:\\/?*[\]]/g, ' ').trim() || 'Dati').slice(0, 31);

export function toXlsx(columns, rows, opts = {}) {
  const { sheet = 'Dati' } = opts;
  const cols = columns || [];
  const numeric = cols.map((c) => isNumericType(c && typeof c === 'object' ? c.type : ''));

  const cell = (ref, v, asNumber) => {
    // Una cella vuota non si scrive affatto: è così che si rappresenta il
    // NULL in un foglio, e il file resta più piccolo.
    if (v === null || v === undefined || v === '') return '';
    if (asNumber) return `<c r="${ref}"><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlText(v)}</t></is></c>`;
  };

  const lines = [];
  let r = 1;
  if (cols.length) {
    lines.push(`<row r="${r}">` + cols.map((c, i) => cell(colRef(i) + r, colName(c), false)).join('') + '</row>');
    r++;
  }
  for (const row of rows || []) {
    const cells = cols.map((c, i) => {
      const v = row?.[i];
      // Numerica solo se la colonna lo è e il testo è davvero un numero: un
      // <v> non numerico rende il foglio illeggibile a Excel.
      const num =
        numeric[i] &&
        (typeof v === 'number'
          ? Number.isFinite(v)
          : typeof v === 'string' && v.trim() !== '' && NUMBER_TEXT.test(v.trim()));
      return cell(colRef(i) + r, num && typeof v === 'string' ? v.trim() : v, num);
    });
    lines.push(`<row r="${r}">` + cells.join('') + '</row>');
    r++;
  }

  const sheetXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetData>' +
    lines.join('') +
    '</sheetData></worksheet>';

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '</Types>';

  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';

  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheets><sheet name="${xmlText(sheetName(sheet))}" sheetId="1" r:id="rId1"/></sheets></workbook>`;

  const workbookRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '</Relationships>';

  return zipStored([
    ['[Content_Types].xml', contentTypes],
    ['_rels/.rels', rootRels],
    ['xl/workbook.xml', workbook],
    ['xl/_rels/workbook.xml.rels', workbookRels],
    ['xl/worksheets/sheet1.xml', sheetXml],
  ]);
}

// -------------------------------------------------------------- download

// Unico punto che tocca il DOM: crea un Blob, simula il clic su un link con
// l'attributo download e libera subito l'URL temporaneo.
export function downloadBlob(data, filename, mime = 'application/octet-stream') {
  const blob = typeof Blob !== 'undefined' && data instanceof Blob ? data : new Blob([data], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
