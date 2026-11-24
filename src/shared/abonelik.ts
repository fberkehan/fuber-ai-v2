// ── Motor hâli, sohbet şeridi ve motor hata metinleri (saf; birim testli: tests/abonelik.test.ts, motor-durumu.test.ts, motor-hata.test.ts) ──
// Dosya adı eskiden kalmadır: Fuber aboneliği (plan, deneme, ödeme, fatura durum makinesi ve taslak fiyatlar) 0.11'de TAMAMEN kalktı.
// 0.11 G8 (spec §7; satın alınamayan bir abonelik yüzeyi bozuk görünür): arayüzde plan kartı,
// ödeme, fatura ve gösterim denetimi YOK; Ayarlar → "Hesap ve kullanım" hesabın durumunu ve kalan kullanımı gösterir
// (shared/hesap-kullanim.ts). 0.11 G12a: ana sürecin kapalı `abonelik:islem` / `abonelik:al` yolu (kanal, işleyici, köprü sınıfı),
// durum makinesi (islemUygula, zamanla, abonelikOzeti, abonelikDuzelt), PLANLAR (taslak fiyatlar) ve `Ayarlar.abonelik` alanı silindi;
// eski bir ayar dosyasında alan varsa yüklemede sessizce atılır (main/ayarlar.ts) ve `ayarlar:kaydet` onu geri yazamaz.
// Bu açık kaynak derlemede ödeme, plan ya da ödeme sağlayıcısı bağlantısı yoktur.
// Burada kalanlar: motorun bağlı olup olmadığı kuralı (motorBagliMi, bulutMotorSayisi), motor sinyali ve başlık hapı (motorEtiketi),
// sohbet şeridi (sohbetSeridi) ve moda göre motor/anahtar hata metinleri.
// - K3: abonelik motor SAĞLAMAZ. Yapay zekâ Fuber hesabından (0.10 E3) ya da Geliştirici'nin kendi anahtarından gelir; motorun hâli ve
//   bildirimi TEK kaynaktan (shared/motor-durumu.ts; 0.10 Görev 2, Karar D2).
// - İş modundaki metinlerde anahtar/API/model dili, "Faz", "önizleme", "Stripe", "taslak fiyat", "satış sürümü" yok (shared/is-dili.ts).
// Electron/DOM yok: ana süreç (main/abonelik.ts motorDurumu) ve arayüz (ada, sohbet şeridi, kokpit hapı) aynı kuralları buradan okur;
// motor hâli tek sinyalden (renderer/motor-sinyali.ts).
import type { Ayarlar, Mod } from './tipler.ts';
import { HESAP_DURUM_METNI, type HesapDurumu } from './masaustu-hesap.ts';
import { gonderimAcikMi, motorBildirimi, yalnizYerelSecili, type MotorEylemi, type MotorGorunumu, type MotorSinyali } from './motor-durumu.ts';
import { YALNIZ_YEREL_NOTU } from './tek-motor.ts';
import { hazirDurumu } from './kurulum-yerel.ts';
import { ARAC_KATALOGU_BUYUK_METNI } from './sohbet-protokolu.ts';
import { BULUT_YZ_KAPALI, YEREL_BULUT_KAPALI } from './gizlilik-metni.ts';

// ── Motor (bağlı mı) ve sohbet şeridi ────────────────────────────────────────────────────────────────────────────
// 0.10 G2 (Karar D2, R16): motorun hâli ve bildirimi TEK kaynaktan (shared/motor-durumu.ts: yedi hâl, motorBildirimi). Önizleme aboneliği
// motor SAĞLAMADIĞI için aboneliğe götüren düğmeler ("Denemeyi başlat", "Abone ol") ve "Kullanım biçimini değiştir" motor bildiriminden
// kalktı (0.11 G8: planlar arayüzden tümüyle kalktı; yerine Ayarlar → Hesap ve kullanım).
/** Bağlı motor var mı (ana süreçteki hazirMi ile aynı kural: etkin ve anahtarı olan en az bir sağlayıcı). */
/** `hesap` ZORUNLU bağımsız değişken (düzeltme turu 2): masaüstü Fuber hesabını unutan çağrı derlenmez (renderer motor sinyali hesabı
 *  saymadığı için giriş yapan İş kullanıcısı kırmızı "motor durdu" görüyordu). */
