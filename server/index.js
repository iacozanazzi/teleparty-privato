// Server delle stanze: tiene l'ultimo stato di ogni stanza e lo inoltra agli altri.
// Avvio: npm start (porta 8787, o la variabile PORT impostata da Render).
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { pathToFileURL } from 'node:url';

// ID lunghi e casuali: chi non ha il link non indovina la stanza.
const ROOM_ID = /^[A-Za-z0-9_-]{16,64}$/;
// La videochiamata è da persona a persona: oltre due servirebbe un server video.
const MAX_VIDEO_PEERS = 2;

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(clients, msg, except = null) {
  for (const client of clients) if (client !== except) send(client, msg);
}

export function startServer(port = Number(process.env.PORT ?? 8787)) {
  const rooms = new Map();
  // Una pagina normale su "/": serve a Render per capire che il server è vivo
  // e all'estensione per svegliarlo quando è addormentato.
  const http = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*' });
    res.end('ok');
  });
  const wss = new WebSocketServer({ server: http });
  http.listen(port);
  http.wss = wss;

  function getRoom(id) {
    let room = rooms.get(id);
    if (!room) rooms.set(id, (room = { clients: new Set(), video: new Set(), state: null }));
    return room;
  }

  function dropIfEmpty(id, room) {
    if (room.clients.size === 0 && room.video.size === 0) rooms.delete(id);
  }

  function parse(raw) {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  wss.on('connection', (ws, req) => {
    const params = new URL(req.url, 'http://localhost').searchParams;
    const id = params.get('room') ?? '';
    if (!ROOM_ID.test(id)) return ws.close(1008, 'stanza non valida');
    const room = getRoom(id);
    if (params.get('kind') === 'video') onVideo(ws, id, room);
    else onSync(ws, id, room);
  });

  function onSync(ws, id, room) {
    room.clients.add(ws);
    send(ws, { type: 'welcome', state: room.state, serverTime: Date.now() });
    broadcast(room.clients, { type: 'members', count: room.clients.size });

    ws.on('message', (raw) => {
      const msg = parse(raw);
      if (msg?.type === 'ping') {
        send(ws, { type: 'pong', t0: msg.t0, serverTime: Date.now() });
      } else if (
        msg?.type === 'update' &&
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
        broadcast(room.clients, { type: 'state', state: room.state }, ws);
      }
    });

    ws.on('close', () => {
      room.clients.delete(ws);
      broadcast(room.clients, { type: 'members', count: room.clients.size });
      dropIfEmpty(id, room);
    });
  }

  // Canale della videochiamata: il server passa solo i messaggi di WebRTC tra i due browser,
  // il video vero viaggia direttamente da uno all'altro.
  function onVideo(ws, id, room) {
    if (room.video.size >= MAX_VIDEO_PEERS) {
      send(ws, { type: 'video-full' });
      ws.close();
      return dropIfEmpty(id, room);
    }
    send(ws, { type: 'video-welcome', peers: room.video.size });
    broadcast(room.video, { type: 'peer-joined' });
    room.video.add(ws);

    ws.on('message', (raw) => {
      const msg = parse(raw);
      if (msg?.type === 'ping') send(ws, { type: 'pong', t0: msg.t0, serverTime: Date.now() });
      else if (msg?.type === 'signal') broadcast(room.video, { type: 'signal', data: msg.data }, ws);
    });

    ws.on('close', () => {
      if (!room.video.delete(ws)) return;
      broadcast(room.video, { type: 'peer-left' });
      dropIfEmpty(id, room);
    });
  }

  return http;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const http = startServer();
  http.on('listening', () => console.log(`Server stanze in ascolto sulla porta ${http.address().port}`));
}
