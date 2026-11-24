// Kendiliğinden iletilerin tekrar bekçisi. Fuber AI 1'in `shared/proaktif-tekrar.ts` dosyasından alındı (adlar İngilizce).
// v1 analizi: aynı merak sorusu 20 gün, aynı bayat sabah özeti 25 gün tekrarlanmıştı; koruma modelin iyi niyetine
// bağlıydı. Koruma KODDA:
//  · gönderilen her kendiliğinden ileti dönen listeye (son 60) yazılır;
//  · yeni ileti listedeki HER iletiyle kök benzerliğiyle karşılaştırılır (≥ 0,6 → tekrar): gösterilmez;
//  · bekleme: iki kendiliğinden ileti arası en az 90 dk (eşlikçi kendi aralığını politikadan alır); son 3 merak sorusu
//    yanıtsızsa merak 2 gün susar; kullanıcı son 30 dk'da yazdıysa merak sorulmaz.
import { stemSimilarity } from './stems';

export interface ProactiveTrace {
  /** İletinin türü: `interjection`, `curiosity`, `morning`… */
  kind: string;
  text: string;
  at: string;
}

export const PROACTIVE_HISTORY_SIZE = 60;
export const REPEAT_THRESHOLD = 0.6;
export const PROACTIVE_GAP_MS = 90 * 60_000;
export const CURIOSITY_SILENCE_MS = 2 * 86_400_000;
export const WHILE_TYPING_SILENCE_MS = 30 * 60_000;

/**
 * İletinin gövdesi: baştaki selam satırı ("Günaydın Selin!", "Günün özeti:") ve kısa bölüm başlıkları ("Bugün:") düşer;
 * aynı kalıp iki farklı özeti "benzer" göstermesin.
 */
export function bodyOf(text: string): string {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const first = lines[0];
  if (lines.length > 1 && first && /^(günaydın|gunaydin|iyi akşamlar|günün özeti|merhaba)(?![\p{L}\p{N}])/iu.test(first) && first.length < 60) lines.shift();
  return lines.filter((line) => !(line.length < 30 && /:$/.test(line))).join('\n');
}

/** Metin, geçmişteki herhangi bir kendiliğinden iletinin tekrarı mı (bütün liste; tür fark etmez). */
export function isRepeat(text: string, history: readonly ProactiveTrace[]): boolean {
  const body = bodyOf(text.trim());
  if (!body) return false;
  return history.some((trace) => stemSimilarity(body, bodyOf(trace.text)) >= REPEAT_THRESHOLD);
}

/** Şablonla (modelsiz) yazılan özetin bir öncekiyle AYNI olup olmadığı: veri değişmediyse aynı liste yeniden gönderilmez. */
export function sameAsPrevious(text: string, history: readonly ProactiveTrace[], kind: string): boolean {
  const previous = history.filter((trace) => trace.kind === kind).at(-1);
  const normalize = (value: string) => bodyOf(value).replace(/\s+/g, ' ').trim().toLocaleLowerCase('tr-TR');
  return previous !== undefined && normalize(previous.text) === normalize(text);
}

/** Listeye ekler; en eskiler düşer. */
export function appendHistory(history: readonly ProactiveTrace[], trace: ProactiveTrace): ProactiveTrace[] {
  return [...history, { ...trace, text: trace.text.slice(0, 600) }].slice(-PROACTIVE_HISTORY_SIZE);
}

/** Bozuk/eski kayda dayanıklı okuma. */
export function readHistory(raw: string | undefined | null): ProactiveTrace[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value
      .filter((entry): entry is ProactiveTrace => {
        const candidate = entry as Partial<ProactiveTrace> | null;
        return !!candidate && typeof candidate.text === 'string' && typeof candidate.kind === 'string';
      })
      .slice(-PROACTIVE_HISTORY_SIZE);
  } catch {
    return [];
  }
}

/** Modele giden yönergeye eklenen "daha önce yazdıkların" bölümü (aynı türün son `count` iletisi; yoksa boş). */
export function previousText(history: readonly ProactiveTrace[], kind: string, count = 12): string {
  const list = history.filter((trace) => trace.kind === kind).slice(-count);
  if (!list.length) return '';
  const title = kind === 'curiosity' ? 'Daha önce sorduğun sorular (bunları ya da benzerlerini SORMA)' : 'Daha önceki iletilerin (aynısını ya da benzerini YAZMA)';
  return `\n${title}:\n${list.map((trace) => `- ${trace.text.replace(/\s+/g, ' ').slice(0, 200)}`).join('\n')}`;
}

/**
 * Bu kendiliğinden iş şimdi beklemeli mi (gönderilmez, deneme sayılmaz; sonra yeniden sorulur)?
 * `answered`: son merak sorularının her biri için kullanıcı ardından yazdı mı (en yeni sonda).
 * `lastUserAt`: kullanıcının son iletisinin zamanı.
 */
export function shouldWait(
  kind: string,
  history: readonly ProactiveTrace[],
  now: number,
  options: { answered: boolean[]; lastUserAt?: number; gapMs?: number },
): boolean {
  const last = history.at(-1);
  if (last && now - Date.parse(last.at) < (options.gapMs ?? PROACTIVE_GAP_MS)) return true;
  if (kind !== 'curiosity') return false;
  if (options.lastUserAt !== undefined && now - options.lastUserAt < WHILE_TYPING_SILENCE_MS) return true;
  const curiosity = history.filter((trace) => trace.kind === 'curiosity');
  const lastThree = options.answered.slice(-3);
  if (lastThree.length === 3 && lastThree.every((value) => !value)) {
    const lastCuriosity = curiosity.at(-1);
    if (lastCuriosity && now - Date.parse(lastCuriosity.at) < CURIOSITY_SILENCE_MS) return true;
  }
  return false;
}
