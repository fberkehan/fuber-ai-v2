/**
 * Kural tabanlı Türkçe zaman çözücü. Fuber AI 1'den taşındı (`shared/tr-zaman.ts`; oradaki ölçüm: 9B yerel model
 * tarih hesabında 2/10 aldı, "45 gün sonra 25 Ocak"). Yerel beyinde kullanıcının sözündeki zaman ifadesi KODLA kesin
 * ana çevrilir ve modele hazır verilir; model yalnız aracı çağırır.
 * Yaygın ifadeler: "yarın 14:00", "cuma 16:00", "24 Ekim 15:00", "haftaya salı 3'te", "her pazartesi 10:30",
 * "2 saat sonra", "45 gün sonra", "bir gün önce de hatırlat". Sesten yazıya çevrilen söz için eklenenler: sözcükle
 * saat ("saat onda", "akşam sekiz gibi", "dokuz buçukta") ve ayın günü ("ayın 28'inde", "her ayın 5'i").
 * Anlamadığı ifadede `null` döner (uydurmaz). Saat verilmezse 09:00; tek haneli 1–7 saat iş saati sayılır (3'te → 15:00).
 */

const FOLD: Record<string, string> = { ı: 'i', ş: 's', ğ: 'g', ü: 'u', ö: 'o', ç: 'c', â: 'a', î: 'i', û: 'u' };
const fold = (text: string): string =>
  text
    .toLocaleLowerCase('tr-TR')
    .replace(/[ışğüöçâîû]/g, (ch) => FOLD[ch] ?? ch)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’'`´]/g, ' ')
    .replace(/[,;!?]/g, ' ')
    .replace(/\s+/g, ' ');

export const TR_MONTHS = ['ocak', 'subat', 'mart', 'nisan', 'mayis', 'haziran', 'temmuz', 'agustos', 'eylul', 'ekim', 'kasim', 'aralik'];
const WEEKDAYS = ['pazar', 'pazartesi', 'sali', 'carsamba', 'persembe', 'cuma', 'cumartesi'];
const NUMBER: Record<string, number> = { bir: 1, iki: 2, uc: 3, dort: 4, bes: 5, alti: 6, yedi: 7, sekiz: 8, dokuz: 9, on: 10, yarim: 0.5, onbes: 15, yirmi: 20, otuz: 30, kirk: 40, elli: 50 };
const toNumber = (text: string): number => (/^\d+$/.test(text) ? Number(text) : (NUMBER[text] ?? NaN));
const NUMBER_RE = '(\\d{1,3}|bir|iki|uc|dort|bes|alti|yedi|sekiz|dokuz|on|yarim|onbes|yirmi|otuz|kirk|elli)';
// Gün adı: "cumartesi" "cuma"dan, "pazartesi" "pazar"dan önce denenir.
const WEEKDAY_RE = '(pazartesi|cumartesi|pazar|sali|carsamba|persembe|cuma)';

/** Sözcükle söylenen saat (1–12); "on bir" ve "on iki" tek sözcükten önce denenir. */
const HOUR_WORDS: Array<[string, number]> = [
  ['on bir', 11], ['on iki', 12], ['onbir', 11], ['oniki', 12],
  ['bir', 1], ['iki', 2], ['uc', 3], ['dort', 4], ['bes', 5], ['alti', 6], ['yedi', 7], ['sekiz', 8], ['dokuz', 9], ['on', 10],
];
const HOUR_WORD_RE = `(${HOUR_WORDS.map(([word]) => word).join('|')})`;
const hourOf = (word: string): number => HOUR_WORDS.find(([candidate]) => candidate === word)?.[1] ?? NaN;
const DAY_PART_RE = '(sabah|ogleden sonra|oglen|ogle|aksam|gece)';

/**
 * Sözcükle söylenen saati rakama çevirir ("saat onda" → "saat 10", "akşam sekiz gibi" → "aksam saat 8",
 * "dokuz buçukta" → "saat 9 bucuk"). Yalnız saat olduğu açık bağlamlarda: "saat" sözcüğünün ardında, günün bölümünün
 * ardında, "gibi / sularında / civarı" önünde ya da bulunma ekiyle ("dokuzda"). Tek başına "bir" + ek çevrilmez
 * ("bir de şunu…" saat değildir).
 */
