# Componenti di terze parti

Orabridge è distribuito sotto [Apache License 2.0](LICENSE). Quella licenza
copre il codice di questo repository, **non** i componenti di terzi elencati
qui: ognuno resta soggetto alle proprie condizioni, ed è quello che conta
quando si ridistribuisce l'applicazione o la si usa in azienda.

L'elenco è diviso per come il componente arriva all'utente, perché è la
distinzione che cambia gli obblighi: una cosa è una libreria impacchettata
dentro l'installer, un'altra un file che l'utente sceglie di scaricare.

## Ridistribuiti dentro l'installer Windows (`.exe`)

| Componente | Licenza | Note |
|---|---|---|
| [Oracle Instant Client](https://www.oracle.com/database/technologies/instant-client.html) 19.23 (Basic Lite, x64) | Licenza a sé di Oracle — vedi sotto | Abilita la modalità *thick* del driver |
| [Electron](https://github.com/electron/electron) | MIT | Include Chromium e Node.js, con le rispettive licenze ([`LICENSES.chromium.html`](https://github.com/electron/electron/blob/main/LICENSE) nel pacchetto) |
| [node-oracledb](https://github.com/oracle/node-oracledb) | Apache-2.0 **oppure** UPL-1.0, a scelta di chi la riceve | Driver Oracle per Node.js. Copyright © 2015, 2026, Oracle and/or its affiliates |
| [node-llama-cpp](https://github.com/withcatai/node-llama-cpp) | MIT | Include i binari di [llama.cpp](https://github.com/ggml-org/llama.cpp) (MIT) |
| [Express](https://github.com/expressjs/express) | MIT | |
| [React](https://github.com/facebook/react), [zustand](https://github.com/pmndrs/zustand), [CodeMirror 6](https://github.com/codemirror/dev) | MIT | Bundle del client |

### node-oracledb

Il driver è **dual-licensed**: chi lo riceve può prenderlo sotto
[Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) **oppure**
sotto [Universal Permissive License (UPL) 1.0](https://oss.oracle.com/licenses/upl),
a sua scelta. Nell'installer il pacchetto viaggia intero, con i suoi
`LICENSE.txt` e `NOTICE.txt`, quindi il testo che vincola è quello che arriva
insieme al codice.

Da non confondere: node-oracledb è software **open source** pubblicato da Oracle,
l'Instant Client no. Sono due cose con due licenze diverse, e solo la seconda ha
condizioni da leggere prima di ridistribuire.

### Oracle Instant Client

L'Instant Client **non è software di questo progetto** ed è l'unico componente
non open source che l'installer si porta dietro: è distribuito da Oracle alle
condizioni che Oracle stabilisce, pubblicate sulla
[pagina di licenza](https://www.oracle.com/downloads/licenses/instant-client-lic.html)
e sulla [pagina di download](https://www.oracle.com/database/technologies/instant-client/downloads.html).
La licenza Apache di Orabridge non concede alcun diritto su di esso.

Si tratta della *OTN Development and Distribution License for Instant Client*,
una licenza separata dalla OTN ordinaria: sulla propria pagina di download
Oracle la descrive come tale da consentire alla maggior parte dei licenziatari
di scaricare, ridistribuire e usare in produzione l'Instant Client senza costi,
rimandando comunque alla lettura del testo. Quel testo, nella versione
pubblicata da Oracle al momento del download, è l'unico che vincola: qui non se
ne riporta né se ne riassume il contenuto con valore legale, e chi ridistribuisce
una build che include l'Instant Client fa bene a leggerlo di persona.

Dove finisce, in concreto:

- **Immagine Docker**: scaricato da `download.oracle.com` durante la build
  (vedi `Dockerfile`). Chi costruisce l'immagine scarica il componente
  direttamente da Oracle e accetta le condizioni di Oracle.
- **Installer Windows**: scaricato in fase di build da `prepare-resources.mjs` e
  incluso nell'`.exe` pubblicato su GitHub Releases.
- **Sorgenti**: nessun file di Oracle è committato in questo repository.

Si può fare a meno dell'Instant Client: senza, il driver funziona in modalità
*thin*, che non richiede alcun software Oracle installato (in cambio servono
server 12.1+ e password verifier 11G/12C). Nel deployment Docker basta
`ORACLE_THICK_MODE=0`; per una build desktop senza Instant Client,
`npm start` usa già `--skip-instantclient`.

## Scaricati a tempo di esecuzione, su richiesta dell'utente

| Componente | Licenza | Note |
|---|---|---|
| Pesi dei modelli **Gemma 4** (`.gguf`) | [Gemma Terms of Use](https://ai.google.dev/gemma/terms) di Google | Scaricati da [HuggingFace](https://huggingface.co/unsloth) nella cartella dati solo se l'utente sceglie la piattaforma «Modello locale» |

I file dei pesi non sono né committati né impacchettati: restano sul computer
dell'utente, e l'uso è soggetto alle condizioni di Google.

## Servizi esterni contattati su configurazione dell'utente

Orabridge non incorpora SDK di questi servizi (parla HTTP con `fetch`), ma se
l'utente configura una piattaforma AI le richieste — e quindi i dati inclusi nel
contesto — vanno ai loro server, alle loro condizioni: OpenRouter, Anthropic,
Google Gemini, OpenAI. Vale anche per l'integrazione MCP: quello che un editor
esterno legge dal database finisce nel contesto del suo modello.

## Come viaggiano le attribuzioni

Quasi tutte queste licenze (MIT, ISC, Apache-2.0, UPL) chiedono la stessa cosa
a chi ridistribuisce: che le note di copyright arrivino insieme al codice. In
Orabridge succede senza che nessuno ci pensi ogni volta, ed è bene sapere dove
guardare se un giorno si tocca la catena di build:

- **Dipendenze del server** (`node-oracledb`, `node-llama-cpp`, Express…):
  `electron/scripts/prepare-resources.mjs` copia `node_modules` per intero, e il
  filtro esclude solo i binari llama.cpp inutili e il bundle dei sorgenti. I
  `LICENSE`/`NOTICE` dei pacchetti finiscono quindi nell'installer come sono.
- **Bundle del client**: la build Vite conserva i commenti legali marcati
  `@license` (React, lucide-react e gli altri li portano nel sorgente). I
  pacchetti che non usano quella convenzione — CodeMirror, zustand — sono
  attribuiti qui in questo file, che è il posto previsto dalle rispettive
  licenze quando la forma distribuita è un bundle minificato.
- **Electron**: le licenze di Chromium e Node.js viaggiano dentro il pacchetto
  Electron (`LICENSES.chromium.html`) e finiscono nella cartella di
  installazione.

Se un domani la build imparasse a sfoltire `node_modules` file per file, o a
buttare via i commenti legali per guadagnare qualche KB, è qui che si
romperebbe la conformità.

## Elenco completo delle dipendenze

Le tabelle qui sopra sono i componenti principali. L'elenco completo, con le
licenze dichiarate da ogni pacchetto, si ottiene dai lockfile:

```bash
cd server && npx license-checker --summary   # idem in client/ ed electron/
```
