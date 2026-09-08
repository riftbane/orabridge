import { Router } from 'express';
import oracledb from 'oracledb';
import { runExclusive } from '../pools.js';
import { gridResult, serializeValue } from '../oracle.js';
import { history } from '../history.js';
import { assertWritable } from '../readonly.js';

const router = Router({ mergeParams: true });
const a = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const MAX_ROWS_CAP = 10000;

// ---------------------------------------------------------------- bind ----

const BIND_TYPES = { string: oracledb.STRING, number: oracledb.NUMBER, date: oracledb.DATE };
const BIND_DIRS = { in: oracledb.BIND_IN, out: oracledb.BIND_OUT, inout: oracledb.BIND_INOUT };

function bindError(name, detail) {
  const err = new Error(`Variabile di bind :${name} — ${detail}`);
  err.bindError = true;
  return err;
}

// Le date arrivano come testo nello stesso formato con cui la griglia le
// mostra (`fmtDate` in oracle.js): il driver non converte da solo una stringa
// in un bind DATE, e passargli un `new Date('pippo')` significherebbe mandare
// al database un NaN silenzioso — meglio fermarsi e dire cosa c'è di storto.
const DATE_TEXT = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,3}))?)?)?$/;

function parseBindDate(name, text) {
  const m = DATE_TEXT.exec(String(text).trim());
  if (!m) {
    throw bindError(name, `«${text}» non è una data: usa il formato AAAA-MM-GG HH:MI:SS`);
  }
  const [, y, mo, d, hh, mi, ss, ms] = m;
  const date = new Date(+y, +mo - 1, +d, +(hh || 0), +(mi || 0), +(ss || 0), +(ms || '').padEnd(3, '0'));
  // Il costruttore accetta anche il 31 febbraio e lo fa scivolare a marzo:
  // se i campi non tornano, la data non esiste.
  if (Number.isNaN(date.getTime()) || date.getMonth() !== +mo - 1 || date.getDate() !== +d) {
    throw bindError(name, `«${text}» non è una data esistente`);
  }
  return date;
}

function bindValue(name, kind, val) {
  if (val === null || val === undefined) return null;
  if (kind === 'string') return String(val);
  // Campo lasciato in bianco: vale NULL, non zero né una data impossibile.
  if (typeof val === 'string' && !val.trim()) return null;
  if (kind === 'number') {
    const n = typeof val === 'number' ? val : Number(String(val).trim());
    if (!Number.isFinite(n)) throw bindError(name, `«${val}» non è un numero`);
    return n;
  }
  return val instanceof Date ? val : parseBindDate(name, val);
}

// Dalla forma del client (`{ NOME: { val, type, dir } }`) a quella di
// node-oracledb. Esportata perché anche l'esportazione dati esegue le stesse
// istruzioni con gli stessi bind: la conversione deve restare una sola.
export function toOracleBinds(binds) {
  if (!binds || typeof binds !== 'object') return {};
  const out = {};
  for (const [name, spec] of Object.entries(binds)) {
    // Si accetta anche il valore nudo: comodo per chi chiama da dentro il
    // server e non ha tipi da dichiarare.
    const s = spec !== null && typeof spec === 'object' ? spec : { val: spec };
    const kind = String(s.type || 'string').toLowerCase();
    const type = BIND_TYPES[kind];
    if (!type) throw bindError(name, `tipo «${s.type}» sconosciuto (string, number o date)`);
    const dirName = String(s.dir || 'in').toLowerCase();
    const dir = BIND_DIRS[dirName];
    if (!dir) throw bindError(name, `direzione «${s.dir}» sconosciuta (in, out o inout)`);
    const def = { dir, type };
    if (dir !== oracledb.BIND_OUT) def.val = bindValue(name, kind, s.val);
    // Senza maxSize un OUT di tipo stringa torna troncato a 200 byte.
    if (type === oracledb.STRING && dir !== oracledb.BIND_IN) def.maxSize = 32767;
    out[name] = def;
  }
  return out;
}

