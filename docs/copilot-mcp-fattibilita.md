# Esporre i database di Orabridge a GitHub Copilot (VS Code) — analisi di fattibilità

> **Stato: implementato** (luglio 2026). Questo documento resta come traccia
> dell'analisi e delle alternative scartate; la documentazione d'uso sta nel
> README (§ *GitHub Copilot in VS Code (MCP)*), quella per chi tocca il codice in
> `CLAUDE.md`. Cosa è cambiato rispetto al piano, e perché:
>
> - **Nessun token stabile.** Il file di scoperta porta il token effimero
>   dell'avvio in corso e il ponte lo rilegge a ogni messaggio: si autoripara ai
>   riavvii dell'app e il token continua a ruotare. Il § 2 proponeva un token
>   permanente da mostrare nelle impostazioni — non serve, ed era peggio.
> - **Endpoint sotto `/api/mcp`, non `/mcp`.** Così eredita i controlli già in
>   piedi (token, Host solo loopback, rifiuto cross-site, Content-Type) invece di
>   riscriverli.
> - **Le scritture non ci sono, non sono spente.** Il § 4.3 le metteva dietro un
>   interruttore predefinito a off; la decisione è stata di non esporle affatto:
>   `execute_sql` non compare nell'elenco e `runTool` in sola lettura lo rifiuta.
>   Un interruttore in meno da sbagliare.
> - **`list_connections` non espone l'utenza Oracle**, né host o servizio: solo
>   nome, schema corrente e versione del database. Le credenziali restano
>   nell'app.
> - **Rinviato**: la pubblicazione lato server della connessione selezionata nella
>   UI (§ 4.2). Il default resta «l'unica attiva», con errore che elenca i nomi
>   quando ce n'è più di una.
> - **Costo reale** vicino alla stima del § 7, con i test in più (protocollo,
>   sola lettura, non-trafilamento delle credenziali, ponte come processo vero).
>   Lo spike del § 8.1 sull'interop è servito: ha fatto emergere `WSLENV`, che
>   sarebbe stato un errore silenzioso in produzione.

Obiettivo: da VS Code (anche in WSL), Copilot deve poter leggere schema e dati
dei database **già connessi** in Orabridge, senza riconfigurare credenziali e
senza un secondo canale verso Oracle.

**Verdetto: fattibile, e più economico di quanto sembri.** Il protocollo giusto
è MCP (Model Context Protocol), che VS Code supporta nativamente in modalità
agente. Il grosso del lavoro — gli strumenti che un modello usa per esplorare un
database Oracle — in Orabridge esiste già: è `server/src/ai/tools.js`. Quello
che manca è il trasporto e tre decisioni di progetto (quale connessione, quale
sessione Oracle, quali permessi).

## 1. Cosa esiste già e si riusa

| Pezzo | File | Riuso |
|---|---|---|
| 7 strumenti con descrizioni scritte per un LLM (`list_schemas`, `list_objects`, `describe_table`, `get_source`, `get_ddl`, `run_query`, `execute_sql`) | `server/src/ai/tools.js` | mappano 1:1 sui tool MCP: `TOOL_DEFS` è già `{ name, description, parameters }` in JSON Schema, cioè esattamente il formato di `tools/list` |
| esecuzione + normalizzazione output testuale | `runTool()` | invariata |
| classificazione SQL in `read`/`write`/`danger` | `server/src/ai/sqlGuard.js` | è il controllo di permesso lato MCP |
| connessioni Oracle vive in memoria | `server/src/pools.js` (`pools.get(id)`) | è la «connessione attiva» che Copilot deve sfruttare |
| server HTTP + autenticazione a token | `server/src/index.js` | l'endpoint MCP si aggiunge lì |

`toolSchemas()` esiste già e produce le definizioni ripulite dai campi interni:
serve per il pannello AI, va bene identica per MCP. In pratica il lavoro
protocollare è un adattatore, non una riscrittura.

## 2. Architettura consigliata

Due pezzi, per coprire sia il desktop sia il deployment web/Docker senza
duplicare la logica:

