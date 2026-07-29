# Editor a nodi — progetto

Modalità di lavoro in cui lo schema si vede e si modifica come un grafo: ogni
tabella è un nodo, ogni foreign key è un collegamento fra due colonne. Entrato
in questa modalità l'utente deve poter fare tutto da lì — creare, modificare,
collegare, eliminare — senza tornare all'albero degli oggetti.

Il documento è il progetto, non il codice: descrive il modello dei dati, il
flusso di applicazione delle modifiche, l'interazione e l'ordine in cui
costruire le cose.

---

## 1. L'idea portante: il grafo *è* uno snapshot

Orabridge ha già, per il confronto fra database, tutto il motore che serve:

| Cosa                             | Dove                          | Che forma ha                            |
| -------------------------------- | ----------------------------- | --------------------------------------- |
| Legge uno schema normalizzato    | `server/src/diff/snapshot.js` | `{ tables, views, sequences, … }`       |
| Confronta due schemi             | `server/src/diff/compare.js`  | funzione pura → elenco di differenze    |
| Genera il DDL di allineamento    | `server/src/diff/script.js`   | funzione pura → script in sezioni       |

`readSnapshot()` produce già un modello completo di tabelle, colonne, vincoli,
indici e commenti in una manciata di query bulk. `buildSyncScript(src, tgt, …)`
produce già lo script che porta `tgt` allo stato di `src`, in ordine di
dipendenza, con le note sui casi pericolosi (colonne NOT NULL senza default,
colonne di identità, viste materializzate da ricreare).

Da qui la decisione centrale del progetto:

> **Il diagramma è uno snapshot modificabile. Applicare le modifiche significa
> fare il diff fra lo snapshot disegnato e quello letto dal database, e
> generare lo script con il motore che già esiste.**

```
  base            = readSnapshot(conn, owner)         ← com'è il database ora
    │ import()      assegna id stabili, aggancia il layout
    ▼
  draft           = il grafo che l'utente modifica    ← indicizzato per id
    │ project()     torna alla forma "snapshot", indicizzata per nome
    ▼
  draftSnap ──┐
              ├─ renamePass(draft, base) ──► { sqlRinomine[], baseRibasata }
  base ───────┘
              │
              ▼
  compareSnapshots(draftSnap, baseRibasata)  →  items
              │
              ▼
  buildSyncScript(draftSnap, baseRibasata, items, { includeDrops })
              │
              ▼
  sqlRinomine + script  →  anteprima  →  esegui / apri nel foglio SQL
```

Tre delle cinque caselle esistono già e sono coperte da test. Quello che va
scritto è `import()`, `project()` e `renamePass()` — tutte funzioni pure.

**Verso del confronto.** `buildSyncScript(src, tgt)` porta `tgt` allo stato di
`src` e crea nello schema `tgt.owner`. Quindi `src = draft`, `tgt = base`:
lo schema in cui si scrive resta quello vero. `remapDdl` diventa un no-op
perché i due owner coincidono — nessuna sorpresa.

---

## 2. Modello dei dati

### 2.1 Perché non si può usare direttamente lo snapshot

Lo snapshot è indicizzato per **nome**. `compareSnapshots` accoppia gli oggetti
per nome. Se il diagramma fosse uno snapshot, rinominare una tabella
apparirebbe come *elimina la vecchia + crea la nuova*: perdita di dati
silenziosa. Inaccettabile.

Il draft è quindi indicizzato per **id stabile**, e ogni oggetto ricorda con
quale nome è stato letto:

