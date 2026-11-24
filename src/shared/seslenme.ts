// ── Seslenme algılama: gün boyu dinlenen konuşmada Fuber'e mi sesleniliyor? ─────────────────────────────────────
// Yalnız "hey Fuber" değil, "ee Fuber nasılsın, nasıl gidiyor" gibi bir seslenmede de çağrıldığını anlaması
// gerekir. Yerel modelle sınama (19 Eki 2026) bu kararda kararsızdı (8 örnekte 4-5 doğru); türü (gündelik/görev/kod/
// önemli) ise iyi buluyordu. Bu yüzden KARAR kurala dayalı (Türkçe dilbilgisi), tür yerel modelde:
//  • Adın EKSİZ hâli seslenme adayıdır ("ee Fuber", "Fuber nasılsın"); EKLİ hâli ondan söz etmektir
//    ("Fuber'e sordum", "fuberden", "Fuber’in sesi").
//  • İkinci tekil kişi (nasılsın, mısın, emir: hatırlat/söyle/bak) ya da cümle başı/ünlem → seslenme.
//  • Eksiz ad + üçüncü kişi geçmiş/şimdiki zaman ("Fuber iyi cevap verdi") → büyük olasılıkla söz etme (belirsiz).
//  • "fiber internet / optik / kablo" seslenme değildir.
// Saf modül: çalışma anı içe aktarması yok.

export type SeslenmeKarari = 'seslenme' | 'belirsiz' | 'degil';
export interface SeslenmeSonucu { karar: SeslenmeKarari; ad: boolean; ikinciKisi: boolean; neden: string }

const AD = new Set(['fuber', 'fiber', 'füber', 'fubır', 'fubir', 'fubar', 'fubur', 'fuberai', 'fuber.ai']);
const ADLAR = ['fuber', 'fiber', 'füber', 'fubır', 'fubir', 'fubar', 'fubur'];
const UNLEM = new Set(['ee', 'e', 'eee', 'hey', 'ey', 'hay', 'hadi', 'haydi', 'bak', 'yahu', 'abi', 'oğlum', 'hocam', 'ya', 'yav', 'lan', 'aa', 'şey', 'peki', 'tamam', 'evet', 'hayır', 'selam', 'merhaba', 'günaydın', 'naber', 'iyi', 'pardon']);
const FIBER_DEGIL = new Set(['internet', 'interneti', 'optik', 'kablo', 'kablosu', 'altyapı', 'altyapısı', 'bağlantı', 'bağlantısı', 'hat', 'hattı', 'modem', 'ağ', 'ağı', 'lif', 'kumaş', 'paket', 'paketi', 'abonelik']);
const IKINCI_KISI_SOZ = new Set(['sen', 'sana', 'seni', 'senin', 'sende', 'senden', 'senle', 'naber', 'nasılsın', 'lütfen', 'bana']);
const EMIR = new Set(['hatırlat', 'söyle', 'bak', 'aç', 'kapat', 'anlat', 'bul', 'göster', 'oku', 'ara', 'yaz', 'gönder', 'kur', 'sor', 'ekle', 'sil', 'çal', 'dinle', 'kaydet', 'özetle', 'hazırla', 'planla', 'düzelt', 'yap', 'söylesene', 'baksana', 'dur', 'sus', 'kes', 'başla', 'gel']);
const ucuncuKisiGecmis = /(dı|di|du|dü|tı|ti|tu|tü|yor|mış|miş|muş|müş|acak|ecek|ıyor|iyor|uyor|üyor)$/;
const ikinciKisiEk = /(sın|sin|sun|sün|sınız|siniz|mısın|misin|musun|müsün|sanız|seniz)$/;

const kucuk = (s: string) => s.replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase();

