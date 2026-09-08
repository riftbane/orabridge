import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ExternalLink,
  Flame,
  HardDrive,
  Lock,
  RefreshCw,
  Search,
  Server,
  ShieldAlert,
  Timer,
  Users,
  X,
} from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.js';
import Grid from './Grid.jsx';
import ContextMenu from './ContextMenu.jsx';

// Monitor DBA: una scheda per connessione sulle viste dinamiche di Oracle.
// Tutto quello che si legge qui sta in V$/DBA_, che su un'utenza applicativa
// quasi mai è concesso: la scheda parte da `capabilities` e spegne in anticipo
// le linguette che questa utenza non può aprire, invece di farle fallire una
// alla volta con un errore che sembra un guasto.

const SECTIONS = [
  { key: 'sessions', label: 'Sessioni', icon: Users, cap: 'sessions', view: 'V$SESSION' },
  { key: 'locks', label: 'Lock', icon: Lock, cap: 'locks', view: 'V$LOCK' },
  {
    key: 'tablespaces',
    label: 'Tablespace',
    icon: HardDrive,
    cap: 'tablespaces',
    view: 'DBA_DATA_FILES',
  },
  // L'istanza risponde comunque: quando V$INSTANCE non è leggibile il server
  // ripiega su sys_context, quindi questa linguetta non si spegne mai.
  {
    key: 'instance',
    label: 'Istanza',
    icon: Server,
    cap: 'instance',
    view: 'V$INSTANCE',
    always: true,
  },
  { key: 'top-sql', label: 'Top SQL', icon: Flame, cap: 'topSql', view: 'V$SQLAREA' },
  { key: 'waits', label: 'Attese', icon: Timer, cap: 'waits', view: 'V$SYSTEM_EVENT' },
];

const REFRESH_CHOICES = [
  { value: 0, label: 'Off' },
  { value: 5, label: '5 s' },
  { value: 10, label: '10 s' },
  { value: 30, label: '30 s' },
];

// Le chiavi sono quelle che la rotta /top-sql sa tradurre in una colonna di
// V$SQLAREA: cambiarle qui senza cambiarle là fa ricadere l'ordinamento sul
// tempo totale, in silenzio.
const TOP_SQL_ORDERS = [
  { value: 'elapsed', label: 'Tempo totale' },
  { value: 'cpu', label: 'CPU' },
  { value: 'gets', label: 'Letture logiche' },
  { value: 'execs', label: 'Esecuzioni' },
  { value: 'reads', label: 'Letture fisiche' },
];

const TOP_SQL_LIMITS = [10, 25, 50, 100];

const KILL_READONLY =
  'La connessione è aperta in sola lettura: terminare una sessione è disabilitato';

// Un privilegio che manca non è un errore dell'applicazione: è uno stato
// previsto e il messaggio che dice quale vista serve è l'unica cosa utile
// della sezione. Perciò ha l'aria di un avviso, non quella di un guasto.
function DbaMessage({ text, onRetry }) {
  return (
    <div className="dba-msg">
      <AlertTriangle size={15} />
      <div className="dba-msg-text">{text}</div>
      {onRetry && (
        <button className="btn" onClick={onRetry}>
          <RefreshCw size={13} /> Riprova
        </button>
      )}
    </div>
  );
}

const colIndex = (columns, name) => columns.findIndex((c) => c.name === name);

// Grid azzera larghezze, ordinamento, filtri e scorrimento ogni volta che
// cambia l'*identità* dell'array delle colonne. Con l'aggiornamento automatico
// acceso il server ne manda uno nuovo ogni cinque secondi: senza questa cache
// la griglia si riazzererebbe sotto gli occhi di chi la sta ordinando. Finché
// nomi e tipi sono gli stessi si tiene l'array di prima.
function useStableColumns(columns) {
  const ref = useRef(null);
  const same =
    ref.current &&
    columns &&
    ref.current.length === columns.length &&
    ref.current.every((c, i) => c.name === columns[i].name && c.type === columns[i].type);
  if (!same) ref.current = columns || null;
  return ref.current;
}

