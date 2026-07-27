# Orabridge — istruzioni di progetto

Client web + desktop (Electron) per database Oracle. UI, README, CHANGELOG e
commenti in italiano.

## Rilascio di una nuova versione

Ogni volta che si chiude una versione (nuova feature, fix rilevante, ecc.)
vanno eseguiti **tutti** questi passaggi, nell'ordine:

1. **Bump versione** in lockstep nei tre `package.json`: `client/`,
   `server/`, `electron/` — stesso numero ovunque.
2. **Voce in `CHANGELOG.md`** (in cima, sopra la versione precedente) che
   descriva cosa è cambiato e perché, per chi userà l'app.
3. **Build dell'installer desktop**:
   ```bash
   cd electron && npm run dist:win
   ```
   Rigenera anche il bundle client (`vite build`) e copia client+server
   dentro `electron/resources/` prima di impacchettare, quindi basta questo
   comando: non serve rilanciare `npm run build` a mano nel client.
   Richiede Wine su Linux/WSL2 (già installato in questo ambiente); se
   fallisce, vedi la nota in fondo al README su come lanciarlo da Windows.
   L'output è `electron/release/Orabridge Setup <versione>.exe`.
4. **Tracciare la build fatta** aggiungendo una riga "Build:" in fondo alla
   voce di quella versione in `CHANGELOG.md`, con la data in cui l'installer
   è stato generato — es. `Build: electron/release/Orabridge Setup 1.2.0.exe (2026-07-24).`
   Serve per sapere a colpo d'occhio quali versioni in CHANGELOG hanno
   davvero un installer pacchettizzato e quali sono solo bump di codice non
   ancora buildati.

Non saltare il passo 3/4 anche per modifiche solo lato client o server: le
versioni sono allineate proprio perché l'installer deve sempre riflettere
l'ultimo codice di entrambi.
