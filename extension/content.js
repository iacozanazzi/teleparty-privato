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
  let members = 0;
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

  function connect() {
    port = chrome.runtime.connect({ name: 'wp' });
    port.onMessage.addListener(onServerMessage);
    // Il service worker può essere fermato da Chrome: in quel caso ci si ricollega.
    port.onDisconnect.addListener(() => {
      joined = false;
      if (room) setTimeout(connect, 1000);
    });
    port.postMessage({ type: 'join', room });
  }

  function onServerMessage(msg) {
    if (msg.type === 'welcome') {
      offsetMs = msg.serverTime - Date.now();
      bestRttMs = Infinity;
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
    } else if (msg.type === 'members') {
      members = msg.count;
    } else if (msg.type === 'closed') {
      joined = false;
      console.warn('[watch-party] connessione al server persa, riprovo');
    }
  }

  const ping = () => joined && port.postMessage({ type: 'ping', t0: Date.now() });

  // Riquadro della videochiamata: una pagina dell'estensione in un iframe, così il permesso
  // della camera è chiesto per l'estensione e non per netflix.com.
  let videoFrame = null;

  function openVideo() {
    if (videoFrame) return;
    videoFrame = document.createElement('iframe');
    videoFrame.src = `${chrome.runtime.getURL('video.html')}#room=${encodeURIComponent(room)}`;
    videoFrame.allow = 'camera; microphone; autoplay';
    videoFrame.title = 'Videochiamata';
    Object.assign(videoFrame.style, {
      position: 'fixed', right: '16px', bottom: '96px', width: '320px', height: '240px',
      border: '0', borderRadius: '8px', boxShadow: '0 4px 16px rgba(0,0,0,0.5)', zIndex: '2147483647',
    });
    (document.fullscreenElement ?? document.body).append(videoFrame);
  }

  function closeVideo() {
    videoFrame?.remove();
    videoFrame = null;
  }

  window.addEventListener('message', (e) => {
    if (videoFrame && e.source === videoFrame.contentWindow && e.data?.source === 'wp-video' && e.data.type === 'close') {
      closeVideo();
    }
  });

  // A schermo intero si vede solo l'elemento in fullscreen: il riquadro gli va spostato dentro.
  // moveBefore lo sposta senza ricaricarlo, quindi la chiamata non cade.
  document.addEventListener('fullscreenchange', () => {
    const host = document.fullscreenElement ?? document.body;
    if (!videoFrame || videoFrame.parentNode === host || host instanceof HTMLMediaElement) return;
    if (host.moveBefore) host.moveBefore(videoFrame, null);
  });

  // Domande dal popup.
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg.type === 'status') {
      reply({ room, joined, members, video: Boolean(videoFrame) });
    } else if (msg.type === 'video') {
      if (room && !videoFrame) openVideo();
      else closeVideo();
      reply({ video: Boolean(videoFrame) });
    } else if (msg.type === 'leave') {
      closeVideo();
      sessionStorage.removeItem('wpRoom');
      room = null;
      joined = false;
      port?.disconnect();
      reply({ ok: true });
    }
  });

  if (!room) return;
  connect();

  setInterval(() => joined && room && reconcile(), CHECK_EVERY_MS);
  // Tiene sveglio il service worker e aggiorna la misura dell'orologio.
  setInterval(ping, PING_EVERY_MS);
})();
