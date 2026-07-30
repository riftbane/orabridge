# Changelog

Tutte le modifiche rilevanti a Orabridge sono documentate qui. Le versioni sono allineate tra `client/`, `server/` ed `electron/` (stesso numero ovunque).

## v1.27.0 — 2026-07-30

- **Nuovo:** Copilot si collega da solo, e ogni connessione decide se farsi vedere

  L'integrazione MCP leggeva solo i database che l'utente aveva già collegato a
  mano: metà delle volte Copilot rispondeva «chiedi all'utente di connettersi».
  Adesso una connessione esposta si collega da sé alla prima richiesta, con la
  password già salvata (senza password salvata non tenta niente e spiega cosa
  fare). Chiamate in parallelo sullo stesso database aspettano lo stesso
  collegamento, non ne aprono due.

  In cambio, l'accesso è per connessione e non più globale: ogni connessione ha
  il suo interruttore «Esponi a Copilot (MCP)», spento di default anche per
  quelle già salvate, e i suoi permessi. Lettura si imposta; Modifica ed
  Eliminazione si vedono e basta — sono forzate a false nello store, perché gli
  strumenti che servirebbero da MCP non escono affatto. Una connessione non
  esposta non compare in list_connections e non è nominabile nel parametro
  `connection`.

  Siccome Copilot lavora in un'altra finestra e ora apre connessioni da solo,
  quello che fa si vede mentre lo fa: voci di attività trasmesse su
  /api/mcp/events (SSE), la spina che pulsa accanto alla connessione nella barra
  laterale, la riga «Copilot sta leggendo», l'avviso quando apre un collegamento
  — che compare collegato come se l'avesse aperto l'utente — e la sezione
  «Attività in tempo reale» nelle impostazioni.

  Nel passaggio: una query di Copilot fallita finiva in cronologia marcata come
  dell'assistente AI invece che come sua.

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