```js
draft = {
  owner: 'APP',
  tables: {
    't_1a2b': {
      id: 't_1a2b',
      base: 'CLIENTI',        // nome nel dizionario, null se nuova
      name: 'CLIENTI',        // nome corrente nel disegno
      comment: '…',
      deleted: false,
      columns: [
        { id: 'c_9f', base: 'ID', name: 'ID', type: 'NUMBER(10)',
          notNull: true, default: null, identity: 'BY DEFAULT',
          virtual: false, comment: null },
        …
      ],
      constraints: [
        { id: 'k_3d', base: 'CLIENTI_PK', name: 'CLIENTI_PK', type: 'P',
          columnIds: ['c_9f'], … },
        { id: 'k_7e', base: null, name: 'ORDINI_FK_CLIENTI', type: 'R',
          columnIds: ['c_11'], refTableId: 't_1a2b', refColumnIds: ['c_9f'],
          deleteRule: 'CASCADE', disabled: false, generated: false },
      ],
      indexes: [ … ],
    },
  },
  sequences: { … },
  ghosts: { … },   // tabelle di altri schemi referenziate da una FK
}
```

Due dettagli che fanno la differenza:

- **I vincoli puntano a `columnId`, non a nomi di colonna.** È questo che fa
  funzionare la promessa «rinomini e si aggiorna tutto»: cambiare
  `column.name` non tocca nessuna FK, nessun indice, nessuna PK. La
  proiezione risolve gli id in nomi *al momento della proiezione*.
- **Le FK puntano a `refTableId`.** Rinominare la tabella padre aggiorna da
  sola ogni FK che la referenzia, in tutto il diagramma.

### 2.2 `project()` — dal draft allo snapshot

Funzione pura: risolve gli id in nomi, scarta le tabelle `deleted`, riordina le
colonne secondo l'ordine nel nodo, ricostruisce esattamente la forma che
`compare.js` e `script.js` si aspettano.

**Invariante da testare per prima cosa:**

```js
project(import(snap)) ≡ snap
```

Se vale, allora *aprire il diagramma e applicarlo senza toccare nulla genera
uno script vuoto*. È il singolo test più importante di tutta la funzionalità:
finché non passa, non si scrive una riga di UI.

### 2.3 Invariante del sottoinsieme visibile

Uno schema da 400 tabelle non si disegna tutto. Ma se il draft contenesse solo
le tabelle caricate sul canvas, il diff proporrebbe di **eliminare tutte le
altre**.

> **Regola: il draft contiene sempre lo snapshot completo. Il canvas è una
> vista su un sottoinsieme.**

Un nodo non disegnato è `visible: false` nel layout — non `deleted`.
L'eliminazione è un atto esplicito (`deleted: true`), e solo le tabelle con
quel flag spariscono dalla proiezione, diventando `only-target` nel confronto e
quindi `DROP` nello script.

---

## 3. Rinomine: `renamePass()`

Prima del confronto, un passaggio puro percorre il draft e:

1. raccoglie gli oggetti con `base !== null && base !== name`;
2. emette le istruzioni di rinomina, che vanno **in cima allo script**:
   - `ALTER TABLE … RENAME TO …`
   - `ALTER TABLE … RENAME COLUMN … TO …`
   - `ALTER TABLE … RENAME CONSTRAINT … TO …`
   - `ALTER INDEX … RENAME TO …`
3. restituisce una **copia ribasata di `base`** in cui quegli oggetti hanno già
   il nome nuovo.

Da lì in poi `compareSnapshots(draftSnap, baseRibasata)` vede solo le
differenze vere. Una colonna rinominata *e* modificata funziona: il
`RENAME COLUMN` viene prima, il `MODIFY` successivo usa già il nome nuovo.

**Caso da rifiutare:** lo scambio di nomi (`A→B` mentre `B→A`, o qualsiasi
ciclo). Non è risolvibile in un passaggio e un nome temporaneo automatico
sarebbe una sorpresa sgradita su un database di produzione. Errore di
validazione esplicito: *«scambio di nomi non supportato: applica in due
passaggi»*.

---

## 4. Applicare le modifiche

### 4.1 Controllo di deriva

Fra l'apertura del diagramma e l'applicazione possono passare ore, e nel
frattempo qualcun altro può aver modificato il database. Prima di generare lo
script si rilegge lo snapshot e lo si confronta con `base`
(`compareSnapshots`, già disponibile):

