# Orabridge — istruzioni di progetto

Client web + desktop (Electron) per database Oracle. UI, README, CHANGELOG e
commenti in italiano.

## Rilascio di una nuova versione (automatico)

Il rilascio è automatizzato da `.github/workflows/release.yml`: **non si bumpa
più la versione né si scrive il CHANGELOG a mano**. Ad ogni push su `main`:

1. Il job `version` (ubuntu) legge i commit dall'ultimo tag `vX.Y.Z` e decide
   se e come bumpare la versione, seguendo **Conventional Commits**:
   - `feat: ...` → minor
   - `fix: ...` / `perf: ...` → patch
   - `!` dopo il tipo (es. `fix!: ...`) o un footer `BREAKING CHANGE: ...` →
     major (il testo dopo `BREAKING CHANGE:` finisce nella voce di changelog)
   - `docs:`, `chore:`, `style:`, `refactor:`, `test:`, `build:`, `ci:` o
     commit senza prefisso convenzionale → **non generano da soli una
     release** (non contano ai fini del bump; se sono gli unici commit dal
     tag precedente, il job si ferma senza fare nulla).
   Se ci sono più commit rilevanti dall'ultimo tag, vince il bump più alto
   (una `feat` + una `fix` insieme → minor).
   Bumpa in lockstep i tre `package.json` (`client/`, `server/`,
   `electron/`), scrive una voce in cima a `CHANGELOG.md` (un bullet per
   commit rilevante, corpo del commit incluso), committa
   `chore(release): vX.Y.Z [skip ci]`, e crea+pusha il tag.
2. Il job `build` (windows-latest, serve NSIS + i binari nativi corretti)
   parte solo se il job 1 ha deciso di rilasciare. Installa le dipendenze,
   builda il client, prepara `electron/resources/` (incluso il download
   dell'Instant Client) e pubblica l'installer su **GitHub Releases** con
   `electron-builder --publish always` (script `dist:win:publish`) — questo
   carica anche `latest.yml`, usato da electron-updater per l'aggiornamento
   automatico in-app. Alla fine aggiunge la riga "Build:" al CHANGELOG (link
   all'asset pubblicato) e imposta le note della release su GitHub.

Quindi per rilasciare basta scrivere commit con prefisso `feat:`/`fix:`/
`perf:` (in inglese va bene solo il prefisso, la descrizione resta in
italiano) e pusciare su `main` — build e pubblicazione dell'`.exe` sono
automatiche, non serve più lanciare `npm run dist:win` a mano né toccare
CHANGELOG.md.

**Recupero da build fallita**: se il job `build` fallisce dopo che il bump di
versione è già stato pushato, si può rilanciare a mano dalla tab Actions con
"Run workflow" (`workflow_dispatch`) spuntando `rebuild_only` — ricompila e
ripubblica la versione già presente in `electron/package.json` senza creare
un nuovo bump.

**Build locale (solo per test, non pubblica nulla)**:
```bash
cd electron && npm run dist:win
```
Rigenera il bundle client e copia client+server dentro
`electron/resources/` prima di impacchettare. Richiede Wine su Linux/WSL2
(già installato in questo ambiente); se fallisce, vedi la nota in fondo al
README su come lanciarlo da Windows. L'output è
`electron/release/Orabridge Setup <versione>.exe`, solo locale — per
pubblicarlo serve il workflow CI (che builda su Windows nativo, non Wine).

## Modelli locali (llama.cpp)

La piattaforma «Modello locale» usa `node-llama-cpp`, dipendenza di `server/`.
Due cose da sapere prima di toccarla:

- **I binari nativi entrano nell'installer, i pesi no.** `prepare-resources.mjs`
  filtra `@node-llama-cpp/*` tenendo solo `win-x64` e `win-x64-vulkan` (le
  varianti CUDA valgono da sole mezzo giga e Vulkan copre anche NVIDIA) ed
  esclude `llama/gitRelease.bundle`, 32 MB di sorgenti per una compilazione che
  non facciamo mai (`getLlama({ build: 'never' })`). Senza questo filtro
  l'installer crescerebbe di ~660 MB invece di ~120 MB.
- **Su Linux/WSL npm non installa i binari Windows**, quindi un
  `npm run dist:win` locale produce un pacchetto senza motore locale (lo script
  lo dice con un avviso). Per una build completa serve la CI su Windows.

I file `.gguf` si scaricano a runtime da HuggingFace nella cartella dati
(`DATA_DIR/models`), con ripresa: non vanno mai committati né impacchettati.

## Integrazione MCP con gli editor esterni (Copilot)

`server/src/mcp/` + `electron/mcp-bridge.cjs` espongono i database **già
collegati** a VS Code. Quattro invarianti da non rompere:

- **È di sola lettura, e non per convenzione.** L'elenco degli strumenti nasce da
  `TOOL_DEFS.filter(t => t.permission === 'read')` e `runTool` viene chiamato con
  `readOnly: true`, che rifiuta gli strumenti di scrittura anche se invocato
  direttamente. Aggiungere uno strumento a `ai/tools.js` con permesso `read` lo
  espone automaticamente a Copilot: se non deve uscire dall'app, non è `read`.
- **`run_query` ha due modalità di esecuzione.** Con `ctx.pooled` gira su una
  connessione del pool, altrimenti sulla sessione dedicata del foglio SQL. L'MCP
  usa la prima: unificarle rimetterebbe Copilot dentro la transazione aperta
  dell'utente e in coda alle sue query.
- **Il ponte va copiato in `resources/`.** `electron/resources/` è in
  `.gitignore`: il sorgente sta in `electron/mcp-bridge.cjs` e ci arriva tramite
  `prepare-resources.mjs` (`copyMcpBridge`). Senza quel passaggio l'app si
  costruisce ma la configurazione mostrata nelle impostazioni non compare
  (`desktopPaths()` controlla che il file esista).
- **Su WSL serve `WSLENV`.** Il ponte gira come Node dell'eseguibile
  (`ELECTRON_RUN_AS_NODE=1`), ma lanciato da WSL quella variabile non attraversa
  il confine se non è elencata in `WSLENV`: senza, si apre la finestra dell'app
  invece del ponte. Vale per qualunque env var da passare a un processo Windows.

Il protocollo è scritto a mano in `mcp/protocol.js` (nessun SDK: porterebbe 17
dipendenze e un secondo Express dentro l'installer). La specifica si muove — la
revisione 2026-07-28 ha reso il protocollo stateless — quindi non si tiene stato
di sessione e in `initialize` si risponde con la revisione chiesta dal client se
è fra quelle conosciute. Porta e token per il ponte stanno in
`DATA_DIR/mcp-endpoint.json`, che esiste **solo** a integrazione accesa.

Test: `server/test/mcp.test.js` (protocollo, sola lettura, risoluzione della
connessione, endpoint HTTP) e `server/test/mcpBridge.test.js`, che avvia il ponte
come processo vero e gli parla su stdio.

L'app desktop controlla da sola gli aggiornamenti via `electron-updater`
(vedi `electron/main.cjs`, funzione `setupAutoUpdater`): all'avvio e ogni
4 ore, scarica in background l'ultima release GitHub e chiede all'utente se
riavviare per installarla.
