# Orabridge

SQL veloce per Oracle, senza zavorra. Una piattaforma web leggera e dockerizzata per lavorare
con database Oracle: pensata per developer che non vogliono la pesantezza di SQL Developer.

- **Connessioni multiple simultanee**, salvate su disco (password cifrate AES-256-GCM);
  se la password manca o non è più valida viene chiesta al momento della connessione
  e salvata sulla connessione appena il login riesce
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
- **DB Diff** (icona ⇄ fra i comandi in alto): confronta due schemi — su
  connessioni diverse o sulla stessa — e genera lo script di allineamento
  - confronta tabelle (colonne, vincoli, indici, commenti), viste, viste
    materializzate, sequenze, sinonimi, procedure, funzioni, package, trigger e tipi
  - per ogni oggetto dice se è **solo in origine**, **solo in destinazione** o
    **diverso**; le differenze strutturali si leggono in tabella, quelle di
    codice in un **confronto affiancato riga per riga**
  - i vincoli e gli indici con nome generato (`SYS_C…`) si accoppiano per
    definizione invece che per nome, i riferimenti allo schema di origine
    valgono come quelli allo schema di destinazione e le colonne di identità si
    confrontano sul tipo di generazione, non sulla sequenza `ISEQ$$…` che
    Oracle numera in modo diverso in ogni database: niente differenze finte
  - filtri per stato con i conteggi, categorie comprimibili e selezione di
    massa (*tutti / nessuno / inverti*) su ciò che è in elenco
  - lo **script di sincronizzazione** (CREATE/ALTER, con i DROP opzionali) si
    genera per gli oggetti spuntati e si apre in un foglio SQL sulla
    destinazione — Orabridge non esegue mai nulla da sé
  - lo script crea le colonne di identità e quelle virtuali con la loro
    sintassi, rimappa sulla destinazione anche i `DEFAULT` che citano una
    sequenza e segnala quello che va rifatto a mano
- **Assistente AI** (icona ✨ o `Ctrl+Alt+I`): un pannello di chat che lavora
  davvero sul database, non solo sul testo della domanda
  - piattaforme supportate: **OpenRouter, Anthropic, Google Gemini, OpenAI** —
    si sceglie la piattaforma e si incolla la sua API key nelle impostazioni
  - in alternativa **Gemma 4 sul tuo computer**, gratis e senza API key: il
    motore llama.cpp è già dentro l'app desktop, si scarica una volta il file
    del modello dalle impostazioni e da lì l'assistente funziona anche offline,
    senza che un solo dato esca dal computer. In cambio è molto più lento e
    meno preciso dei modelli online — vedi «Modello locale» più sotto
  - **elenco dei modelli in tempo reale** letto dalla piattaforma scelta
    (OpenRouter compreso, con finestra di contesto), con ricerca nella tendina
  - **più sessioni in parallelo**, ognuna con la sua connessione, il suo modello
    e i suoi permessi; girano **in background** sul server, quindi continuano
    anche a pannello chiuso, cambiando scheda o ricaricando la pagina
  - **permessi di esecuzione** per sessione: *Lettura* (struttura, DDL, SELECT),
    *Scrittura* (INSERT/UPDATE/CREATE/ALTER) e, a parte, *DELETE e DROP*
  - quello che manca viene **chiesto in chat** mostrando l'SQL esatto, con
    «Consenti una volta / Consenti sempre / Rifiuta»
  - ogni passaggio è ispezionabile: si apre la chiamata e si vede l'SQL eseguito
    e la risposta arrivata dal database; l'SQL proposto si apre in un foglio con
    un clic e le istruzioni eseguite finiscono in cronologia, marcate ✨
  - risposte in **Markdown completo**, come nella chat di VS Code: titoli,
    elenchi annidati e con checkbox, tabelle, citazioni, collegamenti e blocchi
    di codice colorati con «Copia» e «Apri nel foglio»
  - **token spesi sempre sotto gli occhi**: sotto ogni risposta la piattaforma,
    il modello e i token di quella richiesta; in cima al pannello il totale
    della sessione. Il passaggio del mouse apre il dettaglio per voce (input,
    input da cache, scrittura cache, output, ragionamento) e, quando la
    piattaforma lo dichiara, il costo in dollari
  - la connessione della sessione si sceglie da una tendina **con ricerca**
    (nome, utente, servizio o gruppo) che mostra col pallino quali database sono
    davvero collegati
  - le API key restano **cifrate sul server** (AES-256-GCM, come le password
    delle connessioni) e non vengono mai inviate al browser
- **Pannelli ridimensionabili e richiudibili**: barra laterale, risultati del
  foglio SQL e pannello AI si trascinano dal bordo (doppio clic per tornare alla
  misura predefinita) e si nascondono dagli interruttori in alto a destra
