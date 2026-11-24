// ── Yerel modelin "bekleyen" kurulumu ve İş modu hata metni (saf; birim testli: tests/yerel-bekleyen.test.ts) ─────────────────
// Görev 15 (düzeltme 1): kullanıcının istediği kurulum (sihirbazın "Ekstra gizlilik"i ya da Ayarlar → "Kur") ana süreçte
// `yerel.bekleyenKurulum` olarak kaydedilir (main/yerel/kurulum.ts); doğrulanmış kurulumda yerel beyin açılır ve kayıt silinir,
// kullanıcı durdurursa silinir, hata olursa hatayla kalır. Uygulama indirme sürerken kapanırsa kayıt kalır: açılışta uygulamada
// "Yerel beyin indirmesi yarıda kaldı — Sürdür / Vazgeç" bildirimi (renderer/bilesenler/YerelKurulum.tsx) bu kurala göre çıkar.
import type { BekleyenKurulum, YerelModelAdi } from './tipler.ts';
import { TERIM, buyukBasla, yerelAdi } from './terimler.ts';

/** Kart çizildikten ya da indirme yarıda kaldıktan sonra model katalogdan kapatıldı (ana süreç reddeder; 0.13 G). */
export const MODEL_SUNULMUYOR = 'Bu model artık sunulmuyor; listeden başka bir model seç.';

/** Bildirim için gereken yerel durum parçası (yerel:durum). */
export interface BekleyenDurumu {
  inen?: YerelModelAdi;
  indirme?: { yuzde: number; adim?: string; hata?: string };
  modeller: { ad: YerelModelAdi; kurulu: boolean }[];
}
export type BekleyenBildirimi = { tur: 'iniyor'; model: YerelModelAdi } | { tur: 'yarim'; model: YerelModelAdi } | { tur: 'hata'; model: YerelModelAdi; hata: string };

/** Kart: bekleyen kayıt varken istenen indirme sürüyorsa "iniyor" (kokpitte ilerleme); başka bir model iniyorsa yok; hiçbir indirme
 *  sürmüyorsa ve model kurulu değilse hata varsa "hata", yoksa "yarim". */
export function bekleyenBildirimi(b: BekleyenKurulum | undefined | null, d: BekleyenDurumu | null): BekleyenBildirimi | null {
  if (!b || !d) return null;
  // İndirme sürüyor mu: ilerleme varsa ona göre (hata veren indirme sürmüyor — hata yayınında "inen" henüz silinmemiş olabilir); yoksa "inen".
  const suruyor = d.indirme ? !d.indirme.hata && d.indirme.yuzde < 100 : Boolean(d.inen);
  if (suruyor) return !d.inen || d.inen === b.model ? { tur: 'iniyor', model: b.model } : null;
  if (d.modeller.some((m) => m.ad === b.model && m.kurulu)) return null;
  return b.hata ? { tur: 'hata', model: b.model, hata: b.hata } : { tur: 'yarim', model: b.model };
}

/** Kurulumdan önce boş yerin en az bu kadar olması gerekir (bayt): açılacak arşiv indirilir VE açılır (arşiv diskte kalır). */
export const DISK_GUVENLIK_PAYI = 512 * 2 ** 20;
const ACILMA_KATSAYISI = 1.5;
/** İnecek parçalar (boyut, arşiv mi) → gereken boş yer: indirilecekler + açılmış arşivler (×1,5) + güvenlik payı; inecek yoksa 0. */
export function kurulumDiskGereksinimi(isler: readonly { boyut: number; acilacak: boolean }[]): number {
  return kurulumDiskHesabi(isler.map((i) => ({ ...i, indi: false }))).gereken;
}

/** Kurulumun bir parçasının diskteki durumu (B6): `indi` tam boyutta inmiş (yeniden inmez), `yarim` eski yarım dosyanın (.indiriliyor) boyutu. */
export interface DiskParcasi { boyut: number; acilacak: boolean; indi: boolean; yarim?: number }

/**
 * B6 (G15, son düzeltme): kurulumdan önce disk hesabı. `gereken`: inecek parçalar + açılacak arşivlerin açılmış hâli (×1,5) — zaten
 * İNMİŞ ama henüz açılmamış arşivin de açma payı (eskiden sayılmıyordu) — + güvenlik payı; ne inecek ne açılacak bir şey yoksa 0.
 * `geriKazanilan`: inecek parçaların eski yarım dosyaları (.indiriliyor) baştan yazılacağı için boş yere eklenir (eskiden dolu sayılıp
 * yer varken "Diskte yer kalmadı" diyebiliyordu).
 */
