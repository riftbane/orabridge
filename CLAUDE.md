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

L'app desktop controlla da sola gli aggiornamenti via `electron-updater`
(vedi `electron/main.cjs`, funzione `setupAutoUpdater`): all'avvio e ogni
4 ore, scarica in background l'ultima release GitHub e chiede all'utente se
riavviare per installarla.
