// ── Gizli mod ve bu bilgisayardaki yapay zekâ: değişmez kural (F1, son inceleme Ö1) ─────────────────────────────────────────────────
// Gizli mod açık ⇒ bu bilgisayardaki yapay zekâ ya HAZIR ya da HAZIRLANIYOR (shared/kurulum-yerel.ts yerelHazirlaniyor; arayüzde nötr
// 'hazirlaniyor'). Üçüncü hâl ("Gizli açık, yerel yok, inmiyor") kalıcı olamaz — olursa Gizli kendiliğinden kapanır ve kokpit bunu tek
// sakin cümleyle söyler (yerel.gizliGeriAlindi → shared/kurulum-yerel.ts gizliGeriAlindiMetni). Bu hâli doğuran yollar ipc.ts'te:
// bekleyen kurulumdan vazgeçme (yerel:bekleyen-vazgec), indirmeyi durdurma (yerel:kur AbortError), kalıcı kurulum hatası (bekleyenHata
// yolu) ve "Kaldır" (onay penceresi Gizli'nin de kapanacağını söyler; not yok). Gizli'den ÇIKMAK her zaman serbesttir: Gizli kapanınca
// bekleyen kurulumun "bitince Gizli modu aç" isteği de düşer (indirme sonra bitse de Gizli sessizce geri açılmaz).
// Düzeltme turu 1: N-4 — bekleyen kaydının yazımı ile Gizli'nin geri alınması TEK ayar yazımında (bekleyenleGizliyiDenetle; arada kırmızı
// motor:durum yayınlanmaz); N-1 — açılışta bir kez üçüncü hâl denetimi (acilistaGizliDenetle; main.ts bekleyenDenetle sonrası; nötr neden).
import { ayarlar, ayarlariKaydet } from '../ayarlar.js';
import { yerelHazirMi } from '../motor/yerel.js';
import { yerelInenModel, yerelKaldiriliyorMu } from './kurulum.js';
import { yerelHazirlaniyor, type GizliGeriAlmaNedeni } from '../../shared/kurulum-yerel.js';
import { YALNIZ_YEREL_GOCU, yalnizYerelGocu } from '../../shared/nerede.js';
import type { Ayarlar } from '../../shared/tipler.js';

export type { GizliGeriAlmaNedeni };

/** Ayar nesnesine (ayarlariKaydet içinden) Gizli'yi kapatma yaması; bekleyen kaydın "bitince Gizli modu aç"ı düşer, `not` kokpit içindir. */
function kapatYamasi(a: Ayarlar, not?: GizliGeriAlmaNedeni): void {
  a.yerel.gizliMod = false;
  if (a.yerel.bekleyenKurulum) delete a.yerel.bekleyenKurulum.gizliMod;
  if (not) a.yerel.gizliGeriAlindi = not;
}

/** Üçüncü hâl mi: Gizli açık, bu bilgisayardaki yapay zekâ hazır değil ve hazırlanmıyor (onu hazırlayacak istek ya da indirme yok). `a`
 *  yazılmak üzere olan ayar (ayarlariKaydet'in nesnesi; ayarlar() ile aynı) — bekleyen kaydının YENİ hâline bakılır. */
function ucuncuHalMi(a: Ayarlar): boolean {
  if (a.yerel.gizliMod !== true || yerelHazirMi()) return false;
  return !yerelHazirlaniyor({ iniyor: Boolean(yerelInenModel()), bekleyen: a.yerel.bekleyenKurulum, kaldiriliyor: yerelKaldiriliyorMu() });
}

/** Gizli modu kapatır; bekleyen kurulumun "bitince Gizli modu aç" isteği düşer. `not`: kokpitte söylenecek nedenin kaydı (yoksa not yok). */
export function gizliKapat(not?: GizliGeriAlmaNedeni): void {
  ayarlariKaydet((a) => kapatYamasi(a, not));
}

/** N-4: bekleyen kaydını değiştiren yazım (`degistir`: kalıcı hata ya da kaydın silinmesi) ve — sonuç üçüncü hâlse — Gizli'nin geri
 *  alınması TEK ayarlariKaydet'te: aradaki "Gizli açık, hazırlanmıyor" (kırmızı) hâli hiç yayınlanmaz. Gizli'yi kapattıysa true. */
