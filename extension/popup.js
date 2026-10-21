import { SERVER_URL } from './config.js';

const $ = (id) => document.getElementById(id);
const WATCH_URL = /^https:\/\/www\.netflix\.com\/watch\/(\d+)/;

// Sveglia subito il server gratuito di Render, che dorme dopo 15 minuti senza uso.
fetch(SERVER_URL.replace(/^ws/, 'http')).catch(() => {});

function newRoomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const inviteLink = (titleId, room) => `https://www.netflix.com/watch/${titleId}?wpRoom=${room}`;

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
  const titleId = tab?.url?.match(WATCH_URL)?.[1];
  if (!titleId) {
    $('message').textContent = 'Apri un titolo su Netflix per iniziare.';
    return;
  }

  let status;
  try {
    status = await chrome.tabs.sendMessage(tab.id, { type: 'status' });
  } catch {
    $('message').textContent = 'Ricarica la pagina di Netflix e riapri questo pannello.';
    return;
  }

  if (!status.room) {
    $('message').textContent = 'Crea una stanza e manda il link a chi vuoi.';
    $('no-room').hidden = false;
    $('create').onclick = async () => {
      const room = newRoomId();
      const link = inviteLink(titleId, room);
      await chrome.tabs.update(tab.id, { url: link });
      $('no-room').hidden = true;
      $('in-room').hidden = false;
      $('leave').hidden = true;
      $('link').value = link;
      $('message').textContent = 'Stanza creata.';
      $('copy').onclick = () => copy(link);
      await copy(link);
    };
    return;
  }

  const link = inviteLink(titleId, status.room);
  const people = status.members === 1 ? '1 persona' : `${status.members} persone`;
  $('message').textContent = status.joined ? `Sei in una stanza con ${people}.` : 'Connessione al server in corso…';
  $('in-room').hidden = false;
  $('link').value = link;
  $('copy').onclick = () => copy(link);
  $('leave').onclick = async () => {
    await chrome.tabs.sendMessage(tab.id, { type: 'leave' });
    await chrome.tabs.update(tab.id, { url: `https://www.netflix.com/watch/${titleId}` });
    window.close();
  };
}

render();
