import oracledb from 'oracledb';
import { findTnsAdmin } from './tns.js';

// Thick mode (Instant Client) supports old password verifiers (10G, NJS-116)
// and pre-12.1 servers. Enabled by default in the Docker image.
export let thickMode = false;
if (process.env.ORACLE_THICK_MODE === '1') {
  try {
    const opts = {};
    if (process.env.ORACLE_CLIENT_LIB_DIR) opts.libDir = process.env.ORACLE_CLIENT_LIB_DIR;
    // In modalità thick la cartella di tnsnames.ora/sqlnet.ora si dichiara qui
    // e vale per tutto il processo: è l'Instant Client a leggerla, e non
    // accetta un `configDir` per singola connessione come fa il driver thin.
    const configDir = process.env.ORACLE_TNS_ADMIN || process.env.TNS_ADMIN || findTnsAdmin();
    if (configDir) opts.configDir = configDir;
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

// Adds an actionable hint to known driver errors. `cfg` è la configurazione
// del tentativo di connessione, quando la si conosce: alcuni errori si
// spiegano solo sapendo con che ruolo si stava entrando.
export function friendlyError(err, cfg = {}) {
  let msg = err.message;
  if (!thickMode && msg.includes('NJS-116')) {
    msg +=
      "\n\nL'utenza ha solo il password verifier 10G, non supportato dalla modalità thin del driver. " +
      'Opzioni: (1) esegui Orabridge via Docker — l\'immagine include Oracle Instant Client e usa la modalità thick, che supporta questi verifier; ' +
      '(2) oppure rigenera i verifier moderni resettando la password: ALTER USER utente IDENTIFIED BY password ' +
      '(il server deve avere SQLNET.ALLOWED_LOGON_VERSION_SERVER >= 11).';
  }
  if (msg.includes('ORA-01031') && (cfg.role === 'SYSDBA' || cfg.role === 'SYSOPER')) {
    msg += thickMode
      ? `\n\nIl database ha rifiutato il login come ${cfg.role}. Con l'Instant Client ` +
        "l'autenticazione del sistema operativo vale solo per una connessione locale, senza " +
        'connect string: da remoto serve comunque un file password sul server ' +
        "(REMOTE_LOGIN_PASSWORDFILE=EXCLUSIVE) con l'utenza dentro — GRANT SYSDBA TO utente."
      : `\n\nIl database ha rifiutato il login come ${cfg.role}. In modalità thin il driver non può ` +
      "usare l'autenticazione del sistema operativo (il gruppo dba della macchina del server): il " +
      'ruolo va concesso da remoto, quindi servono un file password sul server ' +
      "(REMOTE_LOGIN_PASSWORDFILE=EXCLUSIVE) con l'utenza dentro — GRANT SYSDBA TO utente — " +
      'oppure un wallet Oracle indicato nelle opzioni avanzate della connessione.';
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
  // Un alias di tnsnames.ora si passa così com'è: a risolverlo è il driver,
  // leggendo il file nella cartella che gli diciamo con `configDir`.
  if (c.serviceType === 'tns') return (c.tnsAlias || '').trim();
  if (c.serviceType === 'custom') return c.service;
  const connectData =
    c.serviceType === 'sid' ? `(SID=${c.service})` : `(SERVICE_NAME=${c.service})`;
  return `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${c.host})(PORT=${c.port}))(CONNECT_DATA=${connectData}))`;
}

// Credenziali e opzioni di rete, uguali per il pool e per la sessione del
// foglio: node-oracledb le vuole tutte nello stesso oggetto.
function buildCreds(cfg) {
  const creds = {
    user: cfg.user,
    password: cfg.password,
    connectString: buildConnectString(cfg),
  };
  // Utente proxy: ci si autentica come `proxyUser`, con la password del
  // proxy, ma si lavora nello schema di `user` — la password dell'utente
  // finale non serve, ed è proprio il motivo per cui il proxy esiste. La
  // sintassi Oracle mette la destinazione fra parentesi quadre nel nome
  // utente: `PROXY[DESTINAZIONE]`.
  const proxy = (cfg.proxyUser || '').trim();
  if (proxy) creds.user = `${proxy}[${cfg.user}]`;
  if (cfg.role === 'SYSDBA') creds.privilege = oracledb.SYSDBA;
  else if (cfg.role === 'SYSOPER') creds.privilege = oracledb.SYSOPER;
  // `configDir`, `walletLocation` e `walletPassword` sono proprietà del solo
  // driver thin: in thick l'Instant Client le ignora in silenzio e le prende
  // dal proprio ambiente (vedi `initOracleClient` sopra e sqlnet.ora). Meglio
  // non passarle affatto che far credere che siano state applicate — lo dice
  // `thickLimitation()`, chiamato prima di connettersi.
  if (!thickMode) {
    const configDir = (cfg.tnsAdmin || '').trim() || findTnsAdmin();
    if (configDir) creds.configDir = configDir;
    const wallet = (cfg.walletPath || '').trim();
    if (wallet) {
      creds.walletLocation = wallet;
      if (cfg.walletPassword) creds.walletPassword = cfg.walletPassword;
    }
  }
  return creds;
}

// Opzioni che l'Instant Client non può ricevere per singola connessione: se
// sono valorizzate, dirlo prima di provare a connettersi è meglio che lasciar
// fallire il login con un errore Oracle che non le nomina nemmeno.
export function thickLimitation(cfg) {
  if (!thickMode) return null;
  const parts = [];
  if ((cfg.tnsAdmin || '').trim()) parts.push('la cartella TNS_ADMIN indicata sulla connessione');
  if ((cfg.walletPath || '').trim()) parts.push('il wallet indicato sulla connessione');
  if (!parts.length) return null;
  return (
    `${parts.join(' e ')} non ${parts.length > 1 ? 'valgono' : 'vale'} con l'Oracle Instant Client, ` +
    "che legge la propria configurazione una volta sola all'avvio. " +
    'Imposta la variabile d\'ambiente TNS_ADMIN prima di avviare Orabridge e metti lì ' +
    'tnsnames.ora e sqlnet.ora (con WALLET_LOCATION per il wallet).'
  );
}

// Sulle connessioni in sola lettura non si tocca niente lato Oracle: il blocco
// è applicativo (`readonly.js` rifiuta le istruzioni che scrivono) perché una
// sessione READ ONLY vera impedirebbe anche i `dbms_output` e le impostazioni
// NLS che l'app usa per leggere.
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
    const limit = thickLimitation(cfg);
    if (limit) throw new Error(limit);
    const creds = buildCreds(cfg);
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
        `SELECT user, sys_context('userenv', 'current_schema'),
                sys_context('userenv', 'sid') FROM dual`
      );
      const entry = {
        id: cfg.id,
        pool,
        session,
        queue: Promise.resolve(),
        executing: false,
        user: info.rows[0][0],
        currentSchema: info.rows[0][1],
        // SID della sessione del foglio, letto adesso una volta per tutte: il
        // monitor DBA lo usa per non farla uccidere, e proprio quando serve
        // (sessione occupata da un'istruzione lunga) non potrebbe chiederglielo.
        sid: Number(info.rows[0][2]) || null,
        version: session.oracleServerVersionString,
        // Lo legge `readonly.js` prima di eseguire qualsiasi istruzione.
        readOnly: !!cfg.readOnly,
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
    const limit = thickLimitation(cfg);
    if (limit) throw new Error(limit);
    const t0 = performance.now();
    const conn = await oracledb.getConnection(buildCreds(cfg));
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
