// ── Windows kabuğundaki kimlik (0.10 E1, K7): görev çubuğu, Alt+Tab, bildirim ve sabitleme Fuber'i tanısın ────────────────────────
// Kimlik kuralları ve 27 Eki kök nedeni: shared/uygulama-kimligi.ts. Burada:
//  · kimligiKur(): süreç kimliği — paketli uygulama ürünün kimliği (NSIS kısayoluyla aynı), geliştirme koşusu ayrı kimlik. main.ts modül
//    düzeyinde, ilk pencereden önce çağırır.
//  · kimlikGaspiniTemizle(): Başlat menüsünde ürünün kimliğini taşıyıp bağımsız değişkensiz, çıplak bir electron.exe'yi açan kısayolu
//    (geliştirmeden kalma; Windows kimliği ona çözer ve Fuber Electron ikonu ve adıyla görünür) GERİ DÖNÜŞÜM KUTUSU'NA taşır
//    (shell.trashItem; geri alınabilir). Taşıma beklenmez; reddedilirse dosya olduğu gibi kalır, yalnız günlüğe yazılır — bu yolda
//    kalıcı silme yok (R14). Kip shared/uygulama-kimligi.ts temizlikKipi'nden: testte (FUBER_VERI) KURU — yalnız testin klasörü taranır,
//    hiçbir kısayola dokunulmaz, taşınacaklar <FUBER_VERI>/kisayol-temizligi.json'a yazılır; üretimde (paketli, FUBER_VERI yok) gerçek
//    Başlat menüsü (Programs + bir alt klasör), sürüm başına bir kez (Ayarlar.kisayolTemizligiSurumu). Ana pencereden ÖNCE çalışır.
//    Kısayol kalksa da Gezgin önbelleği yüzünden o anki görev çubuğu düğmesinin hemen değişmesi garanti değildir.
import { app, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { gaspAdayiMi, kimlikGaspiMi, kisayolTemizligiGerekli, temizlikKipi, uygulamaKimligi } from '../shared/uygulama-kimligi.js';
import { ayarlar, ayarlariKaydet } from './ayarlar.js';

export function kimligiKur(): void {
  app.setAppUserModelId(uygulamaKimligi(app.isPackaged));
}

/** Klasördeki .lnk dosyaları; `derinlik` 1 = yalnız kendisi, 2 = bir alt klasör daha (Başlat menüsündeki uygulama klasörleri). */
function kisayollar(klasor: string, derinlik: number): string[] {
  let girdiler: fs.Dirent[];
  try { girdiler = fs.readdirSync(klasor, { withFileTypes: true }); } catch { return []; }
  const sonuc: string[] = [];
  for (const g of girdiler) {
    const yol = path.join(klasor, g.name);
    if (g.isFile() && g.name.toLowerCase().endsWith('.lnk')) sonuc.push(yol);
    else if (g.isDirectory() && derinlik > 1) sonuc.push(...kisayollar(yol, derinlik - 1));
  }
  return sonuc;
}

/** Klasördeki gaspçı kısayollar (salt okur): ucuz bayt süzgeci → yalnız adaylar çözülür → kural. */
function gaspcilariBul(klasor: string): { yol: string; hedef: string }[] {
  const bulunan: { yol: string; hedef: string }[] = [];
  for (const lnk of kisayollar(klasor, 2)) {
    try {
      if (fs.statSync(lnk).size > 1 << 20 || !gaspAdayiMi(fs.readFileSync(lnk))) continue;
      const k = shell.readShortcutLink(lnk);
      if (kimlikGaspiMi({ hedef: k.target, kimlik: k.appUserModelId, args: k.args }, process.execPath)) bulunan.push({ yol: lnk, hedef: k.target });
    } catch { /* okunamayan kısayol: dokunulmaz */ }
  }
  return bulunan;
}

/**
 * Taşınan (ya da kuru kipte taşınacak) kısayolların yolları. HİÇBİR KOŞULDA FIRLATMAZ (fix turu 2): açılışta ana pencereden önce
 * çalışır; bir hata (disk dolu, kilitli ayar dosyası, okunamayan klasör…) günlüğe yazılır ve açılış sürer (tests/kabuk-kimligi.test.ts).
 */
export function kimlikGaspiniTemizle(): string[] {
  try { return temizlikYap(); } catch (e) {
    console.warn(`[kimlik] kısayol temizliği yapılamadı, açılış sürüyor: ${(e as Error)?.message ?? e}`);
    return [];
  }
}

function temizlikYap(): string[] {
  const kip = temizlikKipi({
    platform: process.platform, paketli: app.isPackaged, veri: process.env.FUBER_VERI,
    testKlasoru: process.env.FUBER_TEST_BASLAT_MENUSU, demo: Boolean(process.env.FUBER_DEMO),
  });
  if (kip.kip === 'yok') return [];
  const surum = app.getVersion();
  if (!kisayolTemizligiGerekli(ayarlar().kisayolTemizligiSurumu, surum)) return [];
  const klasor = kip.kip === 'kuru' ? kip.klasor : path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  const gaspcilar = gaspcilariBul(klasor);
  // Sürüm yazılamazsa (disk dolu, kilitli dosya) temizlik yine sürer; bir sonraki açılış yeniden tarar.
  try { ayarlariKaydet((a) => { a.kisayolTemizligiSurumu = surum; }); } catch (e) {
    console.warn(`[kimlik] temizlik sürümü ayara yazılamadı (sonraki açılış yeniden tarar): ${(e as Error)?.message ?? e}`);
  }
  if (kip.kip === 'kuru') {
    // KURU (test): hiçbir kısayola dokunulmaz; taşınacaklar kaydedilir.
    const kayit = { kuru: true, surum, klasor, zaman: new Date().toISOString(), tasinacak: gaspcilar };
    try { fs.writeFileSync(path.join(process.env.FUBER_VERI!, 'kisayol-temizligi.json'), JSON.stringify(kayit, null, 1)); } catch (e) { console.warn(`[kimlik] kuru kayıt yazılamadı: ${(e as Error).message}`); }
    return gaspcilar.map((g) => g.yol);
  }
  for (const g of gaspcilar) {
    const birakildi = (e: unknown) => console.warn(`[kimlik] kısayol Geri Dönüşüm Kutusu'na taşınamadı, olduğu gibi bırakıldı: ${g.yol} — ${(e as Error)?.message ?? e}`);
    try {
      void shell.trashItem(g.yol).then(
        () => console.warn(`[kimlik] Fuber'in kimliğini taşıyan geliştirme kısayolu Geri Dönüşüm Kutusu'na taşındı: ${g.yol} → ${g.hedef}`),
        birakildi,
      );
    } catch (e) { birakildi(e); }
  }
  return gaspcilar.map((g) => g.yol);
}
