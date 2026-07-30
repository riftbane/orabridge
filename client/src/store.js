import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from './api.js';
import { DEFAULT_SEARCH_TYPES } from './searchTypes.js';

let wsCounter = 1;
let toastId = 1;

// Flusso degli eventi MCP: uno solo per finestra, aperto all'avvio e mai
// chiuso. Vive fuori dallo stato — è un oggetto del browser, non un dato.
let mcpStream = null;

// Da chi sta leggendo adesso a chi ha letto per ultimo: due mappe per connessione
// ricavate dal flusso, così la barra laterale non deve scorrerlo a ogni disegno.
function mcpDerived(feed) {
  const mcpBusy = {};
  const mcpLast = {};
  for (const e of feed) {
    if (!e.connId) continue;
    if (e.running) mcpBusy[e.connId] = (mcpBusy[e.connId] || 0) + 1;
    if (!mcpLast[e.connId]) mcpLast[e.connId] = e;
  }
  return { mcpBusy, mcpLast };
}

// Caricamenti di metadati in corso, per non ripetere la stessa richiesta.
const pendingMeta = new Map();

// Schede che possono opporsi alla propria chiusura (il diagramma, quando ha
// modifiche non applicate). Vivono fuori dallo stato: sono funzioni, e non
// hanno niente da fare in qualcosa che viene persistito.
const closeGuards = new Map();
export const setCloseGuard = (tabId, guard) => {
  if (guard) closeGuards.set(tabId, guard);
  else closeGuards.delete(tabId);
};

// Ogni richiesta di salto a una riga porta un numero progressivo: riaprendo lo
// stesso risultato la scheda è già aperta, e senza qualcosa che cambia la
// scheda non si accorgerebbe che deve saltare di nuovo.
let focusSeq = 1;
// Ricerche nel codice: solo l'ultima lanciata ha diritto di scrivere il
// risultato (le precedenti possono tornare dopo, su database lenti).
let searchSeq = 0;

