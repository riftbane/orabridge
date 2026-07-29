# Editor a nodi — roadmap

Stato del lavoro, aggiornato a fine sessione. Il progetto completo sta in
[`editor-a-nodi.md`](editor-a-nodi.md); qui c'è solo cosa è fatto, cosa viene
dopo e le decisioni prese strada facendo.

**Stato attuale: fasi 0, 1 e 2 completate — la beta è utilizzabile.**

---

## Fase 0 — fondamenta, nessuna UI

Il traguardo: *aprire un diagramma e applicarlo senza toccare nulla produce uno
script vuoto*. Tutta logica pura, testabile senza database.

- [x] `server/src/graph/model.js` — `importSnapshot()` / `projectDraft()`
- [x] `server/src/graph/rename.js` — `renamePass()`, ribasatura, cicli di nomi
- [x] `server/src/graph/apply.js` — `buildApplyPlan()`: project → rename → compare → script
- [x] `server/test/fixtures.js` — costruttori di snapshot condivisi fra i test
- [x] `server/test/graphModel.test.js` — **invariante** `project(import(s)) ≡ s`
- [x] `server/test/graphRename.test.js` — rinomine, propagazione, cicli
- [x] `server/test/graphApply.test.js` — dal modello all'SQL
- [x] `server/src/diff/script.js` — corretto: il commento di una colonna
      *aggiunta* a una tabella esistente andava perso (`d.columnComments` copre
      solo le colonne presenti da entrambe le parti, mentre nella creazione da
      zero i commenti venivano emessi). Riguardava anche il DB Diff.

44 test nuovi, 122 verdi in tutta la suite del server.

---

## Fase 1 — diagramma in sola lettura

- [x] `server/src/routes/graph.js` — `POST /api/graph/session` (legge lo
      snapshot, lo importa, tiene la base in memoria come le run del DB Diff),
      `POST /:sessionId/plan`, `GET|PUT /diagram/:connId/:owner`
- [x] `server/src/diagrams.js` — layout in `DATA_DIR/diagrams/`
- [x] `client/src/graph/layout.js` — misure, livelli, isole, inquadratura
- [x] `client/src/graph/routing.js` — ancore, percorsi ortogonali, corsie
- [x] `client/src/components/graph/Canvas.jsx` — pan/zoom/selezione
- [x] `client/src/components/graph/TableNode.jsx` — nodo + livelli di dettaglio
- [x] `client/src/components/graph/Edges.jsx` — strato SVG
- [x] `client/src/components/graph/GraphView.jsx` — radice della scheda
- [x] `client/src/components/graph/OpenGraphModal.jsx` — cosa caricare
- [x] `store.js`: `openGraph()`, scheda `'graph'`, guardia di chiusura ·
      `App.jsx`: render · `api.js` · `Sidebar.jsx` e `ObjectTree.jsx`
- [x] `styles.css`: blocco «editor a nodi»
- [x] `client/test/graph.test.js` — misure, determinismo, nessuna
      sovrapposizione, cicli di FK, corsie degli archi

---

## Fase 2 — la beta

- [x] `client/src/graph/mutations.js` — mutazioni immutabili, fabbriche, FK
- [x] `client/src/graph/changes.js` — riepilogo e annullamento per tabella
- [x] `client/src/graph/validate.js` — controlli su tutto lo schema
- [x] `client/src/components/graph/TableEditor.jsx` — riquadri sul modello del
      draft (**non ancora** riusati da `TableDialogs.jsx`, vedi §Refactoring)
- [x] Modifica in place del nodo (doppio clic)
- [x] FK per trascinamento colonna → colonna / colonna → intestazione
- [x] `FkPanel.jsx` — doppio clic sull'arco, con la casella «crea l'indice
      sulle colonne figlie»
- [x] `ChangesPanel.jsx` — modifiche in sospeso, annulla singola voce
- [x] Controllo di deriva prima dell'applicazione
- [x] `ApplyModal.jsx` — anteprima, conteggio righe delle tabelle da eliminare,
      conferma digitata, esecuzione istruzione per istruzione
- [x] Rilettura del diagramma dopo ogni applicazione, riuscita o fallita
- [x] Badge *beta* · avviso alla chiusura con modifiche in sospeso
- [x] `server/test/graphClientShapes.test.js` — la giuntura fra le fabbriche
      del client e la proiezione del server
- [x] Sezione «Diagramma (beta)» in `guide.js`
- [ ] Interruttore nelle impostazioni per nasconderla

---

## Fase 3 — comodità

- [ ] Note e gruppi (solo layout, nessun DDL)
- [ ] Ricerca nodo (`Ctrl+F`), «espandi i vicini»
- [ ] Nodi sequenza completi + arco tratteggiato verso il `DEFAULT … NEXTVAL`
- [ ] Esportazione SVG del diagramma
- [ ] Nodi ghost per le tabelle di altri schemi

---

## Fase 4 — oltre

- [ ] Nodi di sola lettura per viste e oggetti PL/SQL
- [ ] Condivisione/esportazione dei diagrammi
- [ ] Confronto fra due diagrammi (il draft è uno snapshot: si dà a DB Diff)
- [ ] Generazione di uno schema dall'assistente AI

---

## Decisioni prese durante il lavoro

Correzioni e precisazioni rispetto al progetto iniziale. Vanno lette prima di
riprendere in mano il codice.

**Il modello sta sul server, non sul client.** Il progetto metteva
`model.js` fra i file del client. Sbagliato: `projectDraft()` deve stare
accanto a `compare.js` e `script.js`, che sono moduli del server e che il
client non può importare (build separate). Il flusso è quindi: il server legge
lo snapshot e restituisce **già il draft**; il client lo modifica come stato
della UI e lo rispedisce al momento di generare lo script. Il client conserva
solo `layout.js`, `routing.js` e `validate.js`. Il payload per uno schema da 400
tabelle è dell'ordine dei 2–3 MB, sotto il limite di 20 MB di `express.json`.

