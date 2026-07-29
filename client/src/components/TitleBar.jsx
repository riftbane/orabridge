import { GitCompare, History, Network, Plus, Upload } from 'lucide-react';
import { useStore } from '../store.js';
import LayoutActions from './LayoutActions.jsx';

// Barra del titolo dell'app desktop: prende il posto di quella di sistema
// (main.cjs la nasconde con `titleBarStyle: 'hidden'`) e ne recupera lo spazio,
// che altrimenti resterebbe una striscia vuota. Windows continua a disegnare da
// solo minimizza/ingrandisci/chiudi in alto a destra, negli stessi colori:
// l'area che ci lascia libera arriva dalle variabili `env(titlebar-area-*)`,
// usate nel CSS. Tutto ciò che non è un pulsante trascina la finestra.
export default function TitleBar({ onOpenSettings, onNewConnection, onImportConnections }) {
  const openHistory = useStore((s) => s.openHistory);
  const openDiff = useStore((s) => s.openDiff);

  return (
    <header className="titlebar">
      <span className="titlebar-brand">
        <svg className="titlebar-mark" viewBox="0 0 32 32" width="15" height="15" aria-hidden="true">
          <path d="M4 22c4-8 20-8 24 0" stroke="currentColor" strokeWidth="3" fill="none" />
          <path d="M4 22h24" stroke="currentColor" strokeWidth="2" />
        </svg>
        {/* Il nome sta in un solo elemento: il `gap` del flex lo spezzerebbe
            in «Ora bridge». */}
        <span>
          <span className="logo-ora">Ora</span>bridge
        </span>
      </span>
      <div className="titlebar-group">
        <button className="icon-btn" title="Nuova connessione" onClick={onNewConnection}>
          <Plus size={15} />
        </button>
        <button className="icon-btn" title="Importa connessioni" onClick={onImportConnections}>
          <Upload size={14} />
        </button>
        <button className="icon-btn" title="Cronologia query" onClick={() => openHistory(null)}>
          <History size={14} />
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
      </div>
      {/* Zona di trascinamento: è quello che resta della barra del titolo. */}
      <div className="titlebar-drag" />
      <LayoutActions onOpenSettings={onOpenSettings} />
    </header>
  );
}