// I valori restituiti dai bind OUT passano dallo stesso serializzatore delle
// celle: date e RAW arrivano al client nel formato che sa già rileggere.
function serializeOutBinds(result) {
  const raw = result?.outBinds;
  if (!raw || Array.isArray(raw)) return undefined;
  const out = {};
  for (const [name, v] of Object.entries(raw)) {
    out[name] = Array.isArray(v) ? v.map(serializeValue) : serializeValue(v);
  }
  return Object.keys(out).length ? out : undefined;
}

// --------------------------------------------------------------- utili ----

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

// Istruzione rifiutata prima ancora di toccare il database (sola lettura o
// bind malformati): stessa forma degli errori Oracle e stesso stato 200, così
// il foglio la mostra come un qualunque errore di esecuzione.
function refuse(connId, sql, err) {
  const payload = { elapsedMs: 0, error: { message: err.message } };
  if (err.readOnly) payload.error.readOnly = true;
  history.add({ connId, sql, ok: false, errorMessage: err.message });
  return payload;
}

// Esegue un comando accessorio (ALTER SESSION…) senza far fallire il resto.
async function tryExec(session, sql) {
  try {
    await session.execute(sql);
    return true;
  } catch {
    return false;
  }
}

// -------------------------------------------------------------- execute ---

