import { Router } from 'express';
import oracledb from 'oracledb';
import { runExclusive, withPooled } from '../pools.js';
import { serializeValue, qi } from '../oracle.js';
import { assertWritable, isReadOnlyStatement } from '../readonly.js';

// Esportazione dei dati «oltre quello che vedo» e importazione di righe in una
// tabella. Le due cose stanno insieme perché condividono la stessa scelta di
// fondo: entrambe lavorano sulla sessione del foglio (`runExclusive`) e non su
// una connessione del pool. Chi esporta si aspetta di ritrovare le modifiche
// che ha appena fatto e non ha ancora committato — esattamente come le vede
// nella griglia dei risultati — e chi importa si aspetta che le righe entrino
// nella transazione che ha sotto gli occhi, così da poterle annullare con
// Rollback se il caricamento non è andato come sperava.

const router = Router({ mergeParams: true });
const a = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// Tetto assoluto: oltre questa soglia la risposta JSON diventa ingestibile per
// il browser, che poi deve anche formattare CSV/XLSX in memoria.
const EXPORT_MAX_ROWS = 200000;
const DEFAULT_EXPORT_ROWS = 10000;
// Righe lette per volta dal cursore: abbastanza da ammortizzare i round trip
// senza tenere in RAM un blocco grande.
const FETCH_BATCH = 1000;

// Il client manda a lotti: un lotto più grande di così vuol dire quasi sempre
// un client che non sta spezzando il file, e una richiesta HTTP da decine di MB.
const IMPORT_MAX_ROWS = 5000;
// Gli errori si contano tutti ma se ne restituiscono pochi: 5000 messaggi
// identici non aiutano nessuno e gonfiano la risposta.
const MAX_REPORTED_ERRORS = 200;

// Tutti gli errori di queste due rotte tornano con stato 200 e la stessa forma:
// il client le usa per mostrare un messaggio nel dialogo, non per distinguere
// codici HTTP, e un 500 lo farebbe solo passare dal gestore generico.
const fail = (res, message, extra) => res.json({ error: { message, ...extra } });

// Stessa lettura usata da /execute per dire al client se c'è una transazione
// aperta. Sono tre righe: un modulo condiviso costerebbe più di così.
async function getTxnOpen(session) {
  try {
    const r = await session.execute(`SELECT dbms_transaction.local_transaction_id FROM dual`);
    return r.rows[0][0] != null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- conversioni

const NUMBER_TYPES = new Set([
  'NUMBER',
  'FLOAT',
  'BINARY_FLOAT',
  'BINARY_DOUBLE',
  'INTEGER',
  'SMALLINT',
  'DECIMAL',
  'NUMERIC',
  'DEC',
  'REAL',
  'DOUBLE PRECISION',
]);

// I tipi di ALL_TAB_COLUMNS raggruppati nei tre soli modi in cui il driver
// vuole ricevere un valore: numero, Date, stringa.
function kindOf(dataType) {
  const t = String(dataType || '').toUpperCase();
  if (NUMBER_TYPES.has(t)) return 'number';
  // 'TIMESTAMP(6)', 'TIMESTAMP(6) WITH TIME ZONE': la precisione fa parte del
  // nome del tipo nel dizionario.
  if (t === 'DATE' || t.startsWith('TIMESTAMP')) return 'date';
  return 'string';
}

function toNumber(v) {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('numero non valido');
    return v;
  }
  const s = String(v).trim();
  const n = Number(s);
  if (s !== '' && Number.isFinite(n)) return n;
  // La virgola decimale si prova solo dopo il punto: il formato con il punto è
  // quello che produce la nostra esportazione, la virgola è il ripiego per i
  // CSV scritti con le impostazioni italiane.
  const alt = Number(s.replace(',', '.'));
  if (s !== '' && Number.isFinite(alt)) return alt;
  throw new Error(`«${v}» non è un numero`);
}

// AAAA-MM-GG [HH:MI:SS[.FF]] — il formato con cui serializziamo le date nella
// griglia (vedi fmtDate in oracle.js), quindi un export riletto torna identico.
const DATE_ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?(?:[.,](\d{1,9}))?)?Z?$/;
// GG/MM/AAAA: quello che scrivono Excel e i CSV italiani.
const DATE_IT = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?(?:[.,](\d{1,9}))?)?$/;

