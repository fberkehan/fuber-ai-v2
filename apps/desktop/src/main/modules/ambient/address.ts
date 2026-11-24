// Seslenme algılama: gün boyu dinlenen konuşmada asistana mı sesleniliyor, yoksa ondan mı söz ediliyor?
// Fuber AI 1'in `shared/seslenme.ts` dosyasından alındı; tek fark asistanın adının sabit değil, parametre olması
// (v2'de ad politikadan gelir). Karar kurala dayalıdır (Türkçe dilbilgisi), modele bırakılmaz: v1 ölçümünde yerel
// model bu kararda kararsızdı (8 örnekte 4–5 doğru).
//  • Adın EKSİZ hâli seslenme adayıdır ("ee Jarvis", "Jarvis nasılsın"); EKLİ hâli ondan söz etmektir
//    ("Jarvis'e sordum", "jarvisten", "Jarvis’in sesi").
//  • İkinci tekil kişi (nasılsın, mısın, emir: hatırlat/söyle/bak) ya da cümle başı/ünlem → seslenme.
//  • Eksiz ad + üçüncü kişi geçmiş/şimdiki zaman ("Jarvis iyi cevap verdi") → büyük olasılıkla söz etme (belirsiz).
//  • Adla karışan sözcükler ayrıca verilir ("fiber internet" Fuber'e seslenme değildir).

export type AddressVerdict = 'addressed' | 'unclear' | 'not';

export interface AddressResult {
  verdict: AddressVerdict;
  /** Ad (ekli ya da eksiz) cümlede geçiyor mu. */
  named: boolean;
  secondPerson: boolean;
  /** Tanı için kısa neden. */
  why: string;
}

export interface AddressNames {
  /** Adın küçük harfli yazımları ve Whisper'ın çıkardığı yanlış yazımlar: `['jarvis', 'carvis', 'çarvis']`. */
  names: string[];
  /**
   * Adla aynı yazılan başka sözcükler: yazım → yanında geçince "ad değil" dedirten sözcükler
   * (`{ fiber: ['internet', 'optik', 'kablo'] }`).
   */
  falseFriends?: Record<string, string[]>;
}

/** Whisper'ın "Jarvis" için ürettiği yazımlar (KURGU §5.2 madde 8) ve Türkçe söyleyişleri. */
const KNOWN_VARIANTS: Record<string, string[]> = {
  jarvis: ['jarvis', 'carvis', 'cervis', 'çarvis', 'jarvıs', 'carvıs', 'jarviz', 'carviz'],
  fuber: ['fuber', 'fiber', 'füber', 'fubır', 'fubir', 'fubar', 'fubur'],
};
const KNOWN_FALSE_FRIENDS: Record<string, Record<string, string[]>> = {
  fuber: {
    fiber: ['internet', 'interneti', 'optik', 'kablo', 'kablosu', 'altyapı', 'altyapısı', 'bağlantı', 'bağlantısı', 'hat', 'hattı', 'modem', 'ağ', 'ağı', 'lif', 'kumaş', 'paket', 'paketi', 'abonelik'],
  },
};

const lower = (text: string) => text.replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase();

/** Asistanın adından yazım kümesi kurar: bilinen ad için hazır liste, bilinmeyen için adın kendisi. */
export function addressNames(assistantName: string, extra: string[] = []): AddressNames {
  const base = lower(assistantName.trim());
  const names = [...new Set([...(KNOWN_VARIANTS[base] ?? [base]), ...extra.map(lower)])].filter(Boolean);
  const falseFriends = KNOWN_FALSE_FRIENDS[base];
  return { names, ...(falseFriends ? { falseFriends } : {}) };
}

const INTERJECTIONS = new Set(['ee', 'e', 'eee', 'hey', 'ey', 'hay', 'hadi', 'haydi', 'bak', 'yahu', 'abi', 'oğlum', 'hocam', 'ya', 'yav', 'lan', 'aa', 'şey', 'peki', 'tamam', 'evet', 'hayır', 'selam', 'merhaba', 'günaydın', 'naber', 'iyi', 'pardon']);
const SECOND_PERSON_WORDS = new Set(['sen', 'sana', 'seni', 'senin', 'sende', 'senden', 'senle', 'naber', 'nasılsın', 'lütfen', 'bana']);
const IMPERATIVES = new Set(['hatırlat', 'söyle', 'bak', 'aç', 'kapat', 'anlat', 'bul', 'göster', 'oku', 'ara', 'yaz', 'gönder', 'kur', 'sor', 'ekle', 'sil', 'çal', 'dinle', 'kaydet', 'özetle', 'hazırla', 'planla', 'düzelt', 'yap', 'söylesene', 'baksana', 'dur', 'sus', 'kes', 'başla', 'gel']);
const THIRD_PERSON_TENSE = /(dı|di|du|dü|tı|ti|tu|tü|yor|mış|miş|muş|müş|acak|ecek|ıyor|iyor|uyor|üyor)$/;
const SECOND_PERSON_SUFFIX = /(sın|sin|sun|sün|sınız|siniz|mısın|misin|musun|müsün|sanız|seniz)$/;
const REPLY_OPENERS = /^(evet|hayır|yok|tamam|tamamdır|olur|peki|teşekkürler|teşekkür|sağ|sağol|eyvallah|hı|hıhı|aynen|harika|süper|kur|ekle|yap|hatırlat)$/;

