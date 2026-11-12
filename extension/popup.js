import { SERVER_URL } from './config.js';

const $ = (id) => document.getElementById(id);
const NETFLIX_TITLE = /^https:\/\/www\.netflix\.com\/watch\/(\d+)/;
const PRIME_PAGE = /^https:\/\/www\.(primevideo\.com\/|amazon\.(it|com|de|co\.uk|fr|es)\/gp\/video\/)/;

// Sveglia subito il server gratuito di Render, che dorme dopo 15 minuti senza uso.
fetch(SERVER_URL.replace(/^ws/, 'http')).catch(() => {});

function newRoomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Indirizzo della pagina senza stanza: su Netflix la pagina del titolo, su Prime Video la pagina attuale.
function baseUrl(tabUrl) {
  const netflixId = tabUrl?.match(NETFLIX_TITLE)?.[1];
  if (netflixId) return `https://www.netflix.com/watch/${netflixId}`;
  if (!PRIME_PAGE.test(tabUrl ?? '')) return null;
  const url = new URL(tabUrl);
  url.searchParams.delete('wpRoom');
  return url.href;
}

function inviteLink(base, room) {
  const url = new URL(base);
  url.searchParams.set('wpRoom', room);
  return url.href;
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    $('note').textContent = 'Link copiato: mandalo ai tuoi amici. Devono avere l\'estensione installata.';
  } catch {
    $('note').textContent = 'Copia il link dal riquadro qui sopra.';
  }
}

async function targetTab() {
  // I test aprono il popup come pagina normale e indicano la scheda con ?tab=.
  const forced = Number(new URLSearchParams(location.search).get('tab'));
  if (forced) return chrome.tabs.get(forced);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function render() {
  const tab = await targetTab();
  const base = baseUrl(tab?.url);
  if (!base) {
    $('message').textContent = 'Apri un titolo su Netflix o Prime Video per iniziare.';
    return;
  }

  let status;
  try {
    status = await chrome.tabs.sendMessage(tab.id, { type: 'status' });
  } catch {
    $('message').textContent = 'Ricarica la pagina del film e riapri questo pannello.';
    return;
  }

  if (!status.room) {
    $('message').textContent = 'Crea una stanza e manda il link a chi vuoi.';
    $('no-room').hidden = false;
    $('create').onclick = async () => {
      const room = newRoomId();
      const link = inviteLink(base, room);
      await chrome.tabs.sendMessage(tab.id, { type: 'join', room });
      $('no-room').hidden = true;
      $('in-room').hidden = false;
      $('leave').hidden = true;
      $('video').hidden = true;
      $('link').value = link;
      $('message').textContent = 'Stanza creata.';
      $('copy').onclick = () => copy(link);
      await copy(link);
    };
    return;
  }

  const link = inviteLink(base, status.room);
  const people = status.members === 1 ? '1 persona' : `${status.members} persone`;
  $('message').textContent = status.joined ? `Sei in una stanza con ${people}.` : 'Connessione al server in corso…';
  $('in-room').hidden = false;
  $('link').value = link;
  $('copy').onclick = () => copy(link);
  const videoLabel = (on) => (on ? 'Chiudi videochiamata' : 'Avvia videochiamata');
  $('video').textContent = videoLabel(status.video);
  $('video').onclick = async () => {
    const { video } = await chrome.tabs.sendMessage(tab.id, { type: 'video' });
    $('video').textContent = videoLabel(video);
    if (video) $('note').textContent = 'Anche l\'altra persona deve avviare la videochiamata dal suo pannello.';
  };
  $('leave').onclick = async () => {
    await chrome.tabs.sendMessage(tab.id, { type: 'leave' });
    window.close();
  };
}

render();
