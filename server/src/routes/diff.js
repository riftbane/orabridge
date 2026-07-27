// Confronto fra due database (DB Diff).
//
// Sta fuori da /api/conn/:id perché ogni operazione coinvolge due connessioni.
// Il risultato di ogni confronto resta in memoria (`runs`): dettaglio di un
// oggetto e script di sincronizzazione lavorano su quella fotografia, senza
// rileggere il dizionario a ogni clic — e restano coerenti anche se nel
// frattempo qualcuno modifica i database.

import { Router } from 'express';
import { pools } from '../pools.js';
import { readSnapshot, DIFF_TYPES, sourceKey } from '../diff/snapshot.js';
import { compareSnapshots, describeColumn } from '../diff/compare.js';
import { buildSyncScript } from '../diff/script.js';

const router = Router();
const a = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// Poche run in memoria: gli snapshot possono pesare qualche MB l'uno.
const MAX_RUNS = 5;
const runs = new Map();

const newRunId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function keepRun(run) {
  runs.set(run.id, run);
  while (runs.size > MAX_RUNS) runs.delete(runs.keys().next().value);
}

const BOOL_OPTIONS = [
  'ignoreGeneratedNames',
  'ignoreWhitespace',
  'ignoreCase',
  'remapSchema',
  'compareConstraints',
  'compareIndexes',
  'compareComments',
];

function readOptions(body) {
  const opts = {};
  for (const k of BOOL_OPTIONS) if (typeof body[k] === 'boolean') opts[k] = body[k];
  return opts;
}

router.post(
  '/run',
  a(async (req, res) => {
    const { sourceConnId, sourceOwner, targetConnId, targetOwner, filter } = req.body || {};
    const types = Array.isArray(req.body?.types)
      ? req.body.types.filter((t) => DIFF_TYPES.includes(t))
      : DIFF_TYPES;

    if (!sourceOwner || !targetOwner) return res.status(400).json({ error: 'Schemi mancanti' });
    if (!types.length) return res.status(400).json({ error: 'Nessun tipo di oggetto selezionato' });
    if (sourceConnId === targetConnId && sourceOwner === targetOwner)
      return res.status(400).json({ error: 'Origine e destinazione coincidono' });

    const srcEntry = pools.get(sourceConnId);
    const tgtEntry = pools.get(targetConnId);
    if (!srcEntry) return res.status(409).json({ error: 'Connessione di origine non attiva' });
    if (!tgtEntry) return res.status(409).json({ error: 'Connessione di destinazione non attiva' });

    const t0 = performance.now();
    const readOpts = { types, filter: filter || '' };
    // Le due letture sono indipendenti: si fanno in parallelo.
    const [src, tgt] = await Promise.all([
      readSnapshot(srcEntry, sourceOwner, readOpts),
      readSnapshot(tgtEntry, targetOwner, readOpts),
    ]);

    const options = { ...readOptions(req.body || {}), types };
    const { items, counts } = compareSnapshots(src, tgt, options);

    const run = {
      id: newRunId(),
      at: Date.now(),
      src,
      tgt,
      items,
      options,
      source: { connId: sourceConnId, owner: sourceOwner },
      target: { connId: targetConnId, owner: targetOwner },
    };
    keepRun(run);

    res.json({
      runId: run.id,
      ms: Math.round(performance.now() - t0),
      counts,
      // Il testo degli oggetti diversi resta sul server: qui viaggia solo il
      // riepilogo, il confronto riga per riga si chiede a /detail.
      items,
      source: run.source,
      target: run.target,
    });
  })
);

// Dettaglio di un oggetto: il testo delle due versioni (per il diff riga per
// riga nella UI) e, per le tabelle presenti da un lato solo, l'elenco delle
// colonne — così anche un oggetto "solo in origine" si può ispezionare.
router.get(
  '/:runId/detail',
  a(async (req, res) => {
    const run = runs.get(req.params.runId);
    if (!run) return res.status(410).json({ error: 'Confronto scaduto: rilancialo' });
    const { type, name } = req.query;

    if (type === 'TABLE') {
      const s = run.src.tables[name];
      const t = run.tgt.tables[name];
      const one = s || t;
      if (!one || (s && t)) return res.json({ source: '', target: '', changes: [] });
      const side = s ? 'only-source' : 'only-target';
      const describe = (c) => describeColumn(c);
      return res.json({
        source: '',
        target: '',
        changes: one.columns.map((c) => ({
          kind: 'Colonna',
          name: c.name,
          change: side,
          source: s ? describe(c) : null,
          target: t ? describe(c) : null,
        })),
      });
    }

    const textOf = (snap) => {
      if (!snap) return '';
      if (type === 'VIEW') return snap.views[name]?.text ?? '';
      if (type === 'MATERIALIZED VIEW') return snap.mviews[name]?.query ?? '';
      if (type === 'TRIGGER') return snap.triggers[name]?.text ?? '';
      const s = snap.sources[sourceKey(type, name)];
      return s ? (s.text ? `CREATE OR REPLACE ${s.text}` : '') : '';
    };
    res.json({ source: textOf(run.src), target: textOf(run.tgt), changes: [] });
  })
);

router.post(
  '/:runId/script',
  a(async (req, res) => {
    const run = runs.get(req.params.runId);
    if (!run) return res.status(410).json({ error: 'Confronto scaduto: rilancialo' });
    const keys = Array.isArray(req.body?.keys) ? new Set(req.body.keys) : null;
    const items = run.items.filter(
      (it) => it.status !== 'same' && (!keys || keys.has(it.key))
    );
    const { sql, stats } = buildSyncScript(run.src, run.tgt, items, {
      ...run.options,
      includeDrops: !!req.body?.includeDrops,
      sourceLabel: req.body?.sourceLabel || '',
      targetLabel: req.body?.targetLabel || '',
    });
    res.json({ sql, stats });
  })
);

export default router;
