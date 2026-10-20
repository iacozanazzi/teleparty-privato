// Server delle stanze: tiene l'ultimo stato di ogni stanza e lo inoltra agli altri.
// Avvio: npm start (porta 8787, o la variabile PORT).
import { WebSocketServer } from 'ws';
import { pathToFileURL } from 'node:url';

// ID lunghi e casuali: chi non ha il link non indovina la stanza.
const ROOM_ID = /^[A-Za-z0-9_-]{16,64}$/;

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

export function startServer(port = Number(process.env.PORT ?? 8787)) {
  const rooms = new Map();
  const wss = new WebSocketServer({ port });

  wss.on('connection', (ws, req) => {
    const id = new URL(req.url, 'http://localhost').searchParams.get('room') ?? '';
    if (!ROOM_ID.test(id)) return ws.close(1008, 'stanza non valida');

    let room = rooms.get(id);
    if (!room) rooms.set(id, (room = { clients: new Set(), state: null }));
    room.clients.add(ws);
    send(ws, { type: 'welcome', state: room.state, serverTime: Date.now() });

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      if (msg.type === 'ping') {
        send(ws, { type: 'pong', t0: msg.t0, serverTime: Date.now() });
      } else if (
        msg.type === 'update' &&
        typeof msg.playing === 'boolean' &&
        Number.isFinite(msg.positionMs) &&
        Number.isFinite(msg.atServer)
      ) {
        room.state = {
          playing: msg.playing,
          positionMs: msg.positionMs,
          // Un orologio sbagliato non può spostare lo stato nel futuro.
          atServer: Math.min(msg.atServer, Date.now()),
          seq: (room.state?.seq ?? 0) + 1,
        };
        for (const client of room.clients) if (client !== ws) send(client, { type: 'state', state: room.state });
      }
    });

    ws.on('close', () => {
      room.clients.delete(ws);
      if (room.clients.size === 0) rooms.delete(id);
    });
  });

  return wss;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const wss = startServer();
  wss.on('listening', () => console.log(`Server stanze in ascolto su ws://localhost:${wss.address().port}`));
}