export function motorBagliMi(s: Ayarlar['saglayicilar'] | null | undefined, hesap: Ayarlar['hesap'] | null | undefined): boolean {
  return bulutMotorSayisi(s, hesap) > 0;
}
/** Ready cloud engine count (same rule as hazirMotorlar() in the main process): providers that are enabled and have a key. */
export function bulutMotorSayisi(s: Ayarlar['saglayicilar'] | null | undefined, _hesap?: Ayarlar['hesap'] | null): number {
  return (['anthropic', 'openai', 'openrouter'] as const).filter((k) => Boolean(s?.[k]?.etkin && s[k].anahtarVar)).length;
}

/** Sohbet şeridinin düğmesi: Ayarlar çapası ('gizli-mod', 'yapay-zeka/motorlar' ya da ayar kimliği: açılır ve vurgulanır) ya da motor eylemi
 *  ('hesap' Fuber hesabı penceresi, 'yeniden-dene' hesabın hâlini yeniden sorar). */
export interface SeritDugmesi { etiket: string; cipa?: string; eylem?: MotorEylemi }

// ── Motor sinyali (Ruling K): "motor yok" = kullanılabilir bulut motoru YOK ve hazır yerel model YOK ──────────────
export type { MotorSinyali } from './motor-durumu.ts';
export type MotorHali = 'bulut' | 'yerel' | 'yok';
export const motorHali = (s: MotorSinyali): MotorHali => (s.bulut > 0 ? 'bulut' : s.yerel ? 'yerel' : 'yok');

/** Başlık hapının noktası: gri = nötr (bağlı değil, Geliştirici). */
export type MotorNoktasi = 'yesil' | 'turuncu' | 'kirmizi' | 'gri';
export interface MotorEtiketi { hap: string; ipucu?: string; nokta: MotorNoktasi }

/**
 * Kokpit başlık hapı (A-3, A-40; Görev 2): İş'te yalnız hazır "Yapay zekâ hazır" (yeşil) ve yalnız yerel "Yalnız gündelik sohbet" (turuncu).
 * Bildirim gerektiren hâllerde (bağlı değil, koptu, hesap bekliyor/kapalı/doldu) İş'te hap ÇİZİLMEZ (null; R28b — D2 "tek bildirim": kokpitte
 * o sırada bildirim kartı ya da dolu sohbette şerit görünür). Gizli modda yerel yanıtlıyorsa sakin "Gizli mod" (gri). Geliştirici'de ayrıntı:
 * "N motor bağlı" / "yalnız yerel model" / "motor bağlı değil" (gri) / "motor durdu" (kırmızı) / hesap hâlleri. İş metinlerinde "motor",
 * "beyin" ve teknik ad yok.
 */
export function motorEtiketi(g: MotorGorunumu, mod: Mod, bulutSayisi = 0, gizli = false, yalnizYerel = false): MotorEtiketi | null {
  const gel = mod === 'gelistirici';
  // 0.12 H3c: "Yalnız bu bilgisayar" hazırlanırken (Gizli değil) Gizli'nin hapı söylenmez: İş'te hap yok (nötr satır kokpit kartında), Geliştirici'de gri.
  if (g === 'hazirlaniyor' && !gizli && yalnizYerel) return gel ? { hap: 'yerel model iniyor', nokta: 'gri' } : null;
  // P14 K1: "hazır değil" kartı sakin — İş'te hap yok (kart kokpitte), Geliştirici'de gri.
  if (g === 'yerel-hazir-degil') return gel ? { hap: 'yerel model hazır değil', nokta: 'gri' } : null;
  if ((gizli && g !== 'hazir') || g === 'hazirlaniyor') {
    if (g === 'yerel') return gel ? { hap: 'gizli mod · yerel model', nokta: 'gri' } : { hap: 'Gizli mod', ipucu: `Gizli mod açık: ${BULUT_YZ_KAPALI}; yalnız gündelik sohbet.`, nokta: 'gri' };
    // F1 (Ö2): hazırlanırken kırmızı yok — Geliştirici'de gri hap, İş'te hap yok (tek nötr satır kokpit kartında; R28b).
    if (g === 'hazirlaniyor') return gel ? { hap: 'gizli mod · yerel model iniyor', nokta: 'gri' } : null;
    return gel ? { hap: 'gizli mod · yerel model hazır değil', nokta: 'kirmizi' } : null;
  }
  if (!gel) {
    if (g === 'hazir') return { hap: 'Yapay zekâ hazır', nokta: 'yesil' };
    // 0.12 H3c: bilinçli "Yalnız bu bilgisayar" (İş'te de) — uyarı değil, nötr; araç yok notu.
    if (g === 'yerel' && yalnizYerel) return { hap: 'Yalnız bu bilgisayar', ipucu: YALNIZ_YEREL_NOTU, nokta: 'gri' };
    if (g === 'yerel') return { hap: 'Yalnız gündelik sohbet', ipucu: 'Şimdilik bu bilgisayardaki yapay zekâ yanıtlıyor: gündelik sohbet olur, zor işler için bulut yapay zekâ gerekir.', nokta: 'turuncu' };
    return null;
  }
  switch (g) {
    case 'hazir': return { hap: `${bulutSayisi} motor bağlı`, nokta: 'yesil' };
    // 0.11 G8 (K2): bilinçli "yalnız yerel" — uyarı değil (gri), araç yok notu.
    case 'yerel': return yalnizYerel ? { hap: 'yalnız yerel · araçsız', ipucu: YALNIZ_YEREL_NOTU, nokta: 'gri' } : { hap: 'yalnız yerel model', ipucu: 'Bulut motoru yok: yerel model yalnız gündelik sohbeti yanıtlar.', nokta: 'turuncu' };
    case 'bagli-degil': return { hap: 'motor bağlı değil', nokta: 'gri' };
    case 'durdu': return { hap: 'motor durdu', nokta: 'kirmizi' };
    case 'hesap-bekliyor': return { hap: 'hesap onay bekliyor', nokta: 'gri' };
    case 'hesap-kapali': return { hap: 'Erişim kapalı', ipucu: HESAP_DURUM_METNI.kapali, nokta: 'kirmizi' };
    case 'kredi-bitti': return { hap: 'Kullanım hakkı doldu', ipucu: HESAP_DURUM_METNI['kredi-bitti'], nokta: 'kirmizi' };
  }
}

