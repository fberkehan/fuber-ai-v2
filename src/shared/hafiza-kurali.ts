// ── Hafıza yazım kuralları (11 Kas analizi #1–#4, #7, #12; saf, birim testli: tests/hafiza-kurali.test.ts) ──────────────────────────────────
// Analiz: yazıcı her turda kayıt ekliyor, `sabit:true`yu gelişigüzel veriyor ("Kahve şart" çekirdeğe girdi), yerel yolda modelin yanlış cevaplarını
// ve "aracım yok" cümlelerini olgu diye yazıyor, 2. günde söylenen rapor biçimi hiç kaydedilmiyordu. Model kararını DENETLEYEN kurallar burada:
//  · ÇEKİRDEK yalnız kullanıcının AÇIK sözünden: "hep / her zaman / bundan sonra …", "X deme / koyma / yazma …", "… sevmiyorum". Kural tabanlıdır,
//    modelden geçmez; kendiliğinden turlardan ya da model çıktısından asla doğmaz (`acikTercih`).
//    "bilmen gereken" de tercihtir (ör. "glütensiz besleniyorum": her öneride geçerli).
//  · Açık olgu işaretleri ("aklında olsun", "unutma", "not al"): kullanıcının cümlesi aynen, çekirdek DEĞİL (`acikOlgu`).
//  · Öz-konuşma süzgeci: "Fuber'in erişimi yok / yapamaz" türü kayıt reddedilir (`ozKonusmaMi`).
//  · Model iddiası: kullanıcının yazmadığı yüzde/para tutarı olgu diye kaydedilmez (`modelIddiasiMi`).
//  · Yakın kopya: kök kümelerinin örtüşmesi (`benzerlik`; analizin ölçüsü, köklerle). Aynı konu yeni tarih/sayıyla gelirse yeni söz kazanır (`celisirMi`).
import { kokKumesi } from './tr-kok.ts';

/** Karşılaştırma için sadeleştirme (hafiza/normal.ts sadelestir ile aynı kural; shared'de bağımsız kopya — main'e bağlanmasın). */
const HARITA: Record<string, string> = { ı: 'i', ş: 's', ğ: 'g', ü: 'u', ö: 'o', ç: 'c', â: 'a', î: 'i', û: 'u' };
export const sade = (s: string): string => s.toLocaleLowerCase('tr-TR').replace(/[ışğüöçâîû]/g, (h) => HARITA[h] ?? h).normalize('NFKD').replace(/[̀-ͯ]/g, '');

/** Kural tabanlı kayıtların kalıp önekleri: benzerliği şişirmesin (iki ayrı tercih yalnız önek yüzünden "aynı" sayılmasın). */
const KALIP = /(tercih|not): |kullanıcının açık isteği \(her zaman uygula\): |kullanıcı söyledi: /giu;

/** Benzerlik için kök kümesi (kalıp önekleri düşer). Çok sayıda karşılaştırmada bir kez hesaplanır (hafiza/depo.ts hafizaBuda). */
export const benzerlikKumesi = (m: string): Set<string> => kokKumesi(sade(m.replace(KALIP, ' ')));

/** İki kök kümesinin benzerliği (0–1): ortak kök / küçük kümenin boyu. */
export function kumeBenzerligi(x: Set<string>, y: Set<string>): number {
  if (!x.size || !y.size) return 0;
  let ortak = 0;
  for (const w of x) if (y.has(w)) ortak++;
  return ortak / Math.min(x.size, y.size);
}

/** İki metnin benzerliği (0–1): ortak kök / küçük kümenin boyu. Analizin (sim-ay.ts) ölçüsünün köklü hâli. */
export const benzerlik = (a: string, b: string): number => kumeBenzerligi(benzerlikKumesi(a), benzerlikKumesi(b));

/** Yazıcının kayıt eklerken uyguladığı eşikler: üstü atlanır; arası mevcut kayıt GÜNCELLENİR (yeni söz kazanır). */
export const BENZER_ATLA = 0.9;
export const BENZER_BIRLESTIR = 0.7;
/** Gece budamasının yakın kopya eşiği (daha temkinli: yalnız neredeyse aynı kayıtlar birleşir). */
export const BUDAMA_BIRLESTIR = 0.8;
/** Çekirdekte en çok kaç sabit kayıt (yeniler önce; fazlası sabitten iner, silinmez). */
export const SABIT_TAVANI = 12;
/** Canlı kayıt bütçesi: aşılırsa en düşük değerli, kullanıcıdan gelmeyen kayıtlar arşivlenir (silinmez, geri alınabilir). */
export const CANLI_KAYIT_BUTCESI = 400;