- identici → si procede;
- diversi → si mostra cosa è cambiato e si offre **«ribasa»** (rileggo il
  database come nuova base e ci riporto sopra le tue modifiche) oppure
  **«annulla»**. Mai applicare al buio.

### 4.2 Anteprima e esecuzione

L'anteprima riusa l'impianto di `DdlModal`: SQL a sinistra, riepilogo a
destra. Due pulsanti, con l'ordine che indica la preferenza:

1. **«Apri nel foglio SQL»** — l'opzione di default e quella consigliata. È la
   stessa disciplina del DB Diff: lo script si rilegge e si lancia a mano.
2. **«Applica»** — esegue istruzione per istruzione, si ferma al primo errore e
   dice esattamente quante ne sono passate. Il DDL fa commit implicito: un
   errore a metà lascia lo schema in uno stato intermedio, quindi **dopo ogni
   applicazione — riuscita o fallita — si rilegge lo snapshot e si ribasa il
   grafo**. Mai fidarsi di quello che si pensava di aver scritto.

### 4.3 Regole di sicurezza

Non negoziabili, è pur sempre uno strumento che scrive su database veri:

1. Nessuna istruzione parte senza che l'SQL sia stato mostrato.
2. `includeDrops` è **acceso di default**, al contrario del DB Diff: lì
   «presente solo nella destinazione» vuol dire *roba che si trova lì*, qui
   ogni eliminazione è un atto esplicito dell'utente e ignorarla
   significherebbe non fare quello che ha chiesto.
3. Per ogni tabella che verrà eliminata, l'anteprima mostra il **numero di
   righe** (`/table/count`, esiste già). Con righe presenti serve una conferma
   digitata.
4. `DROP TABLE … CASCADE CONSTRAINTS` — quello che script.js emette — elimina
   anche le FK di *altri* schemi che puntano lì. Prima di un drop si
   interrogano le FK entranti (`all_constraints` con `r_owner = :owner`) e le
   si elenca nell'anteprima: sono l'unica cosa che lo snapshot di un solo
   schema non vede.
5. Restringere un tipo (`VARCHAR2(100)` → `(50)`), togliere una colonna,
   cambiare la PK: avviso in anteprima con la ragione.
6. Colonne di identità e virtuali: `script.js` già emette una nota che vanno
   ricreate a mano. In beta l'editor **blocca** la modifica della generazione o
   dell'espressione, spiega perché, e offre «apri il DDL nel foglio SQL».

---

## 5. Il canvas

### 5.1 Costruito su misura, senza dipendenze nuove

React Flow risolverebbe pan/zoom/selezione, ma la parte che conta qui —
**ancore a livello di colonna** e instradamento ortogonale fra due righe
interne a due nodi — va scritta comunque a mano, e i nodi devono essere DOM per
l'editing in place. Restano pan, zoom e rubber band: circa 150 righe. Il
progetto ha 5 dipendenze runtime e ogni MB finisce in un installer Windows:
non vale una dipendenza nuova.

*Se durante la fase 1 il canvas si rivelasse più oneroso del previsto*,
`@xyflow/react` resta l'uscita di sicurezza — il modello dei dati qui descritto
non cambia, cambia solo `Canvas.jsx`.

### 5.2 Geometria calcolata, non misurata

Regola fondamentale per la fluidità: **le posizioni si calcolano dal modello,
mai con `getBoundingClientRect`**. Altrimenti gli archi arrivano un frame dopo i
nodi durante il trascinamento, e il culling non si può fare.

- Altezza riga costante (`ROW_H = 22`), intestazione costante (`HEAD_H = 26`).
- Ancora della colonna *i*: `y = node.y + HEAD_H + i * ROW_H + ROW_H / 2`.
- Larghezza del nodo: calcolata dal nome più lungo alla creazione, poi salvata
  nel layout e ridimensionabile a mano.

### 5.3 Livelli di dettaglio e culling

Uno schema grande deve restare navigabile:

| Zoom     | Cosa si vede                                          |
| -------- | ----------------------------------------------------- |
| > 0.6    | nodo completo: colonne, tipi, badge PK/FK/NN          |
| 0.25–0.6 | intestazione + sole colonne chiave, resto in «+12»    |
| < 0.25   | rettangolo con il nome                                |

