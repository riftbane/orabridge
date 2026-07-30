import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

// I moduli leggono cartella dati e porta all'import: vanno impostate prima.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'orabridge-mcp-test-'));
process.env.PORT = '0';

const { ERR, PROTOCOL_VERSIONS, handleMessage } = await import('../src/mcp/protocol.js');
const { callTool, listTools, mcpApi, resolveConnection } = await import('../src/mcp/tools.js');
const { runTool, ToolError } = await import('../src/ai/tools.js');
const { pools } = await import('../src/pools.js');
const { store } = await import('../src/store.js');
const { ENDPOINT_FILE } = await import('../src/mcp/endpoint.js');
const { startServer } = await import('../src/index.js');

const TOKEN = 'token-di-prova';
const rpc = (method, params, id = 1) => ({ jsonrpc: '2.0', id, method, params });

// ---- superficie di sola lettura ----

test("l'elenco degli strumenti non contiene niente che scriva", () => {
  const names = listTools().map((t) => t.name);
  assert.ok(!names.includes('execute_sql'), 'execute_sql non deve essere esposto via MCP');
  assert.deepEqual(names, [
    'list_connections',
    'list_schemas',
    'list_objects',
    'describe_table',
    'get_source',
    'get_ddl',
    'run_query',
  ]);
  for (const tool of listTools()) {
    assert.equal(tool.annotations.readOnlyHint, true, `${tool.name} deve dichiararsi di sola lettura`);
    assert.equal(tool.annotations.destructiveHint, false);
    assert.ok(tool.inputSchema.type === 'object', `${tool.name} deve avere uno inputSchema a oggetto`);
  }
});

test('ogni strumento sul database accetta il parametro connection', () => {
  for (const tool of listTools()) {
    if (tool.name === 'list_connections') continue;
    assert.ok(
      tool.inputSchema.properties.connection,
      `${tool.name} deve poter scegliere la connessione`
    );
  }
});

test('chiamare execute_sql da MCP: rifiutato, con la spiegazione', async () => {
  const res = await handleMessage(rpc('tools/call', { name: 'execute_sql', arguments: { sql: 'DROP TABLE T' } }), mcpApi);
  assert.equal(res.error.code, ERR.INVALID_PARAMS);
  assert.match(res.error.message, /sola lettura/);
  assert.match(res.error.message, /foglio SQL/);
});

test('strumento inventato: errore di protocollo, non di esecuzione', async () => {
  const res = await handleMessage(rpc('tools/call', { name: 'delete_everything' }), mcpApi);
  assert.equal(res.error.code, ERR.INVALID_PARAMS);
  assert.match(res.error.message, /sconosciuto/);
});

test('la seconda serratura: runTool in sola lettura rifiuta gli strumenti di scrittura', async () => {
  await assert.rejects(
    () => runTool('qualsiasi', 'execute_sql', { sql: 'DELETE FROM T' }, { readOnly: true }),
    (err) => {
      assert.ok(err instanceof ToolError);
      assert.match(err.message, /sola lettura/);
      return true;
    }
  );
});

// ---- risoluzione della connessione ----

test('senza connessioni attive lo strumento spiega cosa fare, non fallisce a vuoto', async () => {
  assert.throws(() => resolveConnection(''), (err) => {
    assert.match(err.message, /Nessuna connessione attiva/);
    return true;
  });

  const res = await handleMessage(
    rpc('tools/call', { name: 'describe_table', arguments: { name: 'ORDINI' } }),
    mcpApi
  );
  assert.equal(res.result.isError, true);
  assert.match(res.result.content[0].text, /Nessuna connessione attiva/);
});

test('list_connections senza connessioni: risposta utile, non un errore', async () => {
  const text = await callTool('list_connections', {});
  assert.match(text, /Nessuna connessione attiva/);
  // Le credenziali non escono da qui in nessun caso.
  assert.ok(!/password/i.test(text));
});

// Connessioni finte: la risoluzione del nome e quello che finisce nel testo si
// possono provare senza un Oracle vero.
function withFakePools(entries, fn) {
  const { ids, get } = pools;
  const list = store.list;
  pools.ids = () => entries.map((e) => e.id);
  pools.get = (id) => entries.find((e) => e.id === id) || null;
  store.list = () => entries.map((e) => ({ id: e.id, name: e.name }));
  try {
    return fn();
  } finally {
    Object.assign(pools, { ids, get });
    store.list = list;
  }
}

const CONN_A = {
  id: 'id-a',
  name: 'Collaudo WSS',
  currentSchema: 'WSS',
  version: '19.0.0.0.0',
  // Campi che non devono comparire da nessuna parte lato modello.
  user: 'WSS_ADMIN',
  password: 'segretissima',
};
const CONN_B = { id: 'id-b', name: 'Produzione', currentSchema: 'PROD', version: '21.3.0.0.0' };

test('una sola connessione attiva: si usa quella senza chiedere niente', () => {
  withFakePools([CONN_A], () => {
    assert.equal(resolveConnection(''), 'id-a');
    assert.equal(resolveConnection(undefined), 'id-a');
  });
});