function toDate(v) {
  const s = String(v).trim();
  let y;
  let mo;
  let d;
  let m = DATE_ISO.exec(s);
  if (m) [, y, mo, d] = m;
  else {
    m = DATE_IT.exec(s);
    if (!m) {
      throw new Error(`«${v}» non è una data (formati accettati: AAAA-MM-GG [HH:MI:SS], GG/MM/AAAA)`);
    }
    [, d, mo, y] = m;
  }
  const [h, mi, sec, frac] = m.slice(4, 8);
  const ms = frac ? Number(String(frac).padEnd(3, '0').slice(0, 3)) : 0;
  const dt = new Date(+y, +mo - 1, +d, +(h || 0), +(mi || 0), +(sec || 0), ms);
  // new Date(2026, 1, 31) diventa il 3 marzo senza protestare: il 31 febbraio
  // di un file sbagliato deve restare un errore, non una riga silenziosamente
  // spostata di tre giorni.
  if (dt.getFullYear() !== +y || dt.getMonth() !== +mo - 1 || dt.getDate() !== +d) {
    throw new Error(`«${v}» non è una data valida`);
  }
  return dt;
}

// Un valore testuale del file diventa quello che il driver deve legare.
function convertValue(v, kind) {
  if (v === null || v === undefined || v === '') return null;
  if (kind === 'number') return toNumber(v);
  if (kind === 'date') return toDate(v);
  return typeof v === 'string' ? v : String(v);
}

// Bind della richiesta ({ NOME: { val, type, dir } }) nella forma di oracledb.
// L'esportazione esegue solo SELECT, quindi si legano solo parametri
// d'ingresso: un OUT in una query da esportare non avrebbe dove finire.
function toOracleBinds(binds) {
  const out = {};
  for (const [name, spec] of Object.entries(binds || {})) {
    const s = spec && typeof spec === 'object' && !Array.isArray(spec) ? spec : { val: spec };
    const raw = s.val === '' || s.val === undefined ? null : s.val;
    try {
      if (s.type === 'number') {
        out[name] = { dir: oracledb.BIND_IN, type: oracledb.NUMBER, val: raw == null ? null : toNumber(raw) };
      } else if (s.type === 'date') {
        out[name] = { dir: oracledb.BIND_IN, type: oracledb.DATE, val: raw == null ? null : toDate(raw) };
      } else {
        out[name] = { dir: oracledb.BIND_IN, type: oracledb.STRING, val: raw == null ? null : String(raw) };
      }
    } catch (err) {
      throw new Error(`Variabile di bind «${name}»: ${err.message}`);
    }
  }
  return out;
}

// ------------------------------------------------------------------ /export

// Stessa forma di gridResult ({ columns, rows, truncated }) ma costruita
// leggendo il cursore a blocchi: gridResult serializza un array già
// materializzato dal driver, e a 200 000 righe vorrebbe dire tenerne in memoria
// due copie (quella grezza e quella serializzata) nello stesso istante.
async function fetchGrid(session, sql, binds, maxRows) {
  const r = await session.execute(sql, binds, {
    outFormat: oracledb.OUT_FORMAT_ARRAY,
    resultSet: true,
    fetchArraySize: FETCH_BATCH,
    autoCommit: false,
  });
  if (!r.resultSet) {
    return { error: { message: "L'istruzione non restituisce righe da esportare" } };
  }
  const rs = r.resultSet;
  const columns = r.metaData.map((m) => ({ name: m.name, type: m.dbTypeName || '' }));
  const rows = [];
  let truncated = false;
  try {
    for (;;) {
      const batch = await rs.getRows(FETCH_BATCH);
      if (!batch.length) break;
      for (const row of batch) {
        if (rows.length >= maxRows) {
          truncated = true;
          break;
        }
        rows.push(row.map(serializeValue));
      }
      if (truncated) break;
    }
  } finally {
    await rs.close().catch(() => {});
  }
  return { columns, rows, truncated };
}

