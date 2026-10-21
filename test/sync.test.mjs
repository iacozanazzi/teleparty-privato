// Fase 2: tre schede nella stessa stanza devono restare allineate.
// Uso: node test/sync.test.mjs
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
const ROOM_URL = 'https://www.netflix.com/watch/81234567?wpRoom=stanza-di-prova-0123';
const TOLERANCE_MS = 1000;

const server = startServer(8787);
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'wp-')), {
  headless: true,
  channel: 'chromium', // la headless shell predefinita non carica estensioni
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
await ctx.route('https://www.netflix.com/**', (r) =>
  r.fulfill({ contentType: 'text/html', body: readFileSync(join(root, 'test/mock-netflix.html')) }));

async function openTab() {
  const page = await ctx.newPage();
  await page.goto(ROOM_URL);
  await page.waitForFunction(() => window.__watchParty);
  return page;
}
const state = (page) => page.evaluate(() => __watchParty.state());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function expectAligned(pages, playing, label) {
  // Lascia il tempo a messaggi e correzioni di arrivare.
  await sleep(1500);
  const states = await Promise.all(pages.map(state));
  const positions = states.map((s) => s.positionMs);
  for (const s of states) assert.equal(s.playing, playing, `${label}: stato play/pausa diverso (${JSON.stringify(states)})`);
  const spread = Math.max(...positions) - Math.min(...positions);
  assert.ok(spread <= TOLERANCE_MS, `${label}: scarto ${spread}ms tra le schede (${positions.join(', ')})`);
  console.log(`ok ${label}: scarto ${spread}ms`);
  return positions;
}

try {
  const a = await openTab();
  const b = await openTab();
  // Supera la finestra iniziale in cui ci si allinea senza imporre la propria posizione.
  await sleep(3500);

  await a.evaluate(() => userPlay());
  await expectAligned([a, b], true, 'A preme play, B parte');

  await a.evaluate(() => userSeek(120000));
  const [posA] = await expectAligned([a, b], true, 'A salta a 2:00, B segue');
  assert.ok(posA >= 120000, 'il seek è stato applicato');

  await b.evaluate(() => userPause());
  await expectAligned([a, b], false, 'B mette in pausa, A si ferma');

  await b.evaluate(() => userPlay());
  await expectAligned([a, b], true, 'B riparte, A riparte');

  // Chi entra dopo si allinea alla stanza invece di riportare tutti all'inizio.
  const c = await openTab();
  await c.evaluate(() => userPlay()); // l'autoplay di Netflix all'apertura
  await sleep(3500);
  const positions = await expectAligned([a, b, c], true, 'C entra dopo e si allinea');
  assert.ok(Math.min(...positions) > 120000, 'nessuno è stato riportato indietro');

  // La connessione cade (rete, riavvio di Render): le schede si ricollegano da sole.
  for (const client of server.wss.clients) client.terminate();
  await sleep(2500);
  await a.evaluate(() => userPause());
  await expectAligned([a, b, c], false, 'dopo una caduta della connessione la sync riprende');

  console.log('OK: sincronizzazione verificata');
} finally {
  await ctx.close();
  server.close();
}
