import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from './api.js';
import { DEFAULT_SEARCH_TYPES } from './searchTypes.js';

let wsCounter = 1;
let toastId = 1;

// Caricamenti di metadati in corso, per non ripetere la stessa richiesta.
const pendingMeta = new Map();

// I tipi di scheda che l'app sa disegnare (vedi App.jsx): quello che è stato
// salvato e non è più fra questi viene scartato al riavvio.
const KNOWN_TAB_KINDS = new Set([
  'worksheet',
  'object',
  'sysobject',
  'history',
  'diff',
  'guide',
  'dba',
]);

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
      // Fogli aperti da un file .sql: tabId -> { path, name, savedText }.
      // `savedText` è il testo com'è su disco: confrontandolo con la bozza si
      // sa se il foglio ha modifiche non salvate (vedi Worksheet.jsx).
      // `path` esiste solo nell'app desktop; nel browser si salva ogni volta
      // con la finestra del sistema (o scaricando il file).
      files: {},
      // Ultimi valori dati alle variabili di bind/sostituzione di un foglio:
      // rieseguendo la stessa query non vanno ridigitati.
      bindValues: {},
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
        // Esegue davvero l'istruzione e ne mostra il piano con le statistiche
        // reali (autotrace) invece del solo EXPLAIN PLAN, che non la esegue.
        autotrace: false,
        // Ultimo formato scelto nella finestra di esportazione, così la volta
        // dopo è già selezionato.
        exportFormat: 'csv',
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
            // La sola lettura si può cambiare su una connessione già aperta e
            // il server la applica subito: qui si riallinea quello che vede
            // l'interfaccia, che decide cosa disabilitare.
            else if (active[c.id] && active[c.id].readOnly !== !!c.readOnly) {
              active[c.id] = { ...active[c.id], readOnly: !!c.readOnly };
            }
          }
          return { conns: list, active };
        });
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
      // `opts.file` = { path, name, savedText }: il foglio nasce legato a un
      // file .sql aperto da disco e ne prende il nome come titolo.
      openWorksheet(connId, initialSql, opts = {}) {
        const id = `ws-${Date.now()}-${wsCounter++}`;
        const conn = get().conns.find((c) => c.id === connId);
        const file = opts.file || null;
        const tab = {
          id,
          kind: 'worksheet',
          connId,
          title: file ? file.name : conn ? conn.name : 'Foglio',
        };
        set((s) => ({
          tabs: [...s.tabs, tab],
          activeTabId: id,
          drafts: initialSql ? { ...s.drafts, [id]: initialSql } : s.drafts,
          files: file ? { ...s.files, [id]: file } : s.files,
        }));
        return id;
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

      // Oggetti che non stanno in ALL_OBJECTS o che non appartengono a uno
      // schema (vedi systemObjects.js): stessa scheda di dettaglio, ma le
      // linguette e le query le decide il tipo.
      openSystemObject(connId, type, name, owner = '') {
        const id = `sys-${connId}-${type}-${owner}.${name}`;
        if (get().tabs.find((t) => t.id === id)) {
          set({ activeTabId: id });
          return;
        }
        const tab = { id, kind: 'sysobject', connId, owner, name, type, title: name };
        set((s) => ({ tabs: [...s.tabs, tab], activeTabId: id }));
      },

      // Monitor DBA: una scheda per connessione (i dati sono quelli di quella
      // istanza), riaperta sulla sezione chiesta.
      openDba(connId, section) {
        const id = `dba-${connId}`;
        const conn = get().conns.find((c) => c.id === connId);
        const exists = get().tabs.find((t) => t.id === id);
        if (!exists) {
          set((s) => ({
            tabs: [
              ...s.tabs,
              {
                id,
                kind: 'dba',
                connId,
                title: `DBA — ${conn ? conn.name : connId}`,
                section: section || 'sessions',
              },
            ],
          }));
        } else if (section) {
          set((s) => ({
            tabs: s.tabs.map((t) => (t.id === id ? { ...t, section } : t)),
          }));
        }
        set({ activeTabId: id });
      },

      closeTab(id) {
        set((s) => {
          const idx = s.tabs.findIndex((t) => t.id === id);
          const tabs = s.tabs.filter((t) => t.id !== id);
          const drafts = { ...s.drafts };
          delete drafts[id];
          const files = { ...s.files };
          delete files[id];
          const bindValues = { ...s.bindValues };
          delete bindValues[id];
          let activeTabId = s.activeTabId;
          if (activeTabId === id) {
            activeTabId = tabs[Math.min(idx, tabs.length - 1)]?.id ?? null;
          }
          return { tabs, drafts, files, bindValues, activeTabId };
        });
      },

      setActiveTab(id) {
        set({ activeTabId: id });
      },

      setDraft(tabId, text) {
        set((s) => ({ drafts: { ...s.drafts, [tabId]: text } }));
      },

      // ---- fogli legati a un file .sql ----
      // `file`: { path, name, savedText }. Senza `file` il legame si scioglie
      // (il foglio torna a essere una bozza senza nome).
      setTabFile(tabId, file) {
        set((s) => {
          const files = { ...s.files };
          if (file) files[tabId] = file;
          else delete files[tabId];
          return { files };
        });
      },

      setBindValues(tabId, values) {
        set((s) => ({ bindValues: { ...s.bindValues, [tabId]: values } }));
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
        files: s.files,
        bindValues: s.bindValues,
        maxRows: s.maxRows,
        ui: s.ui,
        selectedConnId: s.selectedConnId,
        aiSessionId: s.aiSessionId,
        guideSection: s.guideSection,
      }),
      // Una versione salvata prima dell'introduzione dei pannelli non ha `ui`:
      // si completa con i valori di default invece di partire con campi vuoti.
      // Le schede di tipo sconosciuto (il diagramma, tolto dopo esserci stato)
      // vengono scartate: nessuno saprebbe più disegnarle.
      merge: (persisted, current) => {
        const tabs = (persisted?.tabs || []).filter((t) => KNOWN_TAB_KINDS.has(t.kind));
        return {
          ...current,
          ...persisted,
          tabs,
          activeTabId: tabs.some((t) => t.id === persisted?.activeTabId)
            ? persisted.activeTabId
            : (tabs.at(-1)?.id ?? null),
          ui: { ...current.ui, ...(persisted?.ui || {}) },
        };
      },
    }
  )
);
