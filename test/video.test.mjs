// Videochiamata: due schede nella stessa stanza si vedono, anche a schermo intero, e chiudono.
// Usa una camera finta di Chromium. Uso: node test/video.test.mjs (su Linux senza schermo: xvfb-run -a node ...)
import { chromium } from 'playwright';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { startServer } from '../server/index.js';
import { localExtension } from './local-extension.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ext = localExtension(join(root, 'extension'));
const ROOM_URL = 'https://www.netflix.com/watch/81234567?wpRoom=stanza-video-0123456789';

const server = startServer(8787);
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'wp-')), {
  // In modalità headless i clic dentro l'iframe dell'estensione si perdono: serve una finestra vera.
  headless: false,
  channel: 'chromium', // la headless shell predefinita non carica estensioni
  args: [
    `--disable-extensions-except=${ext}`,
    `--load-extension=${ext}`,
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
  ],
});
await ctx.route('https://www.netflix.com/**', (r) =>
  r.fulfill({ contentType: 'text/html', body: readFileSync(join(root, 'test/mock-netflix.html')) }));
const worker = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
const extId = new URL(worker.url()).host;
const control = await ctx.newPage();
await control.goto(`chrome-extension://${extId}/popup.html`);

let nextLabel = 1;
async function openTab() {
  const page = await ctx.newPage();
  await page.goto(ROOM_URL);
  await page.waitForFunction(() => window.__watchParty);
  page.label = `scheda-${nextLabel++}`;
  await page.evaluate((l) => (document.title = l), page.label);
  return page;
}

// Lo stesso messaggio che manda il pulsante "Avvia videochiamata" del popup.
async function toggleVideo(page) {
  return control.evaluate(async (l) => {
    const [tab] = await chrome.tabs.query({ title: l });
    return chrome.tabs.sendMessage(tab.id, { type: 'video' });
  }, page.label);
}

const videoFrame = (page) => page.frames().find((f) => f.url().includes('/video.html'));

async function waitRemoteVideo(page, label) {
  await page.waitForFunction(() => document.querySelector('iframe[title="Videochiamata"]'));
  await page.waitForTimeout(200);
  await videoFrame(page).waitForFunction(() => {
    const v = document.getElementById('remote');
    return v.srcObject && v.videoWidth > 0 && v.readyState >= 2;
  }, null, { timeout: 20000 });
  console.log(`ok ${label}`);
}

try {
  const a = await openTab();
  const b = await openTab();
  await a.waitForTimeout(1000);

  assert.deepEqual(await toggleVideo(a), { video: true });
  await videoFrame(a)?.waitForFunction(() => document.getElementById('status').textContent.includes('attesa'));
  assert.deepEqual(await toggleVideo(b), { video: true });
  await waitRemoteVideo(a, 'A vede B');
  await waitRemoteVideo(b, 'B vede A');

  // Schermo intero: il riquadro finisce dentro il player senza ricaricarsi.
  const frameBefore = videoFrame(a);
  await a.bringToFront(); // Chrome concede lo schermo intero solo alla scheda in primo piano
  await a.click('#fullscreen');
  await a.waitForFunction(() => document.fullscreenElement?.id === 'player');
  await a.waitForFunction(() => document.querySelector('iframe[title="Videochiamata"]').parentNode.id === 'player');
  assert.equal(videoFrame(a), frameBefore, 'il riquadro non è stato ricaricato');
  assert.ok(await frameBefore.evaluate(() => document.getElementById('remote').videoWidth > 0), 'la chiamata continua');
  console.log('ok a schermo intero il riquadro resta visibile e la chiamata continua');
  await a.evaluate(() => document.exitFullscreen());

  // Una terza persona non entra nella videochiamata.
  const c = await openTab();
  await toggleVideo(c);
  await c.waitForFunction(() => document.querySelector('iframe[title="Videochiamata"]'));
  await c.waitForTimeout(200);
  await videoFrame(c).waitForFunction(() => document.getElementById('status').textContent.includes('solo tra due'));
  console.log('ok la terza persona viene avvisata che la videochiamata è per due');

  // B chiude dal pulsante del riquadro: il riquadro sparisce e A viene avvisato.
  await b.bringToFront();
  await videoFrame(b).click('#close');
  await b.waitForFunction(() => !document.querySelector('iframe[title="Videochiamata"]'));
  await videoFrame(a).waitForFunction(() => document.getElementById('status').textContent.includes('ha chiuso'));
  console.log('ok B chiude e A viene avvisato');

  console.log('OK: videochiamata verificata');
} finally {
  await ctx.close();
  server.close();
}
