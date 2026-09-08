import { Router } from 'express';
import oracledb from 'oracledb';
import { withPooled, runExclusive } from '../pools.js';
import { gridQuery, serializeValue } from '../oracle.js';

// Ambito DBA. Tutto quello che c'è qui legge viste V$/DBA_ che un'utenza
// applicativa quasi mai può leggere: la mancanza di privilegi non è un guasto,
// è uno stato previsto. Perciò nessuna rotta risponde con un errore HTTP per
// questo motivo — lo stato resta 200 e nel corpo arriva `{ error: '…' }` che
// dice quale privilegio manca, così la UI mostra il motivo al posto della
// griglia. `/dba/capabilities` permette di saperlo in anticipo e spegnere le
// sezioni inaccessibili invece di farle fallire una per una.

const router = Router({ mergeParams: true });
const a = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const MAX_SESSIONS = 2000;
const MAX_LOCKS = 2000;
const MAX_TABLESPACES = 1000;
const MAX_WAITS = 500;
const TOP_SQL_MAX = 100;
const TOP_SQL_DEFAULT = 25;

// «Vista assente o non concessa»: per Oracle sono la stessa cosa vista da due
// angoli (ORA-00942 quando manca del tutto il permesso di vederla, ORA-01031
// quando il privilegio non basta).
const NO_PRIV = /ORA-00942|ORA-01031/;
// Motivi per cui vale la pena riprovare con una variante più povera della
// stessa query: oltre ai privilegi, la colonna che non esiste (ORA-00904) su
// versioni di Oracle più vecchie di quelle su cui è stata scritta la query.
const RETRYABLE = /ORA-00942|ORA-01031|ORA-00904/;

// Le V$ sono sinonimi pubblici sulle tabelle fisse V_$…, e un GRANT SELECT si
// dà sull'oggetto vero, non sul sinonimo: il messaggio lo dice esplicitamente
// perché è l'errore in cui inciampa chi prova a concedere il permesso.
const grantTarget = (view) => view.replace(/^(G?V)\$/, '$1_$$');

const privMessage = (view) =>
  `Servono i privilegi di lettura su ${view} (SELECT_CATALOG_ROLE o GRANT SELECT ON ${grantTarget(
    view
  )})`;

// Un errore di privilegi diventa il messaggio della sezione; qualunque altro
// errore resta quello di Oracle, che a quel punto è un'informazione vera.
function sectionError(err, view) {
  return { error: NO_PRIV.test(err.message || '') ? privMessage(view) : err.message };
}

// Prova le varianti in ordine e restituisce la prima che il database accetta.
// Serve perché una sezione si appoggia a più viste con privilegi indipendenti
// (V$SESSION concessa ma non V$SQL, DBA_DATA_FILES ma non le metriche…): le
// varianti successive sono le stesse colonne calcolate con meno fonti, così la
// griglia non cambia forma a seconda dei grant.
async function firstReadable(entry, variants, maxRows) {
  let last;
  for (const v of variants) {
    try {
      return await gridQuery(entry, v.sql, v.binds || {}, maxRows);
    } catch (err) {
      if (!RETRYABLE.test(err.message || '')) throw err;
      last = err;
    }
  }
  throw last;
}

async function sendGrid(res, entry, view, variants, maxRows) {
  try {
    res.json(await firstReadable(entry, variants, maxRows));
  } catch (err) {
    res.json(sectionError(err, view));
  }
}

