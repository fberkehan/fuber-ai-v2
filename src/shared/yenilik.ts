// ── "Bu sürümde yeni" kartı: 0.14’te yeni (0.14 T35; 0.13 T16; altyapı 0.11 G12b, spec §10) ─────────────────────────────────────────────
// Birim testli: tests/yeni-0-14.test.ts, tests/surum-ve-metin.test.ts (T35), tests/ipc-kurulum.test.ts; önizleme ve denetim: scripts/dev/yenilik-onizle.mjs.
// 0.12 spec (Hedefler §3): yükseltmede sihirbaz YOK — yükselen profile kokpitte BİR kez sakin, kısa, kapatılabilir tek kart. Karar tek yerde
// (burada), işaret `Ayarlar.yenilikSurumu`:
//   · YÜKSELEN profil (kurulumu tamam; işaret yok — 0.10 ve öncesi — ya da eski sürümün işareti, ör. 0.11'de kartı kapatanın '0.11.0'):
//     kart bir kez açılır; "Tamam" işareti yazar (yenilik:kapat).
//   · YENİ kurulum: kurulum:tamamla işareti kendisi yazar → kart hiç açılmaz (yeni kullanıcı için "yeni" bir şey yok; 0.11 kuralı aynen).
//   · İşaret bu sürümse ya da kurulum bitmediyse kart yok. Tanıtım turu açıkken de yok: tur kokpiti vurgular, kart ızgarayı kaydırmasın;
//     tur bitince kart gelir. 0.12 H3a: kurulum sürümü karara girmez (yükseltmede sihirbaz yok — doğrudan kokpit ve bu kart).
//   · TEST KİPİ (FUBER_DEMO): işaretsiz profil kartı görmüş sayılır — onlarca önizleme profili 0.10 profili gibi davranıp her kokpite kart
//     koymasın; kartı görmek isteyen önizleme işareti açıkça '' yazar (scripts/dev/yenilik-onizle.mjs). Müşteri sürümünde bu dal yok.
// Alan yalnız ana süreçte yazılır (kurulum:tamamla, yenilik:kapat); ayarlar:kaydet süzer (main/ayar-kaydi.ts), telefon yazamaz.
// İçerik kuralı (0.12 spec Hedefler §3 + ürün dili): 4–5 madde, her biri tek kısa cümle, sade dil, ’ kesme işareti; sağlayıcı/model/teknik
// ad YOK (İş dili: shared/is-dili.ts).
import type { Mod } from './tipler.ts';

/** Bu sürümün yenilikler kartının işareti (uygulama sürümüyle aynı büyük.küçük aile; yama sürümü kartı yeniden açmaz). */
export const YENILIK_SURUMU = '0.14.0';
export const YENILIK_BASLIGI = '0.14’te yeni';
export const YENILIK_KAPAT_ETIKETI = 'Tamam';

export interface YenilikSatiri {
  /** Ikon.tsx adı. */
  ikon: string;
  /** Tek, kısa cümle (İş dili; ’ kesme işareti). */
  metin: string;
  /** Gözleri anar: Sade modda (gorunum.karakterler 'sade') satır gösterilmez. */
  karakter?: true;
}

/** En çok 5 satır, her biri tek cümle. Konular (0.14 T35; 11 Kas gözler): yaşayan çentik ve dokuz sayfa, Fuber'in gözleri, internet ve sayfa okuma, bağlı
 *  servisler, belge üretimi. Ürün metni kuralı: Apple tonu (kısa, abartısız), mutlak söz yok — satırlar neyin yapılabildiğini ve
 *  nerede onay istendiğini söyler (MCP'de yazan araç ve dosyanın üzerine yazma her seferinde onaylı); mod adları çevrilmez. Arama ve sayfa
 *  okuma Gizli modda ve "Yalnız bu bilgisayar"da sunulmaz: satır "arayabilir" der, koşulsuz vaat etmez. */
export const YENILIKLER: readonly YenilikSatiri[] = [
  { ikon: 'ada', metin: 'Çentik artık canlı: üzerine gelince açılır, dokuz sayfa arasında kaydırarak gezersin.' },
  { ikon: 'parilti', metin: 'Business mode’da da Developer mode’da da Fuber’in gözleri sana eşlik eder.', karakter: true },
  { ikon: 'kure', metin: 'Fuber internette arayabilir ve bağlantısını verdiğin sayfayı okuyabilir.' },
  { ikon: 'baglanti', metin: 'Bağlantılar’dan kullandığın servisleri bağlarsın; değişiklik yapan her adım önce onayını ister.' },
  { ikon: 'dosya', metin: 'Belge, tablo, sunum ve PDF hazırlar; var olan bir dosyanın üzerine yazmadan önce sorar.' },
];

/** Kartta gösterilecek satırlar: Sade modda (`karakterGorunur` false) gözleri anan satır düşer (shared/karakter-gorunum.ts kuralı). */
export function yenilikSatirlari(karakterGorunur: boolean): readonly YenilikSatiri[] {
  return karakterGorunur ? YENILIKLER : YENILIKLER.filter((s) => !s.karakter);
}

export interface YenilikGirdisi {
  kurulumTamam: boolean;
  kurulumSurumu?: number;
  mod?: Mod;
  /** Kartın en son kapatıldığı (ya da yeni kurulumun yazdığı) sürüm; alan yoksa 0.10 ve öncesinden yükselen profil. */
  yenilikSurumu?: string;
}

export function yeniKartAcilsinMi(a: YenilikGirdisi, o: { turAcik?: boolean; demo?: boolean } = {}): boolean {
  if (!a.kurulumTamam || a.yenilikSurumu === YENILIK_SURUMU) return false;
  if (o.demo && a.yenilikSurumu === undefined) return false;
  return !o.turAcik;
}
