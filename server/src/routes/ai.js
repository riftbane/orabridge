import { Router } from 'express';
import { settings, PROVIDERS } from '../settings.js';
import { PROVIDER_INFO, fallbackModels, providers } from '../ai/providers.js';
import { aiSessions, subscribe } from '../ai/sessions.js';
import * as localModels from '../ai/localModels.js';
import { dispose as disposeLocal, isAvailable as localEngineAvailable } from '../ai/localLlama.js';

const router = Router();
const a = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// L'elenco dei modelli cambia di rado: una cache breve evita di ripetere la
// chiamata al provider ogni volta che si apre la tendina.
const modelCache = new Map(); // provider -> { ts, list }
const CACHE_MS = 5 * 60 * 1000;

router.get('/settings', (req, res) => {
  res.json({
    ...settings.publicAi(),
    info: Object.fromEntries(
      PROVIDERS.map((id) => [
        id,
        {
          label: PROVIDER_INFO[id].label,
          keyLabel: PROVIDER_INFO[id].keyLabel,
          keyHint: PROVIDER_INFO[id].keyHint,
          defaultBaseUrl: PROVIDER_INFO[id].defaultBaseUrl,
          keyless: !!PROVIDER_INFO[id].keyless,
        },
      ])
    ),
  });
});

router.put('/settings', (req, res) => {
  const out = settings.updateAi(req.body || {});
  // Chiavi o endpoint cambiati: l'elenco modelli va rifatto.
  modelCache.clear();
  res.json(out);
});

router.get(
  '/models',
  a(async (req, res) => {
    const provider = req.query.provider || settings.ai().provider;
    if (!PROVIDERS.includes(provider)) return res.status(400).json({ error: 'Piattaforma non valida' });
    const fresh = req.query.refresh === '1';
    const cached = modelCache.get(provider);
    if (!fresh && cached && Date.now() - cached.ts < CACHE_MS) {
      return res.json({ provider, models: cached.list, cached: true });
    }
    try {
      const list = await providers[provider].listModels({
        apiKey: settings.apiKey(provider),
        baseUrl: settings.baseUrl(provider),
      });
      modelCache.set(provider, { ts: Date.now(), list });
      res.json({ provider, models: list });
    } catch (err) {
      // Senza elenco in tempo reale si propongono comunque i modelli noti.
      res.json({ provider, models: fallbackModels(provider), error: err.message });
    }
  })
);

// ---- modelli locali ----
//
// Il motore llama.cpp è dentro l'app, i pesi si scaricano da qui la prima
// volta. Sono file da qualche gigabyte: il download va avanti per conto suo e
// la UI lo segue via SSE, così chiudere le impostazioni non lo interrompe.

router.get(
  '/local/models',
  a(async (req, res) => {
    res.json({ engine: await localEngineAvailable(), models: localModels.status() });
  })
);

router.post('/local/models/:id/download', (req, res) => {
  if (!localModels.catalogEntry(req.params.id)) {
    return res.status(404).json({ error: 'Modello sconosciuto' });
  }
  // Non si aspetta la fine: sono minuti, la richiesta andrebbe in timeout.
  localModels.download(req.params.id).catch(() => {});
  res.json({ ok: true, model: localModels.statusOf(req.params.id) });
});

router.post('/local/models/:id/cancel', (req, res) => {
  res.json({ ok: localModels.cancel(req.params.id) });
});

router.delete(
  '/local/models/:id',
  a(async (req, res) => {
    // Su Windows un file mappato in memoria non si può cancellare: prima si
    // scarica il modello dalla RAM, poi si tocca il disco.
    await disposeLocal();
    res.json({ ok: await localModels.remove(req.params.id) });
  })
);

router.get('/local/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (model) => res.write(`data: ${JSON.stringify({ type: 'model', model })}\n\n`);
  res.write(`data: ${JSON.stringify({ type: 'models', models: localModels.status() })}\n\n`);
  const unsubscribe = localModels.onProgress(send);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    unsubscribe();
  });
});

router.get('/sessions', (req, res) => res.json({ sessions: aiSessions.list() }));

router.post('/sessions', (req, res) => res.json(aiSessions.create(req.body || {})));

router.get('/sessions/:id', (req, res) => {
  const s = aiSessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Sessione non trovata' });
  res.json(s);
});

router.patch('/sessions/:id', (req, res) => {
  const s = aiSessions.update(req.params.id, req.body || {});
  if (!s) return res.status(404).json({ error: 'Sessione non trovata' });
  res.json(s);
});

router.delete('/sessions/:id', (req, res) => {
  res.json({ ok: aiSessions.remove(req.params.id) });
});

router.post(
  '/sessions/:id/messages',
  a(async (req, res) => {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Messaggio vuoto' });
    try {
      const s = await aiSessions.send(req.params.id, text);
      if (!s) return res.status(404).json({ error: 'Sessione non trovata' });
      res.json(s);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  })
);

router.post(
  '/sessions/:id/approve',
  a(async (req, res) => {
    const s = await aiSessions.decide(req.params.id, {
      approve: !!req.body?.approve,
      remember: !!req.body?.remember,
    });
    if (!s) return res.status(409).json({ error: 'Nessuna approvazione in attesa' });
    res.json(s);
  })
);

router.post('/sessions/:id/stop', (req, res) => {
  res.json({ ok: aiSessions.stop(req.params.id) });
});

// Flusso di eventi della sessione: risposte in streaming, esiti degli
// strumenti e cambi di stato. Resta aperto anche a pannello chiuso, così una
// sessione continua a lavorare in background.
router.get('/sessions/:id/events', (req, res) => {
  const session = aiSessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Sessione non trovata' });
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`data: ${JSON.stringify({ type: 'session', session })}\n\n`);
  const unsubscribe = subscribe(req.params.id, res);
  // Battito periodico: tiene viva la connessione dietro proxy e reverse proxy.
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    unsubscribe();
  });
});

export default router;