// SID e Serial# finiscono dentro un'istruzione ALTER SYSTEM, dove non esistono
// bind: l'unico modo sicuro di usarli è accettarli solo se sono interi.
function asInt(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

// ---------------------------------------------------------------- capabilities

// Una vista per area: se questa risponde, la sezione ha senso. `instance` fa
// eccezione — la sua rotta risponde comunque, con il ripiego su sys_context,
// anche quando qui risulta `false`.
const CAPABILITY_VIEWS = {
  sessions: 'v$session',
  locks: 'v$lock',
  tablespaces: 'dba_data_files',
  instance: 'v$instance',
  topSql: 'v$sqlarea',
  waits: 'v$system_event',
};

router.get(
  '/capabilities',
  a(async (req, res) => {
    const caps = await withPooled(req.oraEntry, async (c) => {
      const out = {};
      for (const [key, view] of Object.entries(CAPABILITY_VIEWS)) {
        // `ROWNUM = 1` perché a interessare è solo se la vista si apre: su
        // V$SQLAREA leggere tutto costerebbe come la sezione vera.
        out[key] = await c
          .execute(`SELECT 1 FROM ${view} WHERE ROWNUM = 1`)
          .then(() => true, () => false);
      }
      return out;
    });
    res.json(caps);
  })
);

// -------------------------------------------------------------------- sessions

function sessionsSql({ withSql, withStat, onlyActive, hasUser }) {
  // Le sessioni di background (type = 'BACKGROUND') sono i processi di Oracle:
  // non sono quello che si cerca quando si guarda «chi è collegato».
  const where = [`s.type = 'USER'`];
  if (onlyActive) where.push(`s.status = 'ACTIVE'`);
  // Il segnaposto non può chiamarsi come la parola riservata USER: Oracle non
  // lo riconoscerebbe come bind. Di qui il nome italiano.
  if (hasUser) where.push(`UPPER(s.username) LIKE '%' || UPPER(:filtro_utente) || '%'`);
  const sqlText = withSql
    ? `SUBSTR(q.sql_text, 1, 200)`
    : `CAST(NULL AS VARCHAR2(200))`;
  const reads = withStat
    ? `(SELECT st.value FROM v$sesstat st
         WHERE st.sid = s.sid
           AND st.statistic# = (SELECT n.statistic# FROM v$statname n
                                 WHERE n.name = 'session logical reads'))`
    : `CAST(NULL AS NUMBER)`;
  return `
    SELECT s.sid "SID",
           s.serial# "Serial#",
           s.username "Utente",
           s.status "Stato",
           s.machine "Macchina",
           s.program "Programma",
           s.module "Modulo",
           s.action "Azione",
           TO_CHAR(s.logon_time, 'YYYY-MM-DD HH24:MI:SS') "Login",
           s.last_call_et "Inattivo da (s)",
           s.sql_id "SQL ID",
           ${sqlText} "SQL",
           s.event "Evento di attesa",
           s.wait_class "Classe di attesa",
           s.blocking_session "Bloccata da",
           ${reads} "Logical reads"
      FROM v$session s${
        withSql
          ? `
      LEFT JOIN v$sql q ON q.sql_id = s.sql_id AND q.child_number = s.sql_child_number`
          : ''
      }
     WHERE ${where.join('\n       AND ')}
     ORDER BY DECODE(s.status, 'ACTIVE', 0, 1), s.sid`;
}

router.get(
  '/sessions',
  a(async (req, res) => {
    const onlyActive = req.query.onlyActive === '1' || req.query.onlyActive === 'true';
    const user = String(req.query.user || '').trim();
    const binds = user ? { filtro_utente: user } : {};
    const opts = { onlyActive, hasUser: !!user };
    // Chi ha SELECT_CATALOG_ROLE legge tutto; chi ha solo un GRANT mirato su
    // V_$SESSION perde prima le statistiche, poi il testo dell'istruzione.
    const variants = [
      { sql: sessionsSql({ ...opts, withSql: true, withStat: true }), binds },
      { sql: sessionsSql({ ...opts, withSql: true, withStat: false }), binds },
      { sql: sessionsSql({ ...opts, withSql: false, withStat: false }), binds },
    ];
    await sendGrid(res, req.oraEntry, 'V$SESSION', variants, MAX_SESSIONS);
  })
);

// ----------------------------------------------------------------- session-sql

router.get(
  '/session-sql',
  a(async (req, res) => {
    const sid = asInt(req.query.sid);
    const serial = asInt(req.query.serial);
    if (sid === null || serial === null) {
      return res.status(400).json({ error: 'SID e Serial# devono essere numeri interi' });
    }
    try {
      const payload = await withPooled(req.oraEntry, async (c) => {
        // Una sessione ferma non ha più `sql_id` ma conserva `prev_sql_id`:
        // l'ultima istruzione eseguita è esattamente quello che si vuole
        // vedere quando si chiede «cosa stava facendo».
        const r = await c.execute(
          `SELECT NVL(s.sql_id, s.prev_sql_id), q.sql_text, q.sql_fulltext
             FROM v$session s
             LEFT JOIN v$sql q
               ON q.sql_id = NVL(s.sql_id, s.prev_sql_id)
              AND q.child_number = NVL(s.sql_child_number, s.prev_child_number)
            WHERE s.sid = :sid AND s.serial# = :serial`,
          { sid, serial },
          { outFormat: oracledb.OUT_FORMAT_ARRAY }
        );
        if (!r.rows.length) {
          return { error: 'Sessione non trovata: potrebbe essere già terminata' };
        }
        const [sqlId, sqlText, fullText] = r.rows[0];
        let full = serializeValue(fullText);
        // V$SQL può aver già scartato il cursore: i pezzi da 64 caratteri di
        // V$SQLTEXT_WITH_NEWLINES sopravvivono più a lungo e vanno ricuciti.
        if (!full && sqlId) {
          const pieces = await c
            .execute(
              `SELECT sql_text FROM v$sqltext_with_newlines
                WHERE sql_id = :sqlId ORDER BY piece`,
              { sqlId },
              { outFormat: oracledb.OUT_FORMAT_ARRAY, maxRows: 5000 }
            )
            .catch(() => null);
          if (pieces) full = pieces.rows.map((x) => x[0]).join('');
        }
        return {
          sqlId: sqlId || null,
          sql: serializeValue(sqlText) || null,
          sqlFullText: full || null,
        };
      });
      res.json(payload);
    } catch (err) {
      res.json(sectionError(err, 'V$SESSION'));
    }
  })
);

// ---------------------------------------------------------------- kill-session

function killMessage(err) {
  const m = err.message || '';
  if (m.includes('ORA-01031')) {
    return 'Privilegi insufficienti: per terminare una sessione serve ALTER SYSTEM (di norma il ruolo DBA)';
  }
  if (m.includes('ORA-00031')) {
    return 'Sessione già marcata per la terminazione: Oracle la chiuderà appena avrà finito l\'operazione in corso';
  }
  if (m.includes('ORA-00030')) return 'Sessione inesistente: probabilmente è già terminata';
  if (m.includes('ORA-00027')) return 'Non si può terminare la sessione da cui parte il comando';
  return m;
}

// SID della sessione dedicata al foglio SQL: è l'unica che non va mai uccisa,
// perché con lei se ne va la transazione aperta dell'utente. Lo legge già
// `pools.connect()` all'apertura, ed è lì che va preso: chiederlo adesso alla
// sessione non funzionerebbe proprio nel caso che conta — quando sta eseguendo
// un'istruzione lunga, che è anche l'unico momento in cui compare fra le
// sessioni attive e viene voglia di terminarla.
async function worksheetSid(entry) {
  if (entry.sid) return entry.sid;
  if (entry.executing) return null;
  try {
    const sid = await runExclusive(entry, async () => {
      const r = await entry.session.execute(`SELECT sys_context('userenv', 'sid') FROM dual`);
      return Number(r.rows[0][0]);
    });
    // Da qui in poi è noto anche a sessione occupata.
    if (sid) entry.sid = sid;
    return sid;
  } catch {
    return null;
  }
}

router.post(
  '/kill-session',
  a(async (req, res) => {
    const sid = asInt(req.body.sid);
    const serial = asInt(req.body.serial);
    if (sid === null || serial === null) {
      return res.status(400).json({ error: 'SID e Serial# devono essere numeri interi' });
    }
    // Il blocco lato client (voce di menu disabilitata) non è una difesa: la
    // rotta è raggiungibile lo stesso, ed è l'unica azione distruttiva del
    // monitor. Tutte le altre rotte che scrivono passano da `assertWritable`.
    if (req.oraEntry.readOnly) {
      return res.json({
        error: 'Connessione in sola lettura: terminare una sessione non è consentito',
      });
    }
    const immediate = req.body.immediate === true || req.body.immediate === '1';
    const mine = await worksheetSid(req.oraEntry);
    try {
      const out = await withPooled(req.oraEntry, async (c) => {
        const own = await c.execute(`SELECT sys_context('userenv', 'sid') FROM dual`);
        if (sid === Number(own.rows[0][0]) || sid === mine) {
          return { error: 'Questa è la sessione con cui Orabridge è collegato: non si può terminare' };
        }
        // sid e serial sono già passati da asInt(): qui dentro non arriva mai
        // testo dell'utente, ed è l'unico modo — ALTER SYSTEM non ammette bind.
        await c.execute(
          `ALTER SYSTEM KILL SESSION '${sid},${serial}'${immediate ? ' IMMEDIATE' : ''}`
        );
        return { ok: true, message: `Sessione ${sid},${serial} terminata` };
      });
      res.json(out);
    } catch (err) {
      res.json({ error: killMessage(err) });
    }
  })
);

// ----------------------------------------------------------------------- locks

function locksSql({ objects, withSql }) {
  // Il nome dell'oggetto ha senso solo per i lock TM (lock di tabella): per un
  // TX l'id1 è il numero dello slot di undo, non un object_id.
  const oggetto = objects
    ? `CASE WHEN w.ltype = 'TM' THEN
             (SELECT o.owner || '.' || o.object_name FROM ${objects} o
               WHERE o.object_id = w.obj_id AND ROWNUM = 1)
        END`
    : `CAST(NULL AS VARCHAR2(200))`;
  const sqlBloccato = withSql
    ? `(SELECT SUBSTR(q.sql_text, 1, 200) FROM v$sql q
         WHERE q.sql_id = ws.sql_id AND q.child_number = ws.sql_child_number)`
    : `CAST(NULL AS VARCHAR2(200))`;
  return `
    SELECT bs.sid || ',' || bs.serial# "Sessione bloccante",
           bs.username "Utente bloccante",
           ws.sid || ',' || ws.serial# "Sessione bloccata",
           ws.username "Utente bloccato",
           NVL(DECODE(w.ltype, 'TM', 'TM (tabella)',
                               'TX', 'TX (transazione)',
                               'UL', 'UL (utente)', w.ltype), 'da v$session') "Tipo",
           DECODE(w.req_mode, 1, 'Null', 2, 'Row share', 3, 'Row exclusive',
                              4, 'Share', 5, 'Share row exclusive', 6, 'Exclusive',
                              TO_CHAR(w.req_mode)) "Modo",
           ${oggetto} "Oggetto",
           w.secs "Attesa (s)",
           ${sqlBloccato} "SQL bloccato"
      FROM (
             SELECT lw.sid waiter, lb.sid blocker, lw.type ltype,
                    lw.request req_mode, lw.id1 obj_id, lw.ctime secs
               FROM v$lock lw
               JOIN v$lock lb
                 ON lb.id1 = lw.id1 AND lb.id2 = lw.id2 AND lb.type = lw.type
                AND lb.lmode > 0 AND lb.sid <> lw.sid
              WHERE lw.request > 0
             UNION ALL
             SELECT s.sid, s.blocking_session, CAST(NULL AS VARCHAR2(2)),
                    CAST(NULL AS NUMBER), CAST(NULL AS NUMBER), s.seconds_in_wait
               FROM v$session s
              WHERE s.blocking_session IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM v$lock l2
                                 WHERE l2.sid = s.sid AND l2.request > 0)
           ) w
      JOIN v$session ws ON ws.sid = w.waiter
      JOIN v$session bs ON bs.sid = w.blocker
     ORDER BY w.secs DESC NULLS LAST`;
}

router.get(
  '/locks',
  a(async (req, res) => {
    // Le due fonti dicono cose diverse: V$LOCK sa *quale* lock si aspetta,
    // `blocking_session` di V$SESSION vede anche le attese che un lock non lo
    // sono (buffer busy, ITL…). La seconda riempie solo i buchi della prima
    // (il NOT EXISTS), così una stessa attesa non compare due volte.
    const variants = [
      { sql: locksSql({ objects: 'dba_objects', withSql: true }) },
      { sql: locksSql({ objects: 'all_objects', withSql: true }) },
      { sql: locksSql({ objects: 'all_objects', withSql: false }) },
    ];
    await sendGrid(res, req.oraEntry, 'V$LOCK', variants, MAX_LOCKS);
  })
);

// ----------------------------------------------------------------- tablespaces

// I file di dati e quelli temporanei si contano allo stesso modo: un
// tablespace sta in una sola delle due viste, quindi la UNION ALL non duplica
// nulla. `GREATEST` perché con l'autoextend spento maxbytes vale 0.
const TS_FILES = `
  SELECT tablespace_name,
         SUM(bytes) bytes,
         SUM(GREATEST(bytes, DECODE(autoextensible, 'YES', maxbytes, bytes))) max_bytes,
         COUNT(*) files
    FROM dba_data_files
   GROUP BY tablespace_name
   UNION ALL
  SELECT tablespace_name,
         SUM(bytes),
         SUM(GREATEST(bytes, DECODE(autoextensible, 'YES', maxbytes, bytes))),
         COUNT(*)
    FROM dba_temp_files
   GROUP BY tablespace_name`;

const TS_HEAD = `
  SELECT ts.tablespace_name "Nome",
         ts.contents "Tipo",
         ts.extent_management "Gestione",
         ts.status "Stato",
         ROUND(d.bytes / 1048576, 2) "MB totali",`;

const TS_TAIL = `
    FROM dba_tablespaces ts
    LEFT JOIN (${TS_FILES}) d ON d.tablespace_name = ts.tablespace_name`;

// Variante preferita: DBA_TABLESPACE_USAGE_METRICS conosce già la percentuale
// «vera», quella sul massimo raggiungibile con l'autoextend, e copre anche i
// tablespace temporanei senza passare da V$ (che potrebbe non essere concessa).
const TS_METRICS = `${TS_HEAD}
         ROUND(m.used_space * ts.block_size / 1048576, 2) "MB usati",
         ROUND((d.bytes - m.used_space * ts.block_size) / 1048576, 2) "MB liberi",
         ROUND(m.used_percent, 1) "% usata",
         ROUND(m.tablespace_size * ts.block_size / 1048576, 2) "MB massimi",
         d.files "File"${TS_TAIL}
    LEFT JOIN dba_tablespace_usage_metrics m ON m.tablespace_name = ts.tablespace_name
   ORDER BY "% usata" DESC NULLS LAST`;

// Ripiego: lo spazio libero si ricava sottraendo. Per i tablespace temporanei
// serve V$TEMP_SPACE_HEADER, perché DBA_FREE_SPACE non li contiene.
const tsFromFreeSpace = (withTemp) => {
  // Senza V$TEMP_SPACE_HEADER, per un tablespace temporaneo DBA_FREE_SPACE non
  // restituisce niente: sottrarre zero lo farebbe risultare pieno al 100% e la
  // barra rossa griderebbe al disco pieno su ogni database. Meglio dichiarare
  // che non si sa: la UI mostra «—».
  const known = (expr) => (withTemp ? expr : `CASE WHEN ts.contents <> 'TEMPORARY' THEN ${expr} END`);
  return `${TS_HEAD}
         ${known('ROUND((d.bytes - NVL(fs.bytes, 0)) / 1048576, 2)')} "MB usati",
         ${known('ROUND(NVL(fs.bytes, 0) / 1048576, 2)')} "MB liberi",
         ${known('ROUND((d.bytes - NVL(fs.bytes, 0)) * 100 / NULLIF(d.max_bytes, 0), 1)')} "% usata",
         ROUND(d.max_bytes / 1048576, 2) "MB massimi",
         d.files "File"${TS_TAIL}
    LEFT JOIN (
           SELECT tablespace_name, SUM(bytes) bytes FROM dba_free_space
            GROUP BY tablespace_name${
              withTemp
                ? `
            UNION ALL
           SELECT tablespace_name, SUM(bytes_free) FROM v$temp_space_header
            GROUP BY tablespace_name`
                : ''
            }
         ) fs ON fs.tablespace_name = ts.tablespace_name
   ORDER BY "% usata" DESC NULLS LAST`;
};

router.get(
  '/tablespaces',
  a(async (req, res) => {
    const variants = [
      { sql: TS_METRICS },
      { sql: tsFromFreeSpace(true) },
      // Ultima spiaggia: senza V$TEMP_SPACE_HEADER dei tablespace temporanei
      // si conoscono nome e dimensione, non l'occupazione — che resta vuota.
      // Meglio elencarli senza quel dato che perdere tutta la sezione.
      { sql: tsFromFreeSpace(false) },
    ];
    await sendGrid(res, req.oraEntry, 'DBA_DATA_FILES', variants, MAX_TABLESPACES);
  })
);

// -------------------------------------------------------------------- instance

const INSTANCE_SQL = `
  SELECT instance_name, host_name, version,
         TO_CHAR(startup_time, 'YYYY-MM-DD HH24:MI:SS'), status, database_status
    FROM v$instance`;

const DATABASE_SQL = `
  SELECT name, dbid, log_mode, open_mode,
         TO_CHAR(created, 'YYYY-MM-DD HH24:MI:SS'), platform_name, database_role
    FROM v$database`;

const CTX_SQL = `
  SELECT sys_context('userenv', 'db_name'),
         sys_context('userenv', 'db_unique_name'),
         sys_context('userenv', 'instance_name'),
         sys_context('userenv', 'server_host'),
         sys_context('userenv', 'service_name'),
         sys_context('userenv', 'session_user'),
         sys_context('userenv', 'current_schema'),
         sys_context('userenv', 'database_role')
    FROM dual`;

router.get(
  '/instance',
  a(async (req, res) => {
    const entry = req.oraEntry;
    const payload = await withPooled(entry, async (c) => {
      const one = (sql) =>
        c
          .execute(sql, [], { outFormat: oracledb.OUT_FORMAT_ARRAY })
          .then((r) => r.rows[0] || null, () => null);

      // In fila e non in parallelo: sono quattro interrogazioni sulla stessa
      // connessione, e una connessione Oracle serve un'operazione per volta.
      const inst = await one(INSTANCE_SQL);
      const db = await one(DATABASE_SQL);
      const ctx = await one(CTX_SQL);
      const banner = await one(`SELECT banner FROM v$version WHERE ROWNUM = 1`);
      // PRODUCT_COMPONENT_VERSION è leggibile da chiunque: è il fondo di
      // sicurezza quando nemmeno V$VERSION è concessa.
      const product = banner
        ? null
        : await one(
            `SELECT product || ' ' || version FROM product_component_version
              WHERE product LIKE 'Oracle%' AND ROWNUM = 1`
          );

      const row = (nome, valore) => ({ nome, valore: serializeValue(valore) });
      const instance = [];
      if (inst) {
        instance.push(
          row('Istanza', inst[0]),
          row('Host', inst[1]),
          row('Versione', inst[2]),
          row('Avvio', inst[3]),
          row('Stato', inst[4]),
          row('Stato del database', inst[5])
        );
      } else {
        instance.push(
          row('Istanza', ctx?.[2]),
          row('Host', ctx?.[3]),
          row('Versione', entry.version),
          row('Fonte', 'sys_context: V$INSTANCE non leggibile con questa utenza')
        );
      }
      instance.push(row('Banner', banner ? banner[0] : product?.[0]));
      instance.push(row('Servizio', ctx?.[4]));
      instance.push(row('Utente collegato', ctx?.[5] ?? entry.user));
      instance.push(row('Schema corrente', ctx?.[6] ?? entry.currentSchema));

      const database = [];
      if (db) {
        database.push(
          row('Nome', db[0]),
          row('DBID', db[1]),
          row('Modalità log', db[2]),
          row('Modalità di apertura', db[3]),
          row('Creato il', db[4]),
          row('Piattaforma', db[5]),
          row('Ruolo', db[6])
        );
      } else {
        database.push(
          row('Nome', ctx?.[0]),
          row('Nome univoco', ctx?.[1]),
          row('Ruolo', ctx?.[7]),
          row('Fonte', 'sys_context: V$DATABASE non leggibile con questa utenza')
        );
      }
      return { instance, database };
    });

    let parameters;
    try {
      parameters = await gridQuery(
        entry,
        `SELECT name "Parametro",
                value "Valore",
                DECODE(isses_modifiable, 'TRUE', 'Sì', 'No') "Modificabile (sessione)",
                DECODE(issys_modifiable, 'FALSE', 'No', issys_modifiable) "Modificabile (sistema)",
                description "Descrizione"
           FROM v$parameter
          WHERE isdefault = 'FALSE'
          ORDER BY name`,
        {},
        1000
      );
    } catch (err) {
      parameters = sectionError(err, 'V$PARAMETER');
    }
    res.json({ ...payload, parameters });
  })
);

// --------------------------------------------------------------------- top-sql

const TOP_SQL_ORDER = {
  elapsed: 's.elapsed_time',
  cpu: 's.cpu_time',
  gets: 's.buffer_gets',
  execs: 's.executions',
  reads: 's.disk_reads',
};

router.get(
  '/top-sql',
  a(async (req, res) => {
    const order = TOP_SQL_ORDER[req.query.order] || TOP_SQL_ORDER.elapsed;
    const limit = Math.min(TOP_SQL_MAX, Math.max(1, Number(req.query.limit) || TOP_SQL_DEFAULT));
    // Top-N con la vista in linea e ROWNUM all'esterno: `FETCH FIRST` non
    // esiste prima di 12c e su 11g farebbe fallire tutta la sezione.
    const sql = `
      SELECT * FROM (
        SELECT s.sql_id "SQL ID",
               SUBSTR(s.sql_text, 1, 200) "Testo",
               s.executions "Esecuzioni",
               ROUND(s.elapsed_time / 1000000, 2) "Elapsed totale (s)",
               ROUND(s.elapsed_time / 1000 / GREATEST(s.executions, 1), 2) "Elapsed medio (ms)",
               ROUND(s.cpu_time / 1000000, 2) "CPU (s)",
               s.buffer_gets "Buffer gets",
               s.disk_reads "Disk reads",
               s.rows_processed "Righe",
               s.parsing_schema_name "Utente"
          FROM v$sqlarea s
         ORDER BY ${order} DESC NULLS LAST
      ) WHERE ROWNUM <= :lim`;
    await sendGrid(res, req.oraEntry, 'V$SQLAREA', [{ sql, binds: { lim: limit } }], limit);
  })
);

// ----------------------------------------------------------------------- waits

const SYSTEM_WAITS_SQL = `
  SELECT e.event "Evento",
         e.wait_class "Classe",
         e.total_waits "Attese totali",
         ROUND(e.time_waited_micro / 1000000, 2) "Tempo totale (s)",
         ROUND(e.time_waited_micro / 1000 / GREATEST(e.total_waits, 1), 2) "Attesa media (ms)"
    FROM v$system_event e
   WHERE e.wait_class <> 'Idle'
   ORDER BY e.time_waited_micro DESC NULLS LAST`;

const CURRENT_WAITS_SQL = `
  SELECT w.sid "SID",
         s.username "Utente",
         w.event "Evento",
         w.wait_class "Classe",
         w.state "Stato",
         w.seconds_in_wait "In attesa da (s)",
         w.p1text || ' = ' || w.p1 ||
           CASE WHEN w.p2text IS NOT NULL THEN ', ' || w.p2text || ' = ' || w.p2 END "Parametri"
    FROM v$session_wait w
    LEFT JOIN v$session s ON s.sid = w.sid
   -- Senza il filtro sullo stato la vista elenca tutte le sessioni: per quelle
   -- che non aspettano, EVENT e' l'ultima attesa conclusa e SECONDS_IN_WAIT il
   -- tempo passato da allora. Una sessione che macina CPU da dieci minuti
   -- finirebbe in cima come se fosse ferma su un'attesa di I/O.
   WHERE w.state = 'WAITING'
     AND w.wait_class <> 'Idle'
   ORDER BY w.seconds_in_wait DESC NULLS LAST`;

router.get(
  '/waits',
  a(async (req, res) => {
    const entry = req.oraEntry;
    // Le attese cumulate dall'avvio (V$SYSTEM_EVENT) e quelle in corso adesso
    // (V$SESSION_WAIT) rispondono a due domande diverse e hanno privilegi
    // separati: se la seconda non è leggibile la prima resta valida.
    const [system, current] = await Promise.all([
      firstReadable(entry, [{ sql: SYSTEM_WAITS_SQL }], MAX_WAITS).catch((err) =>
        sectionError(err, 'V$SYSTEM_EVENT')
      ),
      firstReadable(entry, [{ sql: CURRENT_WAITS_SQL }], MAX_WAITS).catch((err) =>
        sectionError(err, 'V$SESSION_WAIT')
      ),
    ]);
    // Le attese di sistema sono anche in cima alla risposta: così un client che
    // tratta la sezione come una griglia sola funziona senza saperlo.
    res.json({ ...system, system, current });
  })
);

export default router;
