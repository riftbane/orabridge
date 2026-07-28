# Changelog

Tutte le modifiche rilevanti a Orabridge sono documentate qui. Le versioni sono allineate tra `client/`, `server/` ed `electron/` (stesso numero ovunque).

## v1.17.2 — 2026-07-28

- **Fix:** i dati delle tabelle si vedono anche su Oracle 11g La paginazione del tab Dati usava OFFSET/FETCH NEXT, sintassi disponibile
solo da Oracle 12c: su 11g la SELECT falliva con ORA-00933 e il grid restava
vuoto. Ora la paginazione usa ROWNUM, compatibile con tutte le versioni.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

## v1.17.1 — 2026-07-28

- **Fix:** i modali non si chiudono più cliccando fuori Il click sullo sfondo chiudeva la finestra anche mentre si stava
lavorando, perdendo i dati inseriti. Ora i modali sono persistenti e si
chiudono solo dal pulsante di chiusura (o dai bottoni Annulla/Chiudi già
presenti): connessione, impostazioni, importa connessioni, password,
anteprima valore cella e i dialoghi DDL (tabelle e oggetti).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

- Build: [`Orabridge Setup 1.17.1.exe`](https://github.com/riftbane/orabridge/releases/download/v1.17.1/Orabridge%20Setup%201.17.1.exe) (2026-07-28).

## v1.17.0 — 2026-07-28

- **Nuovo:** guida dell'app consultabile da scheda e impostazioni Le funzioni erano documentate solo nel README del repository: chi usa
l'app installata non aveva modo di scoprirle. Ora c'è un manuale d'uso
dentro Orabridge, in due punti che mostrano lo stesso testo:

- una scheda dedicata (F1, o l'icona del libro accanto all'ingranaggio),
  con indice a sinistra, ricerca, collegamenti fra sezioni e navigazione
  avanti/indietro;
- Impostazioni -> Guida, in versione compatta, con il tasto per passare
  alla scheda a tutta area sulla sezione che si stava leggendo (la
  posizione è condivisa fra i due e viene ricordata).

Quattordici sezioni: primi passi, connessioni, esplorazione del
database, foglio SQL, editor (autocomplete, ricerca, formattazione),
griglia dei risultati, DDL guidata, DB Diff, assistente AI, cronologia,
scorciatoie, aggiornamenti e novità, dati e sicurezza, problemi
frequenti.

La sezione "Aggiornamenti e novità" riporta la versione installata e
come si aggiorna quella copia — testo diverso fra app desktop
(electron-updater: controllo all'avvio e ogni 4 ore) e client web — più
le novità delle ultime versioni. La scheda "Informazioni" mostra ora la
versione anche nel client web (prima diceva solo "Client web"), le
ultime tre novità e il rimando alla sezione completa.

Il testo sta in client/src/guide.js ed è Markdown reso dallo stesso
parser delle risposte dell'assistente, con due opzioni nuove in
AiMarkdown: collegamenti interni (#sezione) e a capo morbidi, perché il
sorgente della guida è mandato a capo a mano e deve comunque adattarsi
alla larghezza del pannello. Le risposte dell'assistente non cambiano.
La versione arriva nel bundle da vite.config.js (__APP_VERSION__).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

- Build: [`Orabridge Setup 1.17.0.exe`](https://github.com/riftbane/orabridge/releases/download/v1.17.0/Orabridge%20Setup%201.17.0.exe) (2026-07-28).

## v1.16.0 — 2026-07-28

- **Nuovo:** chiede la password quando manca o non è valida Connettendosi a una connessione senza password salvata (tipico dopo un
import senza chiave di cifratura) o con la password ormai cambiata sul
database, l'app apriva solo un toast di errore. Ora compare una finestra
che chiede la password: se il login riesce viene salvata sulla
connessione, così la volta dopo il doppio click basta da solo.

Il prompt è unico per tutta l'app (stato `passwordPrompt` nello store),
quindi vale per ogni punto da cui si avvia una connessione: doppio click
in sidebar, menu di contesto, pulsanti "Connetti" del foglio SQL, della
scheda oggetto e del pannello AI.

Lato server `POST /api/connections/:id/connect` accetta una password
opzionale nel body e la salva solo a login riuscito; segnala con
`needsPassword` i casi in cui ha senso richiederla (password non salvata,
ORA-01017/ORA-01005), lasciando invariati gli altri errori.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

- Build: [`Orabridge Setup 1.16.0.exe`](https://github.com/riftbane/orabridge/releases/download/v1.16.0/Orabridge%20Setup%201.16.0.exe) (2026-07-28).

## v1.15.0 — 2026-07-28

- **Nuovo:** tasto "Carica altro" nell'albero degli oggetti L'albero disegnava al massimo 300 nodi per cartella e chiudeva con
"…altri N (usa il filtro)", quindi la lista completa delle tabelle era
raggiungibile solo restringendo la ricerca. Ora al posto di quel testo
c'è un tasto "Carica altro (N)" che aggiunge 300 nodi per volta, fino a
mostrare tutti gli oggetti; il conteggio riparte da capo quando si
cambia filtro o si ricarica la cartella. Se il server ha davvero
troncato l'elenco (oltre 5000 oggetti) resta una nota esplicita al
posto del tasto, così non sembra che la lista sia completa.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

- Build: [`Orabridge Setup 1.15.0.exe`](https://github.com/riftbane/orabridge/releases/download/v1.15.0/Orabridge%20Setup%201.15.0.exe) (2026-07-28).

## v1.14.0 — 2026-07-28

- **Nuovo:** formattazione SQL più curata per Oracle Il formattatore lavorava bene sui blocchi PL/SQL ma lasciava intatte le
righe lunghe senza virgole al livello esterno e sbagliava alcune
costruzioni tipiche di Oracle.

- le righe troppo lunghe ora si spezzano a cascata: separatori del livello
  esterno, struttura di un CASE, concatenazioni `||` e infine apertura del
  gruppo di parentesi più esterno, così una DDL o una lista di argomenti
  lunga rientra invece di restare su una riga sola
- gli AND/OR dentro un CASE non vengono più scambiati per separatori della
  clausola che lo contiene (rientri scompaginati)
- il CASE istruzione (chiuso da END CASE) apre un blocco: rami WHEN/ELSE
  rientrati e END CASE su una riga sua
- una parola dopo il punto è un nome, non una parola chiave: `t.date` e
  `c.deferrable` non diventano più `t.DATE` e `c.DEFERRABLE`
- i due rami di un MERGE vanno entrambi a capo (il ramo WHEN MATCHED apre
  un UPDATE che nascondeva il MERGE nella pila)
- l'intestazione di un trigger resta su una riga invece di spezzarsi
  sull'evento (`BEFORE INSERT OR UPDATE ON t`)
- spazio prima della parentesi che segue il nome dell'oggetto in
  `CREATE TABLE t (…)`, `INSERT INTO t (…)`, `CREATE INDEX i ON t (…)`
- aggiunte le parole chiave BEFORE, AFTER e MATCHED

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

- Build: [`Orabridge Setup 1.14.0.exe`](https://github.com/riftbane/orabridge/releases/download/v1.14.0/Orabridge%20Setup%201.14.0.exe) (2026-07-28).

## v1.13.1 — 2026-07-28

- **Fix:** autocomplete senza corrispondenze sparse CodeMirror accettava anche le lettere digitate sparpagliate ovunque nel
nome: su uno schema con migliaia di oggetti "sele" proponeva
DBMS_SCHEDULER o SPRINT_ELEMENTS_OLD. I candidati vengono ora filtrati
nella sorgente prima di passarli a CodeMirror: restano i nomi che
contengono il testo digitato, quelli che ne ricalcano le iniziali delle
parole e quelli che lo si può leggere dall'inizio saltando di parola in
parola (wbsd -> WBS_DEFAULT_OWNER).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

- Build: [`Orabridge Setup 1.13.1.exe`](https://github.com/riftbane/orabridge/releases/download/v1.13.1/Orabridge%20Setup%201.13.1.exe) (2026-07-28).

## v1.13.0 — 2026-07-28

- **Nuovo:** decodifica opzionale delle entità HTML nella griglia I database popolati da applicativi web legacy contengono testo già
codificato (`Attivit&agrave; in corso`, spesso senza il `;` finale come
lo scrivevano i vecchi encoder): la griglia lo mostrava tale e quale,
rendendo illeggibili le descrizioni.

Nuovo pulsante `&→à` sopra i risultati del foglio SQL e sopra i dati di
una tabella: decodifica le entità (nomi Latin-1, punteggiatura
tipografica e riferimenti numerici) solo a video — celle, modale del
valore e copia della selezione. Ordinamento, editing ed export CSV
continuano a lavorare sul valore grezzo del database. La preferenza è
globale, persistita e spenta di default, perché la griglia deve mostrare
il dato com'è nel database finché non si chiede il contrario.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

- Build: [`Orabridge Setup 1.13.0.exe`](https://github.com/riftbane/orabridge/releases/download/v1.13.0/Orabridge%20Setup%201.13.0.exe) (2026-07-28).

## v1.12.6 — 2026-07-28

- **Fix:** nessun errore quando la release non ha ancora l'installer Se il workflow di rilascio ha già creato tag e release ma non ha ancora
pubblicato l'.exe e latest.yml, electron-updater falliva con
ERR_UPDATER_CHANNEL_FILE_NOT_FOUND e la scheda «Informazioni» mostrava un
muro di stack trace. Ora questi casi (canale/asset/versione non trovati)
vengono trattati come «nessun aggiornamento disponibile»; gli errori veri
(rete, ecc.) restano visibili ma ridotti alla sola prima riga.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

- Build: [`Orabridge Setup 1.12.6.exe`](https://github.com/riftbane/orabridge/releases/download/v1.12.6/Orabridge%20Setup%201.12.6.exe) (2026-07-28).

## v1.12.5 — 2026-07-28

- **Fix:** connessioni attive non visibili nei gruppi chiusi Con i gruppi chiusi non c'era modo di sapere dove fosse una connessione
aperta: l'intestazione mostrava solo il totale delle connessioni.

Ora accanto al conteggio del gruppo compare un badge verde con il numero
di connessioni attive (visibile anche a gruppo chiuso) e il bordo
sinistro del gruppo diventa verde quando ne contiene almeno una.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

- Build: [`Orabridge Setup 1.12.5.exe`](https://github.com/riftbane/orabridge/releases/download/v1.12.5/Orabridge%20Setup%201.12.5.exe) (2026-07-28).

## v1.12.4 — 2026-07-28

- **Fix:** chat AI, comandi che fallivano e turni che restavano appesi Le ricerche filtrate dell'assistente fallivano sempre con ORA-01745: il bind
del filtro di `list_objects` si chiamava `:like`, e `LIKE` è una parola
riservata Oracle, quindi ogni chiamata con un filtro veniva rifiutata dal
database. Il modello ripiegava sull'elenco completo dello schema — centinaia
di nomi per volta — e bruciava passi e contesto per niente. Il bind ora si
chiama `:flt` e le wildcard che il modello aggiunge di sua iniziativa vengono
tolte (la ricerca è sempre "contiene"). Un test controlla che nessun bind del
server si chiami come una parola riservata.

`describe_table` si fermava a "non esiste o non è leggibile" anche quando
l'oggetto c'era: se il nome è un sinonimo (proprio o pubblico) adesso lo
segue fino alla tabella vera e lo dichiara nell'intestazione; se il sinonimo
punta a un database link lo dice; se l'oggetto è di un altro tipo o sta in un
altro schema, il messaggio indica il tipo e gli schemi dove cercarlo invece
di lasciare il modello in un vicolo cieco.

Gli argomenti troncati non diventano più un oggetto vuoto: quando la risposta
si interrompe a metà del JSON, lo strumento partiva senza parametri e
combinava danni o restituiva errori incomprensibili. Ora la chiamata viene
respinta con un errore che chiede di ripeterla, e le chiamate senza i
parametri obbligatori vengono fermate prima di arrivare al database (o di
chiedere un'approvazione per un'istruzione vuota).

Sui turni appesi: se la piattaforma AI smette di rispondere a metà stream, la
lettura restava in attesa per sempre e la sessione sembrava piantata — ora
c'è un timeout di due minuti di silenzio che chiude il turno con un errore
leggibile. Le risposte tagliate dal limite di lunghezza vengono segnalate
invece di finire a metà frase senza spiegazione. Le chiamate annunciate ma
mai eseguite (limite di passi raggiunto, errore del provider) vengono chiuse
con un esito, così non restano con la rotellina accesa e non bloccano il
messaggio successivo. Il limite di passi per turno passa da 24 a 40, che era
troppo basso per un'indagine su un database vero.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

- Build: [`Orabridge Setup 1.12.4.exe`](https://github.com/riftbane/orabridge/releases/download/v1.12.4/Orabridge%20Setup%201.12.4.exe) (2026-07-28).

## v1.12.3 — 2026-07-28

- **Fix:** gruppi di connessioni chiusi all'avvio I gruppi nella barra laterale partivano tutti aperti a ogni avvio, così
bisognava chiuderli a mano per trovare la connessione giusta. Ora lo stato
tracciato è quello dei gruppi aperti, con default chiuso; "Senza gruppo"
resta aperto perché non è un vero gruppo (altrimenti chi non usa i gruppi
troverebbe la lista vuota). La ricerca continua a forzare l'apertura.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

- Build: [`Orabridge Setup 1.12.3.exe`](https://github.com/riftbane/orabridge/releases/download/v1.12.3/Orabridge%20Setup%201.12.3.exe) (2026-07-28).

## v1.12.2 — 2026-07-28

- **Fix:** chat AI che non si blocca più e risposte in Markdown completo Quattro problemi del pannello dell'assistente.

La chat si bloccava dopo un giro nelle impostazioni. Il pannello leggeva
chiavi, modelli e permessi una volta sola al primo montaggio: dopo aver
salvato una API key continuava a mostrare «Nessuna API key», la tendina dei
modelli restava vuota e la sessione non riusciva più a partire perché senza
modello selezionato l'invio veniva rifiutato. Ora alla chiusura delle
impostazioni il pannello rilegge la configurazione e richiede l'elenco
modelli alla piattaforma; se la sessione non ha un modello prende quello
predefinito (anche lato server, in `send`) e, quando non c'è, lo dice con un
avviso invece di limitarsi a rifiutare il messaggio.

La chat si bloccava anche in modo definitivo quando un turno si interrompeva
a metà: con lo Stop premuto mentre gli strumenti giravano, con
un'approvazione mai data o dopo un riavvio del server, restavano dei
`tool_use` senza il `tool_result` corrispondente e da lì in poi ogni
richiesta veniva rifiutata dal provider. Le chiamate scoperte adesso
vengono chiuse con un esito esplicito, inserito subito dopo il messaggio che
le ha aperte (nuovo `server/src/ai/toolPairing.js`, con test); lo Stop
interrompe davvero la coda invece di eseguire comunque le chiamate rimaste.

La tendina delle connessioni mostrava un pallino grigio anche per le
connessioni aperte, perché la classe usata per lo stato «connessa» non aveva
nessun colore. Ora il pallino è verde per le connessioni vive (guardando sia
lo stato locale sia quello riportato dal server), giallo mentre si collega e
rosso in errore, con le attive in cima all'elenco, la stessa indicazione sul
chip del composer e un avviso quando il database della sessione non è
collegato. Aggiunta anche la barra di ricerca che mancava, che filtra per
nome, utente, servizio, host e gruppo.

Le risposte, infine, erano rese da un mini-renderer che conosceva solo
titoli, elenchi puntati, grassetto e blocchi di codice: tabelle, elenchi
numerati, citazioni e collegamenti finivano a schermo come testo grezzo con
i simboli Markdown in mezzo. Il nuovo parser (`client/src/markdown.js`, con
test) copre titoli, paragrafi, elenchi annidati e con checkbox, citazioni,
righe orizzontali, tabelle GFM con allineamenti, collegamenti, codice
inline, grassetto/corsivo/barrato e blocchi recintati — compresi quelli non
ancora chiusi mentre la risposta è in streaming. Gli underscore dentro gli
identificatori (NOME_TABELLA) e `SELECT *` non vengono più scambiati per
corsivo. I blocchi di codice sono colorati (`client/src/codeTokens.js`,
riusando le parole chiave del formattatore SQL) e hanno «Copia» con
conferma e «Apri nel foglio».

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

- Build: [`Orabridge Setup 1.12.2.exe`](https://github.com/riftbane/orabridge/releases/download/v1.12.2/Orabridge%20Setup%201.12.2.exe) (2026-07-28).

## v1.12.1 — 2026-07-28

- **Fix:** mostra le modifiche già al primo riavvio dopo un aggiornamento Il client è buildato come PWA e il suo service worker precaricava la app
shell servendola dalla cache. Nell'app desktop il server locale espone
sempre la stessa origine (127.0.0.1:3000), quindi il service worker
sopravviveva agli aggiornamenti: al primo avvio dopo un update la finestra
riceveva ancora i file della versione precedente e il nuovo sw si limitava
ad aggiornare la cache in background, per cui le modifiche comparivano solo
al secondo riavvio.

Nel desktop la PWA non serve a niente (il server è in-process), quindi:
- il bundle preparato per Electron viene buildato con ORABRIDGE_TARGET=desktop,
  che esclude il plugin PWA (niente sw.js/registerSW.js); il build web/Docker
  resta invariato;
- all'avvio il main process cancella service worker, cache storage e cache HTTP
  della sessione prima di caricare la finestra, così vengono ripuliti anche i
  service worker già registrati dalle versioni precedenti.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

- Build: [`Orabridge Setup 1.12.1.exe`](https://github.com/riftbane/orabridge/releases/download/v1.12.1/Orabridge%20Setup%201.12.1.exe) (2026-07-28).

## v1.12.0 — 2026-07-27

- **Nuovo:** assistente AI multi-piattaforma, impostazioni e pannelli ridimensionabili Nuovo pannello di chat (icona ✨ o Ctrl+Alt+I) che lavora davvero sul
database: elenca schemi e oggetti, legge struttura, sorgenti e DDL, esegue
SELECT e istruzioni di modifica. Le piattaforme supportate sono OpenRouter,
Anthropic, Google Gemini e OpenAI, con elenco dei modelli letto in tempo
reale dalla piattaforma scelta e ricerca nella tendina. Le esecuzioni
passano dalla stessa sessione del foglio SQL, quindi vedono la transazione
aperta e non fanno mai commit da sole.

Più sessioni in parallelo, ognuna con la sua connessione, il suo modello e
i suoi permessi. Il ciclo dell'agente gira sul server e trasmette in
streaming via SSE: le sessioni continuano a lavorare in background anche a
pannello chiuso, cambiando scheda o ricaricando la pagina.

Permessi di esecuzione per sessione — Lettura, Scrittura e, a parte,
DELETE e DROP. Prima di eseguire, il server classifica l'istruzione e la
confronta con i permessi concessi; se non bastano mostra in chat l'SQL
esatto con «Consenti una volta / Consenti sempre / Rifiuta». La
classificazione ignora commenti e stringhe, ma nei blocchi PL/SQL guarda
anche dentro i letterali, dove si nasconde l'SQL dinamico. Le istruzioni
lanciate dall'assistente finiscono in cronologia, marcate.

Nuova finestra Impostazioni (Ctrl+, o l'ingranaggio in alto a destra) dove
si sceglie la piattaforma, si incolla la API key e si seleziona il modello
predefinito; ci è stata spostata anche la scheda «Informazioni» con la
verifica aggiornamenti. Le chiavi sono cifrate AES-256-GCM nella cartella
dati, come le password delle connessioni, e non arrivano mai al browser.

Barra laterale, risultati del foglio SQL e pannello AI ora si
ridimensionano trascinando il bordo (doppio clic per la misura
predefinita) e si nascondono dagli interruttori in alto a destra o con
Ctrl+B, Ctrl+J e Ctrl+Alt+I. Le misure vengono ricordate tra un avvio e
l'altro.

Nessuna dipendenza aggiunta: i quattro provider parlano HTTP con fetch
nativo e lo streaming arriva al browser via EventSource.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

- Build: [`Orabridge Setup 1.12.0.exe`](https://github.com/riftbane/orabridge/releases/download/v1.12.0/Orabridge%20Setup%201.12.0.exe) (2026-07-27).

## v1.11.0 — 2026-07-27

- **Nuovo:** ricerca in stile VS Code, formattazione del codice e gruppi di connessioni Ricerca e sostituzione rifatte in tutti gli editor (fogli SQL, sorgenti
PL/SQL, viste in sola lettura): barra flottante con Ctrl+F e Ctrl+H,
maiuscole/minuscole (Alt+C), parola intera (Alt+W), espressione regolare
(Alt+R), contatore "N di M", frecce di navigazione e riferimenti $1/$&
nella sostituzione. Con Alt+L (o aprendo la ricerca con più righe
selezionate) le ricerche restano dentro l'area evidenziata.

Formattazione del codice con Ctrl+Maiusc+F sulla selezione e Ctrl+Alt+F
su tutto il foglio. Il formattatore riconosce i blocchi PL/SQL oltre alle
clausole SQL e prima di applicare il risultato ritokenizza l'output e lo
confronta con l'ingresso: se qualcosa non torna il testo resta invariato.

Nella barra laterale la sezione "Attivi" è stata rimossa, ogni gruppo ha
ora un colore stabile ricavato dal nome, e il tasto destro su una
connessione apre un menu con "Sposta in…" per cambiarle gruppo (o
crearne uno nuovo) senza aprire finestre.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

- Build: [`Orabridge Setup 1.11.0.exe`](https://github.com/riftbane/orabridge/releases/download/v1.11.0/Orabridge%20Setup%201.11.0.exe) (2026-07-27).

## v1.10.0 — 2026-07-27

- **Nuovo:** confronto fra due database con script di sincronizzazione Aggiunge DB Diff, sul modello di SQL Developer: si scelgono due schemi —
anche sulla stessa connessione — e si ottiene l'elenco degli oggetti solo in
origine, solo in destinazione o diversi, con il dettaglio delle differenze e
lo script DDL che allinea la destinazione.

- `server/src/diff/snapshot.js` legge uno schema con poche query bulk sul
  dizionario (una per vista, non una per oggetto)
- `server/src/diff/compare.js` confronta i due snapshot: i vincoli e gli
  indici con nome generato dal sistema si accoppiano per definizione invece
  che per nome, i riferimenti allo schema di origine valgono come quelli
  alla destinazione, indentazione e righe vuote si possono ignorare
- `server/src/diff/script.js` genera CREATE/ALTER (e i DROP solo su
  richiesta) dagli snapshot, senza DBMS_METADATA: funziona anche con
  privilegi minimi ed è una funzione pura
- `/api/diff` sta fuori da `/api/conn/:id` perché tocca due connessioni
  insieme; tiene in memoria le ultime fotografie, così dettaglio e script
  non rileggono il dizionario
- client: scheda DB Diff con elenco filtrabile e selezionabile, confronto
  affiancato riga per riga (algoritmo di Myers in `client/src/textDiff.js`)
  e script apribile in un foglio SQL sulla connessione di destinazione

Lo script viene solo generato: va riletto ed eseguito a mano.

Test: 18 sul motore di confronto (server), 9 sul diff testuale (client).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

- Build: [`Orabridge Setup 1.10.0.exe`](https://github.com/riftbane/orabridge/releases/download/v1.10.0/Orabridge%20Setup%201.10.0.exe) (2026-07-27).

## v1.9.0 — 2026-07-27

- **Nuovo:** completamento SQL consapevole del contesto L'autocomplete dell'editor ora capisce in che clausola si trova il cursore e
ordina i suggerimenti di conseguenza, in sezioni distinte (colonne, tabelle,
funzioni, parole chiave…): dopo FROM vengono prima le tabelle, dentro
SELECT/WHERE prima le colonne.

Novità principali:

- colonne con tipo, NOT NULL e PK; l'analizzatore riconosce anche le CTE del
  WITH, le subquery in FROM, le liste con virgole e MERGE/UPDATE/INSERT
- altri schemi caricati al volo scrivendo "ALTRO_SCHEMA."; risoluzione dei
  sinonimi verso lo schema di destinazione
- condizioni di join ricavate dalle foreign key: dopo JOIN propone la tabella
  collegata già completa di alias e ON, dentro ON la sola condizione
- espansione di "*" e "alias.*" nell'elenco delle colonne
- funzioni built-in di Oracle con firma, package (membri inclusi), sequenze
  con NEXTVAL/CURRVAL, procedure e funzioni dello schema
- i nomi seguono lo stile di chi scrive: prefisso in minuscolo -> nomi e
  parole chiave inseriti in minuscolo
- Tab accetta il suggerimento

La rotta /autocomplete restituisce ora anche tipi delle colonne, chiavi
primarie, foreign key, package/procedure/funzioni, sequenze e sinonimi.

Aggiunti test (node --test, "npm test" dentro client/) per l'analizzatore
SQL e per la sorgente di completamento.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

- Build: [`Orabridge Setup 1.9.0.exe`](https://github.com/riftbane/orabridge/releases/download/v1.9.0/Orabridge%20Setup%201.9.0.exe) (2026-07-27).

## v1.8.0 — 2026-07-27

- **Nuovo:** aggiunge barra di ricerca per le connessioni Filtra le connessioni per nome, gruppo, utente o servizio; durante la
ricerca i gruppi vengono espansi automaticamente per mostrare i
risultati.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

- Build: [`Orabridge Setup 1.8.0.exe`](https://github.com/riftbane/orabridge/releases/download/v1.8.0/Orabridge%20Setup%201.8.0.exe) (2026-07-27).

## v1.7.0 — 2026-07-27

- **Nuovo:** importa connessioni da export JSON di SQL Developer Aggiunge un'importazione guidata delle connessioni a partire da file di
export JSON di SQL Developer: anteprima con selezione, gruppo opzionale
da assegnare a tutte, mappatura automatica per connessioni BASIC (SID o
service name) e TNS (alias, con avviso perché serve un tnsnames.ora
raggiungibile). Le password cifrate con chiave vengono decifrate
server-side con lo stesso schema usato da SQL Developer per l'export
"Cifra tutte le password con una chiave" (PBKDF2-HMAC-SHA256 + AES-256-CBC),
poi ri-cifrate con lo schema già in uso per connections.json. Chiave
sbagliata blocca l'intero import senza scrivere nulla.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

- Build: [`Orabridge Setup 1.7.0.exe`](https://github.com/riftbane/orabridge/releases/download/v1.7.0/Orabridge%20Setup%201.7.0.exe) (2026-07-27).

## v1.6.0 — 2026-07-27

- **Nuovo:** raggruppamento connessioni e stato al posto del colore Sostituisce la selezione manuale del colore per ogni connessione con un
campo "Gruppo" (con suggerimenti dai gruppi esistenti): la lista delle
connessioni in barra laterale ora è raggruppabile e mostra sempre in
cima una sezione "Attivi" con le connessioni già aperte, per accesso
rapido.

Il vecchio pallino colorato diventa un indicatore di stato della
connessione: grigio (non connessa), arancione (in connessione), verde
(connessa), rosso (errore, con messaggio al passaggio del mouse).

Rimosso il bottone di accensione: doppio click su una connessione non
attiva la apre, singolo click non fa nulla; su una connessione già
attiva il singolo click apre/chiude l'albero degli oggetti come prima,
e una nuova azione "Disconnetti" nella riga sostituisce il vecchio
bottone a spina per chiuderla.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

- Build: [`Orabridge Setup 1.6.0.exe`](https://github.com/riftbane/orabridge/releases/download/v1.6.0/Orabridge%20Setup%201.6.0.exe) (2026-07-27).

## v1.5.2 — 2026-07-27

- **Fix:** includi preload.cjs nel pacchetto Electron electron/package.json limitava "files" a main.cjs e build/icon.ico:
electron-builder, quando "files" non e' vuoto ne' fatto solo di pattern di
esclusione, non applica piu' l'inclusione di default **/*, quindi
preload.cjs restava fuori dall'asar. Senza preload, contextBridge non gira
mai e window.orabridge resta undefined: il pannello "Informazioni"
mostrava sempre "Client web" senza versione ne' bottone "Verifica
aggiornamenti", anche nell'installer v1.5.1 dove quella funzionalita' era
gia' stata aggiunta.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

- Build: [`Orabridge Setup 1.5.2.exe`](https://github.com/riftbane/orabridge/releases/download/v1.5.2/Orabridge%20Setup%201.5.2.exe) (2026-07-27).

## v1.5.1 — 2026-07-27

- **Fix:** elimina la doppia GitHub Release creata da electron-builder electron-builder risolve la configurazione di publish da più punti interni
(pubblicazione artefatti principale vs generazione di latest.yml per
electron-updater) e, se nessuna release esiste ancora per il tag, ciascuno di
questi può decidere in parallelo di crearne una: risultato, due release
duplicate per lo stesso tag con gli asset (exe, blockmap, latest.yml) sparsi
in modo incoerente tra le due. prepare-release.mjs ora precrea la release
(vuota) subito dopo aver pushato il tag, cosi' electron-builder la trova
sempre gia' esistente e vi carica solo gli asset sopra, senza race.

feat(desktop): pannello "Informazioni" con verifica manuale aggiornamenti

Aggiunge un bottone nella sidebar che apre le info sull'app (versione) e
permette di forzare un controllo aggiornamenti; usa lo stesso electron-updater
gia' collegato in background, tramite un preload.cjs con contextBridge
(main.cjs trasmette lo stato — checking/available/downloading/downloaded/
errore — al renderer via IPC). Al termine del download parte comunque la
finestra di conferma nativa per riavviare e installare, per non chiudere
l'app a sorpresa con fogli SQL o transazioni aperte.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

- Build: [`Orabridge Setup 1.5.1.exe`](https://github.com/riftbane/orabridge/releases/download/v1.5.1/Orabridge%20Setup%201.5.1.exe) (2026-07-27).

## v1.5.0 — 2026-07-27

- Migliorata: tutte le icone dell'interfaccia (modifica, elimina, cronologia,
  chiudi, esegui/script/annulla, compila, ricarica, esito connessione/DDL,
  ordinamento griglia, ecc.) usavano glifi emoji (✎ 🗑 🕘 ✕ ✓ ✗ ⚙ ⚠ ▶ ⏵⏵ ■ ▲▼
  ↑ ↺ ⟳ ▸ ＋ ⏻), che cambiano aspetto e allineamento a seconda del sistema/
  font e non seguono il colore del testo circostante. Sostituite con icone
  SVG monocromatiche di [lucide-react](https://lucide.dev), coerenti in ogni
  ambiente e che ereditano il colore (incluso lo stato hover/danger dei
  pulsanti). Nessun cambiamento funzionale.
- Build: nessun installer pubblicato per questa versione (release manuale
  pre-automazione); la prima build scaricabile da GitHub Releases è la v1.6.0.

## v1.4.0 — 2026-07-24

- Nuovo: cronologia query. A differenza di quella di SQL Developer (che a
  volte perde delle istruzioni, es. dopo un crash o tra una sessione e
  l'altra), ogni istruzione eseguita da un foglio SQL — comprese quelle di
  uno script, di un dialogo DDL guidato o di una modifica dati dalla griglia
  — viene registrata subito lato server in `data/history.json`, quindi
  sopravvive a riavvii dell'app e a fogli chiusi senza salvare. Si apre con
  la nuova icona 🕘 nell'intestazione della sidebar (cronologia di tutte le
  connessioni) o dal pulsante "🕘 Cronologia" nella toolbar del foglio SQL
  (già filtrata sulla connessione corrente). Ogni voce mostra esito
  (✓/✗ con eventuale messaggio d'errore), orario, connessione, istruzione
  (espandibile se su più righe), righe restituite/interessate e tempo di
  esecuzione; si può cercare per testo, filtrare per connessione, copiare
  una voce negli appunti o riaprirla in un nuovo foglio SQL pronta per
  essere eseguita. Cancellazione manuale (per connessione o totale) dalla
  stessa vista; la cronologia tiene comunque solo le ultime 3000 voci per
  non crescere all'infinito.
- Build: `electron/release/Orabridge Setup 1.4.0.exe` (2026-07-24).

## v1.3.0 — 2026-07-24

- Nuovo: dialogo unico "Modifica tabella", sul modello di SQL Developer ma più
  pulito. Sostituisce i vecchi pulsanti sparsi (＋ Colonna, Modifica colonna,
  Elimina colonna, ＋ Vincolo, Elimina vincolo, ＋ Indice, Elimina indice,
  Rinomina tabella…) con un unico pannello raggiungibile dal pulsante
  "✎ Modifica tabella" nella vista di dettaglio o dalla voce "Modifica…" nel
  menu contestuale dell'albero oggetti (tasto destro su una tabella). A
  sinistra una navigazione a schede — Colonne, Vincoli, Indici, Commento —
  più un campo "Nome" sempre visibile per rinominare la tabella:
  - **Colonne**: griglia con tutte le colonne esistenti modificabili sul
    posto (tipo, dimensione/scala, NOT NULL, default, commento, casella PK),
    più aggiunta di nuove colonne ed eliminazione di quelle esistenti
    (con annulla); la casella PK è una scorciatoia che genera da sola il
    DROP/ADD del vincolo di chiave primaria quando cambia l'insieme delle
    colonne segnate.
  - **Vincoli**: elenco dei vincoli esistenti con eliminazione, più
    creazione guidata di Primary Key/Unique/Foreign Key/Check.
  - **Indici**: elenco degli indici esistenti con eliminazione, più
    creazione guidata scegliendo le colonne (comprese quelle appena
    aggiunte, non ancora salvate).
  - **Commento**: commento sulla tabella (COMMENT ON TABLE).
  Ogni modifica (comprese quelle pendenti in più schede insieme) confluisce
  in un'unica anteprima SQL ordinata correttamente — aggiunte colonne,
  modifiche, commenti, vincoli da togliere/aggiungere, colonne da
  eliminare, indici da togliere/aggiungere, commento tabella, rinomina in
  fondo — eseguita in sequenza con un solo click su "Applica", con
  CASCADE CONSTRAINTS opzionale quando si eliminano colonne.
- Build: `electron/release/Orabridge Setup 1.3.0.exe` (2026-07-24).

## v1.2.0 — 2026-07-24

- Nuovo: modifica dei dati direttamente dalla griglia, senza modale. Nel tab "Dati" di una tabella, doppio click su una cella la mette in modifica; Invio (o click altrove) conferma, Esc annulla. La cella e l'intera riga modificate restano evidenziate finché non si fa Commit o Rollback (nuovi pulsanti nella toolbar del tab), così è sempre chiaro cosa è cambiato prima di rendere permanente la modifica. Funziona anche con un filtro "WHERE" applicato. La riga viene individuata tramite ROWID (non serve una chiave primaria) e l'UPDATE gira sulla stessa sessione dedicata del foglio SQL: commit/rollback sono condivisi con eventuali fogli aperti sulla stessa connessione. Editabili le colonne di tipo testo, numerico, DATE/TIMESTAMP e CLOB/NCLOB (non troncati in anteprima); tutte le altre restano di sola lettura con il vecchio doppio click "visualizza valore".
- Build: `electron/release/Orabridge Setup 1.2.0.exe` (2026-07-24).

## v1.1.0 — 2026-07-24

- Fix: nella griglia risultati (tab "Dati" e "Colonne") non era possibile selezionare più celle trascinando il mouse, né selezionare tutto con Ctrl+A — il testo appariva evidenziato in blu solo per via della selezione nativa del browser, non gestita dall'app. Ora `Grid.jsx` supporta selezione a intervallo (drag del mouse), Ctrl+A per selezionare tutte le celle caricate, e Ctrl+C copia l'intervallo selezionato come TSV (compatibile Excel).

## v1.0.0 — 2026-07-24

- Prima versione: connessione Oracle via TNS, sessione dedicata per fogli SQL + pool per metadata, editor SQL/PLSQL con autocomplete colonne, browser oggetti (tabelle/viste/indici/ecc.), DDL guidato, PL/SQL con DBMS Output, export CSV, build desktop Electron per Windows (thick mode con Instant Client incluso).
