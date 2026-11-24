/**
 * Sezicinin (İngilizce model) Türkçe söyleyişi de yakalaması için uyandırma sözünün ek yazımları.
 *
 * Model açık sözlüklüdür ama yalnız İngilizce parçaları bilir: "hey çarvis" yazılamaz, onun yerine o sese en yakın
 * İngilizce yazım ("hey charvis") verilir. Hangi yazımların işe yaradığı ÖLÇÜLDÜ (`scripts/voice/kws-eval.mjs`,
 * 17 Kas 2026): sentetik Türkçe ses (Piper tr_TR-dfki; üç hız × üç perde × iki gürültü düzeyi), 162 uyandırma örneği
 * ("Hey Carvis / Çarvis / Jarvis / Carvıs / Carviz / Cervis" ve komutlu üç cümle) + 14,4 dk uyandırma sözü içermeyen
 * konuşma (içinde "Hey Çağrı", "çay servisi", "Hey Cavit", "Carvin", "jarse" gibi benzeşen 20 cümle).
 *
 *   yazımlar                         eşik   doğru uyanma     yanlış uyanma (14,4 dk)
 *   hey jarvis                       0,25    61/162 (%38)    0        ← T3a
 *   hey jarvis                       0,15    75/162 (%46)    0
 *   hey jarvis + hey charvis         0,20    87/162 (%54)    0
 *   hey jarvis + hey charvis         0,15    90/162 (%56)    0        ← seçilen
 *   hey jarvis + hey charvis         0,10    91/162 (%56)    0
 *   + hay jarvis, jarviss, javis     0,15    81/162 (%50)    0        (çok yazım zarar veriyor; ilk ölçüm kümesinde)
 *
 * "Hey Çarvis" söyleyişi "hey charvis" olmadan 0/18, onunla 15/18 tetikleniyor. Tek başına hiç tetiklenmeyen
 * yazımlar ("hey jarvees", "hey carvis", "hey jarviz", "hey djarvis", "hey jervis"…) listeye alınmadı: modelin
 * görmediği parça dizilerinin akustik olasılığı çok düşük kalıyor. Sezicinin kaçırdığını uyandırmanın Whisper
 * yolu yakalar. Ölçüm tek bir sentetik konuşmacının çeşitlemeleridir; GERÇEK İNSAN SESİ İÇİN KANIT DEĞİLDİR:
 * kullanıcının kendi sesi için kurulumdaki kalibrasyon eşiği yeniden ayarlar.
 *
 * Dur-sözcükleri ("sus", "dur", "yeter") için de denendi: sezici bunları en iyi durumda 5/45 yakaladı ve 13,8 dk'da
 * 2–4 kez yanlış tetiklendi. Kullanılmıyor; dur-sözcüğü kararı VAD + dökümle verilir (`session.ts` › `onSpeechBlip`).
 */

export interface WakeVariant {
  /** Sezicinin sözlüğüyle yazılabilen İngilizce yazım. */
  spelling: string;
  /** Duyulunca hangi uyandırma sözü duyulmuş sayılacak (politikadaki yazımıyla). */
  phrase: string;
}

type Rule = (prefix: string[], name: string) => string | null;

/**
 * Ölçümde yanlış uyanma getirmeden doğru uyanmayı artıran dönüşümler. Şu an tek kural var: çok yazım vermek
 * zarar veriyor (seziciyi dört etkin yolla sınırlı tutuyoruz; yazımlar birbirinin yolunu kesiyor). "hay jarvis",
 * "hey jarviss" ve "hey javis" tek tek biraz tetiklendi ama birlikte verilince toplam doğru uyanma DÜŞTÜ.
 */
const RULES: Rule[] = [
  // "ç" ile söyleyiş ("çarvis"): İngilizcede "ch". Bu yazım olmadan "Hey Çarvis" hiç tetiklenmiyor.
  (prefix, name) => (/^j/.test(name) ? [...prefix, name.replace(/^j/, 'ch')].join(' ') : null),
];

/** Politikadaki uyandırma sözlerinden sezicinin ek yazımlarını üretir. */
export function wakeVariants(phrases: string[]): WakeVariant[] {
  const out: WakeVariant[] = [];
  const seen = new Set(phrases.map((phrase) => phrase.trim().toLowerCase()));
  for (const phrase of phrases) {
    const words = phrase.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const name = words.pop();
    if (!name || !/^[a-z]+$/.test(name)) continue;
    for (const rule of RULES) {
      const spelling = rule(words, name);
      if (!spelling || seen.has(spelling)) continue;
      seen.add(spelling);
      out.push({ spelling, phrase });
    }
  }
  return out;
}