- Dettaglio tabella: colonne, dati (con filtro WHERE e paginazione), vincoli, indici, trigger, DDL
- Sorgente e DDL di procedure/funzioni/package (via `DBMS_METADATA`)
- Esecuzione istruzione al cursore (`Ctrl+Invio` / `F9`), script completo (`F5`),
  explain plan, commit/rollback espliciti con indicatore di transazione aperta, annulla query
- DBMS Output, export CSV, griglia risultati virtualizzata (regge decine di migliaia di righe)
- **Decodifica entità HTML** (pulsante `&→à` sopra la griglia): per i database
  popolati da applicativi web legacy, che salvano il testo già codificato
  (`Attivit&agrave; in corso`). È solo a video e spento di default — il dato che
  si modifica, si esporta in CSV o si ordina resta quello del database
- **Guida integrata** (`F1` o l'icona del libro in alto a destra): manuale d'uso
  di tutte le funzioni, con indice, ricerca e la sezione «Aggiornamenti e
  novità» che riporta la versione installata e cosa è cambiato. La stessa guida
  si consulta da **Impostazioni → Guida**; il testo sta in `client/src/guide.js`
- Solo **localhost**: il server ascolta di default su `127.0.0.1` (e il compose pubblica
  la porta solo lì), nessun accesso dalla rete — vedi «Chi può parlare col server»
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

Il server ascolta solo su `127.0.0.1`: per raggiungerlo da un'altra macchina
serve chiederlo esplicitamente con `HOST=0.0.0.0` (è quello che fa l'immagine
Docker, dove la porta esce comunque solo verso `127.0.0.1` dell'host).

## Chi può parlare col server

Orabridge non ha login: chi arriva alla porta ha in mano le connessioni salvate
e quelle già aperte. Per questo l'accesso è chiuso su più fronti.

- **Ascolto sul solo loopback.** `HOST` vale `127.0.0.1` se non lo si cambia;
  `0.0.0.0` è una scelta esplicita di chi mette Orabridge in rete (e allora
  tocca a lui metterci davanti autenticazione e TLS).
- **Header `Host` verificato.** Quando si ascolta il loopback, una richiesta che
  arriva con un dominio qualsiasi viene rifiutata: è così che una pagina web
  aggira le protezioni sull'origine, facendo puntare il proprio dominio a
  `127.0.0.1` (DNS rebinding).
- **Niente scritture cross-site.** POST/PUT/PATCH/DELETE devono essere `application/json`
  e arrivare dall'origine della app; da un altro sito vengono rifiutate. Dietro un
  reverse proxy che non riscrive l'`Origin`, le origini buone si elencano in
  `ORABRIDGE_ALLOWED_ORIGINS` (separate da virgola).
- **Nel desktop, solo la finestra dell'app.** L'app Electron si porta dentro lo
  stesso server su una porta effimera del loopback, e finché non c'è un login
  chiunque sulla macchina potrebbe aprire quell'indirizzo dal browser. Il main
  genera quindi un **token casuale a ogni avvio** (`ORABRIDGE_TOKEN`) e lo
  aggiunge a livello di rete a tutte le richieste della finestra — documento,
  bundle, `/api` e gli `EventSource` della chat, che da JavaScript non possono
  mandare header propri. Chi apre quell'indirizzo da fuori trova solo una pagina
  che gli dice di usare l'app. Nel deployment web/Docker il token non c'è e il
  controllo resta spento: lì il server *è* il servizio.

## Desktop (Windows)

Oltre a Docker e alla PWA, Orabridge può essere pacchettizzato come vera app
desktop Windows (Electron): un installer `.exe` che al doppio clic avvia
anche il backend al proprio interno, senza Docker né comandi da lanciare a
parte.

La finestra non ha niente da browser: **nessuna barra dei menu** (File/Modifica/
Visualizza) e **nessuno strumento di sviluppo** (`F12`, `Ctrl+Shift+I`), che
nella versione installata è proprio disattivato. La **barra del titolo** è
disegnata dall'app nei suoi colori e ospita logo e comandi generali (nuova
connessione, importazione, cronologia, DB Diff, interruttori dei pannelli,
guida, impostazioni): Windows continua a disegnarci sopra solo i tre pulsanti
della finestra, e il resto della striscia si trascina come una barra del titolo
qualsiasi. Il backend che gira dentro l'app **risponde solo a quella finestra**:
aprire il suo indirizzo con un browser non serve a niente (vedi «Chi può parlare
col server»).

### Scaricare o aggiornare

L'installer di ogni versione rilasciata è pubblicato automaticamente su
**[GitHub Releases](https://github.com/riftbane/orabridge/releases/latest)**:
scarica `Orabridge-Setup-<versione>.exe` da lì per una prima installazione.

Una volta installata, l'app **si aggiorna da sola**: ad ogni avvio (e ogni
poche ore mentre resta aperta) controlla in background se c'è una versione
più recente su GitHub Releases, la scarica, e quando è pronta chiede se
riavviare subito per installarla o farlo più tardi. Non serve rieseguire
l'installer manualmente per restare aggiornati.

Le **novità delle versioni** non sono scritte a mano dentro l'app: la guida
(`F1` → «Aggiornamenti e novità») e la scheda **Impostazioni → Informazioni**
leggono le release pubblicate su GitHub, quindi mostrano sempre l'ultima
davvero uscita e le sue note, con il confronto rispetto alla versione in uso.
L'elenco passa dal server (`GET /api/releases`, mezz'ora di cache) e non dal
browser: così la richiesta è una sola per tutti, non dipende dalla CORS di
`api.github.com` e su una macchina senza internet si degrada in un punto solo —
in quel caso la guida ripiega sulle novità incluse nel bundle.

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
| `Ctrl+F` / `Ctrl+H` | Cerca / cerca e sostituisci nell'editor |
| `Invio` / `Maiusc+Invio` / `F3` | Risultato successivo / precedente |
| `Alt+C` / `Alt+W` / `Alt+R` | Maiuscole/minuscole, parola intera, espressione regolare |
| `Alt+L` | Limita la ricerca alle righe selezionate |
| `Ctrl+Maiusc+F` | Formatta la selezione |
| `Ctrl+Alt+F` | Formatta tutto il foglio |
| doppio clic su cella | Visualizza valore completo (CLOB, testi lunghi) |
| clic su intestazione colonna | Ordina risultati |
| `Ctrl+B` | Mostra/nascondi la barra laterale |
| `Ctrl+J` | Mostra/nascondi i risultati del foglio SQL |
| `Ctrl+Alt+I` | Mostra/nascondi l'assistente AI |
| `Ctrl+,` | Impostazioni |
| `F1` | Guida dell'app |

