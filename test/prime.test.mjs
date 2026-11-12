// Prime Video: il trailer della pagina del titolo va ignorato, la stanza si crea senza ricaricare,
// chi entra si allinea quando preme "Guarda ora", la pubblicità di uno non ferma gli altri.
// Uso: node test/prime.test.mjs
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
const TITLE_URL = 'https://www.primevideo.com/detail/0TESTASIN123/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = startServer(8787);
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'wp-')), {
  headless: true,
  channel: 'chromium', // la headless shell predefinita non carica estensioni
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
await ctx.route('https://www.primevideo.com/**', (r) =>
  r.fulfill({ contentType: 'text/html', body: readFileSync(join(root, 'test/mock-prime.html')) }));
const worker = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
const extId = new URL(worker.url()).host;

let nextLabel = 1;
async function openTitle(url) {
  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForFunction(() => window.__watchParty);
  page.label = `scheda-${nextLabel++}`;
  await page.evaluate((l) => (document.title = l), page.label);
  return page;
}

async function openPopup(page) {
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await page.evaluate((l) => (document.title = l), page.label);
  const tabId = await popup.evaluate(async (l) => (await chrome.tabs.query({ title: l }))[0]?.id, page.label);
  await popup.goto(`chrome-extension://${extId}/popup.html?tab=${tabId}`);
  await popup.waitForFunction(() => document.getElementById('message').textContent !== 'Un momento…');
  return popup;
}

const state = (page) => page.evaluate(() => __watchParty.state());

const watchNow = (page) => page.click('#play-button');

try {
  const host = await openTitle(TITLE_URL);
  assert.equal((await state(host)).ready, false, 'il trailer della pagina non conta come film');
  await watchNow(host);
  const s0 = await state(host);
  assert.equal(s0.ready, true, 'trova il film in #dv-web-player');
  assert.equal(s0.titleId, '0TESTASIN123');
  assert.ok(s0.positionMs >= 300000, 'è il film, non il trailer');
  console.log('ok il trailer della pagina viene ignorato e il film trovato');

  // L'utente sta già guardando: creare la stanza non deve ricaricare la pagina né fermare il film.
  await host.evaluate(() => (window.__marker = 'non ricaricata'));
  let popup = await openPopup(host);
  assert.equal(await popup.textContent('#message'), 'Crea una stanza e manda il link a chi vuoi.');
  await popup.click('#create');
  const link = await popup.inputValue('#link');
  assert.match(link, /^https:\/\/www\.primevideo\.com\/detail\/0TESTASIN123\/\?wpRoom=[A-Za-z0-9_-]{22}$/);
  await popup.close();
  await host.waitForFunction((l) => location.href === l, link);
  assert.equal(await host.evaluate(() => window.__marker), 'non ricaricata');
  assert.equal((await state(host)).playing, true, 'il film continua');
  console.log('ok la stanza si crea senza ricaricare la pagina');

  // L'amico apre il link: sulla pagina del titolo gira il trailer, che non deve toccare la stanza.
  const friend = await openTitle(link);
  await sleep(5000);
  popup = await openPopup(friend);
  assert.equal(await popup.textContent('#message'), 'Sei in una stanza con 2 persone.');
  await popup.close();
  const hostBefore = await state(host);
  assert.equal(hostBefore.playing, true, 'il trailer dell\'amico non ferma chi ospita');
  assert.ok(hostBefore.positionMs > 300000, 'il trailer dell\'amico non sposta chi ospita');

  // L'amico preme "Guarda ora": il suo film riparte da un altro punto e si allinea a chi ospita.
  await friend.evaluate(() => (window.RESUME_S = 20));
  await watchNow(friend);
  await sleep(4000);
  let [h, f] = await Promise.all([state(host), state(friend)]);
  assert.equal(f.playing, true);
  assert.ok(h.positionMs > 300000, `chi ospita non è stato riportato indietro (${h.positionMs})`);
  assert.ok(Math.abs(h.positionMs - f.positionMs) <= 1000, `scarto ${h.positionMs - f.positionMs}ms`);
  console.log('ok l\'amico preme Guarda ora e si allinea');

  // Pubblicità solo per l'amico: chi ospita continua, e dopo la pubblicità l'amico lo raggiunge.
  await friend.evaluate(() => showAd());
  await sleep(4000);
  [h, f] = await Promise.all([state(host), state(friend)]);
  assert.equal(h.playing, true, 'la pubblicità dell\'amico non mette in pausa chi ospita');
  assert.equal(f.ad, true, 'la pubblicità viene riconosciuta');
  await friend.evaluate(() => hideAd());
  await sleep(4500);
  [h, f] = await Promise.all([state(host), state(friend)]);
  assert.equal(f.playing, true);
  assert.ok(Math.abs(h.positionMs - f.positionMs) <= 1000, `dopo la pubblicità scarto ${h.positionMs - f.positionMs}ms`);
  console.log('ok la pubblicità di uno non ferma l\'altro e dopo si riallinea');

  await friend.evaluate(() => userSeek(1200000));
  await sleep(1500);
  [h, f] = await Promise.all([state(host), state(friend)]);
  assert.ok(h.positionMs >= 1200000 && Math.abs(h.positionMs - f.positionMs) <= 1000, `seek: ${h.positionMs} / ${f.positionMs}`);
  await host.evaluate(() => userPause());
  await sleep(1500);
  [h, f] = await Promise.all([state(host), state(friend)]);
  assert.equal(f.playing, false, 'la pausa arriva all\'amico');
  console.log('ok seek e pausa passano da una scheda all\'altra');

  popup = await openPopup(friend);
  await popup.click('#leave');
  await friend.waitForFunction((u) => location.href === u, TITLE_URL);
  console.log('ok uscire toglie la stanza dall\'indirizzo senza ricaricare');

  console.log('OK: Prime Video verificato');
} finally {
  await ctx.close();
  server.close();
}
