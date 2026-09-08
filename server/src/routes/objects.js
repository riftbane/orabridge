import { Router } from 'express';
import oracledb from 'oracledb';
import { runExclusive, withPooled } from '../pools.js';
import { gridQuery, qi } from '../oracle.js';
import { assertWritable } from '../readonly.js';

// Gli oggetti «di sistema» dell'albero: quelli che ALL_OBJECTS non elenca con
// un tipo proprio (DB link, directory, job dello scheduler, code AQ, cestino) e
// quelli che non appartengono a uno schema (utenti, ruoli, tablespace, sinonimi
// pubblici, edition).
//
// I `type` e le `section` sono quelli di `client/src/systemObjects.js`: la
// stringa italiana della sezione arriva qui tale e quale nella query, quindi le
// due tabelle vanno tenute allineate a mano.
//
// Metà del dizionario che serve qui è fuori portata di un'utenza normale: ogni
// interrogazione è una catena di ripieghi (DBA_* → ALL_* → USER_*) e in fondo
// alla catena c'è un messaggio che dice quale privilegio manca. Una scheda che
// non si può leggere è un `{ error }`, mai un 500.

const router = Router({ mergeParams: true });
const a = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const MAX = 5000;

const needs = (view) => `Servono i privilegi di lettura su ${view}`;

// «Qui questa vista (o questa colonna) non c'è, o non la posso leggere»:
// ORA-00942 vista inesistente, ORA-01031 privilegi insufficienti, ORA-00904
// colonna assente (viste che cambiano forma fra le versioni), ORA-00980
// sinonimo non più valido. Sono gli unici casi in cui ha senso passare al
// ripiego invece di riportare l'errore: un ORA-01013 (esecuzione annullata) o
// un errore di rete devono restare visibili.
const FALLBACK_ERRORS = new Set([942, 1031, 904, 980]);

const isFallbackError = (err) =>
  FALLBACK_ERRORS.has(err.errorNum) || /ORA-0*(?:942|1031|904|980)\b/.test(err.message || '');

// Prova le query in ordine e restituisce le righe della prima che risponde,
// insieme all'indice (`from`) di quale ha risposto: serve a dire nell'elenco
// che si sta guardando un ripiego che vede meno cose.
async function firstRows(entry, candidates) {
  for (let i = 0; i < candidates.length; i++) {
    try {
      const rows = await withPooled(entry, async (c) => {
        const r = await c.execute(candidates[i].sql, candidates[i].binds ?? {}, {
          outFormat: oracledb.OUT_FORMAT_ARRAY,
          maxRows: MAX + 1,
        });
        return r.rows;
      });
      return { rows, from: i };
    } catch (err) {
      if (!isFallbackError(err)) throw err;
    }
  }
  return null;
}

// Stessa catena, ma per le sezioni di dettaglio: il risultato è già la forma
// griglia. `missing` è il testo da mostrare quando nessuna query ha risposto.
async function firstGrid(entry, candidates, missing) {
  for (const c of candidates) {
    try {
      return await gridQuery(entry, c.sql, c.binds ?? {}, c.maxRows ?? MAX);
    } catch (err) {
      if (!isFallbackError(err)) return { error: err.message };
    }
  }
  return { error: missing };
}

// Impacchetta le righe nella forma dell'elenco dell'albero. `notes[i]` è la
// nota da allegare quando ha risposto la i-esima query: il ripiego su una
// vista più povera va detto, altrimenti l'elenco sembra solo corto.
function toItems(found, map, { missing, notes } = {}) {
  if (!found) return { items: [], truncated: false, note: missing };
  const truncated = found.rows.length > MAX;
  const rows = truncated ? found.rows.slice(0, MAX) : found.rows;
  const out = { items: rows.map(map), truncated };
  const note = notes?.[found.from];
  if (note) out.note = note;
  return out;
}

// Il cestino ha una vista per lo schema corrente e una per tutti gli altri:
// sapere in quale dei due casi siamo evita di chiedere DBA_RECYCLEBIN quando
// USER_RECYCLEBIN basta e avanza.
const isCurrentSchema = (entry, owner) =>
  !!owner && (owner === entry.currentSchema || owner === entry.user);

// ---------------------------------------------------------------------------
// Elenchi (una cartella dell'albero)
// ---------------------------------------------------------------------------

// Il pallino accanto al nome si accende quando `status` non è 'VALID': lo si
// usa per gli stati che valgono un'occhiata (job disabilitato, account
// bloccato, tablespace offline), non per ripetere l'ovvio.
const jobStatus = (enabled, state) => {
  if (enabled !== 'TRUE') return 'DISABLED';
  return state === 'BROKEN' || state === 'FAILED' ? state : 'VALID';
};