/** "Fuber yapamaz / erişimi yok / aracım yok" türü öz-konuşma: hafızaya yazılmaz (analiz #3: yerel yazıcı bunu sabit kural yapıyordu). */
export function ozKonusmaMi(metin: string): boolean {
  const s = sade(metin);
  return /\b(fuber|asistan|ben)\b[^.]{0,60}\b(erisim\w*|yetki\w*|arac\w*)\b[^.]{0,30}\b(yok|bulunmuyor|mevcut degil)/.test(s)
    || /\berisim(im|i)? (yok|bulunmuyor|mevcut degil)|\barac(im|lar\w*)? (yok|erisim)/.test(s)
    || /\b(fuber|asistan)\b[^.]{0,40}\b(yapamaz|gonderemez|kuramaz|erisemez|bakamaz|yazamaz)\b/.test(s)
    || /\btek basina calis(iyor|iyorum)\b/.test(s)
    || /^merak sorusu\b/.test(s);
}

/** Kullanıcının yazmadığı bir yüzde ya da para tutarı içeriyor mu (modelin hesap/yorum iddiası; analiz #3: "kâr marjı %25" kaydı). */
export function modelIddiasiMi(icerik: string, kullaniciMetni: string): boolean {
  const k = sade(kullaniciMetni).replace(/\s+/g, '');
  const sayilar = sade(icerik).match(/%\s?\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)*\s?(?:tl|lira|usd|eur|\$|€)/g) ?? [];
  return sayilar.some((x) => !k.includes(x.replace(/\s+/g, '').replace(/(tl|lira|usd|eur|\$|€)$/, '')));
}

/** Tercih/kural bildiren olumsuz emirler (yalnız fiil kökleri; "görüşme", "toplama" gibi adlar karışmasın diye kapalı liste). */
const OLUMSUZ_EMIR = /\b(deme|yapma|koyma|yazma|gonderme|ekleme|kullanma|olma|sorma|soyleme|onerme|uzatma|hitap etme|cagirma|arama)\b/;
const TERCIH_ISARETI = /\b(hep|her zaman|daima|bundan sonra|bundan boyle|asla|hicbir zaman|her seferinde)\b|\b(sevmiyorum|sevmem|istemiyorum|tercih ederim|tercihim|bilmen gereken|bilmeni isterim)\b/;
const OLGU_ISARETI = /\b(aklinda olsun|aklinda tut|unutma|not al|not et|kaydet)\b/;

export interface AcikSoz { tur: 'tercih' | 'bilgi'; baslik: string; icerik: string; sabit: boolean; onem: number }

