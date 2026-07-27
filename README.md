# Orabridge

SQL veloce per Oracle, senza zavorra. Una piattaforma web leggera e dockerizzata per lavorare
con database Oracle: pensata per developer che non vogliono la pesantezza di SQL Developer.

- **Connessioni multiple simultanee**, salvate su disco (password cifrate AES-256-GCM)
- **Editor SQL** (CodeMirror 6) con autocomplete consapevole del contesto — i suggerimenti
  sono raggruppati in sezioni e ordinati in base alla clausola in cui si trova il cursore:
  - colonne delle tabelle citate nell'istruzione con il loro tipo, alias inclusi
    (`c.` suggerisce le colonne di `clienti c`), più CTE (`WITH`) e subquery
  - tabelle, viste, sinonimi, sequenze (`.NEXTVAL`), package e procedure dello schema;
    gli **altri schemi** vengono caricati al volo scrivendo `ALTRO_SCHEMA.`
  - **condizioni di join dalle foreign key**: dopo `JOIN` propone la tabella collegata
    già completa di alias e `ON`, dentro `ON` la sola condizione
  - espansione di `*` e `alias.*` nell'elenco delle colonne
  - funzioni built-in di Oracle (con firma) e parole chiave del dialetto PL/SQL
  - i nomi seguono lo stile di chi scrive: se digiti in minuscolo li inserisce in minuscolo
- **Browser oggetti** stile SQL Developer: tabelle, viste, viste materializzate, indici,
  sequenze, procedure, funzioni, package, trigger, tipi, sinonimi + altri schemi
