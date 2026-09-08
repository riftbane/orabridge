import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toCsv,
  toJson,
  toInserts,
  toHtml,
  toXlsx,
  crc32,
  colRef,
  EXPORT_FORMATS,
} from '../src/exporters.js';

const COLS = [
  { name: 'ID', type: 'NUMBER' },
  { name: 'NOME', type: 'VARCHAR2' },
  { name: 'ASSUNTO', type: 'DATE' },
];

// ------------------------------------------------------------------- CSV

test('toCsv: intestazione, CRLF e BOM', () => {
  const out = toCsv(COLS, [[1, 'Rossi', '2024-01-02 10:30:00']]);
  assert.equal(out[0], '\ufeff');
  assert.equal(out.slice(1), 'ID,NOME,ASSUNTO\r\n1,Rossi,2024-01-02 10:30:00');
  assert.ok(!toCsv(COLS, [], { bom: false }).startsWith('\ufeff'));
});

test('toCsv: virgolette solo dove servono', () => {
  const cols = [{ name: 'A' }, { name: 'B' }, { name: 'C' }];
  const rows = [['con, virgola', 'con "apici"', 'due\nrighe']];
  assert.equal(
    toCsv(cols, rows, { bom: false }),
    'A,B,C\r\n"con, virgola","con ""apici""","due\nrighe"'
  );
});

test('toCsv: il separatore cambia anche cosa va quotato', () => {
  const cols = [{ name: 'A' }, { name: 'B' }];
  const out = toCsv(cols, [['con, virgola', 'con; punto']], { delimiter: ';', bom: false });
  assert.equal(out, 'A;B\r\ncon, virgola;"con; punto"');
});

test('toCsv: senza intestazione e con testo per i nulli', () => {
  const out = toCsv(COLS, [[null, 'x', null]], { header: false, bom: false, nullText: '(vuoto)' });
  assert.equal(out, '(vuoto),x,(vuoto)');
});

test('toCsv: il testo dei nulli viene quotato se contiene il separatore', () => {
  const out = toCsv([{ name: 'A' }], [[null]], { header: false, bom: false, nullText: 'a,b' });
  assert.equal(out, '"a,b"');
});

// ------------------------------------------------------------------ JSON

test('toJson: array di oggetti, null conservati', () => {
  const out = toJson(COLS, [[1, 'Rossi', null]], { pretty: false });
  assert.equal(out, '[{"ID":1,"NOME":"Rossi","ASSUNTO":null}]');
});

test('toJson: colonne omonime non si sovrascrivono', () => {
  const cols = [{ name: 'ID' }, { name: 'ID' }, { name: 'ID' }];
  const out = JSON.parse(toJson(cols, [[1, 2, 3]]));
  assert.deepEqual(out, [{ ID: 1, ID_2: 2, ID_3: 3 }]);
});

test('toJson: pretty indenta di due spazi', () => {
  assert.ok(toJson([{ name: 'A' }], [[1]]).includes('\n  {\n    "A": 1'));
});

// ---------------------------------------------------------------- INSERT

test('toInserts: numeri senza apici, testo con apici raddoppiati', () => {
  const out = toInserts(COLS, [[7, "L'Aquila", null]], { table: 'dipendenti' });
  assert.equal(
    out,
    "INSERT INTO DIPENDENTI (ID, NOME, ASSUNTO) VALUES (7, 'L''Aquila', NULL);"
  );
});

test('toInserts: DATE e TIMESTAMP nel formato del server', () => {
  const cols = [
    { name: 'D', type: 'DATE' },
    { name: 'T', type: 'TIMESTAMP' },
    { name: 'T2', type: 'TIMESTAMP(6)' },
  ];
  const out = toInserts(cols, [['2024-03-01 08:00:00', '2024-03-01 08:00:00', '2024-03-01 08:00:00.123']]);
  assert.equal(
    out,
    "INSERT INTO TABELLA (D, T, T2) VALUES (" +
      "TO_DATE('2024-03-01 08:00:00', 'YYYY-MM-DD HH24:MI:SS'), " +
      "TO_TIMESTAMP('2024-03-01 08:00:00.0', 'YYYY-MM-DD HH24:MI:SS.FF'), " +
      "TO_TIMESTAMP('2024-03-01 08:00:00.123', 'YYYY-MM-DD HH24:MI:SS.FF'));"
  );
});

test('toInserts: la parte decimale di una DATE viene tolta', () => {
  const out = toInserts([{ name: 'D', type: 'DATE' }], [['2024-03-01 08:00:00.500']]);
  assert.ok(out.includes("TO_DATE('2024-03-01 08:00:00',"));
});

test('toInserts: numeri lunghi restano intatti', () => {
  const out = toInserts([{ name: 'N', type: 'NUMBER' }], [['12345678901234567890123']]);
  assert.ok(out.includes('VALUES (12345678901234567890123);'));
});

