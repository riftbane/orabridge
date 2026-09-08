// Contenuto della guida in-app.
//
// Le sezioni sono testo Markdown: vengono rese con lo stesso parser delle
// risposte dell'assistente (`markdown.js` + `AiMarkdown.jsx`), così la guida
// non porta dipendenze nuove e resta un unico posto da aggiornare — la stessa
// sorgente alimenta la scheda «Guida» e la sezione nelle impostazioni.
//
// Ogni sezione: { id, title, summary, md }. `buildGuide` esiste perché la
// sezione sugli aggiornamenti cita la versione installata e il tipo di
// installazione (desktop o web), che si conoscono solo a runtime.

const SECTIONS = [
  {
    id: 'intro',
    title: 'Primi passi',
    summary: "Com'è fatta l'area di lavoro e da dove si comincia.",
    md: `
Orabridge è un client per database Oracle: fogli SQL, esplorazione dello schema,
DDL guidato, confronto fra database e un assistente AI che lavora davvero sul
database. Gira come app desktop per Windows, come applicazione web (Docker) e
come PWA installabile dal browser: le funzioni sono le stesse ovunque.

## L'area di lavoro

| Zona | A cosa serve |
|---|---|
| **Barra delle attività** (estrema sinistra) | Le tre viste della barra laterale |
| **Barra laterale** | Connessioni, contenuto del database, ricerca nel codice |
| **Schede** (in alto) | Fogli SQL, oggetti aperti, Cronologia, DB Diff, Monitor DBA, questa guida |
| **Pannello dei risultati** (in basso) | Risultati, messaggi, piano di esecuzione, log dello script, DBMS Output |
| **Assistente AI** (destra) | Chat che interroga e modifica il database su richiesta |

La striscia di icone all'estrema sinistra funziona come la barra delle attività
di VS Code: sceglie **cosa** mostra la barra laterale, e resta visibile anche
quando la barra è chiusa (l'icona la riapre sulla vista che serve).

| Vista | Cosa contiene |
|---|---|
| **Connessioni** (\`Ctrl+Maiusc+D\`) | L'elenco delle connessioni salvate, coi gruppi |
| **Connessione** (\`Ctrl+Maiusc+E\`) | Tutto di una sola connessione: stato, azioni, schema e albero degli oggetti |
| **Ricerca nel codice** (\`Ctrl+Maiusc+F\`) | Cerca dentro il PL/SQL di tutto il database (vedi [Ricerca nel codice](#ricerca)) |

Cliccando l'icona della vista già aperta la barra laterale si chiude — come
\`Ctrl+B\`.

I comandi generali (nuova connessione, importazione, cronologia, DB Diff,
interruttori dei pannelli, guida, impostazioni) stanno **nella striscia in
alto**: nell'app desktop è la barra del titolo della finestra, nel client web
sono divisi fra la cima della barra laterale e il fondo della barra delle
schede.

I tre pannelli si nascondono con gli interruttori in alto a destra
(\`Ctrl+B\`, \`Ctrl+J\`, \`Ctrl+Alt+I\`) e si ridimensionano trascinandone il
bordo: **doppio clic sul bordo** riporta il pannello alla misura predefinita.
La disposizione, le schede aperte e il testo dei fogli SQL vengono ricordati e
si ritrovano al riavvio.

## Da zero al primo risultato

1. Crea una connessione con **＋** fra i comandi in alto (vedi
   [Connessioni](#connessioni)).
2. **Doppio clic** sulla connessione per collegarti: il pallino diventa verde e
   sotto compare l'albero degli oggetti.
3. Apri un foglio SQL con il **＋** che compare sulla riga della connessione
   (o dal menu con il tasto destro).
4. Scrivi la query ed esegui con \`Ctrl+Invio\`.

> Da fare una volta sola: se vuoi usare l'assistente AI serve una API key,
> da incollare in **Impostazioni → Assistente AI** (\`Ctrl+,\`).
`,
  },
  {
    id: 'connessioni',
    title: 'Connessioni',
    summary: 'Creare, organizzare, importare e proteggere le connessioni.',
    md: `
Le connessioni sono salvate sul server di Orabridge (non nel browser) e restano
disponibili ai riavvii. Le password sono cifrate con AES-256-GCM.

## Creare una connessione

**＋** fra i comandi in alto. I campi:

- **Nome** — come compare nell'elenco (es. \`DEV — HR\`).
- **Gruppo** — cartella in cui raccoglierla (facoltativo, con suggerimento dei
  gruppi già esistenti).
- **Host** e **Porta** — porta 1521 se non sai cosa mettere.
- **Tipo**: *Service name*, *SID*, *TNS (tnsnames.ora)* oppure *Connect string*
  — quest'ultimo accetta sia \`host:1521/servizio\` sia un descrittore TNS
  completo (\`(DESCRIPTION=(ADDRESS=…))\`), utile per RAC e failover.
  Scegliendo *TNS*, host e porta spariscono e compare l'elenco degli alias
  letti da \`tnsnames.ora\`: la cartella è quella di \`TNS_ADMIN\`, e si può
  indicarne un'altra. Sotto l'alias scelto viene mostrato dove punta.
- **Utente** e **Password**.

### Opzioni avanzate

Sono chiuse di default — una connessione normale non ha bisogno di vederle.

- **Ruolo**: *Normale*, **SYSDBA** o **SYSOPER**, per le connessioni
  amministrative.
- **Utente proxy**: ci si collega come \`proxy[utente]\`, cioè autenticandosi
  con le credenziali del proxy per lavorare come un altro utente — è il modo
  in cui molte organizzazioni evitano di distribuire le password applicative.
- **Wallet**: cartella del wallet Oracle e, se serve, la sua password (salvata
  cifrata come le altre e mai restituita al client).
- **Connessione in sola lettura**: Orabridge **rifiuta lato server** tutto ciò
  che non è un'interrogazione — INSERT, UPDATE, DELETE, MERGE, DDL, e anche
  \`SELECT … FOR UPDATE\`, che blocca le righe. Nell'interfaccia spariscono i
  pulsanti che scrivono (modifica delle celle, righe nuove, Commit, terminare
  una sessione dal monitor DBA) e accanto al nome della connessione compare
  l'etichetta *sola lettura*. È la spunta da mettere sulle connessioni di
  produzione che si aprono «solo per guardare».

**Testa** prova la connessione senza salvarla: risponde con la versione del
server se il login riesce, con l'errore Oracle se fallisce.

## Connettersi

**Doppio clic** sulla connessione (o *Connetti* dal menu con il tasto destro).
Il pallino a sinistra dice come sta andando:

- grigio — non connessa; verde — connessa; giallo — connessione in corso;
  rosso — ultimo tentativo fallito (il messaggio si legge passandoci sopra).

Se la password non è stata salvata, o non è più valida, Orabridge **la chiede al
momento** invece di limitarsi a mostrare l'errore: appena il login riesce viene
salvata sulla connessione.

Sotto la connessione può comparire l'etichetta **«transazione aperta»**: ci sono
modifiche non ancora confermate, si chiude con commit o rollback dal foglio SQL
(vedi [Foglio SQL](#foglio)).

## Organizzare l'elenco

- **Gruppi**: tasto destro su una connessione → *Sposta in…* per spostarla in un
  gruppo esistente, toglierla dal gruppo o crearne uno nuovo. I gruppi si
  aprono e chiudono con un clic; quelli chiusi mostrano comunque quante
  connessioni attive contengono.
- **Cerca connessioni…**, sotto l'intestazione: filtra per nome, gruppo, utente
  o servizio, e mostra anche i gruppi chiusi che contengono un risultato.
- Dal menu contestuale: *Nuovo foglio SQL*, *Esplora nella vista Connessione*,
  *Cerca nel codice…*, *Connetti* / *Disconnetti*, *Modifica…*, *Elimina…*.

Un clic su una connessione la rende quella **selezionata** (barretta arancione a
sinistra): è quella su cui lavorano la vista *Connessione* e la *Ricerca nel
codice*. Il **doppio clic** su una connessione già attiva porta direttamente
alla vista *Connessione*.

## Importare da SQL Developer

L'icona di importazione (la freccia verso l'alto, fra i comandi in alto)
apre la procedura guidata: si sceglie il file **.json** esportato da SQL
Developer, si vede l'elenco delle connessioni trovate e si spunta quali
importare. Si può assegnare un **gruppo** a tutte le connessioni importate in un
colpo solo.

Se qualcuna delle connessioni scelte ha la password salvata, va inserita la
**chiave di cifratura** usata al momento dell'export (chiesta due volte per
evitare refusi): se non è quella giusta l'importazione si ferma con un errore e
non viene creato niente. Le connessioni senza password vengono importate così
come sono, e la password viene chiesta al primo collegamento.

Il triangolo di avviso accanto a una riga segnala quello che non si trasferisce
in automatico: gli **alias TNS** funzionano se un \`tnsnames.ora\` con quella
voce è raggiungibile da Orabridge — si ritrovano nel tipo *TNS* — mentre i
**ruoli** (SYSDBA e simili) vanno riscelti a mano fra le opzioni avanzate.
`,
  },
  {
    id: 'albero',
    title: 'Esplorare il database',
    summary: 'Albero degli oggetti, filtri, altri schemi e schede di dettaglio.',
    md: `
L'albero degli oggetti si trova in due posti: sotto ogni connessione attiva
nella vista **Connessioni**, e a tutta altezza nella vista **Connessione**
(\`Ctrl+Maiusc+E\`), che mostra una connessione sola per volta. Le cartelle sono
le stesse: **Tabelle, Viste, Viste materializzate, Indici, Sequenze, Procedure,
Funzioni, Package, Package Body, Trigger, Tipi, Sinonimi**, poi **DB Link, Job
dello scheduler, Code AQ** e il **Cestino**; sotto, il gruppo **Database** con
quello che non appartiene a uno schema — **Directory, Utenti, Ruoli,
Tablespace, Sinonimi pubblici, Edition** — e infine **Altri utenti**.

## La vista «Connessione»

Raccoglie tutto quello che riguarda il database selezionato:

- il **selettore in cima** per passare a un'altra connessione;
- utente, servizio, versione di Oracle e schema di lavoro;
- i comandi rapidi: *Cerca nel codice*, *Cronologia*, *Confronta*,
  *Disconnetti*, e **＋** per un nuovo foglio SQL;
- un **selettore di schema**: l'albero mostra lo schema scelto, senza passare
  dalla cartella *Altri utenti*.

- **Doppio clic** su un oggetto lo apre in una scheda.
- Il campo **Filtra oggetti…** in cima all'albero filtra tutte le cartelle
  aperte.
- Ogni cartella disegna 300 oggetti per volta: il tasto **«Carica altro (N)»**
  in fondo ne aggiunge altri 300 fino a mostrarli tutti. Se lo schema supera i
  5000 oggetti di una categoria l'elenco viene troncato dal server e al posto
  del tasto compare una nota esplicita.
- Un **pallino** accanto al nome segnala un oggetto non valido (\`INVALID\`):
  tipico dei package da ricompilare.
- **Altri utenti** elenca gli altri schemi visibili all'utenza: aprendone uno si
  ottiene lo stesso albero completo.
- Icona **↻** sulla cartella per ricaricarne il contenuto, **＋** per creare un
  nuovo oggetto di quel tipo (vedi [Creare e modificare oggetti](#oggetti)).
- **Tasto destro** su un oggetto: *Elimina…* apre il drop guidato.

## Il cestino

La cartella **Cestino** elenca le tabelle eliminate ma ancora recuperabili
(quelle con il nome \`BIN$…\`), con il nome originale e la data. Dal menu
contestuale:

- **Ripristina** esegue \`FLASHBACK TABLE … TO BEFORE DROP\`, con la
  possibilità di darle un nome nuovo se nel frattempo ne è nata un'altra con
  quello vecchio;
- **Elimina definitivamente** esegue il \`PURGE\`, e **Svuota il cestino** lo
  fa per tutto lo schema. Sono irreversibili, quindi chiedono conferma.

Dopo un ripristino l'albero e l'autocomplete si aggiornano da soli.

## Sinonimi pubblici

Su un database vero sono decine di migliaia: la cartella non li scarica tutti,
ma passa al server quello che si scrive nel campo **Filtra oggetti…**. Se
l'elenco resta troncato, la nota in fondo lo dice.

## Schede di dettaglio

Quello che si vede dipende dal tipo di oggetto:

| Tipo | Schede |
|---|---|
| Tabella, vista materializzata | Colonne, Dati, Vincoli, Indici, Statistiche, Partizioni, Trigger, Dipendenze, Permessi, DDL |
| Vista | Colonne, Dati, Dipendenze, Permessi, DDL |
| Procedura, funzione, package, trigger, tipo | Sorgente, Dipendenze, Permessi, DDL |
| Sequenza, sinonimo | Dettagli, Permessi, DDL |
| Indice | Dettagli, Statistiche, DDL |
| DB link, job, coda, directory, utente, ruolo, tablespace, edition | Dettagli e le schede proprie del tipo |

- **Statistiche** riporta quello che l'ottimizzatore sa della tabella: numero
  di righe, blocchi, lunghezza media, campionamento e soprattutto l'**ultima
  analisi** — se è vecchia di mesi, i piani di esecuzione sbagliati hanno già
  una spiegazione. L'interruttore *Colonne* passa alle statistiche di ogni
  singola colonna (valori distinti, nulli, densità).
- **Partizioni** elenca le partizioni con il valore alto, il tablespace e le
  righe; cliccandone una si vedono le sottopartizioni. Su una tabella non
  partizionata resta vuota.
- **Dipendenze** ha due direzioni: *Usa* (da cosa dipende l'oggetto) e *Usato
  da* (chi si romperebbe cambiandolo).
- **Permessi** elenca chi ha ricevuto quali privilegi sull'oggetto, comprese le
  concessioni su singole colonne.

- **Dati** mostra il contenuto a pagine, con un campo **WHERE** per filtrare
  (\`Invio\` applica), **Conta** per il totale delle righe, **Carica altre** per
  la pagina successiva, l'**esportazione** in tutti i formati e, sulle tabelle,
  **Importa…** per caricare un CSV o un file Excel. Sulle tabelle le righe si
  **modificano, aggiungono ed eliminano** (vedi
  [Griglia dei risultati](#griglia)).
- **Sorgente** è un editor vero: si modifica il PL/SQL e si ricompila con
  **Compila** (\`Ctrl+Invio\`). Gli errori di compilazione arrivano da
  \`ALL_ERRORS\` e sono cliccabili: portano alla riga giusta. **Ricarica**
  rilegge dal database e scarta le modifiche non compilate.
- **DDL** è il sorgente completo generato da \`DBMS_METADATA\`.
`,
  },
  {
    id: 'ricerca',
    title: 'Ricerca nel codice',
    summary: 'Cercare un testo dentro il PL/SQL di tutto il database.',
    md: `
La terza vista della barra laterale (\`Ctrl+Maiusc+F\`, o l'icona della lente)
cerca **dentro il sorgente PL/SQL** del database: procedure, funzioni, trigger e
package body, e su richiesta anche le specifiche dei package e i tipi. È la
risposta a «dove viene usata questa tabella?», «chi chiama questa procedura?»,
«dov'è quel messaggio di errore?».

## Come si cerca

Nel campo di ricerca, con i tre interruttori a destra — gli stessi della ricerca
nell'editor:

- **Aa** — distingue maiuscole e minuscole (di default no);
- **parola intera** — ignora \`v_saldo\` se stai cercando \`saldo\`;
- **.\\*** — espressione regolare.

\`Invio\` (o **Cerca**) lancia la ricerca.

> Le espressioni regolari sono quelle di **Oracle** (\`REGEXP_LIKE\`), non quelle
> di JavaScript: valgono le classi POSIX come \`[[:alpha:]]\`. Se la sintassi non
> è valida risponde il database, con il suo \`ORA-\`.

## Dove si cerca

L'icona dei cursori in alto a destra mostra e nasconde **ambito e tipi**:

| Ambito | Cosa scandisce |
|---|---|
| **Schema di lavoro** | Solo lo schema della sessione (predefinito, il più veloce) |
| **Tutti gli schemi applicativi** | Tutto il database tranne gli schemi di Oracle (\`SYS\`, \`SYSTEM\`, \`XDB\`, \`APEX_*\`…) |
| **Tutti, compresi quelli di Oracle** | Proprio tutto: lento, serve solo per indagare sui componenti del database |
| **Un solo schema** | Lo schema scelto dall'elenco |

Le **etichette dei tipi** (Procedure, Funzioni, Trigger, Package body, Package
(spec), Tipi, Type body) si accendono e si spengono con un clic: meno tipi,
meno righe da scandire.

## I risultati

Sono raggruppati per oggetto, con il numero di righe trovate; il nome dello
schema è a fianco. **Un clic su una riga apre l'oggetto nella scheda Sorgente,
salta a quella riga e seleziona il testo trovato** — da lì lo si può modificare
e ricompilare come sempre.

- La ricerca si ferma a **1000 righe**: se compare *«limite raggiunto»*
  restringi l'ambito o i tipi.
- Una ricerca su tutto il database che superi i **due minuti** viene interrotta:
  Oracle deve leggere il sorgente riga per riga, non esiste un indice.
- Si vede solo il codice che l'utenza può leggere (\`ALL_SOURCE\`), e gli oggetti
  **wrapped** contengono solo testo cifrato: cercarci dentro non ha senso.
- Cambiando connessione l'elenco si svuota: i risultati appartengono al database
  su cui sono stati cercati.
`,
  },
  {
    id: 'foglio',
    title: 'Foglio SQL',
    summary: 'Eseguire istruzioni e script, transazioni, risultati e DBMS Output.',
    md: `
Un foglio SQL è legato a una connessione e ha una **sessione dedicata**: la
transazione resta aperta fra un'esecuzione e l'altra, come in SQL*Plus.

## Eseguire

- **Esegui** (\`Ctrl+Invio\` o \`F9\`) esegue l'istruzione su cui si trova il
  cursore, oppure il testo selezionato.
- **Script** (\`F5\`) esegue tutto il foglio, istruzione per istruzione, e
  registra l'esito di ognuna nella scheda *Script*.
- **Piano** mostra il piano di esecuzione dell'istruzione corrente (vedi
  [Piano e autotrace](#piano)).
- **Annulla** interrompe una query in corso (compare solo durante l'esecuzione).
- **Righe max** limita quante righe vengono riportate (da 100 a 10000): se il
  risultato è più lungo il conteggio è marcato con \`+\`.

Le istruzioni si separano con \`;\`. I blocchi PL/SQL (\`DECLARE\`, \`BEGIN\`,
\`CREATE PROCEDURE\`…) si chiudono con \`/\` su una riga a sé:

\`\`\`sql
CREATE OR REPLACE PROCEDURE saluta (p_nome VARCHAR2) IS
BEGIN
  DBMS_OUTPUT.PUT_LINE('Ciao ' || p_nome);
END;
/
\`\`\`

## Transazioni

Orabridge **non fa commit da solo**. Dopo una modifica il pallino arancione
accanto al nome della connessione segnala la transazione aperta: si chiude con
**Commit** o **Rollback** dalla barra del foglio. La stessa sessione è usata
dalla scheda *Dati* e dall'assistente AI, quindi tutti vedono le stesse
modifiche non ancora confermate.

## Il pannello dei risultati

| Scheda | Contenuto |
|---|---|
| **Risultati** | La griglia dell'ultima query, con tempo di esecuzione, *CSV* ed *Esporta…* |
| **Messaggi** | Esiti, avvisi ed errori, con l'orario |
| **Piano** | Il piano di esecuzione ad albero (vedi [Piano e autotrace](#piano)) |
| **Script** | Il log dell'ultima esecuzione con \`F5\` |
| **DBMS Output** | Quello che il PL/SQL scrive con \`DBMS_OUTPUT\` |

## Variabili di bind e di sostituzione

Un'istruzione che contiene \`:nome\` o \`&nome\` non parte al buio: prima di
eseguire, Orabridge apre una finestra e chiede i valori.

- \`:nome\` è una **variabile di bind**: il valore viaggia a parte, non entra
  nel testo dell'istruzione, e il database può riusare il piano già preparato.
  Per ognuna si sceglie il tipo (*Testo*, *Numero*, *Data*) e si può spuntare
  *NULL*; in un blocco PL/SQL si può anche indicare la direzione **IN**,
  **OUT** o **IN OUT**, e i valori restituiti compaiono fra i *Messaggi*.
- \`&nome\` è una **variabile di sostituzione**, come in SQL*Plus: il valore
  viene incollato nel testo prima di partire, quindi può essere un pezzo di
  SQL qualunque (un nome di tabella, un elenco di valori). \`&&nome\` la chiede
  una volta sola e poi la ricorda.

I valori restano in memoria per quel foglio: rieseguendo la stessa query non
vanno ridigitati. Il pulsante con l'icona della variabile riapre la finestra
senza eseguire nulla.

## File .sql

I fogli sopravvivono da soli fra un avvio e l'altro, ma possono anche essere
legati a un file su disco.

| Comando | Tasti | Cosa fa |
|---|---|---|
| **Apri…** | \`Ctrl+O\` | Apre un \`.sql\` in una **scheda nuova** |
| **Salva** | \`Ctrl+S\` | Riscrive il file del foglio; se non ne ha uno, lo chiede |
| **Salva con nome…** | \`Ctrl+Maiusc+S\` | Chiede sempre dove salvare |

Un pallino accanto al nome del file segnala le modifiche non ancora salvate.
Nell'app desktop si aprono le finestre del sistema; nel browser si usa la
finestra dei file quando c'è, altrimenti il salvataggio **scarica** il file.

## Esportare

*CSV* accanto ai risultati resta la scorciatoia di sempre. **Esporta…** apre
la finestra completa: CSV, Excel (.xlsx), JSON, istruzioni INSERT, HTML o TSV,
e soprattutto la scelta fra le righe già caricate e **tutte** quelle della
query — rieseguita sul server, oltre il limite di *Righe max*. Vedi
[Griglia dei risultati](#griglia).

**Cronologia** apre l'elenco delle istruzioni eseguite su questa connessione
(vedi [Cronologia](#cronologia)). Il pannello si riduce e si riapre con
\`Ctrl+J\`.
`,
  },
  {
    id: 'piano',
    title: 'Piano di esecuzione e autotrace',
    summary: "Leggere il piano ad albero, e la differenza fra stima e realtà.",
    md: `
Il pulsante **Piano** del foglio SQL riempie la scheda *Piano* del pannello dei
risultati con l'albero delle operazioni che il database userà (o ha usato) per
rispondere.

## Piano stimato

Con l'**Autotrace spento**, *Piano* fa un \`EXPLAIN PLAN\`: l'istruzione **non
viene eseguita**, e i numeri sono le stime dell'ottimizzatore.

| Colonna | Significato |
|---|---|
| **Righe** | Quante righe l'ottimizzatore si aspetta da quel passo |
| **Byte** | Quanti dati stima di dover muovere |
| **Costo** | L'unità di conto interna con cui confronta i piani |
| **Tempo** | La durata stimata di quel passo |

Cliccando un nodo si aprono le condizioni di **accesso** (quelle che scelgono
le righe da leggere, tipicamente su un indice) e di **filtro** (quelle
applicate dopo aver letto). Il testo integrale di \`DBMS_XPLAN\` resta
disponibile in fondo, in un blocco richiudibile.

## Autotrace

Con l'**Autotrace acceso**, *Piano* **esegue davvero** l'istruzione (le righe
vengono lette e scartate: servono i numeri, non i dati) e mostra il piano
reale, con tre colonne in più:

| Colonna | Significato |
|---|---|
| **Avvii** | Quante volte quel passo è stato eseguito |
| **Righe reali** | Quante righe ha davvero prodotto |
| **Buffer** | Quanti blocchi ha letto dalla memoria |

Quando le **righe reali** si discostano dalla stima di oltre dieci volte, lo
scostamento è evidenziato: è lì che l'ottimizzatore si è sbagliato, ed è quasi
sempre da lì che parte un problema di prestazioni (statistiche vecchie, un
predicato che il database non sa valutare, un indice che manca).

Sotto il piano compaiono le **statistiche di sessione** dell'esecuzione:
letture logiche, letture fisiche, ordinamenti, redo generato. Sono i numeri da
confrontare fra due versioni della stessa query.

L'autotrace ha bisogno di leggere le viste \`V$\` dell'istanza. Se l'utenza non
ne ha il permesso, Orabridge lo dice con un avviso e ripiega sul piano
stimato invece di fallire.
`,
  },
  {
    id: 'editor',
    title: 'Editor: autocomplete, ricerca, formattazione',
    summary: 'Il completamento consapevole del contesto, la ricerca e il formattatore.',
    md: `
L'editor è lo stesso in tutti i punti dell'app: fogli SQL, sorgenti PL/SQL e
viste in sola lettura.

## Autocomplete

Parte da solo mentre si scrive e si richiama con \`Ctrl+Spazio\`. I suggerimenti
sono **raggruppati in sezioni** e ordinati in base alla clausola in cui si trova
il cursore:

- **colonne** delle tabelle citate nell'istruzione, con il tipo e rispettando
  gli alias (\`c.\` propone le colonne di \`clienti c\`), incluse quelle di CTE
  (\`WITH\`) e subquery;
- **oggetti dello schema**: tabelle, viste, sinonimi, sequenze (con
  \`.NEXTVAL\`), package e procedure. Gli **altri schemi** vengono caricati al
  volo scrivendo \`ALTRO_SCHEMA.\`;
- **condizioni di join dalle foreign key**: dopo \`JOIN\` propone la tabella
  collegata già completa di alias e \`ON\`, dentro \`ON\` la sola condizione;
- **espansione di \`*\` e \`alias.*\`** nell'elenco delle colonne;
- **funzioni built-in** di Oracle con la firma e le parole chiave PL/SQL.

I nomi seguono lo stile di chi scrive: digitando in minuscolo vengono inseriti
in minuscolo. La ricerca è per iniziali e per pezzi di parola (\`wbsd\` trova
\`WBS_DEFAULT_OWNER\`), ma non accetta lettere sparpagliate a caso.

I metadati si aggiornano alla connessione e dopo ogni DDL eseguita da
Orabridge, così i suggerimenti restano allineati.

## Ricerca e sostituzione

\`Ctrl+F\` cerca, \`Ctrl+H\` cerca e sostituisce (nelle viste in sola lettura la
sostituzione è disattivata).

| Tasti | Azione |
|---|---|
| \`Invio\` / \`Maiusc+Invio\` / \`F3\` | Risultato successivo / precedente |
| \`Alt+C\` | Distingui maiuscole/minuscole |
| \`Alt+W\` | Solo parola intera |
| \`Alt+R\` | Espressione regolare |
| \`Alt+L\` | Cerca solo nelle righe selezionate |

## Formattazione

\`Ctrl+Maiusc+F\` formatta la selezione, \`Ctrl+Alt+F\` tutto il foglio. Il
formattatore conosce il dialetto Oracle: allinea le clausole a destra del
«fiume» e manda a capo una voce per riga sotto la prima, indenta i blocchi
PL/SQL, i rami di un \`CASE\` e di un \`MERGE\`, spezza a cascata le righe troppo
lunghe (separatori, concatenazioni \`||\`, gruppi di parentesi) e non tratta come
parole chiave i nomi che seguono un punto (\`t.date\` resta \`t.date\`).

\`\`\`sql
SELECT c.ragione_sociale,
       o.totale
  FROM clienti c,
       ordini o
 WHERE o.cliente_id = c.id
   AND o.totale > 13000;
\`\`\`

È **conservativo**: se il testo non viene riconosciuto token per token resta
esattamente com'era e compare un avviso, invece di restituire codice
riscritto male.

## Piegare il codice

Il margine a sinistra dei numeri di riga mostra una freccia dove c'è qualcosa
da piegare: un blocco \`BEGIN\`…\`END\`, un \`CREATE OR REPLACE\`, un commento
su più righe, un'istruzione lunga. Cliccarla richiude il blocco in una riga
sola; funziona anche nei sorgenti aperti in sola lettura, dove serve di più.

## Commentare e cambiare le maiuscole

| Tasti | Azione |
|---|---|
| \`Ctrl+/\` | Commenta o decommenta le righe selezionate (\`--\`) |
| \`Ctrl+Maiusc+/\` | Commento a blocco (\`/* … */\`) |
| \`Ctrl+Maiusc+U\` | MAIUSCOLO |
| \`Ctrl+Maiusc+L\` | minuscolo |
| \`Ctrl+Alt+U\` | Iniziali Maiuscole |

Senza selezione valgono sulla parola sotto il cursore.

## Andare all'oggetto

- **Ctrl+clic** su un nome di tabella, vista, procedura o package apre la sua
  scheda. Tenendo premuto \`Ctrl\` il puntatore diventa una mano sui nomi che
  Orabridge sa risolvere; se il nome non corrisponde a niente di conosciuto lo
  dice invece di non fare nulla.
- **\`Maiusc+F4\`** apre il *describe* rapido: un riquadro con le colonne della
  tabella sotto il cursore — nome, tipo, obbligatorietà, chiave — senza
  lasciare il foglio. \`Esc\` lo chiude, *Apri scheda* fa il salto vero.

I nomi si risolvono sui metadati già caricati per l'autocomplete, quindi
valgono le stesse regole: lo schema di lavoro è sempre disponibile, gli altri
si caricano la prima volta che li si nomina.

`,
  },
  {
    id: 'griglia',
    title: 'Griglia dei risultati',
    summary: 'Ordinare, selezionare, copiare, modificare le celle ed esportare.',
    md: `
La griglia è virtualizzata: regge decine di migliaia di righe senza rallentare.

- **Clic sull'intestazione** ordina per quella colonna (di nuovo per invertire,
  una terza volta per togliere l'ordinamento).
- **Trascina il bordo** dell'intestazione per cambiare la larghezza di una
  colonna.
- **Trascina sulle celle** per selezionare un rettangolo; \`Ctrl+A\` seleziona
  tutto e \`Ctrl+C\` copia la selezione (separata da tabulazioni: si incolla in
  Excel così com'è).
- **Doppio clic su una cella** apre il valore intero in una finestra, con il
  tasto *Copia*: serve per CLOB e testi lunghi.
- **Clic destro su un'intestazione** blocca le colonne fino a quella: restano
  ferme a sinistra mentre si scorre in orizzontale, come il blocco riquadri di
  Excel. Serve per non perdere di vista la chiave in una tabella larga.
- **CSV** esporta il risultato mostrato; **Esporta…** apre la finestra con
  tutti i formati (vedi più sotto).

## Filtrare e guardare una riga per volta

L'interruttore del **filtro** apre una riga di campi sotto l'intestazione: si
scrive in quello di una colonna e la griglia mostra solo le righe che
corrispondono. Il filtro lavora sulle righe **già caricate**, senza tornare al
database, e si combina con l'ordinamento.

| Si scrive | Tiene le righe |
|---|---|
| \`ross\` | che contengono «ross», maiuscole o minuscole che siano |
| \`> 1000\` | con valore numerico maggiore di 1000 (anche \`>=\`, \`<\`, \`<=\`, \`=\`, \`!=\`) |
| \`(null)\` | in cui la colonna è vuota |

La **vista a record singolo** mostra una riga alla volta in verticale, con le
frecce per scorrere: è il modo di leggere una tabella con quaranta colonne
senza andare avanti e indietro in orizzontale. Se la griglia è modificabile, i
campi si modificano anche da lì.

## Modificare i dati

Nella scheda **Dati** di una tabella con chiave (o \`ROWID\` disponibile) il
doppio clic su una cella la apre in modifica: \`Invio\` conferma, \`Esc\`
annulla. Le celle cambiate restano evidenziate finché non si fa **Commit** (o
**Rollback**) dalla barra sopra la griglia — la modifica passa dalla stessa
sessione del foglio SQL, quindi nulla viene confermato a tua insaputa. Un campo
svuotato viene scritto come \`NULL\`.

Dalla barra sopra la griglia si lavora anche sulle righe intere:

- **Nuova riga** apre il modulo a record singolo vuoto: si compilano solo le
  colonne che servono, le altre restano al valore di default della tabella.
- **Duplica** lo apre già compilato con i valori della riga selezionata —
  resta da cambiare la chiave.
- **Elimina** cancella le righe selezionate (si selezionano cliccando il
  numero di riga, con \`Ctrl\` per aggiungerne e \`Maiusc\` per un intervallo).
  Oltre una riga chiede conferma.

Anche queste passano dalla sessione del foglio: fino al **Commit** si può
tornare indietro con **Rollback**. Su una connessione aperta in sola lettura
sono disattivate.

## Esportare e importare

**Esporta…** genera il file nel formato scelto:

| Formato | Note |
|---|---|
| **CSV** / **TSV** | Separatore e riga di intestazione a scelta |
| **Excel (.xlsx)** | Un foglio solo, scritto senza librerie esterne |
| **JSON** | Un array di oggetti, una proprietà per colonna |
| **INSERT** | Istruzioni pronte da rieseguire, con \`COMMIT\` ogni N righe |
| **HTML** | Una pagina con la tabella, da aprire nel browser |

L'ambito è **le righe caricate** oppure **tutte le righe della query**: nel
secondo caso Orabridge rifà l'interrogazione sul server e supera il limite di
*Righe max* (fino a 200 000 righe, che è anche il punto oltre il quale un file
del genere smette di essere utile).

Nella scheda **Dati** di una tabella c'è anche **Importa…**: si sceglie un file
CSV o Excel, si controlla come è stato interpretato (separatore, intestazione),
si abbinano le colonne del file a quelle della tabella — l'abbinamento
automatico per nome di solito basta — e si carica a lotti. Le righe rifiutate
vengono elencate con il motivo, e si può scegliere se fermarsi al primo errore
o tirare dritto. Anche qui niente viene confermato senza **Commit**.

## Decodifica delle entità HTML

Il pulsante **\`&→à\`** sopra la griglia serve ai database popolati da
applicativi web datati, che salvano il testo già codificato
(\`Attivit&agrave; in corso\`). Acceso, la griglia mostra il testo decodificato;
la preferenza è globale e viene ricordata, ma **è solo a video**: ordinamento,
modifica delle celle ed export CSV continuano a lavorare sul valore grezzo del
database. Di default è spento.
`,
  },
  {
    id: 'oggetti',
    title: 'Creare e modificare oggetti',
    summary: 'Designer di tabelle, DDL guidata, compilazione e drop.',
    md: `
Ogni procedura guidata mostra **l'anteprima dello SQL** che verrà eseguito:
niente viene lanciato senza che tu l'abbia visto.

## Creare

Il tasto **＋** sulla cartella dell'albero apre il dialogo giusto per quel tipo:

- **Tabella** — griglia delle colonne (nome, tipo, lunghezza/precisione, NOT
  NULL, default), chiave primaria e commenti su tabella e colonne.
- **Sequenza** — start, incremento, min/max, cache, ciclo.
- **Vista** — nome e query.
- **Indice** — colonne, unicità.
- **Sinonimo** — oggetto di destinazione, pubblico o privato.
- **Procedura, funzione, package, trigger, tipo** — scheletro di partenza già
  compilabile.

## Modificare

- **Modifica tabella** (dalla scheda della tabella): aggiungere, cambiare o
  eliminare colonne; gestire i vincoli (PK, UNIQUE, FK, CHECK); creare o
  eliminare indici; rinominare la tabella.
- **Modifica vista** e **Modifica sequenza** dalle rispettive schede.
- **Sorgente PL/SQL**: si modifica nella scheda *Sorgente* e si ricompila con
  **Compila** (\`Ctrl+Invio\`); gli errori di compilazione sono cliccabili e
  portano alla riga.

## Eliminare

Tasto destro sull'oggetto nell'albero → **Elimina…**: il dialogo mostra il
comando \`DROP\` esatto e le opzioni del caso (\`CASCADE CONSTRAINTS\`,
\`PURGE\`) prima di procedere.

Dopo ogni DDL l'albero e i metadati dell'autocomplete si ricaricano da soli.
`,
  },
  {
    id: 'diff',
    title: 'DB Diff',
    summary: 'Confrontare due schemi e generare lo script di allineamento.',
    md: `
L'icona **⇄** fra i comandi in alto apre il confronto fra due schemi: su
connessioni diverse o sulla stessa connessione (per esempio due schemi dello
stesso database). Si possono tenere aperti più confronti insieme.

## Impostare il confronto

1. Scegli **origine** e **destinazione** (connessione + schema). L'icona di
   scambio inverte i due lati.
2. Spunta i **tipi di oggetto** da confrontare: tabelle (colonne, vincoli,
   indici, commenti), viste, viste materializzate, sequenze, sinonimi,
   procedure, funzioni, package, trigger, tipi.
3. Eventuali **opzioni** e un **filtro sui nomi** (accetta \`%\` e \`_\`) per
   limitare il confronto a una parte dello schema.
4. **Confronta**.

## Leggere le differenze

Ogni oggetto è marcato come **solo in origine**, **solo in destinazione** o
**diverso**. Selezionandolo:

- le differenze strutturali (colonne, vincoli, indici) si leggono in tabella,
  affiancate fra i due lati;
- le differenze di codice (viste, PL/SQL) si leggono in un **confronto
  affiancato riga per riga**.

Per evitare differenze finte, i vincoli e gli indici con nome generato
(\`SYS_C…\`) vengono accoppiati per definizione invece che per nome, un
riferimento allo schema di origine vale quanto lo stesso riferimento allo
schema di destinazione, e le colonne di identità si confrontano sul tipo di
generazione: la sequenza che Oracle si crea dietro le quinte
(\`ISEQ$$_176443\`) ha un numero diverso in ogni database, quindi non fa testo
— e per lo stesso motivo quelle sequenze non compaiono nell'elenco.

## Restringere l'elenco

Sotto la casella di ricerca ci sono i **filtri per stato** (solo origine, solo
destinazione, diversi, uguali) con il rispettivo conteggio: gli oggetti
identici sono nascosti finché non si chiedono, e serve chiederli per
verificare che un oggetto sia stato davvero confrontato. Il titolo di ogni
categoria la **comprime**, e *comprimi* le chiude tutte insieme.

## Script di sincronizzazione

Si spuntano gli oggetti da allineare e si genera lo script (CREATE/ALTER, con i
DROP opzionali): si apre in un **foglio SQL sulla connessione di destinazione**,
pronto da leggere ed eseguire. **Orabridge non esegue mai niente da sé**: la
decisione, e il commit, restano tuoi.

Dopo il confronto è spuntato tutto: i pulsanti *tutti*, *nessuno* e *inverti*
agiscono su ciò che è in elenco in quel momento, quindi combinati con i filtri
per stato o per nome scelgono un blocco intero in un colpo solo — per esempio
*solo origine* + *tutti* per creare nella destinazione ciò che le manca.
Cambiando la selezione lo script già generato viene azzerato: quello che si
copia corrisponde sempre a ciò che è spuntato.

Lo script viene generato dalle fotografie dei due schemi, senza
\`DBMS_METADATA\`: funziona anche con utenze dai privilegi minimi.
`,
  },
  {
    id: 'ai',
    title: 'Assistente AI',
    summary: 'Configurazione, sessioni, permessi e approvazioni.',
    md: `
L'assistente (\`Ctrl+Alt+I\`, o l'interruttore del pannello destro in alto) è
una chat che lavora sul database: elenca
schemi e oggetti, legge la struttura di una tabella (colonne, vincoli, foreign
key, indici, commenti), legge sorgenti e DDL, esegue SELECT e — se glielo
consenti — istruzioni di modifica.

## Configurazione

**Impostazioni → Assistente AI** (\`Ctrl+,\`):

1. Scegli la **piattaforma**: OpenRouter, Anthropic, Google Gemini o OpenAI.
2. Incolla la sua **API key** e salva. Ogni piattaforma tiene la sua chiave: si
   passa dall'una all'altra senza reinserirle.
3. Scegli il **modello predefinito** dall'elenco letto in tempo reale dalla
   piattaforma (con la finestra di contesto, dove la dichiara). *Aggiorna*
   rilegge l'elenco.
4. Imposta i **permessi predefiniti** e il numero massimo di righe che una
   query può restituire all'assistente.

Un **endpoint personalizzato** è disponibile per chi passa da un gateway
aziendale.

Le chiavi sono cifrate sul server (AES-256-GCM) e **non vengono mai inviate al
browser**: anche il dialogo con la piattaforma parte dal server.

## Sessioni

Ogni sessione ha la **sua connessione**, il suo modello e i suoi permessi, e
girano **sul server**: continuano anche a pannello chiuso, cambiando scheda o
ricaricando la pagina. Dall'elenco (icona delle sessioni) si riaprono le
conversazioni precedenti, si cercano per testo e si eliminano. La connessione si
sceglie da una tendina con ricerca — per nome, utente, servizio o gruppo — che
col pallino mostra quali database sono davvero collegati.

Le esecuzioni passano dalla **stessa sessione del foglio SQL**: vedono la
transazione aperta e non fanno commit da sole.

## Permessi e approvazioni

Tre interruttori per sessione:

- **Lettura** — struttura del database, DDL e SELECT.
- **Scrittura** — INSERT, UPDATE, MERGE, CREATE, ALTER.
- **DELETE e DROP** — cancellazione di righe e di oggetti, a parte apposta.

Prima di eseguire, il server classifica l'istruzione: se eccede i permessi
concessi l'esecuzione si ferma e in chat compare **l'SQL esatto** con *Consenti
una volta / Consenti sempre / Rifiuta*. La classificazione ignora commenti e
stringhe (un \`DROP\` dentro un letterale non è un DROP), ma nei blocchi PL/SQL
guarda anche dentro le stringhe, dove si nasconde l'SQL dinamico: nel dubbio
chiede conferma. Un rifiuto viene spiegato al modello, che non insiste e ti
propone l'SQL da lanciare a mano.

## Leggere le risposte

Ogni passaggio è ispezionabile: aprendo una chiamata si vede l'SQL eseguito e la
risposta arrivata dal database. Le risposte sono in Markdown completo (titoli,
elenchi, tabelle, blocchi di codice colorati) e ogni blocco SQL ha *Copia* e
*Apri nel foglio*. Le istruzioni eseguite dall'assistente finiscono in
cronologia, marcate con ✨.
`,
  },
  {
    id: 'dba',
    title: 'Monitor DBA',
    summary: 'Sessioni, lock, tablespace, istanza, Top SQL e attese.',
    md: `
L'icona con l'onda, fra i comandi in alto, apre il **monitor** dell'istanza a
cui è collegata la connessione selezionata. Sono tutte letture dalle viste
dinamiche di Oracle: se l'utenza non ha i privilegi per una sezione, quella
sezione lo dice e le altre continuano a funzionare.

| Sezione | Cosa mostra |
|---|---|
| **Sessioni** | Chi è collegato, da quale macchina e programma, cosa sta eseguendo, su cosa aspetta e da chi è bloccato |
| **Lock** | Chi blocca chi, su quale oggetto e da quanto |
| **Tablespace** | Spazio usato e libero, con la barra colorata: gialla sopra il 75%, rossa sopra il 90% |
| **Istanza** | Nome, host, versione, avvio, modalità di apertura, e i parametri diversi dal default |
| **Top SQL** | Le istruzioni più costose, ordinabili per tempo, CPU, letture logiche o fisiche, esecuzioni |
| **Attese** | Su cosa il database ha aspettato dall'avvio, e chi sta aspettando adesso |

Il selettore in alto imposta l'**aggiornamento automatico** (5, 10 o 30
secondi). Parte sempre da *Off* e si ferma da solo quando la scheda non è in
primo piano: un monitor che interroga il database in sottofondo mentre si
lavora ad altro è un modo per farsi notare dal DBA nel modo sbagliato.

## Terminare una sessione

Tasto destro su una riga delle sessioni → *Mostra SQL completo* per vedere cosa
sta eseguendo, oppure *Termina sessione…*. La conferma ripete SID e utente, e
la spunta **IMMEDIATE** decide se Oracle debba interrompere subito il lavoro in
corso invece di aspettare che finisca.

Due sessioni non si possono terminare in nessun caso: quella con cui Orabridge
sta leggendo e quella del foglio SQL — con lei se ne andrebbe la transazione
aperta. Su una connessione [in sola lettura](#connessioni) la voce è
disattivata e il server rifiuta comunque la richiesta.

Cliccando una riga di *Top SQL* si legge l'istruzione per intero, e **Apri in
un foglio SQL** la porta in un foglio nuovo dove studiarla con
[Piano e autotrace](#piano).
`,
  },
  {
    id: 'cronologia',
    title: 'Cronologia',
    summary: 'Ritrovare, riaprire e ripulire le istruzioni già eseguite.',
    md: `
La cronologia raccoglie le istruzioni eseguite, con connessione, orario ed
esito. Si apre dall'icona dell'orologio fra i comandi in alto (tutte le
connessioni) o dal tasto **Cronologia** di un foglio SQL (già filtrata su quella
connessione).

- **Cerca nel testo SQL…** filtra per contenuto; la tendina filtra per
  connessione.
- Clic su una voce per espanderla e leggere l'istruzione completa.
- **Copia** mette l'SQL negli appunti, **Apri** lo apre in un nuovo foglio sulla
  stessa connessione.
- Il cestino su una voce la elimina; **Cancella** svuota la cronologia.
- Le istruzioni eseguite dall'assistente AI sono marcate con ✨.
`,
  },
  {
    id: 'scorciatoie',
    title: 'Scorciatoie',
    summary: 'Tutte le combinazioni di tasti.',
    md: `
## Esecuzione

| Tasti | Azione |
|---|---|
| \`Ctrl+Invio\` / \`F9\` | Esegui l'istruzione al cursore (o la selezione) |
| \`F5\` | Esegui tutto lo script |
| \`Ctrl+Invio\` (scheda Sorgente) | Compila il sorgente PL/SQL |

## File

| Tasti | Azione |
|---|---|
| \`Ctrl+O\` | Apri un file \`.sql\` in una scheda nuova |
| \`Ctrl+S\` | Salva il foglio |
| \`Ctrl+Maiusc+S\` | Salva con nome… |

## Editor

| Tasti | Azione |
|---|---|
| \`Ctrl+Spazio\` | Autocomplete |
| \`Ctrl+F\` / \`Ctrl+H\` | Cerca / cerca e sostituisci |
| \`Invio\` / \`Maiusc+Invio\` / \`F3\` | Risultato successivo / precedente |
| \`Alt+C\` / \`Alt+W\` / \`Alt+R\` | Maiuscole/minuscole, parola intera, regex |
| \`Alt+L\` | Limita la ricerca alle righe selezionate |
| \`Ctrl+Maiusc+F\` | Formatta la selezione (fuori dall'editor: ricerca nel codice) |
| \`Ctrl+Alt+F\` | Formatta tutto il foglio |
| \`Ctrl+/\` / \`Ctrl+Maiusc+/\` | Commenta le righe / commento a blocco |
| \`Ctrl+Maiusc+U\` / \`Ctrl+Maiusc+L\` | MAIUSCOLO / minuscolo |
| \`Ctrl+Alt+U\` | Iniziali Maiuscole |
| \`Ctrl+clic\` | Apri la scheda dell'oggetto sotto il cursore |
| \`Maiusc+F4\` | Describe rapido dell'oggetto sotto il cursore |
| Clic sulla freccia nel margine | Piega o riapre il blocco |

## Griglia

| Tasti | Azione |
|---|---|
| Clic sull'intestazione | Ordina per quella colonna |
| Clic destro sull'intestazione | Blocca o sblocca le colonne fino a quella |
| Clic sul numero di riga | Seleziona la riga (\`Ctrl\` aggiunge, \`Maiusc\` estende) |
| Trascinamento sulle celle | Seleziona un rettangolo |
| \`Ctrl+A\` / \`Ctrl+C\` | Seleziona tutto / copia la selezione |
| Doppio clic su una cella | Valore intero, oppure modifica (scheda Dati) |

## Finestra

| Tasti | Azione |
|---|---|
| \`Ctrl+B\` | Mostra/nascondi la barra laterale |
| \`Ctrl+Maiusc+D\` | Vista Connessioni |
| \`Ctrl+Maiusc+E\` | Vista Connessione (albero degli oggetti) |
| \`Ctrl+Maiusc+F\` | Vista Ricerca nel codice (col fuoco nell'editor: formatta) |
| \`Ctrl+J\` | Mostra/nascondi i risultati del foglio SQL |
| \`Ctrl+Alt+I\` | Mostra/nascondi l'assistente AI |
| \`Ctrl+,\` | Impostazioni |
| \`F1\` | Questa guida |
| Doppio clic sul bordo di un pannello | Torna alla larghezza predefinita |
| Clic centrale su una scheda | Chiudi la scheda |
`,
  },
  {
    id: 'dati',
    title: 'Dati, sicurezza e privacy',
    summary: 'Dove finiscono password, chiavi API e impostazioni.',
    md: `
- **Password delle connessioni e chiavi API** sono cifrate con **AES-256-GCM**.
  La chiave di cifratura viene generata al primo avvio e resta nella cartella
  dati (\`.key\`). Le chiavi API non vengono mai inviate al browser: il browser
  sa soltanto che una chiave è presente.
- **Cartella dati**: \`%APPDATA%\\Orabridge\` nell'app desktop, il volume
  \`orabridge-data\` (montato su \`/data\`) con Docker. Sono separate: le
  connessioni dell'una non si vedono nell'altra.
- **Solo localhost**: il server web pubblica la porta su \`127.0.0.1\`, non è
  raggiungibile dalla rete. Le API accettano solo richieste
  \`application/json\`, come protezione dalle richieste cross-site di pagine
  esterne.
- **Schede aperte, testo dei fogli SQL e disposizione dei pannelli** stanno nel
  browser (localStorage), non sul server.
- **Assistente AI**: le domande, e i risultati delle query che l'assistente
  esegue, vengono inviati alla piattaforma scelta — vale la privacy policy di
  quella piattaforma. Senza API key configurata nessun dato esce da Orabridge.
- **Nessun commit automatico**: fogli SQL, modifica dei dati nella griglia e
  assistente condividono la stessa sessione e la stessa transazione; commit e
  rollback restano gesti espliciti.
`,
  },
  {
    id: 'problemi',
    title: 'Problemi frequenti',
    summary: 'Errori di connessione, oggetti mancanti, aggiornamenti.',
    md: `
## «NJS-116: password verifier type 0x939 is not supported»

L'utenza ha solo il vecchio verifier **10G**, che il driver in modalità *thin*
non supporta. L'**app desktop** e l'**immagine Docker** includono Oracle Instant
Client e girano in modalità *thick*: lì il problema non si presenta. In
alternativa, un DBA può rigenerare i verifier con
\`ALTER USER utente IDENTIFIED BY nuova_password\`.

Stessa risposta se il server Oracle è una **11.2**: la modalità thin richiede
12.1 o superiore, la thick arriva fino alla 11.2.

## «Connessione non attiva» in un foglio già aperto

Il foglio è rimasto aperto dopo una disconnessione (o dopo un riavvio dell'app).
Il tasto **Connetti** nel banner ricollega la connessione senza perdere il testo
del foglio.

## La password viene chiesta di nuovo

Vuol dire che quella salvata non è più valida (cambio password, scadenza,
account bloccato). Inseriscila nel dialogo: se il login riesce viene salvata al
posto della vecchia.

## Non trovo una tabella nell'albero

Tre possibilità: c'è un **filtro** attivo in cima all'albero; l'elenco è
**troncato** e serve il tasto *Carica altro*; la tabella è di **un altro
schema** e va cercata sotto *Altri utenti*.

## L'autocomplete non propone un oggetto appena creato

I metadati si ricaricano dopo le DDL eseguite da Orabridge, ma non dopo quelle
eseguite altrove: basta ricaricare la cartella dell'albero (↻) o riconnettersi.

## La formattazione non cambia niente

Il formattatore è conservativo: se non riconosce il testo token per token lo
lascia intatto e lo dice con un avviso. Capita con SQL incompleto o con sintassi
non ancora coperta.

## «Gli aggiornamenti automatici funzionano solo nella versione installata»

Il controllo aggiornamenti è disponibile solo nell'app desktop installata
dall'installer, non nella versione web né in esecuzione da sorgente.
`,
  },
];

