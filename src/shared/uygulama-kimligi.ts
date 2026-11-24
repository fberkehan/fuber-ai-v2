// ── Uygulama kimliği (Windows AppUserModelID; 0.10 E1, K7) ──────────────────────────────────────────────────────────────────────
// Windows görev çubuğu düğmesini, Alt+Tab grubunu, bildirimleri ve sabitlemeyi bu kimlikle tanır; kimliği Başlat menüsündeki AYNI
// kimlikli kısayola çözer ve o kısayolun ikonunu ve adını gösterir. Paketli uygulama NSIS kısayoluyla aynı kimliği taşır
// (electron-builder `appId`; tests/ikon.test.ts). Geliştirme koşusu (node_modules\electron\dist\electron.exe) AYRI bir kimlik taşır:
// kurulu Fuber AI ile gruplanmaz ve geliştirme sırasında oluşan bir kısayol ürünün kimliğini ele geçiremez.
// 27 Eki kök nedeni: Başlat menüsünde "Electron.lnk" (hedef geliştirme klonunun electron.exe'si, ikon Electron'unki) ürünün kimliğini
// taşıyordu; Windows kimliği o kısayola çözdü (Get-StartApps: "Electron  ai.fuber.masaustu") → kurulu uygulama da geliştirme koşuları da
// görev çubuğunda Electron ikonu ve adıyla göründü. Böyle bir kısayolu main/kabuk-kimligi.ts sürüm başına bir kez Geri Dönüşüm
// Kutusu'na taşır (kural: kimlikGaspiMi; kip: temizlikKipi).

import { DAGITIM } from './dagitim.ts';

/** Ürünün kimliği = electron-builder.yml `appId` = NSIS kısayolunun System.AppUserModel.ID'si. Açık kaynak hazırlığı: derleme zamanı
 *  dağıtımından (resmi: ai.fuber.masaustu; fork kendi derlemesinde FUBER_DAGITIM_APP_ID ile — paketleme de aynı değeri yazar). */
export const URUN_KIMLIGI = DAGITIM.appId;
/** Geliştirme koşusunun kimliği (paketlenmemiş Electron). */
export const GELISTIRME_KIMLIGI = `${DAGITIM.appId}.gelistirme`;
/** Geliştirme penceresi görev çubuğuna sabitlenirse kısayolun adı. */
export const GELISTIRME_ADI = `${DAGITIM.urunAdi} (geliştirme)`;

export const uygulamaKimligi = (paketli: boolean): string => (paketli ? URUN_KIMLIGI : GELISTIRME_KIMLIGI);

/** Karşılaştırma için Windows yolu: tırnak ve boşluk atılır, eğik çizgi ters bölü olur, sondaki bölü atılır, harf duyarsız. */
const yolAnahtari = (y: string | undefined): string =>
  (y ?? '').trim().replace(/^"+|"+$/g, '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();

/**
 * Başlat menüsündeki bir kısayol ürünün kimliğini GASP ediyor mu: kimliği TAM OLARAK ürününki (harf ve boşluk dahil birebir), hedefi
 * çalışan exe DEĞİL, çıplak bir Electron çalışma zamanı (`electron.exe`) ve bağımsız değişkeni YOK — geliştirmeden kalma. Fuber'in kendi
 * kısayolu, başka bir yere kurulmuş `Fuber AI.exe`, bir uygulama klasörüyle açılan electron.exe, geliştirme kimliği taşıyan ve başka
 * uygulamaların kısayolları gasp sayılmaz (dokunulmaz).
 */
export function kimlikGaspiMi(k: { hedef?: string; kimlik?: string; args?: string }, calisanExe: string): boolean {
  if (k.kimlik !== URUN_KIMLIGI) return false;
  if (k.args?.trim()) return false;
  const hedef = yolAnahtari(k.hedef);
  if (!hedef || hedef === yolAnahtari(calisanExe)) return false;
  return /(^|\\)electron\.exe$/.test(hedef);
}

const utf16 = new TextDecoder('utf-16le');
const latin1 = new TextDecoder('latin1');
/**
 * Kısayolun HAM baytlarında gasp izi var mı (ucuz ön süzgeç; harf duyarsız — kesin karar kimlikGaspiMi'nin): kimlik .lnk'nin özellik
 * deposunda UTF-16 yazılır, hedef yolu hem ANSI hem UTF-16 bulunur; ikisi de (çift ve tek bayt hizasında) aranır. Kısayolu çözmek
 * (shell.readShortcutLink) her biri için ~13 ms tutar — Başlat menüsündeki ~90 kısayolun hepsini çözmek açılışa 1,2 sn eklerdi; süzgeçle
 * yalnız adaylar çözülür.
 */
export function gaspAdayiMi(b: Uint8Array): boolean {
  const metinler = [utf16.decode(b), utf16.decode(b.subarray(1))].map((m) => m.toLowerCase());
  if (!metinler.some((m) => m.includes(URUN_KIMLIGI))) return false;
  return [...metinler, latin1.decode(b).toLowerCase()].some((m) => m.includes('electron.exe'));
}

/** Kimlik gaspı temizliğinin kipi: hiç / KURU (testin klasörü taranır, hiçbir dosyaya dokunulmaz, yalnız kayıt) / gerçek Başlat menüsü. */
export type TemizlikKipi = { kip: 'yok' } | { kip: 'kuru'; klasor: string } | { kip: 'gercek' };

/**
 * Hangi kipte çalışılacağı (R14 ve fix turu 1 kapısı):
 *  · Windows değilse: yok.
 *  · `veri` (FUBER_VERI) verilmişse — her test verir, üretim hiç vermez — KURU: yalnız `testKlasoru` (FUBER_TEST_BASLAT_MENUSU) taranır;
 *    o da yoksa hiçbir şey. Testler gerçek Başlat menüsüne ve kullanıcının Geri Dönüşüm Kutusu'na asla dokunmaz.
 *  · Üretim (FUBER_VERI yok): yalnız paketli uygulama ve FUBER_DEMO değilken gerçek Başlat menüsü; FUBER_TEST_BASLAT_MENUSU yok sayılır.
 *    Geliştirme koşusu (paketsiz) gerçek Başlat menüsüne dokunmaz.
 */
export function temizlikKipi(o: { platform: string; paketli: boolean; veri?: string; testKlasoru?: string; demo?: boolean }): TemizlikKipi {
  if (o.platform !== 'win32') return { kip: 'yok' };
  if (o.veri) return o.testKlasoru ? { kip: 'kuru', klasor: o.testKlasoru } : { kip: 'yok' };
  return o.paketli && !o.demo ? { kip: 'gercek' } : { kip: 'yok' };
}

/** Tarama sürüm başına bir kez: kayıtlı son sürüm bu sürüm değilse gerekir (Ayarlar.kisayolTemizligiSurumu). */
export const kisayolTemizligiGerekli = (kayitli: string | undefined, surum: string): boolean => kayitli !== surum;