```
VS Code (Copilot, modalità agente)
   │  stdio (JSON-RPC)
   ▼
orabridge-mcp  ← bridge, ~100 righe, zero dipendenze
   │  HTTP + X-Orabridge-Token
   ▼
server Orabridge (già in esecuzione dentro l'app desktop)
   POST /mcp  →  adattatore MCP  →  TOOL_DEFS / runTool  →  pools  →  Oracle
```

1. **`POST /mcp` nel server esistente** (`server/src/routes/mcp.js`):
   Streamable HTTP, l'unico trasporto di rete di MCP. Un solo endpoint, JSON-RPC
   2.0 sul body. Chi usa Orabridge via Docker o web punta VS Code direttamente
   qui (`"type": "http"`), senza bridge.
2. **Un bridge stdio** impacchettato in `electron/resources/`: legge un file di
   discovery scritto all'avvio dall'app (`{ port, token }`) e inoltra i messaggi
   all'endpoint HTTP. Serve per tre motivi concreti, tutti dovuti all'app
   desktop: la porta è effimera (`PORT=0`, vedi `electron/main.cjs:41`), il
   token cambia a ogni avvio (`main.cjs:61`), e il server ascolta solo sul
   loopback. Nessuno dei tre sopravvive a un `mcp.json` statico; il bridge sì,
   e come effetto collaterale il token non finisce mai in un file di
   configurazione.

Il file di discovery è l'unica aggiunta al main di Electron: oggi porta e token
restano in memoria e vengono iniettati a livello di rete nelle richieste della
finestra (`injectAuthToken`), quindi non c'è nulla su disco da leggere.

## 3. Il nodo WSL — verificato su questa macchina

È il punto che meritava una verifica concreta, e ne esce bene.

**Stato di questa WSL:** networking NAT, non mirrored (gateway `172.23.48.1`,
IP della VM `172.23.62.100`, `nameserver 10.255.255.254`). Conseguenza: il
`127.0.0.1` di Windows **non è raggiungibile** da WSL. Il forwarding di WSL
funziona solo nel verso opposto (Windows → servizi in WSL). Quindi un endpoint
HTTP sul loopback di Windows, così com'è, da WSL non si vede.

**Ma l'interop Windows funziona** (verificato: `cmd.exe` eseguito da WSL
risponde, `/proc/sys/fs/binfmt_misc/WSLInterop` è `enabled`, `/mnt/c` montato).
Un processo Windows lanciato da WSL gira **sul lato Windows**, quindi il
loopback lo raggiunge senza problemi, e lo stdio passa dal pipe di interop.

Va incrociato con il comportamento di VS Code: i server MCP definiti nel
**profilo utente girano sulla macchina locale (Windows)**, quelli definiti nel
**workspace** o nella *remote user configuration* girano sul lato remoto (WSL).

Da cui la soluzione che copre entrambi i casi con un solo artefatto: in
`mcp.json` si punta sempre all'**eseguibile Windows del bridge**.

```jsonc
// profilo utente → il bridge gira su Windows: percorso Windows
{ "servers": { "orabridge": {
    "command": "C:\\Program Files\\Orabridge\\resources\\orabridge-mcp.exe" } } }

// .vscode/mcp.json in un workspace WSL → il bridge gira in WSL,
// ma via interop esegue comunque il binario Windows
{ "servers": { "orabridge": {
    "command": "/mnt/c/Program Files/Orabridge/resources/orabridge-mcp.exe" } } }
```

