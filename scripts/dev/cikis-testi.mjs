// A10 (son düzeltme, Ruling E): "--cikis" ikinci örnek işareti. Kurulum programı yükseltmede önce bununla ister: çalışan örnek nazikçe çıkar
// (normal çıkış akışı: before-quit → "Geri al" penceresindeki bekleyen silmeler UYGULANIR); sonlandırma son çare.
// Denetimler (başarısızsa çıkış 1):
//   1. Çalışan örnek varken `electron . --cikis`: ikinci örnek hemen çıkar, ilk örnek kendiliğinden kapanır; "Geri al" süresi
//      DURAKLATILMIŞ (hiç dolmayacak) bir hafıza silmesi kapanışta uygulanmış olur (kayıt silindi = 1).
//   2. Çalışan örnek yokken `--cikis`: hiçbir şey açmadan çıkar (pencere yok, veritabanı dosyası oluşmaz).
// Ağ YOK, anahtar YOK: geçici FUBER_VERI, FUBER_DEMO=1, FUBER_SIR_* ortamdan silinir, FUBER_TEST_TAM_EKRAN='0'. Gerçek fare/klavye yok.
// Çalıştır: npm run build && node scripts/dev/cikis-testi.mjs
import { KURULUM_SURUMU } from '../../src/shared/kurulum-adimlari.ts';
import { _electron as electron } from 'playwright-core';
import electronYolu from 'electron';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const kok = path.resolve(import.meta.dirname, '../..');
if (!fs.existsSync(path.join(kok, 'dist', 'main', 'main.js'))) { console.error('dist yok: önce npm run build'); process.exit(1); }
const sonuclar = [];
const kontrol = (ad, tamam, ayrinti = '') => { sonuclar.push(tamam); console.log(`${tamam ? '✅' : '❌'} ${ad}${ayrinti ? ` — ${String(ayrinti).slice(0, 300)}` : ''}`); };
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

const ortamKur = (veri) => {
  const o = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('FUBER_SIR_')));
  return Object.assign(o, { FUBER_DEMO: '1', FUBER_VERI: veri, FUBER_BELGELER: path.join(veri, 'belgeler'), FUBER_TEST_TAM_EKRAN: '0', FUBER_TEST_ANA_ONDE: '0' });
};
/** `electron . --cikis` ayrı süreç olarak: çıkış kodu ve süresi. */
const cikisCalistir = (ortam, ms = 20000) => new Promise((coz) => {
  const t0 = Date.now();
  const p = spawn(electronYolu, [kok, '--cikis'], { env: ortam, stdio: 'ignore' });
  const z = setTimeout(() => { try { p.kill(); } catch { /* yok */ } coz({ kod: 'zaman aşımı', ms: Date.now() - t0 }); }, ms);
  p.on('exit', (kod) => { clearTimeout(z); coz({ kod, ms: Date.now() - t0 }); });
});

let u;
try {
  // ── 1) Çalışan örnek + bekleyen (duraklatılmış) silme → --cikis ──
  const veri = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-cikis-'));
  fs.mkdirSync(path.join(veri, 'belgeler'), { recursive: true });
  fs.writeFileSync(path.join(veri, 'ayarlar.json'), JSON.stringify({
    kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, tanitimSurumu: '0.9.0', kullaniciAdi: 'Deniz', hitap: 'Deniz', baslangictaAc: false,
    ses: { uyandirma: false, seslendirme: false }, proaktif: { etkin: false }, gorunum: { tema: 'koyu', adaSessiz: false },
  }));
  const ortam = ortamKur(veri);
  u = await electron.launch({ executablePath: electronYolu, args: [kok], env: ortam, timeout: 60000 });
  let w;
  for (let i = 0; i < 120 && !w; i++) { w = u.windows().find((x) => x.url().includes('index.html')); if (!w) await bekle(250); }
  await w.waitForSelector('.kokpit', { timeout: 30000 });
  const cagir = (k, ...a) => w.evaluate(([kk, aa]) => window.fuber.cagir(kk, ...aa), [k, a]);
  const kayit = await cagir('hafiza:kaydet', { tur: 'bilgi', baslik: 'Çıkış testi kaydı', icerik: 'Kurulum programı --cikis ile kapatınca bu kayıt silinmiş olmalı.' });
  await cagir('silme:ertele', { tur: 'hafiza', id: kayit.id }, 'Çıkış testi kaydı unutuldu');
  await cagir('silme:duraklat', true); // imleç tostun üstünde gibi: süre işlemez — silme ancak çıkışta uygulanır
  await bekle(800);
  const durum = await cagir('silme:durum');
  kontrol('Önkoşul: silme kuyrukta bekliyor ve süresi duraklatılmış', durum.bekleyen.length === 1 && durum.durakli, JSON.stringify(durum).slice(0, 200));
  const anaSurec = u.process();
  const kapandi = new Promise((coz) => anaSurec.once('exit', (kod) => coz(kod)));
  const ikinci = await cikisCalistir(ortam);
  kontrol('İkinci örnek (--cikis) hemen çıkar (pencere açmaz)', ikinci.kod === 0 && ikinci.ms < 15000, JSON.stringify(ikinci));
  const ilkKod = await Promise.race([kapandi, bekle(15000).then(() => 'kapanmadı')]);
  kontrol('Çalışan örnek --cikis isteğiyle kendiliğinden kapanır (sonlandırma yok)', ilkKod !== 'kapanmadı', `çıkış kodu ${ilkKod}`);
  u = null;
  const vt = new DatabaseSync(path.join(veri, 'fuber.db'));
  const satir = vt.prepare('SELECT silindi FROM hafizalar WHERE id = ?').get(kayit.id);
  vt.close();
  kontrol('Bekleyen silme kapanışta UYGULANDI (before-quit akışı): kayıt silindi', satir?.silindi === 1, JSON.stringify(satir));

  // ── 2) Çalışan örnek yokken --cikis: hiçbir şey açmadan çıkar ──
  const bos = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-cikis-bos-'));
  const tek = await cikisCalistir(ortamKur(bos));
  kontrol('Çalışan örnek yokken --cikis: hemen çıkar, veritabanı/klasör kurulmaz', tek.kod === 0 && !fs.existsSync(path.join(bos, 'fuber.db')) && !fs.existsSync(path.join(bos, 'gunluk')), `${JSON.stringify(tek)} · ${fs.readdirSync(bos).join(', ')}`);
} catch (e) {
  kontrol('HATA', false, e.stack);
} finally {
  if (u) await u.close().catch(() => undefined);
}
const basarisiz = sonuclar.filter((x) => !x).length;
console.log(`\n${basarisiz ? `❌ ${basarisiz} denetim başarısız` : `✅ hepsi geçti (${sonuclar.length})`}`);
process.exit(basarisiz ? 1 : 0);