export const RELEASES_URL = 'https://github.com/riftbane/orabridge/releases';

// Ripiego: le novità vere arrivano da GitHub Releases (`/api/releases`), ma
// Orabridge gira anche su macchine senza internet. Questo elenco resta nel
// bundle per quei casi, quindi cita solo le funzioni grosse — la storia
// completa è nel CHANGELOG.md e sulla pagina delle release.
export const RELEASE_HIGHLIGHTS = [
  {
    version: '1.31',
    text: `**Il lavoro quotidiano sui dati**: variabili di bind e di sostituzione nel
foglio, righe da aggiungere ed eliminare nella griglia, esportazione in Excel,
JSON, INSERT e HTML anche oltre le righe caricate, importazione da CSV, file
\`.sql\` da aprire e salvare, piano di esecuzione ad albero con autotrace,
connessioni TNS/SYSDBA/wallet e in sola lettura, e un monitor DBA con sessioni,
lock e tablespace.`,
  },
  {
    version: '1.19',
    text: `**Modello locale**: Gemma 4 gira dentro Orabridge, gratis e senza API key. Il
motore è incluso nell'installer, i pesi si scaricano una volta dalle
impostazioni.`,
  },
  {
    version: '1.18',
    text: `**Token spesi sempre sotto gli occhi**: sotto ogni risposta dell'assistente la
piattaforma, il modello e i token di quella richiesta; in cima al pannello il
totale della sessione.`,
  },
  {
    version: '1.17',
    text: `Questa **guida integrata**: si apre con \`F1\` o dall'icona del libro in alto
a destra, ed è consultabile anche da **Impostazioni → Guida**. La scheda
*Informazioni* mostra ora la versione anche nel client web.`,
  },
  {
    version: '1.16',
    text: `La **password viene chiesta al momento** quando manca o non è più valida,
invece di limitarsi a segnalare l'errore: se il login riesce viene salvata sulla
connessione.`,
  },
  {
    version: '1.15',
    text: `Tasto **«Carica altro»** nell'albero degli oggetti: le cartelle molto popolate
non si fermano più a 300 elementi con un messaggio, si espandono 300 alla volta
fino a mostrare tutto.`,
  },
  {
    version: '1.14',
    text: `**Formattazione SQL** più curata per Oracle: righe lunghe spezzate a cascata,
\`CASE\` e \`MERGE\` indentati correttamente, nomi dopo il punto non più
scambiati per parole chiave.`,
  },
  {
    version: '1.13',
    text: `**Decodifica delle entità HTML** nella griglia (pulsante \`&→à\`), e
autocomplete che non propone più corrispondenze con le lettere sparpagliate.`,
  },
  {
    version: '1.12',
    text: `**Assistente AI** multi-piattaforma (OpenRouter, Anthropic, Gemini, OpenAI) con
sessioni in background, permessi e approvazioni; pannelli ridimensionabili e
finestra delle impostazioni.`,
  },
  {
    version: '1.11',
    text: `Ricerca e sostituzione in stile VS Code in tutti gli editor, formattazione del
codice, gruppi di connessioni.`,
  },
  {
    version: '1.10',
    text: '**DB Diff**: confronto fra due schemi e script di sincronizzazione.',
  },
  {
    version: '1.9',
    text: 'Autocomplete consapevole del contesto (colonne, alias, join dalle foreign key).',
  },
];

