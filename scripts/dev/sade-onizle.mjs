// Sade mod (0.14 T6b) görsel denetimi. Derlenmiş uygulamayı test kipinde (FUBER_DEMO; ağ yok, geçici FUBER_VERI, FUBER_SIR_* silinir) açar:
//   1. Ayarlar → Görünüm → Karakterler: "Göster" seçili (varsayılan) → görüntü; "Sade (karakter yok)"a basılır → kayıt diske 'sade' → görüntü.
//   2. #galeri/karakter Sade'de: hiçbir svg.karakter yok, yerine [data-sade-isaret] (her hâl, dört boy) → görüntü; "Mod değiştir" → Sade geçişi
//      (.mod-gecisi--sade; karakter yok) → görüntü.
//   3. Ayar yeniden 'goster' → aynı sayfa karakterleri çizer (canlı ayar değişimi) → görüntü.
//   4. Kurulum yeniden açılıp "Nasıl kullanacaksın" adımına gelinirse (hesap adımı geçilebiliyorsa) Sade'de hayvan adı yok → görüntü.
//   Konsol hatası yok. Son satır "N denetim · N hata"; hata → çıkış 1.
// Çalıştır: npm run build && node scripts/dev/sade-onizle.mjs [çıktı klasörü]   (varsayılan <depo>/.superpowers/0.14/sade)
import { KURULUM_SURUMU } from '../../src/shared/kurulum-adimlari.ts';
import { TANITIM_SURUMU } from '../../src/shared/tanitim.ts';
import { _electron as electron } from 'playwright-core';
import electronYolu from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const kok = path.resolve(import.meta.dirname, '../..');
if (!fs.existsSync(path.join(kok, 'dist', 'main', 'main.js'))) { console.error('dist yok: önce npm run build'); process.exit(1); }
const cikti = path.resolve(process.argv[2] ?? path.join(kok, '.superpowers', '0.14', 'sade'));
fs.mkdirSync(cikti, { recursive: true });
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
const sonuclar = [];
const kontrol = (ad, tamam, ayrinti = '') => { sonuclar.push(Boolean(tamam)); console.log(`${tamam ? '✓' : '✗'} ${ad}${ayrinti && !tamam ? ` — ${String(ayrinti).slice(0, 600)}` : ''}`); };

const veri = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-sade-'));
fs.mkdirSync(path.join(veri, 'belgeler'), { recursive: true });
const ayarDosyasi = path.join(veri, 'ayarlar.json');
fs.writeFileSync(ayarDosyasi, JSON.stringify({
  kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, tanitimSurumu: TANITIM_SURUMU, kullaniciAdi: 'Deniz', hitap: 'Deniz', baslangictaAc: false,
  ses: { uyandirma: false, seslendirme: false }, proaktif: { etkin: false }, gorunum: { tema: 'koyu', adaSessiz: false },
}));
const ortam = Object.assign(Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('FUBER_SIR_') && k !== 'FUBER_GORUNUR')), {
  FUBER_DEMO: '1', FUBER_VERI: veri, FUBER_BELGELER: path.join(veri, 'belgeler'), FUBER_BILGISAYAR_ADI: 'DENIZ-PC', FUBER_TEST_TAM_EKRAN: '0', FUBER_TEST_ANA_ONDE: '0',
});