Più il culling: si disegnano solo i nodi che intersecano il viewport allargato
di un margine. Sotto le ~2000 tabelle basta un ciclo, niente quadtree.

Pan e zoom sono un `transform: translate() scale()` sul contenitore: composto
dalla GPU, e le coordinate dei nodi restano in spazio-grafo.

### 5.4 Archi

Tutti in un solo `<svg>`, un `<path>` per arco.

- **FK** — linea piena, freccia sul lato referenziato, badge con il numero di
  colonne se composta. Instradamento ortogonale a tre segmenti con angoli
  arrotondati; il lato di uscita è quello che accorcia il percorso. Gli archi
  che escono dallo stesso lato dello stesso nodo si scostano di 8px l'uno
  dall'altro (corsie), ordinati per y di destinazione: è ciò che distingue un
  diagramma leggibile da una matassa.
- **Auto-riferimento** — cappio a destra del nodo.
- **Sequenza → colonna** — tratteggiata e tenue: la colonna ha
  `DEFAULT SEQ.NEXTVAL`. Trascinare una sequenza su una colonna imposta il
  default; le colonne di identità hanno invece un badge, non un arco.
- **Ghost** — tratteggiata verso un nodo di un altro schema (bordo tratteggiato,
  sola lettura), così nessun arco resta appeso nel vuoto.

Per intercettare il doppio clic su un arco: un `<path>` trasparente con
`stroke-width: 12` e `pointer-events: stroke` sotto quello visibile.

### 5.5 Disposizione automatica

Alla prima apertura non c'è layout. Algoritmo **a livelli**, deterministico,
~150 righe, nessuna dipendenza:

1. livello = distanza massima da una tabella senza FK uscenti;
2. all'interno del livello, ordinamento per baricentro dei vicini (2–3
   passate) per ridurre gli incroci;
3. impacchettamento da sinistra a destra, altezza del nodo = numero di colonne;
4. le **isole** (tabelle senza alcuna FK) vanno in una griglia a parte sulla
   destra, così non sporcano la struttura.

Comandi: «disponi tutto», «disponi la selezione», «compatta a griglia». Il
layout automatico non sovrascrive mai posizioni fissate a mano senza conferma.

---

## 6. Interazione

### 6.1 Entrare nella modalità

Un canvas con 400 tabelle non serve a nessuno. All'apertura si sceglie:

- lo schema;
- cosa caricare: **tutto** · **filtro per nome** (riusa `nameMatcher`, già
  scritto) · **selezione manuale** · **a partire da una tabella + N livelli di
  FK**.

L'ultima è quella che rende usabile un gestionale da 500 tabelle: parti da
`ORDINI`, chiedi due livelli, ottieni il sottografo che ti interessa. Da lì,
«espandi i vicini» su un nodo aggiunge le tabelle collegate. Il draft, ricordo,
resta comunque completo.

### 6.2 Modificare una tabella

**Doppio clic sul nodo → il nodo entra in modalità modifica lì dov'è.** Non un
modale: si allarga, il canvas ci fa uno zoom sopra, gli altri nodi si
attenuano. Dentro, la griglia delle colonne con i campi editabili e, in fondo,
le schede *Vincoli · Indici · Commento*. Salva / Annulla, e `Esc` esce.

È il comportamento di Blender e di Unreal — il nodo *è* il pannello proprietà —
ed è ciò che rende la modalità autosufficiente.

Le modifiche più frequenti non richiedono nemmeno quello: doppio clic su una
singola **riga colonna** ne edita nome e tipo in linea, come in un foglio di
calcolo; le caselle PK/NN si spuntano direttamente sul nodo.

Al salvataggio il modello si aggiorna e, poiché i vincoli puntano a id,
**ogni FK, indice e chiave che usava quella colonna segue automaticamente**.

### 6.3 Creare una foreign key

Trascinamento da una colonna a un'altra:

