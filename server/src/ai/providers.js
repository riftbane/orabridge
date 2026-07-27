// Adattatori per le piattaforme AI supportate.
//
// Formato interno dei messaggi (stile Anthropic, il più espressivo dei tre):
//   { role: 'user' | 'assistant', content: [ blocco… ] }
//   blocco = { type: 'text', text }
//          | { type: 'tool_use', id, name, input }
//          | { type: 'tool_result', toolUseId, content, isError }
//
// `stream()` è un generatore asincrono che emette:
//   { type: 'text', text }              porzione di risposta testuale
//   { type: 'tool_use', id, name, input } chiamata a uno strumento completa
//   { type: 'done', stopReason, usage }  fine del turno
//
// Niente SDK: solo fetch nativo, così il server resta senza dipendenze extra.

const ANTHROPIC_VERSION = '2023-06-01';

export const PROVIDER_INFO = {
  openrouter: {
    label: 'OpenRouter',
    keyLabel: 'API key OpenRouter',
    keyHint: 'Chiave che inizia con sk-or-… (openrouter.ai/keys)',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    liveModels: true,
  },
  anthropic: {
    label: 'Anthropic',
    keyLabel: 'API key Anthropic',
    keyHint: 'Chiave che inizia con sk-ant-… (console.anthropic.com)',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    liveModels: true,
  },
  google: {
    label: 'Google Gemini',
    keyLabel: 'API key Google AI Studio',
    keyHint: 'Chiave generata da aistudio.google.com/apikey',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    liveModels: true,
  },
  openai: {
    label: 'OpenAI',
    keyLabel: 'API key OpenAI',
    keyHint: 'Chiave che inizia con sk-… (platform.openai.com/api-keys)',
    defaultBaseUrl: 'https://api.openai.com/v1',
    liveModels: true,
  },
};

// Modelli proposti quando l'elenco in tempo reale non è disponibile
// (nessuna chiave inserita, oppure endpoint non raggiungibile).
const FALLBACK_MODELS = {
  anthropic: [
    { id: 'claude-opus-5', label: 'Claude Opus 5' },
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  ],
  openai: [
    { id: 'gpt-5', label: 'gpt-5' },
    { id: 'gpt-5-mini', label: 'gpt-5-mini' },
    { id: 'gpt-4.1', label: 'gpt-4.1' },
  ],
  google: [
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  ],
  openrouter: [],
};

export function fallbackModels(provider) {
  return FALLBACK_MODELS[provider] || [];
}

function baseFor(provider, custom) {
  return (custom || PROVIDER_INFO[provider].defaultBaseUrl).replace(/\/+$/, '');
}

async function failure(res) {
  let detail = '';
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text);
      detail = j.error?.message || j.error?.type || j.message || text;
    } catch {
      detail = text;
    }
  } catch {
    /* corpo non leggibile */
  }
  detail = String(detail || '').slice(0, 500);
  const err = new Error(`HTTP ${res.status}${detail ? ` — ${detail}` : ''}`);
  err.status = res.status;
  return err;
}

// ---- lettura SSE da una risposta fetch ----
async function* sseEvents(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let event = { name: null, data: [] };
  const flush = () => {
    const out = event.data.length ? { name: event.name, data: event.data.join('\n') } : null;
    event = { name: null, data: [] };
    return out;
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, '');
      buf = buf.slice(idx + 1);
      if (!line) {
        const ev = flush();
        if (ev) yield ev;
      } else if (line.startsWith('event:')) {
        event.name = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        event.data.push(line.slice(5).replace(/^ /, ''));
      }
    }
  }
  const ev = flush();
  if (ev) yield ev;
}

const parse = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

const parseArgs = (s) => {
  if (!s) return {};
  const v = parse(s);
  return v && typeof v === 'object' ? v : {};
};

// ================= Anthropic =================

function anthropicMessages(messages) {
  return messages.map((m) => ({
    role: m.role,
    content: m.content.map((b) => {
      if (b.type === 'tool_use') return { type: 'tool_use', id: b.id, name: b.name, input: b.input || {} };
      if (b.type === 'tool_result') {
        return {
          type: 'tool_result',
          tool_use_id: b.toolUseId,
          content: b.content,
          ...(b.isError ? { is_error: true } : {}),
        };
      }
      return { type: 'text', text: b.text };
    }),
  }));
}