// Le novità come elenco Markdown (le righe successive alla prima vanno
// rientrate, altrimenti chiudono il punto dell'elenco).
export function highlightsMd(limit = RELEASE_HIGHLIGHTS.length) {
  return RELEASE_HIGHLIGHTS.slice(0, limit)
    .map((h) => `- **${h.version}** — ${h.text.split('\n').join('\n  ')}`)
    .join('\n');
}

const itDate = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');

// Le release lette da GitHub: una sezione per versione, con le note così come
// sono state pubblicate (sono la voce di CHANGELOG di quel rilascio).
export function releasesMd(list, limit = list.length) {
  return list
    .slice(0, limit)
    .map((r) => {
      const when = itDate(r.publishedAt);
      const head = `### ${r.version}${when ? ` — ${when}` : ''}${r.prerelease ? ' (anteprima)' : ''}`;
      return `${head}\n\n${r.notes || '_Nessuna nota pubblicata._'}\n\n[Note su GitHub](${r.url})`;
    })
    .join('\n\n');
}

// Le novità in breve, per la scheda «Informazioni»: una riga per versione.
export function releasesShortMd(list, limit = 3) {
  return list
    .slice(0, limit)
    .map((r) => `- **${r.version}** — ${r.summary || 'nessuna nota pubblicata'}`)
    .join('\n');
}

