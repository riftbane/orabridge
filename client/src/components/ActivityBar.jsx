import React from 'react';
import { Database, FolderTree, Search } from 'lucide-react';
import { useStore } from '../store.js';

// Striscia di icone all'estrema sinistra, come la barra delle attività di
// VS Code: sceglie quale vista mostra la barra laterale e resta visibile anche
// a barra chiusa (ricliccare l'icona attiva chiude e riapre il pannello).
const VIEWS = [
  { id: 'connections', label: 'Connessioni', hint: 'Ctrl+Maiusc+D', Icon: Database },
  { id: 'connection', label: 'Connessione', hint: 'Ctrl+Maiusc+E', Icon: FolderTree },
  { id: 'search', label: 'Ricerca nel codice', hint: 'Ctrl+Maiusc+F', Icon: Search },
];

export default function ActivityBar() {
  const view = useStore((s) => s.ui.sidebarView);
  const open = useStore((s) => s.ui.sidebar);
  const showSidebarView = useStore((s) => s.showSidebarView);
  // Quante connessioni sono aperte: il pallino sull'icona lo dice anche con la
  // barra laterale chiusa.
  const connected = useStore(
    (s) => Object.values(s.active).filter((x) => x?.status === 'connected').length
  );

  return (
    <nav className="activity-bar">
      {VIEWS.map(({ id, label, hint, Icon }) => (
        <button
          key={id}
          className={`activity-btn ${view === id && open ? 'on' : ''}`}
          title={`${label} (${hint})`}
          aria-label={label}
          aria-pressed={view === id && open}
          onClick={() => showSidebarView(id)}
        >
          <Icon size={19} />
          {id === 'connections' && !!connected && (
            <span className="activity-badge">{connected}</span>
          )}
        </button>
      ))}
    </nav>
  );
}
