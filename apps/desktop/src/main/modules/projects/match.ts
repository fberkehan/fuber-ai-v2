// Söylenen proje adını ("atlas panel", "tarif web", "kitap blogu'nu") dizindeki projelerle eşleştirir.
// Sesten yazıya çeviri hatalarına ve Türkçe eklere dayanıklı olmak için sözcük sözcük, önek ve yakınlıkla puanlar.
import { foldForSearch } from '@fuber/shared';

/** Proje adında anlam taşımayan, söyleyişte sık geçen sözcükler (katlanmış). */
const FILLER = new Set([
  'proje', 'projesi', 'projesini', 'projeyi', 'projem', 'projemi', 'projemizi', 'project',
  'klasor', 'klasoru', 'klasorunu', 'klasorumu', 'dizin', 'dizini', 'uygulama', 'uygulamasi', 'uygulamasini',
  'app', 'ac', 'acar', 'misin', 'lutfen', 'the', 've', 'bir', 'su', 'bu', 'olan', 'icin', 'kodu', 'kodunu',
]);

/** Sözcüklere ayırır: camelCase, tire, alt çizgi, nokta, boşluk; Türkçe ek (kesme işaretinden sonrası) atılır. */
export function nameTokens(text: string): string[] {
  const spaced = text
    .replace(/['’][\p{L}]+/gu, '')
    .replace(/([\p{Ll}\d])(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2');
  return foldForSearch(spaced)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

export function queryTokens(text: string): string[] {
  const tokens = nameTokens(text);
  const meaningful = tokens.filter((token) => !FILLER.has(token));
  return meaningful.length ? meaningful : tokens;
}

function levenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const value = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(value);
      if (value < best) best = value;
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

function tokenScore(q: string, candidateTokens: string[], joined: string): number {
  let best = 0;
  for (const c of candidateTokens) {
    let score = 0;
    if (c === q) score = 10;
    else if (q.length >= 2 && c.startsWith(q)) score = 7;
    else if (c.length >= 3 && q.startsWith(c)) score = 6; // "atlasyu" → "atlas"
    else if (q.length >= 4 && levenshtein(q, c, q.length >= 7 ? 2 : 1) <= (q.length >= 7 ? 2 : 1)) score = 5;
    if (score > best) best = score;
  }
  if (best === 0 && q.length >= 3 && joined.includes(q)) best = 4;
  return best;
}

/**
 * Bir aday metnin (ad, takma ad, göreli yol) sorguya puanı. Sorgunun her anlamlı sözcüğü eşleşmeli;
 * yoksa 0. Tam eşleşme (boşluksuz hâlleri aynı) en yüksek puanı alır.
 */
export function scoreName(query: string | string[], candidate: string): number {
  const q = Array.isArray(query) ? query : queryTokens(query);
  const c = nameTokens(candidate);
  if (q.length === 0 || c.length === 0) return 0;
  const qJoined = q.join('');
  const cJoined = c.join('');
  if (qJoined === cJoined) return 100;
  let total = 0;
  for (const token of q) {
    const score = tokenScore(token, c, cJoined);
    if (score === 0) {
      // "fuberweb" gibi birleşik söyleyiş: aday sözcüklerinin birleşimiyle karşılaştır.
      if (token.length >= 5 && (cJoined.startsWith(token) || levenshtein(token, cJoined, 2) <= 2)) {
        total += 6;
        continue;
      }
      return 0;
    }
    total += score;
  }
  const unmatched = Math.max(0, c.length - q.length);
  return Math.max(1, (total / q.length) * 8 - Math.min(unmatched, 4) * 2);
}

export interface Candidate<T> {
  item: T;
  /** Ad, takma adlar, göreli yol gibi eşleşilecek metinler; ilki asıl addır. */
  names: string[];
  /** Eşit puanda öne geçme (yakın zamanda açılan/çalışılan). 0–1. */
  recency?: number;
}

export interface Ranked<T> {
  item: T;
  score: number;
}

export function rankCandidates<T>(query: string, candidates: Candidate<T>[]): Ranked<T>[] {
  const q = queryTokens(query);
  const ranked: Ranked<T>[] = [];
  for (const candidate of candidates) {
    let best = 0;
    for (const [index, name] of candidate.names.entries()) {
      // Asıl ad ve takma ad tam ağırlıkta; yol parçaları biraz daha düşük.
      const weight = index === 0 ? 1 : 0.95;
      best = Math.max(best, scoreName(q, name) * weight);
    }
    if (best > 0) ranked.push({ item: candidate.item, score: best + (candidate.recency ?? 0) });
  }
  return ranked.sort((a, b) => b.score - a.score);
}

/** Tek bir aday açıkça öndeyse onu döndürür; değilse `null` (seçenek sunulur). */
export function decisive<T>(ranked: Ranked<T>[]): T | null {
  const [first, second] = ranked;
  if (!first) return null;
  if (!second) return first.item;
  if (first.score >= 100 && second.score < 100) return first.item;
  return first.score >= second.score * 1.25 ? first.item : null;
}
