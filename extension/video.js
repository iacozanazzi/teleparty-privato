// Videochiamata tra due persone con WebRTC. Il server della stanza passa solo i messaggi
// per mettere in contatto i due browser; audio e video vanno direttamente da uno all'altro.
// La pagina gira in un riquadro sopra Netflix oppure, se Netflix blocca la camera, in una finestra.
import { SERVER_URL } from './config.js';

const $ = (id) => document.getElementById(id);
const room = new URLSearchParams(location.hash.slice(1)).get('room');
const inFrame = window.top !== window;
// STUN serve a scoprire il proprio indirizzo pubblico. Senza un server TURN alcune reti
// (hotspot del telefono, reti aziendali) non riescono a collegarsi.
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

let localStream = null;
let ws = null;
let pc = null;
let polite = false;
let makingOffer = false;
let ignoreOffer = false;
let signalQueue = Promise.resolve();
let roomFull = false;

const status = (text) => {
  $('status').textContent = text;
  $('status').hidden = !text;
};

function close() {
  pc?.close();
  ws?.close();
  for (const track of localStream?.getTracks() ?? []) track.stop();
  if (inFrame) window.parent.postMessage({ source: 'wp-video', type: 'close' }, '*');
  else window.close();
}

function showCameraError(err) {
  const blocked = err.name === 'NotAllowedError' || err.name === 'SecurityError';
  status(blocked ? 'Chrome o Netflix non permettono la camera qui.' : `Camera non disponibile (${err.name}).`);
  if (!inFrame) return;
  // Una finestra dell'estensione chiede il permesso per conto suo, senza passare da Netflix.
  const button = document.createElement('button');
  button.id = 'fallback';
  button.textContent = 'Apri in una finestra';
  button.onclick = async () => {
    await chrome.windows.create({ url: location.href, type: 'popup', width: 420, height: 320 });
    close();
  };
  $('status').append(button);
}

function signal(data) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'signal', data }));
}

function createPeer() {
  pc?.close();
  pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  for (const track of localStream.getTracks()) pc.addTrack(track, localStream);

  pc.ontrack = ({ streams }) => {
    $('remote').srcObject = streams[0];
  };
  pc.onicecandidate = ({ candidate }) => candidate && signal({ candidate });
  pc.onnegotiationneeded = async () => {
    try {
      makingOffer = true;
      await pc.setLocalDescription();
      signal({ description: pc.localDescription });
    } catch (err) {
      console.error('[watch-party] offerta fallita', err);
    } finally {
      makingOffer = false;
    }
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') status('');
    else if (pc.connectionState === 'connecting') status('Collegamento in corso…');
    else if (pc.connectionState === 'failed') {
      status('Collegamento non riuscito: la vostra rete richiede un server TURN.');
      pc.restartIce();
    }
  };
}

// "Perfect negotiation" di WebRTC: se entrambi propongono insieme, chi è "educato" cede.
async function onSignal({ description, candidate }) {
  if (!pc) return;
  if (description) {
    const collision = description.type === 'offer' && (makingOffer || pc.signalingState !== 'stable');
    ignoreOffer = !polite && collision;
    if (ignoreOffer) return;
    await pc.setRemoteDescription(description);
    if (description.type === 'offer') {
      await pc.setLocalDescription();
      signal({ description: pc.localDescription });
    }
  } else if (candidate) {
    try {
      await pc.addIceCandidate(candidate);
    } catch (err) {
      if (!ignoreOffer) console.error('[watch-party] candidato rifiutato', err);
    }
  }
}

function connect() {
  ws = new WebSocket(`${SERVER_URL}?room=${encodeURIComponent(room)}&kind=video`);
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'video-welcome') {
      // Chi entra per secondo è quello educato.
      polite = msg.peers > 0;
      if (msg.peers > 0) createPeer();
      else status('In attesa dell\'altra persona…');
    } else if (msg.type === 'peer-joined') {
      polite = false;
      createPeer();
    } else if (msg.type === 'peer-left') {
      pc?.close();
      pc = null;
      $('remote').srcObject = null;
      status('L\'altra persona ha chiuso la videochiamata.');
    } else if (msg.type === 'signal') {
      signalQueue = signalQueue.then(() => onSignal(msg.data)).catch((err) => console.error(err));
    } else if (msg.type === 'video-full') {
      roomFull = true;
      status('La videochiamata funziona solo tra due persone, e ce ne sono già due.');
    }
  };
  ws.onclose = () => {
    if (!roomFull && (!pc || pc.connectionState !== 'connected')) status('Connessione al server persa.');
  };
  setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'ping', t0: Date.now() })), 20000);
}

function toggle(kind, button) {
  const tracks = kind === 'audio' ? localStream?.getAudioTracks() : localStream?.getVideoTracks();
  for (const track of tracks ?? []) track.enabled = !track.enabled;
  button.classList.toggle('off', tracks?.[0] ? !tracks[0].enabled : false);
}

$('mic').onclick = () => toggle('audio', $('mic'));
$('cam').onclick = () => toggle('video', $('cam'));
$('close').onclick = close;

async function start() {
  if (!room) return status('Manca la stanza.');
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: true });
  } catch (err) {
    return showCameraError(err);
  }
  $('local').srcObject = localStream;
  status('Connessione al server…');
  connect();
}

start();
