# Orabridge

**Un client per database Oracle: app desktop per Windows, container Docker o
semplice pagina web.** Leggero da aprire e pensato per il lavoro di tutti i
giorni su uno schema — scrivere SQL, girare fra gli oggetti, confrontare due
database, modificare la struttura sapendo prima quale script verrà eseguito.

[![Licenza: Apache 2.0](https://img.shields.io/badge/licenza-Apache--2.0-lightgrey)](LICENSE)
[![Ultima release](https://img.shields.io/github/v/release/riftbane/orabridge?label=release)](https://github.com/riftbane/orabridge/releases/latest)
![Piattaforme: Windows, Docker, web](https://img.shields.io/badge/piattaforme-Windows%20%7C%20Docker%20%7C%20web-lightgrey)
![Database: Oracle 11.2+](https://img.shields.io/badge/database-Oracle%2011.2%2B-lightgrey)

> **Progetto indipendente.** Orabridge non è affiliato a Oracle Corporation, né
> sponsorizzato o approvato da essa. Oracle è un marchio registrato di Oracle
> e/o delle sue affiliate, citato qui solo per indicare i database con cui
> Orabridge interopera — vedi [Licenza e marchi](#licenza-e-marchi).

Software libero sotto [Apache License 2.0](LICENSE), scritto in larga parte con
l'aiuto di modelli linguistici: com'è stato fatto è raccontato in
[Costruito con l'AI](#costruito-con-lai).

---

## Indice

- [Cosa sa fare](#cosa-sa-fare)
- [Requisiti e compatibilità](#requisiti-e-compatibilità)
- [Installazione](#installazione)
  - [App desktop per Windows](#app-desktop-per-windows)
  - [Docker](#docker)
  - [Dai sorgenti (sviluppo)](#dai-sorgenti-sviluppo)
- [Chi può parlare col server](#chi-può-parlare-col-server)
- [Scorciatoie](#scorciatoie)
- [Assistente AI](#assistente-ai)
- [GitHub Copilot in VS Code (MCP)](#github-copilot-in-vs-code-mcp)
- [Architettura](#architettura)
- [Risoluzione problemi](#risoluzione-problemi)
- [Contribuire](#contribuire)
- [Sicurezza](#sicurezza)
- [Costruito con l'AI](#costruito-con-lai)
- [Licenza e marchi](#licenza-e-marchi)

---

## Cosa sa fare

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
- **Barra laterale a viste** con barra delle attività in stile VS Code, sempre visibile
  anche a pannello chiuso:
  - **Connessioni** (`Ctrl+Maiusc+D`): l'elenco salvato, con gruppi colorati e ricerca
  - **Connessione** (`Ctrl+Maiusc+E`): una connessione sola a tutta altezza — stato,
    versione di Oracle, comandi rapidi, **selettore di schema** e albero degli oggetti
  - **Ricerca nel codice** (`Ctrl+Maiusc+F`, vedi sotto)
- **Browser degli oggetti** ad albero: tabelle, viste, viste materializzate, indici,
  sequenze, procedure, funzioni, package, trigger, tipi, sinonimi + altri schemi
- **Ricerca globale nel PL/SQL** (`Ctrl+Maiusc+F`): cerca un testo dentro il sorgente di
  procedure, funzioni, trigger e package body (e, a richiesta, specifiche dei package e
  tipi) di tutto il database
  - interruttori maiuscole/minuscole, parola intera ed **espressione regolare**
    (sintassi Oracle, `REGEXP_LIKE`)
  - ambito: schema di lavoro, un solo schema, tutti gli schemi applicativi oppure
    tutti compresi quelli di sistema (`SYS`, `XDB`, `APEX_*`… normalmente esclusi)
  - risultati raggruppati per oggetto: **un clic apre l'oggetto sulla scheda Sorgente,
    salta alla riga e seleziona il testo trovato**
  - il filtro viaggia in SQL su `ALL_SOURCE` (niente sorgenti scaricati in blocco), con
    tetto a 1000 righe e timeout di due minuti sulle ricerche su tutto il database
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
    confrontano sul tipo di generazione, non sulla sequenza `ISEQ$$…` che il
    database numera in modo diverso su ogni istanza: niente differenze finte
  - filtri per stato con i conteggi, categorie comprimibili e selezione di
    massa (*tutti / nessuno / inverti*) su ciò che è in elenco
  - lo **script di sincronizzazione** (CREATE/ALTER, con i DROP opzionali) si
    genera per gli oggetti spuntati e si apre in un foglio SQL sulla
    destinazione — Orabridge non esegue mai nulla da sé
  - lo script crea le colonne di identità e quelle virtuali con la loro
    sintassi, rimappa sulla destinazione anche i `DEFAULT` che citano una
    sequenza e segnala quello che va rifatto a mano
- **Diagramma — editor a nodi** (icona a rete fra i comandi in alto, **beta**):
  lo schema come grafo, e ci si lavora dentro
  - ogni tabella è un nodo, ogni foreign key un collegamento fra due colonne;
    disposizione automatica a livelli (padri a sinistra, figli a destra) e
    posizioni salvate per connessione+schema
  - allontanandosi i nodi si semplificano da sé — prima le sole colonne chiave,
    poi il solo nome — così anche uno schema da centinaia di tabelle resta
    navigabile; all'apertura si può caricare un sottoinsieme con un filtro
  - **doppio clic su un nodo** e la tabella si modifica lì dov'è: colonne,
    vincoli, indici, commento. Rinominando una colonna la seguono da sole la
    chiave, gli indici e ogni FK che la referenzia, in tutto il diagramma
  - le **foreign key** si creano trascinando una colonna su un'altra tabella;
    doppio clic sulla linea apre `ON DELETE`, stato e la casella che crea
    l'indice sulle colonne figlie (senza, ogni `DELETE` sul padre blocca la figlia)
  - controlli continui su tutto lo schema: nomi duplicati o troppo lunghi per la
    versione di Oracle in uso, tipi incompatibili fra le due parti di una FK,
    riferimenti a colonne non uniche
  - **Applica** rilegge lo schema, calcola la differenza con il disegno e ne
    ricava lo script — rinomine in cima, con il numero di righe delle tabelle da
    eliminare e la conferma da digitare. Lo si vede sempre prima: si apre in un
    foglio SQL o si esegue da lì
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

## Requisiti e compatibilità

**Sul server di database** non va installato niente: Orabridge si collega come
un qualsiasi client.

Il driver ([node-oracledb](https://github.com/oracle/node-oracledb)) funziona in
due modalità, e la differenza si sente sui database datati:

| Modalità | Cosa serve | Server supportati | Password verifier |
|---|---|---|---|
| **thin** (predefinita dai sorgenti) | niente | Oracle Database 12.1+ | 11G / 12C |
| **thick** | Oracle Instant Client | Oracle Database 11.2+ | anche il vecchio 10G |

L'app desktop Windows e l'immagine Docker includono **Oracle Instant Client
19.23**, quindi partono già in modalità thick: sono la strada buona se il
database è vecchio o se l'utenza ha ancora il verifier 10G (vedi
[NJS-116](#njs-116-password-verifier-type-0x939-is-not-supported--in-thin-mode)).
L'Instant Client è software di Oracle, soggetto alle condizioni di licenza di
Oracle: vedi [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

Le connessioni si definiscono con host, porta e nome del servizio (o SID).

**Per installare**, a seconda di come lo si usa:

- *app desktop*: Windows 10/11 x64. Serve il **Microsoft Visual C++
  Redistributable x64**, richiesto dall'Instant Client (quasi sempre già
  presente).
- *Docker*: Docker Engine con Compose v2. L'immagine è x86_64 (su Apple Silicon
  vedi [Risoluzione problemi](#risoluzione-problemi)).
- *dai sorgenti*: Node.js 22 e npm.

## Installazione

### App desktop per Windows

L'installer di ogni versione rilasciata è pubblicato su
**[GitHub Releases](https://github.com/riftbane/orabridge/releases/latest)**:
scarica ed esegui `Orabridge-Setup-<versione>.exe`. Al doppio clic parte anche
il backend, dentro l'applicazione: niente Docker, niente comandi.

L'installer **non è firmato digitalmente** (non c'è un certificato di firma del
codice): al primo avvio Windows SmartScreen segnala «editore sconosciuto», e per
proseguire bisogna passare da *Ulteriori informazioni → Esegui comunque*.

La finestra non ha niente da browser: **nessuna barra dei menu** (File/Modifica/
Visualizza) e **nessuno strumento di sviluppo** (`F12`, `Ctrl+Maiusc+I`), che
nella versione installata è proprio disattivato. La **barra del titolo** è
disegnata dall'app nei suoi colori e ospita logo e comandi generali (nuova
connessione, importazione, cronologia, DB Diff, interruttori dei pannelli,
guida, impostazioni): Windows continua a disegnarci sopra solo i tre pulsanti
della finestra, e il resto della striscia si trascina come una barra del titolo
qualsiasi. Il backend che gira dentro l'app **risponde solo a quella finestra**:
aprire il suo indirizzo con un browser non serve a niente (vedi
[Chi può parlare col server](#chi-può-parlare-col-server)).

Le connessioni salvate vivono in `%APPDATA%\Orabridge`, separate da quelle del
deployment Docker.

#### Aggiornamenti automatici

Una volta installata, l'app **si aggiorna da sola**: ad ogni avvio (e ogni poche
ore mentre resta aperta) controlla in background se c'è una versione più recente
su GitHub Releases, la scarica, e quando è pronta chiede se riavviare subito per
installarla o farlo più tardi. Non serve rieseguire l'installer manualmente.

Le **novità delle versioni** non sono scritte a mano dentro l'app: la guida
(`F1` → «Aggiornamenti e novità») e la scheda **Impostazioni → Informazioni**
leggono le release pubblicate su GitHub, quindi mostrano sempre l'ultima
davvero uscita e le sue note, con il confronto rispetto alla versione in uso.
L'elenco passa dal server (`GET /api/releases`, mezz'ora di cache) e non dal
browser: così la richiesta è una sola per tutti, non dipende dalla CORS di
`api.github.com` e su una macchina senza internet si degrada in un punto solo —
in quel caso la guida ripiega sulle novità incluse nel bundle.

### Docker

```bash
docker compose up -d --build
```

Apri **http://localhost:7521**

Le connessioni salvate sopravvivono ai riavvii (volume `orabridge-data`, montato
su `/data`).

> **DB Oracle sulla stessa macchina?** Dentro il container usa come host
> `host.docker.internal` (già configurato nel compose), non `localhost`.

La build scarica l'Oracle Instant Client dai server di Oracle: chi costruisce
l'immagine lo fa alle condizioni di licenza di Oracle
([dettagli](THIRD-PARTY-NOTICES.md)). Per farne a meno, `ORACLE_THICK_MODE=0`
nel compose — si resta in modalità thin.

### Dai sorgenti (sviluppo)

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

I test si lanciano con `npm test` in `server/` e in `client/` — vedi
[CONTRIBUTING.md](CONTRIBUTING.md).

#### Buildare l'installer Windows in locale

```bash
cd electron
npm install
npm run dist:win
```

Il primo `dist:win` scarica anche l'Oracle Instant Client per Windows
(~40 MB, messo in cache in `electron/.cache`) e lo include nell'installer per
la modalità thick. L'installer viene generato in `electron/release/` — è solo
locale, non viene pubblicato da nessuna parte.

Per iterare rapidamente durante lo sviluppo (solo modalità thin, senza
scaricare l'Instant Client):

```bash
npm start
```

Costruire l'installer richiede NSIS; da Linux/WSL2 senza Wine il passaggio
`electron-builder --win` può fallire — in tal caso lanciare `npm run dist:win`
da un vero ambiente Windows (anche puntando alla stessa cartella via
`\\wsl.localhost\...`). Su Linux/WSL npm non installa i binari nativi Windows di
`node-llama-cpp`, quindi una build locale esce senza motore per il modello
locale: per un pacchetto completo serve la CI.

#### Pipeline di rilascio (CI)

Ogni push su `main` con almeno un commit `feat:`/`fix:`/`perf:` (o con una
modifica "breaking") fa scattare `.github/workflows/release.yml`: la versione
viene bumpata automaticamente nei tre `package.json`, il CHANGELOG aggiornato, e
l'installer buildato e pubblicato su GitHub Releases da un runner Windows nativo.
Dettagli e convenzione dei messaggi di commit in [`CLAUDE.md`](CLAUDE.md) e
[CONTRIBUTING.md](CONTRIBUTING.md).

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
- **L'unica altra porta è spenta di default.** L'integrazione MCP con gli editor
  esterni (§ [Copilot in VS Code](#github-copilot-in-vs-code-mcp)) sta sotto
  `/api`, quindi eredita tutti i controlli qui sopra, token compreso; in più
  risponde solo se la si accende dalle impostazioni, espone soltanto strumenti
  di lettura e vede solo le connessioni esposte una per una (spente di default).
  Il file con porta e token che serve al ponte esiste solo a integrazione accesa
  — chi può leggerlo può interrogare i database esposti, ed è il motivo per cui
  non nasce da solo.

Cosa è in scopo e cosa no, e come segnalare un problema di sicurezza: vedi
[SECURITY.md](SECURITY.md).

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
| `Ctrl+Maiusc+F` | Formatta la selezione (col fuoco nell'editor) |
| `Ctrl+Alt+F` | Formatta tutto il foglio |
| doppio clic su cella | Visualizza valore completo (CLOB, testi lunghi) |
| clic su intestazione colonna | Ordina risultati |
| `Ctrl+B` | Mostra/nascondi la barra laterale |
| `Ctrl+Maiusc+D` / `Ctrl+Maiusc+E` | Vista Connessioni / Connessione |
| `Ctrl+Maiusc+F` (fuori dall'editor) | Vista Ricerca nel codice |
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
terminano con `/` su riga a sé, come in SQL\*Plus.

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

> **Dove finiscono i dati.** Con una piattaforma online, quello che l'assistente
> legge dal database (struttura, sorgenti, righe delle SELECT) viene inviato ai
> server di quella piattaforma, alle sue condizioni d'uso. Se non deve uscire
> niente dal computer, c'è il modello locale.

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
da dove si era fermato. I pesi sono di Google e restano soggetti alle
[Gemma Terms of Use](https://ai.google.dev/gemma/terms).

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

Resta comunque un assistente, non una garanzia: i permessi limitano cosa può
eseguire, non rendono giusto quello che scrive. Su un database di produzione,
leggere lo script prima di eseguirlo è ancora compito di chi lo esegue.

## GitHub Copilot in VS Code (MCP)

Orabridge può farsi interrogare da Copilot — o da qualunque editor che parli
**MCP** (Model Context Protocol) — sui database che l'utente gli **espone, uno
per uno**. In chat, in modalità agente, Copilot legge schema, DDL, sorgenti
PL/SQL e il risultato delle SELECT: ha il contesto del database accanto al
codice, senza che nessuno gli configuri una seconda connessione al database.

**È di sola lettura, per costruzione.** L'elenco degli strumenti si costruisce
filtrando quelli dell'assistente sul permesso `read`, quindi `execute_sql` — che
nel pannello AI c'è — da questa parte non esiste: non è nascosto dietro un
interruttore, non è nell'elenco. Chi chiama passa da `runTool(..., readOnly)`,
che rifiuta gli strumenti di scrittura anche se lo si invocasse direttamente.
Niente INSERT, niente DROP, niente DELETE: le modifiche restano una cosa da fare
dal foglio SQL. E le credenziali non escono dall'app in nessuna forma —
`list_connections` restituisce nome, schema corrente e versione di Oracle, non
utente, host, servizio né password.

**Due interruttori, non uno.** Quello generale sta in **Impostazioni → Copilot e
MCP** e apre la porta (parte spento: la decisione è dell'utente). Poi ogni
connessione ha il suo, anch'esso spento di default: Copilot vede **solo** i
database esposti, gli altri non compaiono nemmeno in `list_connections` e non
sono nominabili nel parametro `connection`. Sotto l'interruttore della singola
connessione ci sono i permessi — **Lettura** si imposta, *Modifica* ed
*Eliminazione* si vedono e basta, perché gli strumenti che servirebbero da qui
non escono affatto. L'interruttore per connessione sta anche nella finestra di
modifica della connessione e nel menu contestuale della barra laterale.

**Un database esposto si collega da solo.** Alla prima richiesta di Copilot,
l'integrazione apre il pool con la password già salvata in Orabridge (`ensureOpen`
in `server/src/mcp/tools.js`, con guardia sulle chiamate in parallelo: un
collegamento solo). Senza password salvata non si tenta niente e lo strumento
spiega che va collegata una volta a mano. Quello che succede si vede **in tempo
reale** nella finestra di Orabridge: la connessione compare collegata nella barra
laterale, con una spina che si accende mentre Copilot legge, e le impostazioni
hanno una sezione *Attività in tempo reale* con le ultime richieste (strumento,
database, durata o errore). Il flusso è un SSE su `/api/mcp/events`, alimentato
da `server/src/mcp/activity.js`.

Nelle impostazioni c'è anche la configurazione già compilata da incollare in
`mcp.json`, coi percorsi dell'installazione — quello che segue è la stessa cosa
spiegata.

**Windows** — configurazione utente di VS Code, comando *MCP: Open User
Configuration*:

```json
{
  "servers": {
    "orabridge": {
      "type": "stdio",
      "command": "C:\\Program Files\\Orabridge\\Orabridge.exe",
      "args": ["C:\\Program Files\\Orabridge\\resources\\mcp-bridge.cjs"],
      "env": { "ELECTRON_RUN_AS_NODE": "1" }
    }
  }
}
```

**WSL** — per un workspace aperto in WSL, in `.vscode/mcp.json` (o nella
configurazione utente remota):

```json
{
  "servers": {
    "orabridge": {
      "type": "stdio",
      "command": "/mnt/c/Program Files/Orabridge/Orabridge.exe",
      "args": ["C:\\Program Files\\Orabridge\\resources\\mcp-bridge.cjs"],
      "env": { "ELECTRON_RUN_AS_NODE": "1", "WSLENV": "ELECTRON_RUN_AS_NODE" }
    }
  }
}
```

**Server avviato a mano o in Docker**: non serve nessun ponte, si punta
direttamente all'endpoint —
`{ "servers": { "orabridge": { "type": "http", "url": "http://127.0.0.1:3000/api/mcp" } } }`.

### Perché un ponte, e perché funziona anche da WSL

L'app desktop ascolta su una **porta effimera** e genera un **token nuovo a ogni
avvio**: in un `mcp.json` statico non c'è niente di stabile da scrivere. Il ponte
(`electron/mcp-bridge.cjs`, un file senza dipendenze) li rilegge a ogni messaggio
da un file di scoperta nella cartella dati, e li tiene fuori dalla
configurazione dell'editor. Se l'app si riavvia, il ponte raccoglie porta e token
nuovi da solo; se l'app è chiusa, risponde comunque all'handshake — altrimenti VS
Code segnerebbe il server come guasto e non riproverebbe più — e a spiegare il
problema è il primo strumento che si usa.

Il ponte gira come Node dell'eseguibile di Orabridge (`ELECTRON_RUN_AS_NODE=1`),
quindi non c'è un runtime in più da installare. Da WSL il trucco è tutto lì:
lanciato per percorso `/mnt/c/...`, resta un **processo Windows**, e solo dal lato
Windows si raggiunge il `127.0.0.1` su cui l'app ascolta (in WSL con networking
NAT, il loopback di Windows non è raggiungibile). Niente porte esposte sulla
rete, nessuna regola di firewall, nessun requisito sulla versione di Windows.

Attenzione a `WSLENV`: senza quella riga la variabile `ELECTRON_RUN_AS_NODE` non
attraversa il confine fra Linux e Windows, e l'eseguibile aprirebbe la finestra
di Orabridge invece di comportarsi da Node.

### Come Copilot sceglie il database

`list_connections` elenca i database esposti (segnalando quali sono già
collegati); ogni altro strumento accetta un parametro `connection` facoltativo.
Con **uno solo** esposto si può omettere; se sono più d'uno ma ne è collegato uno
solo si usa quello — è il database su cui l'utente sta lavorando. Altrimenti
l'errore elenca i nomi disponibili invece di scegliere a caso.

Le query di Copilot girano su una connessione **del pool**, non sulla sessione
dedicata del foglio SQL: non si accodano dietro alle query dell'utente, non
vedono le sue modifiche non confermate e non gli lasciano lock in giro. Nella
cronologia compaiono con l'icona della spina, per distinguerle da quelle del
foglio e da quelle dell'assistente.

Una cosa da sapere prima di accendere l'integrazione su un database di
produzione: quello che Copilot legge finisce nel contesto del suo modello, cioè i
dati interrogati **lasciano il computer**. E i commenti, i nomi degli oggetti e i
dati stessi diventano input di un agente che nella stessa sessione può modificare
file ed eseguire comandi: vale la pena saperlo.

## Architettura

```
docker-compose.yml       porta 127.0.0.1:7521 → container :3000
Dockerfile               build multi-stage (vite su node:22-alpine → runtime
                         node:22-slim + Oracle Instant Client)
server/                  Express + node-oracledb (thin)
  src/index.js           avvio, guardie di accesso (Host, origine, token desktop)
  src/secret.js          cartella dati e cifratura AES-256-GCM condivise
  src/store.js           connessioni salvate in /data (password cifrate)
  src/settings.js        impostazioni AI: piattaforma, chiavi cifrate, permessi
  src/pools.js           per ogni connessione: pool (metadata) + sessione dedicata
                         per il foglio SQL (transazioni coerenti)
  src/routes/            /api/connections, /api/conn/:id/…, /api/diff, /api/graph, /api/ai, /api/mcp
  src/routes/search.js   ricerca nel PL/SQL: predicato in SQL su ALL_SOURCE, timeout
  src/routes/releases.js novità delle versioni da GitHub Releases, in cache
  src/diff/              snapshot dello schema, confronto, script di sincronizzazione
  src/graph/             editor a nodi: modello del diagramma, rinomine, piano DDL
  src/diagrams.js        disposizione dei diagrammi, per connessione+schema
  src/ai/providers.js    adattatori OpenRouter/Anthropic/Gemini/OpenAI + modello locale
  src/ai/localModels.js  catalogo Gemma 4, download con ripresa e avanzamento
  src/ai/localLlama.js   llama.cpp: caricamento del modello, tool calling, token
  src/ai/usage.js        conteggio dei token normalizzato tra le piattaforme
  src/ai/tools.js        strumenti sul database esposti al modello
  src/ai/sqlGuard.js     classificazione delle istruzioni nei livelli di permesso
  src/ai/sessions.js     ciclo dell'agente, approvazioni, stream SSE verso il client
  src/mcp/protocol.js    MCP: JSON-RPC 2.0, initialize/tools, senza dipendenze
  src/mcp/tools.js       superficie di sola lettura per gli editor esterni
  src/mcp/endpoint.js    porta e token su disco per il ponte stdio
electron/mcp-bridge.cjs  ponte stdio ⇄ HTTP che VS Code lancia (anche da WSL)
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

Il **diagramma** poggia sullo stesso motore: il disegno *è* una fotografia dello
schema, e applicare le modifiche è il confronto fra quella disegnata e quella
letta dal database. Il disegno però è indicizzato per id stabile invece che per
nome — il confronto accoppia gli oggetti per nome, e una tabella rinominata
sembrerebbe «eliminata e ricreata» — quindi un passaggio dedicato emette le
rinomine, che vanno in cima allo script, e riscrive la fotografia di partenza
come sarà dopo di esse. Da lì in poi il confronto vede solo le differenze vere.
Anche questo è tutto puro e testato, invariante compreso: aprire un diagramma e
applicarlo senza toccare nulla produce uno script vuoto. Il progetto e lo stato
del lavoro stanno in [`docs/editor-a-nodi.md`](docs/editor-a-nodi.md) e
[`docs/editor-a-nodi-roadmap.md`](docs/editor-a-nodi-roadmap.md).

## Risoluzione problemi

### NJS-116: password verifier type 0x939 is not supported … in Thin mode

L'utenza del DB ha solo il vecchio password verifier **10G** (capita su DB datati,
dopo upgrade senza reset password, o con `SEC_CASE_SENSITIVE_LOGON=FALSE`).
Due soluzioni:

1. **Usa l'app desktop o Docker** (consigliato): includono l'Instant Client,
   girano in modalità thick e supportano i verifier 10G senza toccare il DB.
2. **Rigenera i verifier** (serve un DBA se l'utenza non è tua):
   ```sql
   SELECT username, password_versions FROM dba_users WHERE username = 'TUO_UTENTE';
   -- se compare solo "10G":
   ALTER USER tuo_utente IDENTIFIED BY nuova_password;
   ```
   Il reset genera i verifier moderni solo se sul server
   `SQLNET.ALLOWED_LOGON_VERSION_SERVER` è ≥ 11 (default nelle versioni recenti).
   Nota: se il server è Oracle Database 11g, la modalità thin non può connettersi
   comunque (supporta solo 12.1+) — in quel caso serve la modalità thick.

Fuori da Docker e dall'app desktop, la thick si abilita installando l'Instant
Client e avviando il server con `ORACLE_THICK_MODE=1` (e
`ORACLE_CLIENT_LIB_DIR=/percorso` su Windows/macOS; su Linux basta che le
librerie siano in `LD_LIBRARY_PATH` o ldconfig).

### Docker su Apple Silicon (ARM)

L'Instant Client nell'immagine è x86_64: su host ARM sostituisci l'URL nel
Dockerfile con la variante ARM64 oppure imposta `ORACLE_THICK_MODE=0` per
restare in modalità thin.

### Altre note

- Fogli SQL e loro contenuto vengono ricordati tra i riavvii (localStorage del browser).
- Le API accettano solo `Content-Type: application/json` sulle scritture, come
  protezione dalle richieste cross-site di pagine web esterne.
- La chiave di cifratura delle password è generata al primo avvio in `/data/.key`
  (`%APPDATA%\Orabridge` nell'app desktop).

## Contribuire

Issue e pull request sono benvenute: convenzioni, ambiente di sviluppo, test e
formato dei messaggi di commit stanno in [CONTRIBUTING.md](CONTRIBUTING.md).
La lingua del progetto è l'italiano.

Il progetto è portato avanti da una persona sola nel tempo libero: le risposte
possono non essere immediate.

## Sicurezza

Per segnalare una vulnerabilità **non aprire una issue pubblica**: usa la
segnalazione privata di GitHub, come descritto in [SECURITY.md](SECURITY.md),
dove è scritto anche cosa Orabridge promette di proteggere e cosa no.

In breve: non c'è autenticazione, il server ascolta solo il loopback e chi ha
accesso alla macchina ha accesso alle credenziali salvate. Orabridge non
aggiunge privilegi a quelli dell'utenza Oracle con cui ci si collega.

## Costruito con l'AI

Orabridge è stato scritto in larga parte **in collaborazione con modelli
linguistici** (Claude, in sessioni di programmazione assistita): dal codice ai
test, dalla guida integrata a questo README. La direzione, le scelte di
progetto, le revisioni e le prove sul campo sono umane; buona parte della
scrittura no.

Lo scrivo perché è un'informazione che serve a chi valuta se usarlo o se
contribuire, non come vanto né come scusa:

- il codice è pubblico e **si può leggere prima di fidarsi** — le parti
  delicate (confronto degli schemi, generazione degli script, classificazione
  dei permessi SQL, protocollo MCP) sono funzioni pure coperte da test;
- Orabridge **non esegue mai da sé** uno script di modifica: DB Diff ed editor a
  nodi aprono sempre lo SQL in un foglio, dove lo si legge e lo si lancia a mano;
- valgono le limitazioni di responsabilità della [licenza](LICENSE): il software
  è fornito «così com'è», senza garanzie. Su un database di produzione, il
  backup e la lettura dello script prima di eseguirlo restano compito di chi li
  esegue.

I contributi assistiti dall'AI sono accettati alle stesse condizioni degli
altri: vedi [CONTRIBUTING.md](CONTRIBUTING.md).

## Licenza e marchi

Orabridge è distribuito sotto **[Apache License 2.0](LICENSE)**.
Copyright © 2026 Nichita Solonar.

I componenti di terze parti — a partire da **Oracle Instant Client**, incluso
nell'installer Windows e nell'immagine Docker — restano soggetti alle proprie
licenze, elencate in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). La
licenza Apache di Orabridge non concede alcun diritto su di essi.

**Marchi.** Orabridge è un progetto indipendente, **non affiliato a Oracle
Corporation, né sponsorizzato o approvato da essa**. Oracle, Oracle Database,
Oracle Instant Client e SQL\*Plus sono marchi o marchi registrati di Oracle e/o
delle sue affiliate. Microsoft, Windows, Visual Studio Code e GitHub Copilot
sono marchi del gruppo Microsoft; Docker è un marchio di Docker, Inc.; altri
nomi possono essere marchi dei rispettivi proprietari.

Questi nomi compaiono qui solo per **descrivere i sistemi con cui Orabridge
interopera** e per aiutare chi legge a capire a cosa serve: non implicano
alcun rapporto con i titolari dei marchi, e la licenza Apache 2.0 non concede
diritti sui marchi (§ 6).

Orabridge si collega ai database tramite
[node-oracledb](https://github.com/oracle/node-oracledb), il driver **open
source pubblicato da Oracle stessa** (Apache-2.0 oppure UPL-1.0, a scelta di chi
lo riceve). L'unico componente non open source in gioco è l'Oracle Instant
Client, incluso nell'installer Windows e nell'immagine Docker: viene scaricato
dai canali ufficiali di Oracle al momento della build ed è usato e ridistribuito
alle condizioni della licenza che Oracle gli dedica — vedi
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

L'uso di Oracle Database resta soggetto alle licenze che ciascuno ha con
Oracle: Orabridge è un client, non modifica in alcun modo quegli accordi.
