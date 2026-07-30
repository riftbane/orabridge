// File di scoperta per il ponte stdio (electron/mcp-bridge.cjs).
//
// L'app desktop ascolta su una porta effimera e genera un token nuovo a ogni
// avvio: nessuno dei due può stare scritto in un `mcp.json`. Qui li mettiamo su
// disco, dove il ponte li rilegge a ogni richiesta — così il token non finisce
// mai in un file di configurazione dell'editor e continua a cambiare ad ogni
// riavvio dell'app.
//
// Il file esiste solo quando l'integrazione è accesa: spegnerla lo cancella.

import fs from 'fs';
import path from 'path';
import { DATA_DIR, writeJson } from '../secret.js';
import { settings } from '../settings.js';

export const ENDPOINT_FILE = path.join(DATA_DIR, 'mcp-endpoint.json');

let current = null; // { port, token } del server in ascolto

// Chiamata dal server appena conosce la sua porta.
export function configure(info) {
  current = info;
  sync();
}

// Allinea il file allo stato attuale (server in ascolto + interruttore).
// Va richiamata quando l'impostazione cambia, così non serve riavviare l'app.
export function sync() {
  if (!current || !settings.mcp().enabled) return remove();
  try {
    // `writeJson` scrive con mode 600. Su Windows non ha effetto (contano le
    // ACL di %APPDATA%, che è già per-utente): chi può leggere questo file può
    // interrogare i database collegati, ed è il motivo per cui l'integrazione
    // è spenta finché non la si accende a mano.
    writeJson(ENDPOINT_FILE, {
      port: current.port,
      token: current.token || '',
      pid: process.pid,
      startedAt: new Date().toISOString(),
    });
    return true;
  } catch {
    return false;
  }
}

export function remove() {
  try {
    fs.rmSync(ENDPOINT_FILE, { force: true });
  } catch {
    /* niente da cancellare */
  }
  return false;
}

export const isPublished = () => !!current && fs.existsSync(ENDPOINT_FILE);
