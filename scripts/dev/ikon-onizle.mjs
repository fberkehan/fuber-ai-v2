// Geliştirme koşusunda Fuber ikonu (0.10 E1, K7): `node_modules/electron/dist/electron.exe` ile açılan uygulamanın HER penceresinin görev
// çubuğu / Alt+Tab ikonu (WM_GETICON büyük) ve sistem menüsü ikonu (küçük) Fuber'in .ico'suyla piksel piksel aynı, Electron'un kendi
// ikonundan ayrı ve AÇIKÇA verilmiş (pencere sınıfının ikonuna, yani electron.exe'ninkine düşmüyor) mi? Ölçümü scripts/dev/ikon-denetle.ps1
// yapar (YALNIZ OKUR; ekran yakalamaz). Ayrıca:
//  · geliştirme koşusunun pencereleri ürünün kimliğini (ai.fuber.masaustu) DEĞİL geliştirme kimliğini taşır (kurulu Fuber AI ile ve onun
//    kimliğini taşıyan kısayollarla gruplanmaz; shared/uygulama-kimligi.ts);
//  · Windows bildirimi Fuber'in ikonunu taşır (FUBER_DEMO'da gösterilmez, kaydı okunur);
//  · Fuber imleci katmanı (bilgisayar kontrolünde ekranı kaplayan saydam pencere) önizleme kancasıyla açılır, onun ikonu da ölçülür;
//  · kimlik gaspı temizliği testte KURU kiptedir (FUBER_VERI): yalnız testin klasörü (FUBER_TEST_BASLAT_MENUSU) taranır, hiçbir kısayola
//    dokunulmaz (gerçek Başlat menüsü ve Geri Dönüşüm Kutusu hiç), taşınacaklar <FUBER_VERI>/kisayol-temizligi.json'a yazılır: kayıtta
//    yalnız ürün kimliğini taşıyıp bağımsız değişkensiz, çıplak bir electron.exe açan kısayollar olmalı; tarama sürüm başına bir kez.
// Ağ YOK, anahtar YOK: geçici FUBER_VERI, FUBER_DEMO=1, FUBER_SIR_* silinir, FUBER_TEST_TAM_EKRAN='0'; gerçek fare/klavye yok.
// Çalıştır: npm run build && node scripts/dev/ikon-onizle.mjs
import { KURULUM_SURUMU } from '../../src/shared/kurulum-adimlari.ts';
import { _electron as electron } from 'playwright-core';
import electronYolu from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { electronExe, pencereleriOlc, pencereIkonuTamam, pencereOzeti } from './ikon-denetimi.mjs';
import { URUN_KIMLIGI, GELISTIRME_KIMLIGI } from '../../src/shared/uygulama-kimligi.ts';

const kok = path.resolve(import.meta.dirname, '../..');
if (process.platform !== 'win32') { console.log('yalnız Windows'); process.exit(0); }
if (!fs.existsSync(path.join(kok, 'dist', 'main', 'main.js'))) { console.error('dist yok: önce npm run build'); process.exit(1); }
const ICO = path.join(kok, 'resources', 'ikon', 'fuber.ico');
const KARSI = electronExe(kok);
const veri = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-ikon-'));
fs.mkdirSync(path.join(veri, 'belgeler'), { recursive: true });
fs.writeFileSync(path.join(veri, 'ayarlar.json'), JSON.stringify({
  kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, tanitimSurumu: '0.9.0', kullaniciAdi: 'Deniz', hitap: 'Deniz', baslangictaAc: false,
  ses: { uyandirma: false, seslendirme: false }, proaktif: { etkin: false }, gorunum: { tema: 'koyu' },
}));
// Kimlik gaspı temizliğinin test klasörü (gerçek Başlat menüsü yerine).
const baslat = path.join(veri, 'baslat-menusu');
fs.mkdirSync(path.join(baslat, 'Alt'), { recursive: true });
const ortam = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('FUBER_SIR_')));
Object.assign(ortam, { FUBER_DEMO: '1', FUBER_VERI: veri, FUBER_BELGELER: path.join(veri, 'belgeler'), FUBER_TEST_TAM_EKRAN: '0', FUBER_TEST_BASLAT_MENUSU: baslat });

