import crypto from 'crypto';

// Algoritmo usato da Oracle SQL Developer per l'export delle connessioni con
// "Cifra tutte le password con una chiave" (disponibile dalla 18.x in poi):
// PBKDF2-HMAC-SHA256 (5000 iterazioni, salt fisso, 32 byte di chiave) per
// derivare la chiave AES dalla passphrase, poi AES-256-CBC con IV nei primi
// 16 byte del blob (il resto è il ciphertext, padding PKCS7). Salt e
// iterazioni sono hardcoded nel client SQL Developer stesso, non nel file
// esportato: verificati confrontando con tool di terze parti che decifrano
// correttamente gli export reali (non documentati da Oracle).
const SALT = Buffer.from([6, 182, 97, 35, 61, 104, 50, 184]);
const ITERATIONS = 5000;
const KEY_LEN = 32;

function decryptPassword(base64Payload, secret) {
  const raw = Buffer.from(base64Payload, 'base64');
  const iv = raw.subarray(0, 16);
  const data = raw.subarray(16);
  const key = crypto.pbkdf2Sync(secret, SALT, ITERATIONS, KEY_LEN, 'sha256');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function mapConnection(raw, idx) {
  const info = raw?.info || {};
  const name = raw?.name || info.ConnName || `Connessione ${idx + 1}`;
  const connType = info.OracleConnectionType || '';
  let serviceType = 'service';
  let host = '';
  let port = 1521;
  let service = '';
  const warnings = [];

  if (connType === 'BASIC') {
    host = info.hostname || '';
    port = Number(info.port) || 1521;
    if (info.serviceName) {
      serviceType = 'service';
      service = info.serviceName;
    } else if (info.sid) {
      serviceType = 'sid';
      service = info.sid;
    }
  } else if (connType === 'TNS') {
    serviceType = 'custom';
    service = info.customUrl || '';
    warnings.push(
      'Alias TNS: funziona solo se un tnsnames.ora con questa voce è raggiungibile da Orabridge'
    );
  } else {
    serviceType = 'custom';
    service = info.customUrl || '';
    if (connType) warnings.push(`Tipo di connessione "${connType}" non riconosciuto, importata come connect string libera`);
  }

  if (info.role?.trim()) {
    warnings.push(`Ruolo "${info.role}" non supportato: da riconfigurare manualmente`);
  }

  const hasPassword = typeof info.password === 'string' && info.password.length > 0;

  return {
    name,
    user: info.user || '',
    host,
    port,
    serviceType,
    service,
    hasPassword,
    warning: warnings.join(' — ') || null,
    _rawPassword: hasPassword ? info.password : null,
  };
}

// Analizza un export JSON di SQL Developer senza decifrare nulla: usato per
// l'anteprima, prima che l'utente inserisca la chiave di cifratura.
export function parseExport(content) {
  let data;
  try {
    data = JSON.parse(content);
  } catch {
    throw new Error('File JSON non valido');
  }
  if (!Array.isArray(data?.connections)) {
    throw new Error('Formato non riconosciuto: atteso un export di connessioni SQL Developer (chiave "connections")');
  }
  return data.connections.map(mapConnection);
}

// Decifra le password delle voci selezionate con la chiave fornita
// dall'utente. Ritorna la stessa lista con `password` valorizzata (stringa
// vuota se la connessione non ne aveva una) oppure `error` se la chiave non
// è quella giusta (o il blob è corrotto).
export function decryptWithKey(list, key) {
  return list.map((c) => {
    if (!c.hasPassword) return { ...c, password: '' };
    try {
      return { ...c, password: decryptPassword(c._rawPassword, key) };
    } catch {
      return { ...c, error: 'Chiave di cifratura errata (o file danneggiato)' };
    }
  });
}