// Sezione «Aggiornamenti»: dipende dalla versione in esecuzione, da come è
// stata installata l'app e dalle release pubblicate su GitHub, quindi si
// costruisce a runtime.
function updatesSection({ version, desktop, releases }) {
  const installed = version ? `**${version}**` : '**(non disponibile)**';
  const kind = desktop ? 'App desktop (Windows)' : 'Client web / Docker';
  const list = releases?.releases || [];
  const latest = list[0];
  // Confronto testuale: i numeri sono nella stessa forma (1.19.0) da entrambe
  // le parti, e qui serve solo capire se c'è qualcosa di più recente.
  const behind = latest && version && latest.version !== version;
  const news = list.length
    ? releasesMd(list)
    : `${
        releases?.error
          ? `> Elenco delle release non raggiungibile (${releases.error}): qui sotto le novità incluse in questa versione.\n\n`
          : ''
      }${highlightsMd()}`;

  return {
    id: 'aggiornamenti',
    title: 'Aggiornamenti e novità',
    summary: 'Versione installata, come si aggiorna e cosa è cambiato.',
    md: `
## Versione installata

- **Versione:** ${installed}
- **Installazione:** ${kind}${
      latest
        ? `\n- **Ultima pubblicata:** ${latest.version}${itDate(latest.publishedAt) ? ` (${itDate(latest.publishedAt)})` : ''}${behind ? ' — più recente di quella in uso' : ' — è quella che stai usando'}`
        : ''
    }

Il numero di versione compare anche in **Impostazioni → Informazioni**, insieme
al tasto per il controllo manuale degli aggiornamenti.

## Come si aggiorna

${
  desktop
    ? `L'app desktop **si aggiorna da sola**: controlla se c'è una versione più
recente all'avvio e poi ogni 4 ore mentre resta aperta, la scarica in
background e, quando è pronta, chiede se **riavviare subito** per installarla o
farlo più tardi (in quel caso viene installata alla chiusura dell'app). Non
serve riscaricare l'installer a mano.

Il controllo si può forzare da **Impostazioni → Informazioni → Verifica
aggiornamenti**: lì si vede anche lo stato d'avanzamento del download. Se
compare *«Gli aggiornamenti automatici funzionano solo nella versione
installata»* stai usando una copia non installata dall'installer.`
    : `La versione web si aggiorna aggiornando il deployment: nuovo \`git pull\` e
\`docker compose up -d --build\`. Ricaricando la pagina il browser prende
la nuova versione.

L'**app desktop per Windows**, invece, si aggiorna da sola: controlla le nuove
versioni all'avvio e ogni 4 ore, le scarica in background e chiede se riavviare
per installarle.`
}

Ogni versione pubblicata ha il suo installer e le sue note su
**[GitHub Releases](${RELEASES_URL})**; l'elenco completo delle modifiche sta
anche nel file \`CHANGELOG.md\` del progetto.

## Novità delle ultime versioni

${news}
`,
  };
}

// Le sezioni della guida, nell'ordine in cui compaiono nell'indice.
export function buildGuide({ version, desktop, releases } = {}) {
  const sections = SECTIONS.map((s) => ({ ...s, md: s.md.trim() }));
  const updates = updatesSection({ version, desktop, releases });
  // «Aggiornamenti» prima delle sezioni di servizio finali.
  const at = sections.findIndex((s) => s.id === 'dati');
  sections.splice(at, 0, { ...updates, md: updates.md.trim() });
  return sections;
}

// Accenti ignorati: cercando "perche" si trova anche "perché".
const norm = (s) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

// Filtro dell'indice: tutte le parole cercate devono comparire nel titolo, nel
// sommario o nel testo della sezione.
export function searchGuide(sections, query) {
  const terms = norm(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return sections;
  return sections.filter((s) => {
    const hay = norm(`${s.title} ${s.summary} ${s.md}`);
    return terms.every((t) => hay.includes(t));
  });
}
