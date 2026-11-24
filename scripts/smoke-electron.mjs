// Varsayım doğrulama: Electron 45 içinde node:sqlite + FTS5, koffi, sherpa-onnx-node
// ve utilityProcess + MessagePort gerçekten çalışıyor mu?
// Kullanım: node scripts/smoke-electron.mjs   (çıkış kodu 0 = hepsi geçti)
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronPath = require('electron');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber2-smoke-'));
const outFile = path.join(tmp, 'result.json');

const env = { ...process.env, FUBER2_SMOKE_OUT: outFile, FUBER2_SMOKE_DATA: path.join(tmp, 'data') };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, [path.join(root, 'scripts', 'smoke', 'main.mjs')], {
  cwd: root,
  env,
  stdio: ['ignore', 'inherit', 'inherit'],
});

const timeout = setTimeout(() => {
  console.error('Zaman aşımı: Electron 90 saniyede bitmedi.');
  child.kill();
}, 90_000);

child.on('exit', (code) => {
  clearTimeout(timeout);
  let results = null;
  try {
    results = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  } catch {
    console.error('Sonuç dosyası okunamadı; Electron sonuç yazmadan çıktı.');
  }
  if (results) {
    for (const [name, result] of Object.entries(results)) {
      console.log(`\n${result.ok ? 'GEÇTİ ' : 'KALDI '} ${name}`);
      console.log(typeof result.detail === 'string' ? result.detail : JSON.stringify(result.detail, null, 2));
    }
    const failed = Object.entries(results).filter(([, r]) => !r.ok).map(([name]) => name);
    console.log(failed.length === 0 ? '\nHepsi geçti.' : `\nKalanlar: ${failed.join(', ')}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  process.exit(results && code === 0 ? 0 : 1);
});