**`includeDrops` è acceso di default, qui.** Nel DB Diff sta spento perché
«presente solo nella destinazione» vuol dire *roba che si trova lì*, e
proporne la cancellazione sarebbe aggressivo. Nell'editor a nodi ogni
eliminazione è invece un atto esplicito dell'utente: ignorarla di default
significherebbe non fare quello che ha chiesto. La sicurezza viene dalla
conferma (conteggio righe + conferma digitata per le tabelle), non
dall'ignorare l'intenzione.

**I nomi nel draft sono sempre in forma da dizionario.** `CLIENTI`, non
`clienti`, a meno che il nome non richieda davvero le virgolette. La
normalizzazione (`dictName()` di `client/src/ddl.js`) va fatta **in ingresso**,
quando l'utente digita, così tutto il resto della catena può citare sempre gli
identificatori senza doversi chiedere se maiuscolizzare. È l'invariante che
permette a `rename.js` di restare stupido.

**Le condizioni dei CHECK non vengono riscritte alle rinomine.** Se una
condizione cita una colonna rinominata, `renamePass()` emette un *avviso* e
lascia il testo com'è. Riscrivere SQL con una regex è fragile, e sbagliare in
questa direzione è innocuo: al massimo il confronto propone di rifare il
vincolo. Sbagliare nell'altra (dare per scontato che Oracle abbia già
riscritto) lascerebbe un vincolo rotto. Stesso trattamento per le espressioni
degli indici funzionali e per i `DEFAULT`.

**Eliminare una colonna che regge un vincolo** produce oggi un
`ALTER TABLE … DROP (…)` che Oracle rifiuta. In fase 2 la UI deve offrire
`CASCADE CONSTRAINTS` come fa già `TableDialogs.jsx`, oppure eliminare
esplicitamente i vincoli dipendenti. `projectDraft()` per ora salta i vincoli e
gli indici che citano colonne eliminate.

**Le colonne di identità e virtuali** restano modificabili solo in nome e
commento: cambiarne la generazione o l'espressione richiede di ricreare la
tabella, e `script.js` lo segnala già con una nota. In beta l'editor blocca e
rimanda al foglio SQL.

---

## Refactoring aperto

`client/src/components/TableDialogs.jsx` calcola l'SQL da sé, su una forma di
dati tutta sua (`{ key, origName, name, type, size, scale, def, notNull, pk }`).
I riquadri `ColumnsPane`, `ConstraintsPane`, `IndexesPane` e `ChipPicker` vanno
estratti in `TableEditor.jsx` e riscritti sul modello del draft, così che la
finestra esistente e il nodo del diagramma condividano una sola superficie di
modifica. Da fare in fase 2, **prima** di scrivere l'editor in place: farlo
dopo significa avere due editor di colonne da tenere allineati per sempre.

---

## Decisioni prese in fase 1–2

**«Ribasa tenendo le modifiche» non c'è.** Quando il database è cambiato sotto
i piedi, l'anteprima elenca cosa è cambiato e offre due strade oneste:
*genera comunque* (contro la base letta all'apertura, che è quella che l'utente
ha visto) oppure *rileggi*, che perde le modifiche non applicate. Riportare le
modifiche su una base nuova è tutt'altro lavoro — e generare contro la
fotografia fresca sarebbe peggio che non farlo: annullerebbe in silenzio quello
che ha fatto l'altra persona.

**Il tipo di una colonna si scrive per esteso**, con un elenco di suggerimenti,
invece di essere spezzato in tipo/dimensione/scala come in `TableDialogs.jsx`.
Il dizionario lo restituisce già canonico (`VARCHAR2(80 CHAR)`,
`TIMESTAMP(6) WITH TIME ZONE`) e rimontarlo da tre campi lo perderebbe pezzo per
pezzo.

**Nessun «salva» dentro il nodo.** Le modifiche vanno dritte nel draft: niente
tocca il database prima dell'applicazione, e `Ctrl+Z` copre già tutto. Un
secondo livello di conferma sarebbe solo un passaggio in più da fare.

**Il canvas è scritto a mano, come previsto**, e non è stato il pezzo difficile:
`Canvas.jsx` sta in ~150 righe. Il tempo se lo sono preso l'instradamento degli
archi e la modifica in place.

---

## Punti ancora aperti

- Il draft in sospeso non si persiste (avviso alla chiusura della scheda). Da
  rivedere quando il controllo di deriva sarà solido.
- **Il diagramma non è mai stato provato contro un Oracle vero**: in questo
  ambiente non c'è un database, e le prove sono unitarie più il build. Vanno
  verificate a mano almeno l'apertura di uno schema grande, il trascinamento di
  una FK e un'applicazione completa.
- Mentre un nodo è in modifica si allarga, ma gli archi restano ancorati alla
  larghezza normale: si vede uno scarto finché non si chiude l'editor.
- Le colonne di identità e virtuali si possono modificare senza che l'editor
  blocchi (§Decisioni): oggi arriva solo la nota di `script.js` dentro lo
  script. Il blocco esplicito è ancora da fare.
- Le FK *entranti* da altri schemi non sono nello snapshot di un solo owner:
  vanno interrogate a parte prima di un `DROP TABLE … CASCADE CONSTRAINTS`.
- Se il canvas su misura si rivelasse più oneroso del previsto in fase 1,
  `@xyflow/react` è l'uscita di sicurezza: cambierebbe solo `Canvas.jsx`, non il
  modello dei dati.
