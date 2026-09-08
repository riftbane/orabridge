import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { findTnsAdmin, parseTnsNames, readTnsAliases } from '../src/tns.js';

const names = (text) => parseTnsNames(text).map((a) => a.name);

test('alias su più righe con parentesi annidate', () => {
  const file = `
ORCL =
  (DESCRIPTION =
    (ADDRESS = (PROTOCOL = TCP)(HOST = db.example.com)(PORT = 1521))
    (CONNECT_DATA =
      (SERVER = DEDICATED)
      (SERVICE_NAME = orcl.example.com)
    )
  )
`;
  assert.deepEqual(parseTnsNames(file), [
    {
      name: 'ORCL',
      descriptor:
        '(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=db.example.com)(PORT=1521))' +
        '(CONNECT_DATA=(SERVER=DEDICATED)(SERVICE_NAME=orcl.example.com)))',
    },
  ]);
});

test('più alias sulla stessa intestazione, separati da virgola', () => {
  const file = `
PROD, PROD.WORLD , PRODUZIONE =
  (DESCRIPTION = (ADDRESS = (PROTOCOL = TCP)(HOST = prod)(PORT = 1521))
                 (CONNECT_DATA = (SERVICE_NAME = prod)))
`;
  const aliases = parseTnsNames(file);
  assert.deepEqual(
    aliases.map((a) => a.name),
    ['PROD', 'PROD.WORLD', 'PRODUZIONE']
  );
  // Lo stesso descrittore per tutti: è una voce sola con tre nomi.
  assert.equal(new Set(aliases.map((a) => a.descriptor)).size, 1);
});

test('i commenti # non contano, nemmeno se contengono parentesi', () => {
  const file = `
# Vecchia voce, da buttare:
#   VECCHIA = (DESCRIPTION = (ADDRESS = (PROTOCOL = TCP)(HOST = old)))
DEV = (DESCRIPTION = (ADDRESS = (PROTOCOL = TCP)(HOST = dev)(PORT = 1521))  # host di sviluppo
       (CONNECT_DATA = (SID = DEV)))
`;
  assert.deepEqual(names(file), ['DEV']);
  assert.match(parseTnsNames(file)[0].descriptor, /\(CONNECT_DATA=\(SID=DEV\)\)\)$/);
});

test('maiuscole e minuscole: nomi normalizzati, vince la prima definizione', () => {
  const file = `
hr_dev = (DESCRIPTION = (ADDRESS = (PROTOCOL = TCP)(HOST = uno)(PORT = 1521))(CONNECT_DATA = (SERVICE_NAME = a)))
HR_DEV = (DESCRIPTION = (ADDRESS = (PROTOCOL = TCP)(HOST = due)(PORT = 1521))(CONNECT_DATA = (SERVICE_NAME = b)))
`;
  const aliases = parseTnsNames(file);
  assert.deepEqual(aliases.map((a) => a.name), ['HR_DEV']);
  assert.match(aliases[0].descriptor, /HOST=uno/);
});

test('descrittori con più indirizzi e DESCRIPTION_LIST', () => {
  const file = `
RAC =
 (DESCRIPTION_LIST =
   (LOAD_BALANCE = off)
   (DESCRIPTION =
     (ADDRESS_LIST = (LOAD_BALANCE = on)
       (ADDRESS = (PROTOCOL = TCP)(HOST = nodo1)(PORT = 1521))
       (ADDRESS = (PROTOCOL = TCP)(HOST = nodo2)(PORT = 1521)))
     (CONNECT_DATA = (SERVICE_NAME = rac)(FAILOVER_MODE = (TYPE = SELECT)(METHOD = BASIC)))))
`;
  const aliases = parseTnsNames(file);
  assert.deepEqual(aliases.map((a) => a.name), ['RAC']);
  assert.match(aliases[0].descriptor, /HOST=nodo1/);
  assert.match(aliases[0].descriptor, /HOST=nodo2/);
  assert.equal(aliases[0].descriptor.startsWith('(DESCRIPTION_LIST='), true);
});

