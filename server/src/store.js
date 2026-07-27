import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const FILE = path.join(DATA_DIR, 'connections.json');
const KEY_FILE = path.join(DATA_DIR, '.key');

let key;
if (fs.existsSync(KEY_FILE)) {
  key = Buffer.from(fs.readFileSync(KEY_FILE, 'utf8').trim(), 'hex');
} else {
  key = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, key.toString('hex'), { mode: 0o600 });
}

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return [iv.toString('hex'), cipher.getAuthTag().toString('hex'), enc.toString('hex')].join('.');
}

function decrypt(payload) {
  const [iv, tag, data] = payload.split('.').map((p) => Buffer.from(p, 'hex'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return [];
  }
}

function save(list) {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
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
