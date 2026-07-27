# Changelog

Tutte le modifiche rilevanti a Orabridge sono documentate qui. Le versioni sono allineate tra `client/`, `server/` ed `electron/` (stesso numero ovunque).

## v1.5.0 — 2026-07-27

- Migliorata: tutte le icone dell'interfaccia (modifica, elimina, cronologia,
  chiudi, esegui/script/annulla, compila, ricarica, esito connessione/DDL,
  ordinamento griglia, ecc.) usavano glifi emoji (✎ 🗑 🕘 ✕ ✓ ✗ ⚙ ⚠ ▶ ⏵⏵ ■ ▲▼
  ↑ ↺ ⟳ ▸ ＋ ⏻), che cambiano aspetto e allineamento a seconda del sistema/
  font e non seguono il colore del testo circostante. Sostituite con icone
  SVG monocromatiche di [lucide-react](https://lucide.dev), coerenti in ogni
  ambiente e che ereditano il colore (incluso lo stato hover/danger dei
  pulsanti). Nessun cambiamento funzionale.
- Build: electron/release/Orabridge Setup 1.5.0.exe (2026-07-27).

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