router.post(
  '/export',
  a(async (req, res) => {
    const entry = req.oraEntry;
    const source = req.body?.source || {};
    const asked = Number(req.body?.maxRows);
    const maxRows = Math.min(
      EXPORT_MAX_ROWS,
      Number.isFinite(asked) && asked > 0 ? Math.floor(asked) : DEFAULT_EXPORT_ROWS
    );

    let sql;
    let binds = {};
    try {
      if (source.kind === 'table') {
        if (!source.owner || !source.name) return fail(res, 'Tabella da esportare non indicata');
        sql = `SELECT * FROM ${qi(source.owner)}.${qi(source.name)}`;
        // La `where` è testo libero scritto dall'utente e finisce nella query
        // così com'è: è la stessa scelta (e lo stesso rischio, già accettato)
        // di /table/data, ed è la stessa clausola con cui ha appena filtrato la
        // griglia — riscriverla in bind vorrebbe dire interpretarla.
        if (source.where?.trim()) sql += ` WHERE ${source.where}`;
        if (source.orderBy) {
          sql += ` ORDER BY ${qi(source.orderBy)} ${source.dir === 'desc' ? 'DESC' : 'ASC'}`;
        }
      } else if (source.kind === 'sql') {
        if (!source.sql?.trim()) return fail(res, 'Nessuna istruzione da esportare');
        assertWritable(entry, source.sql);
        // Su una connessione scrivibile assertWritable lascia passare tutto,
        // ma da qui deve uscire una griglia: un'istruzione che non legge non
        // va nemmeno eseguita, o «esportare» finirebbe per modificare i dati.
        if (!isReadOnlyStatement(source.sql)) {
          return fail(res, "Si possono esportare solo istruzioni di lettura: quella indicata modifica i dati.");
        }
        sql = source.sql;
        binds = toOracleBinds(source.binds);
      } else {
        return fail(res, 'Origine dei dati da esportare non riconosciuta');
      }
    } catch (err) {
      return fail(res, err.message, err.readOnly || entry.readOnly ? { readOnly: true } : undefined);
    }

    const t0 = performance.now();
    let out;
    try {
      out = await runExclusive(entry, async () => {
        // Come /execute: segnalando l'esecuzione, il pulsante Annulla del foglio
        // può interrompere un export lungo con session.break().
        entry.executing = true;
        try {
          return await fetchGrid(entry.session, sql, binds, maxRows);
        } finally {
          entry.executing = false;
        }
      });
    } catch (err) {
      return res.json({ error: { message: err.message, offset: err.offset, num: err.errorNum } });
    }
    if (out.error) return res.json(out);
    // Le righe si passano per riferimento: copiarle qui rifarebbe l'array intero.
    res.json({
      ...out,
      rowCount: out.rows.length,
      elapsedMs: Math.round(performance.now() - t0),
    });
  })
);

// ------------------------------------------------------------------ /import

// Tipo dichiarato di ogni colonna della tabella di destinazione.
async function readColumnTypes(entry, owner, name) {
  const r = await withPooled(entry, (c) =>
    c.execute(
      `SELECT column_name, data_type
         FROM all_tab_columns
        WHERE owner = :owner AND table_name = :name
        ORDER BY column_id`,
      { owner, name },
      { outFormat: oracledb.OUT_FORMAT_ARRAY, maxRows: 5000 }
    )
  );
  return new Map(r.rows.map(([col, type]) => [col, type]));
}

