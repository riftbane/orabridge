import React from 'react';
import { BookOpen, PanelBottom, PanelLeft, PanelRight, Settings } from 'lucide-react';
import { useStore } from '../store.js';

// Interruttori dei pannelli, nello spirito di VS Code. Nel client web stanno in
// fondo alla barra delle schede; nell'app desktop salgono nella barra del
// titolo (TitleBar.jsx), dove non rubano spazio alle schede.
export default function LayoutActions({ onOpenSettings }) {
  const ui = useStore((s) => s.ui);
  const activeTab = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const toggleUi = useStore((s) => s.toggleUi);
  const openGuide = useStore((s) => s.openGuide);

  return (
    <div className="layout-actions">
      <button
        className={`icon-btn ${ui.sidebar ? 'on' : ''}`}
        title="Mostra/nascondi la barra laterale (Ctrl+B)"
        onClick={() => toggleUi('sidebar')}
      >
        <PanelLeft size={14} />
      </button>
      <button
        className={`icon-btn ${ui.results ? 'on' : ''}`}
        title="Mostra/nascondi il pannello dei risultati (Ctrl+J)"
        onClick={() => toggleUi('results')}
        disabled={activeTab?.kind !== 'worksheet'}
      >
        <PanelBottom size={14} />
      </button>
      <button
        className={`icon-btn ${ui.ai ? 'on' : ''}`}
        title="Mostra/nascondi l'assistente AI (Ctrl+Alt+I)"
        onClick={() => toggleUi('ai')}
      >
        <PanelRight size={14} />
      </button>
      <span className="layout-sep" />
      <button className="icon-btn" title="Guida dell'app (F1)" onClick={() => openGuide()}>
        <BookOpen size={14} />
      </button>
      <button className="icon-btn" title="Impostazioni (Ctrl+,)" onClick={onOpenSettings}>
        <Settings size={14} />
      </button>
    </div>
  );
}
