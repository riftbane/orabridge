// Modelli che girano sul computer dell'utente, senza API key e senza costi.
//
// Il runtime (llama.cpp) viaggia dentro l'installer di Orabridge, i pesi no:
// il più piccolo Gemma 4 utilizzabile pesa 3 GB, troppo per un installer (e
// oltre il limite di 2 GB per file delle release GitHub). Quindi il file .gguf
// si scarica una volta sola da qui, con barra di avanzamento e ripresa: per
// l'utente resta un clic dentro l'app, niente da installare a parte.

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../secret.js';

export const MODEL_DIR = path.join(DATA_DIR, 'models');

// Gemma 4 esiste in cinque taglie (E2B, E4B, 12B, 26B A4B, 31B): qui stanno
// solo le due che hanno senso su un portatile da ufficio senza scheda video.
// Le quantizzazioni sono quelle di Unsloth, non serve un account HuggingFace.
export const CATALOG = [
  {
    id: 'gemma-4-e2b-q4',
    label: 'Gemma 4 E2B (equilibrato)',
    file: 'gemma-4-E2B-it-Q4_K_M.gguf',
    url: 'https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_K_M.gguf',
    bytes: 3_106_738_272,
    minRamGb: 8,
    contextSize: 8192,
    note: 'La scelta consigliata: 2,3 miliardi di parametri effettivi, quantizzazione Q4_K_M. Serve circa 4 GB di RAM libera.',
  },
  {
    id: 'gemma-4-e2b-q3',
    label: 'Gemma 4 E2B (leggero)',
    file: 'gemma-4-E2B-it-UD-Q3_K_XL.gguf',
    url: 'https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-UD-Q3_K_XL.gguf',
    bytes: 2_923_782_240,
    minRamGb: 6,
    contextSize: 8192,
    note: 'Stesso modello quantizzato più stretto: occupa meno RAM ma sbaglia più spesso a scrivere SQL.',
  },
  {
    id: 'gemma-4-e4b-q4',
    label: 'Gemma 4 E4B (più bravo, più lento)',
    file: 'gemma-4-E4B-it-Q4_K_M.gguf',
    url: 'https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-Q4_K_M.gguf',
    bytes: 4_977_171_584,
    minRamGb: 16,
    contextSize: 8192,
    note: 'Il fratello maggiore: risposte migliori, ma su CPU va circa la metà. Consigliato solo con 16 GB di RAM.',
  },
];

export const catalogEntry = (id) => CATALOG.find((m) => m.id === id) || null;

const modelPath = (entry) => path.join(MODEL_DIR, entry.file);
const partPath = (entry) => `${modelPath(entry)}.part`;

export function installedPath(id) {
  const entry = catalogEntry(id);
  if (!entry) return null;
  const file = modelPath(entry);
  return fs.existsSync(file) ? file : null;
}

const sizeOf = (file) => {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
};

// ---- download ----

// id -> { received, total, controller, promise }
const downloads = new Map();
// L'errore sopravvive alla fine del download, così la UI può ancora mostrarlo
// quando la voce è già stata tolta da `downloads`.
const lastError = new Map();
const watchers = new Set();

export function onProgress(fn) {
  watchers.add(fn);
  return () => watchers.delete(fn);
}

function announce(id) {
  const snapshot = statusOf(id);
  for (const fn of watchers) {
    try {
      fn(snapshot);
    } catch {
      /* un ascoltatore rotto non deve fermare il download */
    }
  }
}

export function statusOf(id) {
  const entry = catalogEntry(id);
  if (!entry) return null;
  const active = downloads.get(id);
  const file = modelPath(entry);
  const installed = fs.existsSync(file);
  return {
    id,
    label: entry.label,
    note: entry.note,
    bytes: entry.bytes,
    minRamGb: entry.minRamGb,
    installed,
    installedBytes: installed ? sizeOf(file) : 0,
    // Un download interrotto lascia un .part: la ripresa riparte da lì.
    partialBytes: active ? active.received : sizeOf(partPath(entry)),
    downloading: !!active,
    error: lastError.get(id) || null,
  };
}