- **Creazione guidata** (pulsante «＋» sulle cartelle dell'albero): designer tabella con
  griglia colonne/PK/commenti, sequenze, viste, indici, sinonimi, scheletri di
  procedure/funzioni/package/trigger/tipi — sempre con anteprima dello SQL generato
- **Modifica guidata**: aggiungi/modifica/elimina colonne, vincoli (PK/UNIQUE/FK/CHECK)
  e indici di una tabella, rinomina tabella, alter sequence, edit vista
- **Sorgente PL/SQL modificabile**: scheda «Sorgente» con «Compila» (`Ctrl+Invio`) ed
  elenco errori di compilazione cliccabili (da `ALL_ERRORS`)
- **Drop guidato** dal menu contestuale (clic destro su un oggetto nell'albero)
- **DB Diff** (icona ⇄ in alto nella barra laterale): confronta due schemi — su
  connessioni diverse o sulla stessa — e genera lo script di allineamento
  - confronta tabelle (colonne, vincoli, indici, commenti), viste, viste
    materializzate, sequenze, sinonimi, procedure, funzioni, package, trigger e tipi
  - per ogni oggetto dice se è **solo in origine**, **solo in destinazione** o
    **diverso**; le differenze strutturali si leggono in tabella, quelle di
    codice in un **confronto affiancato riga per riga**
  - i vincoli e gli indici con nome generato (`SYS_C…`) si accoppiano per
    definizione invece che per nome, e i riferimenti allo schema di origine
    valgono come quelli allo schema di destinazione: niente differenze finte
  - lo **script di sincronizzazione** (CREATE/ALTER, con i DROP opzionali) si
    genera per gli oggetti spuntati e si apre in un foglio SQL sulla
    destinazione — Orabridge non esegue mai nulla da sé
- Dettaglio tabella: colonne, dati (con filtro WHERE e paginazione), vincoli, indici, trigger, DDL
- Sorgente e DDL di procedure/funzioni/package (via `DBMS_METADATA`)
- Esecuzione istruzione al cursore (`Ctrl+Invio` / `F9`), script completo (`F5`),
  explain plan, commit/rollback espliciti con indicatore di transazione aperta, annulla query
- DBMS Output, export CSV, griglia risultati virtualizzata (regge decine di migliaia di righe)
- Solo **localhost**: la porta è pubblicata su `127.0.0.1`, nessun accesso dalla rete
- **Installabile come PWA**: dal browser (Chrome/Edge «Installa app», Safari «Aggiungi
  a Home») apre in una finestra propria, senza barra degli indirizzi

L'immagine Docker include **Oracle Instant Client 19c** (modalità thick del driver):
compatibile con server Oracle dalla **11.2** in su e con utenze che hanno vecchi
password verifier 10G. Senza Docker il driver parte in modalità **thin** (nessun
client richiesto, ma serve server 12.1+ e verifier 11G/12C).

## Avvio con Docker

```bash
docker compose up -d --build
```

Apri **http://localhost:7521**

Le connessioni salvate sopravvivono ai riavvii (volume `orabridge-data`).

> **DB Oracle sulla stessa macchina?** Dentro il container usa come host
> `host.docker.internal` (già configurato nel compose), non `localhost`.

## Avvio senza Docker (sviluppo)

```bash
# terminale 1 — API su :3000
cd server && npm install && npm run dev

# terminale 2 — frontend con hot reload su :5173
cd client && npm install && npm run dev
```

Oppure build unica servita dal server:

```bash
cd client && npm install && npm run build && cp -r dist ../server/public
cd ../server && npm install && npm start   # http://localhost:3000
```

## Desktop (Windows)

Oltre a Docker e alla PWA, Orabridge può essere pacchettizzato come vera app
desktop Windows (Electron): un installer `.exe` che al doppio clic avvia
anche il backend al proprio interno, senza Docker né comandi da lanciare a
parte.

### Scaricare o aggiornare

L'installer di ogni versione rilasciata è pubblicato automaticamente su
**[GitHub Releases](https://github.com/riftbane/orabridge/releases/latest)**:
scarica `Orabridge Setup <versione>.exe` da lì per una prima installazione.

Una volta installata, l'app **si aggiorna da sola**: ad ogni avvio (e ogni
poche ore mentre resta aperta) controlla in background se c'è una versione
più recente su GitHub Releases, la scarica, e quando è pronta chiede se
riavviare subito per installarla o farlo più tardi. Non serve rieseguire
l'installer manualmente per restare aggiornati.

### Buildare l'installer localmente (sviluppo/test)

```bash
cd electron
npm install
npm run dist:win
```

Il primo `dist:win` scarica anche l'Oracle Instant Client per Windows
(~40 MB, messo in cache in `electron/.cache`) e lo include nell'installer per
la modalità thick (stessi verifier 10G supportati dal deployment Docker).
L'installer viene generato in `electron/release/` — è solo locale, non viene
pubblicato da nessuna parte (per quello serve la pipeline CI, vedi sotto).

Per iterare rapidamente durante lo sviluppo (solo modalità thin, senza
scaricare l'Instant Client):

```bash
npm start
```

Note:
- **Prerequisito sul PC di destinazione**: Microsoft Visual C++ Redistributable
  x64, richiesto dall'Instant Client (quasi sempre già presente su
  Windows 10/11).
- L'installer non è firmato digitalmente: al primo avvio Windows SmartScreen
  segnala "editore sconosciuto" (nessun certificato di firma codice
  disponibile).
- Le connessioni salvate vivono in `%APPDATA%\Orabridge`, separate da quelle
  del deployment Docker (`/data` nel volume `orabridge-data`).
- Costruire l'installer richiede NSIS; da Linux/WSL2 senza Wine il passaggio
  `electron-builder --win` può fallire — in tal caso lanciare `npm run dist:win`
  da un vero ambiente Windows (anche puntando alla stessa cartella via
  `\\wsl.localhost\...`).

### Pipeline di rilascio (CI)

Ogni push su `main` con almeno un commit `feat:`/`fix:`/`perf:` (o con una
modifica "breaking", vedi `CLAUDE.md`) fa scattare
`.github/workflows/release.yml`: la versione viene bumpata automaticamente
nei tre `package.json`, il CHANGELOG aggiornato, e l'installer buildato e
pubblicato su GitHub Releases da un runner Windows nativo (non serve Wine in
CI). Dettagli e convenzione dei messaggi di commit in `CLAUDE.md`.

## Scorciatoie

| Tasti | Azione |
|---|---|
| `Ctrl+Invio` / `F9` | Esegui istruzione al cursore (o selezione) |
| `F5` | Esegui tutto lo script |
| `Ctrl+Spazio` | Autocomplete |
| doppio clic su cella | Visualizza valore completo (CLOB, testi lunghi) |
| clic su intestazione colonna | Ordina risultati |

Gli statement si separano con `;`. I blocchi PL/SQL (`DECLARE`/`BEGIN`/`CREATE PROCEDURE`…)
terminano con `/` su riga a sé, come in SQL*Plus.

## Architettura

```
docker-compose.yml       porta 127.0.0.1:7521 → container :3000
Dockerfile               build multi-stage (vite build → node:22-alpine)
server/                  Express + node-oracledb (thin)
  src/store.js           connessioni salvate in /data (password cifrate)
  src/pools.js           per ogni connessione: pool (metadata) + sessione dedicata
                         per il foglio SQL (transazioni coerenti)
  src/routes/            /api/connections, /api/conn/:id/…, /api/diff
  src/diff/              snapshot dello schema, confronto, script di sincronizzazione
client/                  React 18 + Vite + CodeMirror 6 + zustand (~190 KB gzip)
```

Ogni connessione attiva ha **una sessione dedicata** per i fogli SQL (le transazioni
restano aperte tra un'esecuzione e l'altra, commit/rollback espliciti) più un piccolo
pool separato per metadata e browsing dati, così l'albero resta reattivo anche durante
una query lunga.

Il **DB Diff** sta fuori da `/api/conn/:id` perché tocca due connessioni insieme.
Legge i due schemi con una manciata di query sul dizionario (una per vista, non
una per oggetto), tiene in memoria le ultime fotografie e su quelle calcola sia
il dettaglio dei singoli oggetti sia lo script — che viene generato dagli
snapshot, senza `DBMS_METADATA`, quindi funziona anche con privilegi minimi.
Confronto e generazione dello script sono funzioni pure, coperte da test
(`npm test` in `server/` e in `client/`).

## Risoluzione problemi

### NJS-116: password verifier type 0x939 is not supported … in Thin mode

L'utenza del DB ha solo il vecchio password verifier **10G** (capita su DB datati,
dopo upgrade senza reset password, o con `SEC_CASE_SENSITIVE_LOGON=FALSE`).
Due soluzioni:

1. **Usa Docker** (consigliato): l'immagine gira in modalità thick e supporta i
   verifier 10G senza toccare il DB.
2. **Rigenera i verifier** (serve un DBA se l'utenza non è tua):
   ```sql
   SELECT username, password_versions FROM dba_users WHERE username = 'TUO_UTENTE';
   -- se compare solo "10G":
   ALTER USER tuo_utente IDENTIFIED BY nuova_password;
   ```
   Il reset genera i verifier moderni solo se sul server
   `SQLNET.ALLOWED_LOGON_VERSION_SERVER` è ≥ 11 (default nelle versioni recenti).
   Nota: se il server è Oracle 11g, la modalità thin non può connettersi comunque
   (supporta solo 12.1+) — in quel caso serve la modalità thick.

Fuori da Docker la thick si abilita installando l'Instant Client e avviando il
server con `ORACLE_THICK_MODE=1` (e `ORACLE_CLIENT_LIB_DIR=/percorso` su
Windows/macOS; su Linux basta che le librerie siano in `LD_LIBRARY_PATH` o ldconfig).

L'Instant Client nell'immagine è x86_64: su host ARM (Apple Silicon) sostituisci
l'URL nel Dockerfile con la variante ARM64 o imposta `ORACLE_THICK_MODE=0`.

## Note

- Fogli SQL e loro contenuto vengono ricordati tra i riavvii (localStorage del browser).
- Le API accettano solo `Content-Type: application/json` sulle scritture, come
  protezione dalle richieste cross-site di pagine web esterne.
- La chiave di cifratura delle password è generata al primo avvio in `/data/.key`.
