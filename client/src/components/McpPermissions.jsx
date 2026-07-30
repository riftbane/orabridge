import React from 'react';

// Cosa può fare un editor esterno su una connessione.
//
// Impostabile ce n'è uno solo: la lettura. Modifica ed eliminazione compaiono
// comunque, spente e non toccabili, perché la domanda «cosa può fare Copilot su
// questo database» deve avere una risposta intera — un elenco con la sola voce
// «Lettura» lascerebbe il dubbio che le altre esistano da qualche altra parte.
// Non sono un'opzione che abbiamo deciso di non offrire: gli strumenti che
// servirebbero non escono proprio dall'integrazione (l'elenco è filtrato sul
// permesso `read`, vedi server/src/mcp/tools.js).
export const MCP_PERMISSIONS = [
  {
    key: 'read',
    label: 'Lettura',
    hint: 'Struttura, DDL, sorgenti PL/SQL e risultato delle SELECT.',
    available: true,
  },
  {
    key: 'write',
    label: 'Modifica',
    hint: 'Non disponibile: dagli editor esterni non esce nessuno strumento che scriva.',
    available: false,
  },
  {
    key: 'delete',
    label: 'Eliminazione',
    hint: 'Non disponibile: nessuno strumento distruttivo viene esposto.',
    available: false,
  },
];

export default function McpPermissions({ permissions, onChange, disabled }) {
  return (
    <div className="mcp-perms">
      {MCP_PERMISSIONS.map((p) => (
        <label
          key={p.key}
          className={`mcp-perm ${p.available ? '' : 'unavailable'}`}
          title={p.available ? p.hint : `${p.hint}`}
        >
          <input
            type="checkbox"
            checked={p.available ? !!permissions?.[p.key] : false}
            disabled={disabled || !p.available}
            onChange={(e) => p.available && onChange({ ...permissions, [p.key]: e.target.checked })}
          />
          <span>
            <strong>{p.label}</strong>
            <em>{p.hint}</em>
          </span>
          {!p.available && <span className="mcp-perm-tag">non disponibile</span>}
        </label>
      ))}
    </div>
  );
}
