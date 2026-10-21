// Service worker: tiene una connessione WebSocket per ogni scheda in una stanza.
// La connessione parte da qui e non dal content script, così la CSP di Netflix non la blocca.
import { SERVER_URL } from './config.js';

const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 30000;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'wp') return;
  let ws = null;
  let room = null;
  let tabGone = false;
  let retryMs = RETRY_MIN_MS;

  function open() {
    ws = new WebSocket(`${SERVER_URL}?room=${encodeURIComponent(room)}`);
    ws.onopen = () => (retryMs = RETRY_MIN_MS);
    ws.onmessage = (e) => port.postMessage(JSON.parse(e.data));
    ws.onclose = () => {
      if (tabGone) return;
      port.postMessage({ type: 'closed' });
      // Su Render il server gratuito si addormenta: i primi tentativi possono fallire mentre si sveglia.
      setTimeout(() => !tabGone && open(), retryMs);
      retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
    };
  }

  port.onMessage.addListener((msg) => {
    if (msg.type === 'join') {
      room = msg.room;
      open();
    } else if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  });

  port.onDisconnect.addListener(() => {
    tabGone = true;
    ws?.close();
  });
});