const EXTRA_LIST = {
  DB_LINK: async (entry, { owner }) => {
    // I link pubblici stanno in ALL_DB_LINKS con owner 'PUBLIC': filtrando per
    // owner compaiono nella cartella dello pseudo-schema PUBLIC e non vengono
    // ripetuti sotto ogni utente.
    const found = await firstRows(entry, [
      {
        sql: `SELECT db_link, host FROM all_db_links WHERE owner = :owner ORDER BY db_link`,
        binds: { owner },
      },
    ]);
    return toItems(found, ([name, host]) => ({ name, extra: host || null }), {
      missing: needs('ALL_DB_LINKS'),
    });
  },

  SCHEDULER_JOB: async (entry, { owner }) => {
    const found = await firstRows(entry, [
      {
        sql: `SELECT job_name, enabled, state FROM all_scheduler_jobs
               WHERE owner = :owner ORDER BY job_name`,
        binds: { owner },
      },
    ]);
    return toItems(
      found,
      ([name, enabled, state]) => ({
        name,
        status: jobStatus(enabled, state),
        extra: state,
      }),
      { missing: needs('ALL_SCHEDULER_JOBS') }
    );
  },

  QUEUE: async (entry, { owner }) => {
    const found = await firstRows(entry, [
      {
        sql: `SELECT name, queue_table, queue_type, enqueue_enabled, dequeue_enabled
                FROM all_queues WHERE owner = :owner ORDER BY name`,
        binds: { owner },
      },
    ]);
    return toItems(
      found,
      ([name, table, type, enq, deq]) => ({
        name,
        status: enq === 'NO' && deq === 'NO' ? 'DISABLED' : 'VALID',
        // Le code di eccezione le crea Oracle insieme alla tabella delle code:
        // restano in elenco (è lì che finiscono i messaggi non consumati, e
        // guardarci dentro è metà del lavoro) ma vanno riconosciute a colpo
        // d'occhio, altrimenti sembrano code applicative.
        extra: type === 'EXCEPTION_QUEUE' ? 'coda di eccezione' : table,
      }),
      { missing: needs('ALL_QUEUES') }
    );
  },

  RECYCLEBIN: async (entry, { owner }) => {
    // Solo le tabelle: indici, trigger e segmenti LOB finiscono nel cestino
    // come voci separate ma tornano indietro insieme alla loro tabella, e le
    // due azioni disponibili (FLASHBACK / PURGE TABLE) valgono solo per quelle.
    const candidates = [];
    if (isCurrentSchema(entry, owner)) {
      candidates.push({
        sql: `SELECT object_name, original_name, droptime FROM user_recyclebin
               WHERE type = 'TABLE' ORDER BY object_name`,
      });
    }
    candidates.push({
      sql: `SELECT object_name, original_name, droptime FROM dba_recyclebin
             WHERE owner = :owner AND type = 'TABLE' ORDER BY object_name`,
      binds: { owner },
    });
    const found = await firstRows(entry, candidates);
    const map = ([name, original, droptime]) => ({ name, extra: `${original} · ${droptime}` });
    return toItems(found, map, {
      missing: `${needs('DBA_RECYCLEBIN')} per vedere il cestino di un altro schema`,
    });
  },

  DIRECTORY: async (entry) => {
    const found = await firstRows(entry, [
      {
        sql: `SELECT directory_name, directory_path FROM all_directories
               ORDER BY directory_name`,
      },
    ]);
    return toItems(found, ([name, path]) => ({ name, extra: path }), {
      missing: needs('ALL_DIRECTORIES'),
    });
  },

  USER: async (entry) => {
    // Lo stato dell'account (bloccato, scaduto) esiste solo in DBA_USERS:
    // senza privilegi si ripiega su ALL_USERS, che dà i nomi e basta.
    const found = await firstRows(entry, [
      { sql: `SELECT username, account_status FROM dba_users ORDER BY username` },
      { sql: `SELECT username, NULL FROM all_users ORDER BY username` },
    ]);
    return toItems(found, ([name, status]) => ({
      name,
      status: !status || status === 'OPEN' ? 'VALID' : status,
    }));
  },

  ROLE: async (entry) => {
    const found = await firstRows(entry, [
      { sql: `SELECT role, password_required FROM dba_roles ORDER BY role` },
      { sql: `SELECT role, NULL FROM session_roles ORDER BY role` },
    ]);
    const map = ([name, password]) => ({ name, extra: password === 'YES' ? 'con password' : null });
    return toItems(found, map, {
      missing: needs('DBA_ROLES'),
      notes: [
        null,
        'Senza i privilegi di lettura su DBA_ROLES si vedono solo i ruoli attivi nella sessione.',
      ],
    });
  },

  TABLESPACE: async (entry) => {
    const found = await firstRows(entry, [
      {
        sql: `SELECT tablespace_name, status, contents FROM dba_tablespaces
               ORDER BY tablespace_name`,
      },
      {
        sql: `SELECT tablespace_name, status, contents FROM user_tablespaces
               ORDER BY tablespace_name`,
      },
    ]);
    return toItems(
      found,
      ([name, status, contents]) => ({
        name,
        status: status === 'ONLINE' ? 'VALID' : status,
        extra: contents,
      }),
      {
        missing: needs('DBA_TABLESPACES'),
        notes: [
          null,
          'Senza i privilegi di lettura su DBA_TABLESPACES si vedono solo i tablespace ' +
            "su cui l'utenza ha una quota.",
        ],
      }
    );
  },

  PUBLIC_SYNONYM: async (entry, { filter }) => {
    // Su un database vero sono decine di migliaia: il tetto va messo in SQL
    // (ROWNUM su una vista in linea ordinata: OFFSET/FETCH non esiste su 11g)
    // e il filtro per prefisso è l'unico modo sensato di arrivarci.
    const where = filter ? ` AND synonym_name LIKE UPPER(:filter) || '%'` : '';
    const found = await firstRows(entry, [
      {
        sql: `SELECT * FROM (
                SELECT synonym_name, table_owner, table_name
                  FROM all_synonyms
                 WHERE owner = 'PUBLIC'${where}
                 ORDER BY synonym_name
              ) WHERE ROWNUM <= :max`,
        binds: filter ? { filter, max: MAX + 1 } : { max: MAX + 1 },
      },
    ]);
    return toItems(
      found,
      ([name, tableOwner, tableName]) => ({
        name,
        extra: tableOwner ? `${tableOwner}.${tableName}` : tableName,
      }),
      { missing: needs('ALL_SYNONYMS') }
    );
  },

  EDITION: async (entry) => {
    const found = await firstRows(entry, [
      {
        sql: `SELECT edition_name, parent_edition_name FROM all_editions
               ORDER BY edition_name`,
      },
    ]);
    return toItems(found, ([name, parent]) => ({ name, extra: parent }), {
      missing:
        'Le edition non esistono su questa versione di Oracle (servono la 11.2 o successive).',
    });
  },
};

