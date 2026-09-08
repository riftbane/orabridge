// Apertura e salvataggio dei fogli come file .sql, con tre strade in ordine di
// preferenza: gli IPC del guscio Electron, la File System Access API del
// browser, e in ultimo un <input type=file> più un download. Modulo di
// servizio puro: niente React, niente store, nessuna dipendenza — chi lo usa
// riceve dati e decide lui cosa mostrare.
//
// L'annullamento dell'utente vale `null` in tutte e tre le strade e non è un
// errore. Un errore vero (file illeggibile, disco pieno, permesso negato dal
// browser) viene invece **lanciato** con un messaggio già in italiano: va
// avvolto in try/catch e mostrato con un toast.

const EXTENSIONS = ['sql', 'pks', 'pkb', 'plsql', 'txt'];
const ACCEPT = EXTENSIONS.map((e) => `.${e}`).join(',');
const FSA_TYPES = [{ description: 'Script SQL', accept: { 'text/plain': EXTENSIONS.map((e) => `.${e}`) } }];

// Nel browser non esistono percorsi: gli handle della File System Access API
// restano qui dentro e il resto dell'app ne vede solo la chiave, che tratta
// come se fosse un percorso. La mappa vive quanto la pagina — dopo un
// ricaricamento il salvataggio tornerà a chiedere dove scrivere, ed è
// inevitabile: un handle non è serializzabile.
const handles = new Map();
let handleSeq = 0;

const bridge = () => (typeof window !== 'undefined' ? window.orabridge : null);

const hasDesktopDialogs = () => typeof bridge()?.openSqlFile === 'function';

const hasFileSystemAccess = () =>
  typeof window !== 'undefined' &&
  typeof window.showOpenFilePicker === 'function' &&
  typeof window.showSaveFilePicker === 'function';

// Chiudere la finestra di sistema è una scelta dell'utente, non un guasto:
// tutte le API la segnalano con un'eccezione, che qui torna a essere `null`.
const isAbort = (err) => !!err && (err.name === 'AbortError' || err.code === 20);

const stripBom = (text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

function withSqlExtension(name) {
  const clean = String(name || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim();
  const base = clean || 'script';
  return /\.[^.\\/]+$/.test(base) ? base : `${base}.sql`;
}

// Le chiavi degli handle sono uniche per **questa** vita della pagina. Un
// contatore da solo non basta: `files` è persistito, quindi dopo un riavvio un
// vecchio `fsa:1` combacerebbe con il primo file aperto adesso e Ctrl+S
// scriverebbe nel file sbagliato senza chiedere niente.
const SESSION_KEY = Math.random().toString(36).slice(2, 10);

function rememberHandle(handle) {
  const key = `fsa:${SESSION_KEY}:${++handleSeq}`;
  handles.set(key, handle);
  return key;
}


// Il picker di apertura concede il solo permesso di lettura: per riscrivere
// lo stesso file senza ripassare da una finestra bisogna chiedere il permesso
// di scrittura, che il browser concede con un banner. Se l'utente dice di no
// il salvataggio è annullato, non fallito.
async function ensureWritable(handle) {
  if (typeof handle.queryPermission !== 'function') return true;
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return (await handle.requestPermission(opts)) === 'granted';
}

async function writeHandle(handle, text) {
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

// Ripiego per i browser senza File System Access API (Firefox, Safari): si
// legge un file scelto con un input nascosto e si «salva» riscaricandolo.
function openWithInput() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ACCEPT;
    input.hidden = true;
    document.body.appendChild(input);

    let picked = false;
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('focus', onFocus);
      input.remove();
      fn(value);
    };

    // L'evento 'cancel' esiste solo sui browser recenti; altrove il ritorno
    // del fuoco alla finestra senza alcun file scelto è l'unico indizio che
    // l'utente ha chiuso la finestra di sistema. Senza questa rete la
    // promessa resterebbe appesa per sempre.
    function onFocus() {
      setTimeout(() => {
        if (!picked) finish(resolve, null);
      }, 500);
    }
    window.addEventListener('focus', onFocus);

    input.addEventListener('cancel', () => finish(resolve, null));
    input.addEventListener('change', () => {
      picked = true;
      const file = input.files && input.files[0];
      if (!file) return finish(resolve, null);
      file
        .text()
        .then((text) => finish(resolve, { path: null, name: file.name, text: stripBom(text) }))
        .catch(() => finish(reject, new Error(`Impossibile leggere «${file.name}».`)));
    });

    input.click();
  });
}

function downloadText(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.hidden = true;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // La revoca immediata annullerebbe il download su alcuni browser: meglio
  // aspettare che sia partito.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Vero quando l'app può aprire una vera finestra di sistema e ricordarsi da
// quale file arriva il foglio. Con il ripiego è falso: lì ogni salvataggio è
// un nuovo download e la UI deve poterlo dire.
export function canUseNativeDialogs() {
  return hasDesktopDialogs() || hasFileSystemAccess();
}

export async function openSqlFile() {
  if (hasDesktopDialogs()) {
    const res = await bridge().openSqlFile();
    if (!res) return null;
    if (res.error) throw new Error(res.error);
    return { path: res.path, name: res.name, text: res.text };
  }

  if (hasFileSystemAccess()) {
    let handle;
    try {
      [handle] = await window.showOpenFilePicker({ multiple: false, types: FSA_TYPES });
    } catch (err) {
      if (isAbort(err)) return null;
      throw new Error(`Impossibile aprire il file: ${err.message || err}`);
    }
    try {
      const file = await handle.getFile();
      return { path: rememberHandle(handle), name: file.name, text: stripBom(await file.text()) };
    } catch (err) {
      throw new Error(`Impossibile leggere «${handle.name}»: ${err.message || err}`);
    }
  }

  return openWithInput();
}

export async function saveSqlFile({ path, name, text } = {}) {
  const content = String(text ?? '');
  const suggested = withSqlExtension(name);

  if (hasDesktopDialogs()) {
    const res = await bridge().saveSqlFile({ path: path || null, suggestedName: suggested, text: content });
    if (!res) return null;
    if (res.error) throw new Error(res.error);
    return { path: res.path, name: res.name };
  }

  if (hasFileSystemAccess()) {
    // Una chiave che non è nella mappa viene da una sessione precedente (il
    // foglio è persistito, gli handle no): si ricade sul «salva con nome»
    // invece di scrivere alla cieca.
    let handle = path ? handles.get(path) : null;
    let key = handle ? path : null;
    if (handle) {
      // L'handle c'è ma il permesso di scrittura può essere stato negato o
      // scaduto: in quel caso non insistiamo con una nuova finestra, perché
      // l'utente ha appena detto di no.
      if (!(await ensureWritable(handle))) return null;
    } else {
      try {
        handle = await window.showSaveFilePicker({ suggestedName: suggested, types: FSA_TYPES });
      } catch (err) {
        if (isAbort(err)) return null;
        throw new Error(`Impossibile salvare il file: ${err.message || err}`);
      }
      key = rememberHandle(handle);
    }
    try {
      await writeHandle(handle, content);
    } catch (err) {
      throw new Error(`Impossibile salvare «${handle.name}»: ${err.message || err}`);
    }
    return { path: key, name: handle.name };
  }

  // Senza handle non c'è modo di riscrivere lo stesso file: ogni salvataggio
  // è un download nuovo e il foglio resta senza percorso.
  downloadText(content, suggested);
  return { path: null, name: suggested };
}
