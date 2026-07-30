import { Router } from 'express';
import oracledb from 'oracledb';
import { withPooled } from '../pools.js';

// Ricerca globale dentro il codice PL/SQL del database (ALL_SOURCE): una sola
// scansione del dizionario restituisce tutte le righe che contengono il testo
// cercato, raggruppate per oggetto. Il filtro viaggia in SQL — portarsi in
// Node il sorgente di un intero database sarebbe decine di megabyte.

const router = Router({ mergeParams: true });
const a = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// Tipi di ALL_SOURCE che ha senso cercare. JAVA SOURCE è escluso: non è PL/SQL
// e l'app non sa aprirlo.
export const SEARCH_TYPES = [
  'PROCEDURE',
  'FUNCTION',
  'TRIGGER',
  'PACKAGE',
  'PACKAGE BODY',
  'TYPE',
  'TYPE BODY',
];

// Quello che si cerca quasi sempre: il codice eseguibile. Le specifiche
// (PACKAGE, TYPE) restano opzionali, altrimenti ogni dichiarazione compare due
// volte.
export const DEFAULT_TYPES = ['PROCEDURE', 'FUNCTION', 'TRIGGER', 'PACKAGE BODY'];

// Schemi di Oracle e dei suoi componenti: cercarci dentro vuol dire scandire
// centinaia di migliaia di righe di codice che non è dell'utente. Si includono
// solo con scope=all.
export const SYSTEM_SCHEMAS = [
  'ANONYMOUS', 'APEX_030200', 'APEX_040000', 'APEX_040200', 'APEX_050000',
  'APEX_180200', 'APEX_190100', 'APEX_200100', 'APEX_210100', 'APEX_220100',
  'APEX_230100', 'APEX_PUBLIC_USER', 'APPQOSSYS', 'AUDSYS', 'BI', 'CTXSYS',
  'DBSFWUSER', 'DBSNMP', 'DGPDB_INT', 'DIP', 'DMSYS', 'DVF', 'DVSYS',
  'EXFSYS', 'FLOWS_FILES', 'GGSYS', 'GSMADMIN_INTERNAL', 'GSMCATUSER',
  'GSMROOTUSER', 'GSMUSER', 'LBACSYS', 'MDDATA', 'MDSYS', 'OJVMSYS',
  'OLAPSYS', 'ORACLE_OCM', 'ORDDATA', 'ORDPLUGINS', 'ORDSYS', 'OUTLN',
  'PDBADMIN', 'REMOTE_SCHEDULER_AGENT', 'SI_INFORMTN_SCHEMA',
  'SPATIAL_CSW_ADMIN_USR', 'SPATIAL_WFS_ADMIN_USR', 'SYS', 'SYS$UMF',
  'SYSBACKUP', 'SYSDG', 'SYSKM', 'SYSRAC', 'SYSTEM', 'TSMSYS', 'WK_TEST',
  'WKPROXY', 'WKSYS', 'WMSYS', 'XDB', 'XS$NULL',
];

// Caratteri che Oracle considera parte di un identificatore: la ricerca «parola
// intera» si ferma su tutto il resto ($ e # sono legali nei nomi PL/SQL).
const WORD_CHARS = 'A-Za-z0-9_$#';
const NOT_WORD = `[^${WORD_CHARS}]`;

// Metacaratteri delle espressioni regolari di Oracle (POSIX esteso).
const escapeRegexp = (s) => s.replace(/[\\^$.[\]|()*+?{}]/g, '\\$&');

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 5000;
// Le righe di ALL_SOURCE arrivano fino a 4000 caratteri: nell'elenco dei
// risultati se ne mostra una finestra intorno al testo trovato.
const SNIPPET = 240;

