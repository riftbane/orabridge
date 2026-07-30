# Contribuire a Orabridge

Grazie per l'interesse. Questa pagina raccoglie le poche convenzioni che vale
la pena conoscere prima di aprire una issue o una pull request.

La lingua del progetto è l'**italiano**: interfaccia, README, CHANGELOG,
commenti nel codice e messaggi di commit (a parte il prefisso convenzionale)
sono in italiano. Le issue si possono scrivere anche in inglese.

## Segnalare un problema

Apri una [issue](https://github.com/riftbane/orabridge/issues) e includi:

- versione di Orabridge (Impostazioni → Informazioni, o il nome dell'installer);
- come è in esecuzione: app desktop Windows, Docker, oppure `npm run dev`;
- versione del server Oracle e modalità del driver (*thin* o *thick*: la trovi
  nella vista Connessione);
- cosa ti aspettavi e cosa è successo, con il messaggio d'errore per intero.

**Le vulnerabilità non vanno in una issue pubblica**: vedi [SECURITY.md](SECURITY.md).

Non allegare mai dati reali del database, nomi utente, host o password in una
issue: sono pubbliche. Se serve un caso di prova, anonimizzalo.

## Ambiente di sviluppo

Serve **Node.js 22** (è la versione dell'immagine Docker e dei runner CI) e npm.
Non serve un'installazione Oracle: il driver parte in modalità *thin*.

```bash
# terminale 1 — API su :3000
cd server && npm install && npm run dev

# terminale 2 — frontend con hot reload su :5173
cd client && npm install && npm run dev
```

Serve un database Oracle raggiungibile per provare davvero le modifiche. Se non
ne hai uno, dillo nella PR: la parte pura (confronto schemi, generazione dello
script, classificazione SQL) è coperta da test e si verifica senza database.

## Test

```bash
cd server && npm test    # 167 test
cd client && npm test    # 132 test
```

Girano con il test runner di Node, senza framework esterni. Sono la rete di
sicurezza delle parti che devono restare deterministiche: confronto degli
schemi e script di sincronizzazione, piano DDL dell'editor a nodi,
classificazione delle istruzioni che regola i permessi dell'assistente,
normalizzazione dei conteggi di token, protocollo MCP e sola lettura.

Se tocchi una di quelle, aggiungi il test insieme alla modifica. Le PR che
rompono i test esistenti non vengono unite.

## Messaggi di commit e rilasci

Il rilascio è automatico: **non bumpare la versione a mano e non scrivere il
CHANGELOG a mano**. Ci pensa `.github/workflows/release.yml` a ogni push su
`main`, leggendo i messaggi di commit secondo
[Conventional Commits](https://www.conventionalcommits.org/):

| Prefisso | Effetto |
|---|---|
| `feat:` | bump *minor*, voce nel CHANGELOG |
| `fix:` / `perf:` | bump *patch*, voce nel CHANGELOG |
| `tipo!:` o footer `BREAKING CHANGE:` | bump *major* |
| `docs:` `chore:` `style:` `refactor:` `test:` `build:` `ci:` | nessun rilascio |

Il prefisso è in inglese, la descrizione in italiano:

```
feat: l'albero degli oggetti ricorda i nodi aperti fra un riavvio e l'altro
```

Il corpo del commit finisce nella voce di changelog, quindi vale la pena
scriverlo per chi userà l'app, non per chi legge il diff.

Dettagli completi della pipeline in [`CLAUDE.md`](CLAUDE.md).

## Pull request

- Una PR, una cosa. Più piccola è, prima viene letta.
- Segui lo stile del file che stai modificando: niente riformattazioni di
  massa mescolate a una modifica funzionale.
- Aggiorna la [guida integrata](client/src/guide.js) se cambi qualcosa che
  l'utente vede: è il manuale che si apre con `F1`.
- Descrivi come hai provato la modifica (versione di Oracle compresa, se
  c'entra il database).

## Contributi assistiti dall'AI

Orabridge è stato scritto in gran parte con l'aiuto di modelli linguistici, e i
contributi scritti così sono benvenuti alle stesse condizioni degli altri: chi
apre la PR risponde del codice che propone, lo ha letto, lo ha provato e ha il
diritto di contribuirlo. Codice incollato senza averlo capito si vede, e fa
perdere tempo a tutti.

## Licenza dei contributi

Proponendo un contributo accetti che venga distribuito sotto
[Apache License 2.0](LICENSE), come il resto del progetto (§ 5 della licenza).
Non ci sono CLA da firmare.

Non includere in una PR codice di terzi senza dichiararne origine e licenza, e
in nessun caso codice proprietario o materiale coperto da NDA.
