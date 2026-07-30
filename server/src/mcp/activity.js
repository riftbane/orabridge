// Cosa sta facendo l'integrazione MCP, mentre lo fa.
//
// Copilot lavora in una finestra che non è questa: senza un filo diretto,
// l'unico modo di sapere che ha letto un database sarebbe accorgersene dopo,
// dalla cronologia. Qui ogni chiamata lascia una voce — quale connessione,
// quale strumento, quanto ci ha messo, com'è finita — e chi ascolta la riceve
// nell'istante in cui succede (vedi routes/mcp.js, GET /api/mcp/events).
//
// Tutto in memoria e volutamente piccolo: è un pannello di controllo, non un
// registro di audit (quello è `history`, che le query le salva già).

const MAX = 60;

const entries = [];
const listeners = new Set();
let seq = 0;

function emit(entry) {
  for (const fn of listeners) {
    try {
      fn(entry);
    } catch {
      /* un ascoltatore rotto non deve fermare gli altri */
    }
  }
}

// Una voce nuova. Le voci di una chiamata in corso vengono aggiornate sul posto
// (stesso `id`): chi ascolta le sostituisce invece di accodarle, così una
// chiamata resta una riga sola dall'inizio alla fine.
function push(fields) {
  const entry = { id: ++seq, at: Date.now(), running: false, ...fields };
  entries.push(entry);
  if (entries.length > MAX) entries.shift();
  emit(entry);
  return entry;
}

export const activity = {
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  recent() {
    return entries;
  },

  // Fatto istantaneo: un collegamento aperto da MCP, un rifiuto, un errore.
  note(fields) {
    return push(fields);
  },

  // Chiamata a uno strumento: si annuncia l'inizio, così la UI può dire «sta
  // leggendo» e non solo «ha letto», e si chiude con l'esito.
  startCall(fields) {
    const entry = push({ kind: 'call', running: true, ...fields });
    const t0 = Date.now();
    return {
      // La connessione si conosce dopo (il modello passa un nome, o niente).
      update(patch) {
        Object.assign(entry, patch);
        emit(entry);
      },
      done(outcome) {
        Object.assign(entry, { running: false, ms: Date.now() - t0 }, outcome);
        emit(entry);
      },
    };
  },

  // Solo per i test: riparte da zero senza toccare gli ascoltatori.
  reset() {
    entries.length = 0;
  },
};
