// Ayarlar → Yetkiler → "Dene" düğmesi: arayüzden tıklanır, sonuç listesi okunur. Model çağrısı yok.
// Oturum kilitliyse "kilitli" sonucu beklenir; kilit açıksa ekranın ortasında küçük test penceresiyle gerçek girdi dener.
// Çalıştır: node scripts/dev/dene-dugmesi.mjs [exe] [çıktı.png]
import { KURULUM_SURUMU } from '../../src/shared/kurulum-adimlari.ts';
import { _electron as electron } from 'playwright-core';
import electronYolu from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const [exe, cikti] = process.argv.slice(2);
const kok = path.resolve(import.meta.dirname, '../..');
const veri = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-dene-veri-'));
fs.writeFileSync(path.join(veri, 'ayarlar.json'), JSON.stringify({ kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, tanitimSurumu: '0.9.0', kullaniciAdi: 'Deniz Test', baslangictaAc: false, ses: { uyandirma: false }, yetki: { bilgisayar: true, tarayici: false, dosyaOkuma: false } }));
const u = await electron.launch({ executablePath: exe || electronYolu, args: exe ? [] : [kok], env: { ...process.env, FUBER_VERI: veri, FUBER_DEMO: '1' }, timeout: 60000 });
let w;
for (let i = 0; i < 80 && !w; i++) { w = u.windows().find((x) => x.url().includes('index.html')); if (!w) await new Promise((c) => setTimeout(c, 250)); }
await w.waitForSelector('.kokpit', { timeout: 30000 });
await w.evaluate(() => { location.hash = 'bilgisayar'; }); // Ayarlar → Yetkiler → Erişim (çapa: ayar kimliği)
await w.locator('.ray__dgm:has-text("Ayarlar")').click();
await w.locator('[data-ayar="bilgisayar"] button:has-text("Dene")').click();
await w.waitForSelector('text=/Fuber bu bilgisayarda|kilitliyken|başarısız/', { timeout: 60000 });
const sonuc = await w.locator('.ayar:has-text("Fare, klavye") + div').innerText();
console.log(sonuc.replace(/\n/g, ' | '));
if (cikti) { await w.locator('.ayar:has-text("Fare, klavye")').scrollIntoViewIfNeeded(); await w.screenshot({ path: cikti }); }
await u.close();
fs.rmSync(veri, { recursive: true, force: true });