Ricerca, sostituzione e formattazione valgono in tutti gli editor: fogli SQL,
sorgenti PL/SQL (package body, funzioni, trigger) e viste in sola lettura
(dove la sostituzione è disattivata). La formattazione allinea le clausole a
destra del «fiume» e manda a capo una voce per riga, allineata sotto la prima:

```sql
SELECT c.ragione_sociale,
       o.totale
  FROM clienti c,
       ordini o
 WHERE o.cliente_id = c.id
   AND o.totale > 13000;
```

È conservativa: se il codice non viene riconosciuto token per token, il testo
resta invariato e compare un avviso.

Le connessioni si organizzano in gruppi: clic destro su una connessione →
«Sposta in…» per spostarla in un altro gruppo (o crearne uno nuovo).

Gli statement si separano con `;`. I blocchi PL/SQL (`DECLARE`/`BEGIN`/`CREATE PROCEDURE`…)
terminano con `/` su riga a sé, come in SQL*Plus.

## Assistente AI

Si configura da **Impostazioni** (`Ctrl+,`, o l'ingranaggio in alto a destra —
lì dentro è finita anche la scheda «Informazioni» con gli aggiornamenti):
si sceglie la piattaforma, si incolla la sua API key e si seleziona il modello
predefinito. Ogni piattaforma può avere la sua chiave: si passa dall'una
all'altra senza reinserirle.

Le chiavi vengono cifrate con AES-256-GCM nella stessa cartella dati delle
connessioni (`data/settings.json`, chiave in `data/.key`) e **non escono mai dal
server**: il browser riceve solo l'informazione che una chiave è presente. Anche
il dialogo con la piattaforma parte dal server, non dal browser — è quello che
permette alle sessioni di continuare a lavorare in background.

**Come lavora.** L'assistente non tira a indovinare sullo schema: ha degli
strumenti per elencare schemi e oggetti, leggere la struttura di una tabella
(colonne, vincoli, foreign key, indici, commenti), leggere sorgenti e DDL,
eseguire SELECT ed eseguire istruzioni di modifica. Le esecuzioni passano dalla
**stessa sessione del foglio SQL**, quindi vedono la transazione aperta e non
fanno commit da sole: il commit resta un gesto esplicito.

**Quanto costa.** Ogni risposta si porta dietro il suo conto: sotto l'ultimo
messaggio compare `piattaforma · modello · token`, e in cima al pannello il
totale della sessione. Passando il mouse su uno dei due si apre il dettaglio —
input, input servito dalla cache, scrittura della cache, output, di cui
ragionamento — con il numero di chiamate al modello che la richiesta ha
richiesto (una risposta che usa gli strumenti ne fa più di una, e il conto le
comprende tutte). Le voci non si sovrappongono mai, così la somma è il totale
vero dei token: dove una piattaforma conta la cache dentro il prompt
(OpenAI, Gemini) il server la scorpora, dove la conta a parte (Anthropic) la
lascia dov'è. OpenRouter dichiara anche il **costo in crediti** della chiamata,
che compare accanto ai token; le altre piattaforme non lo espongono, quindi lì
il conto resta in token. I numeri sono quelli che riporta la piattaforma, non
una stima.

