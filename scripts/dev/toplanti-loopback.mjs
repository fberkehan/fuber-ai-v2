// ═══ Toplantı modu: GERÇEK bilgisayar sesi (Windows loopback) yolu denemesi (12 Kas 2026; 0.17.2 onarımı) ═══
// toplanti-onizle.mjs bilgisayarın sesi yerine Chromium'un sahte aygıtını kullanır; bu betik ise GERÇEK yolu sürer: uygulamanın kendi setDisplayMediaRequestHandler'ı
// (audio:'loopback') ve getDisplayMedia. Yazıya çevirme/yapay zekâ yine sahtedir (ağ yok). Mikrofon Chromium'un sahte aygıtıdır (gerçek mikrofon açılmaz).
// HİÇBİR ses çalınmaz; pencereler ekran dışı. Sorular: (1) getDisplayMedia ses izi veriyor mu, (2) görüntü izi durdurulunca ses izi "ended" oluyor mu,
// (3) Başlat → "Kayıtta" ve uyarı yok mu. Çalıştır: npm run build && node scripts/dev/toplanti-loopback.mjs
import { KURULUM_SURUMU } from '../../src/shared/kurulum-adimlari.ts';
import { TANITIM_SURUMU } from '../../src/shared/tanitim.ts';
import { _electron as electron } from 'playwright-core';
import electronYolu from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (process.env.FUBER_GORUNUR) { console.error('DUR: FUBER_GORUNUR ayarlı.'); process.exit(1); }
const kok = path.resolve(import.meta.dirname, '../..');
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-loopback-'));
const veri = path.join(tmp, 'veri');
fs.mkdirSync(path.join(veri, 'belgeler'), { recursive: true });
fs.writeFileSync(path.join(veri, 'ayarlar.json'), JSON.stringify({ kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, tanitimSurumu: TANITIM_SURUMU, kullaniciAdi: 'Deniz', hitap: 'Deniz', baslangictaAc: false, dil: 'tr', ses: { uyandirma: false, seslendirme: false }, proaktif: { etkin: false }, gorunum: { tema: 'koyu', adaSessiz: false } }));
const ortam = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('FUBER_SIR_') && k !== 'FUBER_GORUNUR'));
Object.assign(ortam, { FUBER_DEMO: '1', FUBER_VERI: veri, FUBER_BELGELER: path.join(veri, 'belgeler'), FUBER_TEST_TAM_EKRAN: '0', FUBER_TEST_ANA_ONDE: '0', FUBER_TOPLANTI_DENEME: '1' });
let u; let cikis = 0;
try {
  u = await electron.launch({ executablePath: electronYolu, args: [kok, '--use-fake-device-for-media-stream'], env: ortam, timeout: 60000 });
  let ana = null;
  for (let i = 0; i < 160 && !ana; i++) { ana = u.windows().find((x) => x.url().includes('index.html')) ?? null; if (!ana) await bekle(250); }
  await ana.waitForSelector('.kokpit', { timeout: 30000 });
  await ana.click('.ray__dgm[data-tur="toplanti"]');
  await ana.waitForSelector('.toplanti');
  // 1) Ham getDisplayMedia (uygulamanın işleyicisi ana süreçte 'toplanti:baslat' penceresini ister: önce başlat).
  await ana.evaluate(() => window.fuber.cagir('toplanti:baslat', { hedefDil: 'tr', robot: false }));
  const ham = await ana.evaluate(async () => {
    const o = {};
    try {
      const a = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: { width: 1, height: 1, frameRate: 1 } });
      o.izler = { video: a.getVideoTracks().length, ses: a.getAudioTracks().length };
      const at = a.getAudioTracks()[0];
      o.olaylar = [];
      at?.addEventListener('ended', () => o.olaylar.push('ended'));
      for (const t of a.getVideoTracks()) { t.stop(); a.removeTrack(t); }
      await new Promise((r) => setTimeout(r, 2500));
      o.sesDurumu = at?.readyState;
      for (const t of a.getTracks()) t.stop();
    } catch (e) { o.hata = String(e?.message ?? e); }
    return o;
  });
  console.log('HAM', JSON.stringify(ham));
  if (ham.hata || ham.izler?.ses !== 1 || ham.sesDurumu !== 'live') { console.log('BAŞARISIZ: ham yakalama'); cikis = 1; }
  await ana.evaluate(() => window.fuber.cagir('toplanti:durdur'));
  await bekle(500);
  // 2) Arayüzden gerçek Başlat.
  await ana.click('[data-toplanti-eylem="baslat"]');
  await ana.waitForSelector('.tp-kayit[data-kayit]', { timeout: 15000 });
  await bekle(3000);
  const ui = await ana.evaluate(() => ({ uyari: document.querySelector('.tp-uyari')?.textContent ?? null, kaynaklar: document.querySelector('.tp-kaynak')?.textContent ?? null, kayit: document.querySelector('.tp-kayit__metin')?.textContent ?? null }));
  console.log('ARAYÜZ', JSON.stringify(ui));
  if (ui.uyari) { console.log('BAŞARISIZ: uyarı var'); cikis = 1; }
  await ana.click('[data-toplanti-eylem="durdur"]');
  await bekle(1500);
} catch (e) { console.log('HATA', e?.stack ?? e); cikis = 1; }
finally {
  try { await u?.evaluate(({ app }) => app.quit()); } catch { /* */ }
  await bekle(1200);
  try { await u?.close(); } catch { /* */ }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
}
process.exit(cikis);