let u = null;
try {
  u = await electron.launch({ executablePath: electronYolu, args: [kok], env: ortam, timeout: 60000 });
  let w = null;
  for (let i = 0; i < 120 && !w; i++) { w = u.windows().find((x) => x.url().includes('index.html')) ?? null; if (!w) await bekle(250); }
  if (!w) throw new Error('ana pencere yok');
  const hatalar = [];
  w.on('pageerror', (e) => hatalar.push(String(e)));
  w.on('console', (m) => { if (m.type() === 'error') hatalar.push(m.text()); });
  await w.waitForSelector('#kok > *', { timeout: 30000 });
  await u.evaluate(({ BrowserWindow }) => { const x = BrowserWindow.getAllWindows().find((p) => p.webContents.getURL().includes('index.html')); x?.unmaximize(); x?.setContentSize(1400, 1000); });
  await bekle(800);

  // ── 1. Ayarlar → Görünüm → Karakterler ──
  await w.locator('.ray__dgm[data-tur="ayarlar"]').click();
  await w.waitForSelector('.ayarlar__sayfa', { timeout: 10000 });
  await w.locator('.kategori[data-kategori="gorunum"]').click();
  await w.waitForSelector('.ayarlar__sayfa[data-kategori="gorunum"]', { timeout: 5000 });
  const bas = w.locator('.akordeon[data-grup="karakterler"] .akordeon__bas');
  if ((await bas.getAttribute('aria-expanded')) === 'false') await bas.click();
  await w.waitForSelector('[data-ayar="karakterler"]', { timeout: 5000 });
  await bekle(400);
  const secili = () => w.evaluate(() => document.querySelector('[data-karakter-secimi][aria-checked="true"]')?.getAttribute('data-karakter-secimi'));
  kontrol('Görünüm → Karakterler satırı var, varsayılan "Göster" seçili', (await secili()) === 'goster');
  const metinler = await w.evaluate(() => [...document.querySelectorAll('[data-karakter-secimi]')].map((b) => b.textContent?.trim()));
  kontrol('Seçenekler: "Göster" / "Sade (karakter yok)"', JSON.stringify(metinler) === JSON.stringify(['Göster', 'Sade (karakter yok)']), JSON.stringify(metinler));
  await w.locator('.ayarlar__sayfa').screenshot({ path: path.join(cikti, 'ayarlar-goster.png') });
  await w.locator('[data-karakter-secimi="sade"]').click();
  for (let i = 0; i < 20 && (await secili()) !== 'sade'; i++) await bekle(150);
  kontrol('"Sade"ye basınca seçili olur', (await secili()) === 'sade');
  await bekle(300);
  kontrol('Kayıt diske "sade" yazar', JSON.parse(fs.readFileSync(ayarDosyasi, 'utf8')).gorunum?.karakterler === 'sade');
  await w.locator('.ayarlar__sayfa').screenshot({ path: path.join(cikti, 'ayarlar-sade.png') });
  // Geliştirici modunda da aynı satır.
  await w.evaluate(() => window.fuber.cagir('ayarlar:kaydet', { mod: 'gelistirici' }));
  await bekle(600);
  kontrol('Developer mode\'da da Görünüm → Karakterler var', (await w.locator('[data-ayar="karakterler"]').count()) === 1);
  await w.evaluate(() => window.fuber.cagir('ayarlar:kaydet', { mod: 'is' }));
  await bekle(400);

  // ── 2. Galeri Sade'de ──
  await w.evaluate(() => { location.hash = '#galeri/karakter'; location.reload(); });
  await w.waitForSelector('[data-sade-galerisi]', { timeout: 30000 });
  await w.evaluate(() => document.fonts.ready);
  await bekle(600);
  const say = () => w.evaluate(() => ({ karakter: document.querySelectorAll('svg.karakter, [data-karakter]').length, isaret: document.querySelectorAll('[data-sade-isaret]').length, tilki: /tilki|bukalemun/i.test(document.body.innerText) }));
  const s1 = await say();
  kontrol('Sade: sayfada hiçbir karakter çizimi yok, nötr işaretler var', s1.karakter === 0 && s1.isaret >= 30, JSON.stringify(s1));
  kontrol('Sade: sayfa metninde hayvan adı yok', !s1.tilki);
  await w.screenshot({ path: path.join(cikti, 'galeri-sade.png'), fullPage: true });
  await w.locator('[data-sade-gecis-dugmesi]').click();
  await bekle(90);
  const g = await w.evaluate(() => ({ sade: document.querySelectorAll('.mod-gecisi--sade').length, karakter: document.querySelectorAll('svg.karakter').length }));
  kontrol('Sade mod geçişi: yalnız renk çapraz solması (karakter yok)', g.sade === 1 && g.karakter === 0, JSON.stringify(g));
  await w.locator('[data-mod-sahne]').screenshot({ path: path.join(cikti, 'gecis-sade-ortasi.png') });
  await bekle(500);
  kontrol('Sade geçişi biter (240 ms)', (await w.locator('.mod-gecisi--sade').count()) === 0);
  await w.locator('[data-mod-sahne]').screenshot({ path: path.join(cikti, 'gecis-sade-sonu.png') });

  // ── 3. Göster'e dönüş: canlı ayar değişimi ──
  await w.evaluate(() => window.fuber.cagir('ayarlar:kaydet', { gorunum: { karakterler: 'goster' } }));
  await w.waitForSelector('svg.karakter', { timeout: 10000 }).catch(() => undefined);
  const s2 = await say();
  kontrol('Göster: aynı sayfa karakterleri çizer (sayfa yenilenmeden)', s2.karakter > 0 && s2.isaret === 0, JSON.stringify(s2));
  await w.screenshot({ path: path.join(cikti, 'galeri-goster.png') });

  // ── 4. Kurulum "Nasıl kullanacaksın" Sade'de (yapılabilirse) ──
  await w.evaluate(() => window.fuber.cagir('ayarlar:kaydet', { gorunum: { karakterler: 'sade' } }));
  await w.evaluate(() => { location.hash = ''; location.reload(); });
  await w.waitForSelector('#kok > *', { timeout: 30000 });
  await bekle(800);
  await w.locator('.ray__dgm[data-tur="ayarlar"]').click();
  await w.locator('.kategori[data-kategori="gorunum"]').click();
  const tanitimBas = w.locator('.akordeon[data-grup="tanitim"] .akordeon__bas');
  if ((await tanitimBas.getAttribute('aria-expanded')) === 'false') await tanitimBas.click();
  await w.locator('[data-kurulumu-ac]').click();
  /** Kurulumda `secici` adımına gelene dek ilerler (hesap adımında sunucu yoksa "Şimdilik hesapsız devam et"). */
  const adimaGit = async (secici) => {
    for (let i = 0; i < 12; i++) {
      await bekle(700);
      if ((await w.locator(secici).count()) > 0) return true;
      const hesapsiz = w.getByRole('button', { name: 'Şimdilik hesapsız devam et' });
      if ((await hesapsiz.count()) > 0) { await hesapsiz.first().click(); continue; }
      const ileri = w.locator('.k2__alt [data-ileri]').last();
      if ((await ileri.count()) === 0 || !(await ileri.isEnabled())) return false;
      await ileri.click();
    }
    return false;
  };
  const kip = await adimaGit('[data-kip-adimi]');
  if (kip) {
    await bekle(900);
    const metin = await w.evaluate(() => document.body.innerText);
    kontrol('Kurulum › Nasıl kullanacaksın (Sade): hayvan adı yok', !/tilki|bukalemun/i.test(metin), metin.slice(0, 400));
    await w.screenshot({ path: path.join(cikti, 'kurulum-kip-sade.png') });
    if (await adimaGit('[data-ses]')) {
      await bekle(900);
      const sesMetni = await w.evaluate(() => document.body.innerText);
      kontrol('Kurulum › Ses (Sade): hayvan adı yok, ad "Fuber"', !/tilki|bukalemun/i.test(sesMetni) && /Merhaba, ben Fuber/.test(sesMetni), sesMetni.slice(0, 400));
      await w.screenshot({ path: path.join(cikti, 'kurulum-ses-sade.png') });
    } else console.log('· Kurulumun Ses adımına gelinemedi — atlandı');
  } else {
    console.log('· Kurulumun "Nasıl kullanacaksın" adımına gelinemedi (hesap adımı?) — atlandı');
    await w.screenshot({ path: path.join(cikti, 'kurulum-atlandi.png') });
  }
  kontrol('Konsol hatası yok', hatalar.length === 0, hatalar.slice(0, 6).join(' | '));
} catch (e) {
  kontrol('Betik hatasız tamamlandı', false, e?.stack ?? e);
} finally {
  await u?.close().catch(() => undefined);
  fs.rmSync(veri, { recursive: true, force: true });
}
const hata = sonuclar.filter((x) => !x).length;
console.log(`${sonuclar.length} denetim · ${hata} hata · görüntüler: ${cikti}`);
process.exit(hata ? 1 : 0);