Nessuna porta esposta sulla rete, nessuna regola di firewall, nessuna dipendenza
dalla versione di Windows. Le alternative sono peggiori e vanno tenute come
ripieghi: *mirrored networking* (`networkingMode=mirrored` in `.wslconfig`,
richiede Windows 11 e una modifica di configurazione dell'utente — in compenso
rende usabile l'endpoint HTTP diretto senza bridge), oppure bind su `0.0.0.0` +
apertura del firewall, che allarga la superficie di attacco per comodità:
sconsigliato.

**Da verificare con uno spike da 10 minuti** (unico rischio residuo di questa
strada): che i pipe stdio attraverso l'interop siano trasparenti abbastanza per
JSON-RPC a righe, in entrambe le direzioni e senza buffering. Un bridge «echo»
lanciato da VS Code in un workspace WSL risponde alla domanda prima di scrivere
qualsiasi altra riga di codice.

## 4. Le tre decisioni di progetto

### 4.1 Sessione Oracle: gli strumenti così come sono sono sbagliati per l'MCP

`run_query` ed `execute_sql` girano su `entry.session` — la sessione dedicata
del worksheet — serializzata da `runExclusive` e con `autoCommit: false`
(`tools.js:528` e `:561`). Va benissimo per il pannello AI, che è dentro l'app e
accompagna l'utente nel suo worksheet. Su MCP produrrebbe due effetti che
l'utente non si aspetta:

- le query di Copilot si **accodano** dietro a quello che l'utente sta eseguendo
  nel worksheet (una query lunga e VS Code va in timeout);
- Copilot **vede le modifiche non confermate** dell'utente e può lasciare lock o
  una transazione aperta sulla sessione del worksheet.

Rimedio: l'esecuzione MCP usa `withPooled` (connessione dal pool), come già
fanno tutti gli strumenti di metadati. È un parametro in più su `runTool`, non
un rifacimento — ma va deciso prima, perché cambia la firma.

### 4.2 Quale connessione

Copilot non ha una UI per scegliere il database, e `selectedConnId` vive solo
nello store del client (`client/src/store.js:90`): il server non sa quale
connessione l'utente stia guardando. Proposta:

- un tool `list_connections` (nome, utente, schema corrente, se connessa);
- su ogni tool un parametro `connection` **opzionale**;
- risoluzione del default: se c'è **una sola** connessione attiva si usa quella;
  altrimenti errore che elenca i candidati (un errore che insegna, come già
  fanno `missingReason` e il fallback di `list_objects`).

Far pubblicare al client la connessione selezionata (`POST /api/mcp/current`)
renderebbe il default «quella che vedi nell'app»: più naturale, ma è un pezzo in
più — meglio in un secondo giro.

### 4.3 Permessi e approvazioni

Il flusso di approvazione di Orabridge è interattivo e vive in chat
(`aiSessions.decide`, `routes/ai.js:153`): su MCP non esiste una controparte
diretta. Per la v1:

- si espongono **solo gli strumenti di lettura**; `execute_sql` dietro
  un'impostazione **disattivata di default**;
- annotazioni MCP `readOnlyHint` sugli strumenti di lettura, così VS Code può
  approvarli automaticamente senza chiedere ogni volta, e `destructiveHint`
  dove serve;
- VS Code chiede comunque conferma all'utente sulle chiamate: è un secondo
  livello, non il primo.

Se in futuro servono le scritture, la strada pulita è instradare l'approvazione
**nella finestra di Orabridge** (l'app è aperta per definizione, il server è
suo) invece di appoggiarsi all'elicitation del client MCP.

## 5. Sicurezza — quello che va detto in chiaro all'utente

1. **I dati escono dalla macchina.** Il risultato di ogni query letta da Copilot
   finisce nel contesto del modello, cioè sui server di GitHub/Microsoft. È
   diverso dal pannello AI solo per il destinatario, non per la sostanza — ma
   qui il destinatario è deciso dalle impostazioni di VS Code, non da Orabridge.
   Va scritto nella UI dove si abilita l'integrazione, non solo nel README.
2. **Prompt injection con conseguenze reali.** Commenti di tabella, nomi di
   oggetti e righe di dati diventano input di un agente che *nella stessa
   sessione* può modificare file ed eseguire comandi nel terminale. Un commento
   ostile su una colonna è un vettore. Tenere le scritture spente e i limiti già
   presenti (`maxRows`, il tetto di 60000 caratteri in `runTool`) è la
   mitigazione minima.
3. **Il file di discovery è una chiave per il database.** Chi lo legge parla col
   server con i privilegi Oracle dell'utente. Su Windows `mode: 0o600` non fa
   nulla (le ACL di `%APPDATA%` sono già per-utente, ma non è la stessa cosa).
   Non è una classe di rischio nuova — `connections.json` e `.key` sono già lì e
   qualunque processo dell'utente può decifrare le password — ma la porta passa
   da «la finestra di Electron» a «qualunque processo locale», e questo va detto.
4. **Il controllo esistente resta valido.** `requireToken` va preteso anche su
   `/mcp`; `requireLocalHost` copre già il DNS rebinding, che è esattamente la
   protezione che la specifica MCP chiede ai server HTTP locali. Da non
   indebolire per far entrare WSL: è il motivo per cui si sceglie il bridge.

## 6. Dipendenze: SDK ufficiale o JSON-RPC a mano

`@modelcontextprotocol/sdk` (1.30.0) porta 17 dipendenze dirette, fra cui
**express 5** e **hono** — accanto all'express 4 che il server usa già, e dentro
un pacchetto dove `prepare-resources.mjs` filtra i `node_modules` per non far
crescere l'installer.

Per un server di soli strumenti il protocollo è piccolo: `initialize`,
`notifications/initialized`, `ping`, `tools/list`, `tools/call`. **Consiglio:
scriverlo a mano** (~150 righe su Express, testabili con `node:test` come il
resto di `server/test/`), zero dipendenze nuove, e il bridge pure senza
dipendenze (`http` + stdin).

Un'avvertenza che pesa su questa scelta: la specifica si è mossa di recente —
la revisione **2026-07-28** ha rimosso la sessione con handshake `initialize`,
spostando versione e capability nei campi `_meta` di ogni richiesta (modello
stateless), e definisce una compatibilità all'indietro con le revisioni
«initialize-based». Quindi l'implementazione va scritta per **rispondere con la
versione che il client chiede** e per riconoscere entrambe le ere. È lavoro
banale ma non ignorabile; se diventasse fastidioso, passare all'SDK resta una
via d'uscita a costo di peso.

## 7. Stima

| Attività | Righe | Tempo |
|---|---|---|
| `routes/mcp.js`: JSON-RPC, `tools/list`, `tools/call`, due ere di protocollo | ~300 | 1 g |
| Token stabile + file di discovery + interruttore nelle impostazioni | ~150 | 0,5 g |
| Bridge stdio + impacchettamento in `electron/resources/` | ~100 | 0,5 g |
| Esecuzione su pool + `list_connections` + risoluzione connessione | ~150 | 0,5 g |
| Test (`server/test/`) + sezione README + esempi `mcp.json` | — | 0,5 g |

**Totale ~3 giorni**, 4 se lo spike WSL riserva sorprese. Un prototipo
dimostrabile — sola lettura, HTTP diretto, connessione singola, niente bridge —
sta in mezza giornata ed è il modo giusto per vedere Copilot leggere una tabella
prima di impegnarsi sul resto.

## 8. Ordine di lavoro

1. Spike stdio via interop da un workspace WSL (10 min, sblocca tutto il resto).
2. Verifica di quale revisione di protocollo manda il VS Code installato.
3. `/mcp` di sola lettura + esecuzione su pool → prova con `"type": "http"` da
   VS Code su Windows.
4. Token stabile, file di discovery, bridge → prova da WSL.
5. `list_connections` e risoluzione del default.
6. Interruttore + avviso nelle impostazioni, README, test.
7. Scritture: solo dopo, e con l'approvazione instradata nella finestra
   dell'app.

## Fonti

- [MCP servers in VS Code](https://code.visualstudio.com/docs/copilot/customization/mcp-servers)
  (formato `mcp.json`, profilo utente vs workspace, dev container)
- [Specifica MCP, revisione 2026-07-28](https://modelcontextprotocol.io/specification/latest)
  e [trasporti](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports)
- [microsoft/vscode#257611](https://github.com/microsoft/vscode/issues/257611),
  [#245045](https://github.com/microsoft/vscode/issues/245045) — dove girano i
  server MCP con Remote-WSL
