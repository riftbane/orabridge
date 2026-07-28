import React, { useEffect, useState } from 'react';
import { BookOpen, GitCompare, History, X } from 'lucide-react';
import { useStore } from './store.js';
import { CUSTOM_TITLE_BAR } from './appInfo.js';
import Sidebar from './components/Sidebar.jsx';
import TitleBar from './components/TitleBar.jsx';
import LayoutActions from './components/LayoutActions.jsx';
import ConnectionModal from './components/ConnectionModal.jsx';
import ImportConnectionsModal from './components/ImportConnectionsModal.jsx';
import Worksheet from './components/Worksheet.jsx';
import ObjectDetail from './components/ObjectDetail.jsx';
import HistoryPanel from './components/HistoryPanel.jsx';
import DbDiff from './components/DbDiff.jsx';
import AiPanel from './components/AiPanel.jsx';
import Resizer from './components/Resizer.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import GuideView from './components/GuideView.jsx';
import PasswordPrompt from './components/PasswordPrompt.jsx';
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
            ) : t.kind === 'diff' ? (
              <span className="type-icon" style={{ color: '#e8734a', borderColor: '#e8734a' }}>
                <GitCompare size={10} />
              </span>
            ) : t.kind === 'guide' ? (
              <span className="type-icon" style={{ color: '#6cb6ff', borderColor: '#6cb6ff' }}>
                <BookOpen size={10} />
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
          <button className="btn" onClick={() => useStore.getState().openDiff()}>
            <GitCompare size={13} /> Confronta due database
          </button>
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
        <div>
          <kbd>F1</kbd> guida
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const ui = useStore((s) => s.ui);
  const refreshConnections = useStore((s) => s.refreshConnections);
  const toast = useStore((s) => s.toast);
  const passwordPrompt = useStore((s) => s.passwordPrompt);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Cambia ad ogni chiusura delle impostazioni: il pannello AI se ne accorge e
  // rilegge chiavi, modelli e permessi invece di restare con i vecchi.
  const [settingsRev, setSettingsRev] = useState(0);
  // Nuova connessione e importazione si aprono sia dalla barra laterale sia
  // dalla barra del titolo: lo stato vive qui, sopra le due.
  const [creatingConn, setCreatingConn] = useState(false);
  const [importingConns, setImportingConns] = useState(false);

  useEffect(() => {
    refreshConnections().catch((err) => toast(`Server non raggiungibile: ${err.message}`, 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scorciatoie sui pannelli, nello spirito di VS Code.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'F1') {
        e.preventDefault();
        useStore.getState().openGuide();
        return;
      }
      if (!e.ctrlKey && !e.metaKey) return;
      const { toggleUi } = useStore.getState();
      if (e.key === 'b' && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        toggleUi('sidebar');
      } else if (e.key === 'j' && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        toggleUi('results');
      } else if (e.altKey && (e.key === 'i' || e.key === 'I')) {
        e.preventDefault();
        toggleUi('ai');
      } else if (e.key === ',') {
        e.preventDefault();
        setSettingsOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const setUi = useStore((s) => s.setUi);

  const openConnModal = () => setCreatingConn(true);
  const openImportModal = () => setImportingConns(true);
  const openSettings = () => setSettingsOpen(true);

  return (
    <div className={`app-shell ${CUSTOM_TITLE_BAR ? 'has-titlebar' : ''}`}>
      {CUSTOM_TITLE_BAR && (
        <TitleBar
          onOpenSettings={openSettings}
          onNewConnection={openConnModal}
          onImportConnections={openImportModal}
        />
      )}
      <div className="app">
        {ui.sidebar && (
          <>
            <Sidebar onNewConnection={openConnModal} onImportConnections={openImportModal} />
            <Resizer
              direction="left"
              value={ui.sidebarWidth}
              onChange={(v) => setUi({ sidebarWidth: v })}
              onReset={() => setUi({ sidebarWidth: 280 })}
              min={200}
              max={640}
            />
          </>
        )}
        <main className="main">
          {/* Nel desktop gli interruttori dei pannelli stanno nella barra del
              titolo: qui lo spazio resta tutto alle schede, e senza schede
              aperte la riga sparisce invece di restare vuota. */}
          {(!CUSTOM_TITLE_BAR || tabs.length > 0) && (
            <div className="tabbar-row">
              <TabBar />
              {!CUSTOM_TITLE_BAR && <LayoutActions onOpenSettings={openSettings} />}
            </div>
          )}
          <div className="tab-panels">
            {!tabs.length && <EmptyState />}
            {tabs.map((t) => (
              <div key={t.id} className="tab-panel" hidden={t.id !== activeTabId}>
                {t.kind === 'worksheet' ? (
                  <Worksheet tab={t} />
                ) : t.kind === 'history' ? (
                  <HistoryPanel />
                ) : t.kind === 'diff' ? (
                  <DbDiff tab={t} />
                ) : t.kind === 'guide' ? (
                  <GuideView />
                ) : (
                  <ObjectDetail tab={t} />
                )}
              </div>
            ))}
          </div>
        </main>
        {ui.ai && !ui.aiFull && (
          <Resizer
            direction="right"
            value={ui.aiWidth}
            onChange={(v) => setUi({ aiWidth: v })}
            onReset={() => setUi({ aiWidth: 400 })}
            min={280}
            max={900}
          />
        )}
        {/* Sempre montato: lo streaming della sessione prosegue anche a pannello
            chiuso, e riaprendolo si ritrova la conversazione già aggiornata. */}
        <AiPanel hidden={!ui.ai} onOpenSettings={openSettings} settingsRev={settingsRev} />
      </div>
      <Toasts />
      {/* La chiave sul connId riparte da zero cambiando connessione, ma tiene
          quanto digitato se il primo tentativo fallisce. */}
      {passwordPrompt && <PasswordPrompt key={passwordPrompt.connId} prompt={passwordPrompt} />}
      {settingsOpen && (
        <SettingsModal
          onClose={() => {
            setSettingsOpen(false);
            setSettingsRev((r) => r + 1);
          }}
        />
      )}
      {creatingConn && <ConnectionModal onClose={() => setCreatingConn(false)} />}
      {importingConns && <ImportConnectionsModal onClose={() => setImportingConns(false)} />}
    </div>
  );
}
