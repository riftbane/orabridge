import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

// Il modulo legge cartella dati e porta all'import: vanno impostate prima.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'orabridge-test-'));
process.env.PORT = '0';
const { startServer } = await import('../src/index.js');

const TOKEN = 'token-di-prova';

// fetch() non lascia scegliere l'header Host: qui serve, per il DNS rebinding.
function request(port, { method = 'GET', path: p = '/api/connections', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (text += chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function withServer(options, fn) {
  const backend = await startServer({ port: 0, host: '127.0.0.1', ...options });
  try {
    await fn(backend);
  } finally {
    await backend.close();
  }
}

test('PORT=0 significa porta effimera, non 3000', async () => {
  const backend = await startServer();
  try {
    assert.ok(backend.port > 0, 'il server deve aver ricevuto una porta dal sistema');
    assert.notEqual(backend.port, 3000);
  } finally {
    await backend.close();
  }
});

test('app desktop: senza token la API non risponde', async () => {
  await withServer({ token: TOKEN }, async ({ port }) => {
    const res = await request(port);
    assert.equal(res.status, 403);
    assert.match(res.text, /app Orabridge/);
  });
});

test('app desktop: token sbagliato rifiutato, token giusto ammesso', async () => {
  await withServer({ token: TOKEN }, async ({ port }) => {
    const ko = await request(port, { headers: { 'X-Orabridge-Token': 'altro' } });
    assert.equal(ko.status, 403);

    const ok = await request(port, { headers: { 'X-Orabridge-Token': TOKEN } });
    assert.equal(ok.status, 200);
    assert.deepEqual(JSON.parse(ok.text), []);
  });
});

test('app desktop: il browser che apre l\'indirizzo vede la pagina di cortesia', async () => {
  await withServer({ token: TOKEN }, async ({ port }) => {
    const res = await request(port, { path: '/', headers: { Accept: 'text/html' } });
    assert.equal(res.status, 403);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.match(res.text, /Orabridge è già aperto/);
  });
});

test('deployment web: senza token configurato non si chiede nulla', async () => {
  await withServer({}, async ({ port }) => {
    const res = await request(port);
    assert.equal(res.status, 200);
  });
});

test('Host che non è il loopback rifiutato (DNS rebinding)', async () => {
  await withServer({ token: TOKEN }, async ({ port }) => {
    const res = await request(port, {
      headers: { Host: 'orabridge.example.com', 'X-Orabridge-Token': TOKEN },
    });
    assert.equal(res.status, 403);
    assert.match(res.text, /Host non consentito/);
  });
});

test('scritture: Origin di un altro sito rifiutato, quello della app ammesso', async () => {
  await withServer({}, async ({ port }) => {
    const post = (origin) =>
      request(port, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': '2',
          Origin: origin,
        },
        body: '{}',
      });

    const ko = await post('https://sito-cattivo.example');
    assert.equal(ko.status, 403);
    assert.match(ko.text, /cross-site/);

    // Stessa origine: passa i controlli e arriva alla validazione della rotta.
    const ok = await post(`http://127.0.0.1:${port}`);
    assert.equal(ok.status, 400);
    assert.match(ok.text, /obbligatori/);
  });
});
