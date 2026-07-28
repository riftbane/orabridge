import crypto from 'crypto';
import path from 'path';
import { DATA_DIR, readJson, writeJson } from '../secret.js';
import { settings } from '../settings.js';
import { pools } from '../pools.js';
import { providers } from './providers.js';
import { LEVEL_LABEL } from './sqlGuard.js';
import { requiredPermission, runTool, toolSchemas, ToolError } from './tools.js';
import { sealMessages } from './toolPairing.js';

const FILE = path.join(DATA_DIR, 'ai-sessions.json');
const MAX_STEPS = 40; // giri modello→strumenti prima di fermarsi da soli
const MAX_TOKENS = 8192;
const MAX_SESSIONS = 100;
// Silenzio massimo tollerato dalla piattaforma AI: oltre, il turno resterebbe
// "in esecuzione" per sempre e la sessione sembrerebbe piantata.
const STREAM_IDLE_MS = 120_000;

// id -> AbortController del turno in corso (non serializzabile, resta in RAM).
const running = new Map();
// id -> Set(res) dei client in ascolto sullo stream SSE.
const listeners = new Map();

let sessions = load();

function load() {
  const list = readJson(FILE, []);
  // Un turno interrotto da un riavvio non può riprendere da solo: si riporta la
  // sessione a riposo e si chiudono le chiamate rimaste senza risposta, così il
  // messaggio successivo non viene rifiutato dal provider.
  for (const s of list) {
    if (s.status !== 'running' && s.status !== 'waiting') continue;
    s.status = 'idle';
    s.pending = null;
    s.rt = { queue: [], results: [] };
    const patched = sealMessages(s.messages || [], 'Operazione interrotta dal riavvio di Orabridge.');
    if (patched) s.messages = patched;
  }
  return list;
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => writeJson(FILE, sessions), 200);
}

function emit(session, event) {
  session.updatedAt = new Date().toISOString();
  const set = listeners.get(session.id);
  if (!set) return;
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of set) {
    try {
      res.write(payload);
    } catch {
      /* client scomparso: lo ripulisce il close handler */
    }
  }
}

export function subscribe(id, res) {
  if (!listeners.has(id)) listeners.set(id, new Set());
  listeners.get(id).add(res);
  return () => {
    const set = listeners.get(id);
    if (!set) return;
    set.delete(res);
    if (!set.size) listeners.delete(id);
  };
}

