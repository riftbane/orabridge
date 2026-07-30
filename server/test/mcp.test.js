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
const { callTool, listTools, mcpApi, pickConnection, resolveConnection } = await import(
  '../src/mcp/tools.js'
);
const { activity } = await import('../src/mcp/activity.js');
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

// ---- configurazione salvata sulla connessione ----

test('nuova connessione: nasce non esposta, e modifica/eliminazione non sono impostabili', () => {
  const conn = store.create({ name: 'Prova MCP', user: 'TEST', password: 'x' });
  try {
    assert.deepEqual(conn.mcp, {
      enabled: false,
      permissions: { read: true, write: false, delete: false },
    });

    // Anche chiedendoli esplicitamente: gli strumenti che servirebbero non
    // escono da MCP, quindi il permesso non si può concedere.
    const forzata = store.update(conn.id, {
      mcp: { enabled: true, permissions: { write: true, delete: true } },
    });
    assert.deepEqual(forzata.mcp, {
      enabled: true,
      permissions: { read: true, write: false, delete: false },
    });

    // Patch parziale: accendere l'interruttore non ripristina la lettura tolta.
    store.update(conn.id, { mcp: { permissions: { read: false } } });
    const dopo = store.update(conn.id, { mcp: { enabled: true } });
    assert.equal(dopo.mcp.permissions.read, false);

    // Una modifica che non parla di MCP lascia tutto com'era.
    const rinominata = store.update(conn.id, { name: 'Altro nome' });
    assert.equal(rinominata.mcp.enabled, true);
    assert.equal(rinominata.mcp.permissions.read, false);
  } finally {
    store.remove(conn.id);
  }
});

test('connessione salvata prima di questa funzione: spenta, non esposta per sbaglio', () => {
  const conn = store.create({ name: 'Vecchia', user: 'TEST', password: 'x' });
  try {
    // `store.list()` normalizza anche quello che sul disco non ha il campo.
    const senzaCampo = store.list().find((c) => c.id === conn.id);
    assert.equal(senzaCampo.mcp.enabled, false);
    assert.equal(senzaCampo.hasPassword, true);
    // E la password non esce comunque dall'elenco.
    assert.equal(senzaCampo.password, undefined);
  } finally {
    store.remove(conn.id);
  }
});

// ---- scelta del database e collegamento automatico ----

test('senza database esposti lo strumento spiega cosa fare, non fallisce a vuoto', async () => {
  await assert.rejects(() => resolveConnection(''), (err) => {
    assert.match(err.message, /Nessun database è esposto/);
    return true;
  });

  const res = await handleMessage(
    rpc('tools/call', { name: 'describe_table', arguments: { name: 'ORDINI' } }),
    mcpApi
  );
  assert.equal(res.result.isError, true);
  assert.match(res.result.content[0].text, /Nessun database è esposto/);
});

test('list_connections senza database esposti: risposta utile, non un errore', async () => {
  const text = await callTool('list_connections', {});
  assert.match(text, /Nessun database è esposto/);
  // Le credenziali non escono da qui in nessun caso.
  assert.ok(!/password/i.test(text));
});

// Connessioni finte: scelta del database, permessi, collegamento automatico e
// testo restituito si provano senza un Oracle vero. Ogni voce descrive una
// connessione salvata in Orabridge; `connected: true` vuol dire che il pool è
// già aperto, altrimenti l'integrazione deve aprirlo da sé.
const EXPOSED = { enabled: true, permissions: { read: true, write: false, delete: false } };

async function withFakeConnections(list, fn) {
  const { ids, get, connect } = pools;
  const storeList = store.list;
  const storeGet = store.get;
  const open = new Map(
    list.filter((c) => c.connected).map((c) => [c.id, { id: c.id, currentSchema: c.schema, version: c.version }])
  );
  const opened = [];

  pools.ids = () => [...open.keys()];
  pools.get = (id) => open.get(id) || null;
  pools.connect = async (cfg) => {
    const c = list.find((x) => x.id === cfg.id);
    opened.push(cfg.id);
    const entry = { id: cfg.id, currentSchema: c.schema, version: c.version, user: c.user };
    open.set(cfg.id, entry);
    return entry;
  };
  store.list = () =>
    list.map((c) => ({
      id: c.id,
      name: c.name,
      mcp: c.mcp || EXPOSED,
      hasPassword: c.password !== '',
    }));
  store.get = (id) => {
    const c = list.find((x) => x.id === id);
    return c ? { id: c.id, name: c.name, user: c.user, password: c.password ?? 'segretissima' } : null;
  };

  try {
    return await fn(opened);
  } finally {
    Object.assign(pools, { ids, get, connect });
    store.list = storeList;
    store.get = storeGet;
  }
}

const CONN_A = {
  id: 'id-a',
  name: 'Collaudo WSS',
  schema: 'WSS',
  version: '19.0.0.0.0',
  connected: true,
  // Campi che non devono comparire da nessuna parte lato modello.
  user: 'WSS_ADMIN',
  password: 'segretissima',
};
const CONN_B = { id: 'id-b', name: 'Produzione', schema: 'PROD', version: '21.3.0.0.0', connected: true };

test('un solo database esposto: si usa quello senza chiedere niente', async () => {
  await withFakeConnections([CONN_A], async () => {
    assert.equal(await resolveConnection(''), 'id-a');
    assert.equal(await resolveConnection(undefined), 'id-a');
  });
});

