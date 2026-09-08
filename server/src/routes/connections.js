import { Router } from 'express';
import { store } from '../store.js';
import { pools, friendlyError, isAuthError } from '../pools.js';
import { findTnsAdmin, readTnsAliases } from '../tns.js';
import { parseExport, decryptWithKey } from '../importers/sqlDeveloper.js';

const router = Router();
const a = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// Regole sulla forma della connessione, valide sia quando si salva sia quando
// si prova: i dati anagrafici (nome, utente) si controllano a parte, perché
// una prova si fa spesso prima di aver dato un nome alla connessione.
function invalidTarget(cfg) {
  if (cfg.serviceType === 'tns' && !cfg.tnsAlias?.trim()) {
    return "Con il tipo «TNS» serve l'alias di tnsnames.ora";
  }
  if (cfg.walletPassword?.trim() && !cfg.walletPath?.trim()) {
    return 'Password del wallet indicata senza la cartella del wallet';
  }
  return '';
}

router.get('/', (req, res) => {
  const list = store.list().map((c) => ({
    ...c,
    connected: !!pools.get(c.id),
  }));
  res.json(list);
});

// Alias leggibili dal tnsnames.ora: senza `dir` si usa la cartella di sistema
// (TNS_ADMIN, poi ORACLE_HOME). Gli errori tornano dentro la risposta, non
// come 4xx: la finestra li mostra sotto l'elenco vuoto mentre l'utente
// corregge la cartella.
router.get('/tns', (req, res) => {
  const dir = typeof req.query.dir === 'string' ? req.query.dir.trim() : '';
  res.json(readTnsAliases(dir || findTnsAdmin()));
});

router.post(
  '/',
  a(async (req, res) => {
    const { name, user } = req.body;
    if (!name?.trim() || !user?.trim()) {
      return res.status(400).json({ error: 'Nome e utente sono obbligatori' });
    }
    const invalid = invalidTarget(req.body);
    if (invalid) return res.status(400).json({ error: invalid });
    res.json(store.create(req.body));
  })
);

router.post(
  '/test',
  a(async (req, res) => {
    let cfg = req.body;
    // Editing a saved connection with the password field left empty: use the stored one.
    // Vale anche per la password del wallet, che la finestra non rimanda mai indietro.
    if (cfg.id) {
      const saved = store.get(cfg.id);
      if (saved) {
        cfg = {
          ...cfg,
          password: cfg.password || saved.password,
          // La password del wallet si ripesca solo se il wallet c'è ancora:
          // togliendo la cartella nella finestra e provando la connessione,
          // altrimenti, si verrebbe respinti da «password senza cartella» per
          // una password che l'utente ha appena smesso di usare.
          walletPassword:
            cfg.walletPassword || (String(cfg.walletPath || '').trim() ? saved.walletPassword : ''),
        };
      }
    }
    const invalid = invalidTarget(cfg);
    if (invalid) return res.json({ ok: false, error: invalid });
    try {
      res.json(await pools.test(cfg));
    } catch (err) {
      res.json({ ok: false, error: friendlyError(err, cfg) });
    }
  })
);

// Analizza un export di connessioni (per ora solo JSON di SQL Developer) e
// restituisce un'anteprima senza decifrare le password.
router.post(
  '/import/preview',
  a(async (req, res) => {
    const { content } = req.body;
    if (typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'Nessun file fornito' });
    }
    let list;
    try {
      list = parseExport(content);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    res.json({ connections: list.map(({ _rawPassword, ...c }) => c) });
  })
);