const anthropic = {
  async listModels({ apiKey, baseUrl }) {
    if (!apiKey) return fallbackModels('anthropic');
    const res = await fetch(`${baseFor('anthropic', baseUrl)}/models?limit=100`, {
      headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
    });
    if (!res.ok) throw await failure(res);
    const data = await res.json();
    return (data.data || []).map((m) => ({
      id: m.id,
      label: m.display_name || m.id,
      context: m.max_input_tokens || null,
    }));
  },

  async *stream({ apiKey, baseUrl }, { model, system, messages, tools, maxTokens, signal }) {
    const res = await fetch(`${baseFor('anthropic', baseUrl)}/messages`, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        stream: true,
        system,
        messages: anthropicMessages(messages),
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
        })),
      }),
    });
    if (!res.ok) throw await failure(res);

    const blocks = new Map(); // index -> { id, name, json }
    let stopReason = null;
    let usage = null;
    for await (const ev of sseEvents(res)) {
      const d = parse(ev.data);
      if (!d) continue;
      if (d.type === 'error') throw new Error(d.error?.message || 'Errore dal provider');
      if (d.type === 'content_block_start' && d.content_block?.type === 'tool_use') {
        blocks.set(d.index, { id: d.content_block.id, name: d.content_block.name, json: '' });
      } else if (d.type === 'content_block_delta') {
        if (d.delta?.type === 'text_delta' && d.delta.text) {
          yield { type: 'text', text: d.delta.text };
        } else if (d.delta?.type === 'input_json_delta') {
          const b = blocks.get(d.index);
          if (b) b.json += d.delta.partial_json || '';
        }
      } else if (d.type === 'content_block_stop') {
        const b = blocks.get(d.index);
        if (b) {
          blocks.delete(d.index);
          yield { type: 'tool_use', id: b.id, name: b.name, input: parseArgs(b.json) };
        }
      } else if (d.type === 'message_delta') {
        if (d.delta?.stop_reason) stopReason = d.delta.stop_reason;
        if (d.usage) {
          usage = {
            input: d.usage.input_tokens ?? null,
            output: d.usage.output_tokens ?? null,
          };
        }
      }
    }
    yield { type: 'done', stopReason, usage };
  },
};

// ============ OpenAI e compatibili (OpenRouter) ============

function openaiMessages(system, messages) {
  const out = system ? [{ role: 'system', content: system }] : [];
  for (const m of messages) {
    if (m.role === 'assistant') {
      const text = m.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      const calls = m.content.filter((b) => b.type === 'tool_use');
      const msg = { role: 'assistant', content: text || null };
      if (calls.length) {
        msg.tool_calls = calls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.input || {}) },
        }));
      }
      out.push(msg);
      continue;
    }
    // Un turno utente può contenere sia risultati di tool sia testo:
    // i primi diventano messaggi `tool` distinti, il resto un messaggio utente.
    for (const b of m.content.filter((x) => x.type === 'tool_result')) {
      out.push({ role: 'tool', tool_call_id: b.toolUseId, content: b.content });
    }
    const text = m.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    if (text) out.push({ role: 'user', content: text });
  }
  return out;
}

function openaiCompatible(provider) {
  return {
    async listModels({ apiKey, baseUrl }) {
      const headers = { accept: 'application/json' };
      if (apiKey) headers.authorization = `Bearer ${apiKey}`;
      if (provider === 'openai' && !apiKey) return fallbackModels('openai');
      const res = await fetch(`${baseFor(provider, baseUrl)}/models`, { headers });
      if (!res.ok) throw await failure(res);
      const data = await res.json();
      let list = (data.data || []).map((m) => ({
        id: m.id,
        label: m.name || m.id,
        context: m.context_length || m.top_provider?.context_length || null,
        // OpenRouter espone il prezzo per token: utile per scegliere.
        price: m.pricing ? Number(m.pricing.prompt) || 0 : null,
      }));
      if (provider === 'openai') {
        // L'elenco OpenAI contiene anche embedding, audio e immagini.
        list = list.filter((m) => /^(gpt|o\d|chatgpt)/i.test(m.id) && !/(audio|realtime|image|tts|transcribe|embedding|moderation)/i.test(m.id));
      }
      return list.sort((a, b) => a.id.localeCompare(b.id));
    },

    async *stream({ apiKey, baseUrl }, { model, system, messages, tools, signal }) {
      const headers = {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      };
      if (provider === 'openrouter') {
        headers['HTTP-Referer'] = 'https://github.com/riftbane/orabridge';
        headers['X-Title'] = 'Orabridge';
      }
      const res = await fetch(`${baseFor(provider, baseUrl)}/chat/completions`, {
        method: 'POST',
        signal,
        headers,
        body: JSON.stringify({
          model,
          stream: true,
          messages: openaiMessages(system, messages),
          ...(tools.length
            ? {
                tools: tools.map((t) => ({
                  type: 'function',
                  function: { name: t.name, description: t.description, parameters: t.parameters },
                })),
              }
            : {}),
        }),
      });
      if (!res.ok) throw await failure(res);

      const calls = new Map(); // index -> { id, name, args }
      let stopReason = null;
      let usage = null;
      for await (const ev of sseEvents(res)) {
        if (ev.data === '[DONE]') break;
        const d = parse(ev.data);
        if (!d) continue;
        if (d.error) throw new Error(d.error.message || 'Errore dal provider');
        if (d.usage) {
          usage = { input: d.usage.prompt_tokens ?? null, output: d.usage.completion_tokens ?? null };
        }
        const choice = d.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) stopReason = choice.finish_reason;
        const delta = choice.delta || {};
        if (delta.content) yield { type: 'text', text: delta.content };
        for (const tc of delta.tool_calls || []) {
          const idx = tc.index ?? 0;
          const cur = calls.get(idx) || { id: tc.id, name: '', args: '' };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name += tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          calls.set(idx, cur);
        }
      }
      for (const [idx, c] of [...calls.entries()].sort((a, b) => a[0] - b[0])) {
        yield {
          type: 'tool_use',
          id: c.id || `call_${idx}_${Date.now()}`,
          name: c.name,
          input: parseArgs(c.args),
        };
      }
      yield { type: 'done', stopReason, usage };
    },
  };
}

