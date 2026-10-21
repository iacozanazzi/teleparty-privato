# Watch Party

Estensione Chrome per guardare Netflix in sincrono con gli amici. Uso personale, codice scritto da zero: nessun file di Teleparty.

## Stato: fase 3, server online e link di invito

- Fase 1 provata su Netflix vero il 20 ottobre 2026: il seek di 60 secondi funziona senza errori.
- Fase 2: più schede nella stessa stanza restano allineate su play, pausa e posizione.
- Fase 3: il pulsante dell'estensione crea una stanza e copia il link di invito; il server è su Render.
- Videochiamata tra due persone, in un riquadro sopra Netflix.

## Come si usa

1. Apri un titolo su Netflix.
2. Clicca l'icona di Watch Party nella barra di Chrome, poi "Crea stanza". Il link viene copiato.
3. Manda il link agli amici. Quando lo aprono, con l'estensione installata, entrano nella stanza.
4. Play, pausa e salti di chiunque valgono per tutti. Il pannello mostra quante persone ci sono.

La prima connessione della serata può impiegare circa un minuto: il server gratuito di Render dorme dopo 15 minuti senza uso e si sveglia alla prima richiesta.

## Videochiamata

Funziona tra due persone nella stessa stanza.

1. Dal pannello dell'estensione clicca "Avvia videochiamata". Chrome chiede il permesso per camera e microfono: consenti.
2. L'altra persona fa lo stesso dal suo pannello.
3. Vi vedete in un riquadro in basso a destra, anche a schermo intero. I pulsanti spengono microfono e camera o chiudono la chiamata.

Audio e video vanno direttamente da un computer all'altro (WebRTC): il server su Render passa solo i messaggi per mettervi in contatto. Usate le cuffie, altrimenti il microfono riprende l'audio del film.

Se Netflix blocca la camera nel riquadro, compare "Apri in una finestra": la chiamata si apre in una piccola finestra separata, che però non si vede sopra Netflix a schermo intero.

Se il collegamento non riesce ("la vostra rete richiede un server TURN"), una delle due reti blocca il collegamento diretto, succede spesso con l'hotspot del telefono o le reti aziendali. Serve un server TURN che faccia da ponte: esistono servizi con un piano gratuito, ma richiedono un account.

## Installare l'estensione (tu e gli amici)

1. Scarica la cartella `extension/` (per gli amici: mandagliela in uno zip, il repo è privato).
2. In Chrome apri `chrome://extensions` e attiva "Modalità sviluppatore" in alto a destra.
3. "Carica estensione non pacchettizzata" e scegli la cartella `extension/`.

## Server su Render

Il file `render.yaml` descrive il servizio: piano gratuito, `npm ci --omit=dev`, `node server/index.js`. Il servizio è online su https://teleparty-privato.onrender.com (aprendolo nel browser deve comparire "ok"); `extension/config.js` punta a `wss://teleparty-privato.onrender.com`.

## Come provare la fase 1 (solo il player)

**Senza estensione.** Apri un titolo su Netflix, apri la console di DevTools (Mac `Cmd+Option+J`, Windows `Ctrl+Shift+J`), incolla `spike/console-test.js`. In 5 secondi mette in pausa, salta avanti di 60 secondi e riparte.

**Con l'estensione.**

1. `chrome://extensions`, attiva "Modalità sviluppatore", "Carica estensione non pacchettizzata", scegli la cartella `extension/`.
2. Apri un titolo su Netflix, poi la console.
3. Prova `__watchParty.state()`, `__watchParty.pause()`, `__watchParty.seekBy(60000)`, `__watchParty.play()`.

## Come provare la sync sul tuo computer, senza Render

Serve [Node.js](https://nodejs.org) installato.

1. In questa cartella: `npm install`, poi `npm start`. Lascia la finestra aperta.
2. In `extension/config.js` metti temporaneamente `ws://localhost:8787` e ricarica l'estensione da `chrome://extensions`.
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

Carica l'estensione vera in Chromium e la prova su una pagina che imita l'API interna di Netflix (`test/mock-netflix.html`). `test/extension.test.mjs` verifica i comandi al player e la marcatura dell'eco; `test/sync.test.mjs` avvia il server e controlla che tre schede nella stessa stanza restino entro un secondo l'una dall'altra, anche dopo una caduta della connessione; `test/invite.test.mjs` crea una stanza dal popup, fa entrare un amico col link e lo fa uscire; `test/video.test.mjs` collega due schede in videochiamata con una camera finta, anche a schermo intero. Il test video apre finestre vere di Chrome: su Linux senza schermo va lanciato con `xvfb-run -a npm test`. Non sostituiscono la prova su Netflix vero.

## Struttura

| File | Ruolo |
| --- | --- |
| `extension/page.js` | Gira nel mondo della pagina, unico file che tocca l'API di Netflix |
| `extension/content.js` | Gira nel mondo isolato: ponte tra player e server, correzione dello scarto |
| `extension/background.js` | Service worker: tiene la connessione WebSocket di ogni scheda e si ricollega se cade |
| `extension/popup.html`, `popup.js` | Pannello: crea stanza, copia link, esci |
| `extension/config.js` | Indirizzo del server |
| `extension/video.html`, `video.js` | Videochiamata WebRTC, nel riquadro o in una finestra |
| `server/index.js` | Server delle stanze |
| `render.yaml` | Configurazione del servizio su Render |
| `spike/console-test.js` | Prova da console, senza estensione |
| `test/` | Test automatico con una finta pagina Netflix |
