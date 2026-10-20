// Gira nel mondo isolato dell'estensione. Per ora registra gli eventi del player;
// nella fase 2 diventerà il ponte verso il server WebSocket.
(() => {
  const FROM_PAGE = 'wp-page';

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.source !== FROM_PAGE) return;
    const { type, event, playing, positionMs, echo } = e.data;
    if (type !== 'event') return;
    const seconds = positionMs == null ? '?' : (positionMs / 1000).toFixed(1);
    console.debug(`[watch-party] ${event} a ${seconds}s, ${playing ? 'in riproduzione' : 'in pausa'}${echo ? ' (eco)' : ''}`);
  });
})();
