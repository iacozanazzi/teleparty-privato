// Service worker: tiene una connessione WebSocket per ogni scheda in una stanza.
// La connessione parte da qui e non dal content script, così la CSP di Netflix non la blocca.
const SERVER_URL = 'ws://localhost:8787';

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'wp') return;
  let ws = null;

  port.onMessage.addListener((msg) => {
    if (msg.type === 'join') {
      ws = new WebSocket(`${SERVER_URL}?room=${encodeURIComponent(msg.room)}`);
      ws.onmessage = (e) => port.postMessage(JSON.parse(e.data));
      ws.onclose = () => {
        try {
          port.postMessage({ type: 'closed' });
        } catch {
          // La scheda è già chiusa.
        }
      };
    } else if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  });

  port.onDisconnect.addListener(() => ws?.close());
});