// ================= Google Gemini =================

// Lo schema di Gemini è un sottoinsieme di JSON Schema: le chiavi non
// riconosciute fanno fallire la richiesta, quindi si ripulisce.
function geminiSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(geminiSchema);
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'additionalProperties' || k === '$schema' || k === 'default') continue;
    if (k === 'properties') {
      out.properties = Object.fromEntries(
        Object.entries(v).map(([name, sub]) => [name, geminiSchema(sub)])
      );
    } else if (k === 'items') {
      out.items = geminiSchema(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function geminiContents(messages) {
  const out = [];
  for (const m of messages) {
    const parts = [];
    for (const b of m.content) {
      if (b.type === 'text') parts.push({ text: b.text });
      else if (b.type === 'tool_use') parts.push({ functionCall: { name: b.name, args: b.input || {} } });
      else if (b.type === 'tool_result') {
        parts.push({
          functionResponse: { name: b.toolName || b.toolUseId, response: { result: b.content } },
        });
      }
    }
    if (parts.length) out.push({ role: m.role === 'assistant' ? 'model' : 'user', parts });
  }
  return out;
}

const google = {
  async listModels({ apiKey, baseUrl }) {
    if (!apiKey) return fallbackModels('google');
    const res = await fetch(`${baseFor('google', baseUrl)}/models?pageSize=200`, {
      headers: { 'x-goog-api-key': apiKey },
    });
    if (!res.ok) throw await failure(res);
    const data = await res.json();
    return (data.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => ({
        id: String(m.name || '').replace(/^models\//, ''),
        label: m.displayName || m.name,
        context: m.inputTokenLimit || null,
      }));
  },

  async *stream({ apiKey, baseUrl }, { model, system, messages, tools, maxTokens, signal }) {
    const url = `${baseFor('google', baseUrl)}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
    const res = await fetch(url, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: geminiContents(messages),
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        ...(tools.length
          ? {
              tools: [
                {
                  functionDeclarations: tools.map((t) => ({
                    name: t.name,
                    description: t.description,
                    parameters: geminiSchema(t.parameters),
                  })),
                },
              ],
            }
          : {}),
        generationConfig: { maxOutputTokens: maxTokens },
      }),
    });
    if (!res.ok) throw await failure(res);

    let stopReason = null;
    let usage = null;
    let n = 0;
    for await (const ev of sseEvents(res)) {
      const d = parse(ev.data);
      if (!d) continue;
      if (d.error) throw new Error(d.error.message || 'Errore dal provider');
      if (d.usageMetadata) {
        usage = {
          input: d.usageMetadata.promptTokenCount ?? null,
          output: d.usageMetadata.candidatesTokenCount ?? null,
        };
      }
      const cand = d.candidates?.[0];
      if (!cand) continue;
      if (cand.finishReason) stopReason = cand.finishReason;
      for (const part of cand.content?.parts || []) {
        if (part.text) yield { type: 'text', text: part.text };
        else if (part.functionCall) {
          yield {
            type: 'tool_use',
            // Gemini non assegna un id alle chiamate: se ne genera uno stabile
            // per il turno, e l'accoppiamento con la risposta avviene sul nome.
            id: `gcall_${Date.now()}_${n++}`,
            name: part.functionCall.name,
            input: part.functionCall.args || {},
          };
        }
      }
    }
    yield { type: 'done', stopReason, usage };
  },
};

export const providers = {
  anthropic,
  google,
  openai: openaiCompatible('openai'),
  openrouter: openaiCompatible('openrouter'),
};