- Build: [`Orabridge-Setup-1.27.0.exe`](https://github.com/riftbane/orabridge/releases/download/v1.27.0/Orabridge-Setup-1.27.0.exe) (2026-07-30).

## v1.26.1 — 2026-07-30

- **Fix:** il ponte MCP perdeva la risposta se stdin veniva chiuso subito

  Alla chiusura di stdin il ponte usciva con process.exit(0) senza aspettare le
  richieste in volo: la risposta a un messaggio già accettato non veniva mai
  scritta. Non si vede usandolo da VS Code, che tiene stdin aperto, ma chi lo
  pilota da uno script — manda i messaggi e chiude il tubo — lo trovava muto.

  Ora l'uscita aspetta che le richieste in corso scrivano la loro risposta, con
  un tetto di 15 secondi perché un processo che non muore è peggio di una
  risposta persa. Con la coda vuota, cioè il caso dell'editor, l'uscita resta
  immediata.

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

- Build: [`Orabridge-Setup-1.26.1.exe`](https://github.com/riftbane/orabridge/releases/download/v1.26.1/Orabridge-Setup-1.26.1.exe) (2026-07-30).

## v1.26.0 — 2026-07-30

- **Nuovo:** Copilot in VS Code legge i database collegati (MCP, sola lettura)

  Orabridge si fa interrogare via MCP dagli editor esterni: Copilot, in modalità
  agente, vede struttura, DDL, sorgenti PL/SQL e il risultato delle SELECT delle
  connessioni già attive nell'app, senza configurare una seconda connessione
  Oracle da nessuna parte.

  È di sola lettura per costruzione: l'elenco degli strumenti nasce filtrando
  quelli dell'assistente sul permesso `read`, quindi execute_sql non c'è, e
  runTool in sola lettura rifiuta le scritture anche se invocato direttamente. Le
  credenziali non escono dall'app: list_connections restituisce nome, schema
  corrente e versione del database, non utenza, host, servizio né password.

  Le query di Copilot girano su una connessione del pool e non sulla sessione
  dedicata del foglio SQL: non si accodano dietro alle query dell'utente, non
  vedono le sue modifiche non confermate e non gli lasciano lock in giro. In
  cronologia sono marcate con l'icona della spina.

  L'integrazione è spenta finché non si accende da Impostazioni → Copilot e MCP,
  dove compare anche la configurazione già compilata per mcp.json nelle varianti
  Windows e WSL. Il ponte stdio incluso nell'app risolve porta effimera e token
  rotante rileggendoli a ogni messaggio, e da un workspace WSL gira sul lato
  Windows tramite interop: nessuna porta esposta sulla rete, nessuna regola di
  firewall.

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

- Build: [`Orabridge-Setup-1.26.0.exe`](https://github.com/riftbane/orabridge/releases/download/v1.26.0/Orabridge-Setup-1.26.0.exe) (2026-07-30).

## v1.25.0 — 2026-07-30

- **Nuovo:** ricerca globale nel codice PL/SQL e barra laterale a viste

  Nuova vista «Ricerca nel codice»: cerca un testo dentro il sorgente PL/SQL di
  tutto il database — procedure, funzioni, trigger e package body, a richiesta
  anche specifiche dei package e tipi. Interruttori maiuscole/minuscole, parola
  intera ed espressioni regolari (sintassi Oracle); l'ambito va dallo schema di
  lavoro a tutti gli schemi applicativi, fino a tutti compresi quelli di Oracle.
  Il filtro viene eseguito in SQL su ALL_SOURCE invece di scaricare i sorgenti,
  con tetto a 1000 righe e timeout di due minuti sulle ricerche più larghe. I
  risultati sono raggruppati per oggetto: un clic apre l'oggetto sulla scheda
  Sorgente, salta alla riga e seleziona il testo trovato.

  La barra laterale diventa a viste, con la barra delle attività in stile VS Code
  sempre visibile anche a pannello chiuso: Connessioni (Ctrl+Maiusc+D),
  Connessione (Ctrl+Maiusc+E) — una sola connessione a tutta altezza, con stato,
  comandi rapidi, selettore di schema e albero degli oggetti — e Ricerca nel
  codice (Ctrl+Maiusc+F, che con il fuoco nell'editor resta «formatta»).

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

- Build: [`Orabridge-Setup-1.25.0.exe`](https://github.com/riftbane/orabridge/releases/download/v1.25.0/Orabridge-Setup-1.25.0.exe) (2026-07-30).

## v1.24.1 — 2026-07-29

- **Fix:** il bottone del diagramma a nodi non compariva nella barra del titolo dell'app desktop

  TitleBar.jsx (usata al posto della sidebar-head quando CUSTOM_TITLE_BAR è attivo) non era stata aggiornata insieme a Sidebar.jsx quando è arrivato l'editor a nodi.

- Build: [`Orabridge-Setup-1.24.1.exe`](https://github.com/riftbane/orabridge/releases/download/v1.24.1/Orabridge-Setup-1.24.1.exe) (2026-07-29).

## v1.24.0 — 2026-07-29

- **Nuovo:** editor a nodi per disegnare e modificare lo schema (beta)

  Lo schema come grafo: ogni tabella è un nodo, ogni foreign key un
  collegamento fra due colonne, e ci si lavora dentro senza tornare
  all'albero degli oggetti.

  Il disegno *è* una fotografia dello schema, quindi applicare le modifiche
  è il confronto fra quella disegnata e quella letta dal database, generato
  con il motore che già serve il DB Diff. Il disegno però è indicizzato per
  id stabile invece che per nome: il confronto accoppia gli oggetti per
  nome, e una tabella rinominata sembrerebbe «eliminata e ricreata». Un
  passaggio dedicato emette le rinomine — che vanno in cima allo script — e
  riscrive la fotografia di partenza come sarà dopo di esse, così da lì in
  poi si vedono solo le differenze vere. Dallo stesso accorgimento arriva la
  propagazione automatica: rinominando una colonna la seguono da sole la
  chiave, gli indici e ogni FK che la referenzia.

  - disposizione automatica a livelli, posizioni salvate per
    connessione+schema; allontanandosi i nodi si semplificano da sé, così
    anche uno schema grande resta navigabile
  - doppio clic su un nodo e la tabella si modifica lì dov'è; le FK si
    creano trascinando una colonna su un'altra tabella, e il pannello del
    vincolo offre l'indice sulle colonne figlie
  - controlli continui su tutto lo schema: nomi duplicati o troppo lunghi
    per la versione di Oracle in uso, tipi incompatibili fra le due parti di
    una FK, riferimenti a colonne non uniche
  - l'applicazione rilegge lo schema e si ferma se il database è cambiato
    nel frattempo; lo script si vede sempre prima, con il conteggio righe
    delle tabelle da eliminare e la conferma da digitare

  Modello, rinomine e generazione dello script sono funzioni pure e
  testate, invariante compreso: aprire un diagramma e applicarlo senza
  toccare nulla produce uno script vuoto.

  Progetto e stato del lavoro in docs/editor-a-nodi.md e
  docs/editor-a-nodi-roadmap.md.

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
- **Fix:** il confronto non perde più il commento di una colonna aggiunta

  `d.columnComments` accoppia solo le colonne presenti da entrambe le parti:
  il commento di una colonna *aggiunta* a una tabella che esiste già non
  finiva nello script, mentre in una tabella creata da zero veniva emesso.
  Asimmetria non voluta, che riguardava anche il DB Diff.

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

- Build: [`Orabridge-Setup-1.24.0.exe`](https://github.com/riftbane/orabridge/releases/download/v1.24.0/Orabridge-Setup-1.24.0.exe) (2026-07-29).

## v1.23.0 — 2026-07-29

- **Nuovo:** selezione massiva e filtri per stato nel confronto fra database

  Deselezionare gli oggetti voleva dire togliere la spunta a una categoria
  per volta, scorrendo l'elenco fino in fondo. Ora sotto la casella di
  ricerca ci sono tutti / nessuno / inverti, che agiscono su ciò che è in
  elenco in quel momento: combinati con i filtri per stato — solo origine,
  solo destinazione, diversi, uguali, ognuno con il suo conteggio — scelgono
  un blocco intero in un colpo solo, per esempio «solo origine» + «tutti»
  per creare nella destinazione ciò che le manca. I filtri per stato
  prendono il posto della casella che mostrava anche gli oggetti identici.

  Le categorie si comprimono, una alla volta dal titolo o tutte insieme, e la
  spunta di gruppo mostra lo stato intermedio quando la selezione è parziale.
  Anche i tipi di oggetto da confrontare hanno il loro tutti / nessuno.

  Lo script di sincronizzazione ora sopravvive al passaggio fra le due schede
  — prima tornando alle differenze andava perso e bisognava rigenerarlo — e
  viene invece azzerato quando cambia la selezione o l'opzione dei DROP, così
  quello che si copia corrisponde sempre a ciò che è spuntato.

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
- **Fix:** il confronto non inventa più differenze sulle colonne di identità

  Il DEFAULT di una colonna era l'unico pezzo di DDL a non passare dal remap
  dello schema: la tabella creata nella destinazione continuava a pescare
  dalla sequenza dell'origine ("SPAEC"."ACQUISTO_RFQ" con DEFAULT
  "SPASS"."SEQ_ID_RFQ"."NEXTVAL"). Stesso buco nelle espressioni degli indici
  funzionali.

  Le colonne di identità venivano confrontate sul testo del loro default,
  cioè sul nome della sequenza che Oracle si crea dietro le quinte: quel
  numero è un id interno del database, quindi "SSPE"."ISEQ$$_176443".nextval
  e "SS"."ISEQ$$_593557".nextval risultavano diversi pur essendo la stessa
  cosa. Ora la colonna si legge da all_tab_identity_cols e si confronta sul
  tipo di generazione, e le sequenze ISEQ$$ spariscono dall'elenco degli
  oggetti, dove erano rumore garantito (comparivano sempre in coppia, una
  solo in origine e una solo in destinazione). Se quella vista non è
  leggibile — 11g o privilegi scarsi — resta una rete di sicurezza che
  riconosce quei default dal nome. Lo script emette GENERATED … AS IDENTITY
  invece di agganciare la tabella a una sequenza che nella destinazione non
  esiste.

  Nell'occasione, altre tre cose che producevano DDL da correggere a mano: le
  colonne virtuali venivano ricreate con l'espressione di calcolo al posto
  del DEFAULT, una colonna NOT NULL senza DEFAULT non può essere aggiunta a
  una tabella che ha già righe (ora c'è un avviso prima dell'istruzione) e
  identità ed espressioni virtuali non si cambiano con un MODIFY: vengono
  segnalate invece di generare un'istruzione che fallisce.

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

- Build: [`Orabridge-Setup-1.23.0.exe`](https://github.com/riftbane/orabridge/releases/download/v1.23.0/Orabridge-Setup-1.23.0.exe) (2026-07-29).

## v1.22.0 — 2026-07-28

- **Nuovo:** il formattatore SQL allinea le clausole a destra del «fiume»

  Le parole chiave di clausola sono allineate a destra entro una colonna
  fissa (SELECT la riempie, FROM rientra di due, AND di tre) e gli elenchi
  vanno sempre a capo, una voce per riga allineata sotto la prima, anche
  quando la riga starebbe comoda. Le condizioni si spezzano su AND/OR, che
  tornano nel fiume come le clausole.

  SELECT … INTO, UPDATE … SET e RETURNING … INTO aprono la propria riga.
  Corretti tre casi che venivano spezzati male: FOR UPDATE finiva a metà
  riga, ORDER SIBLINGS BY non era riconosciuto come clausola e DELETE FROM
  si spezzava in due.

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

- Build: [`Orabridge-Setup-1.22.0.exe`](https://github.com/riftbane/orabridge/releases/download/v1.22.0/Orabridge-Setup-1.22.0.exe) (2026-07-28).

## v1.21.1 — 2026-07-28

- **Fix:** il server locale dell'app desktop risponde solo alla sua finestra

  L'app desktop si porta dentro un server HTTP, e quel server era aperto a
  chiunque sulla macchina: la porta restava fissa su 3000 (`Number('0') ||
  3000` scambiava la richiesta di una porta effimera per «porta non
  impostata») e nessuna richiesta doveva dimostrare di arrivare dalla
  finestra dell'app. Bastava aprire localhost:3000 dal browser per
  ritrovarsi Orabridge in mano, connessioni Oracle già attive comprese.

  Ora la porta è davvero effimera e il main genera a ogni avvio un token
  casuale, che inietta come header in tutte le richieste della finestra a
  livello di rete: vale per il documento, per il bundle, per /api e per gli
  EventSource della chat, che da JavaScript non potrebbero mandare header
  propri. Chi quel token non ce l'ha trova una pagina che gli dice di usare
  l'app. Nel deployment web/Docker il token non c'è e il controllo resta
  spento: lì il server è il servizio, non un dettaglio interno.

  Nell'occasione, tre porte chiuse anche per il deployment web: HOST vale
  127.0.0.1 se non lo si cambia (il Dockerfile chiede 0.0.0.0
  esplicitamente), l'header Host viene verificato quando si ascolta il
  loopback — è così che una pagina web aggira le protezioni sull'origine,
  puntando il proprio dominio a 127.0.0.1 — e le scritture cross-site
  vengono rifiutate, con ORABRIDGE_ALLOWED_ORIGINS per chi sta dietro un
  reverse proxy. Il proxy di Vite riscrive Host e Origin, altrimenti lo
  sviluppo su :5173 finirebbe bocciato dai controlli nuovi.

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
- **Fix:** il logo nella barra del titolo non si legge più «Ora bridge»

  Il nome era in due nodi distinti (lo span «Ora» colorato e il testo
  «bridge»), e dentro il flex della testata il gap di 7px li separava anche
  visivamente. Ora stanno in un elemento solo.

  Sparisce anche la riga delle schede quando nell'app desktop non ce n'è
  nessuna aperta: gli interruttori dei pannelli sono saliti in testata,
  quindi sopra la schermata iniziale restava una striscia vuota di 34px.

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

- Build: [`Orabridge-Setup-1.21.1.exe`](https://github.com/riftbane/orabridge/releases/download/v1.21.1/Orabridge-Setup-1.21.1.exe) (2026-07-28).

## v1.21.0 — 2026-07-28

- **Nuovo:** la finestra desktop usa la barra del titolo e perde il cromo da browser

  Nell'app desktop la barra del titolo di sistema è nascosta e la disegna
  l'app, nei suoi colori: a sinistra logo e comandi generali (nuova
  connessione, importazione, cronologia, DB Diff), a destra interruttori
  dei pannelli, guida e impostazioni, in mezzo la zona che trascina la
  finestra. Windows continua a disegnarci sopra solo i tre pulsanti, e lo
  spazio che ci lascia libero arriva dalle variabili env(titlebar-area-*).

  I comandi si sono spostati, non duplicati: nell'app desktop spariscono la
  testata della barra laterale (l'elenco delle connessioni guadagna la sua
  altezza, e i comandi restano a portata anche a barra chiusa) e gli
  interruttori in fondo alla riga delle schede, che ora è tutta per le
  schede. Il client web resta com'era.

  Spariscono anche gli strumenti da browser, che in un client SQL sono solo
  un modo per rompere qualcosa: niente barra dei menu (File/Modifica/
  Visualizza compariva con Alt) e niente DevTools — nella versione
  installata sono disattivati e le scorciatoie F12, Ctrl+Shift+I/J/C e
  Ctrl+R vengono ignorate; in sviluppo F12 continua ad aprirli.

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

- Build: [`Orabridge-Setup-1.21.0.exe`](https://github.com/riftbane/orabridge/releases/download/v1.21.0/Orabridge-Setup-1.21.0.exe) (2026-07-28).

## v1.20.0 — 2026-07-28

- **Nuovo:** novità delle versioni lette da GitHub Releases

  La sezione «Aggiornamenti e novità» della guida e la scheda Informazioni
  mostravano un elenco scritto a mano in guide.js, fermo alla 1.17 mentre
  l'app era alla 1.19. Ora le novità arrivano dalle release pubblicate su
  GitHub — le stesse da cui electron-updater scarica gli aggiornamenti — con
  le note di ogni versione, la data e il confronto con la versione in uso.
  
  L'elenco passa dal server (GET /api/releases, mezz'ora di cache) e non dal
  browser: la richiesta è una sola per tutti, non dipende dalla CORS di
  api.github.com e non consuma le 60 chiamate all'ora concesse per IP. Senza
  rete si risponde con l'elenco vuoto e il motivo, e il client ripiega sulle
  novità impacchettate nel bundle (aggiornate fino alla 1.19).
  
  Le note pubblicate sono la voce di CHANGELOG.md di quel rilascio: si
  tolgono l'intestazione della versione, la riga dell'installer e i trailer
  dei commit, che nella guida sono rumore. Il generatore del changelog manda
  ora il corpo del commit a capo e rientrato invece di attaccarlo all'oggetto
  ("…senza API key Nuova piattaforma…" era illeggibile, e finiva così anche
  nelle note della release).
  
  Nel desktop i collegamenti esterni si aprono nel browser di sistema: prima
  finivano in una finestra Electron nuda, senza preload e senza modo di
  tornare indietro.
  
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
- **Fix:** istruzioni e strumenti più chiari per i modelli piccoli

  I modelli deboli (Gemma locale, ma non solo) si fermavano al primo passo:
  elencavano le tabelle e poi chiedevano all'utente quale usare, oppure
  cercavano "ORDERS" in un database che le chiama ORDINI, leggevano l'elenco
  vuoto come "non esiste" e si arrendevano. Tre interventi:
  
  - l'elenco delle tabelle e delle viste dello schema corrente entra nel
    prompt di sistema, letto dal dizionario e tenuto in cache cinque minuti
    per connessione: il nome giusto ce l'hanno già sotto gli occhi invece di
    doverlo scoprire. Tetto di 150 nomi, perché in locale il contesto è 8k in
    tutto; se il dizionario non è leggibile il turno prosegue senza
  - gli strumenti non restituiscono più vicoli ciechi: list_objects con un
    filtro che non trova nulla rifà la ricerca senza filtro e restituisce
    l'elenco completo, e describe_table su un nome inventato allega le
    tabelle che esistono davvero in quello schema
  - prompt di sistema riscritto per modelli piccoli: procedura numerata
    (scegli le tabelle → describe_table → run_query → rispondi), divieto
    esplicito di chiedere all'utente ciò che il database può dire e di
    fermarsi a metà, più due ricette SQL per le classifiche
  
  La parte pura del prompt è ora buildSystemPrompt(), coperta da test insieme
  ai formatter degli elenchi.
  
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

- Build: [`Orabridge-Setup-1.20.0.exe`](https://github.com/riftbane/orabridge/releases/download/v1.20.0/Orabridge-Setup-1.20.0.exe) (2026-07-28).

## v1.19.0 — 2026-07-28

- **Nuovo:** modello Gemma 4 locale, gratis e senza API key Nuova piattaforma «Modello locale» accanto a OpenRouter, Anthropic, Gemini
e OpenAI: il modello gira dentro Orabridge, sul computer dell'utente, senza
chiave e senza costi. Il motore llama.cpp (node-llama-cpp) è incluso
nell'installer, quindi non c'è niente da installare a parte — né Ollama né
Python né compilatori. Il file dei pesi si scarica una volta dalle
impostazioni, con barra di avanzamento e ripresa se cade la rete.

Si sceglie fra tre varianti di Gemma 4: E2B equilibrato (consigliata), E2B
leggero ed E4B per chi ha 16 GB di RAM. I pesi non stanno nell'installer
perché anche la taglia più piccola quantizzata a 4 bit occupa 3,1 GB, oltre
il limite di 2 GB per file delle release GitHub.

Dettagli d'integrazione:
- le chiamate agli strumenti passano dalla grammatica di llama.cpp, che
  ignora `required` e pretende tutte le proprietà: i parametri facoltativi
  diventano «o null o il valore» e i null si tolgono prima di eseguire
- le generazioni locali si mettono in fila, perché il modello caricato è
  uno solo e due sessioni in parallelo si calpesterebbero il contesto
- durante il caricamento del modello lo stream manda un battito, altrimenti
  la guardia sui turni dichiarerebbe la sessione piantata
- nell'installer entrano solo i binari win-x64 e win-x64-vulkan: tenerli
  tutti costerebbe 660 MB invece di 120 (Vulkan accelera anche su NVIDIA)
- l'import di node-llama-cpp è dinamico: dove i binari non ci sono (Docker,
  sviluppo su Linux) la piattaforma si disattiva da sola e il resto parte

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

- Build: [`Orabridge-Setup-1.19.0.exe`](https://github.com/riftbane/orabridge/releases/download/v1.19.0/Orabridge-Setup-1.19.0.exe) (2026-07-28).

## v1.18.0 — 2026-07-28

- **Nuovo:** indicatori dei token spesi per richiesta e per sessione Sotto ogni risposta compaiono piattaforma, modello e token di quella
richiesta; in cima al pannello il totale della sessione. Il passaggio del
mouse apre il dettaglio per voce (input, input da cache, scrittura cache,
output, di cui ragionamento) con il numero di chiamate al modello e, dove
la piattaforma lo dichiara (OpenRouter), il costo in crediti.

I conteggi arrivavano incompleti: da Anthropic si leggeva solo il
`message_delta`, senza i token di input che stanno nel `message_start`, e
da OpenAI/OpenRouter non arrivavano affatto, perché in streaming l'usage va
chiesto con `stream_options.include_usage`. Ora le voci vengono normalizzate
in `server/src/ai/usage.js` in modo che non si sovrappongano mai — dove la
piattaforma conta la cache dentro il prompt (OpenAI, Gemini) viene
scorporata — così la somma è il totale vero dei token.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

- Build: [`Orabridge-Setup-1.18.0.exe`](https://github.com/riftbane/orabridge/releases/download/v1.18.0/Orabridge-Setup-1.18.0.exe) (2026-07-28).

## v1.17.2 — 2026-07-28

- **Fix:** i dati delle tabelle si vedono anche su Oracle 11g La paginazione del tab Dati usava OFFSET/FETCH NEXT, sintassi disponibile
solo da Oracle 12c: su 11g la SELECT falliva con ORA-00933 e il grid restava
vuoto. Ora la paginazione usa ROWNUM, compatibile con tutte le versioni.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

- Build: [`Orabridge-Setup-1.17.2.exe`](https://github.com/riftbane/orabridge/releases/download/v1.17.2/Orabridge-Setup-1.17.2.exe) (2026-07-28).

## v1.17.1 — 2026-07-28

- **Fix:** i modali non si chiudono più cliccando fuori Il click sullo sfondo chiudeva la finestra anche mentre si stava
lavorando, perdendo i dati inseriti. Ora i modali sono persistenti e si
chiudono solo dal pulsante di chiusura (o dai bottoni Annulla/Chiudi già
presenti): connessione, impostazioni, importa connessioni, password,
anteprima valore cella e i dialoghi DDL (tabelle e oggetti).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

- Build: [`Orabridge-Setup-1.17.1.exe`](https://github.com/riftbane/orabridge/releases/download/v1.17.1/Orabridge-Setup-1.17.1.exe) (2026-07-28).

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

- Build: [`Orabridge-Setup-1.17.0.exe`](https://github.com/riftbane/orabridge/releases/download/v1.17.0/Orabridge-Setup-1.17.0.exe) (2026-07-28).

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

- Build: [`Orabridge-Setup-1.16.0.exe`](https://github.com/riftbane/orabridge/releases/download/v1.16.0/Orabridge-Setup-1.16.0.exe) (2026-07-28).

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

- Build: [`Orabridge-Setup-1.15.0.exe`](https://github.com/riftbane/orabridge/releases/download/v1.15.0/Orabridge-Setup-1.15.0.exe) (2026-07-28).

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

- Build: [`Orabridge-Setup-1.14.0.exe`](https://github.com/riftbane/orabridge/releases/download/v1.14.0/Orabridge-Setup-1.14.0.exe) (2026-07-28).

## v1.13.1 — 2026-07-28

- **Fix:** autocomplete senza corrispondenze sparse CodeMirror accettava anche le lettere digitate sparpagliate ovunque nel
nome: su uno schema con migliaia di oggetti "sele" proponeva
DBMS_SCHEDULER o SPRINT_ELEMENTS_OLD. I candidati vengono ora filtrati
nella sorgente prima di passarli a CodeMirror: restano i nomi che
contengono il testo digitato, quelli che ne ricalcano le iniziali delle
parole e quelli che lo si può leggere dall'inizio saltando di parola in
parola (wbsd -> WBS_DEFAULT_OWNER).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

- Build: [`Orabridge-Setup-1.13.1.exe`](https://github.com/riftbane/orabridge/releases/download/v1.13.1/Orabridge-Setup-1.13.1.exe) (2026-07-28).

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

- Build: [`Orabridge-Setup-1.13.0.exe`](https://github.com/riftbane/orabridge/releases/download/v1.13.0/Orabridge-Setup-1.13.0.exe) (2026-07-28).

## v1.12.6 — 2026-07-28

- **Fix:** nessun errore quando la release non ha ancora l'installer Se il workflow di rilascio ha già creato tag e release ma non ha ancora
pubblicato l'.exe e latest.yml, electron-updater falliva con
ERR_UPDATER_CHANNEL_FILE_NOT_FOUND e la scheda «Informazioni» mostrava un
muro di stack trace. Ora questi casi (canale/asset/versione non trovati)
vengono trattati come «nessun aggiornamento disponibile»; gli errori veri
(rete, ecc.) restano visibili ma ridotti alla sola prima riga.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

- Build: [`Orabridge-Setup-1.12.6.exe`](https://github.com/riftbane/orabridge/releases/download/v1.12.6/Orabridge-Setup-1.12.6.exe) (2026-07-28).

## v1.12.5 — 2026-07-28

- **Fix:** connessioni attive non visibili nei gruppi chiusi Con i gruppi chiusi non c'era modo di sapere dove fosse una connessione
aperta: l'intestazione mostrava solo il totale delle connessioni.

Ora accanto al conteggio del gruppo compare un badge verde con il numero
di connessioni attive (visibile anche a gruppo chiuso) e il bordo
sinistro del gruppo diventa verde quando ne contiene almeno una.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

- Build: [`Orabridge-Setup-1.12.5.exe`](https://github.com/riftbane/orabridge/releases/download/v1.12.5/Orabridge-Setup-1.12.5.exe) (2026-07-28).

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

- Build: [`Orabridge-Setup-1.12.4.exe`](https://github.com/riftbane/orabridge/releases/download/v1.12.4/Orabridge-Setup-1.12.4.exe) (2026-07-28).

## v1.12.3 — 2026-07-28

- **Fix:** gruppi di connessioni chiusi all'avvio I gruppi nella barra laterale partivano tutti aperti a ogni avvio, così
bisognava chiuderli a mano per trovare la connessione giusta. Ora lo stato
tracciato è quello dei gruppi aperti, con default chiuso; "Senza gruppo"
resta aperto perché non è un vero gruppo (altrimenti chi non usa i gruppi
troverebbe la lista vuota). La ricerca continua a forzare l'apertura.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

- Build: [`Orabridge-Setup-1.12.3.exe`](https://github.com/riftbane/orabridge/releases/download/v1.12.3/Orabridge-Setup-1.12.3.exe) (2026-07-28).

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

- Build: [`Orabridge-Setup-1.12.2.exe`](https://github.com/riftbane/orabridge/releases/download/v1.12.2/Orabridge-Setup-1.12.2.exe) (2026-07-28).

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

- Build: [`Orabridge-Setup-1.12.1.exe`](https://github.com/riftbane/orabridge/releases/download/v1.12.1/Orabridge-Setup-1.12.1.exe) (2026-07-28).

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

- Build: [`Orabridge-Setup-1.12.0.exe`](https://github.com/riftbane/orabridge/releases/download/v1.12.0/Orabridge-Setup-1.12.0.exe) (2026-07-27).

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

- Build: [`Orabridge-Setup-1.11.0.exe`](https://github.com/riftbane/orabridge/releases/download/v1.11.0/Orabridge-Setup-1.11.0.exe) (2026-07-27).

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

- Build: [`Orabridge-Setup-1.10.0.exe`](https://github.com/riftbane/orabridge/releases/download/v1.10.0/Orabridge-Setup-1.10.0.exe) (2026-07-27).

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

- Build: [`Orabridge-Setup-1.9.0.exe`](https://github.com/riftbane/orabridge/releases/download/v1.9.0/Orabridge-Setup-1.9.0.exe) (2026-07-27).

## v1.8.0 — 2026-07-27

- **Nuovo:** aggiunge barra di ricerca per le connessioni Filtra le connessioni per nome, gruppo, utente o servizio; durante la
ricerca i gruppi vengono espansi automaticamente per mostrare i
risultati.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

- Build: [`Orabridge-Setup-1.8.0.exe`](https://github.com/riftbane/orabridge/releases/download/v1.8.0/Orabridge-Setup-1.8.0.exe) (2026-07-27).

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

- Build: [`Orabridge-Setup-1.7.0.exe`](https://github.com/riftbane/orabridge/releases/download/v1.7.0/Orabridge-Setup-1.7.0.exe) (2026-07-27).

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

- Build: [`Orabridge-Setup-1.6.0.exe`](https://github.com/riftbane/orabridge/releases/download/v1.6.0/Orabridge-Setup-1.6.0.exe) (2026-07-27).

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

- Build: [`Orabridge-Setup-1.5.2.exe`](https://github.com/riftbane/orabridge/releases/download/v1.5.2/Orabridge-Setup-1.5.2.exe) (2026-07-27).

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

- Build: [`Orabridge-Setup-1.5.1.exe`](https://github.com/riftbane/orabridge/releases/download/v1.5.1/Orabridge-Setup-1.5.1.exe) (2026-07-27).

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