/** Metni cümlelere böler (tırnak içi korunur, kaba). */
const cumleler = (m: string): string[] => m.split(/(?<=[.!?…])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
const baslikYap = (s: string, onEk: string) => {
  const temiz = s.replace(/[“”"«»]/g, '').replace(/\s+/g, ' ').replace(/^(bir şey söyleyeyim|bir de|ayrıca|bu arada)[:,]?\s*/i, '').trim();
  const kisa = temiz.length > 60 ? `${temiz.slice(0, 60).replace(/\s+\S*$/, '')}…` : temiz.replace(/[.!]+$/, '');
  return `${onEk}: ${kisa}`;
};

/** Kullanıcının açık tercihi ya da kuralı (çekirdek adayı). Soru cümleleri ve Fuber'e yönelmeyen anlatılar tercih değildir. Yoksa null.
 *  İçerik kullanıcının İLGİLİ cümleleri AYNEN (model yeniden yazmaz; yasak söz "Murat Bey" gibi tırnaklı kalır: kural tam okunur). */
export function acikTercih(kullaniciMetni: string): AcikSoz | null {
  const ilgili = cumleler(kullaniciMetni).filter((c) => !/\?\s*$/.test(c) && (TERCIH_ISARETI.test(sade(c)) || OLUMSUZ_EMIR.test(sade(c))));
  if (!ilgili.length) return null;
  // "her pazartesi … hatırlat" bir hatırlatma isteğidir, tercih değil ("her" tek başına işaret sayılmaz; "her zaman" sayılır).
  if (ilgili.every((c) => /hatirlat|yapilacak|gorev ekle/.test(sade(c)) && !/\b(deme|koyma|yazma)\b/.test(sade(c)))) return null;
  const icerik = ilgili.join(' ').slice(0, 500);
  return { tur: 'tercih', baslik: baslikYap(ilgili[0], 'Tercih'), icerik: `Kullanıcının açık isteği (her zaman uygula): ${icerik}`, sabit: true, onem: 5 };
}

/** Kullanıcının "aklında olsun / unutma / not al" diye verdiği olgu (çekirdek değil). Soru cümleleri değil. Yoksa null. */
export function acikOlgu(kullaniciMetni: string): AcikSoz | null {
  const tum = cumleler(kullaniciMetni);
  const i = tum.findIndex((c) => OLGU_ISARETI.test(sade(c)) && !/\?\s*$/.test(c));
  if (i < 0) return null;
  const icerik = tum.join(' ').slice(0, 500);
  return { tur: 'bilgi', baslik: baslikYap(tum[i === 0 ? 0 : i - 1] ?? tum[i], 'Not'), icerik: `Kullanıcı söyledi: ${icerik}`, sabit: false, onem: 4 };
}

/** Kullanıcı metninden kural tabanlı açık sözler (önce tercih). Yerel yolda yazılan TEK şey budur; bulutta modelin yanında çalışır. */
export function acikSozler(kullaniciMetni: string): AcikSoz[] {
  const metin = kullaniciMetni.trim();
  if (metin.length < 8) return [];
  const t = acikTercih(metin);
  if (t) return [t];
  const o = acikOlgu(metin);
  return o ? [o] : [];
}

/** Tercih cümlelerinde konu taşımayan sık kökler (örtüşme sayılmaz). */
const TERCIH_DOLGU = new Set(['bana', 'hep', 'her', 'zaman', 'bundan', 'sonr', 'sonra', 'lutfen', 'olsun', 'yine', 'artik', 'yaz', 'ver', 'kullanicinin', 'acik', 'isteg', 'uygula', 'tercih', 'bir', 'daha', 'icin']);
const sayilar = (s: string) => new Set(sade(s).match(/\d+(?:[.,:]\d+)?/g) ?? []);
/** İki tercih AYNI konuda mı (yeni söz eskisinin yerini alır): konu kökleri en az iki ortak VE sayılar farklı ya da örtüşme yüksek.
 *  "raporları en fazla 5 madde ver" → "bundan sonra en fazla 3 madde ver" aynı konu; "toplantı koyma" ile "Murat de" değil. */
export function ayniTercihMi(eski: { baslik: string; icerik: string }, yeni: { baslik: string; icerik: string }): boolean {
  const k = (h: { baslik: string; icerik: string }) => new Set([...benzerlikKumesi(h.icerik)].filter((w) => !TERCIH_DOLGU.has(w) && !/^\d+$/.test(w)));
  const a = k(eski);
  const b = k(yeni);
  let ortak = 0;
  for (const w of a) if (b.has(w)) ortak++;
  if (ortak < 2) return false;
  const sa = sayilar(eski.icerik);
  const sb = sayilar(yeni.icerik);
  const sayiFarki = sa.size > 0 && sb.size > 0 && [...sb].some((x) => !sa.has(x));
  return sayiFarki || ortak / Math.max(1, Math.min(a.size, b.size)) >= 0.5;
}

/** Aynı konunun YENİ hâli mi: başlıklar benzer ama tarih/sayı farklı ("İzmir açılışı 20 Kasım" → "4 Aralık"). Yeni söz kazanır. */
export function celisirMi(eski: { baslik: string; icerik: string }, yeni: { baslik: string; icerik: string }): boolean {
  if (benzerlik(eski.baslik, yeni.baslik) < 0.6) return false;
  const iz = (s: string) => new Set(sade(s).match(/\d+(?:[.,:]\d+)?|\b(ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik)\b/g) ?? []);
  const a = iz(eski.icerik);
  const b = iz(yeni.icerik);
  if (!a.size || !b.size) return false;
  return [...b].some((x) => !a.has(x));
}
