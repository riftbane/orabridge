import path from 'path';
import crypto from 'crypto';
import { DATA_DIR, decrypt, encrypt, readJson, writeJson } from './secret.js';

const FILE = path.join(DATA_DIR, 'connections.json');

function load() {
  return readJson(FILE, []);
}

function save(list) {
  writeJson(FILE, list);
}

// `mcp` era la configurazione dell'integrazione con gli editor esterni: si
// scarta qui, così sparisce dalle risposte e — alla prima riscrittura — anche
// da connections.json di chi l'aveva usata.
function sanitize(c) {
  const { password, walletPassword, mcp, ...rest } = c;
  // `hasPassword` invece della password: la finestra deve poter dire che una
  // connessione ha la password salvata senza che la password esca dal server.
  // Vale anche per quella del wallet, che è un segreto come gli altri.
  return { ...rest, hasPassword: !!c.password, hasWalletPassword: !!c.walletPassword };
}

export const store = {
  list() {
    return load().map(sanitize);
  },

  get(id) {
    const c = load().find((x) => x.id === id);
    if (!c) return null;
    const { mcp, ...rest } = c;
    return {
      ...rest,
      password: c.password ? decrypt(c.password) : '',
      walletPassword: c.walletPassword ? decrypt(c.walletPassword) : '',
    };
  },

  create(input) {
    const list = load();
    const conn = {
      id: crypto.randomUUID(),
      name: input.name,
      host: input.host || '',
      port: Number(input.port) || 1521,
      serviceType: input.serviceType || 'service',
      service: input.service || '',
      // Alias di tnsnames.ora (`serviceType: 'tns'`) e cartella in cui
      // cercarlo: vuota significa «quella di sistema», risolta al momento
      // della connessione da findTnsAdmin().
      tnsAlias: input.tnsAlias || '',
      tnsAdmin: input.tnsAdmin || '',
      user: input.user || '',
      group: input.group || '',
      password: encrypt(input.password || ''),
      role: input.role || '',
      proxyUser: input.proxyUser || '',
      walletPath: input.walletPath || '',
      // A differenza della password della connessione, questa si cifra solo se
      // c'è: `encrypt('')` restituirebbe comunque un testo cifrato e
      // `hasWalletPassword` direbbe sempre di sì.
      walletPassword: input.walletPassword ? encrypt(input.walletPassword) : '',
      readOnly: !!input.readOnly,
      createdAt: new Date().toISOString(),
    };
    list.push(conn);
    save(list);
    return sanitize(conn);
  },

  update(id, patch) {
    const list = load();
    const idx = list.findIndex((x) => x.id === id);
    if (idx === -1) return null;
    const { mcp, ...cur } = list[idx];
    const next = {
      ...cur,
      name: patch.name ?? cur.name,
      host: patch.host ?? cur.host,
      port: patch.port != null ? Number(patch.port) : cur.port,
      serviceType: patch.serviceType ?? cur.serviceType,
      service: patch.service ?? cur.service,
      // Il `?? ''` finale serve alle connessioni salvate prima di questi
      // campi: senza, resterebbero `undefined` e sparirebbero dal JSON a ogni
      // riscrittura, ricomparendo come `undefined` in ogni lettura.
      tnsAlias: patch.tnsAlias ?? cur.tnsAlias ?? '',
      tnsAdmin: patch.tnsAdmin ?? cur.tnsAdmin ?? '',
      user: patch.user ?? cur.user,
      group: patch.group ?? cur.group,
      password: patch.password ? encrypt(patch.password) : cur.password,
      role: patch.role ?? cur.role ?? '',
      proxyUser: patch.proxyUser ?? cur.proxyUser ?? '',
      walletPath: patch.walletPath ?? cur.walletPath ?? '',
      // Un campo password vuoto vuol dire «invariata», come per la password
      // della connessione — ma togliendo la cartella del wallet la password
      // non ha più niente a cui riferirsi, e restando lì renderebbe la
      // connessione irreparabile (il controllo «password senza cartella» la
      // rifiuterebbe per sempre). Legarla alla cartella è l'unico modo di
      // poterla cancellare.
      walletPassword: patch.walletPath !== undefined && !String(patch.walletPath).trim()
        ? ''
        : patch.walletPassword
          ? encrypt(patch.walletPassword)
          : cur.walletPassword ?? '',
      // `??` e non `||`: con `||` una spunta tolta (`false`) verrebbe letta
      // come «campo assente» e la sola lettura non si potrebbe più disattivare.
      readOnly: !!(patch.readOnly ?? cur.readOnly),
    };
    list[idx] = next;
    save(list);
    return sanitize(next);
  },

  remove(id) {
    const list = load();
    const next = list.filter((x) => x.id !== id);
    save(next);
    return next.length !== list.length;
  },
};
