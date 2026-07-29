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
| **Barra laterale** (sinistra) | Connessioni salvate e albero degli oggetti del database |
| **Schede** (in alto) | Fogli SQL, oggetti aperti, Cronologia, DB Diff, questa guida |
| **Pannello dei risultati** (in basso) | Risultati, messaggi, log dello script, DBMS Output |
| **Assistente AI** (destra) | Chat che interroga e modifica il database su richiesta |

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
- **Tipo**: *Service name*, *SID* oppure *Connect string* — quest'ultimo accetta
  sia \`host:1521/servizio\` sia un descrittore TNS completo
  (\`(DESCRIPTION=(ADDRESS=…))\`), utile per RAC e failover.
- **Utente** e **Password**.

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
- Dal menu contestuale: *Nuovo foglio SQL*, *Connetti* / *Disconnetti*,
  *Modifica…*, *Elimina…*.

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
in automatico: gli **alias TNS** funzionano solo se un \`tnsnames.ora\` con
quella voce è raggiungibile da Orabridge, e i **ruoli** (SYSDBA e simili) vanno
riconfigurati a mano.
`,
  },
  {
    id: 'albero',
    title: 'Esplorare il database',
    summary: 'Albero degli oggetti, filtri, altri schemi e schede di dettaglio.',
    md: `
Sotto ogni connessione attiva compare l'albero degli oggetti dello schema di
lavoro: **Tabelle, Viste, Viste materializzate, Indici, Sequenze, Procedure,
Funzioni, Package, Trigger, Tipi, Sinonimi** e la cartella **Altri utenti**.

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

## Schede di dettaglio

Quello che si vede dipende dal tipo di oggetto:

| Tipo | Schede |
|---|---|
| Tabella, vista materializzata | Colonne, Dati, Vincoli, Indici, Trigger, DDL |
| Vista | Colonne, Dati, DDL |
| Procedura, funzione, package, trigger, tipo | Sorgente, DDL |
| Sequenza, sinonimo, indice | Dettagli, DDL |

- **Dati** mostra il contenuto a pagine, con un campo **WHERE** per filtrare
  (\`Invio\` applica), **Conta** per il totale delle righe, **Carica altre** per
  la pagina successiva ed **export CSV**. Sulle tabelle con chiave le celle sono
  **modificabili** (vedi [Griglia dei risultati](#griglia)).
- **Sorgente** è un editor vero: si modifica il PL/SQL e si ricompila con
  **Compila** (\`Ctrl+Invio\`). Gli errori di compilazione arrivano da
  \`ALL_ERRORS\` e sono cliccabili: portano alla riga giusta. **Ricarica**
  rilegge dal database e scarta le modifiche non compilate.
- **DDL** è il sorgente completo generato da \`DBMS_METADATA\`.
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
- **Piano** mostra l'explain plan dell'istruzione corrente senza eseguirla.
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
| **Risultati** | La griglia dell'ultima query, con tempo di esecuzione ed export CSV |
| **Messaggi** | Esiti, avvisi ed errori, con l'orario |
| **Script** | Il log dell'ultima esecuzione con \`F5\` |
| **DBMS Output** | Quello che il PL/SQL scrive con \`DBMS_OUTPUT\` |

**Cronologia** apre l'elenco delle istruzioni eseguite su questa connessione
(vedi [Cronologia](#cronologia)). Il pannello si riduce e si riapre con
\`Ctrl+J\`.
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
- **CSV** esporta il risultato mostrato.

## Modificare i dati

Nella scheda **Dati** di una tabella con chiave (o \`ROWID\` disponibile) il
doppio clic su una cella la apre in modifica: \`Invio\` conferma, \`Esc\`
annulla. Le celle cambiate restano evidenziate finché non si fa **Commit** (o
**Rollback**) dalla barra sopra la griglia — la modifica passa dalla stessa
sessione del foglio SQL, quindi nulla viene confermato a tua insaputa. Un campo
svuotato viene scritto come \`NULL\`.

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
    id: 'diagramma',
    title: 'Diagramma (beta)',
    summary: "Editor a nodi: vedere e modificare lo schema come un grafo.",
    md: `
L'icona a **rete** fra i comandi in alto apre il diagramma: ogni tabella è un
nodo, ogni foreign key un collegamento fra due colonne. È una **beta**: fa già
tutto quello che serve sulle tabelle e sulle loro relazioni, ma è la parte più
giovane di Orabridge.

## Aprire

Si sceglie connessione e schema, e — su schemi grandi — un **filtro sui nomi**
(accetta \`%\` e \`_\`): un canvas con quattrocento tabelle non si legge. Quello
che resta fuori dal disegno **non viene toccato**: il diagramma tiene comunque
lo schema intero, altrimenti applicare le modifiche proporrebbe di cancellare
tutto il resto.

La disposizione dei nodi si salva da sola: i padri a sinistra, i figli a
destra, le tabelle senza collegamenti in una griglia a parte. Riaprendo il
diagramma la si ritrova com'era.

## Muoversi

| | |
| --- | --- |
| rotella | ingrandisci · **Maiusc**+rotella scorri |
| trascina il vuoto | selezione a rettangolo |
| **Alt**+trascina, o tasto centrale | sposta la vista |
| **F** / **Maiusc+F** | inquadra la selezione / tutto |
| **N** | nuova tabella |
| **Canc** | elimina la selezione |
| **Ctrl+Z** / **Ctrl+Maiusc+Z** | annulla / ripeti |

Allontanandosi i nodi si semplificano da soli: prima restano le sole colonne
chiave, poi il solo nome. L'icona della **chiave** nella barra tiene le sole
colonne chiave a qualsiasi ingrandimento.

## Modificare

**Doppio clic su un nodo** e la tabella si apre lì dov'è: colonne, vincoli,
indici e commento, senza finestre di mezzo. Non c'è un pulsante «salva» —
niente tocca il database finché non si applica, e \`Ctrl+Z\` annulla tutto.

Rinominando una colonna **la seguono da sole** la chiave primaria, gli indici e
ogni foreign key che la referenzia, in tutto il diagramma: i collegamenti
puntano all'identità della colonna, non al suo nome.

## Foreign key

Si trascina una colonna sopra un'altra tabella: rilasciando su una **colonna**
si collega quella, rilasciando sull'**intestazione** si punta alla chiave
primaria. **Doppio clic sulla linea** apre le impostazioni del vincolo: nome,
\`ON DELETE\`, stato, e la casella che crea l'**indice sulle colonne figlie** —
una FK senza quell'indice fa sì che ogni \`DELETE\` sul padre blocchi la
tabella figlia.

## Controlli

A destra ci sono le **modifiche in sospeso**, raggruppate per tabella e
annullabili una per una, e i **controlli**: nomi duplicati o troppo lunghi per
la versione di Oracle in uso (30 caratteri prima della 12.2, 128 dopo), tipi
incompatibili fra le due parti di una foreign key, riferimenti a colonne non
uniche, tabelle senza chiave primaria. Gli errori bloccano l'applicazione, gli
avvisi no.

## Applicare

Il pulsante **Applica** rilegge lo schema, calcola la differenza fra il
disegno e il database e ne ricava lo script — con le **rinomine in cima**,
perché tutto il resto le dà per fatte. Prima di eseguire qualsiasi cosa lo
script si vede, e per le tabelle da eliminare compare il **numero di righe**
che contengono.

Due strade: **aprire lo script in un foglio SQL** e lanciarlo a mano, oppure
eseguirlo da lì. Se nel frattempo qualcun altro ha modificato il database, il
diagramma lo dice e si ferma.

Le modifiche non applicate **non vengono salvate**: chiudendo la scheda si
perdono, e Orabridge lo chiede prima.
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

## Editor

| Tasti | Azione |
|---|---|
| \`Ctrl+Spazio\` | Autocomplete |
| \`Ctrl+F\` / \`Ctrl+H\` | Cerca / cerca e sostituisci |
| \`Invio\` / \`Maiusc+Invio\` / \`F3\` | Risultato successivo / precedente |
| \`Alt+C\` / \`Alt+W\` / \`Alt+R\` | Maiuscole/minuscole, parola intera, regex |
| \`Alt+L\` | Limita la ricerca alle righe selezionate |
| \`Ctrl+Maiusc+F\` | Formatta la selezione |
| \`Ctrl+Alt+F\` | Formatta tutto il foglio |

## Griglia

| Tasti | Azione |
|---|---|
| Clic sull'intestazione | Ordina per quella colonna |
| Trascinamento sulle celle | Seleziona un rettangolo |
| \`Ctrl+A\` / \`Ctrl+C\` | Seleziona tutto / copia la selezione |
| Doppio clic su una cella | Valore intero, oppure modifica (scheda Dati) |

## Finestra

| Tasti | Azione |
|---|---|
| \`Ctrl+B\` | Mostra/nascondi la barra laterale |
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