**Modello locale (gratis).** Fra le piattaforme c'è anche «Modello locale»: non
chiede nessuna API key perché il modello gira dentro Orabridge, sul computer
dell'utente. Il motore è [llama.cpp](https://github.com/ggml-org/llama.cpp) via
`node-llama-cpp` ed è **già incluso nell'app desktop** — non c'è niente da
installare, né Ollama né Python né compilatori. Va scaricato una volta il file
dei pesi, direttamente dalle impostazioni: si sceglie fra tre varianti di
**Gemma 4**, la più piccola pesa circa 2,9 GB. Il download prosegue lato server
con barra di avanzamento, si può chiudere la finestra, e se cade la rete riparte
da dove si era fermato.

Perché i pesi non sono dentro l'installer: la taglia più piccola di Gemma 4
(E2B) quantizzata a 4 bit occupa 3,1 GB, oltre il limite di 2 GB per file delle
release GitHub e comunque troppo per un installer che oggi ne pesa poche
centinaia di mega. Il motore sì, quello viaggia con l'app (~120 MB: versione CPU
e versione Vulkan, che accelera su schede AMD, Intel e NVIDIA).

Aspettative oneste: Gemma 4 E2B ha 2,3 miliardi di parametri effettivi contro le
centinaia di miliardi dei modelli online. Su una query semplice o su una domanda
sullo schema se la cava; su SQL complicato sbaglia molto più spesso, e su CPU
può metterci minuti a rispondere. Serve quando non si vuole (o non si può)
mandare niente fuori, o semplicemente per non spendere. Il conteggio dei token
resta attivo e mostra costo zero.

**Permessi.** Ogni sessione ha tre interruttori — *Lettura*, *Scrittura* e
*DELETE/DROP* — che partono dai valori predefiniti delle impostazioni. Prima di
eseguire, il server classifica l'istruzione e la confronta con i permessi
concessi; se non bastano, l'esecuzione si ferma e in chat compare l'SQL esatto
con «Consenti una volta / Consenti sempre / Rifiuta». La classificazione ignora
commenti e stringhe (un `DROP` dentro un letterale non è un DROP), ma nei
blocchi PL/SQL guarda **anche** dentro le stringhe, perché è lì che si nasconde
l'SQL dinamico: nel dubbio chiede conferma. Un rifiuto viene spiegato al
modello, che non ci riprova e propone l'SQL da lanciare a mano.

## Architettura

```
docker-compose.yml       porta 127.0.0.1:7521 → container :3000
Dockerfile               build multi-stage (vite build → node:22-alpine)
server/                  Express + node-oracledb (thin)
  src/index.js           avvio, guardie di accesso (Host, origine, token desktop)
  src/secret.js          cartella dati e cifratura AES-256-GCM condivise
  src/store.js           connessioni salvate in /data (password cifrate)
  src/settings.js        impostazioni AI: piattaforma, chiavi cifrate, permessi
  src/pools.js           per ogni connessione: pool (metadata) + sessione dedicata
                         per il foglio SQL (transazioni coerenti)
  src/routes/            /api/connections, /api/conn/:id/…, /api/diff, /api/ai
  src/routes/releases.js novità delle versioni da GitHub Releases, in cache
  src/diff/              snapshot dello schema, confronto, script di sincronizzazione
  src/ai/providers.js    adattatori OpenRouter/Anthropic/Gemini/OpenAI + modello locale
  src/ai/localModels.js  catalogo Gemma 4, download con ripresa e avanzamento
  src/ai/localLlama.js   llama.cpp: caricamento del modello, tool calling, token
  src/ai/usage.js        conteggio dei token normalizzato tra le piattaforme
  src/ai/tools.js        strumenti sul database esposti al modello
  src/ai/sqlGuard.js     classificazione delle istruzioni nei livelli di permesso
  src/ai/sessions.js     ciclo dell'agente, approvazioni, stream SSE verso il client
client/                  React 18 + Vite + CodeMirror 6 + zustand (~190 KB gzip)
```

I quattro provider online non aggiungono dipendenze: parlano HTTP con `fetch`
nativo e lo streaming arriva al browser via SSE (`EventSource`). Il modello
locale invece porta `node-llama-cpp`, importato **in modo dinamico**: dove i
binari nativi non ci sono (server in Docker, sviluppo su Linux) la piattaforma
«Modello locale» si disattiva da sola e il resto di Orabridge parte lo stesso.

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
(`npm test` in `server/` e in `client/`). Anche la classificazione delle
istruzioni che regola i permessi dell'assistente e la normalizzazione dei
conteggi di token sono coperte da test.

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