// Costruisce la query. Restituisce anche i bind, così la route non compone mai
// SQL con dentro l'input dell'utente (l'unica cosa concatenata sono i nomi dei
// bind generati qui).
//
//   opts: { q, types, scope, owner, currentSchema, caseSensitive, wholeWord, regex, limit }
//   scope: 'current' (schema di lavoro) | 'one' (owner) | 'user' (tutti tranne
//          gli schemi di Oracle) | 'all' (proprio tutti)
export function buildCodeSearch(opts) {
  const q = String(opts.q ?? '');
  if (!q) throw new Error('Testo da cercare mancante');

  const allowed = new Set(SEARCH_TYPES);
  const types = (opts.types?.length ? opts.types : DEFAULT_TYPES).map((t) =>
    String(t).toUpperCase()
  );
  const bad = types.find((t) => !allowed.has(t));
  if (bad) throw new Error(`Tipo non valido: ${bad}`);

  const binds = {};
  const where = [];

  types.forEach((t, i) => (binds[`t${i}`] = t));
  where.push(`s.type IN (${types.map((_, i) => `:t${i}`).join(', ')})`);

  const scope = opts.scope || 'current';
  if (scope === 'current' || scope === 'one') {
    const owner = String((scope === 'one' ? opts.owner : opts.currentSchema) || '').toUpperCase();
    if (!owner) throw new Error('Schema mancante');
    binds.owner = owner;
    where.push('s.owner = :owner');
  } else if (scope === 'user') {
    SYSTEM_SCHEMAS.forEach((o, i) => (binds[`x${i}`] = o));
    where.push(`s.owner NOT IN (${SYSTEM_SCHEMAS.map((_, i) => `:x${i}`).join(', ')})`);
  } else if (scope !== 'all') {
    throw new Error(`Ambito non valido: ${scope}`);
  }

  // Oggetti nel cestino: rumore puro.
  where.push(`s.name NOT LIKE 'BIN$%'`);

  // Il match_parameter di REGEXP_LIKE è un letterale, non un bind: vale 'c' o
  // 'i' e basta, non c'è niente dell'utente che ci finisca dentro.
  const flags = opts.caseSensitive ? 'c' : 'i';
  if (opts.regex) {
    binds.q = q;
    where.push(`REGEXP_LIKE(s.text, :q, '${flags}')`);
  } else if (opts.wholeWord) {
    binds.q = `(^|${NOT_WORD})${escapeRegexp(q)}($|${NOT_WORD})`;
    where.push(`REGEXP_LIKE(s.text, :q, '${flags}')`);
  } else {
    // INSTR invece di LIKE: niente escape di % e _ nel testo cercato.
    binds.q = opts.caseSensitive ? q : q.toUpperCase();
    where.push(opts.caseSensitive ? 'INSTR(s.text, :q) > 0' : 'INSTR(UPPER(s.text), :q) > 0');
  }

  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(opts.limit) || DEFAULT_LIMIT));

  return {
    sql: `SELECT s.owner, s.name, s.type, s.line, s.text
            FROM all_source s
           WHERE ${where.join('\n             AND ')}
           ORDER BY s.owner, s.name, s.type, s.line`,
    binds,
    limit,
  };
}

// Dove sta il testo trovato dentro la riga. Oracle ha già deciso che la riga
// corrisponde: qui si rifà il conto in JS solo per poterlo evidenziare, e se le
// due sintassi di regex non coincidono si rinuncia all'evidenziazione invece di
// perdere il risultato.
export function matchRange(text, opts) {
  const q = String(opts.q ?? '');
  if (!q) return null;
  if (opts.regex || opts.wholeWord) {
    const pattern = opts.regex
      ? q
      : `(?<![${WORD_CHARS}])${q.replace(/[\\^$.[\]|()*+?{}]/g, '\\$&')}(?![${WORD_CHARS}])`;
    try {
      const m = new RegExp(pattern, opts.caseSensitive ? '' : 'i').exec(text);
      return m ? { from: m.index, to: m.index + m[0].length } : null;
    } catch {
      return null; // sintassi valida per Oracle ma non per JS
    }
  }
  const hay = opts.caseSensitive ? text : text.toUpperCase();
  const needle = opts.caseSensitive ? q : q.toUpperCase();
  const i = hay.indexOf(needle);
  return i === -1 ? null : { from: i, to: i + q.length };
}