// Tipi legati a uno schema: senza owner l'elenco non ha senso.
const SCHEMA_SCOPED = new Set(['DB_LINK', 'SCHEDULER_JOB', 'QUEUE', 'RECYCLEBIN']);

router.get(
  '/objects/extra',
  a(async (req, res) => {
    const { type, owner, filter } = req.query;
    const build = EXTRA_LIST[type];
    if (!build) return res.status(400).json({ error: 'Tipo non valido' });
    if (SCHEMA_SCOPED.has(type) && !owner) {
      return res.status(400).json({ error: 'Schema mancante' });
    }
    try {
      res.json(await build(req.oraEntry, { owner, filter: String(filter ?? '').trim() }));
    } catch (err) {
      // Una cartella dell'albero che non si legge resta vuota con la sua nota:
      // far esplodere la richiesta chiuderebbe l'intero ramo.
      res.json({ items: [], truncated: false, note: err.message });
    }
  })
);

// ---------------------------------------------------------------------------
// Sezioni di dettaglio (le linguette della scheda)
// ---------------------------------------------------------------------------

const DETAIL = {
  DB_LINK: {
    Dettagli: (entry, { owner, name }) =>
      firstGrid(
        entry,
        [
          {
            sql: `SELECT db_link "Nome", owner "Proprietario", username "Utente",
                         host "Host", created "Creato il"
                    FROM all_db_links
                   WHERE owner = :owner AND db_link = :name`,
            binds: { owner, name },
          },
        ],
        needs('ALL_DB_LINKS')
      ),
  },

  SCHEDULER_JOB: {
    Dettagli: (entry, { owner, name }) =>
      firstGrid(
        entry,
        [
          {
            sql: `SELECT job_name "Nome", job_type "Tipo", job_action "Azione",
                         schedule_name "Pianificazione", repeat_interval "Ripetizione",
                         start_date "Inizio", enabled "Abilitato", state "Stato",
                         last_start_date "Ultimo avvio", next_run_date "Prossima esecuzione",
                         run_count "Esecuzioni", failure_count "Fallimenti",
                         comments "Commento"
                    FROM all_scheduler_jobs
                   WHERE owner = :owner AND job_name = :name`,
            binds: { owner, name },
          },
        ],
        needs('ALL_SCHEDULER_JOBS')
      ),

    Esecuzioni: (entry, { owner, name }) =>
      // Le ultime 200: il log di un job che gira ogni minuto è lungo quanto la
      // sua retention e non lo si guarda mai per intero.
      firstGrid(
        entry,
        [
          {
            sql: `SELECT * FROM (
                    SELECT log_date "Data", status "Esito",
                           actual_start_date "Avvio effettivo", run_duration "Durata",
                           error# "Errore", additional_info "Dettagli"
                      FROM all_scheduler_job_run_details
                     WHERE owner = :owner AND job_name = :name
                     ORDER BY log_date DESC
                  ) WHERE ROWNUM <= 200`,
            binds: { owner, name },
            maxRows: 200,
          },
          {
            sql: `SELECT * FROM (
                    SELECT log_date "Data", status "Esito",
                           actual_start_date "Avvio effettivo", run_duration "Durata",
                           error# "Errore", additional_info "Dettagli"
                      FROM user_scheduler_job_run_details
                     -- Le viste USER_ non hanno la colonna owner: senza questo
                     -- confronto, chiedendo il job di un altro schema si
                     -- otterrebbero le esecuzioni del proprio job omonimo.
                     WHERE job_name = :name AND :owner = USER
                     ORDER BY log_date DESC
                  ) WHERE ROWNUM <= 200`,
            binds: { owner, name },
            maxRows: 200,
          },
        ],
        needs('ALL_SCHEDULER_JOB_RUN_DETAILS')
      ),

    Argomenti: (entry, { owner, name }) =>
      firstGrid(
        entry,
        [
          {
            sql: `SELECT argument_position "#", argument_name "Nome",
                         argument_type "Tipo", value "Valore", out_argument "In uscita"
                    FROM all_scheduler_job_args
                   WHERE owner = :owner AND job_name = :name
                   ORDER BY argument_position`,
            binds: { owner, name },
          },
          {
            sql: `SELECT argument_position "#", argument_name "Nome",
                         argument_type "Tipo", value "Valore", out_argument "In uscita"
                    FROM user_scheduler_job_args
                   WHERE job_name = :name AND :owner = USER
                   ORDER BY argument_position`,
            binds: { owner, name },
          },
        ],
        needs('ALL_SCHEDULER_JOB_ARGS')
      ),
  },

  QUEUE: {
    Dettagli: (entry, { owner, name }) =>
      firstGrid(
        entry,
        [
          {
            sql: `SELECT name "Nome", queue_type "Tipo", queue_table "Tabella delle code",
                         max_retries "Tentativi massimi", retry_delay "Ritardo (s)",
                         retention "Ritenzione (s)", enqueue_enabled "Accodamento",
                         dequeue_enabled "Prelievo", user_comment "Commento"
                    FROM all_queues
                   WHERE owner = :owner AND name = :name`,
            binds: { owner, name },
          },
        ],
        needs('ALL_QUEUES')
      ),

    Sottoscrittori: (entry, { owner, name }) =>
      // La colonna con il nome della coda è NAME (come in ALL_QUEUES), ma la
      // vista non c'è su tutte le installazioni e su qualche versione si chiama
      // QUEUE_NAME: il secondo tentativo costa un ORA-00904 e salva la scheda.
      firstGrid(
        entry,
        [
          {
            sql: `SELECT consumer_name "Sottoscrittore", address "Indirizzo",
                         protocol "Protocollo", transformation "Trasformazione",
                         delivery_mode "Modalità"
                    FROM all_queue_subscribers
                   WHERE owner = :owner AND name = :name
                   ORDER BY consumer_name`,
            binds: { owner, name },
          },
          {
            sql: `SELECT consumer_name "Sottoscrittore", address "Indirizzo",
                         protocol "Protocollo", transformation "Trasformazione",
                         delivery_mode "Modalità"
                    FROM all_queue_subscribers
                   WHERE owner = :owner AND queue_name = :name
                   ORDER BY consumer_name`,
            binds: { owner, name },
          },
        ],
        'La vista ALL_QUEUE_SUBSCRIBERS non è leggibile su questo database: i sottoscrittori ' +
          'si trovano nella tabella AQ$<tabella delle code>_S.'
      ),

    'Tabella delle code': (entry, { owner, name }) =>
      firstGrid(
        entry,
        [
          {
            sql: `SELECT t.queue_table "Tabella", t.object_type "Tipo del messaggio",
                         t.sort_order "Ordinamento", t.recipients "Destinatari",
                         t.message_grouping "Raggruppamento", t.compatible "Compatibilità",
                         t.user_comment "Commento"
                    FROM all_queue_tables t
                    JOIN all_queues q
                      ON q.owner = t.owner AND q.queue_table = t.queue_table
                   WHERE q.owner = :owner AND q.name = :name`,
            binds: { owner, name },
          },
        ],
        needs('ALL_QUEUE_TABLES')
      ),
  },

  RECYCLEBIN: {
    Dettagli: (entry, { owner, name }) => {
      const candidates = [];
      if (isCurrentSchema(entry, owner)) {
        candidates.push({
          sql: `SELECT object_name "Nome nel cestino", original_name "Nome originale",
                       type "Tipo", ts_name "Tablespace", createtime "Creato il",
                       droptime "Eliminato il", can_undrop "Ripristinabile",
                       can_purge "Eliminabile", space "Blocchi"
                  FROM user_recyclebin
                 WHERE object_name = :name`,
          binds: { name },
        });
      }
      candidates.push({
        sql: `SELECT object_name "Nome nel cestino", original_name "Nome originale",
                     type "Tipo", ts_name "Tablespace", createtime "Creato il",
                     droptime "Eliminato il", can_undrop "Ripristinabile",
                     can_purge "Eliminabile", space "Blocchi"
                FROM dba_recyclebin
               WHERE owner = :owner AND object_name = :name`,
        binds: { owner, name },
      });
      return firstGrid(entry, candidates, needs('DBA_RECYCLEBIN'));
    },
  },

  DIRECTORY: {
    Dettagli: (entry, { name }) =>
      firstGrid(
        entry,
        [
          {
            sql: `SELECT directory_name "Nome", owner "Proprietario",
                         directory_path "Percorso"
                    FROM all_directories
                   WHERE directory_name = :name`,
            binds: { name },
          },
        ],
        needs('ALL_DIRECTORIES')
      ),

    // Le directory sono oggetti di SYS: la vista DBA mostra tutte le
    // concessioni, ALL_TAB_PRIVS solo quelle che riguardano l'utenza collegata.
    Permessi: (entry, { name }) =>
      firstGrid(
        entry,
        [
          {
            sql: `SELECT grantee "Beneficiario", privilege "Privilegio",
                         grantor "Concesso da", grantable "Trasferibile"
                    FROM dba_tab_privs
                   WHERE table_name = :name
                     AND owner = (SELECT owner FROM all_directories
                                   WHERE directory_name = :name)
                   ORDER BY grantee, privilege`,
            binds: { name },
          },
          {
            sql: `SELECT grantee "Beneficiario", privilege "Privilegio",
                         grantor "Concesso da", grantable "Trasferibile"
                    FROM all_tab_privs
                   WHERE table_name = :name
                     AND table_schema = (SELECT owner FROM all_directories
                                          WHERE directory_name = :name)
                   ORDER BY grantee, privilege`,
            binds: { name },
          },
        ],
        needs('DBA_TAB_PRIVS')
      ),
  },

  USER: {
    Dettagli: (entry, { name }) =>
      firstGrid(
        entry,
        [
          {
            sql: `SELECT username "Nome", account_status "Stato",
                         lock_date "Bloccato il", expiry_date "Scadenza password",
                         default_tablespace "Tablespace predefinito",
                         temporary_tablespace "Tablespace temporaneo",
                         profile "Profilo", created "Creato il"
                    FROM dba_users
                   WHERE username = :name`,
            binds: { name },
          },
          {
            sql: `SELECT username "Nome", created "Creato il"
                    FROM all_users
                   WHERE username = :name`,
            binds: { name },
          },
        ],
        needs('DBA_USERS')
      ),

    Ruoli: (entry, { name }) =>
      firstGrid(
        entry,
        [
          {
            sql: `SELECT granted_role "Ruolo", admin_option "Amministrazione",
                         default_role "Predefinito"
                    FROM dba_role_privs
                   WHERE grantee = :name
                   ORDER BY granted_role`,
            binds: { name },
          },
          // USER_ROLE_PRIVS descrive solo l'utenza collegata: il filtro sul
          // nome evita di attribuire a un altro utente i propri ruoli.
          {
            sql: `SELECT granted_role "Ruolo", admin_option "Amministrazione",
                         default_role "Predefinito"
                    FROM user_role_privs
                   WHERE username = :name
                   ORDER BY granted_role`,
            binds: { name },
          },
        ],
        needs('DBA_ROLE_PRIVS')
      ),

    'Privilegi di sistema': (entry, { name }) =>
      firstGrid(
        entry,
        [
          {
            sql: `SELECT privilege "Privilegio", admin_option "Amministrazione"
                    FROM dba_sys_privs
                   WHERE grantee = :name
                   ORDER BY privilege`,
            binds: { name },
          },
          {
            sql: `SELECT privilege "Privilegio", admin_option "Amministrazione"
                    FROM user_sys_privs
                   WHERE username = :name
                   ORDER BY privilege`,
            binds: { name },
          },
        ],
        needs('DBA_SYS_PRIVS')
      ),

    'Privilegi su oggetti': (entry, { name }) =>
      firstGrid(
        entry,
        [
          {
            sql: `SELECT owner "Schema", table_name "Oggetto", privilege "Privilegio",
                         grantor "Concesso da", grantable "Trasferibile"
                    FROM dba_tab_privs
                   WHERE grantee = :name
                   ORDER BY owner, table_name, privilege`,
            binds: { name },
          },
          {
            sql: `SELECT table_schema "Schema", table_name "Oggetto", privilege "Privilegio",
                         grantor "Concesso da", grantable "Trasferibile"
                    FROM all_tab_privs
                   WHERE grantee = :name
                   ORDER BY table_schema, table_name, privilege`,
            binds: { name },
          },
        ],
        needs('DBA_TAB_PRIVS')
      ),

    Quote: (entry, { name }) =>
      firstGrid(
        entry,
        [
          {
            sql: `SELECT tablespace_name "Tablespace",
                         ROUND(bytes / 1024 / 1024, 2) "Usato (MB)",
                         CASE WHEN max_bytes < 0 THEN 'illimitata'
                              ELSE TO_CHAR(ROUND(max_bytes / 1024 / 1024, 2)) END "Quota (MB)"
                    FROM dba_ts_quotas
                   WHERE username = :name
                   ORDER BY tablespace_name`,
            binds: { name },
          },
          // USER_TS_QUOTAS non ha la colonna username perché descrive solo
          // l'utenza collegata: il confronto con USER tiene il bind e svuota il
          // risultato quando si sta guardando un altro utente.
          {
            sql: `SELECT tablespace_name "Tablespace",
                         ROUND(bytes / 1024 / 1024, 2) "Usato (MB)",
                         CASE WHEN max_bytes < 0 THEN 'illimitata'
                              ELSE TO_CHAR(ROUND(max_bytes / 1024 / 1024, 2)) END "Quota (MB)"
                    FROM user_ts_quotas
                   WHERE :name = USER
                   ORDER BY tablespace_name`,
            binds: { name },
          },
        ],
        needs('DBA_TS_QUOTAS')
      ),
  },

  ROLE: {
    Dettagli: (entry, { name }) =>
      firstGrid(
        entry,
        [
          {
            sql: `SELECT role "Nome", password_required "Password richiesta"
                    FROM dba_roles
                   WHERE role = :name`,
            binds: { name },
          },
          {
            sql: `SELECT role "Nome", 'attivo nella sessione' "Stato"
                    FROM session_roles
                   WHERE role = :name`,
            binds: { name },
          },
        ],
        needs('DBA_ROLES')
      ),

    'Ruoli concessi': (entry, { name }) =>
      firstGrid(
        entry,
        [
          {
            sql: `SELECT granted_role "Ruolo", admin_option "Amministrazione"
                    FROM dba_role_privs
                   WHERE grantee = :name
                   ORDER BY granted_role`,
            binds: { name },
          },
          // ROLE_ROLE_PRIVS è leggibile da chiunque, ma solo per i ruoli di cui
          // l'utenza dispone.
          {
            sql: `SELECT granted_role "Ruolo", admin_option "Amministrazione"
                    FROM role_role_privs
                   WHERE role = :name
                   ORDER BY granted_role`,
            binds: { name },
          },
        ],
        needs('DBA_ROLE_PRIVS')
      ),

    'Privilegi di sistema': (entry, { name }) =>
      firstGrid(
        entry,
        [
          {
            sql: `SELECT privilege "Privilegio", admin_option "Amministrazione"
                    FROM dba_sys_privs
                   WHERE grantee = :name
                   ORDER BY privilege`,
            binds: { name },
          },
          {
            sql: `SELECT privilege "Privilegio", admin_option "Amministrazione"
                    FROM role_sys_privs
                   WHERE role = :name
                   ORDER BY privilege`,
            binds: { name },
          },
        ],
        needs('DBA_SYS_PRIVS')
      ),

    'Privilegi su oggetti': (entry, { name }) =>
      firstGrid(
        entry,
        [
          {
            sql: `SELECT owner "Schema", table_name "Oggetto", privilege "Privilegio",
                         grantor "Concesso da", grantable "Trasferibile"
                    FROM dba_tab_privs
                   WHERE grantee = :name
                   ORDER BY owner, table_name, privilege`,
            binds: { name },
          },
          {
            sql: `SELECT owner "Schema", table_name "Oggetto", privilege "Privilegio",
                         column_name "Colonna", grantable "Trasferibile"
                    FROM role_tab_privs
                   WHERE role = :name
                   ORDER BY owner, table_name, privilege`,
            binds: { name },
          },
        ],
        needs('DBA_TAB_PRIVS')
      ),

    'Assegnato a': (entry, { name }) =>
      firstGrid(
        entry,
        [
          {
            sql: `SELECT grantee "Beneficiario", admin_option "Amministrazione",
                         default_role "Predefinito"
                    FROM dba_role_privs
                   WHERE granted_role = :name
                   ORDER BY grantee`,
            binds: { name },
          },
          // Senza la vista DBA l'unico beneficiario visibile è chi sta
          // guardando: meglio una riga sola che un errore.
          {
            sql: `SELECT username "Beneficiario", admin_option "Amministrazione",
                         default_role "Predefinito"
                    FROM user_role_privs
                   WHERE granted_role = :name
                   ORDER BY username`,
            binds: { name },
          },
        ],
        needs('DBA_ROLE_PRIVS')
      ),
  },

  TABLESPACE: {
    Dettagli: (entry, { name }) =>
      firstGrid(
        entry,
        [
          {
            sql: `SELECT tablespace_name "Nome", status "Stato", contents "Contenuto",
                         ROUND(block_size / 1024) "Blocco (KB)",
                         extent_management "Gestione estensioni",
                         allocation_type "Allocazione",
                         segment_space_management "Gestione spazio",
                         logging "Logging"
                    FROM dba_tablespaces
                   WHERE tablespace_name = :name`,
            binds: { name },
          },
          {
            sql: `SELECT tablespace_name "Nome", status "Stato", contents "Contenuto",
                         ROUND(block_size / 1024) "Blocco (KB)",
                         extent_management "Gestione estensioni",
                         allocation_type "Allocazione",
                         segment_space_management "Gestione spazio",
                         logging "Logging"
                    FROM user_tablespaces
                   WHERE tablespace_name = :name`,
            binds: { name },
          },
        ],
        needs('DBA_TABLESPACES')
      ),

    File: (entry, { name }) =>
      // Dati e temporanei stanno in due viste diverse: un tablespace TEMP non
      // ha righe nella prima e viceversa, quindi si uniscono.
      firstGrid(
        entry,
        [
          {
            sql: `SELECT file_name "File", 'Dati' "Genere", file_id "#",
                         ROUND(bytes / 1024 / 1024, 2) "Dimensione (MB)",
                         autoextensible "Estensione automatica",
                         ROUND(maxbytes / 1024 / 1024, 2) "Massimo (MB)",
                         status "Stato"
                    FROM dba_data_files
                   WHERE tablespace_name = :name
                   UNION ALL
                  SELECT file_name, 'Temporaneo', file_id,
                         ROUND(bytes / 1024 / 1024, 2), autoextensible,
                         ROUND(maxbytes / 1024 / 1024, 2), status
                    FROM dba_temp_files
                   WHERE tablespace_name = :name
                   ORDER BY 2, 3`,
            binds: { name },
          },
          {
            sql: `SELECT file_name "File", 'Dati' "Genere", file_id "#",
                         ROUND(bytes / 1024 / 1024, 2) "Dimensione (MB)",
                         autoextensible "Estensione automatica",
                         ROUND(maxbytes / 1024 / 1024, 2) "Massimo (MB)",
                         status "Stato"
                    FROM dba_data_files
                   WHERE tablespace_name = :name
                   ORDER BY file_id`,
            binds: { name },
          },
        ],
        needs('DBA_DATA_FILES')
      ),

    Utilizzo: (entry, { name }) =>
      // DBA_TABLESPACE_USAGE_METRICS (11g in su) tiene già conto
      // dell'autoextend, cioè dello spazio che il tablespace *può* prendersi;
      // il conto fatto a mano su DBA_FREE_SPACE si ferma ai file così come
      // sono adesso. Prima il primo, quando c'è.
      firstGrid(
        entry,
        [
          {
            sql: `SELECT m.tablespace_name "Tablespace",
                         ROUND(m.tablespace_size * t.block_size / 1024 / 1024, 2) "Totale (MB)",
                         ROUND(m.used_space * t.block_size / 1024 / 1024, 2) "Usato (MB)",
                         ROUND((m.tablespace_size - m.used_space) * t.block_size / 1024 / 1024, 2) "Libero (MB)",
                         ROUND(m.used_percent, 2) "Usato (%)"
                    FROM dba_tablespace_usage_metrics m
                    JOIN dba_tablespaces t ON t.tablespace_name = m.tablespace_name
                   WHERE m.tablespace_name = :name`,
            binds: { name },
          },
          {
            sql: `SELECT d.tablespace_name "Tablespace",
                         ROUND(d.bytes / 1024 / 1024, 2) "Totale (MB)",
                         ROUND((d.bytes - NVL(f.bytes, 0)) / 1024 / 1024, 2) "Usato (MB)",
                         ROUND(NVL(f.bytes, 0) / 1024 / 1024, 2) "Libero (MB)",
                         ROUND((d.bytes - NVL(f.bytes, 0)) * 100 / d.bytes, 2) "Usato (%)"
                    FROM (SELECT tablespace_name, SUM(bytes) bytes
                            FROM dba_data_files
                           WHERE tablespace_name = :name
                           GROUP BY tablespace_name) d
                    LEFT JOIN (SELECT tablespace_name, SUM(bytes) bytes
                                 FROM dba_free_space
                                WHERE tablespace_name = :name
                                GROUP BY tablespace_name) f
                      ON f.tablespace_name = d.tablespace_name`,
            binds: { name },
          },
        ],
        needs('DBA_FREE_SPACE')
      ),
  },

  PUBLIC_SYNONYM: {
    Dettagli: (entry, { name }) =>
      firstGrid(
        entry,
        [
          {
            sql: `SELECT synonym_name "Nome", table_owner "Schema oggetto",
                         table_name "Oggetto", db_link "DB Link"
                    FROM all_synonyms
                   WHERE owner = 'PUBLIC' AND synonym_name = :name`,
            binds: { name },
          },
        ],
        needs('ALL_SYNONYMS')
      ),
  },

  EDITION: {
    Dettagli: (entry, { name }) =>
      firstGrid(
        entry,
        [
          {
            sql: `SELECT edition_name "Nome", parent_edition_name "Edition padre",
                         usable "Utilizzabile"
                    FROM all_editions
                   WHERE edition_name = :name`,
            binds: { name },
          },
        ],
        'Le edition non esistono su questa versione di Oracle (servono la 11.2 o successive).'
      ),
  },
};

