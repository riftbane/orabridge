import React, { useEffect } from 'react';
import { History, X } from 'lucide-react';
import { useStore } from './store.js';
import Sidebar from './components/Sidebar.jsx';
import Worksheet from './components/Worksheet.jsx';
import ObjectDetail from './components/ObjectDetail.jsx';
import HistoryPanel from './components/HistoryPanel.jsx';
import { TypeIcon } from './components/ObjectTree.jsx';

function TabBar() {
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const { setActiveTab, closeTab } = useStore.getState();

  return (
    <div className="tabbar">
      {tabs.map((t) => {
        return (
          <div
            key={t.id}
            className={`tab ${t.id === activeTabId ? 'on' : ''}`}
            onClick={() => setActiveTab(t.id)}
            onAuxClick={(e) => e.button === 1 && closeTab(t.id)}
            title={t.kind === 'object' ? `${t.owner}.${t.name} (${t.type})` : t.title}
          >
            {t.kind === 'worksheet' ? (
              <span className="tab-dot" />
            ) : t.kind === 'history' ? (
              <span className="type-icon" style={{ color: '#888', borderColor: '#888' }}>
                <History size={10} />
              </span>
            ) : (
              <TypeIcon type={t.type} />
            )}
            <span className="tab-title">{t.title}</span>
            <button
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(t.id);
              }}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.type}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  const conns = useStore((s) => s.conns);
  const active = useStore((s) => s.active);
  const openWorksheet = useStore((s) => s.openWorksheet);
  const connectedIds = conns.filter((c) => active[c.id]?.status === 'connected');

  return (
    <div className="empty-state">
      <div className="empty-logo">
        <span className="logo-ora">Ora</span>bridge
      </div>
      <p>SQL veloce per Oracle, senza zavorra.</p>
      {connectedIds.length > 0 ? (
        <div className="empty-actions">
          {connectedIds.map((c) => (
            <button key={c.id} className="btn primary" onClick={() => openWorksheet(c.id)}>
              Nuovo foglio SQL — {c.name}
            </button>
          ))}
        </div>
      ) : (
        <p className="hint">Connettiti a un database dalla barra laterale per iniziare.</p>
      )}
      <div className="shortcuts">
        <div>
          <kbd>Ctrl</kbd>+<kbd>Invio</kbd> / <kbd>F9</kbd> esegui istruzione
        </div>
        <div>
          <kbd>F5</kbd> esegui script
        </div>
        <div>
          <kbd>Ctrl</kbd>+<kbd>Spazio</kbd> autocomplete
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const refreshConnections = useStore((s) => s.refreshConnections);
  const toast = useStore((s) => s.toast);

  useEffect(() => {
    refreshConnections().catch((err) => toast(`Server non raggiungibile: ${err.message}`, 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <TabBar />
        <div className="tab-panels">
          {!tabs.length && <EmptyState />}
          {tabs.map((t) => (
            <div key={t.id} className="tab-panel" hidden={t.id !== activeTabId}>
              {t.kind === 'worksheet' ? (
                <Worksheet tab={t} />
              ) : t.kind === 'history' ? (
                <HistoryPanel />
              ) : (
                <ObjectDetail tab={t} />
              )}
            </div>
          ))}
        </div>
      </main>
      <Toasts />
    </div>
  );
}
