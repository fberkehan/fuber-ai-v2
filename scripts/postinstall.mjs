// npm install sonrası: Electron 45 ikilisini kurulumda değil ilk çalıştırmada indirir; burada
// yerel önbellekten (%LOCALAPPDATA%\electron\Cache) açılır ki ilk derleme/sınama beklemesin.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateIndexes } from './gen-index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const installer = path.join(root, 'node_modules', 'electron', 'install.js');

if (fs.existsSync(installer)) {
  const result = spawnSync(process.execPath, [installer], { stdio: 'inherit' });
  if (result.status !== 0) {
    console.warn('Electron ikilisi açılamadı; `node node_modules/electron/install.js` ile yeniden deneyin.');
  }
}
generateIndexes();