export const status = () => CATALOG.map((m) => statusOf(m.id));

export function download(id) {
  const entry = catalogEntry(id);
  if (!entry) throw new Error('Modello sconosciuto');
  const running = downloads.get(id);
  if (running) return running.promise;
  if (installedPath(id)) return Promise.resolve();

  const controller = new AbortController();
  const state = { received: 0, total: entry.bytes, controller };
  lastError.delete(id);
  const promise = fetchModel(entry, state)
    .then(() => {
      downloads.delete(id);
      announce(id);
    })
    .catch((err) => {
      downloads.delete(id);
      // L'annullamento volontario non è un errore da mostrare in rosso.
      const aborted = err?.name === 'AbortError';
      if (!aborted) lastError.set(id, err.message);
      announce(id);
      if (!aborted) throw err;
    });
  // La promise viene comunque osservata dalla rotta; qui si evita solo che un
  // fallimento diventi un unhandled rejection quando nessuno la aspetta.
  promise.catch(() => {});
  state.promise = promise;
  downloads.set(id, state);
  announce(id);
  return promise;
}

export function cancel(id) {
  const active = downloads.get(id);
  if (!active) return false;
  active.controller.abort();
  return true;
}

export async function remove(id) {
  const entry = catalogEntry(id);
  if (!entry) return false;
  // L'interruzione non è immediata: il flusso in corso potrebbe riscrivere il
  // `.part` subito dopo la cancellazione, lasciando in giro qualche gigabyte.
  // Si aspetta che il download si sia davvero fermato.
  const active = downloads.get(id);
  if (active) {
    cancel(id);
    await active.promise.catch(() => {});
  }
  let removed = false;
  for (const file of [modelPath(entry), partPath(entry)]) {
    if (!fs.existsSync(file)) continue;
    fs.rmSync(file, { force: true });
    removed = true;
  }
  announce(id);
  return removed;
}

async function fetchModel(entry, state) {
  fs.mkdirSync(MODEL_DIR, { recursive: true });
  const target = modelPath(entry);
  const part = partPath(entry);

  // Tre gigabyte su una rete d'ufficio si interrompono: si riprende da dove si
  // era arrivati invece di ricominciare da capo.
  const already = sizeOf(part);
  const headers = already > 0 ? { range: `bytes=${already}-` } : {};
  const res = await fetch(entry.url, { headers, signal: state.controller.signal });
  if (!res.ok && res.status !== 206) {
    throw new Error(`Download fallito: HTTP ${res.status}`);
  }
  // Il server ha ignorato il Range (206 atteso, 200 ricevuto): si riscrive tutto.
  const resuming = already > 0 && res.status === 206;
  if (!resuming && already > 0) fs.rmSync(part, { force: true });

  const declared = Number(res.headers.get('content-length')) || 0;
  state.received = resuming ? already : 0;
  state.total = declared ? state.received + declared : entry.bytes;

  const out = fs.createWriteStream(part, { flags: resuming ? 'a' : 'w' });
  let lastTick = 0;
  try {
    for await (const chunk of res.body) {
      if (!out.write(Buffer.from(chunk))) {
        await new Promise((resolve) => out.once('drain', resolve));
      }
      state.received += chunk.length;
      // Un evento per byte inonderebbe la SSE: basta un aggiornamento ogni 250 ms.
      const now = Date.now();
      if (now - lastTick > 250) {
        lastTick = now;
        announce(entry.id);
      }
    }
  } finally {
    await new Promise((resolve) => out.end(resolve));
  }

  const got = sizeOf(part);
  // Una connessione caduta a metà lascia un file troncato che llama.cpp
  // rifiuterebbe con un errore incomprensibile: meglio accorgersene qui.
  if (state.total && got < state.total) {
    throw new Error(
      `Download incompleto (${(got / 1e9).toFixed(2)} GB su ${(state.total / 1e9).toFixed(2)} GB): riprova, riprenderà da dove si era fermato.`
    );
  }
  fs.renameSync(part, target);
  lastError.delete(entry.id);
}
