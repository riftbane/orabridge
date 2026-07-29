// Disposizione dei diagrammi dell'editor a nodi.
//
// Sta su disco e non nel browser: sopravvive alla reinstallazione, si può
// esportare e passare a un collega, e non gonfia lo stato persistito di
// zustand (che tiene schede e bozze SQL). Un file per coppia
// connessione+schema, con lo stesso `readJson`/`writeJson` usato per le
// connessioni.
//
// Le chiavi dentro al file sono i *nomi* delle tabelle, non gli id del draft:
// quelli vivono solo dentro una sessione di editing.

import fs from 'fs';
import path from 'path';
import { DATA_DIR, readJson, writeJson } from './secret.js';

const DIR = path.join(DATA_DIR, 'diagrams');

// Il nome del file arriva da un id di connessione e da un nome di schema: si
// riduce a caratteri innocui, così non può risalire l'albero delle cartelle.
const safe = (s) => String(s ?? '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);

const fileFor = (connId, owner) => path.join(DIR, `${safe(connId)}__${safe(owner)}.json`);

const EMPTY = { version: 1, viewport: null, nodes: {}, notes: [], groups: [] };

export const diagrams = {
  read(connId, owner) {
    return { ...EMPTY, ...readJson(fileFor(connId, owner), EMPTY) };
  },

  write(connId, owner, layout) {
    fs.mkdirSync(DIR, { recursive: true });
    const value = {
      version: 1,
      viewport: layout?.viewport ?? null,
      nodes: layout?.nodes && typeof layout.nodes === 'object' ? layout.nodes : {},
      notes: Array.isArray(layout?.notes) ? layout.notes : [],
      groups: Array.isArray(layout?.groups) ? layout.groups : [],
    };
    writeJson(fileFor(connId, owner), value);
    return value;
  },
};
