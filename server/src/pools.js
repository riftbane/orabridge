import oracledb from 'oracledb';

// Thick mode (Instant Client) supports old password verifiers (10G, NJS-116)
// and pre-12.1 servers. Enabled by default in the Docker image.
export let thickMode = false;
if (process.env.ORACLE_THICK_MODE === '1') {
  try {
    const opts = {};
    if (process.env.ORACLE_CLIENT_LIB_DIR) opts.libDir = process.env.ORACLE_CLIENT_LIB_DIR;
    oracledb.initOracleClient(opts);
    thickMode = true;
    console.log(`node-oracledb in modalità thick (client ${oracledb.oracleClientVersionString})`);
  } catch (err) {
    console.error(
      `Instant Client non inizializzato (${err.message.split('\n')[0]}); continuo in modalità thin.`
    );
  }
}
if (!thickMode) console.log('node-oracledb in modalità thin (nessun Instant Client)');

// LOBs fetched inline for the grid.
oracledb.fetchAsString = [oracledb.CLOB, oracledb.NCLOB];
oracledb.fetchAsBuffer = [oracledb.BLOB];

// Adds an actionable hint to known driver errors.
export function friendlyError(err) {
  let msg = err.message;
  if (!thickMode && msg.includes('NJS-116')) {
    msg +=
      "\n\nL'utenza ha solo il password verifier 10G, non supportato dalla modalità thin del driver. " +
      'Opzioni: (1) esegui Orabridge via Docker — l\'immagine include Oracle Instant Client e usa la modalità thick, che supporta questi verifier; ' +
      '(2) oppure rigenera i verifier moderni resettando la password: ALTER USER utente IDENTIFIED BY password ' +
      '(il server deve avere SQLNET.ALLOWED_LOGON_VERSION_SERVER >= 11).';
  }
  return msg;
}

// Errori che si risolvono reinserendo la password (credenziali errate o
// mancanti): chi chiama può richiederla all'utente invece di limitarsi a
// mostrare l'errore.
export function isAuthError(err) {
  return /ORA-01017|ORA-01005/.test(err.message || '');
}

const active = new Map(); // id -> entry

// Full TNS descriptor instead of Easy Connect: the thin driver's Easy Connect
// parser rejects some legal service names (e.g. single-character ones).
export function buildConnectString(c) {
  if (c.serviceType === 'custom') return c.service;
  const connectData =
    c.serviceType === 'sid' ? `(SID=${c.service})` : `(SERVICE_NAME=${c.service})`;
  return `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${c.host})(PORT=${c.port}))(CONNECT_DATA=${connectData}))`;
}

async function initSession(session) {
  session.module = 'Orabridge';
  try {
    await session.execute('BEGIN dbms_output.enable(NULL); END;');
  } catch {
    /* dbms_output not available: non-fatal */
  }
}

export const pools = {
  get(id) {
    return active.get(id) || null;
  },

  ids() {
    return [...active.keys()];
  },

  async connect(cfg) {
    if (active.has(cfg.id)) return active.get(cfg.id);
    const creds = {
      user: cfg.user,
      password: cfg.password,
      connectString: buildConnectString(cfg),
    };
    const pool = await oracledb.createPool({
      ...creds,
      poolMin: 0,
      poolMax: 4,
      poolIncrement: 1,
      poolTimeout: 300,
      queueTimeout: 30000,
    });
    let session;
    try {
      session = await oracledb.getConnection(creds);
      await initSession(session);
      const info = await session.execute(
        `SELECT user, sys_context('userenv', 'current_schema') FROM dual`
      );
      const entry = {
        id: cfg.id,
        pool,
        session,
        queue: Promise.resolve(),
        executing: false,
        user: info.rows[0][0],
        currentSchema: info.rows[0][1],
        version: session.oracleServerVersionString,
        connectedAt: Date.now(),
      };
      active.set(cfg.id, entry);
      return entry;
    } catch (err) {
      if (session) await session.close().catch(() => {});
      await pool.close(0).catch(() => {});
      throw err;
    }
  },

  async disconnect(id) {
    const entry = active.get(id);
    if (!entry) return false;
    active.delete(id);
    await entry.session.close().catch(() => {});
    await entry.pool.close(2).catch(() => entry.pool.close(0).catch(() => {}));
    return true;
  },

  async closeAll() {
    await Promise.all(this.ids().map((id) => this.disconnect(id)));
  },

  async test(cfg) {
    const t0 = performance.now();
    const conn = await oracledb.getConnection({
      user: cfg.user,
      password: cfg.password,
      connectString: buildConnectString(cfg),
    });
    const version = conn.oracleServerVersionString;
    await conn.close();
    return { ok: true, ms: Math.round(performance.now() - t0), version };
  },
};

// Serializes work on the dedicated worksheet session (one transaction context per connection).
export function runExclusive(entry, fn) {
  const run = entry.queue.then(fn, fn);
  entry.queue = run.then(
    () => {},
    () => {}
  );
  return run;
}

// Runs fn with a pooled connection (metadata / table data reads).
export async function withPooled(entry, fn) {
  const conn = await entry.pool.getConnection();
  try {
    return await fn(conn);
  } finally {
    await conn.close().catch(() => {});
  }
}