function kelimeler(metin: string): string[] {
  return kucuk(metin).replace(/[“”"«»()[\]{}…!?.,;:–—-]/g, ' ').split(/\s+/).filter(Boolean);
}

/** Bir sözcük adın EKSİZ hâli mi, EKLİ hâli mi, hiç değil mi? */
export function adBicimi(soz: string): 'eksiz' | 'ekli' | null {
  const s = soz.replace(/[’`´]/g, "'");
  const [kok, ek] = s.split("'");
  if (AD.has(kok)) return ek ? 'ekli' : 'eksiz';
  // Kesmesiz yazıya döküm: "fubere", "fuberden", "fiberin"
  for (const a of ADLAR) if (s.startsWith(a) && s.length > a.length && s.length <= a.length + 5) return 'ekli';
  return null;
}

export function seslenmeAnaliz(satir: string): SeslenmeSonucu {
  const k = kelimeler(satir);
  const soru = /\?\s*$/.test(satir.trim()) || k.some((x) => /^(mı|mi|mu|mü|mısın|misin|musun|müsün)$/.test(x));
  const ikinciKisi = k.some((x) => IKINCI_KISI_SOZ.has(x) || EMIR.has(x) || (x.length > 4 && ikinciKisiEk.test(x) && !AD.has(x)));
  let eksiz = -1, ekli = false;
  k.forEach((x, i) => {
    const b = adBicimi(x);
    if (b === 'ekli') ekli = true;
    if (b === 'eksiz' && eksiz < 0) {
      // "fiber internet" vb.
      if (x === 'fiber' && (FIBER_DEGIL.has(k[i + 1] ?? '') || FIBER_DEGIL.has(k[i - 1] ?? ''))) return;
      eksiz = i;
    }
  });
  if (eksiz < 0) return { karar: 'degil', ad: ekli, ikinciKisi, neden: ekli ? 'ad ekli (ondan söz ediliyor)' : 'ad yok' };
  const onceki = k.slice(0, eksiz);
  const basta = onceki.every((x) => UNLEM.has(x));
  const sonda = eksiz === k.length - 1;
  const sonraki = k.slice(eksiz + 1);
  const ucuncu = sonraki.some((x) => ucuncuKisiGecmis.test(x)) && !ikinciKisi;
  if (basta && (ikinciKisi || soru || sonraki.length === 0 || !ucuncu)) return { karar: 'seslenme', ad: true, ikinciKisi, neden: 'ad cümle başında' };
  if (sonda && (soru || ikinciKisi || onceki.length <= 6)) return { karar: 'seslenme', ad: true, ikinciKisi, neden: 'ad cümle sonunda' };
  if (ikinciKisi) return { karar: 'seslenme', ad: true, ikinciKisi, neden: 'ikinci kişi + eksiz ad' };
  if (ucuncu) return { karar: 'belirsiz', ad: true, ikinciKisi, neden: 'üçüncü kişi: büyük olasılıkla söz ediliyor' };
  return { karar: 'belirsiz', ad: true, ikinciKisi, neden: 'eksiz ad, ipucu yok' };
}

/** Fuber az önce konuştuysa adsız bir satır ona yanıt olabilir — ama YALNIZ doğrudan bir yanıt sözcüğüyle başlıyorsa
 *  ("evet, kur", "tamam olur", "teşekkürler"). İkinci kişi eki ya da soru yetmez: "pencereyi açar mısın" yandakine de
 *  söylenir (19 Eki testinde Fuber'in araya girmesinin ardından gelen böyle bir cümle yanlışlıkla Fuber'e sayıldı). */
export function devamMi(satir: string, sonKonusmaMs: number, simdi: number, pencere = 12_000): boolean {
  if (simdi - sonKonusmaMs > pencere) return false;
  const s = seslenmeAnaliz(satir);
  if (s.karar === 'degil' && s.ad) return false; // "Fuber'e söyledim" — başkasına anlatıyor
  const ilk = kelimeler(satir)[0] ?? '';
  return /^(evet|hayır|yok|tamam|tamamdır|olur|peki|teşekkürler|teşekkür|sağ|sağol|eyvallah|hı|hıhı|aynen|harika|süper|kur|ekle|yap|hatırlat)$/.test(ilk);
}
