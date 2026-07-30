// Tipi di oggetto che la ricerca globale sa esaminare: sono i tipi di
// ALL_SOURCE, cioè tutto ciò che ha un sorgente PL/SQL nel database. L'elenco
// deve restare allineato a SEARCH_TYPES in server/src/routes/search.js.
export const SEARCH_TYPES = [
  ['PROCEDURE', 'Procedure'],
  ['FUNCTION', 'Funzioni'],
  ['TRIGGER', 'Trigger'],
  ['PACKAGE BODY', 'Package body'],
  ['PACKAGE', 'Package (spec)'],
  ['TYPE', 'Tipi (spec)'],
  ['TYPE BODY', 'Type body'],
];

// Il codice eseguibile: è quello che si cerca quasi sempre. Le specifiche sono
// spente di default, altrimenti ogni dichiarazione compare due volte.
export const DEFAULT_SEARCH_TYPES = ['PROCEDURE', 'FUNCTION', 'TRIGGER', 'PACKAGE BODY'];
