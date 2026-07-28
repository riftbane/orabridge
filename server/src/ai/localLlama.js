// Ponte verso llama.cpp (node-llama-cpp).
//
// Due accortezze importanti:
//   * l'import è dinamico e protetto. Il pacchetto porta con sé binari nativi
//     compilati per la piattaforma: nell'app desktop ci sono sempre, ma il
//     server gira anche in Docker o a mano, e lì un import mancato non deve
//     impedire l'avvio di tutto Orabridge.
//   * il modello resta caricato tra un turno e l'altro. Caricare 3 GB da disco
//     richiede decine di secondi: rifarlo a ogni messaggio renderebbe la cosa
//     inutilizzabile.

import { catalogEntry, installedPath } from './localModels.js';

let llamaPromise = null;
let loaded = null; // { id, model, context, chat }

async function llamaCpp() {
  // `build: 'never'`: sul computer dell'utente non ci sono gli strumenti di
  // compilazione, e non li vogliamo. O ci sono i binari già pronti o niente.
  if (!llamaPromise) {
    llamaPromise = import('node-llama-cpp')
      .then(async (mod) => ({ mod, llama: await mod.getLlama({ build: 'never' }) }))
      .catch((err) => {
        llamaPromise = null;
        throw new Error(
          `Il motore per i modelli locali non è disponibile su questa installazione (${err.message}).`
        );
      });
  }
  return llamaPromise;
}

export async function isAvailable() {
  try {
    await llamaCpp();
    return true;
  } catch {
    return false;
  }
}

export async function dispose() {
  if (!loaded) return;
  const cur = loaded;
  loaded = null;
  for (const part of [cur.context, cur.model]) {
    try {
      await part?.dispose();
    } catch {
      /* già chiuso, o chiuso male: in ogni caso non lo useremo più */
    }
  }
}

// Orabridge fa girare più sessioni in parallelo, ma qui il modello è uno solo,
// con una sola sequenza di contesto: due generazioni insieme si
// calpesterebbero i token a vicenda (e cambiare modello mentre l'altro genera
// libererebbe la memoria sotto i piedi). Le richieste locali si mettono quindi
// in fila; le sessioni sugli altri provider non ne risentono.
let queueTail = Promise.resolve();

function inLine(fn) {
  // `then(fn, fn)`: il turno parte anche se il precedente è fallito.
  const run = queueTail.then(fn, fn);
  queueTail = run.then(
    () => {},
    () => {}
  );
  return run;
}

// Carica il modello richiesto, riusando quello già in memoria se coincide.
async function ensureLoaded(id, onStage) {
  if (loaded?.id === id) return loaded;
  const entry = catalogEntry(id);
  if (!entry) throw new Error(`Modello locale sconosciuto: ${id}`);
  const file = installedPath(id);
  if (!file) {
    throw new Error(`Il modello «${entry.label}» non è ancora stato scaricato: scaricalo dalle impostazioni.`);
  }

  await dispose();
  onStage?.(`carico ${entry.label} in memoria`);
  const { mod, llama } = await llamaCpp();
  const model = await llama.loadModel({ modelPath: file });
  const context = await model.createContext({ contextSize: entry.contextSize });
  const chat = new mod.LlamaChat({
    contextSequence: context.getSequence(),
    // Senza wrapper esplicito node-llama-cpp legge il template Jinja dentro il
    // GGUF; per i modelli senza token nativi di tool call (Gemma è fra questi)
    // aggiunge da sé una sintassi testuale per le chiamate a strumento.
    chatWrapper: 'auto',
  });
  loaded = { id, model, context, chat };
  return loaded;
}

// ---- traduzione degli schemi ----

// llama.cpp costruisce una grammatica dallo schema e obbliga il modello a
// rispettarla. La grammatica però pretende *tutte* le proprietà dichiarate:
// `required` viene ignorato. Se lasciassimo così, per `list_objects` il modello
// dovrebbe inventarsi anche `owner` e `like`. Le proprietà facoltative
// diventano quindi «o null o il valore», e i null si tolgono dopo.
export function gbnfParams(schema) {
  if (!schema || schema.type !== 'object') return { type: 'object', properties: {} };
  const required = new Set(schema.required || []);
  const properties = {};
  for (const [name, sub] of Object.entries(schema.properties || {})) {
    const clean = gbnfValue(sub);
    properties[name] = required.has(name)
      ? clean
      : {
          oneOf: [{ type: 'null' }, clean],
          description: `${sub.description ? `${sub.description}. ` : ''}Facoltativo: usa null se non serve.`,
        };
  }
  return { type: 'object', properties };
}

function gbnfValue(sub) {
  if (!sub || typeof sub !== 'object') return { type: 'string' };
  if (sub.enum) return { enum: sub.enum, ...(sub.description ? { description: sub.description } : {}) };
  if (sub.type === 'array') return { type: 'array', items: gbnfValue(sub.items) };
  if (sub.type === 'object') return gbnfParams(sub);
  const type = ['string', 'number', 'integer', 'boolean'].includes(sub.type) ? sub.type : 'string';
  return { type, ...(sub.description ? { description: sub.description } : {}) };
}

// I null messi per far quadrare la grammatica non devono arrivare agli
// strumenti, che si aspettano il parametro assente.
export function stripNulls(params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return params || {};
  const out = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined) continue;
    out[k] = v;
  }
  return out;
}

