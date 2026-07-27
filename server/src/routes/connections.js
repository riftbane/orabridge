import { Router } from 'express';
import { store } from '../store.js';
import { pools, friendlyError } from '../pools.js';

const router = Router();
const a = (fn) => (req, res, next) => fn(req, res, next).catch(next);

router.get('/', (req, res) => {
  const list = store.list().map((c) => ({
    ...c,
    connected: !!pools.get(c.id),
  }));
  res.json(list);
});

router.post(
  '/',
  a(async (req, res) => {
    const { name, user } = req.body;
    if (!name?.trim() || !user?.trim()) {
      return res.status(400).json({ error: 'Nome e utente sono obbligatori' });
    }
    res.json(store.create(req.body));
  })
);

router.post(
  '/test',
  a(async (req, res) => {
    let cfg = req.body;
    // Editing a saved connection with the password field left empty: use the stored one.
    if (cfg.id && !cfg.password) {
      const saved = store.get(cfg.id);
      if (saved) cfg = { ...cfg, password: saved.password };
    }
    try {
      res.json(await pools.test(cfg));
    } catch (err) {
      res.json({ ok: false, error: friendlyError(err) });
    }
  })
);

router.put(
  '/:id',
  a(async (req, res) => {
    const updated = store.update(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Connessione non trovata' });
    res.json({ ...updated, connected: !!pools.get(updated.id) });
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
    try {
      const entry = await pools.connect(cfg);
      res.json({
        connected: true,
        user: entry.user,
        currentSchema: entry.currentSchema,
        version: entry.version,
      });
    } catch (err) {
      res.status(400).json({ error: friendlyError(err) });
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
