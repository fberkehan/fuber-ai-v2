// Fuber imleci katmanının görsel denetimi: derlenmiş dist/renderer/imlec.html yerel sunucudan başsız Edge'de açılır,
// window.fuber taklit edilip 'imlec:komut' olayları gönderilir, kareler kaydedilir. Gerçek masaüstüne dokunmaz.
// Çalıştır: node scripts/dev/imlec-onizle.mjs <çıktı-klasörü> [arka-plan.png]
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const kok = path.resolve(import.meta.dirname, '../..');
const dist = path.join(kok, 'dist/renderer');
const cikti = path.resolve(process.argv[2] || 'imlec-onizleme');
const arka = process.argv[3] ? fs.readFileSync(process.argv[3]).toString('base64') : null;
fs.mkdirSync(cikti, { recursive: true });
const tur = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
const sunucu = http.createServer((q, r) => {
  let y = decodeURIComponent(new URL(q.url, 'http://x').pathname);
  const dosya = y.startsWith('/kaynak/') ? path.join(kok, 'resources', y.slice(8)) : path.join(dist, y);
  if (!fs.existsSync(dosya)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': tur[path.extname(dosya)] ?? 'application/octet-stream' });
  r.end(fs.readFileSync(dosya));
});
await new Promise((c) => sunucu.listen(0, '127.0.0.1', c));
const taban = `http://127.0.0.1:${sunucu.address().port}`;
const t = await chromium.launch({ channel: 'msedge', headless: true });
const p = await t.newPage({ viewport: { width: 1280, height: 720 } });
await p.addInitScript(() => {
  const dinleyiciler = [];
  window.fuber = { cagir: async () => null, dinle: (k, f) => { dinleyiciler.push(f); return () => undefined; }, platform: 'win32' };
  window.__gonder = (v) => dinleyiciler.forEach((f) => f(v));
});
const html = fs.readFileSync(path.join(dist, 'imlec.html'), 'utf8').replace(/fuber:\/\/app\/kaynak\//g, `${taban}/kaynak/`).replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '');
fs.writeFileSync(path.join(dist, '_imlec_onizleme.html'), html);
await p.goto(`${taban}/_imlec_onizleme.html`);
if (arka) await p.evaluate((b) => { document.body.style.background = `url(data:image/png;base64,${b}) center/cover`; }, arka);
else await p.evaluate(() => { document.body.style.background = 'linear-gradient(135deg,#1d2433,#2d3a52)'; });
const gonder = (v) => p.evaluate((x) => window.__gonder(x), v);
await gonder({ tur: 'kontrol', acik: true });
await p.waitForTimeout(500);
await gonder({ tur: 'git', x: 380, y: 260, bx: 120, by: 560, sure: 600, eylem: 'tikla' });
await p.waitForTimeout(300);
await p.screenshot({ path: path.join(cikti, '1-yolda.png') });
await p.waitForTimeout(420);
await p.screenshot({ path: path.join(cikti, '2-tiklama.png') });
await gonder({ tur: 'rozet', x: 380, y: 260, metin: 'yazıyor… “merhaba fuber”', ms: 3000 });
await p.waitForTimeout(400);
await p.screenshot({ path: path.join(cikti, '3-yaziyor.png') });
fs.rmSync(path.join(dist, '_imlec_onizleme.html'));
await t.close(); sunucu.close();
console.log('kaydedildi:', cikti);
