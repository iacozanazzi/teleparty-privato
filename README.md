# Watch Party

Estensione Chrome per guardare Netflix in sincrono con gli amici. Uso personale, codice scritto da zero: nessun file di Teleparty.

## Stato: fase 1, controllo del player

L'estensione per ora non sincronizza nulla. Prova solo che riusciamo a comandare il player di Netflix senza errori.

## Come provarla

**Senza estensione.** Apri un titolo su Netflix, apri DevTools (F12), scheda Console, incolla `spike/console-test.js`. In 5 secondi mette in pausa, salta avanti di 60 secondi e riparte, stampando la posizione a ogni passo.

**Con l'estensione.**

1. `chrome://extensions`, attiva "Modalità sviluppatore", "Carica estensione non pacchettizzata", scegli la cartella `extension/`.
2. Apri un titolo su Netflix, poi la console di DevTools.
3. Prova `__watchParty.state()`, `__watchParty.pause()`, `__watchParty.seekBy(60000)`, `__watchParty.play()`.
4. Nella console vedi le righe `[watch-party]` per ogni play, pausa e seek. Quelle causate da un comando sono marcate `(eco)`, quelle fatte da te con il mouse no.

Per vedere le righe `[watch-party]` attiva il livello "Verbose" nel filtro della console.

**Criterio per passare alla fase 2:** il seek di 60 secondi funziona senza l'errore Netflix M7375 e le righe `(eco)` compaiono solo per i comandi.

## Test automatico

```
npm install
npm test
```

Carica l'estensione vera in Chromium e la prova su una pagina che imita l'API interna di Netflix (`test/mock-netflix.html`). Verifica i comandi, i messaggi tra i due script e la marcatura dell'eco. Non sostituisce la prova su Netflix vero.

## Struttura

| File | Ruolo |
| --- | --- |
| `extension/page.js` | Gira nel mondo della pagina, unico file che tocca l'API di Netflix |
| `extension/content.js` | Gira nel mondo isolato; per ora registra gli eventi, nella fase 2 parlerà col server |
| `spike/console-test.js` | Prova da console, senza estensione |
| `test/` | Test automatico con una finta pagina Netflix |
