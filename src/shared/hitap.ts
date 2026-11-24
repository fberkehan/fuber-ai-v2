// Hitap: kullanıcı "Hitap" alanına yalnız unvan yazabilir ("Bey", "Hanım"). Hata: hitap alanına "Bey" yazılınca asistan
// yalnız "Bey" diyordu, "Deniz Bey" demesi gerekirdi. → Unvan tek başına yazıldıysa adla birleştirilir; tam bir ifade
// ("Hocam", "Deniz Bey", "Patron") yazıldıysa aynen kullanılır. Kişilik istemi, kokpit selamı ve çekirdek hafıza
// HEP bu fonksiyondan geçer.
const SONA = /^(bey|hanım|hanim|efendi|hanımefendi|beyefendi)$/i;
const BASA = /^(bay|bayan|sayın)$/i;

const buyuk = (s: string) => s.charAt(0).toLocaleUpperCase('tr-TR') + s.slice(1);

export function hitapMetni(ad: string, hitap: string): string {
  const a = (ad ?? '').trim();
  const h = (hitap ?? '').trim();
  if (!h) return a;
  const ilkAd = a.split(/\s+/)[0] ?? '';
  if (SONA.test(h)) return ilkAd ? `${ilkAd} ${buyuk(h.toLocaleLowerCase('tr-TR').replace('hanim', 'hanım'))}` : buyuk(h);
  if (BASA.test(h)) return a ? `${buyuk(h.toLocaleLowerCase('tr-TR'))} ${a}` : buyuk(h);
  return h;
}

// ── Kurulumda "siz" ya da "sen" (0.13.1) ──────────────────────────────────────────────────────────────────────────────────────────────
// Kurulum "sen" konuşur. Yalnız kullanıcı resmî bir hitap seçtiyse (Bey, Hanım, Hocam…) örnek cümleler (önizleme) ve Hazırsın başlığı "siz"e
// geçer: "Deniz Bey, toplantınız 10 dakika sonra." Hitapsız ("Sadece adımla") ve serbest, resmî olmayan hitap ("Patron", "abi") "sen" kalır.
// Bütün kurulumu çevirmez: yalnız bu cümleler `hitapliCumle` ile seçilir.
const SIZ_HITABI = /(^|\s)(bey|hanım|hanim|hanımefendi|beyefendi|efendi|bay|bayan|sayın|hocam|hoca)(\s|$)/i;

/** Hitap resmî mi (kurulum metinleri "siz" konuşur)? Boş hitap "sen" demektir. */
export function sizliMi(hitap: string | null | undefined): boolean {
  return SIZ_HITABI.test((hitap ?? '').trim());
}

/** Hitaba göre iki söz arasından seçer: resmî hitapta `siz`, değilse `sen`. */
export function hitapliCumle(hitap: string | null | undefined, siz: string, sen: string): string {
  return sizliMi(hitap) ? siz : sen;
}