export function bekleyenleGizliyiDenetle(neden: GizliGeriAlmaNedeni, degistir: (a: Ayarlar) => void): boolean {
  let kapandi = false;
  ayarlariKaydet((a) => {
    degistir(a);
    if (ucuncuHalMi(a)) { kapatYamasi(a, neden); kapandi = true; }
  });
  if (kapandi) console.info(`[yerel] Gizli mod kapatıldı: bu bilgisayardaki yapay zekâ hazır değil (${neden})`);
  return kapandi;
}

/** Değişmez kural: Gizli açık ama bu bilgisayardaki yapay zekâ ne hazır ne hazırlanıyor → Gizli kapanır, not yazılır. Yerel hazırsa
 *  (başka bir modelin kurulumundan vazgeçildi) ya da başka bir indirme sürüyorsa ("başka indirme sürüyor" reddi) hiçbir şey değişmez.
 *  Kapattıysa true. */
export function gizliyiGeriAlGerekirse(neden: GizliGeriAlmaNedeni): boolean {
  if (!ucuncuHalMi(ayarlar())) return false;
  gizliKapat(neden);
  console.info(`[yerel] Gizli mod kapatıldı: bu bilgisayardaki yapay zekâ hazır değil (${neden})`);
  return true;
}

/** N-1: açılışta BİR KEZ (main.ts, bekleyenDenetle'den sonra) — düzeltme öncesi 0.10.0'da Ö1 hâlinde kalmış profil ya da sihirbaz içi kenar
 *  durumdan kalan üçüncü hâl kapanır; neden nötr ('hazir-degil': "hazır değildi", "kurulamadı" değil). Kapattıysa true. */
export function acilistaGizliDenetle(): boolean {
  return gizliyiGeriAlGerekirse('hazir-degil');
}

/** Son bütün dal incelemesi K-1: açılışta BİR KEZ (main.ts; bekleyenDenetle'den sonra — biten bekleyen kurulum yereli açmış olabilir — ve
 *  acilistaGizliDenetle'den önce). İşaretsiz (0.12 öncesi) profilde eski "Yalnız bu bilgisayardaki yapay zekâ" değeri kullanıcı 0.12'de bilerek
 *  seçmediyse sessizce yerel kipe düşürmesin: İş'te ya da yerel hazır değilken temizlenir (kural shared/nerede.ts yalnizYerelGocu). Karar
 *  verilince işaret yazılır (sonraki açılışlarda ve 0.12'de bilerek seçilen değere hiç dokunulmaz). Yeni profil ayarlar()'da işaretlidir.
 *  Temizlediyse true. */
export function acilistaYalnizYerelGocu(): boolean {
  const a = ayarlar();
  if (a.yalnizYerelGocu === YALNIZ_YEREL_GOCU) return false;
  const once = a.yerel.yalnizYerel === true;
  const sonra = yalnizYerelGocu({ yalnizYerel: once, mod: a.mod, yerelHazir: yerelHazirMi() });
  ayarlariKaydet((x) => { x.yerel.yalnizYerel = sonra; x.yalnizYerelGocu = YALNIZ_YEREL_GOCU; });
  if (once && !sonra) console.info(`[yerel] 0.12 öncesinden kalan "Yalnız bu bilgisayar" tercihi kapatıldı (${a.mod === 'is' ? 'Business mode’da etkin değildi' : 'yerel hazır değil'})`);
  return once && !sonra;
}

/** "Tamam": kokpitteki "Gizli modu kapattım" notu kalkar. */
export function gizliNotunuKapat(): void {
  if (ayarlar().yerel.gizliGeriAlindi) ayarlariKaydet((a) => { delete a.yerel.gizliGeriAlindi; });
}

/** Arayüzden (ayarlar:kaydet) Gizli mod değişti: kapatıldıysa bekleyen kurulumun "bitince Gizli modu aç" isteği düşer; açıldıysa eski
 *  "Gizli modu kapattım" notu kalkar. */
export function gizliDegisti(once: boolean, simdi: boolean): void {
  if (once && !simdi && ayarlar().yerel.bekleyenKurulum?.gizliMod) ayarlariKaydet((a) => { if (a.yerel.bekleyenKurulum) delete a.yerel.bekleyenKurulum.gizliMod; });
  if (!once && simdi) gizliNotunuKapat();
}
