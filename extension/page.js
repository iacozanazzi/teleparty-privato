// Gira nel mondo della pagina (MAIN): l'unico punto che tocca il player del servizio di streaming.
// Ogni servizio ha il suo adattatore; se un servizio cambia il player, si corregge solo quello.
(() => {
  const FROM_PAGE = 'wp-page';
  const FROM_CONTENT = 'wp-content';
  // Eventi del player entro questa finestra dopo un comando remoto sono marcati come eco.
  const ECHO_WINDOW_MS = 700;
  const MEDIA_EVENTS = ['play', 'pause', 'seeked', 'waiting', 'playing'];
  let suppressUntil = 0;

  // Netflix: API interna del player. Mai video.currentTime: Netflix risponde con l'errore M7375.
  const netflix = {
    getPlayer() {
      try {
        const videoPlayer = window.netflix.appContext.state.playerApp.getAPI().videoPlayer;
        const ids = videoPlayer.getAllPlayerSessionIds();
        // Su /watch c'è un solo player; le anteprime in home ne creano altri, prendiamo l'ultimo.
        const id = ids[ids.length - 1];
        return id ? videoPlayer.getVideoPlayerBySessionId(id) : null;
      } catch {
        return null;
      }
    },
    titleId: () => location.pathname.match(/\/watch\/(\d+)/)?.[1] ?? null,
  };

  // Elementi <video> anche dentro gli shadow root, dove document.querySelectorAll non arriva.
  function allVideos(root = document, found = []) {
    for (const el of root.querySelectorAll('*')) {
      if (el instanceof HTMLVideoElement) found.push(el);
      if (el.shadowRoot) allVideos(el.shadowRoot, found);
    }
    return found;
  }

  // Prime Video: un normale <video>. Tra anteprime e trailer si sceglie il più grande con un film caricato.
  const prime = {
    getVideo() {
      let best = null;
      let bestArea = 0;
      for (const video of allVideos()) {
        const rect = video.getBoundingClientRect();
        const area = rect.width * rect.height;
        if (video.readyState > 0 && Number.isFinite(video.duration) && video.duration > 0 && area > bestArea) {
          best = video;
          bestArea = area;
        }
      }
      return best;
    },
    getPlayer() {
      const video = prime.getVideo();
      if (!video) return null;
      listenTo(video);
      return {
        isPaused: () => video.paused,
        getCurrentTime: () => video.currentTime * 1000,
        play: () => video.play().catch(() => {}),
        pause: () => video.pause(),
        seek: (ms) => (video.currentTime = ms / 1000),
      };
    },
    titleId: () => location.pathname.match(/\/(?:detail|dp)\/([^/?]+)/)?.[1] ?? null,
  };

  const adapter = location.hostname.endsWith('netflix.com') ? netflix : prime;

  function readState() {
    const player = adapter.getPlayer();
    if (!player) return { ready: false };
    return {
      ready: true,
      playing: !player.isPaused(),
      positionMs: Math.round(player.getCurrentTime()),
      titleId: adapter.titleId(),
    };
  }

  function post(type, extra = {}) {
    window.postMessage({ source: FROM_PAGE, type, ...readState(), ...extra }, location.origin);
  }

  function apply(cmd, ms) {
    const player = adapter.getPlayer();
    if (!player) return false;
    suppressUntil = Date.now() + ECHO_WINDOW_MS;
    if (cmd === 'play') player.play();
    else if (cmd === 'pause') player.pause();
    else if (cmd === 'seek') player.seek(ms);
    else return false;
    return true;
  }

  const onMediaEvent = (e) => post('event', { event: e.type, echo: Date.now() < suppressUntil });

  // Gli eventi media non risalgono il DOM, ma la fase di cattura su document li vede tutti,
  // anche quando il servizio sostituisce l'elemento <video>.
  for (const name of MEDIA_EVENTS) document.addEventListener(name, onMediaEvent, true);

  // Dentro uno shadow root la cattura su document non arriva: lì ci si aggancia al <video> stesso.
  const watched = new WeakSet();
  function listenTo(video) {
    if (watched.has(video) || video.getRootNode() === document) return;
    watched.add(video);
    for (const name of MEDIA_EVENTS) video.addEventListener(name, onMediaEvent);
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.source !== FROM_CONTENT) return;
    const { cmd, ms, requestId } = e.data;
    if (cmd === 'state') post('state', { requestId });
    else post('ack', { requestId, ok: apply(cmd, ms) });
  });

  // Comodo per provare dalla console di DevTools nella scheda del film.
  window.__watchParty = {
    state: readState,
    play: () => apply('play'),
    pause: () => apply('pause'),
    seek: (ms) => apply('seek', ms),
    seekBy: (deltaMs) => apply('seek', readState().positionMs + deltaMs),
  };
})();
