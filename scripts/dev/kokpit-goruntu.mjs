// Var olan bir test veri klasörüyle kokpitin görüntüsü (model çağrısı yok; anahtar verilmez, kayıtlı yerleşim kullanılır).
// Çalıştır: node scripts/dev/kokpit-goruntu.mjs <veri-klasörü> <çıktı.png> [exe]
import { _electron as electron } from 'playwright-core';
import electronYolu from 'electron';
import path from 'node:path';
const [veri, cikti, exe] = process.argv.slice(2);
const kok = path.resolve(import.meta.dirname, '../..');
const u = await electron.launch({ executablePath: exe || electronYolu, args: exe ? [] : [kok], env: { ...process.env, FUBER_VERI: veri, FUBER_DEMO: '1' }, timeout: 60000 });
let w;
for (let i = 0; i < 80 && !w; i++) { w = u.windows().find((x) => x.url().includes('index.html')); if (!w) await new Promise((c) => setTimeout(c, 250)); }
await w.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
await w.waitForSelector('.kokpit', { timeout: 30000 });
await w.waitForTimeout(2500);
await w.screenshot({ path: cikti });
await u.close();
console.log('kaydedildi', cikti);