/** Gizli mod açıkken sohbetin motor iletisi: `bulut-gerekli` iş araç ister (Fuber Tarayıcı'nın "Fuber'e sor"u), `yok` bu bilgisayardaki
 *  yapay zekâ hazır değil. Yol Gizlilik ayarlarıdır (Gizli modu kapat / yerel yapay zekâyı aç) — hesap değil. */
const GIZLI_HATA: Readonly<Record<Mod, Record<'yok' | 'bulut-gerekli', string>>> = {
  is: {
    'bulut-gerekli': 'Gizli mod açıkken bu iş yapılamaz: Gizli modda Fuber yalnız bu bilgisayardaki yapay zekâyla çalışır, o da yalnız gündelik sohbeti yanıtlar. Gizli modu Gizlilik ayarlarından kapatabilirsin.',
    yok: 'Gizli modda Fuber yalnız bu bilgisayardaki yapay zekâyla çalışır; o şu an hazır değil. Gizlilik ayarlarından açabilir ya da Gizli modu kapatabilirsin.',
  },
  gelistirici: {
    'bulut-gerekli': 'Gizli mod açık: bu iş araç ister, yerel model araçsız çalışır ve bulut motorları Gizli modda kullanılmaz. Gizli modu Ayarlar → Gizlilik’ten kapatabilirsin.',
    yok: 'Gizli mod açık ama yerel model hazır değil. Ayarlar → Gizlilik’ten yerel modeli aç ya da Gizli modu kapat.',
  },
};

/** 0.11 G8 (K2): yalnız-yerel açıkken araç isteyen iş. Bir bulut motoru varken: Fuber'i seçince iş onunla yapılır. 0.12 H3c: seçim TEK yerde —
 *  Ayarlar → Gizlilik → "Nerede çalışsın" (eski "Yapay zekâ’daki anahtar" kalktı); İş'te de var (İş dilinde ayrı cümle). */
export const YALNIZ_YEREL_HATA = 'Bu iş araç ister ve “Yalnız bu bilgisayar” seçiliyken araçlar yok. Ayarlar → Gizlilik → Nerede çalışsın’dan bulut yapay zekâyı seç; iş bulut motoruyla yapılır.';
/** Aynı durum, ama hiç bulut motoru yokken (G8 düzeltme turu 2): "iş bulut motoruyla yapılır" olmayan bir yolu vaat ederdi — doğrusu: yerelde araç yok,
 *  araçlı iş için önce bir bulut motoru gerekir (seçimi değiştirmek tek başına işe yaramaz). */
