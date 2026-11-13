// Il server genera le credenziali TURN da Cloudflare e le passa a chi apre la videochiamata.
// Uso: node test/turn.test.mjs (Cloudflare è simulato in locale, non serve la rete).
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { startServer } from '../server/index.js';

const calls = [];
let failNext = false;
const cloudflare = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    calls.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body) });
    if (failNext) {
      failNext = false;
      res.writeHead(500);
      return res.end();
    }
    res.writeHead(201, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      iceServers: [
        { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
        {
          urls: [
            'turn:turn.cloudflare.com:3478?transport=udp',
            'turn:turn.cloudflare.com:53?transport=udp',
            'turns:turn.cloudflare.com:443?transport=tcp',
          ],
          username: 'utente-di-prova',
          credential: 'segreto-di-prova',
        },
      ],
    }));
  });
}).listen(8790);

function welcome(port, room) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}?room=${room}&kind=video`);
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === 'video-welcome') resolve({ ws, msg });
    });
    ws.on('error', reject);
  });
}

const env = { TURN_KEY_ID: 'chiave123', TURN_KEY_API_TOKEN: 'token456', TURN_API_URL: 'http://localhost:8790/keys' };
const server = startServer(8788, env);
await new Promise((r) => server.on('listening', r));

// Prima persona: riceve i server TURN, senza gli indirizzi sulla porta 53.
const a = await welcome(8788, 'stanza-turn-0123456789');
const turn = a.msg.iceServers.find((s) => s.username);
assert.equal(turn.username, 'utente-di-prova');
assert.equal(turn.credential, 'segreto-di-prova');
assert.deepEqual(turn.urls, ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp']);
assert.ok(a.msg.iceServers.every((s) => s.urls.every((u) => !u.includes(':53'))));
assert.equal(calls[0].url, '/keys/chiave123/credentials/generate-ice-servers');
assert.equal(calls[0].auth, 'Bearer token456');
assert.equal(calls[0].body.ttl, 86400);
assert.equal(a.msg.peers, 0);

// Seconda persona: stesse credenziali, senza chiederle di nuovo, e la prima viene avvisata.
const joined = new Promise((r) => a.ws.on('message', (raw) => JSON.parse(raw).type === 'peer-joined' && r(JSON.parse(raw))));
const b = await welcome(8788, 'stanza-turn-0123456789');
assert.equal(b.msg.peers, 1);
assert.ok((await joined).iceServers.some((s) => s.username));
assert.equal(calls.length, 1, 'le credenziali vanno tenute in memoria');
a.ws.close();
b.ws.close();
server.close();
server.wss.close();
console.log('ok: credenziali TURN generate, filtrate e riusate');

// Cloudflare non risponde: la videochiamata parte lo stesso, solo con STUN.
failNext = true;
const flaky = startServer(8789, env);
await new Promise((r) => flaky.on('listening', r));
const c = await welcome(8789, 'stanza-turn-9876543210');
assert.ok(c.msg.iceServers.length > 0);
assert.ok(c.msg.iceServers.every((s) => !s.username && s.urls.every((u) => u.startsWith('stun:'))));
c.ws.close();
flaky.close();
flaky.wss.close();
console.log('ok: senza Cloudflare si ripiega su STUN');

// Senza chiave su Render: solo STUN, nessuna chiamata a Cloudflare.
const before = calls.length;
const bare = startServer(8791, {});
await new Promise((r) => bare.on('listening', r));
const d = await welcome(8791, 'stanza-turn-1111111111');
assert.ok(d.msg.iceServers.every((s) => !s.username));
assert.equal(calls.length, before);
d.ws.close();
bare.close();
bare.wss.close();
cloudflare.close();
console.log('ok: senza chiave si usa solo STUN');
