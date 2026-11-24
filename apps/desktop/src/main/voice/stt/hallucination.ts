/**
 * Whisper halüsinasyon süzgeci. Model sessizlikte ve gürültüde eğitim verisinden ezberlediği kalıpları
 * yazar ("Altyazı M.K.", "İzlediğiniz için teşekkürler"); bunlar komut sanılırsa Jarvis kendi kendine konuşur.
 * Üç savunma: (1) çok kısa ya da sessiz bölüt hiç gönderilmez, (2) bilinen kalıplar atılır,
 * (3) model sesin dilinden emin değilse (Türkçe + İngilizce olasılığı düşük) döküm atılır.
 */

import { AUDIO_SAMPLE_RATE } from '@fuber/shared';
import { foldSpeech } from '../text-match';
import type { DropReason } from './types';

/** Bundan kısa bölütte anlamlı bir sözcük olamaz ("sus" yaklaşık 350 ms sürer). */
export const MIN_SEGMENT_MS = 250;
/** RMS eşiği (0–1). Bunun altı fısıltıdan da sessizdir; VAD yanlış tetiklemiştir. */
export const MIN_SEGMENT_RMS = 0.004;
/**
 * `large-v3-turbo` için `no_speech_prob` güvenilmez (sessizlikte 1e-10 ölçüldü); yine de çalıştığı
 * modellerde işe yarasın diye denetlenir.
 */
const NO_SPEECH_THRESHOLD = 0.6;
/**
 * Ölçüm (16 Kas 2026, large-v3-turbo-q5): gerçek Türkçe sözde tr+en olasılığı 0,87–0,91;
 * sessizlikte 0,42, beyaz gürültüde 0,38.
 */
const LANGUAGE_CONFIDENCE_THRESHOLD = 0.5;
/**
 * Dil sınaması yalnız bu uzunluktan sonra uygulanır: kısa sözde dil tahmini güvenilmez
 * (0,7 sn'lik "sus" için 0,46 ölçüldü) ve dur-sözcükleri tam da böyle kısa sözlerdir.
 */
const LANGUAGE_CHECK_MIN_MS = 2000;

/** Katlanmış ve noktalaması silinmiş dökümün TAMAMI bu kalıplardan biriyse halüsinasyondur. */
const PATTERNS: RegExp[] = [
  /^altyazi( m k)?$/,
  /^altyazilar?( m k)?$/,
  /^(izlediginiz|dinlediginiz) icin tesekkur(ler| ederim| ederiz)?$/,
  /^(bir sonraki|gelecek) videoda gorusmek uzere$/,
  /^gorusmek uzere$/,
  /^(kanalima |kanala )?abone ol(un|mayi unutmayin)?$/,
  /^(videoyu )?begenmeyi unutmayin$/,
  /^hosca ?kalin$/,
  /^thanks? (you )?for watching$/,
  /^subtitles? by .*$/,
  /^(ceviri|altyazi) ?:? .*$/,
  /^(muzik|music|alkis|applause|gulusmeler|sessizlik)$/,
  /^www .*$/,
  /^amara org.*$/,
];

export function rmsOf(pcm: Int16Array): number {
  if (pcm.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = (pcm[i] ?? 0) / 32768;
    sum += v * v;
  }
  return Math.sqrt(sum / pcm.length);
}

/** Bölüt motora gönderilmeye değer mi; değmiyorsa nedeni. */
export function preFilter(pcm: Int16Array): DropReason | null {
  if ((pcm.length / AUDIO_SAMPLE_RATE) * 1000 < MIN_SEGMENT_MS) return 'too_short';
  if (rmsOf(pcm) < MIN_SEGMENT_RMS) return 'too_quiet';
  return null;
}

/**
 * Whisper'ın bölütlerini tek metne birleştirir. Bölüt sınırı zaman damgasına göre konur ve sözcüğün ORTASINA
 * düşebilir; yeni sözcükle başlayan bölüt kendi baş boşluğunu taşır, sözcüğün devamı olan bölüt taşımaz.
 * Örnek: uzun bir söz " …hiçbir ayar değiştirm" | "eden seni dinliyorum. Yarın toplantıya hazırlan" | "mam gerekiyor."
 * bölütleriyle gelebilir. whisper-server bölütleri `text` alanında satır sonuyla birleştirir; satır sonu boşluk sayılırsa
 * döküm "değiştirm eden", "hazırlan mam" olur.
 * Kural: bölütler araya hiçbir şey konmadan eklenir; yalnız önceki bölüt cümle sonu noktalamasıyla bitiyor ve sonraki
 * boşluksuz başlıyorsa araya bir boşluk girer (nokta ile sözcük yapışmasın).
 */
