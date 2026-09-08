import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
// Il foglio storico è già lungo: le parti nuove stanno in un file per area,
// caricato qui subito dopo (stessa cascata, stesse variabili di `:root`).
import './styles/grid.css';
import './styles/worksheet.css';
import './styles/dialogs.css';
import './styles/detail.css';
import './styles/tree.css';
import './styles/dba.css';
import './styles/connections.css';
import './styles/editor.css';

createRoot(document.getElementById('root')).render(<App />);