export const YALNIZ_YEREL_HATA_BULUTSUZ = 'Bu iş araç ister; yalnız bu bilgisayardaki yapay zekâda araçlar yok. Araçlı işler için Ayarlar → Yapay zekâ’dan kendi anahtarını bağla.';
/** 0.12 H3c: İş dilindeki karşılıkları (motor/anahtar yok). */
export const YALNIZ_YEREL_HATA_IS = 'Bu iş araç ister; “Yalnız bu bilgisayar” seçiliyken araçlar kapalı. Ayarlar → Gizlilik → Nerede çalışsın’dan bulut yapay zekâyı seçince iş onunla yapılır.';
export const YALNIZ_YEREL_HATA_IS_BULUTSUZ = 'Bu iş araç ister; bu bilgisayardaki yapay zekâda araçlar yok. Araçlı işler için Ayarlar → Yapay zekâ’dan bir yapay zekâ bağlayabilirsin.';
/** Takip turu: "Yalnız bu bilgisayar" seçili ve yerel İNERKEN (ya da yarıda) telefon/ada notu — kartla aynı hazırlanma cümlesi (hazirDurumu;
 *  yüzdesiz: kayıtta kalır). "yeniden indirebilir" denmez (iniyor). */
export const yalnizHazirlanmaMetni = (mod: Mod, yarim: boolean): string => hazirDurumu({
  mod, gorunum: 'hazirlaniyor', gizliMod: false, yalnizYerel: true, yerelHazir: false, yerelIniyor: !yarim, yerelIstendi: true, yerelYarim: yarim,
}) ?? '';
/** 0.12 cila düzeltme turu 1 (inceleme d): Gizli açık ve yerel İNERKEN (ya da yarıda) sohbet kaydına düşen sakin not — kokpit satırının
 *  Gizli hazırlanma cümlesi (hazirDurumu; ⚠ yok, "hazır değil" denmez). */
export const gizliHazirlanmaMetni = (mod: Mod, yarim: boolean): string => hazirDurumu({
  mod, gorunum: 'hazirlaniyor', gizliMod: true, yerelHazir: false, yerelIniyor: !yarim, yerelIstendi: true, yerelYarim: yarim,
}) ?? '';
/** H3c düzeltme turu 1 (P14 K1): bulutta süren tur, "Yalnız bu bilgisayar" seçilince durur (sonraki çağrı buluta gitmez; motor/secici.ts). */
export const YALNIZ_YEREL_SECILDI_DURDU = '“Yalnız bu bilgisayar” seçildi; bu yanıt buluta gitmesin diye durdu.';
/** Düzeltme turu 1 (P14 K1): "Yalnız bu bilgisayar" seçili ve yerel hazır değil — yanıt buluta gitmez; giriş yapmak önerilmez (telefon, ada). */
export const YALNIZ_YEREL_YOK: Readonly<Record<Mod, string>> = {
  is: `Bu bilgisayardaki yapay zekâ henüz hazır değil; ${YEREL_BULUT_KAPALI}. Ayarlar → Gizlilik → Nerede çalışsın’dan yeniden indirebilir ya da bulut yapay zekâyı seçebilirsin.`,
  gelistirici: `Yerel model henüz hazır değil; ${YEREL_BULUT_KAPALI}. Ayarlar → Gizlilik → Nerede çalışsın’dan yeniden indirebilir ya da bulut yapay zekâyı seçebilirsin.`,
};

/** Fuber hesabının hâli bir şeyi kapatıyorsa (onay bekliyor / kapalı / doldu) kullanıcıya söylenecek R10 metni; değilse undefined. */
const hesapEngeli = (h: HesapDurumu | null | undefined): string | undefined => (h && h !== 'aktif' ? HESAP_DURUM_METNI[h] : undefined);

/**
 * Sohbetin hata/⚠ notu metni (ajan/dongu.ts, motor/secici.ts), Fuber Tarayıcı'nın "Fuber'e sor" hata satırı (D-5) ve kokpitin "motor yok"
 * uyarısı — TEK kaynak: `yok` hiç motor yok; `bulut-gerekli` yalnız yerel model var, iş bulut ister. İş'te "Faz 1", "önizleme",
 * "Geliştirici moduna geç", "Motorlar" ve anahtar dili yok: yol Fuber hesabıdır (kokpitteki "Giriş yap"). Fuber hesabı onay bekliyor,
 * kapalı ya da kullanım hakkı dolmuşsa (`hesapDurumu`) R10'un kendi metni (iki modda). Geliştirici'de Motorlar yolu da söylenir.
 * `gizli` (düzeltme turu 1): Gizli mod açık — hesap kullanılmaz; giriş yapmak bir şey açmaz: Gizli modun kendi cümlesi (GIZLI_HATA).
 */