export const useStore = create(
  persist(
    (set, get) => ({
      conns: [],
      active: {}, // connId -> { status, user, currentSchema, version, txnOpen }
      // connId -> { owner, schemas: [nomi], byOwner: { SCHEMA: metadati } }
      // Metadati per l'autocomplete dell'editor (vedi completion.js).
      sqlMeta: {},
      tabs: [],
      activeTabId: null,
      drafts: {}, // tabId -> sql text
      toasts: [],
      maxRows: 500,

      // ---- disposizione delle finestre ----
      // Larghezze/altezze dei pannelli e quali sono visibili: persistite, così
      // l'area di lavoro si ritrova com'era all'avvio successivo.
      ui: {
        sidebar: true,
        sidebarWidth: 280,
        // Vista aperta nella barra laterale, scelta dalla barra delle attività
        // (ActivityBar.jsx): 'connections' | 'connection' | 'search'.
        sidebarView: 'connections',
        ai: false,
        aiWidth: 400,
        aiFull: false,
        results: true,
        resultsHeight: 280,
        // Mostra le entità HTML dei valori testuali decodificate (`&agrave;` →
        // `à`): serve con i dati scritti da applicativi web legacy. Spento di
        // default — la griglia deve mostrare il dato com'è nel database.
        decodeEntities: false,
      },
      setUi(patch) {
        set((s) => ({ ui: { ...s.ui, ...patch } }));
      },
      toggleUi(key) {
        set((s) => ({ ui: { ...s.ui, [key]: !s.ui[key] } }));
      },

      // ---- barra laterale a viste ----
      // Come la barra delle attività di VS Code: l'icona porta alla sua vista,
      // e ricliccare quella già aperta chiude (o riapre) il pannello.
      showSidebarView(view) {
        set((s) => ({
          ui: {
            ...s.ui,
            sidebarView: view,
            sidebar: s.ui.sidebarView === view ? !s.ui.sidebar : true,
          },
        }));
      },
      // Apre la vista senza mai chiudere il pannello: è quello che serve a chi
      // arriva da una scorciatoia o da un pulsante fuori dalla barra.
      openSidebarView(view) {
        set((s) => ({ ui: { ...s.ui, sidebarView: view, sidebar: true } }));
      },

      // Connessione su cui lavorano la vista «Connessione» e la ricerca
      // globale: una sola, scelta esplicitamente o ereditata dall'ultima
      // connessione riuscita.
      selectedConnId: null,
      selectConnection(id) {
        set({ selectedConnId: id });
      },

      // Sessione dell'assistente aperta nel pannello.
      aiSessionId: null,
      setAiSession(id) {
        set({ aiSessionId: id });
      },
      // Apre il pannello AI (e lo mette in primo piano se era nascosto).
      openAi() {
        set((s) => ({ ui: { ...s.ui, ai: true } }));
      },

      // ---- toasts ----
      toast(text, type = 'info') {
        const id = toastId++;
        set((s) => ({ toasts: [...s.toasts, { id, text, type }] }));
        setTimeout(
          () => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
          type === 'error' ? 6000 : 3500
        );
      },

      // ---- connections ----
      async refreshConnections() {
        const list = await api.listConnections();
        set((s) => {
          const active = { ...s.active };
          for (const c of list) {
            if (!c.connected) delete active[c.id];
          }
          return { conns: list, active };
        });
      },

      // ---- attività MCP (Copilot in VS Code) ----
      // Copilot lavora in un'altra finestra e da poco si collega da solo ai
      // database esposti: senza questo flusso l'utente scoprirebbe dopo, e per
      // caso, che un database è stato aperto e letto. Il server manda una voce
      // per chiamata (vedi server/src/mcp/activity.js), aggiornata sul posto
      // dall'inizio alla fine.
      mcpFeed: [], // voci dalla più recente
      mcpBusy: {}, // connId -> chiamate in corso adesso
      mcpLast: {}, // connId -> ultima voce, per i tooltip della barra laterale

      startMcpStream() {
        if (mcpStream) return;
        mcpStream = new EventSource(api.mcpEventsUrl());
        mcpStream.onmessage = (e) => {
          let msg;
          try {
            msg = JSON.parse(e.data);
          } catch {
            return;
          }
          if (msg.type === 'snapshot') get().setMcpFeed(msg.entries || []);
          else if (msg.type === 'entry') get().applyMcpEntry(msg.entry);
        };
        // EventSource riprova da sé quando il server si riavvia: niente da fare
        // qui se non evitare che l'errore finisca in console come un guasto.
        mcpStream.onerror = () => {};
      },

      setMcpFeed(entries) {
        const feed = [...entries].sort((a, b) => b.at - a.at).slice(0, 60);
        set({ mcpFeed: feed, ...mcpDerived(feed) });
      },

      applyMcpEntry(entry) {
        if (!entry?.id) return;
        // Sostituzione, non aggiunta: la stessa voce arriva due volte (inizio e
        // fine) e deve restare al suo posto in ordine di tempo, non risalire in
        // cima quando finisce.
        const feed = [entry, ...get().mcpFeed.filter((e) => e.id !== entry.id)]
          .sort((a, b) => b.at - a.at)
          .slice(0, 60);
        set({ mcpFeed: feed, ...mcpDerived(feed) });
        // Collegamento aperto da Copilot: la barra laterale deve mostrarlo
        // connesso come se l'avesse aperto l'utente, subito.
        if (entry.kind === 'open' && entry.connId) {
          set((s) => ({
            active: {
              ...s.active,
              [entry.connId]: {
                status: 'connected',
                user: entry.user,
                currentSchema: entry.schema,
                version: entry.version,
              },
            },
            conns: s.conns.map((c) => (c.id === entry.connId ? { ...c, connected: true } : c)),
          }));
          get().toast(`Copilot ha collegato ${entry.connName}`, 'info');
          get().loadAutocomplete(entry.connId);
        }
      },

      // Connessione in attesa di password: { connId, error }. Vale sia quando
      // la password non è mai stata salvata sia quando non è più valida —
      // invece di mostrare solo l'errore si chiede la password all'utente
      // (vedi PasswordPrompt.jsx), e se funziona viene salvata dal server.
      passwordPrompt: null,
      closePasswordPrompt() {
        set({ passwordPrompt: null });
      },

      async connect(id, password) {
        const { toast } = get();
        set((s) => ({ active: { ...s.active, [id]: { status: 'connecting' } } }));
        try {
          const info = await api.connect(id, password);
          set((s) => ({
            active: { ...s.active, [id]: { status: 'connected', ...info } },
            conns: s.conns.map((c) => (c.id === id ? { ...c, connected: true } : c)),
            passwordPrompt: null,
            // Appena connessi è questa la connessione a cui si sta pensando:
            // la vista «Connessione» e la ricerca globale la seguono.
            selectedConnId: id,
          }));
          const name = get().conns.find((c) => c.id === id)?.name;
          toast(`Connesso a ${name}${info.passwordSaved ? ' — password salvata' : ''}`, 'ok');
          get().loadAutocomplete(id);
        } catch (err) {
          set((s) => ({ active: { ...s.active, [id]: { status: 'error', error: err.message } } }));
          if (err.data?.needsPassword) {
            set({
              passwordPrompt: {
                connId: id,
                // Alla prima richiesta (password mai salvata) non c'è nulla da
                // segnalare come errore: il prompt basta da solo.
                error: err.data.reason === 'missing' ? '' : err.message,
              },
            });
            return;
          }
          toast(`Connessione fallita: ${err.message}`, 'error');
        }
      },

      async disconnect(id) {
        await api.disconnect(id).catch(() => {});
        set((s) => {
          const active = { ...s.active };
          delete active[id];
          const sqlMeta = { ...s.sqlMeta };
          delete sqlMeta[id];
          return {
            active,
            sqlMeta,
            conns: s.conns.map((c) => (c.id === id ? { ...c, connected: false } : c)),
          };
        });
      },

      // Metadati dello schema di lavoro: ricaricati alla connessione e dopo
      // ogni DDL, così l'autocomplete resta allineato.
      async loadAutocomplete(id) {
        const owner = get().active[id]?.currentSchema;
        if (!owner) return;
        pendingMeta.delete(`${id}:${owner}`);
        try {
          const data = await api.autocomplete(id, owner);
          set((s) => {
            const cur = s.sqlMeta[id] || {};
            return {
              sqlMeta: {
                ...s.sqlMeta,
                [id]: { ...cur, owner, byOwner: { ...cur.byOwner, [owner]: data } },
              },
            };
          });
        } catch {
          /* non-fatal */
        }
        if (!get().sqlMeta[id]?.schemas) {
          try {
            const { schemas } = await api.schemas(id);
            set((s) => ({
              sqlMeta: { ...s.sqlMeta, [id]: { ...(s.sqlMeta[id] || {}), schemas } },
            }));
          } catch {
            /* non-fatal */
          }
        }
      },

      // Elenco degli schemi del database, in cache: lo usano il selettore
      // della vista «Connessione» e l'ambito della ricerca globale.
      loadSchemas(connId) {
        const cached = get().sqlMeta[connId]?.schemas;
        if (cached) return Promise.resolve(cached);
        const key = `${connId}:__schemas__`;
        if (pendingMeta.has(key)) return pendingMeta.get(key);
        const p = api
          .schemas(connId)
          .then(({ schemas }) => {
            set((s) => ({
              sqlMeta: { ...s.sqlMeta, [connId]: { ...(s.sqlMeta[connId] || {}), schemas } },
            }));
            return schemas;
          })
          .catch(() => [])
          .finally(() => pendingMeta.delete(key));
        pendingMeta.set(key, p);
        return p;
      },

      // Metadati di un altro schema, caricati la prima volta che servono
      // (quando si scrive "ALTRO_SCHEMA." nell'editor).
      loadSchemaMeta(id, owner) {
        const cached = get().sqlMeta[id]?.byOwner?.[owner];
        if (cached) return Promise.resolve(cached);
        const key = `${id}:${owner}`;
        if (pendingMeta.has(key)) return pendingMeta.get(key);
        const p = api
          .autocomplete(id, owner)
          .then((data) => {
            set((s) => {
              const cur = s.sqlMeta[id] || {};
              return {
                sqlMeta: {
                  ...s.sqlMeta,
                  [id]: { ...cur, byOwner: { ...cur.byOwner, [owner]: data } },
                },
              };
            });
            return data;
          })
          .catch(() => null)
          .finally(() => pendingMeta.delete(key));
        pendingMeta.set(key, p);
        return p;
      },

      // ---- ricerca globale nel codice PL/SQL ----
      // Lo stato vive qui e non nel componente: la barra laterale si chiude e
      // si riapre (Ctrl+B, cambio vista) e i risultati devono restare.
      codeSearch: {
        query: '',
        caseSensitive: false,
        wholeWord: false,
        regex: false,
        types: DEFAULT_SEARCH_TYPES,
        scope: 'current', // 'current' | 'one' | 'user' | 'all'
        owner: '',
        focusToken: 0, // cambia quando la scorciatoia chiede il fuoco sul campo
        running: false,
        error: null,
        result: null, // { connId, spec, objects, total, objectCount, truncated, elapsedMs }
      },
      setCodeSearch(patch) {
        set((s) => ({ codeSearch: { ...s.codeSearch, ...patch } }));
      },
      // Apre la vista e rimette il fuoco nel campo (scorciatoia da tastiera):
      // il numero che cambia è il segnale, la vista può essere già aperta.
      focusCodeSearch() {
        set((s) => ({
          ui: { ...s.ui, sidebarView: 'search', sidebar: true },
          codeSearch: { ...s.codeSearch, focusToken: (s.codeSearch.focusToken || 0) + 1 },
        }));
      },
      clearCodeSearch() {
        searchSeq++; // una risposta in volo non deve ricomparire dopo il reset
        set((s) => ({ codeSearch: { ...s.codeSearch, result: null, error: null, running: false } }));
      },

      async runCodeSearch() {
        const connId = get().selectedConnId;
        const cs = get().codeSearch;
        if (!cs.query) return;
        if (!connId || get().active[connId]?.status !== 'connected') {
          set((s) => ({
            codeSearch: { ...s.codeSearch, error: 'Nessuna connessione attiva', result: null },
          }));
          return;
        }
        const seq = ++searchSeq;
        const spec = {
          q: cs.query,
          caseSensitive: cs.caseSensitive,
          wholeWord: cs.wholeWord,
          regex: cs.regex,
        };
        set((s) => ({ codeSearch: { ...s.codeSearch, running: true, error: null } }));
        try {
          const r = await api.searchCode(connId, {
            q: cs.query,
            types: cs.types.join(','),
            scope: cs.scope,
            owner: cs.scope === 'one' ? cs.owner : '',
            caseSensitive: cs.caseSensitive ? '1' : '',
            wholeWord: cs.wholeWord ? '1' : '',
            regex: cs.regex ? '1' : '',
          });
          if (seq !== searchSeq) return; // risposta di una ricerca superata
          set((s) => ({
            codeSearch: {
              ...s.codeSearch,
              running: false,
              error: r.error || null,
              result: r.error ? null : { ...r, connId, spec },
            },
          }));
        } catch (err) {
          if (seq !== searchSeq) return;
          set((s) => ({
            codeSearch: { ...s.codeSearch, running: false, error: err.message, result: null },
          }));
          if (err.status === 409) get().markDisconnected(connId);
        }
      },

      // Incremented after DDL so open tree folders reload their contents.
      treeBump: {},
      bumpTree(connId) {
        set((s) => ({ treeBump: { ...s.treeBump, [connId]: (s.treeBump[connId] || 0) + 1 } }));
      },

      setTxnOpen(connId, txnOpen) {
        set((s) => {
          const cur = s.active[connId];
          if (!cur || cur.txnOpen === txnOpen) return {};
          return { active: { ...s.active, [connId]: { ...cur, txnOpen } } };
        });
      },

      markDisconnected(connId) {
        set((s) => {
          const active = { ...s.active };
          delete active[connId];
          const sqlMeta = { ...s.sqlMeta };
          delete sqlMeta[connId];
          return {
            active,
            sqlMeta,
            conns: s.conns.map((c) => (c.id === connId ? { ...c, connected: false } : c)),
          };
        });
      },

      // ---- tabs ----
      openWorksheet(connId, initialSql) {
        const id = `ws-${Date.now()}-${wsCounter++}`;
        const conn = get().conns.find((c) => c.id === connId);
        const tab = { id, kind: 'worksheet', connId, title: conn ? conn.name : 'Foglio' };
        set((s) => ({
          tabs: [...s.tabs, tab],
          activeTabId: id,
          drafts: initialSql ? { ...s.drafts, [id]: initialSql } : s.drafts,
        }));
      },

      // Tab singleton: riapre semplicemente lo stesso se già presente.
      historyFilterConnId: null,
      openHistory(connId = null) {
        set({ historyFilterConnId: connId });
        const id = 'history';
        const exists = get().tabs.find((t) => t.id === id);
        if (!exists) {
          set((s) => ({ tabs: [...s.tabs, { id, kind: 'history', title: 'Cronologia' }] }));
        }
        set({ activeTabId: id });
      },

      setHistoryFilter(connId) {
        set({ historyFilterConnId: connId });
      },

      // Guida dell'app: scheda singleton, e la sezione aperta è condivisa con
      // la copia mostrata nelle impostazioni (si riprende da dov'era).
      guideSection: 'intro',
      setGuideSection(id) {
        set({ guideSection: id });
      },
      openGuide(sectionId) {
        if (sectionId) set({ guideSection: sectionId });
        const id = 'guide';
        if (!get().tabs.find((t) => t.id === id)) {
          set((s) => ({ tabs: [...s.tabs, { id, kind: 'guide', title: 'Guida' }] }));
        }
        set({ activeTabId: id });
      },

      // Confronto fra due database: più schede insieme sono legittime
      // (confronti diversi), quindi niente singleton.
      openDiff() {
        const id = `diff-${Date.now()}-${wsCounter++}`;
        set((s) => ({ tabs: [...s.tabs, { id, kind: 'diff', title: 'DB Diff' }], activeTabId: id }));
      },

      // Editor a nodi (beta). Come il confronto, più schede insieme sono
      // legittime: sono diagrammi diversi.
      openGraph(connId, owner) {
        const id = `graph-${Date.now()}-${wsCounter++}`;
        set((s) => ({
          tabs: [...s.tabs, { id, kind: 'graph', connId, owner, title: 'Diagramma' }],
          activeTabId: id,
        }));
      },

      setTabTitle(id, title) {
        set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, title } : t)) }));
      },

      // `focus` (facoltativo) è il punto del sorgente da mostrare, come lo
      // manda la ricerca globale: { line, text, from, to }. La scheda si apre
      // sul Sorgente e ci salta sopra (vedi ObjectDetail.jsx).
      openObject(connId, owner, name, type, focus) {
        const id = `obj-${connId}-${owner}.${name}-${type}`;
        const f = focus ? { ...focus, seq: focusSeq++ } : null;
        const exists = get().tabs.find((t) => t.id === id);
        if (exists) {
          set((s) => ({
            activeTabId: id,
            tabs: f ? s.tabs.map((t) => (t.id === id ? { ...t, focus: f } : t)) : s.tabs,
          }));
          return;
        }
        const tab = { id, kind: 'object', connId, owner, name, type, title: name, focus: f };
        set((s) => ({ tabs: [...s.tabs, tab], activeTabId: id }));
      },

      closeTab(id) {
        // Una scheda con lavoro non applicato chiede conferma prima di
        // sparire: il diagramma non persiste le modifiche in sospeso.
        if (closeGuards.get(id)?.() === false) return;
        closeGuards.delete(id);
        set((s) => {
          const idx = s.tabs.findIndex((t) => t.id === id);
          const tabs = s.tabs.filter((t) => t.id !== id);
          const drafts = { ...s.drafts };
          delete drafts[id];
          let activeTabId = s.activeTabId;
          if (activeTabId === id) {
            activeTabId = tabs[Math.min(idx, tabs.length - 1)]?.id ?? null;
          }
          return { tabs, drafts, activeTabId };
        });
      },

      setActiveTab(id) {
        set({ activeTabId: id });
      },

      setDraft(tabId, text) {
        set((s) => ({ drafts: { ...s.drafts, [tabId]: text } }));
      },

      setMaxRows(n) {
        set({ maxRows: n });
      },
    }),
    {
      name: 'orabridge',
      partialize: (s) => ({
        // `focus` è il salto a una riga chiesto dalla ricerca: vale per il
        // clic che l'ha generato, non al riavvio dell'app.
        tabs: s.tabs.map(({ focus, ...t }) => t),
        activeTabId: s.activeTabId,
        drafts: s.drafts,
        maxRows: s.maxRows,
        ui: s.ui,
        selectedConnId: s.selectedConnId,
        aiSessionId: s.aiSessionId,
        guideSection: s.guideSection,
      }),
      // Una versione salvata prima dell'introduzione dei pannelli non ha `ui`:
      // si completa con i valori di default invece di partire con campi vuoti.
      merge: (persisted, current) => ({
        ...current,
        ...persisted,
        ui: { ...current.ui, ...(persisted?.ui || {}) },
      }),
    }
  )
);