export function kurulumDiskHesabi(parcalar: readonly DiskParcasi[]): { gereken: number; geriKazanilan: number } {
  const inecek = parcalar.filter((p) => !p.indi);
  const acilacakInmis = parcalar.filter((p) => p.indi && p.acilacak);
  if (!inecek.length && !acilacakInmis.length) return { gereken: 0, geriKazanilan: 0 };
  const acma = (b: number) => Math.ceil(b * ACILMA_KATSAYISI);
  const gereken = inecek.reduce((n, p) => n + p.boyut + (p.acilacak ? acma(p.boyut) : 0), 0) + acilacakInmis.reduce((n, p) => n + acma(p.boyut), 0) + DISK_GUVENLIK_PAYI;
  const geriKazanilan = inecek.reduce((n, p) => n + Math.max(0, Number(p.yarim) || 0), 0);
  return { gereken, geriKazanilan };
}

/**
 * B6: istenmiş kurulum bitince yerel beyin açılacak mı (main/yerel/kurulum.ts bekleyenTamamla ile AYNI kural): indirme başladığında
 * yerel beyin açıkken kullanıcı sonradan elle kapattıysa açılmaz (kararına saygı). Kart ve onay metni "bitince açılır"ı buna göre söyler.
 */
export function bitinceAcilirMi(b: Pick<BekleyenKurulum, 'etkinBaslangic'>, etkin: boolean): boolean {
  return !(b.etkinBaslangic === true && !etkin);
}

/**
 * B6: indirmenin ekran okuyucuya duyurusu — yalnız %10 adımlarında ve durum değişince değişir (ilerleme metni 300 ms'de bir yenilenir;
 * canlı bölgeye o konsaydı her yenilemede okunurdu). `sade`: İş modu (teknik adım adı yok).
 */
export function indirmeDuyurusu(i: { yuzde: number; adim?: string; hata?: string }, sade: boolean): string {
  if (i.hata) return sade ? `Kurulum durdu: ${yerelHataSade(i.hata)}` : `Kurulum durdu: ${i.hata}`;
  if (i.yuzde >= 100) return `${buyukBasla(yerelAdi(sade))} kuruldu`;
  return `${buyukBasla(yerelAdi(sade))} indiriliyor, yüzde ${Math.floor(Math.max(0, i.yuzde) / 10) * 10}`;
}

/** Kurulum hatasının İş modundaki metni (K2): model/dosya adı, SHA, adres yok; ne olduğu ve ne yapılacağı kalır. */
export function yerelHataSade(hata: string, siz = false): string {
  const h = String(hata ?? '');
  if (/Diskte yer kalmadı/i.test(h)) return 'Diskte yer kalmadı.';
  if (/Başka bir indirme sürüyor/i.test(h)) return `${buyukBasla(TERIM.yzYerel)}nın başka bir indirmesi sürüyor; önce o bitsin ya da ${siz ? 'durdurun' : 'durdur'}.`;
  if (/artık sunulmuyor/i.test(h)) return siz ? 'Bu sürüm artık sunulmuyor; listeden başka bir sürüm seçin.' : 'Bu sürüm artık sunulmuyor; listeden başka bir sürüm seç.';
  if (/SHA-256|bozuk|doğrulanamadı/i.test(h)) return siz ? 'İnen dosya doğrulanamadı ve silindi; yeniden deneyin, sürerse başka bir sürüm seçin.' : 'İnen dosya doğrulanamadı ve silindi; yeniden dene, sürerse başka bir sürüm seç.';
  if (/HTTP \d|fetch failed|ENOTFOUND|ECONN|ETIMEDOUT|EAI_AGAIN|network|bağlan/i.test(h)) return siz ? 'İndirme sunucusuna ulaşılamadı; bağlantınızı denetleyip yeniden deneyin.' : 'İndirme sunucusuna ulaşılamadı; bağlantını denetleyip yeniden dene.';
  return `${buyukBasla(TERIM.yzYerel)} kurulamadı; ${siz ? 'yeniden deneyin' : 'yeniden dene'}.`;
}