export function motorHataMetni(tur: 'yok' | 'bulut-gerekli', mod: Mod, hesapDurumu?: HesapDurumu | null, gizli = false, yalnizYerel = false, bulutVar = true, hazirlik: 'iniyor' | 'yarim' | null = null): string {
  if (gizli) return GIZLI_HATA[mod][tur];
  // 0.11 G8 (K2): "Yalnız bu bilgisayardaki yapay zekâ" açıkken araç isteyen iş (bulut hesabının hâli ilgisiz): bulut motoru VARSA doğru yol anahtarı kapatmak;
  // YOKSA (düzeltme turu 2, `bulutVar`) yerelde araç yok ve araçlı iş için önce bir bulut motoru gerekir. `bulutVar` yalnız yalnız-yerel dalında okunur.
  if (yalnizYerel && tur === 'yok') return hazirlik ? yalnizHazirlanmaMetni(mod, hazirlik === 'yarim') : YALNIZ_YEREL_YOK[mod];
  if (yalnizYerel && tur === 'bulut-gerekli') {
    if (mod === 'gelistirici') return bulutVar ? YALNIZ_YEREL_HATA : YALNIZ_YEREL_HATA_BULUTSUZ;
    return bulutVar ? YALNIZ_YEREL_HATA_IS : YALNIZ_YEREL_HATA_IS_BULUTSUZ;
  }
  const engel = hesapEngeli(hesapDurumu);
  if (engel) return engel;
  if (mod === 'gelistirici') {
    return tur === 'yok'
      ? 'Hiçbir motor bağlı değil. Ayarlar → Yapay zekâ’dan kendi anahtarını kaydet (Claude ya da OpenAI uyumlu bir sağlayıcı) ya da yerel modeli aç.'
      : 'Bu iş için bulut motoru gerekiyor (yerel model yalnız gündelik sohbeti yanıtlar). Ayarlar → Yapay zekâ’dan kendi anahtarını kaydet.';
  }
  return tur === 'yok'
    ? 'Bulut yapay zekâ bağlı değil; verilerin yerinde. Ayarlar → Yapay zekâ’dan bir yapay zekâ bağlayınca açılır.'
    : 'Bu iş için bulut yapay zekâ gerekiyor; bu bilgisayardaki yapay zekâ yalnız gündelik sohbeti yanıtlar. Ayarlar → Yapay zekâ’dan bir yapay zekâ bağla.';
}

/** Motor hatasının türü (main/motor/tipler.ts MotorHatasi.kod ile aynı). */
export type MotorHataTuru = 'anahtar' | 'limit' | 'baglanti' | 'istek' | 'bilinmiyor';

/**
 * A1 (son düzeltme): İş modunda motor hatasının sohbette (geçici satır ve kayıtlı ⚠ notu), adada ve telefonda görünen sade cümlesi.
 * Sağlayıcıların ham iletileri ("Claude sunucusuna bağlanılamadı", "OpenRouter hız/kota sınırı", HTTP kodları) İş'te görünmez — ham ileti
 * yalnız Geliştirici'de ve günlükte kalır. Cümleler ham iletiden BAĞIMSIZDIR (tests/motor-hata.test.ts her sağlayıcı iletisini bundan
 * geçirip IS_YASAK ile tarar). 0.10 G2: "Fuber bulut beyni" → "Fuber’in yapay zekâsı"; "Geliştirici moduna geçip" yolu kalktı.
 */
export const IS_MOTOR_HATASI: Readonly<Record<MotorHataTuru, string>> = {
  anahtar: 'Yapay zekâ bağlantısı kabul edilmedi; verilerin yerinde. Ayarlar → Yapay zekâ’dan bağlantıyı denetle.',
  limit: 'Yapay zekâ şu an çok yoğun ya da kullanım sınırına ulaşıldı; biraz sonra yeniden dene.',
  baglanti: 'Yapay zekâya ulaşılamadı; internet bağlantını denetleyip yeniden dene.',
  istek: 'Yapay zekâ bu isteği tamamlayamadı; mesajı kısaltıp ya da başka türlü anlatıp yeniden dene.',
  bilinmiyor: 'Bir sorun oldu, yanıt tamamlanamadı; biraz sonra yeniden dene.',
};

