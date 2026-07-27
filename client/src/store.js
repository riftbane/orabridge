import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from './api.js';

let wsCounter = 1;
let toastId = 1;

export const useStore = create(
  persist(
    (set, get) => ({
      conns: [],
      active: {}, // connId -> { status, user, currentSchema, version, txnOpen }
      autocomplete: {}, // connId -> { TABLE: [cols] }
      tabs: [],
      activeTabId: null,
      drafts: {}, // tabId -> sql text
      toasts: [],
      maxRows: 500,

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

      async connect(id) {
        const { toast } = get();
        set((s) => ({ active: { ...s.active, [id]: { status: 'connecting' } } }));
        try {
          const info = await api.connect(id);
          set((s) => ({
            active: { ...s.active, [id]: { status: 'connected', ...info } },
            conns: s.conns.map((c) => (c.id === id ? { ...c, connected: true } : c)),
          }));
          toast(`Connesso a ${get().conns.find((c) => c.id === id)?.name}`, 'ok');
          get().loadAutocomplete(id);
        } catch (err) {
          set((s) => ({ active: { ...s.active, [id]: { status: 'error', error: err.message } } }));
          toast(`Connessione fallita: ${err.message}`, 'error');
        }
      },

      async disconnect(id) {
        await api.disconnect(id).catch(() => {});
        set((s) => {
          const active = { ...s.active };
          delete active[id];
          return {
            active,
            conns: s.conns.map((c) => (c.id === id ? { ...c, connected: false } : c)),
          };
        });
      },

      async loadAutocomplete(id) {
        try {
          const owner = get().active[id]?.currentSchema;
          if (!owner) return;
          const data = await api.autocomplete(id, owner);
          set((s) => ({ autocomplete: { ...s.autocomplete, [id]: data.tables } }));
        } catch {
          /* non-fatal */
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
          return {
            active,
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

      openObject(connId, owner, name, type) {
        const id = `obj-${connId}-${owner}.${name}-${type}`;
        const exists = get().tabs.find((t) => t.id === id);
        if (exists) {
          set({ activeTabId: id });
          return;
        }
        const tab = { id, kind: 'object', connId, owner, name, type, title: name };
        set((s) => ({ tabs: [...s.tabs, tab], activeTabId: id }));
      },

      closeTab(id) {
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
        tabs: s.tabs,
        activeTabId: s.activeTabId,
        drafts: s.drafts,
        maxRows: s.maxRows,
      }),
    }
  )
);
