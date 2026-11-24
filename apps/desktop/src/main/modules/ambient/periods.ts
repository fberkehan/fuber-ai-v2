// Dönem hesapları: gün ("2026-10-19"), ISO hafta ("2026-W43") ve ay ("2026-10") anahtarları, dinleme saatleri,
// vadesi gelen raporlar, saklama (silinme) tarihleri ve mesele eşleştirme. Tarihler KULLANICININ yerel saatine göredir.
// Fuber AI 1'in `gunkaydi/donem.ts` dosyasından aynen alındı (yalnız adlar İngilizce); testleri `periods.test.ts`.
import { foldForSearch } from '@fuber/shared';

const fold = (text: string) => foldForSearch(text).normalize('NFKD').replace(/[̀-ͯ]/g, '');
const pad = (value: number) => String(value).padStart(2, '0');
const DAY_MS = 86_400_000;

export const dayKey = (date: Date): string => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
export const monthKey = (date: Date): string => `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
export const dayToDate = (day: string): Date => {
  const [year = 1970, month = 1, date = 1] = day.split('-').map(Number);
  return new Date(year, month - 1, date);
};
export const shiftDay = (day: string, days: number): string => {
  const date = dayToDate(day);
  date.setDate(date.getDate() + days);
  return dayKey(date);
};

/** ISO 8601 hafta: pazartesi başlar; yılın ilk perşembesini içeren hafta 1. */
export function isoWeek(date: Date): string {
  const target = startOfDay(date);
  const weekday = (target.getDay() + 6) % 7; // Pzt = 0
  target.setDate(target.getDate() - weekday + 3); // o haftanın perşembesi
  const year = target.getFullYear();
  const firstThursday = new Date(year, 0, 4);
  firstThursday.setDate(firstThursday.getDate() - ((firstThursday.getDay() + 6) % 7) + 3);
  const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * DAY_MS));
  return `${year}-W${pad(week)}`;
}

/** "2026-W43" → o haftanın pazartesi…pazar gün anahtarları. */
export function weekDays(week: string): string[] {
  const [year = 1970, number = 1] = week.split('-W').map(Number);
  const monday = new Date(year, 0, 4);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) + (number - 1) * 7);
  return Array.from({ length: 7 }, (_, index) => dayKey(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index)));
}

export function monthDays(month: string): string[] {
  const [year = 1970, number = 1] = month.split('-').map(Number);
  const count = new Date(year, number, 0).getDate();
  return Array.from({ length: count }, (_, index) => `${month}-${pad(index + 1)}`);
}

/** Ayla kesişen ISO haftalar (aylık rapor haftalık raporlardan kurulur). */
export function monthWeeks(month: string): string[] {
  return [...new Set(monthDays(month).map((day) => isoWeek(dayToDate(day))))];
}

export const previousWeek = (date: Date): string => isoWeek(new Date(date.getFullYear(), date.getMonth(), date.getDate() - 7));
export const previousMonth = (date: Date): string => monthKey(new Date(date.getFullYear(), date.getMonth() - 1, 1));

const minutesOf = (time: string) => {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours || 0) * 60 + (minutes || 0);
};

/** Dinleme saatleri. `days`: 0 = Pazar. `from > to` ise gece yarısını aşan aralık (ör. 20:00–02:00). */
export interface ListeningHours {
  from: string;
  to: string;
  days: number[];
}

/** Dinleme saatinde mi? Gece yarısını aşan aralıkta akşam kısmı bugünün, sabah kısmı dünün günü sayılır. */
export function isWithinHours(date: Date, hours: ListeningHours): boolean {
  const now = date.getHours() * 60 + date.getMinutes();
  const from = minutesOf(hours.from);
  const to = minutesOf(hours.to);
  if (from === to) return hours.days.includes(date.getDay());
  if (from < to) return hours.days.includes(date.getDay()) && now >= from && now < to;
  if (now >= from) return hours.days.includes(date.getDay());
  if (now < to) return hours.days.includes((date.getDay() + 6) % 7);
  return false;
}

export type ReportKind = 'daily' | 'weekly' | 'monthly';
export interface DueReport {
  kind: ReportKind;
  period: string;
}

/**
 * Şimdi hazırlanması gereken raporlar (en eski önce): bugünün günlüğü rapor saatinden sonra; kaçırılmış dün/evvelsi gün;
 * biten önceki ISO hafta; biten önceki ay. Var olan ya da verisi olmayan dönem atlanır.
 */
export function dueReports(
  now: Date,
  dailyTime: string,
  exists: (kind: ReportKind, period: string) => boolean,
  hasData: (kind: ReportKind, period: string) => boolean,
): DueReport[] {
  const out: DueReport[] = [];
  const today = dayKey(now);
  for (const day of [shiftDay(today, -2), shiftDay(today, -1)]) {
    if (!exists('daily', day) && hasData('daily', day)) out.push({ kind: 'daily', period: day });
  }
  if (now.getHours() * 60 + now.getMinutes() >= minutesOf(dailyTime) && !exists('daily', today) && hasData('daily', today)) {
    out.push({ kind: 'daily', period: today });
  }
  const week = previousWeek(now);
  if (!exists('weekly', week) && hasData('weekly', week)) out.push({ kind: 'weekly', period: week });
  const month = previousMonth(now);
  if (!exists('monthly', month) && hasData('monthly', month)) out.push({ kind: 'monthly', period: month });
  return out;
}

/** İçinde bulunulan dönemin anahtarı. */
export function currentPeriod(kind: ReportKind, date: Date): string {
  return kind === 'daily' ? dayKey(date) : kind === 'weekly' ? isoWeek(date) : monthKey(date);
}

/** Gün sonundan itibaren `days` gün sonra (o günün 23:59:59'u + `days` gün) silinir. */
export function expiryDate(day: string, days: number): string {
  const date = dayToDate(shiftDay(day, days));
  date.setHours(23, 59, 59, 0);
  return date.toISOString();
}

// ── Mesele eşleştirme: aynı konunun yeni dökümde tekrar geçmesi yeni mesele açmasın ──
const FILLER = new Set(['bir', 've', 'ile', 'icin', 'bu', 'su', 'o', 'de', 'da', 'mi', 'mu', 'ki', 'gibi', 'olan', 'olarak', 'ama', 'cok', 'daha']);

export function meaningfulWords(text: string): Set<string> {
  return new Set(
    fold(text)
      .split(/\s+/)
      .filter((word) => word.length > 2 && !FILLER.has(word))
      .map((word) => word.slice(0, 6)),
  );
}

/** Kaba konu benzerliği (0–1): sözcüklerin ilk altı harfi üzerinden ortak sözcük / küçük kümenin boyu. */
export function topicSimilarity(a: string, b: string): number {
  const x = meaningfulWords(a);
  const y = meaningfulWords(b);
  if (!x.size || !y.size) return 0;
  let common = 0;
  for (const word of x) if (y.has(word)) common++;
  return common / Math.min(x.size, y.size);
}

/** En benzer açık meseleyi bulur (≥ 0,6; kişiler ikisinde de yazılıysa aynı olmalı). */
export function matchIssue<T extends { title: string; person?: string | null }>(title: string, person: string | null | undefined, existing: T[]): T | null {
  let best: T | null = null;
  let score = 0;
  for (const candidate of existing) {
    if (person && candidate.person && fold(person) !== fold(candidate.person)) continue;
    const similarity = topicSimilarity(title, candidate.title);
    if (similarity > score) {
      score = similarity;
      best = candidate;
    }
  }
  return score >= 0.6 ? best : null;
}
