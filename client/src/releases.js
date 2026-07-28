// Elenco delle release pubblicate su GitHub, condiviso fra la guida e la
// scheda «Informazioni». Il server le legge da GitHub e le tiene in cache; qui
// basta non ripetere la richiesta a ogni apertura della finestra, quindi la
// promessa vive per tutta la sessione del browser.

import { useEffect, useState } from 'react';
import { api } from './api.js';

let promise = null;

export function loadReleases() {
  if (!promise) {
    promise = api
      .releases()
      .catch((err) => ({ releases: [], error: err.message || 'richiesta fallita' }));
  }
  return promise;
}

// `null` finché la risposta non è arrivata: chi la usa mostra intanto le
// novità impacchettate nel bundle, così non compare un buco.
export function useReleases() {
  const [feed, setFeed] = useState(null);
  useEffect(() => {
    let alive = true;
    loadReleases().then((f) => {
      if (alive) setFeed(f);
    });
    return () => {
      alive = false;
    };
  }, []);
  return feed;
}