/** İş için zaten yazılmış motor iletileri (motorHataMetni: hiç motor yok / iş bulut ister / hesabın R10 hâli): olduğu gibi gösterilir. */
const IS_HAZIR_METINLER: ReadonlySet<string> = new Set([
  motorHataMetni('yok', 'is'), motorHataMetni('bulut-gerekli', 'is'), ...Object.values(HESAP_DURUM_METNI), ...Object.values(GIZLI_HATA.is),
  YALNIZ_YEREL_HATA_IS, YALNIZ_YEREL_HATA_IS_BULUTSUZ, YALNIZ_YEREL_YOK.is, YALNIZ_YEREL_SECILDI_DURDU, yalnizHazirlanmaMetni('is', false), yalnizHazirlanmaMetni('is', true),
  gizliHazirlanmaMetni('is', false), gizliHazirlanmaMetni('is', true),
  // 0.14 T16: bağlı servislerin araç kataloğu çok büyük (400 ARAC_KATALOGU_BUYUK) — kullanıcının yapabileceği şeyi söyleyen tek cümle.
  ARAC_KATALOGU_BUYUK_METNI,
]);

/** Sohbette/adada görünen motor hatası: Geliştirici'de bugünkü ayrıntı (ham ileti); İş'te türün sade cümlesi (İş için yazılmış iletiler aynen). */
export function gorunenMotorHatasi(tur: MotorHataTuru | undefined, ham: string, mod: Mod): string {
  if (mod === 'gelistirici') return ham;
  if (IS_HAZIR_METINLER.has(ham)) return ham;
  return IS_MOTOR_HATASI[tur ?? 'bilinmiyor'] ?? IS_MOTOR_HATASI.bilinmiyor;
}

/** Seçili sağlayıcıya bağlanılamıyor (motor/anthropic.ts, openai.ts, fuber.ts): İş'te motor yok metni, Geliştirici'de sağlayıcı adı ve yol.
 *  0.13 T15: kimse API anahtarı girmez — yol "anahtar ekle" değil Fuber hesabıyla giriş (Ayarlar → Hesap ve kullanım); anahtar dili yok. */
export function anahtarYokMetni(saglayici: string, mod: Mod): string {
  if (mod !== 'gelistirici') return motorHataMetni('yok', mod);
  return `${saglayici} bağlı değil: Ayarlar → Yapay zekâ’dan anahtarını kaydet.`;
}

export interface SohbetSeridi {
  seviye: 'notr' | 'sari' | 'kirmizi';
  /** Motor hâli (bildirim). 0.11 G8: ödeme şeridi kalktı — gösterilecek bir satın alma yok. */
  tur: Exclude<MotorGorunumu, 'hazir'>;
  baslik: string;
  aciklama?: string;
  dugmeler: SeritDugmesi[];
  /** Hiç motor yok: sohbetten mesaj gönderilemez (ada gibi); veri okunur, yazılanlar silinmez. */
  gonderimKapali: boolean;
}

/**
 * Sohbet yazı alanının üstündeki şerit (Ruling K; Görev 2): motor hâlinin TEK bildirimi (motorBildirimi: bağlı değil nötr + "Giriş yap",
 * durdu kırmızı, yalnız yerel sarı, hesap hâlleri R10 metinleriyle) — gönderim yalnız hiç motor yokken kapalı. Başka durumda şerit yok
 * (0.11 G8: abonelik/ödeme şeridi kalktı; abonelik durumu burada hiç okunmaz). `gorunum` motor-durumu.ts motorGorunumu'ndan; `gizli` Gizli
 * mod (sinyalin `gizli`si; bildirim Gizli moda göre).
 */
export function sohbetSeridi(mod: Mod, motor: MotorSinyali, gorunum: MotorGorunumu, hesapDurumu?: HesapDurumu | null, gizli = false): SohbetSeridi | null {
  const b = motorBildirimi(gorunum, mod, hesapDurumu, gizli, motor.yarim === true, yalnizYerelSecili(motor), motor.yerelYuzde);
  if (b && gorunum !== 'hazir') {
    const dugmeler: SeritDugmesi[] = [];
    if (b.dugme && b.eylem) dugmeler.push({ etiket: b.dugme, eylem: b.eylem });
    else if (b.dugme && b.cipa) dugmeler.push({ etiket: b.dugme, cipa: b.cipa });
    if (b.ikincil) dugmeler.push({ ...b.ikincil });
    return { seviye: b.seviye, tur: gorunum, baslik: b.baslik, ...(b.metin ? { aciklama: b.metin } : {}), dugmeler, gonderimKapali: !gonderimAcikMi(motor) };
  }
  return null;
}
