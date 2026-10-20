// Fase 1, senza estensione: incolla tutto nella console di DevTools su una pagina
// https://www.netflix.com/watch/... mentre il video è aperto.
(() => {
  const vp = netflix.appContext.state.playerApp.getAPI().videoPlayer;
  const ids = vp.getAllPlayerSessionIds();
  const player = vp.getVideoPlayerBySessionId(ids[ids.length - 1]);
  const log = (label) => console.log(label, (player.getCurrentTime() / 1000).toFixed(1) + 's', player.isPaused() ? 'pausa' : 'play');

  log('Inizio:');
  player.pause();
  setTimeout(() => { log('Dopo pausa:'); player.seek(player.getCurrentTime() + 60000); }, 1000);
  setTimeout(() => { log('Dopo seek +60s:'); player.play(); }, 3000);
  setTimeout(() => log('Dopo play:'), 5000);
})();
