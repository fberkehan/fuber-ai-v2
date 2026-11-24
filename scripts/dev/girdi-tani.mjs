// fuber-girdi.exe ekran yakalama tanısı: test penceresi farklı kiplerde (tam ekran / büyütülmüş / çerçevesiz) açılır,
// yardımcıyla yakalanır, JPEG'ler kaydedilir (parlaklık Python ile ölçülür). Gerçek fare/klavye KULLANILMAZ.
// Çalıştır: node scripts/dev/girdi-tani.mjs <çıktı-klasörü>
import { _electron as electron } from 'playwright-core';
import electronYolu from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const kok = path.resolve(import.meta.dirname, '../..');
const cikti = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'girdi-tani'));
fs.mkdirSync(cikti, { recursive: true });
const exe = process.env.FUBER_GIRDI || path.join(kok, 'resources/bin/fuber-girdi.exe');
const yardimci = spawn(exe, [], { windowsHide: true });
let tampon = ''; const bekleyen = [];
yardimci.stdout.setEncoding('utf8');
yardimci.stdout.on('data', (d) => { tampon += d; let i; while ((i = tampon.indexOf('\n')) >= 0) { const s = tampon.slice(0, i).trim(); tampon = tampon.slice(i + 1); if (s) bekleyen.shift()?.(JSON.parse(s)); } });
const komut = (k) => new Promise((c) => { bekleyen.push(c); yardimci.stdin.write(`${JSON.stringify(k)}\n`); });

const veri = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-tani-veri-'));
fs.writeFileSync(path.join(veri, 'ayarlar.json'), JSON.stringify({ baslangictaAc: false, ses: { uyandirma: false } }));
const u = await electron.launch({ executablePath: electronYolu, args: [kok], env: { ...process.env, FUBER_VERI: veri }, timeout: 60000 });
await new Promise((c) => setTimeout(c, 3000));
const ekranlar = await komut({ k: 'ekranlar' });
console.log('ekranlar:', JSON.stringify(ekranlar.ekranlar ?? ekranlar));
const imlec = await komut({ k: 'imlec' });
console.log('imleç:', imlec.x, imlec.y);

for (const kip of ['tam-ekran', 'cercevesiz', 'buyutulmus']) {
  await u.evaluate(({ BrowserWindow, screen }, kip) => {
    for (const x of BrowserWindow.getAllWindows()) if (x.getTitle() === 'TANI') x.destroy();
    const b = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds;
    const t = new BrowserWindow({ x: b.x, y: b.y, width: b.width, height: b.height, title: 'TANI', backgroundColor: '#3060ff', show: false,
      fullscreen: kip === 'tam-ekran', frame: kip !== 'cercevesiz', alwaysOnTop: true });
    if (kip === 'buyutulmus') t.maximize();
    void t.loadURL(`data:text/html,<title>TANI</title><body style="margin:0;background:%233060ff;color:white;font:80px sans-serif;display:grid;place-items:center;height:100vh">${kip}</body>`);
    t.once('ready-to-show', () => { t.show(); t.focus(); });
  }, kip);
  await new Promise((c) => setTimeout(c, 2500));
  const r = await komut({ k: 'ekran', en: 960 });
  if (r.jpeg) fs.writeFileSync(path.join(cikti, `${kip}.jpg`), Buffer.from(String(r.jpeg), 'base64'));
  console.log(kip, 'yakalandı', r.gw, 'x', r.gh, 'kaynak', r.x0, r.y0, r.w, r.h, r.hata ?? '');
}
await u.close();
yardimci.kill();
fs.rmSync(veri, { recursive: true, force: true });