export function joinSegments(segments: string[]): string {
  let text = '';
  for (const segment of segments) {
    if (!segment) continue;
    const glued = text !== '' && !/^\s/.test(segment) && /[.!?…,;:]$/.test(text);
    text += glued ? ` ${segment}` : segment;
  }
  return text;
}

export interface RawTranscript {
  text: string;
  /** Bölütlerin en yüksek `no_speech_prob` değeri; motor vermiyorsa `null`. */
  noSpeechProb: number | null;
  /** Dil olasılıkları (`tr`, `en`, …); motor vermiyorsa `null`. */
  languageProbabilities: Record<string, number> | null;
}

/**
 * Sesin beklenen dilde olma olasılığı; motor dil olasılığı vermiyorsa `null`. Varsayılan (sesli tur): Türkçe ya da
 * İngilizce. Toplantının "Karşı taraf" kaynağında istenen dil başka olabilir: `auto` en olası dilin olasılığı, başka bir
 * kod o dilin olasılığıdır (gürültüde dağılım düzdür; en olası dil bile eşiğin altında kalır).
 */
export function languageConfidence(raw: RawTranscript, language?: string): number | null {
  if (!raw.languageProbabilities) return null;
  const probs = raw.languageProbabilities;
  if (!language || language === 'tr' || language === 'en') return (probs.tr ?? 0) + (probs.en ?? 0);
  if (language === 'auto') return Math.max(0, ...Object.values(probs));
  return probs[language] ?? 0;
}

/** Motorun en olası bulduğu dil; olasılık yoksa `null`. */
export function likelyLanguage(raw: RawTranscript): string | null {
  if (!raw.languageProbabilities) return null;
  let best: string | null = null;
  let top = -1;
  for (const [code, value] of Object.entries(raw.languageProbabilities)) {
    if (value > top) {
      best = code;
      top = value;
    }
  }
  return best;
}

const foldWords = (text: string): string =>
  foldSpeech(text)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * Model sessizlikte ya da gürültüde kendisine verilen ilk istemi geri yazabilir: bir cümlesinin tamamını
 * (ardından başka şeylerle) ya da baş kısmını. İstem adla başlamadığı için tek başına söylenen ad yankı sayılmaz.
 */
function isPromptEcho(words: string, prompt: string): boolean {
  if (words.split(' ').length < 2) return false;
  const sentences = prompt
    .split(/[.!?]+/)
    .map(foldWords)
    .filter((sentence) => sentence.split(' ').length >= 3);
  return sentences.some(
    (sentence) => words === sentence || words.startsWith(`${sentence} `) || sentence.startsWith(`${words} `),
  );
}

/** `audioMs`: dökümü yapılan bölütün süresi; `prompt`: motora verilen ilk istem (yankısı atılır). */
export function filterTranscript(
  raw: RawTranscript,
  audioMs: number,
  prompt = '',
  language?: string,
): { text: string; dropped: DropReason | null } {
  const text = raw.text.replace(/\s+/g, ' ').trim();
  const drop = (dropped: DropReason) => ({ text: '', dropped });

  // Köşeli ve yuvarlak ayraç içindeki ses betimlemeleri ("[Müzik]", "(alkış)") söz değildir.
  const spoken = text.replace(/[[(][^\])]*[\])]/g, ' ').replace(/[♪♫]+/g, ' ');
  const words = foldWords(spoken);
  if (words.length === 0) return drop('empty');
  if (PATTERNS.some((pattern) => pattern.test(words)) || isPromptEcho(words, prompt)) return drop('pattern');
  if (raw.noSpeechProb !== null && raw.noSpeechProb > NO_SPEECH_THRESHOLD) return drop('no_speech');
  const confidence = languageConfidence(raw, language);
  if (confidence !== null && audioMs >= LANGUAGE_CHECK_MIN_MS && confidence < LANGUAGE_CONFIDENCE_THRESHOLD) {
    return drop('language');
  }
  return { text: spoken.replace(/\s+/g, ' ').trim(), dropped: null };
}