// La griglia del monitor è sempre in sola lettura: nessuna callback di
// modifica, altrimenti Grid mostrerebbe la barra «Nuova riga / Elimina» su
// una vista dinamica che non si può scrivere.
function MonitorGrid({ columns, rows, emptyText }) {
  const stable = useStableColumns(columns);
  // `emptyText` di Grid vale solo quando mancano le colonne: qui le colonne
  // ci sono sempre (la query è andata a buon fine) e a mancare sono le righe,
  // che senza questo darebbero una griglia vuota e muta.
  if (emptyText && !rows?.length) return <div className="grid-empty">{emptyText}</div>;
  return <Grid columns={stable || []} rows={rows || []} emptyText={emptyText} />;
}

const fmtNum = (v) =>
  v == null || v === '' || Number.isNaN(Number(v)) ? '—' : Number(v).toLocaleString('it-IT');

// Grid non espone callback sulle righe e non va cambiata per due sezioni: la
// riga su cui si è cliccato si rilegge dal DOM, che è anche l'unico posto dove
// l'ordinamento e i filtri interni della griglia sono già applicati (l'indice
// dell'array di partenza, lì, non vorrebbe più dire niente).
function rowFromEvent(e, columns) {
  const el = e.target?.closest?.('.grid-row');
  if (!el) return null;
  const cells = [...el.children].filter((c) => !c.classList.contains('grid-rownum'));
  if (cells.length !== columns.length) return null;
  const out = {};
  columns.forEach((c, i) => {
    out[c.name] = cells[i].querySelector('.null') ? null : cells[i].textContent;
  });
  return out;
}

// Il testo dell'istruzione di una sessione: `sql_fulltext` quando c'è, il
// troncato di V$SQL o i pezzi di V$SQLTEXT_WITH_NEWLINES quando il cursore è
// già stato scartato — il server ha già scelto, qui si prende il migliore.
function SessionSqlDialog({ dlg, connId, onClose }) {
  const text = dlg.data?.sqlFullText || dlg.data?.sql || '';
  return (
    <div className="modal-overlay">
      <div className="modal dba-modal-wide">
        <div className="modal-head">
          <span>
            SQL della sessione {dlg.sid},{dlg.serial}
            {dlg.user ? ` — ${dlg.user}` : ''}
          </span>
          <button className="icon-btn" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="modal-body">
          {dlg.loading ? (
            <div className="pane-info">Lettura in corso…</div>
          ) : dlg.data?.error ? (
            <DbaMessage text={dlg.data.error} />
          ) : text ? (
            <>
              {dlg.data?.sqlId && <div className="pane-info">SQL ID {dlg.data.sqlId}</div>}
              <pre className="dba-sql-text">{text}</pre>
            </>
          ) : (
            <div className="pane-info">
              La sessione non sta eseguendo niente e il cursore dell&apos;ultima istruzione non è
              più nella shared pool: non c&apos;è più un testo da mostrare.
            </div>
          )}
        </div>
        <div className="modal-foot">
          <div style={{ flex: 1 }} />
          {text && (
            <button
              className="btn"
              onClick={() => {
                useStore.getState().openWorksheet(connId, text);
                onClose();
              }}
            >
              <ExternalLink size={13} /> Apri in un foglio SQL
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Chiudi
          </button>
        </div>
      </div>
    </div>
  );
}

// La conferma ripete SID e utente perché è l'azione più pericolosa dell'app:
// una sessione terminata per sbaglio si porta via la transazione aperta di
// qualcun altro. Il fuoco parte da «Annulla» — un Invio battuto per abitudine
// non deve uccidere niente — e la conferma è l'unico pulsante rosso.
function KillSessionDialog({ target, busy, onCancel, onConfirm }) {
  const [immediate, setImmediate] = useState(false);
  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-head">
          <span className="dba-danger-head">
            <ShieldAlert size={15} /> Termina sessione
          </span>
          <button className="icon-btn" onClick={onCancel} disabled={busy}>
            <X size={14} />
          </button>
        </div>
        <div className="modal-body">
          <div className="dba-kill-target">
            <div>
              <span className="dba-kv-name">Sessione</span>
              <b className="dba-mono">
                {target.sid},{target.serial}
              </b>
            </div>
            <div>
              <span className="dba-kv-name">Utente</span>
              <b className="dba-mono">{target.user || '(sconosciuto)'}</b>
            </div>
            {target.machine && (
              <div>
                <span className="dba-kv-name">Macchina</span>
                <b className="dba-mono">{target.machine}</b>
              </div>
            )}
            {target.program && (
              <div>
                <span className="dba-kv-name">Programma</span>
                <b className="dba-mono">{target.program}</b>
              </div>
            )}
          </div>
          <div className="pane-info">
            Oracle esegue il rollback della transazione aperta: tutto quello che quella sessione
            non ha ancora confermato va perso, e chi la sta usando riceve un errore.
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              checked={immediate}
              onChange={(e) => setImmediate(e.target.checked)}
            />
            <span>IMMEDIATE</span>
          </label>
          <div className="pane-info">
            Senza IMMEDIATE la sessione resta marcata KILLED finché non finisce
            l&apos;operazione in corso; con IMMEDIATE il rollback parte subito, ma su una
            transazione lunga occupa il database per tutto il tempo che serve a disfarla.
          </div>
        </div>
        <div className="modal-foot">
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onCancel} disabled={busy} autoFocus>
            Annulla
          </button>
          <button className="btn danger" onClick={() => onConfirm(immediate)} disabled={busy}>
            {busy ? 'Terminazione…' : 'Termina sessione'}
          </button>
        </div>
      </div>
    </div>
  );
}