function digitizeHours(text: string): string {
  let out = text;
  out = out.replace(new RegExp(`\\bsaat ${HOUR_WORD_RE}( bucuk)?(?:ta|te|da|de|a|e|ya|ye)?\\b`, 'g'), (_m, word: string, half?: string) => `saat ${hourOf(word)}${half ?? ''}`);
  out = out.replace(new RegExp(`\\b${DAY_PART_RE} ${HOUR_WORD_RE}( bucuk)?(?:ta|te|da|de|a|e|ya|ye)?\\b`, 'g'), (_m, part: string, word: string, half?: string) => `${part} saat ${hourOf(word)}${half ?? ''}`);
  out = out.replace(new RegExp(`\\b${HOUR_WORD_RE}( bucuk)? (?:gibi|sularinda|civari|civarinda)\\b`, 'g'), (_m, word: string, half?: string) => `saat ${hourOf(word)}${half ?? ''}`);
  out = out.replace(/\b(\d{1,2})( bucuk)? (?:gibi|sularinda|civari|civarinda)\b/g, (_m, digits: string, half?: string) => `saat ${digits}${half ?? ''}`);
  out = out.replace(new RegExp(`\\b(on bir|on iki|onbir|oniki|iki|uc|dort|bes|alti|yedi|sekiz|dokuz|on)( bucuk)?(?:ta|te|da|de)\\b`, 'g'), (_m, word: string, half?: string) => `saat ${hourOf(word)}${half ?? ''}`);
  return out;
}

export type TrRecurrence = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly';

export interface TrTimeResult {
  /** Çözülen an (hatırlatma anı). */
  at: Date;
  /** Saat açıkça verildi mi (yoksa günün bölümünden ya da 09:00 varsayıldı). */
  hasTime: boolean;
  recurrence: TrRecurrence;
  /** "bir gün önce" gibi: hatırlatma olayın öncesine kurulur (`at` hatırlatma anıdır; `event` asıl zaman). */
  event?: Date;
  /** Metinde zamanı anlatan parçalar. */
  parts: string[];
}

const startOfDay = (date: Date) => {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
};
const addDays = (date: Date, days: number) => {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
};