// Vista trasmessa al client: tutto tranne i campi di servizio.
function view(s) {
  return {
    id: s.id,
    title: s.title,
    connId: s.connId,
    provider: s.provider,
    model: s.model,
    permissions: s.permissions,
    status: s.status,
    pending: s.pending || null,
    error: s.error || null,
    usage: s.usage || null,
    messages: s.messages,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

const setStatus = (s, status) => {
  s.status = status;
  emit(s, { type: 'status', status, pending: s.pending || null, error: s.error || null });
  save();
};

function appendMessage(s, message) {
  s.messages.push(message);
  emit(s, { type: 'message', message });
  save();
}

// Chiude le chiamate rimaste senza esito (vedi toolPairing.js) e riallinea i
// client in ascolto.
function sealDanglingToolUses(s, reason) {
  const patched = sealMessages(s.messages, reason);
  if (!patched) return false;
  s.messages = patched;
  emit(s, { type: 'session', session: view(s) });
  save();
  return true;
}

// ---- gestione delle sessioni ----

export const aiSessions = {
  list() {
    return sessions
      .slice()
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
      .map((s) => ({
        id: s.id,
        title: s.title,
        connId: s.connId,
        provider: s.provider,
        model: s.model,
        status: s.status,
        permissions: s.permissions,
        messages: s.messages.length,
        updatedAt: s.updatedAt,
      }));
  },

  get(id) {
    const s = sessions.find((x) => x.id === id);
    return s ? view(s) : null;
  },

  create(input = {}) {
    const cfg = settings.ai();
    const provider = input.provider || cfg.provider;
    const s = {
      id: crypto.randomUUID(),
      title: 'Nuova sessione',
      connId: input.connId || null,
      provider,
      model: input.model || cfg.models[provider] || '',
      permissions: { ...cfg.permissions, ...(input.permissions || {}) },
      status: 'idle',
      pending: null,
      error: null,
      usage: null,
      messages: [],
      rt: { queue: [], results: [] },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    sessions.push(s);
    if (sessions.length > MAX_SESSIONS) {
      sessions = sessions
        .slice()
        .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
        .slice(0, MAX_SESSIONS);
    }
    save();
    return view(s);
  },

  update(id, patch) {
    const s = sessions.find((x) => x.id === id);
    if (!s) return null;
    if (patch.title != null) s.title = String(patch.title).slice(0, 120);
    if (patch.connId !== undefined) s.connId = patch.connId;
    if (patch.provider) {
      s.provider = patch.provider;
      if (!patch.model) s.model = settings.ai().models[patch.provider] || '';
    }
    if (patch.model != null) s.model = patch.model;
    if (patch.permissions) s.permissions = { ...s.permissions, ...patch.permissions };
    s.updatedAt = new Date().toISOString();
    save();
    emit(s, { type: 'session', session: view(s) });
    return view(s);
  },

  remove(id) {
    const ctrl = running.get(id);
    if (ctrl) ctrl.abort();
    const before = sessions.length;
    sessions = sessions.filter((x) => x.id !== id);
    save();
    return sessions.length !== before;
  },

  stop(id) {
    const ctrl = running.get(id);
    if (ctrl) ctrl.abort();
    const s = sessions.find((x) => x.id === id);
    if (!s) return false;
    if (s.status === 'running' || s.status === 'waiting') {
      s.rt = { queue: [], results: [] };
      s.pending = null;
      sealDanglingToolUses(s, "Operazione interrotta dall'utente prima di essere eseguita.");
      setStatus(s, 'idle');
    }
    return true;
  },

  // Messaggio dell'utente: avvia (o riavvia) il turno dell'assistente.
  async send(id, text) {
    const s = sessions.find((x) => x.id === id);
    if (!s) return null;
    if (s.status === 'running') throw new Error('Sessione già in esecuzione');
    // Modello mai scelto (o piattaforma configurata dopo): si usa quello
    // predefinito invece di rifiutare il messaggio.
    if (!s.model) {
      s.model = settings.ai().models[s.provider] || '';
      if (s.model) emit(s, { type: 'session', session: view(s) });
    }
    if (!s.model) throw new Error('Nessun modello selezionato per questa sessione');
    if (!settings.apiKey(s.provider)) {
      throw new Error(`Nessuna API key configurata per ${s.provider}: impostala dalle impostazioni`);
    }
    s.error = null;
    s.pending = null;
    s.rt = { queue: [], results: [] };
    // Turno precedente lasciato a metà: prima si chiudono le chiamate rimaste
    // in sospeso, altrimenti il provider rifiuta l'intera conversazione.
    sealDanglingToolUses(s, "L'utente ha interrotto l'operazione e ha scritto un nuovo messaggio.");
    appendMessage(s, { role: 'user', content: [{ type: 'text', text: String(text) }] });
    if (s.title === 'Nuova sessione') {
      s.title = String(text).trim().split('\n')[0].slice(0, 60) || 'Nuova sessione';
      emit(s, { type: 'session', session: view(s) });
    }
    runLoop(s).catch(() => {});
    return view(s);
  },

  // Risposta dell'utente a una richiesta di approvazione.
  async decide(id, { approve, remember }) {
    const s = sessions.find((x) => x.id === id);
    if (!s?.pending) return null;
    const call = s.rt.queue[0];
    if (!call || call.id !== s.pending.id) {
      s.pending = null;
      setStatus(s, 'idle');
      return view(s);
    }
    const level = s.pending.level;
    s.pending = null;
    if (approve) {
      if (remember) s.permissions = { ...s.permissions, [level]: true };
      else s.rt.grant = { id: call.id, level };
    } else {
      s.rt.queue.shift();
      pushResult(
        s,
        call,
        `L'utente ha rifiutato questa operazione (permesso "${LEVEL_LABEL[level] || level}" non concesso). Non riprovarla: proponi l'SQL da eseguire a mano o chiedi come procedere.`,
        true
      );
    }
    runLoop(s).catch(() => {});
    return view(s);
  },
};

// ---- ciclo dell'agente ----

function pushResult(s, call, content, isError) {
  s.rt.results.push({
    type: 'tool_result',
    toolUseId: call.id,
    toolName: call.name,
    content: String(content),
    isError: !!isError,
  });
  emit(s, { type: 'tool_result', id: call.id, name: call.name, content: String(content), isError: !!isError });
}

function systemPrompt(s) {
  const entry = s.connId ? pools.get(s.connId) : null;
  const perms = Object.entries(s.permissions)
    .filter(([, v]) => v)
    .map(([k]) => LEVEL_LABEL[k] || k);
  return [
    'Sei l\'assistente integrato in Orabridge, un client SQL per database Oracle.',
    'Rispondi sempre in italiano, in modo conciso e concreto.',
    '',
    entry
      ? `Connessione attiva: utente ${entry.user}, schema corrente ${entry.currentSchema}, Oracle ${entry.version}.`
      : 'Nessuna connessione attiva: puoi solo ragionare e scrivere SQL, non eseguirlo.',
    `Permessi concessi in questa sessione: ${perms.length ? perms.join(', ') : 'nessuno'}.`,
    '',
    'Linee guida:',
    '- Usa gli strumenti per guardare davvero il database invece di tirare a indovinare: prima di scrivere una query controlla la struttura delle tabelle con describe_table.',
    '- Scrivi SQL nel dialetto Oracle. Gli identificatori non quotati sono maiuscoli.',
    '- Una sola istruzione per chiamata, senza punto e virgola finale.',
    '- Le modifiche non vengono confermate da sole: dopo una INSERT/UPDATE/DELETE ricorda che serve un COMMIT dal foglio SQL.',
    '- Se ti manca un permesso, prova comunque: all\'utente verrà chiesta un\'approvazione. Se la rifiuta, non insistere.',
    '- Nelle risposte usa Markdown; racchiudi lo SQL in blocchi ```sql.',
  ].join('\n');
}

async function streamAssistant(s, signal) {
  const provider = providers[s.provider];
  if (!provider) throw new Error(`Piattaforma non supportata: ${s.provider}`);
  const ctx = { apiKey: settings.apiKey(s.provider), baseUrl: settings.baseUrl(s.provider) };
  if (!ctx.apiKey) throw new Error(`Nessuna API key configurata per ${s.provider}`);

  // Cane da guardia: se la piattaforma smette di mandare dati a metà stream la
  // lettura resterebbe appesa senza errore. Si interrompe il turno e lo si dice.
  const ctrl = new AbortController();
  const relay = () => ctrl.abort();
  // Lo Stop può essere già arrivato: un listener aggiunto dopo non scatterebbe.
  if (signal?.aborted) ctrl.abort();
  else signal?.addEventListener('abort', relay, { once: true });
  let idleTimer = null;
  let stalled = false;
  const beat = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      stalled = true;
      ctrl.abort();
    }, STREAM_IDLE_MS);
  };

  let text = '';
  let stopReason = null;
  const toolUses = [];
  try {
    beat();
    const stream = provider.stream(ctx, {
      model: s.model,
      system: systemPrompt(s),
      messages: s.messages,
      tools: s.connId ? toolSchemas() : [],
      maxTokens: MAX_TOKENS,
      signal: ctrl.signal,
    });
    for await (const ev of stream) {
      beat();
      if (ev.type === 'text') {
        text += ev.text;
        emit(s, { type: 'delta', text: ev.text });
      } else if (ev.type === 'tool_use') {
        toolUses.push(ev);
      } else if (ev.type === 'done') {
        stopReason = ev.stopReason || null;
        if (ev.usage) {
          s.usage = {
            input: (s.usage?.input || 0) + (ev.usage.input || 0),
            output: (s.usage?.output || 0) + (ev.usage.output || 0),
          };
        }
      }
    }
  } catch (err) {
    if (stalled && !signal?.aborted) {
      throw new Error(
        `La piattaforma AI non risponde da ${Math.round(STREAM_IDLE_MS / 1000)} secondi: turno interrotto.`
      );
    }
    throw err;
  } finally {
    clearTimeout(idleTimer);
    signal?.removeEventListener('abort', relay);
  }
  return { text, toolUses, stopReason };
}

