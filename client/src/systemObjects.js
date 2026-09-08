// Registro degli oggetti «di sistema» dell'albero: quelli che non stanno in
// ALL_OBJECTS con un tipo proprio (DB link, directory, job dello scheduler,
// code AQ, cestino) e quelli che non appartengono a uno schema (utenti, ruoli,
// tablespace, sinonimi pubblici, edition).
//
// È l'unica fonte di verità condivisa fra tre punti che devono restare
// allineati:
//   - `ObjectTree.jsx`  disegna una cartella per ogni voce (nel gruppo dello
//     schema o in quello del database, secondo `scope`);
//   - `ObjectDetail.jsx` disegna una linguetta per ogni voce di `sections` e
//     chiede `api.extraDetail({ type, owner, name, section })`;
//   - `server/src/routes/objects.js` implementa esattamente questi `type` e
//     queste `section` (la stringa viaggia tale e quale nella query).
//
// `scope`:
//   'schema'    la cartella compare sotto ogni schema, l'elenco è filtrato per owner
//   'database'  la cartella compare una sola volta, sotto «Database»
//
// `owned: false` dice che l'oggetto non ha uno schema proprietario: le schede
// e i menu non devono mostrare `OWNER.NOME` ma solo il nome.

export const SYSTEM_TYPES = [
  {
    type: 'DB_LINK',
    label: 'DB Link',
    folder: 'DB Link',
    icon: ['L', '#56b6c2'],
    scope: 'schema',
    owned: true,
    sections: ['Dettagli'],
  },
  {
    type: 'SCHEDULER_JOB',
    label: 'Job',
    folder: 'Job dello scheduler',
    icon: ['J', '#e5c07b'],
    scope: 'schema',
    owned: true,
    sections: ['Dettagli', 'Esecuzioni', 'Argomenti'],
  },
  {
    type: 'QUEUE',
    label: 'Coda',
    folder: 'Code AQ',
    icon: ['Q', '#c678dd'],
    scope: 'schema',
    owned: true,
    sections: ['Dettagli', 'Sottoscrittori', 'Tabella delle code'],
  },
  {
    type: 'RECYCLEBIN',
    label: 'Oggetto nel cestino',
    folder: 'Cestino',
    icon: ['R', '#8b90a0'],
    scope: 'schema',
    owned: true,
    sections: ['Dettagli'],
  },
  {
    type: 'DIRECTORY',
    label: 'Directory',
    folder: 'Directory',
    icon: ['D', '#d19a66'],
    scope: 'database',
    owned: false,
    sections: ['Dettagli', 'Permessi'],
  },
  {
    type: 'USER',
    label: 'Utente',
    folder: 'Utenti',
    icon: ['U', '#61afef'],
    scope: 'database',
    owned: false,
    sections: ['Dettagli', 'Ruoli', 'Privilegi di sistema', 'Privilegi su oggetti', 'Quote'],
  },
  {
    type: 'ROLE',
    label: 'Ruolo',
    folder: 'Ruoli',
    icon: ['O', '#98c379'],
    scope: 'database',
    owned: false,
    sections: ['Dettagli', 'Ruoli concessi', 'Privilegi di sistema', 'Privilegi su oggetti', 'Assegnato a'],
  },
  {
    type: 'TABLESPACE',
    label: 'Tablespace',
    folder: 'Tablespace',
    icon: ['W', '#4ec9b0'],
    scope: 'database',
    owned: false,
    sections: ['Dettagli', 'File', 'Utilizzo'],
  },
  {
    type: 'PUBLIC_SYNONYM',
    label: 'Sinonimo pubblico',
    folder: 'Sinonimi pubblici',
    icon: ['N', '#98c379'],
    scope: 'database',
    owned: false,
    sections: ['Dettagli'],
  },
  {
    type: 'EDITION',
    label: 'Edition',
    folder: 'Edition',
    icon: ['E', '#e06c75'],
    scope: 'database',
    owned: false,
    sections: ['Dettagli'],
  },
];

export const SYSTEM_BY_TYPE = Object.fromEntries(SYSTEM_TYPES.map((t) => [t.type, t]));

export const isSystemType = (type) => Object.hasOwn(SYSTEM_BY_TYPE, type);

export const systemTypesFor = (scope) => SYSTEM_TYPES.filter((t) => t.scope === scope);