router.post(
  '/import',
  a(async (req, res) => {
    const entry = req.oraEntry;
    const body = req.body || {};
    const owner = body.owner;
    const name = body.name;
    const columns = Array.isArray(body.columns) ? body.columns : [];
    const rows = Array.isArray(body.rows) ? body.rows : [];
    // Andare avanti dopo un errore è il comportamento utile con un file di
    // dati sporco: si ferma solo chi lo chiede esplicitamente.
    const continueOnError = body.continueOnError !== false;

    if (!owner || !name) return fail(res, 'Tabella di destinazione non indicata');
    if (!columns.length) return fail(res, 'Nessuna colonna di destinazione indicata');
    if (!rows.length) return fail(res, 'Nessuna riga da importare');
    if (rows.length > IMPORT_MAX_ROWS) {
      return fail(
        res,
        `Troppe righe in una sola richiesta (${rows.length}): il massimo è ${IMPORT_MAX_ROWS}, ` +
          "dividi l'importazione in più lotti."
      );
    }

    const sql =
      `INSERT INTO ${qi(owner)}.${qi(name)} (${columns.map(qi).join(', ')}) ` +
      `VALUES (${columns.map((_, i) => `:${i + 1}`).join(', ')})`;
    try {
      assertWritable(entry, sql);
    } catch (err) {
      return fail(res, err.message, { readOnly: true });
    }

    let kinds;
    try {
      const types = await readColumnTypes(entry, owner, name);
      if (!types.size) {
        return fail(res, `Tabella ${owner}.${name} non trovata, o senza privilegi di lettura sulla sua struttura`);
      }
      kinds = columns.map((c) => {
        // I nomi arrivano dalla griglia, quindi già come sono nel dizionario;
        // il confronto in maiuscolo copre chi li digita a mano nel dialogo.
        const t = types.get(c) ?? types.get(String(c).toUpperCase());
        if (!t) throw new Error(`La colonna «${c}» non esiste in ${owner}.${name}`);
        return kindOf(t);
      });
    } catch (err) {
      return fail(res, err.message);
    }

    // Conversione riga per riga: un valore non convertibile è un errore di
    // quella riga, non della richiesta, così un file con tre celle sbagliate su
    // mille carica comunque le altre 997.
    const values = [];
    const srcIndex = []; // posizione nel lotto ricevuto delle righe convertite
    const errors = [];
    const maxLen = columns.map(() => 1);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        if (!Array.isArray(row)) throw new Error('riga non valida (attesa una lista di valori)');
        if (row.length > columns.length) {
          throw new Error(`la riga ha ${row.length} valori ma le colonne indicate sono ${columns.length}`);
        }
        // Una riga più corta non è un errore: nei CSV le colonne finali vuote
        // spesso non vengono nemmeno scritte, e valgono NULL.
        const conv = columns.map((_, c) => convertValue(row[c], kinds[c]));
        for (let c = 0; c < conv.length; c++) {
          if (typeof conv[c] === 'string') maxLen[c] = Math.max(maxLen[c], Buffer.byteLength(conv[c]));
        }
        values.push(conv);
        srcIndex.push(i);
      } catch (err) {
        errors.push({ row: i, message: err.message });
      }
    }
    if (errors.length && !continueOnError) {
      return res.json({
        inserted: 0,
        failed: errors.length,
        errors: errors.slice(0, MAX_REPORTED_ERRORS),
        txnOpen: await runExclusive(entry, () => getTxnOpen(entry.session)),
      });
    }

    // maxSize obbligatorio per le stringhe in executeMany: si prende la
    // lunghezza massima del lotto (in byte, non caratteri: è così che il driver
    // dimensiona il buffer), mai zero.
    const bindDefs = kinds.map((k, c) => {
      if (k === 'number') return { type: oracledb.NUMBER };
      if (k === 'date') return { type: oracledb.DATE };
      return { type: oracledb.STRING, maxSize: maxLen[c] };
    });

    const out = await runExclusive(entry, async () => {
      entry.executing = true;
      try {
        let inserted = 0;
        if (values.length) {
          const r = await entry.session.executeMany(sql, values, {
            autoCommit: false,
            batchErrors: continueOnError,
            bindDefs,
          });
          for (const be of r.batchErrors || []) {
            errors.push({ row: srcIndex[be.offset] ?? be.offset, message: be.message });
          }
          inserted =
            typeof r.rowsAffected === 'number'
              ? r.rowsAffected
              : values.length - (r.batchErrors?.length || 0);
        }
        // Il COMMIT è di sessione, e la sessione è quella del foglio: darlo a
        // vuoto renderebbe definitivo il lavoro che l'utente ha in sospeso lì
        // e che non c'entra niente con l'importazione.
        if (body.commit === true && inserted > 0) await entry.session.commit();
        return { inserted, txnOpen: await getTxnOpen(entry.session) };
      } catch (err) {
        // Senza batchErrors il driver si ferma alla prima riga rifiutata, ma
        // non dice quale: `err.offset` è la posizione dell'errore dentro il
        // testo dell'istruzione, non un indice di riga (l'indice di riga
        // esiste solo dentro `batchErrors`). Meglio nessun numero che uno
        // sbagliato, che indicherebbe sempre la prima riga del lotto.
        errors.push({ row: null, message: err.message });
        // Quante righe siano già passate non lo sappiamo: `inserted: null`
        // dice «non pervenuto», e `txnOpen` racconta il resto — le righe
        // precedenti al rifiuto sono nella transazione aperta e vanno
        // confermate o annullate dal foglio.
        return {
          error: { message: err.message, num: err.errorNum },
          inserted: null,
          txnOpen: await getTxnOpen(entry.session),
        };
      } finally {
        entry.executing = false;
      }
    });

    if (out.error) {
      return res.json({
        error: out.error,
        inserted: out.inserted ?? null,
        failed: errors.length,
        errors: errors.slice(0, MAX_REPORTED_ERRORS),
        txnOpen: out.txnOpen,
      });
    }
    res.json({
      inserted: out.inserted,
      failed: errors.length,
      errors: errors.slice(0, MAX_REPORTED_ERRORS),
      txnOpen: out.txnOpen,
    });
  })
);

export default router;