const sonuclar = [];
const kontrol = (ad, tamam, ayrinti = '') => {
  sonuclar.push({ ad, tamam: Boolean(tamam) });
  console.log(`${tamam ? '  tamam' : '  HATA '} ${ad}${ayrinti ? ` — ${String(ayrinti).slice(0, 600)}` : ''}`);
};
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
const hatalar = [];
let u;
try {
  // Test klasörüne beş kısayol (uygulamanın kendi API'siyle: shell.writeShortcutLink, kimlik dahil): iki gaspçı (ürün kimliği + başka bir
  // çıplak electron.exe; biri alt klasörde), bağımsız değişkenli electron.exe (bir uygulama klasörünü açar: gaspçı değil), Fuber'in
  // kendisi (ürün kimliği + kurulu exe gibi) ve başka bir Electron uygulaması (kendi kimliği).
  const sahteElectron = path.join(veri, 'baska-klon', 'node_modules', 'electron', 'dist', 'electron.exe');
  const kisayollar = {
    gaspci: path.join(baslat, 'Electron.lnk'),
    altGaspci: path.join(baslat, 'Alt', 'Electron (2).lnk'),
    argumanli: path.join(baslat, 'Electron (proje).lnk'),
    fuber: path.join(baslat, 'Fuber AI.lnk'),
    baska: path.join(baslat, 'Başka Uygulama.lnk'),
  };
  const surum = JSON.parse(fs.readFileSync(path.join(kok, 'package.json'), 'utf8')).version;
  const kayitYolu = path.join(veri, 'kisayol-temizligi.json');
  const kayitOku = () => (fs.existsSync(kayitYolu) ? JSON.parse(fs.readFileSync(kayitYolu, 'utf8')) : null);
  const ayarYolu = path.join(veri, 'ayarlar.json');
  const ayarOku = () => JSON.parse(fs.readFileSync(ayarYolu, 'utf8'));
  const yerinde = () => Object.fromEntries(Object.entries(kisayollar).map(([a, y]) => [a, fs.existsSync(y)]));

  const ac = async () => {
    u = await electron.launch({ executablePath: electronYolu, args: [kok], env: ortam, timeout: 60000 });
    let w;
    for (let i = 0; i < 120 && !w; i++) { w = u.windows().find((x) => x.url().includes('index.html')); if (!w) await bekle(250); }
    if (!w) throw new Error('ana pencere yok');
    w.on('pageerror', (e) => hatalar.push(String(e)));
    w.on('console', (m) => { if (m.type() === 'error') hatalar.push(m.text()); });
    return w;
  };

  // ── 1. açılış: temizlik kuru kipte boş test klasörünü taradı (kayıt boş, sürüm ayara yazıldı); kısayolları yaz ──
  let w = await ac();
  await w.waitForSelector('.kokpit', { timeout: 30000 });
  const kayit1 = kayitOku();
  kontrol(`Kuru kip (FUBER_VERI): kayıt <FUBER_VERI>/kisayol-temizligi.json yazıldı — boş test klasörü, taşınacak yok; sürüm ${surum} ayarda`,
    kayit1?.kuru === true && kayit1.klasor === baslat && Array.isArray(kayit1.tasinacak) && kayit1.tasinacak.length === 0 && ayarOku().kisayolTemizligiSurumu === surum,
    JSON.stringify({ kayit1, ayar: ayarOku().kisayolTemizligiSurumu }));
  const yazildi = await u.evaluate(({ shell }, [k, sahte, kurulu, urun, klon]) => ({
    gaspci: shell.writeShortcutLink(k.gaspci, 'create', { target: sahte, appUserModelId: urun }),
    altGaspci: shell.writeShortcutLink(k.altGaspci, 'create', { target: sahte, appUserModelId: urun }),
    argumanli: shell.writeShortcutLink(k.argumanli, 'create', { target: sahte, args: `"${klon}"`, appUserModelId: urun }),
    fuber: shell.writeShortcutLink(k.fuber, 'create', { target: kurulu, appUserModelId: urun }),
    baska: shell.writeShortcutLink(k.baska, 'create', { target: sahte, appUserModelId: 'electron.app.Baska' }),
  }), [kisayollar, sahteElectron, path.join(veri, 'Programs', 'Fuber AI', 'Fuber AI.exe'), URUN_KIMLIGI, path.join(veri, 'baska-klon')]);
  kontrol('Test Başlat menüsüne beş kısayol yazıldı (iki gaspçı, bağımsız değişkenli electron.exe, Fuber, başka uygulama)', Object.values(yazildi).every(Boolean) && Object.values(yerinde()).every(Boolean), JSON.stringify(yazildi));

  // Fuber Tarayıcı, ada ve Fuber imleci katmanı da açılsın: bütün pencereler ölçülür. (Katman gerçek fare/klavye olmadan, önizleme
  // kancasıyla açılır: saydam, tıklamayı geçirir; birkaç saniye sonra kapanır.)
  await w.evaluate(() => window.fuber.cagir('tarayici:goster'));
  await w.evaluate(() => window.fuber.cagir('asistan:goster', false, false));
  const katman = await u.evaluate(() => { if (typeof globalThis.__fuberImlecKatmani !== 'function') return false; globalThis.__fuberImlecKatmani(true); return true; });
  await bekle(2500);
  const pencereler = await pencereleriOlc(u, { ico: ICO, karsi: KARSI });
  if (katman) await u.evaluate(() => globalThis.__fuberImlecKatmani(false));
  const adlar = pencereler.map((x) => x.ad);
  kontrol('Ölçülen pencereler: ana pencere, Fuber Tarayıcı, ada ve Fuber imleci katmanı dahil', katman && ['index.html', 'tarayici.html', 'asistan.html', 'imlec.html'].every((a) => adlar.includes(a)), adlar.join(', '));
  for (const x of pencereler) {
    kontrol(`${x.ad}: görev çubuğu/Alt+Tab ve sistem menüsü ikonu Fuber'in (açıkça verilmiş; Electron'unkinden ayrı)`, pencereIkonuTamam(x), pencereOzeti(x));
  }
  const gorevCubugu = pencereler.filter((x) => x.olcum?.Gorunur && !x.olcum?.AracPenceresi);
  kontrol('Görünür, araç penceresi olmayan pencereler (ana pencere ve Fuber Tarayıcı görev çubuğunda; imleç katmanı) Fuber ikonlu',
    ['index.html', 'tarayici.html'].every((a) => gorevCubugu.some((x) => x.ad === a)) && gorevCubugu.every(pencereIkonuTamam), gorevCubugu.map(pencereOzeti).join(' | '));
  kontrol(`Pencereler geliştirme kimliğini taşır (${GELISTIRME_KIMLIGI}; ürünün ${URUN_KIMLIGI} kimliği değil)`, pencereler.length > 0 && pencereler.every((x) => x.olcum?.Kimlik === GELISTIRME_KIMLIGI), pencereler.map((x) => `${x.ad}=${x.olcum?.Kimlik || '—'}`).join(', '));

  // Windows bildirimi: FUBER_DEMO'da gösterilmez, kaydedilir (uygulama arkada sayılır → bildirim yolu).
  await w.evaluate(() => window.fuber.cagir('ada:test-ana-onde', false));
  await w.evaluate(() => window.fuber.cagir('ada:test-proaktif', 'İkon denetimi', 'Bildirim ikonu'));
  const bildirim = (await w.evaluate(() => window.fuber.cagir('ada:test-bildirimler'))).find((b) => b.baslik === 'İkon denetimi');
  const png = bildirim?.ikon && fs.existsSync(bildirim.ikon) ? fs.readFileSync(bildirim.ikon) : null;
  kontrol('Windows bildirimi Fuber ikonuyla (resources/ikon/fuber.png, 512 px)', Boolean(png) && path.resolve(bildirim.ikon) === path.join(kok, 'resources', 'ikon', 'fuber.png') && png.readUInt32BE(16) === 512, JSON.stringify(bildirim));
  await w.evaluate(() => window.fuber.cagir('ada:test-ana-onde', null));
  await u.close(); u = null;

  // ── 2. açılış: yeni sürüm gibi (ayardaki sürüm silinir) → kuru kip gaspçıları KAYDA yazar, hiçbir dosyaya dokunmaz ──
  const ayar = ayarOku();
  delete ayar.kisayolTemizligiSurumu;
  fs.writeFileSync(ayarYolu, JSON.stringify(ayar));
  fs.rmSync(kayitYolu, { force: true });
  w = await ac();
  await w.waitForSelector('.kokpit', { timeout: 30000 });
  await bekle(1000);
  const kayit2 = kayitOku();
  const tasinacak = (kayit2?.tasinacak ?? []).map((g) => g.yol).sort();
  kontrol('Kuru kip: kayıtta yalnız iki gaspçı (ürün kimliği + bağımsız değişkensiz başka electron.exe; biri alt klasörde); bağımsız değişkenli, Fuber\'in ve başka uygulamanın kısayolu kayıtta yok',
    kayit2?.kuru === true && JSON.stringify(tasinacak) === JSON.stringify([kisayollar.gaspci, kisayollar.altGaspci].sort()) && kayit2.tasinacak.every((g) => g.hedef === sahteElectron),
    JSON.stringify(kayit2));
  kontrol('Kuru kip hiçbir kısayola dokunmadı: beşi de yerinde', Object.values(yerinde()).every(Boolean), JSON.stringify(yerinde()));
  await u.close(); u = null;

  // ── 3. açılış: aynı sürüm → tarama yeniden yapılmaz (sürüm başına bir kez) ──
  fs.rmSync(kayitYolu, { force: true });
  w = await ac();
  await w.waitForSelector('.kokpit', { timeout: 30000 });
  await bekle(1000);
  kontrol(`Aynı sürümde (${surum}) yeniden açılış: tarama yapılmadı (kayıt yazılmadı), ayardaki sürüm yerinde`, !fs.existsSync(kayitYolu) && ayarOku().kisayolTemizligiSurumu === surum, JSON.stringify({ kayit: kayitOku(), ayar: ayarOku().kisayolTemizligiSurumu }));
  await u.close(); u = null;
  kontrol('Konsol/sayfa hatası yok', hatalar.length === 0, hatalar.join(' | '));
} catch (e) {
  kontrol('önizleme düştü', false, e?.stack ?? e);
} finally {
  if (u) await u.close().catch(() => undefined);
  try { fs.rmSync(veri, { recursive: true, force: true }); } catch { /* kapanırken kilitli kalan dosya */ }
  const hata = sonuclar.filter((s) => !s.tamam).length;
  console.log(`\n${sonuclar.length} denetim · ${hata} hata · geliştirme koşusu (electron.exe)`);
  process.exitCode = hata ? 1 : 0;
}
