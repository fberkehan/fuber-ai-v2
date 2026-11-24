// ── Toplantı: Gemini ile yazıya çevirme — kullanıcının KENDİ anahtarıyla (14 Kas 2026, 0.18.2; saf, Electron'suz — tests/gemini-yazi.test.ts) ──────────────────────────────
// Gemini'nin ücretsiz API'si değerlendirildi. Resmî sayfalar (ai.google.dev → aistudio.google.com/docs, 14 Kas 2026) şunu söyler:
//  · Ücretsiz katman VAR (Live API dahil), ama ücretsiz katmanda içerik "Google'ın ürünlerini geliştirmek için kullanılır" ve insan gözden geçirenler girdileri okuyabilir;
//    ücretli katmanda kullanılmaz. Şartlar: AB/BK/İsviçre'de API istemcisi sunan yalnız ücretli hizmet kullanmalı. → Fuber'in "ses ve metin eğitimde kullanılmaz" sözüyle
//    çelişir; bu yüzden SUNUCUDA paylaşılan ücretsiz anahtar OLMAZ. Yalnız kullanıcı KENDİ anahtarını girerse ve bunun ne anlama geldiğini okuyarak seçerse kullanılır.
//  · Yol: toplu `generateContent` (ses 16 kHz WAV, satır içi; en çok 20 MB; ses 32 jeton/sn). Gerçek zamanlı Live API bu sürümde YOK: anahtarla doğrudan WebSocket ve
//    ücretsiz katman kotası (proje başına) belgelenmemiş; güvenilir ölçemeden eklenmedi. Gizli / "Yalnız bu bilgisayar"da Gemini hiç kullanılmaz (P14).
export const GEMINI_TABAN = 'https://generativelanguage.googleapis.com/v1beta';
/** Ücretsiz katmanı olan, ses girdisini destekleyen hızlı model (resmî fiyat sayfası: Gemini 2.5 Flash). */
export const GEMINI_MODEL = 'gemini-2.5-flash';
/** Seçmeden önce gösterilen açık söz (kısa, mutlak değil). */
export const GEMINI_UYARISI = 'Gemini seçilirse toplantı sesi Google’a gider. Ücretsiz (faturasız) projelerde Google bu sesi ürünlerini geliştirmek için kullanabilir ve insanlar gözden geçirebilir; faturalı projede kullanmaz. Fuber anahtarı bu bilgisayarda şifreli tutar.';

/** Google API anahtarı: "AIza" ile başlar, 35–45 karakter, boşluksuz (biçim denetimi; geçerlilik Google'da). */
export function geminiAnahtariGecerli(k: unknown): k is string { return typeof k === 'string' && /^AIza[0-9A-Za-z_-]{30,50}$/.test(k.trim()); }

export type GeminiNedeni = 'anahtar' | 'kota' | 'ag' | 'engel' | 'bilinmeyen';
export class GeminiHatasi extends Error {
  readonly neden: GeminiNedeni;
  constructor(neden: GeminiNedeni, ayrinti = '') { super(`Gemini ${neden}${ayrinti ? `: ${ayrinti}` : ''}`); this.neden = neden; this.name = 'GeminiHatasi'; }
}
/** HTTP durumundan neden (gövde okunmaz: anahtarı yankılayabilir). */
export function geminiDurumNedeni(status: number): GeminiNedeni {
  if (status === 400 || status === 401 || status === 403) return 'anahtar';
  if (status === 429) return 'kota';
  if (status >= 500) return 'ag';
  return 'bilinmeyen';
}

const ISTEM = 'Transcribe this audio verbatim, in the language(s) spoken. Output ONLY the transcript text, no quotes, no commentary, no timestamps. If there is no clear speech, output nothing.';
/** generateContent gövdesi: ses satır içi (base64 WAV). */
export function geminiGovde(wavBase64: string): unknown {
  return { contents: [{ parts: [{ text: ISTEM }, { inline_data: { mime_type: 'audio/wav', data: wavBase64 } }] }], generationConfig: { temperature: 0 } };
}

const BOS = /^(no (clear )?speech|\[?(silence|music|noise)\]?|\(?no audio\)?|\.+)$/i;
/** Yanıttan metin: parçalar birleşir; "konuşma yok" kalıpları ve boşluk null'dır. Engellenen yanıt (safety) 'engel'. */
export function geminiYanitCoz(j: unknown): string | null {
  const o = j as { candidates?: { content?: { parts?: { text?: unknown }[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: unknown } } | null;
  if (o?.promptFeedback?.blockReason) throw new GeminiHatasi('engel', String(o.promptFeedback.blockReason).slice(0, 40));
  const c = o?.candidates?.[0];
  const t = (c?.content?.parts ?? []).map((p) => (typeof p?.text === 'string' ? p.text : '')).join('').replace(/\s+/g, ' ').trim();
  if (!t || BOS.test(t)) return null;
  return t;
}

/** Kullanıcıya tek cümle (çipte). */
export function geminiSorunMetni(n: GeminiNedeni): string {
  switch (n) {
    case 'anahtar': return 'Gemini anahtarı kabul edilmedi; anahtarı kontrol et.';
    case 'kota': return 'Gemini kotası doldu; biraz sonra yeniden dene ya da yerel yazıya çevirmeye geç.';
    case 'ag': return 'Gemini’ye ulaşılamadı; bağlantını kontrol et.';
    case 'engel': return 'Gemini bu sesi yazıya çevirmeyi reddetti.';
    default: return 'Gemini yazıya çevirmesi çalışmadı.';
  }
}

/** Arayüz metinleri (Toplantı sayfası, yalnız Geliştirici kipi): sözcükler burada durur ki İş dili taraması JSX metnine takılmasın (kutu İş kipinde hiç çizilmez). */
export const GEMINI_ETIKET = {
  baslik: 'Gemini ile yazıya çevir (isteğe bağlı)', kayitli: ' · kayıtlı', kaydet: 'Kaydet', sil: 'Anahtarı sil', alan: 'Gemini anahtarı',
  kaydedildi: 'Kaydedildi; Yazıya çevirme seçicisinden “Gemini”yi seçebilirsin.', silindi: 'Anahtar silindi.',
} as const;
