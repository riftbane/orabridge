import test from 'node:test';
import assert from 'node:assert/strict';
import { sealMessages } from '../src/ai/toolPairing.js';

const assistant = (...calls) => ({
  role: 'assistant',
  content: calls.map((c) => ({ type: 'tool_use', id: c, name: 'run_query', input: {} })),
});
const results = (...ids) => ({
  role: 'user',
  content: ids.map((id) => ({ type: 'tool_result', toolUseId: id, content: 'ok' })),
});
const user = (text) => ({ role: 'user', content: [{ type: 'text', text }] });

test('conversazione già completa: nessuna modifica', () => {
  const msgs = [user('ciao'), assistant('a'), results('a')];
  assert.equal(sealMessages(msgs, 'interrotto'), null);
});

test('chiamata senza esito: viene chiusa subito dopo il messaggio che la apre', () => {
  const msgs = [user('ciao'), assistant('a')];
  const out = sealMessages(msgs, 'interrotto');
  assert.equal(out.length, 3);
  assert.equal(out[2].role, 'user');
  assert.deepEqual(out[2].content, [
    {
      type: 'tool_result',
      toolUseId: 'a',
      toolName: 'run_query',
      content: 'interrotto',
      isError: true,
    },
  ]);
});

test('solo le chiamate scoperte vengono chiuse', () => {
  const msgs = [assistant('a', 'b'), results('a')];
  const out = sealMessages(msgs, 'interrotto');
  assert.equal(out.length, 3);
  // Il tappo va prima dei risultati veri, subito dopo il messaggio assistente.
  assert.deepEqual(
    out[1].content.map((b) => b.toolUseId),
    ['b']
  );
  assert.equal(out[2], msgs[1]);
});

test('più turni interrotti: ognuno viene chiuso al posto giusto', () => {
  const msgs = [assistant('a'), user('cambio idea'), assistant('b')];
  const out = sealMessages(msgs, 'interrotto');
  assert.deepEqual(
    out.map((m) => m.content[0].type),
    ['tool_use', 'tool_result', 'text', 'tool_use', 'tool_result']
  );
});