test('più connessioni attive: si chiede quale, elencando i nomi', () => {
  withFakePools([CONN_A, CONN_B], () => {
    assert.throws(() => resolveConnection(''), (err) => {
      assert.match(err.message, /Collaudo WSS/);
      assert.match(err.message, /Produzione/);
      assert.match(err.message, /connection/);
      return true;
    });
    // Per nome, per id e per pezzo di nome.
    assert.equal(resolveConnection('produzione'), 'id-b');
    assert.equal(resolveConnection('id-a'), 'id-a');
    assert.equal(resolveConnection('Collaudo'), 'id-a');
    assert.throws(() => resolveConnection('Sviluppo'), /Nessuna connessione attiva di nome/);
  });
});

test('list_connections non fa uscire credenziali né dati di connessione', async () => {
  const text = await withFakePools([CONN_A, CONN_B], () => callTool('list_connections', {}));
  assert.match(text, /Collaudo WSS/);
  assert.match(text, /WSS/);
  assert.match(text, /19\.0\.0\.0\.0/);
  // Utente Oracle, password e dati del servizio restano nell'applicazione.
  assert.ok(!text.includes('segretissima'), 'la password non deve comparire');
  assert.ok(!text.includes('WSS_ADMIN'), "l'utenza non deve comparire");
});

// ---- protocollo ----

test('initialize: si risponde con la revisione chiesta se la conosciamo', async () => {
  const res = await handleMessage(rpc('initialize', { protocolVersion: '2025-06-18' }), mcpApi);
  assert.equal(res.result.protocolVersion, '2025-06-18');
  assert.equal(res.result.serverInfo.name, 'orabridge');
  assert.deepEqual(res.result.capabilities, { tools: { listChanged: false } });
  assert.match(res.result.instructions, /SOLA LETTURA/);
});

test('initialize con una revisione che non conosciamo: si propone la nostra', async () => {
  const res = await handleMessage(rpc('initialize', { protocolVersion: '1999-01-01' }), mcpApi);
  assert.equal(res.result.protocolVersion, PROTOCOL_VERSIONS[0]);
});

test('tools/list funziona anche senza handshake (protocollo stateless)', async () => {
  const res = await handleMessage(rpc('tools/list', {}), mcpApi);
  assert.equal(res.result.tools.length, 7);
});

test('alle notifiche non si risponde', async () => {
  assert.equal(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, mcpApi), null);
  assert.equal(await handleMessage({ jsonrpc: '2.0', method: 'notifications/cancelled', params: {} }, mcpApi), null);
});

test('metodo non supportato e messaggio malformato', async () => {
  const nope = await handleMessage(rpc('resources/list', {}), mcpApi);
  assert.equal(nope.error.code, ERR.METHOD_NOT_FOUND);

  const junk = await handleMessage({ jsonrpc: '2.0', id: 9 }, mcpApi);
  assert.equal(junk.error.code, ERR.INVALID_REQUEST);

  const ping = await handleMessage(rpc('ping', {}), mcpApi);
  assert.deepEqual(ping.result, {});
});

test('tools/call senza nome dello strumento', async () => {
  const res = await handleMessage(rpc('tools/call', { arguments: {} }), mcpApi);
  assert.equal(res.error.code, ERR.INVALID_PARAMS);
});

// ---- endpoint HTTP ----

function request(port, { method = 'POST', path: p = '/api/mcp', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body), 'utf8');
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: p,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
          ...headers,
        },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (text += chunk));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            /* corpo vuoto o non JSON */
          }
          resolve({ status: res.statusCode, text, json });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test('endpoint MCP: spento di default, protetto dal token, accendibile senza riavvio', async () => {
  const backend = await startServer({ port: 0, host: '127.0.0.1', token: TOKEN });
  const auth = { 'X-Orabridge-Token': TOKEN };
  try {
    // Senza token non si passa, come per tutto il resto della API.
    const anonimo = await request(backend.port, { body: rpc('tools/list') });
    assert.equal(anonimo.status, 403);

    // Spento di default: nessun file di scoperta e nessuna risposta MCP.
    assert.equal(fs.existsSync(ENDPOINT_FILE), false);
    const spento = await request(backend.port, { headers: auth, body: rpc('tools/list') });
    assert.equal(spento.status, 403);
    assert.match(spento.json.error.message, /disattivata/);

    // Acceso dalle impostazioni: porta e token finiscono nel file per il ponte.
    const on = await request(backend.port, {
      method: 'PUT',
      path: '/api/mcp/status',
      headers: auth,
      body: { enabled: true },
    });
    assert.equal(on.status, 200);
    assert.equal(on.json.enabled, true);

    const info = JSON.parse(fs.readFileSync(ENDPOINT_FILE, 'utf8'));
    assert.equal(info.port, backend.port);
    assert.equal(info.token, TOKEN);
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(ENDPOINT_FILE).mode & 0o777, 0o600);
    }

    const acceso = await request(backend.port, { headers: auth, body: rpc('tools/list') });
    assert.equal(acceso.status, 200);
    assert.equal(acceso.json.result.tools.length, 7);

    // Una notifica non produce corpo.
    const notifica = await request(backend.port, {
      headers: auth,
      body: { jsonrpc: '2.0', method: 'notifications/initialized' },
    });
    assert.equal(notifica.status, 202);
    assert.equal(notifica.text, '');

    // GET sull'endpoint: non offriamo stream server→client.
    const get = await request(backend.port, { method: 'GET', headers: auth });
    assert.equal(get.status, 405);
  } finally {
    await backend.close();
  }
  // Server chiuso: il file di scoperta non deve restare in giro a indicare una
  // porta che non risponde più.
  assert.equal(fs.existsSync(ENDPOINT_FILE), false);
});