- rilascio su una **colonna** → FK `(A.col) → (B.col)`;
- rilascio sull'**intestazione** → FK verso la chiave primaria di B, colonne
  scelte da sole;
- tipi incompatibili → rifiuto con spiegazione;
- il lato referenziato non è PK né UNIQUE → si propone *«aggiungo un vincolo
  UNIQUE su B.col»* come parte dello stesso insieme di modifiche. È il tipo di
  aiuto che in una finestra di dialogo non si può dare.

Il nome del vincolo è proposto (`ORDINI_FK_CLIENTI`) e modificabile:
`generated: false`, così viene creato con un nome vero e non un `SYS_C…`.

**Doppio clic sull'arco** → pannello FK: nome, coppie di colonne ordinate,
`ON DELETE`, stato abilitato/disabilitato, ed elimina. Con una casella che vale
il suo peso in oro su Oracle: **«crea anche l'indice sulle colonne figlie»** —
una FK senza indice sulla tabella figlia è la causa classica dei lock sul padre
durante le `DELETE`.

### 6.4 Tastiera

Nessun conflitto con le scorciatoie esistenti (`Ctrl+B/J`, `F1`, `Ctrl+,`):

| Tasto                | Azione                                       |
| -------------------- | -------------------------------------------- |
| trascinamento vuoto  | selezione a rettangolo                       |
| spazio / tasto medio | pan                                          |
| rotella              | zoom · `Shift`+rotella pan orizzontale       |
| doppio clic nodo     | modifica in place                            |
| doppio clic arco     | impostazioni della foreign key               |
| `Canc`               | elimina la selezione (tabella → marcata, arco → FK rimossa) |
| `Ctrl+Z` / `Ctrl+Maiusc+Z` | annulla / ripeti                        |
| `F` / `Maiusc+F`     | inquadra la selezione / tutto                |
| `Ctrl+F`             | cerca un nodo e saltaci                      |
| `N`                  | nuova tabella nel punto del cursore          |
| `Ctrl+D`             | duplica la tabella selezionata               |

### 6.5 Annulla/ripeti

Il draft è JSON immutabile indicizzato per id: una modifica clona **solo la
tabella toccata** e riusa tutto il resto.

```js
draft = { ...draft, tables: { ...draft.tables, [id]: nuovaTabella } };
```

Lo stack di undo è quindi un array di radici, e costa quanto una tabella per
modifica — non quanto l'intero schema. Nessuna libreria, nessun command
pattern, stesso stile immutabile già usato in `store.js`.

### 6.6 Pannello «Modifiche in sospeso»

