import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

// Il ponte è il pezzo che gira fuori dal server, in un processo lanciato da
// VS Code: qui si prova per quello che è, un processo separato con cui si parla
// per righe su stdin/stdout. Se il framing o il file di scoperta si rompono,
// nell'app non si vede nulla — si vede solo che Copilot non ha strumenti.

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'orabridge-bridge-test-'));
process.env.PORT = '0';

const { startServer } = await import('../src/index.js');
const { settings } = await import('../src/settings.js');
const { ENDPOINT_FILE } = await import('../src/mcp/endpoint.js');

const BRIDGE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'electron',
  'mcp-bridge.cjs'
);

// Ponte avviato con la sola informazione che ha davvero: dove sta il file di
// scoperta. Porta e token li trova da solo.
function startBridge() {
  const proc = spawn(process.execPath, [BRIDGE], {
    env: { ...process.env, ORABRIDGE_MCP_ENDPOINT: ENDPOINT_FILE },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const answers = [];
  let buf = '';
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) answers.push(JSON.parse(line));
    }
  });
  return {
    answers,
    send: (msg) => proc.stdin.write(JSON.stringify(msg) + '\n'),
    async waitFor(n, ms = 8000) {
      const t0 = Date.now();
      while (answers.length < n && Date.now() - t0 < ms) {
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.ok(answers.length >= n, `attese ${n} risposte dal ponte, arrivate ${answers.length}`);
      return answers;
    },
    async stop() {
      proc.stdin.end();
      await new Promise((resolve) => {
        proc.once('exit', resolve);
        setTimeout(() => {
          proc.kill();
          resolve();
        }, 3000);
      });
      return proc.exitCode;
    },
  };
}

test('il ponte porta stdio fino al server e ritorno', async () => {
  settings.updateMcp({ enabled: true });
  const backend = await startServer({ port: 0, host: '127.0.0.1', token: 'tok-ponte' });
  const bridge = startBridge();
  try {
    assert.ok(fs.existsSync(ENDPOINT_FILE), 'il file di scoperta deve esistere a integrazione accesa');

    bridge.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
    bridge.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    bridge.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    bridge.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'list_connections', arguments: {} },
    });
    const answers = await bridge.waitFor(3);

    const byId = Object.fromEntries(answers.map((r) => [r.id, r]));
    assert.equal(byId[1].result.serverInfo.name, 'orabridge');
    assert.equal(byId[2].result.tools.length, 7);
    assert.ok(!byId[2].result.tools.some((t) => t.name === 'execute_sql'));
    assert.match(byId[3].result.content[0].text, /Nessuna connessione attiva/);
    // La notifica non deve produrre una riga in più.
    assert.equal(answers.length, 3);
  } finally {
    await bridge.stop();
    await backend.close();
  }
});

test('app chiusa: il ponte resta valido e spiega il problema invece di morire', async () => {
  const bridge = startBridge();
  try {
    // Nessun server in ascolto: il file di scoperta è stato rimosso alla chiusura.
    assert.equal(fs.existsSync(ENDPOINT_FILE), false);

    bridge.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
    bridge.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const answers = await bridge.waitFor(2);

    const byId = Object.fromEntries(answers.map((r) => [r.id, r]));
    // L'handshake risponde comunque: se fallisse, VS Code segnerebbe il server
    // come guasto e non riproverebbe più fino al ricaricamento della finestra.
    assert.ok(byId[1].result, "initialize deve riuscire anche con l'app chiusa");
    assert.match(byId[2].error.message, /Orabridge non è in esecuzione/);
  } finally {
    assert.equal(await bridge.stop(), 0, 'il ponte deve uscire pulito quando stdin si chiude');
  }
});
