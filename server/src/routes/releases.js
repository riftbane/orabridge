// Novità delle versioni, lette dalle release pubblicate su GitHub — le stesse
// da cui electron-updater scarica gli aggiornamenti. Prima erano un elenco
// scritto a mano dentro il client, che restava indietro a ogni rilascio.
//
// Passa dal server e non direttamente dal browser per tre motivi: la risposta
// si mette in cache (GitHub concede 60 richieste all'ora per indirizzo IP e
// ogni apertura della guida ne sprecherebbe una), l'app desktop non dipende
// dalla CORS di api.github.com, e un'installazione senza internet fallisce in
// un punto solo, in modo prevedibile.

import express from 'express';

export const REPO = 'riftbane/orabridge';
export const RELEASES_URL = `https://github.com/${REPO}/releases`;
const API_URL = `https://api.github.com/repos/${REPO}/releases?per_page=10`;
const TTL_OK = 30 * 60_000;
// Senza rete si riprova presto, ma non a ogni apertura della guida.
const TTL_ERR = 2 * 60_000;
const TIMEOUT_MS = 8000;

let cache = null; // { at, ttl, body }

// Le note di una release sono la voce di CHANGELOG.md così com'è: qui dentro
// l'intestazione della versione e la riga «Build:» le mostriamo già altrove, e
// i trailer dei commit non interessano a chi legge la guida.
export function cleanNotes(body) {
  // GitHub restituisce le note con i fine riga di Windows: il renderer
  // Markdown del client lavora a righe, e un `\r` in coda gli resta appeso.
  return String(body || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter(
      (l) => !/^##\s+v\d/.test(l) && !/^\s*-\s*Build:/.test(l) && !/^\s*Co-Authored-By:/i.test(l)
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Riga sola per la scheda «Informazioni», dove c'è spazio per una frase.
export function summarize(notes, max = 180) {
  const first = notes.split('\n').find((l) => l.trim().startsWith('- '));
  const text = (first || notes.split('\n\n')[0] || '').replace(/^\s*-\s*/, '').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max).replace(/\s+\S*$/, '')}…`;
}

export function shape(list) {
  return (Array.isArray(list) ? list : [])
    .filter((r) => r && !r.draft)
    .map((r) => {
      const notes = cleanNotes(r.body);
      return {
        version: String(r.tag_name || '').replace(/^v/, ''),
        url: r.html_url || RELEASES_URL,
        publishedAt: r.published_at || null,
        prerelease: !!r.prerelease,
        notes,
        summary: summarize(notes),
      };
    })
    .filter((r) => r.version);
}

async function load() {
  const r = await fetch(API_URL, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Orabridge' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`GitHub ha risposto ${r.status}`);
  return shape(await r.json());
}

const router = express.Router();

router.get('/', async (req, res) => {
  if (cache && Date.now() - cache.at < cache.ttl) return res.json(cache.body);
  let body;
  try {
    body = { url: RELEASES_URL, releases: await load() };
    cache = { at: Date.now(), ttl: TTL_OK, body };
  } catch (err) {
    // Rete assente o GitHub irraggiungibile: non è un errore dell'applicazione
    // (il client ha comunque le novità impacchettate nel bundle), quindi si
    // risponde 200 con l'elenco vuoto e il motivo.
    body = { url: RELEASES_URL, releases: [], error: err.message || String(err) };
    cache = { at: Date.now(), ttl: TTL_ERR, body };
  }
  res.json(body);
});

export default router;