Colonna laterale, sempre visibile, raggruppata per oggetto con l'icona dello
stato: `+` nuovo · `~` modificato · `−` eliminato · `↷` rinominato. Clic su una
voce → il canvas ci inquadra il nodo. Ogni voce si può **annullare
singolarmente** (ripristina quell'oggetto dalla base). In fondo: «genera
script» e «applica».

È la stessa lettura del DB Diff, applicata alle proprie modifiche invece che a
quelle fra due database.

---

## 7. Validazione continua

`validateDraft(draft, { oracleVersion })` — pura, testabile — gira a ogni
modifica e produce `{ level, tableId, columnId, text }`. Errori e avvisi si
vedono come badge sul nodo e come elenco nel pannello.

Controlli:

- nomi di tabella o colonna duplicati (dopo `dictName`, quindi
  case-insensitive);
- identificatore troppo lungo — **30 byte sotto Oracle 12.2, 128 da lì in poi**:
  la versione del server è già nello store (`active[connId].version`);
- parola riservata non quotata;
- FK con tipi incompatibili, o verso colonne non uniche;
- indice che duplica una PK/UNIQUE (Oracle lo crea da sé);
- tabella senza chiave primaria (avviso);
- colonna senza tipo;
- ciclo di FK `NOT NULL` senza `ON DELETE`: nessun ordine di inserimento è
  possibile (avviso).

Gli errori bloccano «Applica»; non bloccano «Genera script» — l'utente può
sempre volersi portare via l'SQL e aggiustarlo a mano.

È qui che l'editor a nodi batte davvero le finestre di dialogo: la validazione è
su tutto lo schema insieme, non su una tabella alla volta.

---

## 8. Il layout, e dove vive

Salvato sul server, in `DATA_DIR/diagrams/<connId>__<owner>.json`, con lo stesso
`readJson`/`writeJson` di `secret.js`. Scrittura in debounce.

```json
{ "version": 1, "viewport": { "x": 0, "y": 0, "z": 1 },
  "nodes": { "CLIENTI": { "x": 120, "y": 40, "w": 220, "collapsed": false, "visible": true } },
  "notes": [ … ], "groups": [ … ] }
```

Sul server e non in `localStorage` perché: sopravvive alla reinstallazione,
un diagramma si può esportare e passare a un collega, e non gonfia lo stato
persistito di zustand (che oggi tiene schede e bozze SQL).

Le chiavi sono i **nomi**, non gli id: gli id vivono solo dentro una sessione di
editing. Un nodo il cui tavolo non esiste più viene marcato *orfano* e se ne
propone la rimozione dal diagramma.

**Le modifiche in sospeso, in beta, non si persistono.** Alla chiusura della
scheda si avvisa («hai N modifiche non applicate»). Salvare un draft e
ritrovarlo tre giorni dopo su un database nel frattempo cambiato è una fabbrica
di bug sottili: prima si consolida la deriva (§4.1), poi eventualmente si
persiste.

---

## 9. Cosa entra nella beta

Il grafo di uno schema è fatto di tabelle e relazioni: è lì che l'editor a nodi
aggiunge qualcosa che le finestre di dialogo non danno. Viste, package e
procedure hanno già case buone (scheda oggetto, foglio SQL): dal canvas si
**aprono**, non si modificano.

| Nodo               | In beta                                                     |
| ------------------ | ----------------------------------------------------------- |
| **Tabella**        | completo: colonne, PK/UQ/CK/FK, indici, commenti, rinomine  |
| **Sequenza**       | completo (`createSequenceDdl`/`alterSequenceDdl` esistono già) |
| **Nota**           | testo libero, vive solo nel layout, nessun DDL              |
| **Gruppo**         | riquadro che raccoglie un'area, solo layout                 |
| **Ghost**          | tabella di un altro schema, sola lettura                    |
| **Vista / MVista** | nodo di sola lettura, doppio clic → scheda oggetto          |

Il perimetro è dichiarato, non subìto: «tutto sulle tabelle e le loro
relazioni» è una promessa che si può mantenere in beta. Estendere ai nodi
PL/SQL è la fase 4.

---

## 10. File

Il modello sta sul server, non sul client: `projectDraft()` deve stare accanto a
`compare.js` e `script.js`, che il client non può importare (build separate). Il
server legge lo snapshot e restituisce **già il draft**; il client lo modifica
come stato della UI e lo rispedisce quando c'è da generare lo script.

**Client**

```
src/graph/layout.js         disposizione a livelli, inquadratura
src/graph/routing.js        ancore, percorsi ortogonali, corsie
src/graph/validate.js       validateDraft
src/components/graph/
  GraphView.jsx             radice della scheda: barra + canvas + pannelli
  Canvas.jsx                pan/zoom/selezione/culling
  TableNode.jsx             nodo, livelli di dettaglio, modifica in place
  Edges.jsx                 strato SVG
  FkPanel.jsx               impostazioni della foreign key
  ChangesPanel.jsx          modifiche in sospeso + validazione
  ApplyModal.jsx            anteprima script + esecuzione
  OpenGraphModal.jsx        cosa caricare all'apertura
  TableEditor.jsx           pannelli colonne/vincoli/indici condivisi
```

**Server**

```
src/graph/model.js          importSnapshot/projectDraft, id stabili
src/graph/rename.js         renamePass — puro
src/graph/apply.js          buildApplyPlan: project → rename → compare → script
src/routes/graph.js         POST /api/graph/session
                            GET|PUT /api/graph/diagram/:connId/:owner
src/diagrams.js             persistenza del layout
```

`server/src/diff/*` **non si tocca**: si usa e basta.

Ritocchi: `store.js` (`openGraph()`, tipo di scheda `'graph'`), `App.jsx`
(render della scheda), `api.js` (nuove chiamate), `Sidebar.jsx` +
`ObjectTree.jsx` (voci «apri nel diagramma» / «mostra nel diagramma»),
`guide.js` (sezione nuova), `styles.css` (blocco `editor a nodi`).

### Il refactoring da fare davvero

`TableDialogs.jsx` oggi calcola l'SQL da sé, su una forma di dati tutta sua
(`{ key, origName, name, type, size, scale, def, notNull, pk }`). L'editor a
nodi lavora invece sul modello dello snapshot e non produce SQL: produce
mutazioni.

Vanno estratti i **riquadri** (`ColumnsPane`, `ConstraintsPane`, `IndexesPane`,
`ChipPicker`) in `TableEditor.jsx`, riscritti sul modello dello snapshot. La
finestra esistente continua a funzionare passando dal nuovo modello, e la sua
generazione di SQL può a quel punto sparire a favore dello stesso motore di
diff — meno codice e un solo comportamento.

Duplicare i riquadri sarebbe più rapido, ma vorrebbe dire mantenere per sempre
due editor di colonne che divergono. Meglio pagare adesso.

---

## 11. Test

Il progetto usa `node --test`. Tutta la logica descritta qui è pura, quindi
testabile senza database:

- `client/test/graphModel.test.js` — **l'invariante di §2.2** più i casi di
  rinomina a cascata (rinomino una colonna: le FK la seguono);
- `server/test/graphRename.test.js` — rinomina semplice, rinomina + modifica,
  scambio di nomi (deve fallire), rinomina di un vincolo;
- `server/test/graphApply.test.js` — dal modello all'SQL: nuova tabella, colonna
  aggiunta, FK creata, tabella eliminata con `includeDrops` on/off;
- `client/test/graphLayout.test.js` — determinismo, nessuna sovrapposizione;
- `client/test/graphValidate.test.js` — un caso per regola.

---

## 12. Fasi

Ogni fase è un commit `feat:` e quindi una release automatica (vedi CLAUDE.md).

**Fase 0 — fondamenta, nessuna UI.** `model.js`, `rename.js`, `apply.js` e i
loro test. Il traguardo: *aprire un diagramma e applicarlo senza toccare nulla
produce uno script vuoto*. Finché non è verde, il resto non si costruisce.

**Fase 1 — diagramma in sola lettura.** Apertura, snapshot, disposizione
automatica, pan/zoom, livelli di dettaglio, archi FK, layout persistito. Già
utile da sola: Orabridge guadagna un visualizzatore ER, che oggi non ha.

**Fase 2 — la beta.** Modifica in place del nodo, FK per trascinamento,
pannello delle modifiche, validazione, controllo di deriva, anteprima e
applicazione. È qui che si mette il badge *beta*.

**Fase 3 — comodità.** Note, gruppi, ricerca, «espandi i vicini», sequenze,
esportazione SVG del diagramma (utile per la documentazione, e a partire dal
modello sono ~100 righe).

**Fase 4 — oltre.** Nodi per viste e PL/SQL, condivisione dei diagrammi,
*confronto fra due diagrammi* (il draft è uno snapshot: si dà in pasto a DB
Diff quasi gratis), generazione di uno schema dall'assistente AI.

---

## 13. Come si presenta come «beta»

Visibile a tutti, con il badge, non nascosta dietro un interruttore: serve
riscontro. Un avviso alla prima apertura che dice la cosa che conta —
*nessuna istruzione viene eseguita senza averla prima mostrata* — e un
interruttore nelle impostazioni per chi la vuole nascondere.

I valori predefiniti fanno il resto del lavoro: eliminazioni escluse, e
«Apri nel foglio SQL» come pulsante primario dell'anteprima.
