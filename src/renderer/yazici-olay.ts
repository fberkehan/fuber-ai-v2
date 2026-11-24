// Pencere içi olay: sohbetin yazı alanına metin yazar (gönderilmez; kullanıcı Enter'a basar). Tanıtım turunun son durağı ("Yarın sabah için bir
// hatırlatıcı kur") yayınlar, yazı alanı (bilesenler/Sohbet.tsx Yazici) dinler; ikisi birbirini içe aktarmaz.
export const YAZICIYA_YAZ = 'fuber:yaziciya-yaz';

/** Yazı alanına `metin` yazdırır (yazılmış bir taslak varsa ezilmez — dinleyen karar verir). */
export function yaziciyaYaz(metin: string): void {
  dispatchEvent(new CustomEvent(YAZICIYA_YAZ, { detail: metin }));
}
