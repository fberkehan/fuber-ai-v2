/**
 * Anahtar sözcük sezicinin duyarlık profilleri ve kalibrasyonun profil seçimi. Yalnız veri ve saf işlev içerir:
 * ses işçisi (sezici) ve ana süreç (kalibrasyon, tanı) aynı dosyayı kullanır.
 */

/** Sezicinin duyarlığı: eşik (düşük = kolay tetiklenir), söz yoluna destek puanı, izlenen yol sayısı. */
export interface KwsTuning {
  threshold: number;
  boost: number;
  paths: number;
}

export interface KwsProfile extends KwsTuning {
  id: 'standard' | 'sensitive';
}

/**
 * Duyarlık profilleri, az duyarlıdan çok duyarlıya. Kalibrasyon, kullanıcının örneklerini yakalayan EN AZ duyarlı
 * profili seçer; kalibrasyon yoksa `standard` yürürlüktedir.
 *
 * Yol sayısı Fuber AI 1'den alınan derstir (v1 `shared/uyandirma-ayar.ts`: "YOL 8, varsayılan 4 değil: akışta kısa
 * ömürlü dal budanınca söz kaçıyor; 4'te 15,5/20, 8'de 18/20"). Burada ölçüldü (`scripts/voice/kws-eval.mjs run
 * --paths … --boost …`, 16 Kas 2026; 162 sentetik Türkçe uyandırma örneği, 14,4 dk uyandırma sözü içermeyen konuşma;
 * yazımlar "hey jarvis" + "hey charvis"):
 *
 *   yol  destek  eşik   doğru uyanma     yanlış uyanma (14,4 dk)
 *   4    1,5     0,15    90/162 (%56)    0     ← demo.1
 *   4    2,0     0,10    98/162 (%60)    0
 *   8    1,5     0,15   125/162 (%77)    0     ← standard
 *   8    1,5     0,10   130/162 (%80)    0     ← sensitive
 *   8    1,5     0,05   130/162 (%80)    0     (0,10'dan fazlasını getirmiyor)
 *   8    2,0     0,10   133/162 (%82)    1     (alınmadı: destek artınca yanlış uyanma başlıyor)
 *   8    2,0     0,05   136/162 (%84)    1
 *
 * Ölçüm tek bir sentetik konuşmacının çeşitlemeleridir; GERÇEK İNSAN SESİ İÇİN KANIT DEĞİLDİR.
 */
export const KWS_PROFILES: readonly [KwsProfile, ...KwsProfile[]] = [
  { id: 'standard', threshold: 0.15, boost: 1.5, paths: 8 },
  { id: 'sensitive', threshold: 0.1, boost: 1.5, paths: 8 },
];

export const DEFAULT_KWS_PROFILE: KwsProfile = KWS_PROFILES[0];

export const kwsProfile = (id: string | null | undefined): KwsProfile | null => KWS_PROFILES.find((profile) => profile.id === id) ?? null;

/**
 * Kalibrasyon örneklerinden profil seçer. `hits`: her örnek için o örneği yakalayan profillerin kimlikleri.
 * Örneklerin en az üçte ikisini yakalayan en az duyarlı profil seçilir; hiçbiri o kadarını yakalamıyorsa en çok
 * yakalayan (eşitlikte daha duyarlı olan: sezici bu sesi zor duyuyor demektir). `caught`: seçilen profilin
 * yakaladığı örnek sayısı.
 */
export function chooseKwsProfile(hits: string[][]): { profile: KwsProfile; caught: number } {
  const need = Math.max(1, Math.ceil((hits.length * 2) / 3));
  const counts = KWS_PROFILES.map((profile) => ({ profile, caught: hits.filter((sample) => sample.includes(profile.id)).length }));
  const enough = counts.find((item) => item.caught >= need);
  if (enough) return enough;
  let best = counts[0] ?? { profile: DEFAULT_KWS_PROFILE, caught: 0 };
  for (const item of counts) if (item.caught >= best.caught) best = item;
  return best;
}

/**
 * Kayıtlı kalibrasyondan yürürlükteki duyarlık. Profil yazılıysa odur. Profil alanı olmayan eski kalibrasyonda
 * (demo.1) örneklere bakılır: sezici örneklerin üçte ikisinden azını yakalamışsa (kalanını Whisper yolu yakalamış)
 * duyarlı profil, değilse olağan profil. Böylece kullanıcı kalibrasyonu yinelemeden de ölçümünden yararlanır.
 */
export function tuningForCalibration(
  wake: { profile?: string; samples?: Array<{ paths: string[] }> } | null,
): KwsProfile {
  const saved = kwsProfile(wake?.profile);
  if (saved) return saved;
  const samples = wake?.samples ?? [];
  if (samples.length === 0) return DEFAULT_KWS_PROFILE;
  const caught = samples.filter((sample) => sample.paths.includes('kws')).length;
  return caught * 3 < samples.length * 2 ? (KWS_PROFILES.at(-1) ?? DEFAULT_KWS_PROFILE) : DEFAULT_KWS_PROFILE;
}