// La percentuale usata è quello che si cerca davvero aprendo i tablespace: la
// barra la rende leggibile senza andare a cercare la colonna giusta fra dieci,
// e il colore dice da solo quando è il caso di preoccuparsi.
function TablespaceBars({ data }) {
  const at = {
    name: colIndex(data.columns, 'Nome'),
    pct: colIndex(data.columns, '% usata'),
    used: colIndex(data.columns, 'MB usati'),
    max: colIndex(data.columns, 'MB massimi'),
    type: colIndex(data.columns, 'Tipo'),
  };
  if (at.name < 0 || at.pct < 0 || !data.rows.length) return null;
  return (
    <div className="dba-ts-bars">
      {data.rows.map((r, i) => {
        // `Number(null)` è 0, e uno zero è indistinguibile da un tablespace
        // vuoto: una percentuale che il server non conosce (tablespace fuori
        // dalle metriche, temporanei senza V$TEMP_SPACE_HEADER) deve restare
        // sconosciuta, non diventare «0% verde».
        const raw = r[at.pct];
        const pct = raw == null || raw === '' ? NaN : Number(raw);
        const known = Number.isFinite(pct);
        // Sopra il 90% un tablespace è un guasto che sta per succedere; fra il
        // 75 e il 90 è qualcosa da tenere d'occhio.
        const level = !known ? '' : pct >= 90 ? 'err' : pct >= 75 ? 'warn' : 'ok';
        return (
          <div className="dba-ts" key={`${r[at.name]}-${i}`}>
            <div className="dba-ts-top">
              <span className="dba-ts-name" title={String(r[at.name] ?? '')}>
                {r[at.name]}
              </span>
              <span className={`dba-ts-pct ${level}`}>{known ? `${pct}%` : '—'}</span>
            </div>
            <div className="dba-ts-track">
              <div
                className={`dba-ts-fill ${level}`}
                style={{ width: `${known ? Math.max(0, Math.min(100, pct)) : 0}%` }}
              />
            </div>
            <div className="dba-ts-sub">
              {at.used >= 0 && at.max >= 0 && (
                <span>
                  {fmtNum(r[at.used])} / {fmtNum(r[at.max])} MB
                </span>
              )}
              {at.type >= 0 && <span className="dba-ts-type">{r[at.type]}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function KvBox({ title, rows }) {
  return (
    <div className="dba-kv">
      <div className="dba-kv-title">{title}</div>
      {(rows || []).map((r, i) => (
        <div className="dba-kv-row" key={`${r.nome}-${i}`}>
          <span className="dba-kv-name">{r.nome}</span>
          <span className="dba-kv-value" title={r.valore == null ? '' : String(r.valore)}>
            {r.valore == null || r.valore === '' ? '—' : String(r.valore)}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function DbaView({ tab }) {
  const { connId } = tab;
  const conns = useStore((s) => s.conns);
  const active = useStore((s) => s.active[connId]);
  // L'aggiornamento automatico vale solo per la scheda che si sta guardando:
  // un monitor dimenticato aperto in sottofondo martellerebbe il database per
  // mostrare numeri che non vede nessuno.
  const isActive = useStore((s) => s.activeTabId) === tab.id;
  const connect = useStore((s) => s.connect);
  const toast = useStore((s) => s.toast);
  const conn = conns.find((c) => c.id === connId);
  const connected = active?.status === 'connected';
  const readOnly = !!active?.readOnly;

  const [sec, setSec] = useState(tab.section || 'sessions');
  const [caps, setCaps] = useState(null);
  const [every, setEvery] = useState(0);
  const [tick, setTick] = useState(0);
  const [state, setState] = useState({ data: null, err: null, at: 0 });
  const [loading, setLoading] = useState(false);
  const busyRef = useRef(false);

  // Filtri e opzioni delle singole sezioni.
  const [onlyActive, setOnlyActive] = useState(false);
  const [userText, setUserText] = useState('');
  const [user, setUser] = useState('');
  const [order, setOrder] = useState('elapsed');
  const [limit, setLimit] = useState(25);
  const [paramQuery, setParamQuery] = useState('');
  const [waitKind, setWaitKind] = useState('system');

  const [menu, setMenu] = useState(null);
  const [sqlDlg, setSqlDlg] = useState(null);
  const [killDlg, setKillDlg] = useState(null);
  const [killing, setKilling] = useState(false);
  const [picked, setPicked] = useState(null); // riga scelta in Top SQL

  // Le schede sopravvivono alla chiusura dell'app: se una scheda DBA torna su
  // all'avvio dietro a un'altra, le sue interrogazioni (V$SQLAREA in testa)
  // non hanno motivo di partire finché nessuno la guarda.
  const [seen, setSeen] = useState(isActive);
  useEffect(() => {
    if (isActive) setSeen(true);
  }, [isActive]);

  // Riaprire il monitor su una sezione precisa (openDba(connId, 'locks'))
  // cambia la scheda che è già aperta: qui la si segue.
  useEffect(() => {
    if (tab.section) setSec(tab.section);
  }, [tab.section]);

  const reload = useCallback(() => setTick((n) => n + 1), []);

  const loadCaps = useCallback(() => {
    if (!connected) return;
    // Senza elenco non si spegne niente: meglio una linguetta che risponde con
    // il suo errore che una spenta per un guasto della sola verifica.
    api.dba(connId, 'capabilities').then(setCaps, () => setCaps({}));
  }, [connId, connected]);

  useEffect(() => {
    if (seen) loadCaps();
  }, [seen, loadCaps]);

  // Il filtro per utente parte da solo poco dopo l'ultimo tasto: ogni lettera
  // è una lettura di V$SESSION, e battere un nome intero ne farebbe otto.
  useEffect(() => {
    const t = setTimeout(() => setUser(userText.trim()), 400);
    return () => clearTimeout(t);
  }, [userText]);

  const meta = SECTIONS.find((s) => s.key === sec) || SECTIONS[0];
  const unavailable = !!caps && !meta.always && caps[meta.cap] === false;

  const args = useMemo(() => {
    if (sec === 'sessions') return { onlyActive: onlyActive ? '1' : '', user };
    if (sec === 'top-sql') return { order, limit };
    return {};
  }, [sec, onlyActive, user, order, limit]);

  // Cambio di sezione: i dati della precedente non c'entrano più niente, e con
  // loro se ne vanno la riga scelta e i menu rimasti aperti.
  useEffect(() => {
    setState({ data: null, err: null, at: 0 });
    setPicked(null);
    setMenu(null);
  }, [sec]);

  useEffect(() => {
    if (!connected || !seen || unavailable) return undefined;
    let alive = true;
    busyRef.current = true;
    setLoading(true);
    api
      .dba(connId, sec, args)
      .then((r) => {
        if (alive) setState({ data: r, err: null, at: Date.now() });
      })
      .catch((e) => {
        if (e.status === 409) useStore.getState().markDisconnected(connId);
        if (alive) setState((s) => ({ ...s, err: e.message }));
      })
      .finally(() => {
        busyRef.current = false;
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [connId, sec, args, tick, connected, seen, unavailable]);

  // Il timer si ricrea a ogni cambio di sezione o di filtro: riparte da zero
  // invece di far scattare una lettura appena arrivati, e sparisce del tutto
  // quando la scheda non è quella attiva.
  useEffect(() => {
    if (!every || !isActive || !connected || unavailable) return undefined;
    const id = setInterval(() => {
      // Se la lettura precedente non è ancora tornata si salta il giro: le
      // richieste non devono accodarsi su un database lento.
      if (!busyRef.current) setTick((n) => n + 1);
    }, every * 1000);
    return () => clearInterval(id);
  }, [every, isActive, connected, unavailable, sec, args]);

  const showSessionSql = async (t) => {
    setSqlDlg({ ...t, loading: true, data: null });
    try {
      const r = await api.dba(connId, 'session-sql', { sid: t.sid, serial: t.serial });
      setSqlDlg({ ...t, loading: false, data: r });
    } catch (e) {
      setSqlDlg({ ...t, loading: false, data: { error: e.message } });
    }
  };

  const killSession = async (immediate) => {
    setKilling(true);
    try {
      const r = await api.dbaKillSession(connId, {
        sid: killDlg.sid,
        serial: killDlg.serial,
        immediate,
      });
      if (r.error) toast(r.error, 'error');
      else {
        toast(r.message || `Sessione ${killDlg.sid},${killDlg.serial} terminata`, 'ok');
        reload();
      }
    } catch (e) {
      if (e.status === 409) useStore.getState().markDisconnected(connId);
      toast(e.message, 'error');
    } finally {
      setKilling(false);
      setKillDlg(null);
    }
  };

  if (!connected) {
    return (
      <div className="ws-banner">
        Connessione non attiva: il monitor legge le viste dinamiche dell&apos;istanza.
        <button className="btn primary" onClick={() => connect(connId)}>
          Connetti
        </button>
      </div>
    );
  }

  const { data, err, at } = state;
  // La griglia davvero a video: nelle attese sono due, con troncamenti
  // indipendenti, e nell'istanza è quella dei parametri. Serve per dire «elenco
  // troncato» sulla griglia giusta invece che su quella in cima alla risposta.
  const shownGrid =
    sec === 'waits'
      ? (waitKind === 'system' ? data?.system : data?.current)
      : sec === 'instance'
        ? data?.parameters
        : data;

  const sessionMenu = (e) => {
    if (!data?.columns) return;
    const row = rowFromEvent(e, data.columns);
    if (!row) return;
    e.preventDefault();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      sid: row['SID'],
      serial: row['Serial#'],
      user: row['Utente'],
      machine: row['Macchina'],
      program: row['Programma'],
    });
  };

  // Il testo si riprende dalla risposta e non dalla cella: quello a video può
  // essere passato dalla decodifica delle entità HTML (ui.decodeEntities), e
  // un'istruzione con dentro `&amp;` finirebbe nel foglio SQL cambiata.
  const pickTopSql = (e) => {
    if (!data?.columns) return;
    const row = rowFromEvent(e, data.columns);
    if (!row) return;
    const iId = colIndex(data.columns, 'SQL ID');
    const iText = colIndex(data.columns, 'Testo');
    const src = iId >= 0 ? data.rows.find((r) => String(r[iId]) === row['SQL ID']) : null;
    setPicked({
      id: row['SQL ID'],
      text: (src && iText >= 0 ? src[iText] : row['Testo']) || '',
      user: row['Utente'],
    });
  };

  function toolbar() {
    if (unavailable) return null;
    if (sec === 'sessions') {
      return (
        <div className="dba-bar">
          <label className="dba-check">
            <input
              type="checkbox"
              checked={onlyActive}
              onChange={(e) => setOnlyActive(e.target.checked)}
            />
            <span>Solo attive</span>
          </label>
          <div className="dba-search">
            <Search size={12} />
            <input
              value={userText}
              placeholder="Utente…"
              onChange={(e) => setUserText(e.target.value)}
            />
            {userText && (
              <button className="icon-btn" title="Togli il filtro" onClick={() => setUserText('')}>
                <X size={12} />
              </button>
            )}
          </div>
          <div style={{ flex: 1 }} />
          {data?.rows && <span className="pane-info">{data.rows.length} sessioni</span>}
          <span className="pane-info">Tasto destro su una riga per le azioni</span>
          {readOnly && (
            <span className="pane-info dba-ro" title={KILL_READONLY}>
              sola lettura
            </span>
          )}
        </div>
      );
    }
    if (sec === 'top-sql') {
      return (
        <div className="dba-bar">
          <label className="dba-field">
            <span>Ordina per</span>
            <select value={order} onChange={(e) => setOrder(e.target.value)}>
              {TOP_SQL_ORDERS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="dba-field">
            <span>Righe</span>
            <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
              {TOP_SQL_LIMITS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <div style={{ flex: 1 }} />
          <span className="pane-info">Un clic su una riga apre il testo dell&apos;istruzione</span>
        </div>
      );
    }
    if (sec === 'waits') {
      return (
        <div className="dba-bar">
          <div className="dba-switch">
            <button
              className={waitKind === 'system' ? 'on' : ''}
              onClick={() => setWaitKind('system')}
            >
              Dall&apos;avvio dell&apos;istanza
            </button>
            <button
              className={waitKind === 'current' ? 'on' : ''}
              onClick={() => setWaitKind('current')}
            >
              In attesa adesso
            </button>
          </div>
          <div style={{ flex: 1 }} />
          <span className="pane-info">
            {waitKind === 'system'
              ? 'Attese cumulate da V$SYSTEM_EVENT, esclusa la classe Idle'
              : 'Sessioni ferme in questo istante (V$SESSION_WAIT)'}
          </span>
        </div>
      );
    }
    return null;
  }

  function content() {
    if (unavailable) {
      return (
        <DbaMessage
          text={
            `La sezione «${meta.label}» resta spenta perché questa utenza non può leggere ` +
            `${meta.view}: serve un GRANT SELECT sulla vista, o il ruolo ` +
            'SELECT_CATALOG_ROLE. Dopo la concessione basta riprovare.'
          }
          onRetry={loadCaps}
        />
      );
    }
    if (err) return <DbaMessage text={err} onRetry={reload} />;
    if (!data) return <div className="grid-empty">Caricamento…</div>;
    // Le attese sono due griglie con privilegi separati e l'errore della prima
    // arriva anche in cima alla risposta: qui lo si lascia gestire alle due
    // metà, altrimenti V$SESSION_WAIT resterebbe nascosta per colpa dell'altra.
    if (data.error && sec !== 'waits') return <DbaMessage text={data.error} onRetry={reload} />;

    if (sec === 'instance') {
      const p = data.parameters;
      const q = paramQuery.trim().toLowerCase();
      const rows =
        p?.rows && q
          ? p.rows.filter((r) => r.some((v) => v != null && String(v).toLowerCase().includes(q)))
          : p?.rows;
      return (
        <div className="dba-instance">
          <div className="dba-kv-boxes">
            <KvBox title="Istanza" rows={data.instance} />
            <KvBox title="Database" rows={data.database} />
          </div>
          <div className="dba-params">
            <div className="dba-bar">
              <span className="dba-section-title">Parametri non predefiniti</span>
              <div className="dba-search">
                <Search size={12} />
                <input
                  value={paramQuery}
                  placeholder="Cerca fra i parametri…"
                  onChange={(e) => setParamQuery(e.target.value)}
                />
                {paramQuery && (
                  <button
                    className="icon-btn"
                    title="Togli il filtro"
                    onClick={() => setParamQuery('')}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
              <div style={{ flex: 1 }} />
              {rows && <span className="pane-info">{rows.length} parametri</span>}
            </div>
            {p?.error ? (
              <DbaMessage text={p.error} onRetry={reload} />
            ) : (
              <div className="dba-grid">
                <MonitorGrid
                  columns={p?.columns || []}
                  rows={rows || []}
                  emptyText={
                    q
                      ? 'Nessun parametro con questo testo'
                      : 'Nessun parametro diverso dal valore predefinito'
                  }
                />
              </div>
            )}
          </div>
        </div>
      );
    }

    if (sec === 'waits') {
      const w = waitKind === 'system' ? data.system : data.current;
      if (!w) return <div className="grid-empty">Caricamento…</div>;
      if (w.error) return <DbaMessage text={w.error} onRetry={reload} />;
      return (
        <div className="dba-grid">
          <MonitorGrid
            columns={w.columns}
            rows={w.rows}
            emptyText={
              waitKind === 'current'
                ? 'Nessuna sessione in attesa in questo momento'
                : 'Nessun evento di attesa registrato'
            }
          />
        </div>
      );
    }

    if (sec === 'tablespaces') {
      return (
        <div className="dba-tablespaces">
          <TablespaceBars data={data} />
          <div className="dba-grid">
            <MonitorGrid
              columns={data.columns}
              rows={data.rows}
              emptyText="Nessun tablespace visibile"
            />
          </div>
        </div>
      );
    }

    if (sec === 'top-sql') {
      return (
        <div className="dba-split">
          <div className="dba-grid" onClick={pickTopSql}>
            <MonitorGrid
              columns={data.columns}
              rows={data.rows}
              emptyText="Nessuna istruzione nella shared pool"
            />
          </div>
          {picked && (
            <div className="dba-sqlpane">
              <div className="dba-sqlpane-head">
                <span className="dba-mono">{picked.id || 'SQL'}</span>
                {picked.user && <span className="pane-info">{picked.user}</span>}
                <div style={{ flex: 1 }} />
                <button
                  className="btn"
                  disabled={!picked.text}
                  onClick={() => useStore.getState().openWorksheet(connId, picked.text)}
                >
                  <ExternalLink size={13} /> Apri in un foglio SQL
                </button>
                <button className="icon-btn" onClick={() => setPicked(null)}>
                  <X size={14} />
                </button>
              </div>
              <pre className="dba-sql-text">{picked.text}</pre>
              {picked.text.length >= 200 && (
                <div className="dba-note">
                  V$SQLAREA espone qui solo i primi 200 caratteri dell&apos;istruzione: per il
                  testo intero serve il cursore della sessione che la sta eseguendo.
                </div>
              )}
            </div>
          )}
        </div>
      );
    }

    if (sec === 'locks') {
      return (
        <div className="dba-grid">
          <MonitorGrid
            columns={data.columns}
            rows={data.rows}
            emptyText="Nessun blocco: nessuna sessione sta aspettandone un'altra"
          />
        </div>
      );
    }

    return (
      <div className="dba-grid" onContextMenu={sessionMenu}>
        <MonitorGrid
          columns={data.columns}
          rows={data.rows}
          emptyText={
            onlyActive || user
              ? 'Nessuna sessione con questi filtri'
              : 'Nessuna sessione utente collegata'
          }
        />
      </div>
    );
  }

  return (
    <div className="object-detail">
      <div className="obj-head">
        <span className="type-icon" style={{ color: '#e5c07b', borderColor: '#e5c07b' }}>
          <Activity size={10} />
        </span>
        <span className="obj-title">{conn ? conn.name : connId}</span>
        {active.version && <span className="obj-type">Oracle {active.version}</span>}
        {active.user && <span className="obj-type">{active.user}</span>}
        <div style={{ flex: 1 }} />
        {at > 0 && (
          <span className="pane-info">
            Aggiornato alle {new Date(at).toLocaleTimeString('it-IT')}
          </span>
        )}
        <button className="btn" onClick={reload} disabled={loading || unavailable}>
          <RefreshCw size={13} className={loading ? 'dba-spin' : ''} /> Aggiorna
        </button>
        <label
          className="dba-field"
          title="L'aggiornamento automatico si ferma quando questa non è la scheda in primo piano"
        >
          <span>Auto</span>
          <select value={every} onChange={(e) => setEvery(Number(e.target.value))}>
            {REFRESH_CHOICES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="pane-tabs dba-tabs">
        {SECTIONS.map((s) => {
          const off = !!caps && !s.always && caps[s.cap] === false;
          const Icon = s.icon;
          return (
            <button
              key={s.key}
              className={sec === s.key ? 'on' : ''}
              disabled={off}
              title={
                off
                  ? `Non disponibile: questa utenza non può leggere ${s.view}`
                  : `Legge ${s.view}`
              }
              onClick={() => setSec(s.key)}
            >
              <Icon size={12} /> {s.label}
            </button>
          );
        })}
      </div>

      <div className="pane-body">
        {toolbar()}
        {content()}
        {shownGrid?.truncated && (
          <div className="dba-note">
            Elenco troncato alle {shownGrid.rows.length} righe mostrate: l&apos;istanza ne ha
            altre.
          </div>
        )}
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              label: 'Mostra SQL completo',
              hint: `${menu.sid},${menu.serial}`,
              onClick: () => showSessionSql(menu),
            },
            { separator: true },
            {
              label: 'Termina sessione…',
              hint: readOnly ? 'sola lettura' : menu.user || '',
              danger: true,
              disabled: readOnly,
              onClick: () => setKillDlg(menu),
            },
          ]}
        />
      )}
      {sqlDlg && (
        <SessionSqlDialog dlg={sqlDlg} connId={connId} onClose={() => setSqlDlg(null)} />
      )}
      {killDlg && (
        <KillSessionDialog
          target={killDlg}
          busy={killing}
          onCancel={() => setKillDlg(null)}
          onConfirm={killSession}
        />
      )}
    </div>
  );
}