test('toInserts: testo in colonna numerica non rompe l istruzione', () => {
  const out = toInserts([{ name: 'N', type: 'NUMBER' }], [['n/d'], ['']]);
  assert.equal(out, "INSERT INTO TABELLA (N) VALUES ('n/d');\nINSERT INTO TABELLA (N) VALUES (NULL);");
});

test('toInserts: i tipi passati a mano vincono su quelli delle colonne', () => {
  const out = toInserts([{ name: 'A', type: 'VARCHAR2' }], [['42']], { types: ['NUMBER'] });
  assert.ok(out.includes('VALUES (42);'));
});

test('toInserts: nome qualificato e identificatori strani', () => {
  const out = toInserts([{ name: 'Mia Col' }], [['x']], { table: 'HR.DIPENDENTI' });
  assert.equal(out, `INSERT INTO HR.DIPENDENTI ("Mia Col") VALUES ('x');`);
});

test('toInserts: COMMIT ogni N righe piu quello finale', () => {
  const rows = [[1], [2], [3], [4], [5]];
  const out = toInserts([{ name: 'N', type: 'NUMBER' }], rows, { commitEvery: 2 });
  const lines = out.split('\n');
  assert.deepEqual(
    lines.map((l) => (l === 'COMMIT;' ? 'C' : 'I')),
    ['I', 'I', 'C', 'I', 'I', 'C', 'I', 'C']
  );
});

test('toInserts: nessun COMMIT doppio quando le righe sono un multiplo', () => {
  const out = toInserts([{ name: 'N', type: 'NUMBER' }], [[1], [2]], { commitEvery: 2 });
  assert.equal(out.match(/COMMIT;/g).length, 1);
  assert.ok(out.endsWith('COMMIT;'));
});

test('toInserts: batch raggruppa in INSERT ALL', () => {
  const out = toInserts([{ name: 'N', type: 'NUMBER' }], [[1], [2], [3]], { batch: 2 });
  assert.equal(
    out,
    'INSERT ALL\n' +
      '  INTO TABELLA (N) VALUES (1)\n' +
      '  INTO TABELLA (N) VALUES (2)\n' +
      'SELECT * FROM DUAL;\n' +
      'INSERT ALL\n' +
      '  INTO TABELLA (N) VALUES (3)\n' +
      'SELECT * FROM DUAL;'
  );
});

test('toInserts: nessuna riga, nessuna istruzione', () => {
  assert.equal(toInserts(COLS, []), '');
});

// ------------------------------------------------------------------ HTML

test('toHtml: documento completo con charset e titolo', () => {
  const out = toHtml(COLS, [[1, 'Rossi', null]], { title: 'Prova & Co' });
  assert.ok(out.startsWith('<!doctype html>'));
  assert.ok(out.includes('<meta charset="utf-8">'));
  assert.ok(out.includes('<title>Prova &amp; Co</title>'));
  assert.ok(out.includes('<th>ID</th><th>NOME</th><th>ASSUNTO</th>'));
  assert.ok(out.includes('<td class="null">(null)</td>'));
});

test('toHtml: i valori sono sottoposti a escape', () => {
  const out = toHtml([{ name: 'A & <B>' }], [['<script>alert(1)</script>']]);
  assert.ok(out.includes('<th>A &amp; &lt;B&gt;</th>'));
  assert.ok(out.includes('<td>&lt;script&gt;alert(1)&lt;/script&gt;</td>'));
  assert.ok(!out.includes('<script>'));
});

test('toHtml: il conteggio delle righe si accorda al singolare', () => {
  assert.ok(toHtml([{ name: 'A' }], [[1]]).includes('1 riga'));
  assert.ok(toHtml([{ name: 'A' }], [[1], [2]]).includes('2 righe'));
});

// ------------------------------------------------------------------ XLSX

test('crc32: vettore di prova standard', () => {
  assert.equal(crc32('123456789'), 0xcbf43926);
  assert.equal(crc32(new Uint8Array()), 0);
});

test('colRef: riferimenti anche oltre la Z', () => {
  assert.deepEqual([0, 25, 26, 27, 51, 701, 702].map(colRef), [
    'A',
    'Z',
    'AA',
    'AB',
    'AZ',
    'ZZ',
    'AAA',
  ]);
});

