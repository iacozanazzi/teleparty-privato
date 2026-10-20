// Gira nel mondo isolato dell'estensione: fa da ponte tra lo script di pagina e il server.
(() => {
  const FROM_PAGE = 'wp-page';
  const FROM_CONTENT = 'wp-content';
  // Sotto questo scarto non si corregge: correzioni continue fanno scattare il video.
  const DRIFT_MS = 1000;
  const CHECK_EVERY_MS = 3000;
  // Netflix fa partire il video da solo all'apertura: in questa finestra ci si allinea alla stanza
  // invece di imporre la propria posizione agli altri.
  const GRACE_MS = 3000;
  const PING_EVERY_MS = 20000;

  const room = readRoom();
  let port = null;
  let joined = false;
  let roomState = null;
  let readySince = null;
  let offsetMs = 0;
  let bestRttMs = Infinity;
  let nextRequestId = 1;
  const pending = new Map();

  function readRoom() {
    const fromUrl = new URLSearchParams(location.search).get('wpRoom');
    // Netflix può riscrivere l'URL: la stanza resta legata alla scheda.
    if (fromUrl) sessionStorage.setItem('wpRoom', fromUrl);
    return fromUrl ?? sessionStorage.getItem('wpRoom');
  }

  const serverNow = () => Date.now() + offsetMs;
  const expectedPosition = (s) => s.positionMs + (s.playing ? serverNow() - s.atServer : 0);

  function ask(cmd, ms) {
    return new Promise((resolve) => {
      const requestId = nextRequestId++;
      pending.set(requestId, resolve);
      window.postMessage({ source: FROM_CONTENT, cmd, ms, requestId }, location.origin);
      setTimeout(() => pending.delete(requestId) && resolve({ ready: false }), 1000);
    });
  }

  function markReady(state) {
    if (state.ready && readySince === null) readySince = Date.now();
  }

  async function reconcile() {
    const local = await ask('state');
    markReady(local);
    if (!roomState || !local.ready) return;
    const target = expectedPosition(roomState);
    if (Math.abs(local.positionMs - target) > DRIFT_MS) await ask('seek', Math.round(target));
    if (local.playing !== roomState.playing) await ask(roomState.playing ? 'play' : 'pause');
  }

  function onLocalEvent(e) {
    markReady(e);
    if (!joined || e.echo || !e.ready || !['play', 'pause', 'seeked'].includes(e.event)) return;
    if (Date.now() - readySince < GRACE_MS) return void reconcile();
    if (
      roomState &&
      e.playing === roomState.playing &&
      Math.abs(e.positionMs - expectedPosition(roomState)) <= DRIFT_MS
    ) return;
    roomState = { playing: e.playing, positionMs: e.positionMs, atServer: serverNow() };
    port.postMessage({ type: 'update', ...roomState });
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.source !== FROM_PAGE) return;
    const data = e.data;
    if (data.type === 'event') {
      const seconds = data.positionMs == null ? '?' : (data.positionMs / 1000).toFixed(1);
      console.debug(`[watch-party] ${data.event} a ${seconds}s, ${data.playing ? 'in riproduzione' : 'in pausa'}${data.echo ? ' (eco)' : ''}`);
      if (room) onLocalEvent(data);
    } else if (pending.has(data.requestId)) {
      pending.get(data.requestId)(data);
      pending.delete(data.requestId);
    }
  });

  if (!room) return;

  port = chrome.runtime.connect({ name: 'wp' });
  const ping = () => port.postMessage({ type: 'ping', t0: Date.now() });

  port.onMessage.addListener((msg) => {
    if (msg.type === 'welcome') {
      offsetMs = msg.serverTime - Date.now();
      joined = true;
      roomState = msg.state;
      // Più ping all'inizio: vale il campione con il viaggio più breve, come in NTP.
      for (let i = 0; i < 5; i++) setTimeout(ping, i * 200);
      reconcile();
    } else if (msg.type === 'pong') {
      const rtt = Date.now() - msg.t0;
      if (rtt <= bestRttMs) {
        bestRttMs = rtt;
        offsetMs = msg.serverTime + rtt / 2 - Date.now();
      }
    } else if (msg.type === 'state') {
      roomState = msg.state;
      reconcile();
    } else if (msg.type === 'closed') {
      joined = false;
      console.warn('[watch-party] connessione al server chiusa');
    }
  });
  port.postMessage({ type: 'join', room });

  setInterval(() => joined && reconcile(), CHECK_EVERY_MS);
  // Tiene sveglio il service worker e aggiorna la misura dell'orologio.
  setInterval(ping, PING_EVERY_MS);
})();
