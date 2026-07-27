import { Router } from 'express';
import { history } from '../history.js';

const router = Router();
const a = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// Non richiede una connessione attiva: la cronologia va consultabile anche
// per connessioni chiuse o eliminate nel frattempo.
router.get(
  '/',
  a(async (req, res) => {
    const { connId, q, limit } = req.query;
    res.json(history.list({ connId, q, limit }));
  })
);

router.delete(
  '/',
  a(async (req, res) => {
    history.clear({ connId: req.query.connId });
    res.json({ ok: true });
  })
);

router.delete(
  '/:entryId',
  a(async (req, res) => {
    const ok = history.removeOne(req.params.entryId);
    res.json({ ok });
  })
);

export default router;
