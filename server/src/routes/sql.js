import { Router } from 'express';
import oracledb from 'oracledb';
import { runExclusive } from '../pools.js';
import { gridResult } from '../oracle.js';
import { history } from '../history.js';

const router = Router({ mergeParams: true });
const a = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const MAX_ROWS_CAP = 10000;

async function getDbmsOutput(session) {
  const lines = [];
  try {
    for (;;) {
      const r = await session.execute(
        `BEGIN dbms_output.get_lines(:l, :n); END;`,
        {
          l: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767, maxArraySize: 200 },
          n: { dir: oracledb.BIND_INOUT, type: oracledb.NUMBER, val: 200 },
        }
      );
      const cnt = r.outBinds.n;
      lines.push(...r.outBinds.l.slice(0, cnt));
      if (cnt < 200 || lines.length >= 5000) break;
    }
  } catch {
    /* no dbms_output available */
  }
  return lines;
}

async function getTxnOpen(session) {
  try {
    const r = await session.execute(`SELECT dbms_transaction.local_transaction_id FROM dual`);
    return r.rows[0][0] != null;
  } catch {
    return null;
  }
}

router.post(
  '/execute',
  a(async (req, res) => {
    const { sql } = req.body;
    const maxRows = Math.min(MAX_ROWS_CAP, Number(req.body.maxRows) || 500);
    if (!sql?.trim()) return res.status(400).json({ error: 'Nessuna istruzione da eseguire' });
    const entry = req.oraEntry;

    const payload = await runExclusive(entry, async () => {
      const t0 = performance.now();
      entry.executing = true;
      let out;
      try {
        const r = await entry.session.execute(sql, {}, {
          outFormat: oracledb.OUT_FORMAT_ARRAY,
          maxRows: maxRows + 1,
          autoCommit: false,
        });
        out = { elapsedMs: Math.round(performance.now() - t0) };
        if (r.metaData) Object.assign(out, gridResult(r, maxRows));
        else out.rowsAffected = r.rowsAffected ?? 0;
      } catch (err) {
        out = {
          elapsedMs: Math.round(performance.now() - t0),
          error: { message: err.message, offset: err.offset, num: err.errorNum },
        };
      } finally {
        entry.executing = false;
      }
      out.dbmsOutput = await getDbmsOutput(entry.session);
      out.txnOpen = await getTxnOpen(entry.session);
      return out;
    });
    // Registrata qui, non lato client: così ogni istruzione eseguita finisce
    // in cronologia — anche quelle di uno script o di un dialogo DDL, e anche
    // se il tab del foglio viene chiuso subito dopo senza salvare nulla.
    history.add({
      connId: req.params.id,
      sql,
      ok: !payload.error,
      errorMessage: payload.error?.message,
      rows: payload.rows?.length,
      rowsAffected: payload.rowsAffected,
      elapsedMs: payload.elapsedMs,
    });
    res.json(payload);
  })
);

router.post(
  '/explain',
  a(async (req, res) => {
    const { sql } = req.body;
    if (!sql?.trim()) return res.status(400).json({ error: 'Nessuna istruzione' });
    const entry = req.oraEntry;
    const payload = await runExclusive(entry, async () => {
      try {
        await entry.session.execute(`EXPLAIN PLAN FOR ${sql}`);
        const r = await entry.session.execute(
          `SELECT plan_table_output FROM TABLE(dbms_xplan.display())`,
          [],
          { outFormat: oracledb.OUT_FORMAT_ARRAY, maxRows: 2000 }
        );
        return { plan: r.rows.map((x) => x[0]).join('\n') };
      } catch (err) {
        return { error: { message: err.message, offset: err.offset } };
      }
    });
    res.json(payload);
  })
);

router.post(
  '/commit',
  a(async (req, res) => {
    const entry = req.oraEntry;
    await runExclusive(entry, () => entry.session.commit());
    res.json({ ok: true, txnOpen: false });
  })
);

router.post(
  '/rollback',
  a(async (req, res) => {
    const entry = req.oraEntry;
    await runExclusive(entry, () => entry.session.rollback());
    res.json({ ok: true, txnOpen: false });
  })
);

// Interrupts the statement currently running on the worksheet session.
// Called outside the queue on purpose: break() must reach a busy session.
router.post(
  '/cancel',
  a(async (req, res) => {
    const entry = req.oraEntry;
    if (!entry.executing) return res.json({ ok: false, message: 'Nessuna esecuzione in corso' });
    try {
      await entry.session.break();
      res.json({ ok: true });
    } catch (err) {
      res.json({ ok: false, message: err.message });
    }
  })
);

router.get(
  '/status',
  a(async (req, res) => {
    const entry = req.oraEntry;
    let alive = true;
    let txnOpen = null;
    if (!entry.executing) {
      try {
        await runExclusive(entry, async () => {
          await entry.session.ping();
          txnOpen = await getTxnOpen(entry.session);
        });
      } catch {
        alive = false;
      }
    }
    res.json({
      connected: alive,
      executing: entry.executing,
      txnOpen,
      user: entry.user,
      currentSchema: entry.currentSchema,
      version: entry.version,
    });
  })
);

export default router;
