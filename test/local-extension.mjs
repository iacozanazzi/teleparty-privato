// Copia l'estensione in una cartella temporanea puntata sul server locale dei test,
// così i test non dipendono dal server su Render.
import { cpSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function localExtension(source, port = 8787) {
  const dir = mkdtempSync(join(tmpdir(), 'wp-ext-'));
  cpSync(source, dir, { recursive: true });
  writeFileSync(join(dir, 'config.js'), `export const SERVER_URL = 'ws://localhost:${port}';\n`);
  return dir;
}
