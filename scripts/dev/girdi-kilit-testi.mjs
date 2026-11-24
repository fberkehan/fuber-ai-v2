// fuber-girdi.exe kilit davranışı: oturum kilitliyken ekran yanıtı "kilitli" bildirmeli, girdi komutları reddedilmeli.
// (Kilit açıkken çalıştırılırsa yalnız durum raporlar; girdi komutu GÖNDERMEZ.) Çalıştır: node scripts/dev/girdi-kilit-testi.mjs
import { spawn } from 'node:child_process';
import path from 'node:path';
const exe = path.resolve(import.meta.dirname, '../../resources/bin/fuber-girdi.exe');
const y = spawn(exe, [], { windowsHide: true });
let t = ''; const b = [];
y.stdout.setEncoding('utf8');
y.stdout.on('data', (d) => { t += d; let i; while ((i = t.indexOf('\n')) >= 0) { const s = t.slice(0, i).trim(); t = t.slice(i + 1); if (s) b.shift()?.(JSON.parse(s)); } });
const k = (x) => new Promise((c) => { b.push(c); y.stdin.write(`${JSON.stringify(x)}\n`); });
const kilit = await k({ k: 'kilit' });
console.log('kilit komutu:', JSON.stringify(kilit));
const ekran = await k({ k: 'ekran', ekran: 1, en: 320 });
console.log('ekran yanıtı:', JSON.stringify({ kilitli: ekran.kilitli, karanlik: ekran.karanlik, w: ekran.w, h: ekran.h }));
if (kilit.kilitli) console.log('tıklama denemesi:', JSON.stringify(await k({ k: 'tikla', x: 4800, y: 540 })));
y.kill();
