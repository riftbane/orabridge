// Consumo di una chiamata al modello, in una forma sola per tutte le
// piattaforme. Ogni provider conta a modo suo: qui si normalizza in modo che
// le voci non si sovrappongano mai e la somma sia il totale dei token.
//
//   input      token del prompt pagati pieni (cache esclusa)
//   cacheRead  token letti dalla cache del prompt (costano meno)
//   cacheWrite token scritti in cache (costano più, si ammortizzano dopo)
//   output     token generati, ragionamento compreso
//   reasoning  quota di `output` spesa a ragionare (sottoinsieme, non si somma)
//   cost       costo in dollari, solo se la piattaforma lo dichiara (OpenRouter)
//   calls      numero di chiamate al modello aggregate in questo conteggio

export const TOKEN_KEYS = ['input', 'cacheRead', 'cacheWrite', 'output'];
const KEYS = [...TOKEN_KEYS, 'reasoning', 'cost', 'calls'];

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export const emptyUsage = () => ({
  input: 0,
  cacheRead: 0,
  cacheWrite: 0,
  output: 0,
  reasoning: 0,
  cost: 0,
  calls: 0,
});

export function normalizeUsage(u) {
  const out = emptyUsage();
  if (!u || typeof u !== 'object') return out;
  for (const k of KEYS) out[k] = num(u[k]);
  return out;
}

export function addUsage(a, b) {
  const out = normalizeUsage(a);
  const add = normalizeUsage(b);
  for (const k of KEYS) out[k] += add[k];
  // Il costo arriva in dollari con molti decimali: senza arrotondamento la
  // somma si porta dietro l'errore del virgola mobile.
  out.cost = Math.round(out.cost * 1e8) / 1e8;
  return out;
}

// I conteggi che una piattaforma manda a più riprese sono fotografie
// progressive dello stesso turno, non pezzi da sommare: si tiene il massimo.
export function maxUsage(a, b) {
  const cur = normalizeUsage(a);
  const next = normalizeUsage(b);
  for (const k of KEYS) cur[k] = Math.max(cur[k], next[k]);
  return cur;
}

export const usageTokens = (u) => TOKEN_KEYS.reduce((sum, k) => sum + num(u?.[k]), 0);

export const isEmptyUsage = (u) => usageTokens(u) === 0 && !num(u?.cost);

// ---- traduzione dai formati delle piattaforme ----

// Anthropic tiene la cache fuori da `input_tokens`: le tre voci vanno sommate
// per avere il prompt intero.
export const anthropicUsage = (raw) =>
  raw
    ? normalizeUsage({
        input: raw.input_tokens,
        cacheRead: raw.cache_read_input_tokens,
        cacheWrite: raw.cache_creation_input_tokens,
        output: raw.output_tokens,
      })
    : null;

// OpenAI e compatibili: `prompt_tokens` comprende già i token serviti dalla
// cache, quindi si scorporano per non contarli due volte.
export function openaiUsage(raw) {
  if (!raw) return null;
  const cacheRead = num(raw.prompt_tokens_details?.cached_tokens);
  const cacheWrite = num(
    raw.prompt_tokens_details?.cache_creation_tokens ?? raw.cache_creation_input_tokens
  );
  return normalizeUsage({
    input: Math.max(0, num(raw.prompt_tokens) - cacheRead - cacheWrite),
    cacheRead,
    cacheWrite,
    output: raw.completion_tokens,
    reasoning: raw.completion_tokens_details?.reasoning_tokens,
    // Solo OpenRouter lo dichiara: è il credito effettivamente scalato.
    cost: raw.cost,
  });
}

// Gemini: `promptTokenCount` comprende la cache, `candidatesTokenCount` invece
// esclude i token di ragionamento, che arrivano contati a parte.
export function geminiUsage(raw) {
  if (!raw) return null;
  const cacheRead = num(raw.cachedContentTokenCount);
  const reasoning = num(raw.thoughtsTokenCount);
  return normalizeUsage({
    input: Math.max(0, num(raw.promptTokenCount) - cacheRead),
    cacheRead,
    output: num(raw.candidatesTokenCount) + reasoning,
    reasoning,
  });
}
