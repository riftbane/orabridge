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

function sanitize(c) {
  const { password, ...rest } = c;
  return rest;
}

export const store = {
  list() {
    return load().map(sanitize);
  },

  get(id) {
    const c = load().find((x) => x.id === id);
    if (!c) return null;
    return { ...c, password: c.password ? decrypt(c.password) : '' };
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
      user: input.user || '',
      group: input.group || '',
      password: encrypt(input.password || ''),
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
    const cur = list[idx];
    const next = {
      ...cur,
      name: patch.name ?? cur.name,
      host: patch.host ?? cur.host,
      port: patch.port != null ? Number(patch.port) : cur.port,
      serviceType: patch.serviceType ?? cur.serviceType,
      service: patch.service ?? cur.service,
      user: patch.user ?? cur.user,
      group: patch.group ?? cur.group,
      password: patch.password ? encrypt(patch.password) : cur.password,
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