// ---- traduzione della conversazione ----

// Il formato interno di Orabridge (stile Anthropic) verso quello di
// node-llama-cpp: una chiamata a strumento e il suo esito, che da noi stanno in
// due messaggi diversi, lì vanno riuniti in un solo blocco `functionCall`.
export function toChatHistory(system, messages) {
  const results = new Map(); // toolUseId -> contenuto dell'esito
  for (const m of messages) {
    for (const b of m.content || []) {
      if (b.type === 'tool_result') results.set(b.toolUseId, b);
    }
  }

  const history = [];
  if (system) history.push({ type: 'system', text: system });

  for (const m of messages) {
    const blocks = m.content || [];
    if (m.role === 'assistant') {
      const response = [];
      for (const b of blocks) {
        if (b.type === 'text' && b.text) response.push(b.text);
        else if (b.type === 'tool_use') {
          const res = results.get(b.id);
          response.push({
            type: 'functionCall',
            name: b.name,
            params: b.input || {},
            // Una chiamata senza esito (turno interrotto) resterebbe "aperta" e
            // manderebbe fuori strada il modello: si dichiara come fallita.
            result: res ? res.content : 'Operazione interrotta senza esito.',
          });
        }
      }
      if (response.length) history.push({ type: 'model', response });
      continue;
    }
    // Gli esiti degli strumenti sono già finiti dentro il messaggio del modello:
    // dal turno utente resta solo il testo scritto davvero dall'utente.
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    if (text) history.push({ type: 'user', text });
  }
  return history;
}

// ---- generazione ----

// `LlamaChat.generateResponse` è a callback e restituisce tutto alla fine,
// mentre il resto di Orabridge consuma un generatore asincrono. Qui si fa da
// tramite con una coda: i pezzi di testo escono mentre vengono prodotti.
function chunkQueue() {
  const items = [];
  let notify = null;
  let done = false;
  return {
    push(item) {
      items.push(item);
      notify?.();
      notify = null;
    },
    close() {
      done = true;
      notify?.();
      notify = null;
    },
    async *drain() {
      for (;;) {
        while (items.length) yield items.shift();
        if (done) return;
        await new Promise((resolve) => {
          notify = resolve;
        });
      }
    },
  };
}

const STOP_REASON = {
  maxTokens: 'max_tokens',
  functionCalls: 'tool_use',
  eogToken: 'end_turn',
  stopGenerationTrigger: 'end_turn',
  customStopTrigger: 'end_turn',
  abort: 'abort',
};

// Su CPU ogni token costa: chiederne 8192 come ai provider online significa
// aspettare mezz'ora. Oltre questa soglia la risposta non è più una risposta.
const LOCAL_MAX_OUTPUT = 2048;

export async function* generate({ model: modelId, system, messages, tools, maxTokens, signal }) {
  const queue = chunkQueue();
  // Caricare tre gigabyte da disco richiede decine di secondi, e in quel tempo
  // non esce un solo token: senza un battito la guardia sullo stream
  // dichiarerebbe la sessione piantata. Il lavoro pesante gira quindi a parte e
  // alimenta la coda, mentre il generatore la svuota già da subito.
  const heartbeat = setInterval(() => queue.push({ type: 'ping' }), 5000);

  const work = inLine(async () => {
    const session = await ensureLoaded(modelId, () => queue.push({ type: 'ping' }));

    const functions = {};
    for (const t of tools) {
      functions[t.name] = { description: t.description, params: gbnfParams(t.parameters) };
    }

    // Il contatore della sequenza è cumulativo: la differenza prima/dopo dà i
    // token di questo turno. Sui turni successivi il prefisso già in cache non
    // viene rielaborato, e infatti non finisce nel conteggio.
    const meter = session.chat.sequence.tokenMeter;
    const before = meter.getState();

    const res = await session.chat.generateResponse(toChatHistory(system, messages), {
      maxTokens: Math.min(maxTokens || LOCAL_MAX_OUTPUT, LOCAL_MAX_OUTPUT),
      signal,
      // Lo Stop dell'utente deve restituire quel che c'è, non far esplodere il turno.
      stopOnAbortSignal: true,
      ...(tools.length ? { functions } : {}),
      onTextChunk: (text) => queue.push({ type: 'text', text }),
    });
    return { res, spent: meter.diff(before) };
  })
    .then((ok) => ({ ok }))
    .catch((err) => ({ err }))
    .finally(() => {
      clearInterval(heartbeat);
      queue.close();
    });

  for await (const item of queue.drain()) yield item;

  const { ok, err } = await work;
  if (err) throw err;

  let n = 0;
  for (const call of ok.res.functionCalls || []) {
    yield {
      type: 'tool_use',
      // llama.cpp non assegna un id alle chiamate: se ne conia uno stabile per
      // il turno, come già si fa con Gemini.
      id: `local_${Date.now()}_${n++}`,
      name: call.functionName,
      input: stripNulls(call.params),
    };
  }

  const stop = ok.res.metadata?.stopReason;
  yield {
    type: 'done',
    stopReason: STOP_REASON[stop] || stop || null,
    usage: {
      input: ok.spent.usedInputTokens,
      output: ok.spent.usedOutputTokens,
      // Gira in casa: non costa nulla, ed è il senso di tutta la funzione.
      cost: 0,
      calls: 1,
    },
  };
}
