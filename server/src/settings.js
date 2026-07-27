import path from 'path';
import { DATA_DIR, decrypt, encrypt, readJson, writeJson } from './secret.js';

const FILE = path.join(DATA_DIR, 'settings.json');

export const PROVIDERS = ['openrouter', 'anthropic', 'google', 'openai'];

const DEFAULTS = {
  ai: {
    provider: 'anthropic',
    // Modello preferito per provider: cambiando piattaforma si ritrova la scelta.
    models: {},
    keys: {},
    // Base URL personalizzati (proxy aziendali, gateway): vuoto = endpoint ufficiale.
    baseUrls: {},
    permissions: { read: true, write: false, danger: false },
    // Righe massime restituite al modello da una SELECT.
    maxRows: 100,
  },
};

function load() {
  const raw = readJson(FILE, {});
  return {
    ai: {
      ...DEFAULTS.ai,
      ...(raw.ai || {}),
      models: { ...(raw.ai?.models || {}) },
      keys: { ...(raw.ai?.keys || {}) },
      baseUrls: { ...(raw.ai?.baseUrls || {}) },
      permissions: { ...DEFAULTS.ai.permissions, ...(raw.ai?.permissions || {}) },
    },
  };
}

export const settings = {
  // Vista pubblica: le chiavi non escono mai dal server, solo il fatto che ci siano.
  publicAi() {
    const { ai } = load();
    return {
      provider: ai.provider,
      models: ai.models,
      permissions: ai.permissions,
      maxRows: ai.maxRows,
      baseUrls: ai.baseUrls,
      providers: PROVIDERS.map((id) => ({ id, hasKey: !!ai.keys[id] })),
    };
  },

  // Chiave in chiaro: solo per uso interno al server (chiamate ai provider).
  apiKey(provider) {
    const enc = load().ai.keys[provider];
    if (!enc) return null;
    try {
      return decrypt(enc);
    } catch {
      return null;
    }
  },

  baseUrl(provider) {
    return load().ai.baseUrls[provider] || null;
  },

  ai() {
    return load().ai;
  },

  updateAi(patch) {
    const cur = load();
    const ai = { ...cur.ai };
    if (patch.provider && PROVIDERS.includes(patch.provider)) ai.provider = patch.provider;
    if (patch.models) ai.models = { ...ai.models, ...patch.models };
    if (patch.permissions) ai.permissions = { ...ai.permissions, ...patch.permissions };
    if (patch.maxRows != null) {
      ai.maxRows = Math.min(1000, Math.max(1, Number(patch.maxRows) || 100));
    }
    if (patch.baseUrls) {
      for (const [id, url] of Object.entries(patch.baseUrls)) {
        if (!PROVIDERS.includes(id)) continue;
        const v = String(url || '').trim().replace(/\/+$/, '');
        if (v) ai.baseUrls[id] = v;
        else delete ai.baseUrls[id];
      }
    }
    // `null` cancella la chiave, stringa vuota o assente la lascia com'è
    // (il client non la riceve mai indietro, quindi non può reinviarla).
    if (patch.keys) {
      for (const [id, value] of Object.entries(patch.keys)) {
        if (!PROVIDERS.includes(id)) continue;
        if (value === null) delete ai.keys[id];
        else if (typeof value === 'string' && value.trim()) ai.keys[id] = encrypt(value.trim());
      }
    }
    writeJson(FILE, { ...cur, ai });
    return this.publicAi();
  },
};
