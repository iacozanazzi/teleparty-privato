# Watch Party

Estensione Chrome per guardare Netflix in sincrono con gli amici. Uso personale, codice scritto da zero: nessun file di Teleparty.

## Stato: fase 2, sincronizzazione

Fase 1 provata su Netflix vero il 20 ottobre 2026: il seek di 60 secondi funziona senza errori.

Fase 2: più schede nella stessa stanza restano allineate su play, pausa e posizione. Il server per ora gira solo sul tuo computer (`ws://localhost:8787`), quindi funziona tra schede dello stesso computer, non ancora con gli amici: serve un server online, che arriva nella fase 3.

## Come provare la fase 1 (solo il player)

**Senza estensione.** Apri un titolo su Netflix, apri la console di DevTools (Mac `Cmd+Option+J`, Windows `Ctrl+Shift+J`), incolla `spike/console-test.js`. In 5 secondi mette in pausa, salta avanti di 60 secondi e riparte.

**Con l'estensione.**

1. `chrome://extensions`, attiva "Modalità sviluppatore", "Carica estensione non pacchettizzata", scegli la cartella `extension/`.
2. Apri un titolo su Netflix, poi la console.
3. Prova `__watchParty.state()`, `__watchParty.pause()`, `__watchParty.seekBy(60000)`, `__watchParty.play()`.

## Come provare la fase 2 (sync sul tuo computer)

Serve [Node.js](https://nodejs.org) installato.

1. In questa cartella: `npm install`, poi `npm start`. Lascia la finestra aperta.
2. Ricarica l'estensione da `chrome://extensions`.
3. Apri lo stesso titolo in due schede, aggiungendo all'indirizzo `?wpRoom=` seguito da un nome di almeno 16 caratteri, uguale nelle due schede. Esempio: `https://www.netflix.com/watch/81234567?wpRoom=serata-con-amici-2026`.
4. Metti in pausa, salta avanti o riparti in una scheda: l'altra segue entro un secondo.

Netflix può bloccare due video in contemporanea sullo stesso account, a seconda del tuo abbonamento.

## Come funziona la sync

Il server tiene per ogni stanza l'ultimo stato: in riproduzione o in pausa, posizione, e l'ora del server in cui valeva. Ogni scheda calcola dove dovrebbe essere adesso e corregge solo se lo scarto supera un secondo. I comandi arrivati dalla stanza non vengono rimandati indietro (soppressione dell'eco), e chi entra in una stanza si allinea agli altri invece di riportarli all'inizio.

## Test automatico

```
npm install
npm test
```

Carica l'estensione vera in Chromium e la prova su una pagina che imita l'API interna di Netflix (`test/mock-netflix.html`). `test/extension.test.mjs` verifica i comandi al player e la marcatura dell'eco; `test/sync.test.mjs` avvia il server e controlla che tre schede nella stessa stanza restino entro un secondo l'una dall'altra. Non sostituiscono la prova su Netflix vero.

## Struttura

| File | Ruolo |
| --- | --- |
| `extension/page.js` | Gira nel mondo della pagina, unico file che tocca l'API di Netflix |
| `extension/content.js` | Gira nel mondo isolato: ponte tra player e server, correzione dello scarto |
| `extension/background.js` | Service worker: tiene la connessione WebSocket di ogni scheda |
| `server/index.js` | Server delle stanze |
| `spike/console-test.js` | Prova da console, senza estensione |
| `test/` | Test automatico con una finta pagina Netflix |