// Turno tagliato dal limite di lunghezza: il modello si ferma a metà frase (o a
// metà chiamata) e senza avviso sembra che la chat si sia piantata.
const TRUNCATED = new Set(['max_tokens', 'length', 'MAX_TOKENS']);

// Esegue le chiamate in coda. Restituisce true se si è fermata in attesa
// di un'approvazione dell'utente.
async function drainQueue(s, signal) {
  while (s.rt.queue.length) {
    // Stop premuto mentre gli strumenti giravano: si lascia perdere il resto
    // della coda invece di eseguirlo lo stesso.
    if (signal?.aborted) throw Object.assign(new Error('Interrotto'), { name: 'AbortError' });
    const call = s.rt.queue[0];
    // Argomenti arrivati incompleti: eseguire lo strumento "a vuoto" farebbe
    // solo danni, si rimanda indietro l'errore così il modello riprova.
    if (call.invalid) {
      s.rt.queue.shift();
      pushResult(
        s,
        call,
        `ERRORE: argomenti della chiamata non validi (JSON incompleto o troncato): ${call.invalid}\n` +
          'Ripeti la chiamata con argomenti completi e più corti.',
        true
      );
      continue;
    }
    let req;
    try {
      req = requiredPermission(call.name, call.input);
    } catch (err) {
      s.rt.queue.shift();
      pushResult(s, call, `ERRORE: ${err.message}`, true);
      continue;
    }
    const granted =
      s.permissions[req.level] || (s.rt.grant?.id === call.id && s.rt.grant.level === req.level);
    if (!granted) {
      s.pending = {
        id: call.id,
        name: call.name,
        input: call.input,
        level: req.level,
        statement: req.statement || null,
      };
      setStatus(s, 'waiting');
      return true;
    }
    s.rt.queue.shift();
    s.rt.grant = null;
    emit(s, { type: 'tool_start', id: call.id, name: call.name, input: call.input });
    let out = null;
    let failed = null;
    try {
      out = await runTool(s.connId, call.name, call.input, { maxRows: settings.ai().maxRows });
    } catch (err) {
      failed = err;
    }
    // Stop arrivato mentre lo strumento girava: l'esito non va aggiunto, la
    // chiamata è già stata chiusa da `stop()`.
    if (signal?.aborted) throw Object.assign(new Error('Interrotto'), { name: 'AbortError' });
    if (failed) pushResult(s, call, `ERRORE: ${failed.message}`, true);
    else pushResult(s, call, out, false);
  }
  return false;
}