// Riga pronta per l'elenco: senza il fine riga di ALL_SOURCE, senza rientro
// inutile e accorciata intorno al testo trovato se è lunghissima.
export function snippet(raw, range) {
  let text = String(raw ?? '').replace(/[\r\n]+$/, '').replace(/\t/g, '  ');
  let { from, to } = range || { from: null, to: null };

  const lead = text.length - text.trimStart().length;
  if (lead) {
    text = text.slice(lead);
    if (from != null) {
      from = Math.max(0, from - lead);
      to = Math.max(from, to - lead);
    }
  }
  if (text.length > SNIPPET) {
    // Finestra centrata sul testo trovato (o l'inizio riga, se non si sa dov'è).
    const start = from == null ? 0 : Math.max(0, Math.min(from - 60, text.length - SNIPPET));
    text = (start ? '…' : '') + text.slice(start, start + SNIPPET) + '…';
    if (from != null) {
      const shift = start - (start ? 1 : 0);
      from -= shift;
      to -= shift;
      if (from > text.length) from = to = null;
      else to = Math.min(to, text.length - 1); // il testo finisce con «…»
    }
  }
  return from == null ? { text } : { text, from, to };
}

// Righe del dizionario → un elemento per oggetto, con le sue righe. Le righe
// arrivano già ordinate per owner/name/type/line.
export function groupMatches(rows, opts) {
  const objects = [];
  let cur = null;
  for (const [owner, name, type, line, text] of rows) {
    if (!cur || cur.owner !== owner || cur.name !== name || cur.type !== type) {
      cur = { owner, name, type, matches: [] };
      objects.push(cur);
    }
    cur.matches.push({ line, ...snippet(text, matchRange(String(text ?? ''), opts)) });
  }
  return objects;
}

const flag = (v) => v === '1' || v === 'true';

router.get(
  '/search/code',
  a(async (req, res) => {
    const entry = req.oraEntry;
    const opts = {
      q: req.query.q ?? '',
      types: req.query.types ? String(req.query.types).split(',').filter(Boolean) : null,
      scope: req.query.scope || 'current',
      owner: req.query.owner,
      currentSchema: entry.currentSchema,
      caseSensitive: flag(req.query.caseSensitive),
      wholeWord: flag(req.query.wholeWord),
      regex: flag(req.query.regex),
      limit: req.query.limit,
    };

    let plan;
    try {
      plan = buildCodeSearch(opts);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    // Una ricerca su tutto il database può scandire parecchio: il timeout
    // evita che una connessione del pool resti occupata all'infinito.
    const timeoutMs = Math.min(600000, Math.max(5000, Number(req.query.timeout) || 120000));
    const t0 = Date.now();
    try {
      const rows = await withPooled(entry, async (c) => {
        c.callTimeout = timeoutMs;
        try {
          const r = await c.execute(plan.sql, plan.binds, {
            outFormat: oracledb.OUT_FORMAT_ARRAY,
            maxRows: plan.limit + 1,
          });
          return r.rows;
        } finally {
          // La connessione torna nel pool: il timeout della ricerca non deve
          // restare addosso alle query di metadati che la riprenderanno.
          c.callTimeout = 0;
        }
      });
      const truncated = rows.length > plan.limit;
      const kept = truncated ? rows.slice(0, plan.limit) : rows;
      const objects = groupMatches(kept, opts);
      res.json({
        objects,
        total: kept.length,
        objectCount: objects.length,
        truncated,
        elapsedMs: Date.now() - t0,
      });
    } catch (err) {
      // Il timeout è NJS-123 in modalità thin e DPI-1067 in thick; se la query
      // è finita proprio allo scadere è quello anche senza riconoscere il
      // codice.
      const timedOut =
        /NJS-123|DPI-1067|timeout/i.test(err.message) || Date.now() - t0 >= timeoutMs * 0.9;
      res.json({
        error: timedOut
          ? `Ricerca interrotta dopo ${Math.round(timeoutMs / 1000)} secondi: restringi gli schemi o i tipi di oggetto.`
          : err.message,
      });
    }
  })
);

export default router;