test('le direttive senza descrittore (IFILE, NAMES.*) non diventano alias', () => {
  const file = `
NAMES.DEFAULT_DOMAIN = example.com
IFILE=/opt/oracle/network/admin/tnsnames_altro.ora
IFILE = C:\\oracle\\network\\admin\\extra.ora

TEST = (DESCRIPTION = (ADDRESS = (PROTOCOL = TCP)(HOST = test)(PORT = 1521))(CONNECT_DATA = (SERVICE_NAME = test)))
`;
  assert.deepEqual(names(file), ['TEST']);
});

test('file malformato: non lancia e salva il salvabile', () => {
  const troncato = `
BUONO = (DESCRIPTION = (ADDRESS = (PROTOCOL = TCP)(HOST = ok)(PORT = 1521))(CONNECT_DATA = (SERVICE_NAME = ok)))
MONCO = (DESCRIPTION = (ADDRESS = (PROTOCOL = TCP)(HOST = ko)(PORT = 1521)
`;
  const aliases = parseTnsNames(troncato);
  assert.deepEqual(aliases.map((a) => a.name), ['BUONO', 'MONCO']);
  // Del descrittore troncato si tiene ciò che c'è: meglio di niente in anteprima.
  assert.match(aliases[1].descriptor, /HOST=ko/);

  // Robaccia varia: l'importante è che non esploda.
  assert.deepEqual(parseTnsNames(')))(((= = =,,,'), []);
  assert.deepEqual(parseTnsNames(''), []);
  assert.deepEqual(parseTnsNames(null), []);
  assert.deepEqual(parseTnsNames('= (DESCRIPTION = (ADDRESS = (PROTOCOL = TCP)))'), []);
});

test('readTnsAliases legge la cartella, ordina e segnala i casi vuoti', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orabridge-tns-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const mancante = readTnsAliases(path.join(dir, 'inesistente'));
  assert.equal(mancante.aliases.length, 0);
  assert.match(mancante.error, /Cartella non trovata/);

  const senzaFile = readTnsAliases(dir);
  assert.match(senzaFile.error, /Nessun tnsnames\.ora/);

  fs.writeFileSync(
    path.join(dir, 'tnsnames.ora'),
    `ZETA = (DESCRIPTION = (ADDRESS = (PROTOCOL = TCP)(HOST = z)(PORT = 1521))(CONNECT_DATA = (SERVICE_NAME = z)))
ALFA = (DESCRIPTION = (ADDRESS = (PROTOCOL = TCP)(HOST = a)(PORT = 1521))(CONNECT_DATA = (SERVICE_NAME = a)))
`
  );
  const letto = readTnsAliases(dir);
  assert.equal(letto.error, undefined);
  assert.equal(letto.dir, dir);
  assert.equal(letto.file, path.join(dir, 'tnsnames.ora'));
  assert.deepEqual(letto.aliases.map((a) => a.name), ['ALFA', 'ZETA']);

  assert.match(readTnsAliases('').error, /TNS_ADMIN/);
});

test('findTnsAdmin: TNS_ADMIN prima, poi ORACLE_HOME, poi niente', (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'orabridge-home-'));
  const tnsAdmin = path.join(base, 'admin');
  const networkAdmin = path.join(base, 'home', 'network', 'admin');
  fs.mkdirSync(tnsAdmin);
  fs.mkdirSync(networkAdmin, { recursive: true });
  const { TNS_ADMIN, ORACLE_HOME } = process.env;
  t.after(() => {
    if (TNS_ADMIN === undefined) delete process.env.TNS_ADMIN;
    else process.env.TNS_ADMIN = TNS_ADMIN;
    if (ORACLE_HOME === undefined) delete process.env.ORACLE_HOME;
    else process.env.ORACLE_HOME = ORACLE_HOME;
    fs.rmSync(base, { recursive: true, force: true });
  });

  process.env.TNS_ADMIN = tnsAdmin;
  process.env.ORACLE_HOME = path.join(base, 'home');
  assert.equal(findTnsAdmin(), tnsAdmin);

  // TNS_ADMIN che punta a una cartella inesistente non deve vincere.
  process.env.TNS_ADMIN = path.join(base, 'niente');
  assert.equal(findTnsAdmin(), networkAdmin);

  delete process.env.TNS_ADMIN;
  delete process.env.ORACLE_HOME;
  assert.equal(findTnsAdmin(), '');
});