// Legge uno ZIP a voci STORED passando dalla directory centrale: verifica la
// struttura del file, non solo il suo contenuto.
function unzip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  assert.ok(eocd >= 0, 'manca la End Of Central Directory');
  const count = dv.getUint16(eocd + 10, true);
  let at = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out = new Map();
  for (let k = 0; k < count; k++) {
    assert.equal(dv.getUint32(at, true), 0x02014b50);
    const crc = dv.getUint32(at + 16, true);
    const size = dv.getUint32(at + 20, true);
    const nameLen = dv.getUint16(at + 28, true);
    const extraLen = dv.getUint16(at + 30, true);
    const commentLen = dv.getUint16(at + 32, true);
    const local = dv.getUint32(at + 42, true);
    const name = dec.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    assert.equal(dv.getUint32(local, true), 0x04034b50);
    assert.equal(dv.getUint16(local + 8, true), 0, 'la voce deve essere STORED');
    const dataAt = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = bytes.subarray(dataAt, dataAt + size);
    assert.equal(crc32(data), crc, `CRC sbagliato per ${name}`);
    out.set(name, dec.decode(data));
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

test('toXlsx: firma ZIP e voci minime del pacchetto', () => {
  const bytes = toXlsx(COLS, [[1, 'Rossi', '2024-01-02 10:30:00']]);
  assert.ok(bytes instanceof Uint8Array);
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  const files = unzip(bytes);
  assert.deepEqual(
    [...files.keys()],
    [
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/worksheets/sheet1.xml',
    ]
  );
  assert.ok(files.get('[Content_Types].xml').includes('/xl/worksheets/sheet1.xml'));
  assert.ok(files.get('_rels/.rels').includes('xl/workbook.xml'));
  assert.ok(files.get('xl/_rels/workbook.xml.rels').includes('worksheets/sheet1.xml'));
});

test('toXlsx: testo in inlineStr, numeri in celle numeriche, null omessi', () => {
  const sheet = unzip(toXlsx(COLS, [[42, 'Rossi', null]])).get('xl/worksheets/sheet1.xml');
  assert.ok(sheet.includes('<c r="A1" t="inlineStr"><is><t xml:space="preserve">ID</t></is></c>'));
  assert.ok(sheet.includes('<c r="A2"><v>42</v></c>'));
  assert.ok(sheet.includes('<c r="B2" t="inlineStr"><is><t xml:space="preserve">Rossi</t></is></c>'));
  assert.ok(!sheet.includes('r="C2"'), 'la cella nulla non si scrive');
  assert.ok(!sheet.includes('sharedStrings'));
});

test('toXlsx: una colonna numerica con testo non numerico resta stringa', () => {
  const sheet = unzip(toXlsx([{ name: 'N', type: 'NUMBER' }], [['n/d'], [' 7 ']])).get(
    'xl/worksheets/sheet1.xml'
  );
  assert.ok(sheet.includes('<c r="A2" t="inlineStr"><is><t xml:space="preserve">n/d</t></is></c>'));
  assert.ok(sheet.includes('<c r="A3"><v>7</v></c>'), 'gli spazi attorno al numero si tolgono');
});

test('toXlsx: escape XML e caratteri di controllo tolti', () => {
  const sheet = unzip(toXlsx([{ name: 'A' }], [['<a & "b">\u0007\u0000 fine\tok']])).get(
    'xl/worksheets/sheet1.xml'
  );
  assert.ok(sheet.includes('&lt;a &amp; &quot;b&quot;&gt; fine\tok'));
  assert.ok(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(sheet));
});

test('toXlsx: riferimenti di cella oltre la Z', () => {
  const cols = Array.from({ length: 30 }, (_, i) => ({ name: 'C' + i }));
  const sheet = unzip(toXlsx(cols, [cols.map((_, i) => 'v' + i)])).get('xl/worksheets/sheet1.xml');
  assert.ok(sheet.includes('r="Z1"'));
  assert.ok(sheet.includes('r="AA1"'));
  assert.ok(sheet.includes('r="AD2"'));
});

test('toXlsx: nome del foglio ripulito e accorciato', () => {
  const wb = unzip(toXlsx([{ name: 'A' }], [], { sheet: 'Report/2024:[bozza]' })).get('xl/workbook.xml');
  assert.ok(wb.includes('<sheet name="Report 2024  bozza" sheetId="1" r:id="rId1"/>'));
  const lungo = unzip(toXlsx([{ name: 'A' }], [], { sheet: 'x'.repeat(50) })).get('xl/workbook.xml');
  assert.ok(lungo.includes(`name="${'x'.repeat(31)}"`));
});

test('toXlsx: griglia vuota produce comunque un pacchetto valido', () => {
  const files = unzip(toXlsx([], []));
  assert.equal(files.size, 5);
  assert.ok(files.get('xl/worksheets/sheet1.xml').includes('<sheetData></sheetData>'));
});

// --------------------------------------------------------------- formati

test('EXPORT_FORMATS: un id, un estensione e un MIME per ciascuno', () => {
  assert.deepEqual(
    EXPORT_FORMATS.map((f) => f.id),
    ['csv', 'xlsx', 'json', 'insert', 'html', 'tsv']
  );
  for (const f of EXPORT_FORMATS) {
    assert.ok(f.label && f.ext && f.mime, `formato incompleto: ${f.id}`);
  }
});