router.post(
  '/import',
  a(async (req, res) => {
    const { content, key, group, selected } = req.body;
    if (typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'Nessun file fornito' });
    }
    let list;
    try {
      list = parseExport(content);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    const indexes = Array.isArray(selected) ? selected : list.map((_, i) => i);
    const chosen = indexes.map((i) => list[i]).filter(Boolean);
    if (!chosen.length) {
      return res.status(400).json({ error: 'Nessuna connessione selezionata' });
    }
    const needsKey = chosen.some((c) => c.hasPassword);
    if (needsKey && !key) {
      return res.status(400).json({ error: 'Chiave di cifratura richiesta' });
    }
    const resolved = needsKey ? decryptWithKey(chosen, key) : chosen.map((c) => ({ ...c, password: '' }));
    const keyError = resolved.find((c) => c.error);
    if (keyError) {
      return res.status(400).json({ error: keyError.error });
    }
    const created = resolved.map((c) =>
      store.create({
        name: c.name,
        host: c.host,
        port: c.port,
        serviceType: c.serviceType,
        service: c.service,
        user: c.user,
        password: c.password,
        group: group || '',
      })
    );
    res.json({
      created,
      warnings: resolved.filter((c) => c.warning).map((c) => ({ name: c.name, warning: c.warning })),
    });
  })
);

router.put(
  '/:id',
  a(async (req, res) => {
    const cur = store.get(req.params.id);
    if (!cur) return res.status(404).json({ error: 'Connessione non trovata' });
    // La modifica è parziale: si controlla la connessione come sarà dopo, non
    // il solo pezzo arrivato.
    const invalid = invalidTarget({ ...cur, ...req.body });
    if (invalid) return res.status(400).json({ error: invalid });
    const updated = store.update(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Connessione non trovata' });
    // La sola lettura è un booleano che `readonly.js` rilegge a ogni
    // istruzione: su una connessione già aperta si applica subito, senza
    // chiedere di riconnettersi. Tutto il resto (host, utente, wallet) invece
    // vale davvero solo alla connessione successiva.
    const live = pools.get(updated.id);
    if (live) live.readOnly = !!updated.readOnly;
    res.json({ ...updated, connected: !!live, readOnly: !!updated.readOnly });
  })
);

router.delete(
  '/:id',
  a(async (req, res) => {
    await pools.disconnect(req.params.id);
    if (!store.remove(req.params.id)) {
      return res.status(404).json({ error: 'Connessione non trovata' });
    }
    res.json({ ok: true });
  })
);

router.post(
  '/:id/connect',
  a(async (req, res) => {
    const cfg = store.get(req.params.id);
    if (!cfg) return res.status(404).json({ error: 'Connessione non trovata' });
    // Password digitata al volo dal client: se la connessione riesce viene
    // salvata sulla connessione, così la volta dopo non viene più richiesta.
    const typed = typeof req.body?.password === 'string' ? req.body.password : '';
    // Con un wallet la password può stare nel wallet stesso: chiederla
    // bloccherebbe una connessione che funzionerebbe benissimo senza.
    if (!typed && !cfg.password && !cfg.walletPath?.trim()) {
      return res.status(400).json({
        error: 'Nessuna password salvata per questa connessione',
        needsPassword: true,
        reason: 'missing',
      });
    }
    const already = !!pools.get(cfg.id);
    try {
      const entry = await pools.connect(typed ? { ...cfg, password: typed } : cfg);
      if (typed && !already) store.update(cfg.id, { password: typed });
      res.json({
        connected: true,
        user: entry.user,
        currentSchema: entry.currentSchema,
        version: entry.version,
        // Il client lo mostra nell'intestazione della connessione e disabilita
        // i comandi che scrivono prima ancora di provarci.
        readOnly: !!entry.readOnly,
        passwordSaved: !!typed && !already,
      });
    } catch (err) {
      res.status(400).json({
        error: friendlyError(err, cfg),
        needsPassword: isAuthError(err),
        reason: isAuthError(err) ? 'invalid' : undefined,
      });
    }
  })
);

router.post(
  '/:id/disconnect',
  a(async (req, res) => {
    await pools.disconnect(req.params.id);
    res.json({ ok: true });
  })
);

export default router;
