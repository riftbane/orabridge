import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addUsage,
  anthropicUsage,
  emptyUsage,
  geminiUsage,
  isEmptyUsage,
  maxUsage,
  normalizeUsage,
  openaiUsage,
  usageTokens,
} from '../src/ai/usage.js';

test('normalizeUsage: valori mancanti o assurdi diventano zero', () => {
  assert.deepEqual(normalizeUsage(null), emptyUsage());
  assert.deepEqual(normalizeUsage({ input: -5, output: 'x', cost: null }), emptyUsage());
  assert.equal(normalizeUsage({ input: 10, sconosciuto: 99 }).input, 10);
  assert.equal(normalizeUsage({ input: 10 }).sconosciuto, undefined);
});

test('addUsage somma voce per voce e non sbanda sui decimali del costo', () => {
  const a = addUsage({ input: 10, output: 3, cost: 0.1, calls: 1 }, { input: 5, cost: 0.2, calls: 1 });
  assert.equal(a.input, 15);
  assert.equal(a.output, 3);
  assert.equal(a.cost, 0.3);
  assert.equal(a.calls, 2);
});

test('maxUsage tiene la fotografia più avanzata, non la somma', () => {
  const start = { input: 1000, cacheRead: 200, output: 2 };
  const end = { output: 350 };
  const u = maxUsage(start, end);
  assert.equal(u.input, 1000);
  assert.equal(u.cacheRead, 200);
  assert.equal(u.output, 350);
});

test('usageTokens: il ragionamento è già dentro output e non si conta due volte', () => {
  const u = normalizeUsage({ input: 100, cacheRead: 50, cacheWrite: 10, output: 40, reasoning: 30 });
  assert.equal(usageTokens(u), 200);
});

test('isEmptyUsage: un turno senza token ma con un costo non è vuoto', () => {
  assert.equal(isEmptyUsage(emptyUsage()), true);
  assert.equal(isEmptyUsage({ calls: 1 }), true);
  assert.equal(isEmptyUsage({ cost: 0.002 }), false);
  assert.equal(isEmptyUsage({ output: 1 }), false);
});

test('Anthropic: la cache sta fuori dai token di input', () => {
  const u = anthropicUsage({
    input_tokens: 120,
    cache_read_input_tokens: 900,
    cache_creation_input_tokens: 300,
    output_tokens: 45,
  });
  assert.equal(u.input, 120);
  assert.equal(u.cacheRead, 900);
  assert.equal(u.cacheWrite, 300);
  assert.equal(usageTokens(u), 1365);
});

test('OpenAI: i token serviti dalla cache si scorporano dal prompt', () => {
  const u = openaiUsage({
    prompt_tokens: 1500,
    completion_tokens: 200,
    prompt_tokens_details: { cached_tokens: 1024 },
    completion_tokens_details: { reasoning_tokens: 64 },
  });
  assert.equal(u.input, 476);
  assert.equal(u.cacheRead, 1024);
  assert.equal(u.output, 200);
  assert.equal(u.reasoning, 64);
  // Il totale resta quello dichiarato dalla piattaforma: 1500 + 200.
  assert.equal(usageTokens(u), 1700);
});

test('OpenRouter: il costo in crediti arriva con il conteggio', () => {
  assert.equal(openaiUsage({ prompt_tokens: 10, completion_tokens: 2, cost: 0.00042 }).cost, 0.00042);
});

test('Gemini: la cache sta dentro il prompt, il ragionamento fuori dall output', () => {
  const u = geminiUsage({
    promptTokenCount: 1200,
    cachedContentTokenCount: 800,
    candidatesTokenCount: 150,
    thoughtsTokenCount: 90,
  });
  assert.equal(u.input, 400);
  assert.equal(u.cacheRead, 800);
  assert.equal(u.output, 240);
  assert.equal(u.reasoning, 90);
  assert.equal(usageTokens(u), 1440);
});

test('conteggio assente: nessun oggetto da sommare', () => {
  assert.equal(anthropicUsage(null), null);
  assert.equal(openaiUsage(undefined), null);
  assert.equal(geminiUsage(null), null);
});
