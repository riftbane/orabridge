// Editor a nodi (beta): sessione di lavoro, piano di applicazione, layout.
//
// Sta fuori da /api/conn/:id perché una sessione sopravvive alla singola
// richiesta: la fotografia dello schema letta all'apertura resta qui, ed è la
// base contro cui si calcolano le modifiche. Stesso criterio — e stesso
// numero massimo — delle run del DB Diff.
//
// Il client non vede mai lo snapshot grezzo: riceve già il draft (indicizzato
// per id stabile, vedi graph/model.js), lo modifica come stato della UI e lo
// rispedisce quando c'è da generare lo script. Il server non tiene traccia
// delle modifiche in corso: la sorgente di verità del disegno è il client.

import { Router } from 'express';
import { pools } from '../pools.js';
import { readSnapshot } from '../diff/snapshot.js';
import { compareSnapshots } from '../diff/compare.js';
import { importSnapshot } from '../graph/model.js';
import { buildApplyPlan } from '../graph/apply.js';
import { diagrams } from '../diagrams.js';

const router = Router();
const a = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// Gli snapshot pesano qualche MB l'uno: se ne tengono pochi.
const MAX_SESSIONS = 4;
const sessions = new Map();

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function keep(session) {
  sessions.set(session.id, session);
  while (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
}

// L'editor lavora su tabelle e sequenze; il resto viaggia intatto dentro il
// draft perché la proiezione sia uno snapshot completo (vedi model.js).
const TYPES = ['TABLE', 'SEQUENCE'];

router.post(
  '/session',
  a(async (req, res) => {
    const { connId, owner, filter } = req.body || {};
    if (!connId || !owner) return res.status(400).json({ error: 'Connessione o schema mancanti' });
    const entry = pools.get(connId);
    if (!entry) return res.status(409).json({ error: 'Connessione non attiva' });

    const t0 = performance.now();
    const base = await readSnapshot(entry, owner, { types: TYPES, filter: filter || '' });
    const session = { id: newId(), at: Date.now(), connId, owner, filter: filter || '', base };
    keep(session);

    res.json({
      sessionId: session.id,
      owner,
      filter: session.filter,
      draft: importSnapshot(base),
      layout: diagrams.read(connId, owner),
      ms: Math.round(performance.now() - t0),
    });
  })
);

// Piano di applicazione: rinomine, confronto e script DDL.
//
// Prima di generarlo si rilegge lo schema e lo si confronta con la base: se
// nel frattempo qualcuno ha modificato il database, l'utente deve saperlo
// prima di lanciare qualcosa. Con `ignoreDrift` si procede lo stesso, ma è
// una scelta esplicita.
router.post(
  '/:sessionId/plan',
  a(async (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (!session) return res.status(410).json({ error: 'Sessione scaduta: riapri il diagramma' });
    const { draft, includeDrops, schemaLabel, ignoreDrift } = req.body || {};
    if (!draft?.tables) return res.status(400).json({ error: 'Diagramma mancante' });

    if (!ignoreDrift) {
      const entry = pools.get(session.connId);
      if (!entry) return res.status(409).json({ error: 'Connessione non attiva' });
      const fresh = await readSnapshot(entry, session.owner, {
        types: TYPES,
        filter: session.filter,
      });
      const { items } = compareSnapshots(session.base, fresh, { types: TYPES });
      const drift = items.filter((it) => it.status !== 'same');
      if (drift.length)
        return res.json({
          drift: drift.map((it) => ({ type: it.type, name: it.name, status: it.status })),
        });
    }

    res.json(
      buildApplyPlan(draft, session.base, {
        includeDrops: includeDrops !== false,
        schemaLabel: schemaLabel || session.owner,
      })
    );
  })
);

router.get(
  '/diagram/:connId/:owner',
  a(async (req, res) => {
    res.json(diagrams.read(req.params.connId, req.params.owner));
  })
);

router.put(
  '/diagram/:connId/:owner',
  a(async (req, res) => {
    res.json(diagrams.write(req.params.connId, req.params.owner, req.body || {}));
  })
);

export default router;