router.post(
  '/execute',
  a(async (req, res) => {
    const { sql } = req.body;
    const maxRows = Math.min(MAX_ROWS_CAP, Number(req.body.maxRows) || 500);
    if (!sql?.trim()) return res.status(400).json({ error: 'Nessuna istruzione da eseguire' });
    const entry = req.oraEntry;

    let binds;
    try {
      assertWritable(entry, sql);
      binds = toOracleBinds(req.body.binds);
    } catch (err) {
      return res.json(refuse(req.params.id, sql, err));
    }

    const payload = await runExclusive(entry, async () => {
      const t0 = performance.now();
      entry.executing = true;
      let out;
      try {
        const r = await entry.session.execute(sql, binds, {
          outFormat: oracledb.OUT_FORMAT_ARRAY,
          maxRows: maxRows + 1,
          autoCommit: false,
        });
        out = { elapsedMs: Math.round(performance.now() - t0) };
        if (r.metaData) Object.assign(out, gridResult(r, maxRows));
        else out.rowsAffected = r.rowsAffected ?? 0;
        const outBinds = serializeOutBinds(r);
        if (outBinds) out.outBinds = outBinds;
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

// --------------------------------------------------------------- piano ----

let explainSeq = 0;

// Un identificativo diverso per ogni richiesta: due fogli che chiedono il
// piano nello stesso istante scriverebbero altrimenti nelle stesse righe di
// plan_table e ognuno leggerebbe il piano dell'altro. Sono solo lettere e
// cifre (statement_id è VARCHAR2(30)).
const nextStatementId = () => `OB${++explainSeq}X${Date.now()}`;

const PLAN_COLUMNS =
  'id, parent_id, operation, options, object_owner, object_name, object_type, ' +
  'cost, cardinality, bytes, time, partition_start, partition_stop';
// In alcune versioni questi due sono LONG e il driver non li sa leggere: si
// chiedono a parte, per poterci rinunciare senza perdere tutto il piano.
const PLAN_PREDICATES = ', access_predicates, filter_predicates';
const CURSOR_STATS =
  ', last_starts, last_output_rows, last_elapsed_time, last_cr_buffer_gets';

function planNode(r) {
  const node = {
    id: Number(r.ID),
    parentId: r.PARENT_ID == null ? null : Number(r.PARENT_ID),
    operation: r.OPERATION || '',
    options: r.OPTIONS ?? null,
    objectOwner: r.OBJECT_OWNER ?? null,
    objectName: r.OBJECT_NAME ?? null,
    objectType: r.OBJECT_TYPE ?? null,
    cost: r.COST ?? null,
    cardinality: r.CARDINALITY ?? null,
    bytes: r.BYTES ?? null,
    time: r.TIME ?? null,
    accessPredicates: r.ACCESS_PREDICATES ?? null,
    filterPredicates: r.FILTER_PREDICATES ?? null,
    partitionStart: r.PARTITION_START ?? null,
    partitionStop: r.PARTITION_STOP ?? null,
  };
  if (r.LAST_STARTS !== undefined) {
    node.starts = r.LAST_STARTS ?? null;
    node.aRows = r.LAST_OUTPUT_ROWS ?? null;
    // I tempi delle viste v$ sono in microsecondi.
    node.aTimeMs = r.LAST_ELAPSED_TIME == null ? null : Math.round(r.LAST_ELAPSED_TIME / 1000);
    node.buffers = r.LAST_CR_BUFFER_GETS ?? null;
  }
  return node;
}

// La colonna DEPTH non c'è in tutte le plan_table (chi l'ha creata con uno
// script vecchio non ce l'ha): la profondità si ricava risalendo i parent_id,
// con un tetto ai salti per non restare appesi a un piano incoerente.
function withDepth(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    let depth = 0;
    let cur = byId.get(n.parentId);
    while (cur && depth < nodes.length) {
      depth++;
      cur = cur.parentId == null ? null : byId.get(cur.parentId);
    }
    n.depth = n.parentId == null ? 0 : depth;
  }
  return nodes;
}

async function planNodesFrom(session, from, extraCols, binds) {
  const run = (cols) =>
    session.execute(
      `SELECT ${PLAN_COLUMNS}${cols} FROM ${from} ORDER BY id`,
      binds,
      { outFormat: oracledb.OUT_FORMAT_OBJECT, maxRows: 5000 }
    );
  let r;
  try {
    r = await run(extraCols + PLAN_PREDICATES);
  } catch {
    r = await run(extraCols);
  }
  return withDepth(r.rows.map(planNode));
}

// Il testo del piano: 'ALL' aggiunge proiezioni e predicati ma non tutte le
// versioni lo accettano, e su qualche installazione la display() con
// argomenti non è eseguibile affatto — si scende di livello finché una
// risponde, invece di restituire un piano vuoto.
async function planText(session, sid) {
  for (const fmt of ['ALL', 'TYPICAL']) {
    try {
      const r = await session.execute(
        `SELECT plan_table_output FROM TABLE(dbms_xplan.display('PLAN_TABLE', :sid, :fmt))`,
        { sid, fmt },
        { outFormat: oracledb.OUT_FORMAT_ARRAY, maxRows: 2000 }
      );
      return r.rows.map((x) => x[0]).join('\n');
    } catch {
      /* formato non accettato: si prova il successivo */
    }
  }
  const r = await session.execute(
    `SELECT plan_table_output FROM TABLE(dbms_xplan.display())`,
    [],
    { outFormat: oracledb.OUT_FORMAT_ARRAY, maxRows: 2000 }
  );
  return r.rows.map((x) => x[0]).join('\n');
}

// La prima riga non vuota di un messaggio di Oracle: dentro una nota ci sta
// quella, non l'intero riquadro di dbms_xplan.
const firstLine = (text) => String(text).split('\n').map((l) => l.trim()).find(Boolean) || '';

// EXPLAIN PLAN dell'istruzione: testo di dbms_xplan più i nodi strutturati.
async function explainPlan(session, sql, binds) {
  const sid = nextStatementId();
  // EXPLAIN PLAN scrive in plan_table: se l'utente non aveva già una
  // transazione aperta, quella che si apre qui è tutta nostra e va richiusa.
  // Altrimenti il foglio accende il pallino «transazione aperta» per un
  // comando che non ha toccato i dati — e su una connessione in sola lettura
  // non ci sarebbe nemmeno il modo di chiuderla.
  const hadTxn = await getTxnOpen(session);
  try {
    // Lo statement_id non può essere un bind e comunque non viene dal client:
    // lo generiamo noi qui sopra. I bind dell'istruzione vanno passati lo
    // stesso: EXPLAIN PLAN non li valuta, ma il driver pretende che ci siano.
    await session.execute(`EXPLAIN PLAN SET STATEMENT_ID = '${sid}' FOR ${sql}`, binds);
    const text = await planText(session, sid);
    const nodes = await planNodesFrom(
      session,
      'plan_table WHERE statement_id = :sid',
      '',
      { sid }
    ).catch(() => []);
    return { text, nodes };
  } finally {
    // Le righe restano in plan_table finché non le si toglie. Niente
    // autoCommit: la sessione del foglio può avere una transazione aperta
    // dell'utente, e un commit qui gliela chiuderebbe alle spalle.
    await session
      .execute(`DELETE FROM plan_table WHERE statement_id = :sid`, { sid }, { autoCommit: false })
      .catch(() => {});
    if (hadTxn === false) await session.rollback().catch(() => {});
  }
}

router.post(
  '/explain',
  a(async (req, res) => {
    const { sql } = req.body;
    if (!sql?.trim()) return res.status(400).json({ error: 'Nessuna istruzione' });
    const entry = req.oraEntry;
    let binds;
    try {
      binds = toOracleBinds(req.body.binds);
    } catch (err) {
      return res.json({ error: { message: err.message } });
    }
    const payload = await runExclusive(entry, async () => {
      let out;
      try {
        const plan = await explainPlan(entry.session, sql, binds);
        // `plan` è l'alias storico del solo testo, lasciato per chi legge
        // ancora la risposta vecchia.
        out = { ...plan, plan: plan.text };
      } catch (err) {
        out = { error: { message: err.message, offset: err.offset } };
      }
      // Anche il piano tocca plan_table: il foglio deve poter aggiornare
      // l'indicatore della transazione invece di restare con il valore vecchio.
      out.txnOpen = await getTxnOpen(entry.session);
      return out;
    });
    res.json(payload);
  })
);

// ----------------------------------------------------------- autotrace ----

// Statistiche di sessione mostrate accanto al piano. L'elenco è corto di
// proposito: sono quelle che dicono qualcosa sul costo dell'istruzione appena
// eseguita. «table scans (full)» non esiste davvero in v$statname (i nomi
// reali distinguono tabelle corte e lunghe, ed è per questo che ci sono
// entrambi): un nome assente non torna dalla query e non fa danno.
const STAT_NAMES = [
  'session logical reads',
  'consistent gets',
  'db block gets',
  'physical reads',
  'redo size',
  'sorts (memory)',
  'sorts (disk)',
  'table scans (full)',
  'table scans (short tables)',
  'table scans (long tables)',
  'bytes sent via SQL*Net to client',
  'parse count (hard)',
  'recursive calls',
];

const STAT_BINDS = Object.fromEntries(STAT_NAMES.map((n, i) => [`s${i}`, n]));
const STATS_SQL =
  `SELECT n.name, m.value FROM v$mystat m JOIN v$statname n ON n.statistic# = m.statistic# ` +
  `WHERE n.name IN (${STAT_NAMES.map((_, i) => `:s${i}`).join(', ')})`;

const NOTE_PRIV =
  'Statistiche reali non disponibili: servono i privilegi SELECT ON V_$SESSION, V_$MYSTAT, ' +
  'V_$STATNAME, V_$SQL_PLAN_STATISTICS_ALL. Il piano qui sotto è quello stimato da EXPLAIN PLAN, ' +
  'non quello effettivamente eseguito, e non riporta righe e tempi reali.';

// Caso più raro: il piano reale si legge ma le statistiche di sessione no.
const NOTE_STATS =
  'Statistiche di sessione non disponibili: servono i privilegi SELECT ON V_$MYSTAT e V_$STATNAME.';

async function readSessionStats(session) {
  try {
    const r = await session.execute(STATS_SQL, STAT_BINDS, {
      outFormat: oracledb.OUT_FORMAT_ARRAY,
    });
    return new Map(r.rows.map(([name, value]) => [name, Number(value)]));
  } catch {
    return null;
  }
}

function statDelta(before, after) {
  if (!before || !after) return [];
  const out = [];
  for (const name of STAT_NAMES) {
    if (!before.has(name) || !after.has(name)) continue;
    const value = after.get(name) - before.get(name);
    // Le statistiche rimaste a zero non dicono niente e allungano l'elenco.
    if (value) out.push({ name, value });
  }
  return out;
}

// Le righe si scorrono e si buttano: dell'autotrace interessano il piano e le
// statistiche, non i dati — tenerli in memoria costerebbe e non li guarda
// nessuno. Contarle serve invece a confrontare stimato ed effettivo.
async function drainRows(rs, maxRows) {
  let n = 0;
  try {
    while (n < maxRows) {
      const want = Math.min(200, maxRows - n);
      const batch = await rs.getRows(want);
      n += batch.length;
      if (batch.length < want) break;
    }
  } finally {
    await rs.close().catch(() => {});
  }
  return n;
}

// L'identificativo del cursore appena eseguito va preso subito dopo
// l'esecuzione: prev_sql_id è «l'istruzione precedente della sessione», e
// qualsiasi altra query (a partire dalla rilettura delle statistiche) lo
// sostituirebbe. Per lo stesso motivo poi si passa il cursore per id a
// display_cursor invece di lasciarlo cercare da solo.
async function prevCursor(session) {
  try {
    const r = await session.execute(
      `SELECT prev_sql_id, prev_child_number FROM v$session WHERE sid = sys_context('userenv', 'sid')`
    );
    const row = r.rows?.[0];
    return row?.[0] ? { sqlId: row[0], childNo: row[1] ?? 0 } : null;
  } catch {
    return null;
  }
}

// Piano realmente eseguito, con le colonne LAST_* delle statistiche di riga.
// Torna null se le viste v$ non sono leggibili: chi chiama ripiega sulla stima.
async function realPlan(session, cursor) {
  const binds = { sqlId: cursor.sqlId, childNo: cursor.childNo };
  try {
    const t = await session.execute(
      `SELECT plan_table_output FROM TABLE(dbms_xplan.display_cursor(:sqlId, :childNo, 'ALLSTATS LAST'))`,
      binds,
      { outFormat: oracledb.OUT_FORMAT_ARRAY, maxRows: 2000 }
    );
    const nodes = await planNodesFrom(
      session,
      'v$sql_plan_statistics_all WHERE sql_id = :sqlId AND child_number = :childNo',
      CURSOR_STATS,
      binds
    ).catch(() => []);
    return { text: t.rows.map((x) => x[0]).join('\n'), nodes };
  } catch {
    return null;
  }
}

async function autotrace(entry, sql, binds, maxRows) {
  const session = entry.session;
  const out = { rowsFetched: 0, elapsedMs: 0, stats: [], nodes: [], text: '' };

  // È statistics_level = ALL a riempire le colonne LAST_* del piano: senza,
  // il piano reale c'è ma senza righe e tempi effettivi.
  const detailed = await tryExec(session, `ALTER SESSION SET statistics_level = ALL`);
  try {
    const before = await readSessionStats(session);

    const t0 = performance.now();
    entry.executing = true;
    let cursor = null;
    try {
      const r = await session.execute(sql, binds, {
        outFormat: oracledb.OUT_FORMAT_ARRAY,
        resultSet: true,
        autoCommit: false,
      });
      if (r.resultSet) out.rowsFetched = await drainRows(r.resultSet, maxRows);
      else out.rowsAffected = r.rowsAffected ?? 0;
      const outBinds = serializeOutBinds(r);
      if (outBinds) out.outBinds = outBinds;
      out.elapsedMs = Math.round(performance.now() - t0);
      cursor = await prevCursor(session);
    } catch (err) {
      out.elapsedMs = Math.round(performance.now() - t0);
      out.error = { message: err.message, offset: err.offset, num: err.errorNum };
      return out;
    } finally {
      entry.executing = false;
    }

    const after = await readSessionStats(session);
    out.stats = statDelta(before, after);

    const real = cursor ? await realPlan(session, cursor) : null;
    // dbms_xplan.display_cursor non lancia quando i privilegi mancano o il
    // cursore non è più nella shared pool: restituisce il motivo come testo,
    // con zero nodi. È l'assenza di nodi, non un'eccezione, a dire che il
    // piano reale non c'è e che bisogna ripiegare sulla stima.
    if (real && real.nodes.length) {
      out.text = real.text;
      out.nodes = real.nodes;
      if (!detailed) {
        out.note =
          'Non è stato possibile impostare statistics_level = ALL: righe e tempi effettivi ' +
          'del piano possono mancare.';
      }
    } else {
      // Il testo restituito da display_cursor, quando c'è, è la diagnosi di
      // Oracle su cosa manca: vale più di qualunque frase generica.
      const why = real?.text?.trim();
      out.note = why ? `${NOTE_PRIV} — Oracle risponde: ${firstLine(why)}` : NOTE_PRIV;
      try {
        const est = await explainPlan(session, sql, binds);
        out.text = est.text;
        out.nodes = est.nodes;
      } catch (err) {
        out.note = `${out.note} (${err.message})`;
      }
    }
    if ((!before || !after) && !out.note) out.note = NOTE_STATS;
    return out;
  } finally {
    // Sempre, anche se l'istruzione è fallita: statistics_level = ALL costa
    // caro e non deve restare acceso sulla sessione del foglio.
    if (detailed) await tryExec(session, `ALTER SESSION SET statistics_level = TYPICAL`);
    // Se non lo si svuota qui, le righe prodotte durante l'autotrace escono
    // dal buffer alla prima esecuzione successiva e sembrano sue.
    out.dbmsOutput = await getDbmsOutput(session);
    out.txnOpen = await getTxnOpen(session);
  }
}

router.post(
  '/autotrace',
  a(async (req, res) => {
    const { sql } = req.body;
    const maxRows = Math.min(MAX_ROWS_CAP, Number(req.body.maxRows) || 500);
    if (!sql?.trim()) return res.status(400).json({ error: 'Nessuna istruzione da eseguire' });
    const entry = req.oraEntry;

    let binds;
    try {
      // L'autotrace esegue davvero: su una connessione in sola lettura vale
      // esattamente il divieto di /execute.
      assertWritable(entry, sql);
      binds = toOracleBinds(req.body.binds);
    } catch (err) {
      // I campi vuoti servono a chi disegna il pannello: la forma della
      // risposta resta quella di sempre anche quando è un rifiuto.
      return res.json({ ...refuse(req.params.id, sql, err), stats: [], nodes: [], text: '' });
    }

    const payload = await runExclusive(entry, () => autotrace(entry, sql, binds, maxRows));
    history.add({
      connId: req.params.id,
      sql,
      ok: !payload.error,
      errorMessage: payload.error?.message,
      rows: payload.rowsFetched,
      rowsAffected: payload.rowsAffected,
      elapsedMs: payload.elapsedMs,
    });
    res.json(payload);
  })
);

// ------------------------------------------------------------ sessione ----

router.post(
  '/commit',
  a(async (req, res) => {
    const entry = req.oraEntry;
    try {
      assertWritable(entry, 'COMMIT');
    } catch (err) {
      return res.json({ error: { message: err.message, readOnly: true } });
    }
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
      readOnly: !!entry.readOnly,
    });
  })
);

export default router;
