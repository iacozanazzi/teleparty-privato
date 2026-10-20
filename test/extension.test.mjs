// Carica l'estensione vera in Chromium e la prova su una pagina che imita Netflix.
// Uso: node test/extension.test.mjs
import { chromium } from 'playwright';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ext = join(root, 'extension');
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'wp-')), {
  headless: true,
  channel: 'chromium', // la headless shell predefinita non carica estensioni
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
await ctx.route('https://www.netflix.com/**', (r) =>
  r.fulfill({ contentType: 'text/html', body: readFileSync(join(root, 'test/mock-netflix.html')) }));

const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => m.text().startsWith('[watch-party]') && logs.push(m.text()));
await page.goto('https://www.netflix.com/watch/81234567');
await page.waitForFunction(() => window.__watchParty);

assert.deepEqual(await page.evaluate(() => __watchParty.state()),
  { ready: true, playing: false, positionMs: 0, titleId: '81234567' });

await page.evaluate(() => __watchParty.play());
await page.evaluate(() => __watchParty.seek(60000));
assert.deepEqual(await page.evaluate(() => __watchParty.state()),
  { ready: true, playing: true, positionMs: 60000, titleId: '81234567' });

// Comando via postMessage, come farà il content script nella fase 2.
const ack = await page.evaluate(() => new Promise((res) => {
  addEventListener('message', (e) => e.data?.type === 'ack' && e.data.requestId === 7 && res(e.data));
  postMessage({ source: 'wp-content', cmd: 'pause', requestId: 7 }, location.origin);
}));
assert.equal(ack.ok, true);
assert.equal(ack.playing, false);

// Un'azione dell'utente fuori dalla finestra di eco non deve essere marcata come eco.
await page.waitForTimeout(800);
await page.evaluate(() => userPause());
await page.waitForTimeout(100);

console.log(logs.join('\n'));
assert.ok(logs.some((l) => l.includes('play a 0.0s') && l.includes('(eco)')), 'play remoto marcato come eco');
assert.ok(logs.some((l) => l.includes('seeked a 60.0s') && l.includes('(eco)')), 'seek remoto marcato come eco');
assert.ok(logs.at(-1).includes('pause') && !logs.at(-1).includes('(eco)'), 'pausa utente non marcata come eco');

await ctx.close();
console.log('OK: tutti i controlli passati');
