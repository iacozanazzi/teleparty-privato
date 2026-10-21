// Fase 3: dal popup si crea una stanza, un amico entra col link, si esce dalla stanza.
// Uso: node test/invite.test.mjs
import { chromium } from 'playwright';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { startServer } from '../server/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ext = join(root, 'extension');
const TITLE_URL = 'https://www.netflix.com/watch/81234567';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = startServer(8787);
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'wp-')), {
  headless: true,
  channel: 'chromium', // la headless shell predefinita non carica estensioni
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
await ctx.route('https://www.netflix.com/**', (r) =>
  r.fulfill({ contentType: 'text/html', body: readFileSync(join(root, 'test/mock-netflix.html')) }));

const worker = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
const extId = new URL(worker.url()).host;

let nextLabel = 1;
async function openTitle(url) {
  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForFunction(() => window.__watchParty);
  // Chi ospita e l'amico hanno lo stesso indirizzo: il titolo della scheda li distingue.
  page.label = `scheda-${nextLabel++}`;
  await page.evaluate((l) => (document.title = l), page.label);
  return page;
}

// Apre il popup come pagina, puntato sulla scheda Netflix con quell'indirizzo.
async function openPopup(netflixPage) {
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await netflixPage.evaluate((l) => (document.title = l), netflixPage.label);
  const tabId = await popup.evaluate(async (l) => (await chrome.tabs.query({ title: l }))[0]?.id, netflixPage.label);
  await popup.goto(`chrome-extension://${extId}/popup.html?tab=${tabId}`);
  await popup.waitForFunction(() => document.getElementById('message').textContent !== 'Un momento…');
  return popup;
}

try {
  const host = await openTitle(TITLE_URL);
  let popup = await openPopup(host);
  assert.equal(await popup.textContent('#message'), 'Crea una stanza e manda il link a chi vuoi.');

  await popup.click('#create');
  const link = await popup.inputValue('#link');
  assert.match(link, /^https:\/\/www\.netflix\.com\/watch\/81234567\?wpRoom=[A-Za-z0-9_-]{22}$/);
  await host.waitForURL(link);
  await host.waitForFunction(() => window.__watchParty);
  await popup.close();
  console.log('ok il popup crea la stanza e il link');

  const friend = await openTitle(link);
  await sleep(1000);
  popup = await openPopup(friend);
  assert.equal(await popup.textContent('#message'), 'Sei in una stanza con 2 persone.');
  assert.equal(await popup.inputValue('#link'), link);
  await popup.close();
  console.log('ok l\'amico entra col link e il popup conta 2 persone');

  await sleep(3500);
  await host.evaluate(() => userPlay());
  await sleep(1500);
  const [h, f] = await Promise.all([host, friend].map((p) => p.evaluate(() => __watchParty.state())));
  assert.equal(f.playing, true, 'l\'amico parte quando parte chi ospita');
  assert.ok(Math.abs(h.positionMs - f.positionMs) <= 1000, `scarto ${Math.abs(h.positionMs - f.positionMs)}ms`);
  console.log('ok la stanza creata dal popup è sincronizzata');

  popup = await openPopup(friend);
  await Promise.all([friend.waitForURL(TITLE_URL), popup.click('#leave')]);
  await sleep(1000);
  popup = await openPopup(host);
  assert.equal(await popup.textContent('#message'), 'Sei in una stanza con 1 persona.');
  console.log('ok l\'amico esce e chi resta vede 1 persona');

  console.log('OK: invito verificato');
} finally {
  await ctx.close();
  server.close();
}