/** Metindeki zaman ifadesini çözer; zaman bulunamazsa `null`. `now` yerel saatle yorumlanır. */
export function resolveTurkishTime(text: string, now: Date = new Date()): TrTimeResult | null {
  const s = ` ${digitizeHours(fold(text))} `;
  const parts: string[] = [];
  let m: RegExpMatchArray | null;
  const find = (re: RegExp) => {
    const found = s.match(re);
    if (found) parts.push(found[0].trim());
    return found;
  };

  // 1) Göreli dakika/saat: "2 saat sonra", "yarım saat sonra", "20 dakika sonra" — doğrudan ana göre.
  if ((m = find(new RegExp(`\\b${NUMBER_RE} (dakika|dk|saat) (sonra|icinde)\\b`)))) {
    const n = toNumber(m[1]!);
    if (!Number.isNaN(n)) return { at: new Date(now.getTime() + n * (m[2] === 'saat' ? 3_600_000 : 60_000)), hasTime: true, recurrence: 'none', parts };
  }

  // 2) Tekrar
  let recurrence: TrRecurrence = 'none';
  let weekday: number | null = null;
  if (find(/\b(her hafta ici|hafta ici her gun)\b/)) recurrence = 'weekdays';
  else if (find(/\bher gun\b/)) recurrence = 'daily';
  else if (find(/\bher ay(in)?\b/)) recurrence = 'monthly';
  else if ((m = find(new RegExp(`\\bher ${WEEKDAY_RE}\\b`)))) {
    recurrence = 'weekly';
    weekday = WEEKDAYS.indexOf(m[1]!);
  }

  // 3) Gün
  const today = startOfDay(now);
  let day: Date | null = null;
  let weekdayChosen = false;
  /** "ayın 28'i": gün bu ay geçtiyse (ya da saatiyle birlikte geçtiyse) gelecek aya kayar. */
  let dayOfMonth: number | null = null;
  if (find(/\bbugun\b/)) day = today;
  else if (find(/\b(obur gun|ertesi gun|yarindan sonra)\b/)) day = addDays(today, 2);
  else if (find(/\byarin\b/)) day = addDays(today, 1);
  else if ((m = find(new RegExp(`\\b${NUMBER_RE} (gun|hafta|ay) sonra\\b`)))) {
    const n = toNumber(m[1]!);
    if (!Number.isNaN(n)) day = m[2] === 'gun' ? addDays(today, n) : m[2] === 'hafta' ? addDays(today, n * 7) : new Date(today.getFullYear(), today.getMonth() + n, today.getDate());
  } else if ((m = find(/\b(\d{1,2}) (ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik)(?: (\d{4}))?\b/))) {
    const hasYear = Boolean(m[3]);
    let year = hasYear ? Number(m[3]) : today.getFullYear();
    let date = new Date(year, TR_MONTHS.indexOf(m[2]!), Number(m[1]));
    if (!hasYear && date < today) {
      year += 1;
      date = new Date(year, TR_MONTHS.indexOf(m[2]!), Number(m[1]));
    }
    if (date.getDate() === Number(m[1])) day = date;
    find(new RegExp(`\\b${WEEKDAY_RE}\\b`)); // "24 Ekim cumartesi": gün adı da zaman parçasıdır
  } else if ((m = find(/\bay(?:in)? (\d{1,2})\b/))) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 31) {
      dayOfMonth = n;
      const date = new Date(today.getFullYear(), today.getMonth(), n);
      day = date.getDate() === n && date >= today ? date : new Date(today.getFullYear(), today.getMonth() + 1, n);
    }
  } else if (weekday === null && (m = find(new RegExp(`\\b(haftaya |gelecek hafta |onumuzdeki hafta |bu )?${WEEKDAY_RE}\\b`)))) {
    const target = WEEKDAYS.indexOf(m[2]!);
    const nextWeek = Boolean(m[1]) && m[1]!.trim() !== 'bu';
    if (nextWeek) {
      // "haftaya salı": gelecek takvim haftasının (pazartesi başlangıçlı) salısı.
      const monday = addDays(today, -((today.getDay() + 6) % 7) + 7);
      day = addDays(monday, (target + 6) % 7);
    } else {
      const diff = (target - today.getDay() + 7) % 7;
      day = addDays(today, diff);
      weekdayChosen = diff === 0;
    }
  } else if (find(/\b(haftaya|gelecek hafta)\b/)) day = addDays(today, 7);
  if (weekday !== null) {
    day = addDays(today, (weekday - today.getDay() + 7) % 7);
    weekdayChosen = true;
  }

  // 4) Saat
  let hour: number | null = null;
  let minute = 0;
  if ((m = find(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/))) {
    hour = Number(m[1]);
    minute = Number(m[2]);
  } else if ((m = find(/\bsaat (\d{1,2})( bucuk)?\b/))) {
    hour = Number(m[1]);
    minute = m[2] ? 30 : 0;
  } else if ((m = find(/\b(\d{1,2}) ?(te|ta|de|da|e|a|ye|ya)\b(?! (ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik|gun|hafta|ay|dakika|saat))/))) {
    hour = Number(m[1]);
  }
  if (hour !== null && hour > 23) hour = null;
  const dayPart = find(new RegExp(`\\b${DAY_PART_RE}\\b`))?.[1];
  const hasTime = hour !== null;
  if (hour === null) hour = dayPart === 'ogleden sonra' ? 14 : dayPart === 'ogle' || dayPart === 'oglen' ? 12 : dayPart === 'aksam' ? 19 : dayPart === 'gece' ? 22 : 9;
  else if ((dayPart === 'aksam' || dayPart === 'ogleden sonra') && hour < 12) hour += 12;
  else if (dayPart === 'gece' && hour >= 8 && hour < 12) hour += 12;
  else if (!dayPart && hour >= 1 && hour <= 7 && !/^0/.test(String(m?.[1] ?? ''))) hour += 12; // "3'te" iş saati: 15:00

  if (!day && !hasTime && !dayPart && recurrence === 'none') return null;
  let at = new Date(day ?? today);
  at.setHours(hour, minute, 0, 0);
  if (!day && at <= now) at = addDays(at, 1); // yalnız saat: geçtiyse yarın
  if (weekdayChosen && at <= now) at = addDays(at, 7); // bugünün gün adı ve saat geçti: gelecek hafta
  if (dayOfMonth !== null && at <= now) {
    at = new Date(at.getFullYear(), at.getMonth() + 1, dayOfMonth, hour, minute, 0, 0); // ayın günü bugün ve saati geçti
  } else if (recurrence !== 'none' && at <= now) {
    at = addDays(at, recurrence === 'weekly' ? 7 : 1);
  }

  // 5) "bir gün önce (de) hatırlat": hatırlatma olaydan önce.
  if ((m = find(new RegExp(`\\b${NUMBER_RE} (gun|saat) once\\b`)))) {
    const n = toNumber(m[1]!);
    if (!Number.isNaN(n) && n > 0) {
      const event = at;
      return { at: new Date(event.getTime() - n * (m[2] === 'gun' ? 86_400_000 : 3_600_000)), hasTime, recurrence, event, parts };
    }
  }
  return { at, hasTime, recurrence, parts };
}
