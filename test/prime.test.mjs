// Prime Video: stanza creata dal popup senza ricaricare la pagina, sync tra due schede,
// con il <video> dentro uno shadow root e un trailer da ignorare. Uso: node test/prime.test.mjs
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

try {
  const host = await openTitle(TITLE_URL);
  const s0 = await state(host);
  assert.equal(s0.ready, true, 'trova il video nello shadow root');
  assert.equal(s0.titleId, '0TESTASIN123');

  // L'utente sta già guardando: creare la stanza non deve ricaricare la pagina né fermare il film.
  await host.evaluate(() => { userPlay(); window.__marker = 'non ricaricata'; });
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

  const friend = await openTitle(link);
  await sleep(1000);
  popup = await openPopup(friend);
  assert.equal(await popup.textContent('#message'), 'Sei in una stanza con 2 persone.');
  await popup.close();

  // L'amico preme play sulla pagina del titolo: si allinea a chi ospita invece di partire da zero.
  await friend.evaluate(() => userPlay());
  await sleep(4000);
  let [h, f] = await Promise.all([state(host), state(friend)]);
  assert.equal(f.playing, true);
  assert.ok(Math.abs(h.positionMs - f.positionMs) <= 1000, `scarto ${h.positionMs - f.positionMs}ms`);
  console.log('ok l\'amico entra e si allinea');

  await sleep(3500);
  await friend.evaluate(() => userSeek(600000));
  await sleep(1500);
  [h, f] = await Promise.all([state(host), state(friend)]);
  assert.ok(h.positionMs >= 600000 && Math.abs(h.positionMs - f.positionMs) <= 1000, `seek: ${h.positionMs} / ${f.positionMs}`);
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
