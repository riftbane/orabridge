# Sicurezza

## Segnalare una vulnerabilità

**Non aprire una issue pubblica.** Usa la segnalazione privata di GitHub:
tab **Security** del repository → *Report a vulnerability*
([link diretto](https://github.com/riftbane/orabridge/security/advisories/new)).

Se la segnalazione privata non fosse disponibile, apri una issue che chiede un
contatto **senza descrivere il problema**, e si prosegue in privato da lì.

Nella segnalazione servono: versione di Orabridge, modalità di esecuzione
(desktop Windows, Docker, sviluppo), passi per riprodurre e impatto. Un
proof-of-concept aiuta, ma non serve che sia armato.

Questo è un progetto portato avanti da una persona sola nel tempo libero: non
c'è un programma di bug bounty e non ci sono tempi di risposta garantiti. Una
risposta arriva comunque, e la correzione viene pubblicata come release con
credito a chi ha segnalato, se lo desidera.

## Versioni supportate

Solo l'**ultima release** pubblicata su
[GitHub Releases](https://github.com/riftbane/orabridge/releases/latest). Non ci
sono branch di manutenzione per le versioni precedenti; l'app desktop si
aggiorna da sola.

## Modello di minaccia

Sapere cosa Orabridge *promette* rende più facile capire cosa è un bug.

**Orabridge non ha autenticazione.** Chi raggiunge il server ha in mano le
connessioni salvate e quelle già aperte. Per questo l'accesso è chiuso a monte:

- il server ascolta di default su `127.0.0.1` (`HOST=0.0.0.0` è una scelta
  esplicita di chi lo mette in rete, e allora tocca a lui aggiungere
  autenticazione e TLS davanti);
- l'header `Host` viene verificato quando si ascolta il loopback (difesa dal
  DNS rebinding);
- le scritture accettano solo `application/json` e solo dall'origine della app;
- nell'app desktop il backend risponde solo alla finestra dell'app, grazie a un
  token casuale generato a ogni avvio;
- l'integrazione MCP è spenta di default, è di sola lettura per costruzione e
  vede solo le connessioni esposte una per una.

**Sono in scopo**, per esempio: aggirare uno di quei controlli; leggere le
password delle connessioni o le API key cifrate senza avere accesso alla
cartella dati; far eseguire a un editor esterno via MCP qualcosa che non sia
lettura; far eseguire all'assistente AI istruzioni oltre i permessi concessi
alla sessione; SQL injection nelle query che Orabridge costruisce sul
dizionario; esecuzione di codice arbitrario nel processo Electron a partire da
contenuto del database (per esempio dati mostrati nella griglia).

**Sono fuori scopo**, perché sono conseguenze del progetto e non difetti:

- chi ha già accesso al computer e alla cartella dati (`%APPDATA%\Orabridge`,
  `/data` in Docker) può leggere le credenziali salvate: la chiave di cifratura
  sta lì accanto, serve a proteggere il file, non da un attaccante locale;
- chi espone deliberatamente il server con `HOST=0.0.0.0` senza metterci davanti
  un'autenticazione;
- le conseguenze di permessi concessi a mano all'assistente AI (se autorizzi
  *DELETE e DROP*, il modello può eseguirli) o di un database esposto a un
  editor esterno: i dati letti finiscono nel contesto di quel modello, ed è
  scritto nel README;
- quello che l'utente può già fare da sé con le credenziali che possiede:
  Orabridge non è un livello di autorizzazione sopra Oracle, i privilegi
  restano quelli dell'utenza del database.

## Nota sulle dipendenze

Le vulnerabilità delle librerie di terzi vanno segnalate a monte, al progetto
che le mantiene. Qui interessano quando Orabridge le rende sfruttabili: in quel
caso scrivi pure, indicando la CVE e il percorso.
