import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Cartella dati e chiave AES condivise da tutto ciò che salva segreti su disco
// (password delle connessioni, chiavi API dei provider AI).
export const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const KEY_FILE = path.join(DATA_DIR, '.key');

let key;
if (fs.existsSync(KEY_FILE)) {
  key = Buffer.from(fs.readFileSync(KEY_FILE, 'utf8').trim(), 'hex');
} else {
  key = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, key.toString('hex'), { mode: 0o600 });
}

export function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return [iv.toString('hex'), cipher.getAuthTag().toString('hex'), enc.toString('hex')].join('.');
}

export function decrypt(payload) {
  const [iv, tag, data] = payload.split('.').map((p) => Buffer.from(p, 'hex'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

// Scrittura atomica di un JSON con permessi 600.
export function writeJson(file, value) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