test('più database esposti e collegati: si chiede quale, elencando i nomi', async () => {
  await withFakeConnections([CONN_A, CONN_B], async () => {
    await assert.rejects(() => resolveConnection(''), (err) => {
      assert.match(err.message, /Collaudo WSS/);
      assert.match(err.message, /Produzione/);
      assert.match(err.message, /connection/);
      return true;
    });
    // Per nome, per id e per pezzo di nome.
    assert.equal(await resolveConnection('produzione'), 'id-b');
    assert.equal(await resolveConnection('id-a'), 'id-a');
    assert.equal(await resolveConnection('Collaudo'), 'id-a');
    await assert.rejects(() => resolveConnection('Sviluppo'), /Nessun database esposto di nome/);
  });
});

test('più esposti ma uno solo collegato: si usa quello, senza chiedere', async () => {
  await withFakeConnections([CONN_A, { ...CONN_B, connected: false }], async () => {
    assert.equal(await resolveConnection(''), 'id-a');
  });
});

// ---- l'interruttore è per connessione ----

test('una connessione non esposta non esiste da questa parte', async () => {
  const nascosta = { ...CONN_B, mcp: { enabled: false, permissions: { read: true } } };
  await withFakeConnections([CONN_A, nascosta], async () => {
    assert.deepEqual(
      // Solo la esposta, anche chiedendola per nome.
      [pickConnection('').id, pickConnection('Collaudo').id],
      ['id-a', 'id-a']
    );
    assert.throws(() => pickConnection('Produzione'), /Nessun database esposto di nome/);
    const text = await callTool('list_connections', {});
    assert.match(text, /Collaudo WSS/);
    assert.ok(!text.includes('Produzione'), 'una connessione non esposta non deve comparire');
  });
});

test('lettura tolta a una connessione: rifiutata, senza toccare il database', async () => {
  const senzaLettura = {
    ...CONN_A,
    mcp: { enabled: true, permissions: { read: false, write: false, delete: false } },
  };
  await withFakeConnections([senzaLettura], async () => {
    await assert.rejects(() => resolveConnection(''), /non ha abilitato la lettura/);
    const res = await handleMessage(
      rpc('tools/call', { name: 'describe_table', arguments: { name: 'ORDINI' } }),
      mcpApi
    );
    assert.equal(res.result.isError, true);
    assert.match(res.result.content[0].text, /lettura/);
  });
});

// ---- collegamento automatico ----

test('database esposto ma non collegato: lo collega da sé, una volta sola', async () => {
  const spento = { ...CONN_A, connected: false };
  await withFakeConnections([spento], async (opened) => {
    activity.reset();
    assert.equal(await resolveConnection(''), 'id-a');
    assert.deepEqual(opened, ['id-a']);
    // Già aperto: la seconda chiamata non riapre niente.
    assert.equal(await resolveConnection(''), 'id-a');
    assert.deepEqual(opened, ['id-a']);
    // E l'utente lo vede: il collegamento finisce nell'attività in tempo reale.
    const apertura = activity.recent().find((e) => e.kind === 'open');
    assert.equal(apertura.connName, 'Collaudo WSS');
    assert.equal(apertura.schema, 'WSS');
  });
});

test('due strumenti in parallelo sullo stesso database: un collegamento solo', async () => {
  const spento = { ...CONN_A, connected: false };
  await withFakeConnections([spento], async (opened) => {
    await Promise.all([resolveConnection(''), resolveConnection(''), resolveConnection('')]);
    assert.deepEqual(opened, ['id-a']);
  });
});

test('senza password salvata non si inventa niente: si spiega cosa fare', async () => {
  const senzaPassword = { ...CONN_A, connected: false, password: '' };
  await withFakeConnections([senzaPassword], async (opened) => {
    await assert.rejects(() => resolveConnection(''), (err) => {
      assert.match(err.message, /password/i);
      assert.match(err.message, /Orabridge/);
      return true;
    });
    assert.deepEqual(opened, [], 'non si deve tentare un collegamento senza credenziali');
  });
});

test('list_connections non fa uscire credenziali né dati di connessione', async () => {
  const text = await withFakeConnections([CONN_A, { ...CONN_B, connected: false }], () =>
    callTool('list_connections', {})
  );
  assert.match(text, /Collaudo WSS/);
  assert.match(text, /WSS/);
  assert.match(text, /19\.0\.0\.0\.0/);
  // Quella non collegata compare lo stesso: si collegherà da sé.
  assert.match(text, /Produzione/);
  assert.match(text, /si collega da sé/);
  // Utente Oracle, password e dati del servizio restano nell'applicazione.
  assert.ok(!text.includes('segretissima'), 'la password non deve comparire');
  assert.ok(!text.includes('WSS_ADMIN'), "l'utenza non deve comparire");
});

// ---- attività in tempo reale ----

test('ogni chiamata lascia una voce, dall\'inizio alla fine', async () => {
  await withFakeConnections([CONN_A], async () => {
    activity.reset();
    const visto = [];
    const off = activity.subscribe((e) => visto.push({ tool: e.tool, running: e.running, ok: e.ok }));
    // describe_table su un pool finto fallisce: quello che conta è che l'utente
    // veda la richiesta arrivare e il suo esito, non che vada a buon fine.
    await handleMessage(rpc('tools/call', { name: 'describe_table', arguments: { name: 'X' } }), mcpApi);
    off();
    assert.deepEqual(visto[0], { tool: 'describe_table', running: true, ok: undefined });
    assert.equal(visto.at(-1).running, false);
    const voce = activity.recent().at(-1);
    assert.equal(voce.connName, 'Collaudo WSS');
    assert.equal(typeof voce.ms, 'number');
  });
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