function words(text: string): string[] {
  return lower(text)
    .replace(/[“”"«»()[\]{}…!?.,;:–—-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Bir sözcük adın EKSİZ hâli mi, EKLİ hâli mi, hiç değil mi? */
export function nameForm(word: string, names: AddressNames): 'bare' | 'suffixed' | null {
  const normalized = lower(word).replace(/[’`´]/g, "'");
  const [root = '', suffix] = normalized.split("'");
  if (names.names.includes(root)) return suffix ? 'suffixed' : 'bare';
  // Kesmesiz yazıya döküm: "jarvise", "jarvisten", "jarvisin".
  for (const name of names.names) {
    if (normalized.startsWith(name) && normalized.length > name.length && normalized.length <= name.length + 5) return 'suffixed';
  }
  return null;
}

export function analyzeAddress(line: string, names: AddressNames): AddressResult {
  const list = words(line);
  const question = /\?\s*$/.test(line.trim()) || list.some((word) => /^(mı|mi|mu|mü|mısın|misin|musun|müsün)$/.test(word));
  const secondPerson = list.some(
    (word) => SECOND_PERSON_WORDS.has(word) || IMPERATIVES.has(word) || (word.length > 4 && SECOND_PERSON_SUFFIX.test(word) && !names.names.includes(word)),
  );
  let bareAt = -1;
  let suffixed = false;
  list.forEach((word, index) => {
    const form = nameForm(word, names);
    if (form === 'suffixed') suffixed = true;
    if (form === 'bare' && bareAt < 0) {
      const friends = names.falseFriends?.[word];
      if (friends && (friends.includes(list[index + 1] ?? '') || friends.includes(list[index - 1] ?? ''))) return;
      bareAt = index;
    }
  });
  if (bareAt < 0) {
    return { verdict: 'not', named: suffixed, secondPerson, why: suffixed ? 'ad ekli (ondan söz ediliyor)' : 'ad yok' };
  }
  const before = list.slice(0, bareAt);
  const leading = before.every((word) => INTERJECTIONS.has(word));
  const trailing = bareAt === list.length - 1;
  const after = list.slice(bareAt + 1);
  const thirdPerson = after.some((word) => THIRD_PERSON_TENSE.test(word)) && !secondPerson;
  if (leading && (secondPerson || question || after.length === 0 || !thirdPerson)) {
    return { verdict: 'addressed', named: true, secondPerson, why: 'ad cümle başında' };
  }
  if (trailing && (question || secondPerson || before.length <= 6)) return { verdict: 'addressed', named: true, secondPerson, why: 'ad cümle sonunda' };
  if (secondPerson) return { verdict: 'addressed', named: true, secondPerson, why: 'ikinci kişi + eksiz ad' };
  if (thirdPerson) return { verdict: 'unclear', named: true, secondPerson, why: 'üçüncü kişi: büyük olasılıkla söz ediliyor' };
  return { verdict: 'unclear', named: true, secondPerson, why: 'eksiz ad, ipucu yok' };
}

/**
 * Asistan az önce konuştuysa adsız bir satır ona yanıt olabilir; ama YALNIZ doğrudan bir yanıt sözcüğüyle başlıyorsa
 * ("evet, kur", "tamam olur", "teşekkürler"). İkinci kişi eki ya da soru yetmez: "pencereyi açar mısın" yandakine de
 * söylenir (v1 sınamasında böyle bir cümle yanlışlıkla asistana sayılmıştı).
 */
export function isFollowUp(line: string, lastSpokeAt: number, now: number, names: AddressNames, windowMs = 12_000): boolean {
  if (now - lastSpokeAt > windowMs) return false;
  const result = analyzeAddress(line, names);
  if (result.verdict === 'not' && result.named) return false; // "Jarvis'e söyledim": başkasına anlatıyor
  return REPLY_OPENERS.test(words(line)[0] ?? '');
}
