// ── "Nerede çalışır / Gizli / Yalnız bu bilgisayar" sözleri: TEK kaynak (0.14 T34b) ────────────────────────────────────────────────────
// Ürün kuralı (P14): gizlilik metni mutlak söz ya da sonuç sözü vermez ("hiçbir şey çıkmaz", "buluta gitmez"); yalnız neyin KAPALI olduğunu
// ya da nasıl çalıştığını söyler. Kısa, sakin, tek gerçek: Gizli ve "Yalnız bu bilgisayar"da buluttaki yapay zekâ kapalıdır (motor/secici.ts
// tekMotorYolu: yerel hazır değilken sohbet bekler, buluta düşülmez); Gizli'de Fuber hesabı da kapalıdır (hesap.ts iste(): Gizli'de hesap
// isteği yok, yalnız Ayarlar çıkışının açık onaylı tek isteği). E-posta/WhatsApp eşitlemesi ve telefon köprüsü sürer — bu yüzden "hiçbir şey"
// denmez (kurulum-yerel.ts gizliKapsami dip'i söyler).
// Kurulum (shared/kurulum-metin.ts KM) ve Ayarlar → Gizlilik aynı çiftleri okur. Hitap gerektirmeyen cümleler tek dizgedir.
// Denetim: tests/sonuc-sozu.test.ts (src/ dizgelerinde yasak kalıp yok; bu dosyanın içe aktarıldığı yerler).
export type Cift = readonly [sen: string, siz: string];

/** Kapalı olanın adı — cümle parçası (küçük harfle; sonda nokta yok). */
export const BULUT_YZ_KAPALI = 'buluttaki yapay zekâ kapalı';
/** Dar sütunun aynı sözü (kokpit kartının 1080'deki tek satırı, ≤ 38 harf ile birlikte). */
export const BULUT_YZ_KAPALI_KISA = 'Bulut yapay zekâsı kapalı';
/** Gizli'nin tek cümlesi (noktasız; birleştirilerek kullanılır). */
export const GIZLI_BULUT_KAPALI = `Gizli modda ${BULUT_YZ_KAPALI}`;
/** "Yalnız bu bilgisayar"ın tek cümlesi (noktasız). */
export const YEREL_BULUT_KAPALI = `“Yalnız bu bilgisayar” seçiliyken ${BULUT_YZ_KAPALI}`;
/** Aynı gerçek, seçimin kendi ekranında (Nerede satırı): "bu seçimde". */
export const SECIMDE_BULUT_KAPALI = `bu seçimde ${BULUT_YZ_KAPALI}`;

export const GM = {
  /** Nerede satırının iniş notu (kurulum Adım 6 ve Ayarlar → Gizlilik; NeredeSecimi inisNotu). */
  inisGizli: [`hazır olana dek sohbetin bekler; ${GIZLI_BULUT_KAPALI}.`, `hazır olana dek sohbetiniz bekler; ${GIZLI_BULUT_KAPALI}.`],
  inisYerel: [`hazır olana dek sohbetin bekler; ${SECIMDE_BULUT_KAPALI}.`, `hazır olana dek sohbetiniz bekler; ${SECIMDE_BULUT_KAPALI}.`],
} as const satisfies Record<string, Cift>;

/** Gizli kartının tek cümlesi (Nerede seçimi; "Yalnız bu bilgisayar" kartının eşi). Kısa: 1080×680'de 520 px sütunda tek satır (8 GB ekranı taşmaz). */
export const GIZLI_KARTI = 'Yanıtlar burada üretilir; bulut yapay zekâ kapalı.';
/** Kurulumun Nerede önizlemesinde Gizli yanıtın kaynağı (noktasız rozet satırı). */
export const GIZLI_YANIT_KAYNAGI = `Yanıt bu bilgisayarda üretildi; ${BULUT_YZ_KAPALI}`;
/** Gizli modda ses satırı (Ayarlar → Ses ve ada, eski kurulum): ses bu bilgisayarda (nerede.ts sesBuBilgisayarda: Fuber’in sesi kapalı). */
export const GIZLI_SES = 'Gizli mod: ses bu bilgisayarda üretilir.';
/** Ses bu bilgisayardayken (Gizli ya da "Yalnız bu bilgisayar") kurulumun ses önizlemesi dipnotu. */
export const SES_BU_BILGISAYARDA = 'Ses bu bilgisayarda üretilir.';
/** Yedek ses (Piper): nasıl çalıştığı — yetenek sözü (ses-kimligi.ts YEDEK_SES, ses-uyum.ts, eski kurulum). */
export const YEDEK_SES_NASIL = 'Bu bilgisayarda üretilir; çevrimdışı çalışır';
/** Gizli'de hesap ekranlarının notu (hesap/HesapAkisi.tsx). */
export const GIZLI_HESAP_KAPALI = 'Gizli modda bulut yapay zekâ kapalı';
/** Telefon köprüsü: şifrelenen şey içerik (shared/kopru-sifre.ts — ECDH P-256 → HKDF-SHA256 → AES-256-GCM; anahtarlar uçlarda). Köprü meta veriyi
 *  (cihaz/bilgisayar adı, kimlikler, zamanlama, eşleşme kodu) görür; bu yüzden "yalnız" denmez (T34b düzeltme turu 1). */
export const KOPRU_SIFRELI = 'içerik uçtan uca şifrelenir';
/** Hafıza nerede (Beyin → Hafıza; nerede.ts NEREDE_FUBER_CUMLESI ile aynı gerçek): kayıtlar yerel veritabanında, bulut yanıtında soru ve ilgili notlar gider. */
export const HAFIZA_NEREDE_IS = 'Hafıza bu bilgisayarda durur; Bulut seçiliyken sorduğun şey ve ilgili notlar yanıt için bağladığın bulut yapay zekâya gider.';
export const HAFIZA_NEREDE_GEL = 'Hafıza bu bilgisayardaki veritabanında durur; bulut motoru seçiliyken soru ve ilgili notlar yanıt için o motora gider.';
