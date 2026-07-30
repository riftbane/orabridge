import React from 'react';
import { GitCompare, History, Network, Sparkles } from 'lucide-react';
import { useStore } from '../store.js';
import { CUSTOM_TITLE_BAR } from '../appInfo.js';
import ConnectionsView from './ConnectionsView.jsx';
import ConnectionView from './ConnectionView.jsx';
import CodeSearchView from './CodeSearchView.jsx';

// Barra laterale a viste, come l'Explorer di VS Code: la barra delle attività
// (ActivityBar.jsx, fuori da qui perché resta visibile anche a pannello chiuso)
// sceglie quale delle tre si vede.
export default function Sidebar({ onNewConnection, onImportConnections }) {
  const view = useStore((s) => s.ui.sidebarView);
  const width = useStore((s) => s.ui.sidebarWidth);
  const toggleUi = useStore((s) => s.toggleUi);
  const openHistory = useStore((s) => s.openHistory);
  const openDiff = useStore((s) => s.openDiff);

  return (
    <aside className="sidebar" style={{ width, minWidth: width }}>
      {/* Nell'app desktop logo e comandi globali stanno nella barra del titolo
          (TitleBar.jsx): qui la testata sarebbe un doppione che ruba altezza
          alle viste. */}
      {!CUSTOM_TITLE_BAR && (
        <div className="sidebar-head">
          <span className="logo">
            <span className="logo-ora">Ora</span>bridge
          </span>
          <button
            className="icon-btn"
            title="Assistente AI (Ctrl+Alt+I)"
            onClick={() => toggleUi('ai')}
          >
            <Sparkles size={14} />
          </button>
          <button className="icon-btn" title="DB Diff — confronta due database" onClick={openDiff}>
            <GitCompare size={14} />
          </button>
          <button
            className="icon-btn"
            title="Diagramma — editor a nodi (beta)"
            onClick={() => useStore.getState().openGraph()}
          >
            <Network size={14} />
          </button>
          <button className="icon-btn" title="Cronologia query" onClick={() => openHistory(null)}>
            <History size={14} />
          </button>
        </div>
      )}
      {view === 'connection' ? (
        <ConnectionView />
      ) : view === 'search' ? (
        <CodeSearchView />
      ) : (
        <ConnectionsView
          onNewConnection={onNewConnection}
          onImportConnections={onImportConnections}
        />
      )}
    </aside>
  );
}