router.get(
  '/objects/extra/detail',
  a(async (req, res) => {
    const { type, owner, name, section } = req.query;
    const sections = DETAIL[type];
    if (!sections) return res.status(400).json({ error: 'Tipo non valido' });
    if (!name) return res.status(400).json({ error: 'Nome mancante' });
    const build = sections[section];
    // Sezione sconosciuta: è un disallineamento con systemObjects.js, ma resta
    // un errore da mostrare nella linguetta, non una richiesta rifiutata.
    if (!build) return res.json({ error: `Sezione non prevista per ${type}: ${section}` });
    if (SCHEMA_SCOPED.has(type) && !owner) {
      return res.status(400).json({ error: 'Schema mancante' });
    }
    try {
      res.json(await build(req.oraEntry, { owner, name }));
    } catch (err) {
      res.json({ error: err.message });
    }
  })
);

// ---------------------------------------------------------------------------
// Cestino: ripristino ed eliminazione definitiva
// ---------------------------------------------------------------------------

// FLASHBACK e PURGE sono DDL: girano sulla sessione del foglio (dove sta la
// transazione dell'utente) e come ogni DDL fanno commit implicito di quel che
// c'è aperto. Passano da runExclusive per non incrociarsi con un'esecuzione in
// corso.
async function runDdl(entry, sql) {
  try {
    // La politica della sola lettura sta tutta in readonly.js: né FLASHBACK né
    // PURGE sono interrogazioni, quindi su una connessione aperta in sola
    // lettura questa asserzione lancia sempre.
    assertWritable(entry, sql);
  } catch (err) {
    return { error: { message: err.message, readOnly: true } };
  }
  return runExclusive(entry, async () => {
    try {
      await entry.session.execute(sql);
      return { ok: true };
    } catch (err) {
      return { error: { message: err.message } };
    }
  });
}

router.post(
  '/recyclebin/flashback',
  a(async (req, res) => {
    const { name, newName } = req.body;
    if (!name) return res.status(400).json({ error: 'Nome mancante' });
    let sql = `FLASHBACK TABLE ${qi(name)} TO BEFORE DROP`;
    if (newName) sql += ` RENAME TO ${qi(newName)}`;
    res.json(await runDdl(req.oraEntry, sql));
  })
);

router.post(
  '/recyclebin/purge',
  a(async (req, res) => {
    const { name, all } = req.body;
    if (!all && !name) return res.status(400).json({ error: 'Nome mancante' });
    // PURGE RECYCLEBIN svuota il cestino dell'utenza collegata, non quello del
    // database (che sarebbe PURGE DBA_RECYCLEBIN, riservato ai DBA).
    const sql = all ? 'PURGE RECYCLEBIN' : `PURGE TABLE ${qi(name)}`;
    res.json(await runDdl(req.oraEntry, sql));
  })
);

export default router;
