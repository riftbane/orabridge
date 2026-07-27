# Changelog

Tutte le modifiche rilevanti a Orabridge sono documentate qui. Le versioni sono allineate tra `client/`, `server/` ed `electron/` (stesso numero ovunque).

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
