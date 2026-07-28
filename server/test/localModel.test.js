import test from 'node:test';
import assert from 'node:assert/strict';
import { gbnfParams, stripNulls, toChatHistory } from '../src/ai/localLlama.js';
import { CATALOG, catalogEntry } from '../src/ai/localModels.js';

test('toChatHistory: chiamata a strumento ed esito finiscono nello stesso blocco', () => {
  const history = toChatHistory('istruzioni', [
    { role: 'user', content: [{ type: 'text', text: 'quante righe ha DUAL?' }] },
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'guardo' },
        { type: 'tool_use', id: 't1', name: 'describe_table', input: { name: 'DUAL' } },
      ],
    },
    {
      role: 'user',
      content: [
        { type: 'tool_result', toolUseId: 't1', toolName: 'describe_table', content: 'DUMMY VARCHAR2(1)' },
      ],
    },
  ]);

  assert.deepEqual(history[0], { type: 'system', text: 'istruzioni' });
  assert.deepEqual(history[1], { type: 'user', text: 'quante righe ha DUAL?' });
  assert.equal(history[2].type, 'model');
  assert.equal(history[2].response[0], 'guardo');
  assert.deepEqual(history[2].response[1], {
    type: 'functionCall',
    name: 'describe_table',
    params: { name: 'DUAL' },
    result: 'DUMMY VARCHAR2(1)',
  });
  // L'esito è già dentro il blocco del modello: non deve restare anche come
  // messaggio utente a sé, o il modello lo leggerebbe due volte.
  assert.equal(history.length, 3);
});

test('toChatHistory: una chiamata senza esito non resta aperta', () => {
  const history = toChatHistory(null, [
    {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'orfano', name: 'run_query', input: { sql: 'SELECT 1' } }],
    },
  ]);
  assert.equal(history[0].response[0].result, 'Operazione interrotta senza esito.');
});

test('toChatHistory: senza system non si inventa un messaggio di sistema', () => {
  const history = toChatHistory('', [{ role: 'user', content: [{ type: 'text', text: 'ciao' }] }]);
  assert.deepEqual(history, [{ type: 'user', text: 'ciao' }]);
});

test('gbnfParams: le proprietà facoltative accettano null, quelle richieste no', () => {
  const params = gbnfParams({
    type: 'object',
    properties: {
      sql: { type: 'string', description: 'la query' },
      maxRows: { type: 'integer' },
    },
    required: ['sql'],
  });

  // `sql` è obbligatoria: schema diretto, senza scappatoia.
  assert.equal(params.properties.sql.type, 'string');
  assert.equal(params.properties.sql.oneOf, undefined);
  // `maxRows` no: la grammatica pretenderebbe comunque la chiave, quindi le si
  // concede null.
  assert.deepEqual(params.properties.maxRows.oneOf, [{ type: 'null' }, { type: 'integer' }]);
});

test('gbnfParams: i tipi che la grammatica non conosce diventano stringhe', () => {
  const params = gbnfParams({
    type: 'object',
    properties: { strano: { type: 'chissà' }, scelta: { enum: ['A', 'B'] } },
    required: ['strano', 'scelta'],
  });
  assert.equal(params.properties.strano.type, 'string');
  assert.deepEqual(params.properties.scelta.enum, ['A', 'B']);
});

test('stripNulls: i null di comodo non arrivano agli strumenti', () => {
  assert.deepEqual(stripNulls({ sql: 'SELECT 1', maxRows: null, owner: undefined }), {
    sql: 'SELECT 1',
  });
  assert.deepEqual(stripNulls(null), {});
});

test('il catalogo dei modelli è coerente', () => {
  assert.ok(CATALOG.length > 0);
  for (const m of CATALOG) {
    assert.equal(catalogEntry(m.id), m);
    assert.match(m.url, /^https:\/\/huggingface\.co\/.+\.gguf$/);
    // Il nome del file deve combaciare con quello scaricato, altrimenti il
    // modello risulterebbe sempre "da scaricare".
    assert.ok(m.url.endsWith(`/${m.file}`), `${m.id}: url e file non combaciano`);
    assert.ok(m.bytes > 1e9);
    assert.ok(m.contextSize >= 4096);
  }
  assert.equal(catalogEntry('non-esiste'), null);
});
