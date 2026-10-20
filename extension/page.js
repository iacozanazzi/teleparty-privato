// Gira nel mondo della pagina (MAIN): l'unico punto che tocca l'API interna di Netflix.
// Se Netflix cambia il player, si corregge solo questo file.
(() => {
  const FROM_PAGE = 'wp-page';
  const FROM_CONTENT = 'wp-content';
  // Eventi del player entro questa finestra dopo un comando remoto sono marcati come eco.
  const ECHO_WINDOW_MS = 700;
  let suppressUntil = 0;

  function getPlayer() {
    try {
      const videoPlayer = window.netflix.appContext.state.playerApp.getAPI().videoPlayer;
      const ids = videoPlayer.getAllPlayerSessionIds();
      // Su /watch c'è un solo player; le anteprime in home ne creano altri, prendiamo l'ultimo.
      const id = ids[ids.length - 1];
      return id ? videoPlayer.getVideoPlayerBySessionId(id) : null;
    } catch {
      return null;
    }
  }

  function readState() {
    const player = getPlayer();
    if (!player) return { ready: false };
    return {
      ready: true,
      playing: !player.isPaused(),
      positionMs: Math.round(player.getCurrentTime()),
      titleId: location.pathname.match(/\/watch\/(\d+)/)?.[1] ?? null,
    };
  }

  function post(type, extra = {}) {
    window.postMessage({ source: FROM_PAGE, type, ...readState(), ...extra }, location.origin);
  }

  function apply(cmd, ms) {
    const player = getPlayer();
    if (!player) return false;
    suppressUntil = Date.now() + ECHO_WINDOW_MS;
    if (cmd === 'play') player.play();
    else if (cmd === 'pause') player.pause();
    // Mai video.currentTime: Netflix risponde con l'errore M7375.
    else if (cmd === 'seek') player.seek(ms);
    else return false;
    return true;
  }

  // Gli eventi media non risalgono il DOM, ma la fase di cattura su document li vede tutti,
  // anche quando Netflix sostituisce l'elemento <video>.
  for (const name of ['play', 'pause', 'seeked', 'waiting', 'playing']) {
    document.addEventListener(name, () => post('event', { event: name, echo: Date.now() < suppressUntil }), true);
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.source !== FROM_CONTENT) return;
    const { cmd, ms, requestId } = e.data;
    if (cmd === 'state') post('state', { requestId });
    else post('ack', { requestId, ok: apply(cmd, ms) });
  });

  // Comodo per provare dalla console di DevTools nella scheda Netflix.
  window.__watchParty = {
    state: readState,
    play: () => apply('play'),
    pause: () => apply('pause'),
    seek: (ms) => apply('seek', ms),
    seekBy: (deltaMs) => apply('seek', readState().positionMs + deltaMs),
  };
})();