async function runLoop(s) {
  if (running.has(s.id)) return;
  const ctrl = new AbortController();
  running.set(s.id, ctrl);
  s.error = null;
  setStatus(s, 'running');
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      // Chiamate ancora da eseguire (turno appena avviato o ripreso dopo
      // un'approvazione): si svuotano prima di tornare al modello.
      if (s.rt.queue.length && (await drainQueue(s, ctrl.signal))) return;
      // Ogni tool_use deve avere il suo tool_result prima della richiesta
      // successiva, anche quando l'utente ha rifiutato: senza, il provider
      // rifiuta la conversazione.
      if (s.rt.results.length) {
        appendMessage(s, { role: 'user', content: s.rt.results });
        s.rt.results = [];
      }

      const { text, toolUses, stopReason } = await streamAssistant(s, ctrl.signal);
      const content = [];
      if (text.trim()) content.push({ type: 'text', text });
      for (const t of toolUses) {
        content.push({ type: 'tool_use', id: t.id, name: t.name, input: t.input });
      }
      if (content.length) appendMessage(s, { role: 'assistant', content });
      if (!toolUses.length) {
        if (TRUNCATED.has(stopReason)) {
          appendMessage(s, {
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: '_Risposta interrotta: limite di lunghezza raggiunto. Chiedi di proseguire._',
              },
            ],
          });
        }
        setStatus(s, 'idle');
        return;
      }
      s.rt.queue = toolUses.map((t) => ({
        id: t.id,
        name: t.name,
        input: t.input,
        invalid: t.invalid || null,
      }));
      s.rt.results = [];
    }
    // Le chiamate dell'ultimo giro sono rimaste in coda: senza esito il pannello
    // le mostrerebbe "in esecuzione" per sempre e il provider rifiuterebbe il
    // messaggio successivo.
    s.rt = { queue: [], results: [] };
    sealDanglingToolUses(s, 'Limite di passi del turno raggiunto: operazione non eseguita.');
    appendMessage(s, {
      role: 'assistant',
      content: [{ type: 'text', text: '_Limite di passi raggiunto: scrivi come proseguire._' }],
    });
    setStatus(s, 'idle');
  } catch (err) {
    if (err.name === 'AbortError') {
      s.rt = { queue: [], results: [] };
      setStatus(s, 'idle');
      return;
    }
    s.error = err.message || String(err);
    s.rt = { queue: [], results: [] };
    // Chiamate già annunciate ma mai eseguite: chiuse anche qui, altrimenti
    // restano con la rotellina accesa e bloccano il messaggio successivo.
    sealDanglingToolUses(s, `Turno interrotto da un errore: ${s.error}`);
    setStatus(s, 'error');
  } finally {
    running.delete(s.id);
    // Se l'attesa di approvazione è iniziata, il turno riprenderà da `decide`.
    save();
  }
}
