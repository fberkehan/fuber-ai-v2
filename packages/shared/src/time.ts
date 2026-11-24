/**
 * Zaman yardımcıları. Kural: "gün" her zaman kullanıcının yerel günüdür. `toISOString().slice(0, 10)`
 * UTC gününü verir ve Türkiye'de 00:00–03:00 arasında dünü gösterir; onun yerine `localDay()` kullanılır.
 * Ay ve gün adları sabit dizilerden gelir (Intl'e bağlı değil) ki çıktı her ortamda aynı olsun.
 */

import type { IsoDateTime, LocalDay, LocalTime, Recurrence, Weekday } from './entities';

const MONTHS = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
] as const;
/** ISO sırası: dizin 0 = Pazartesi. */
const WEEKDAYS = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'] as const;

const DAY_MS = 86_400_000;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function toDate(value: Date | IsoDateTime): Date {
  return typeof value === 'string' ? new Date(value) : value;
}

/** Şu an, ISO 8601 UTC. */
export function nowIso(): IsoDateTime {
  return new Date().toISOString();
}

/** Verilen anın yerel takvim günü (`YYYY-MM-DD`). */
export function localDay(date: Date | IsoDateTime = new Date()): LocalDay {
  const d = toDate(date);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Verilen anın yerel saati (`HH:MM`). */
export function localTime(date: Date | IsoDateTime = new Date()): LocalTime {
  const d = toDate(date);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Yerel gün ve saati `Date`'e çevirir. Geçersiz biçimde fırlatır. */
export function fromLocal(day: LocalDay, time: LocalTime = '00:00'): Date {
  const dayMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dayMatch || !timeMatch) throw new Error(`Geçersiz yerel tarih/saat: ${day} ${time}`);
  return new Date(
    Number(dayMatch[1]),
    Number(dayMatch[2]) - 1,
    Number(dayMatch[3]),
    Number(timeMatch[1]),
    Number(timeMatch[2]),
  );
}

/** Güne `days` gün ekler (eksi olabilir). */
export function addDays(day: LocalDay, days: number): LocalDay {
  const d = fromLocal(day);
  d.setDate(d.getDate() + days);
  return localDay(d);
}

/** `to - from` takvim günü farkı. Yaz saati geçişinden etkilenmez. */
export function daysBetween(from: LocalDay, to: LocalDay): number {
  const utc = (day: LocalDay) => {
    const d = fromLocal(day);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  };
  return Math.round((utc(to) - utc(from)) / DAY_MS);
}

/** ISO hafta günü: 1 = Pazartesi … 7 = Pazar. */
export function weekdayOf(date: Date | LocalDay): Weekday {
  const d = typeof date === 'string' ? fromLocal(date) : date;
  return (d.getDay() === 0 ? 7 : d.getDay()) as Weekday;
}

export function weekdayName(weekday: Weekday): string {
  return WEEKDAYS[weekday - 1]!;
}

/** "16 Kasım"; yıl `now`'dan farklıysa "16 Kasım 2027". */
export function formatDay(date: Date | LocalDay, now: Date = new Date()): string {
  const d = typeof date === 'string' ? fromLocal(date) : date;
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** "16 Kasım Pazartesi". */
export function formatDayLong(date: Date | LocalDay, now: Date = new Date()): string {
  const d = typeof date === 'string' ? fromLocal(date) : date;
  return `${formatDay(d, now)} ${weekdayName(weekdayOf(d))}`;
}

/**
 * Güne göre Türkçe göreli ad: "bugün", "yarın", "dün"; 2–6 gün sonrası için gün adı ("Cuma");
 * 2–6 gün öncesi için "3 gün önce"; daha uzağı için tarih ("16 Kasım").
 */
export function relativeDay(date: Date | LocalDay, now: Date = new Date()): string {
  const day = typeof date === 'string' ? date : localDay(date);
  const diff = daysBetween(localDay(now), day);
  if (diff === 0) return 'bugün';
  if (diff === 1) return 'yarın';
  if (diff === -1) return 'dün';
  if (diff >= 2 && diff <= 6) return weekdayName(weekdayOf(day));
  if (diff <= -2 && diff >= -6) return `${-diff} gün önce`;
  return formatDay(day, now);
}

/** Gün + saat: "yarın 10:00", "Cuma 09:30", "16 Kasım 14:00". */
export function relativeDateTime(date: Date | IsoDateTime, now: Date = new Date()): string {
  const d = toDate(date);
  return `${relativeDay(d, now)} ${localTime(d)}`;
}

/**
 * Süreye göre Türkçe göreli an: "az önce", "birazdan", "5 dk önce", "2 saat sonra", "3 gün önce";
 * bir haftadan uzağı için tarih.
 */
export function relativeTime(date: Date | IsoDateTime, now: Date = new Date()): string {
  const d = toDate(date);
  const diffMs = d.getTime() - now.getTime();
  const future = diffMs > 0;
  const abs = Math.abs(diffMs);
  const suffix = future ? 'sonra' : 'önce';
  if (abs < 45_000) return future ? 'birazdan' : 'az önce';
  const minutes = Math.round(abs / 60_000);
  if (minutes < 60) return `${minutes} dk ${suffix}`;
  const hours = Math.round(abs / 3_600_000);
  if (hours < 24) return `${hours} saat ${suffix}`;
  const days = Math.round(abs / DAY_MS);
  if (days < 7) return `${days} gün ${suffix}`;
  return formatDay(d, now);
}

/** `now`, `from`–`to` aralığında mı. Gece yarısını aşan aralık (22:00–08:00) desteklenir; `to` hariçtir. */
export function isWithinLocalTimeRange(now: Date, from: LocalTime, to: LocalTime): boolean {
  const current = localTime(now);
  if (from === to) return false;
  return from < to ? current >= from && current < to : current >= from || current < to;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** `base`'i duvar saatini koruyarak `days` gün ileri taşır. */
function shiftDays(base: Date, days: number): Date {
  return new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate() + days,
    base.getHours(),
    base.getMinutes(),
    base.getSeconds(),
    base.getMilliseconds(),
  );
}

/** `base`'i duvar saatini koruyarak `months` ay ileri taşır; gün o ayda yoksa (31, 29 Şubat) ayın son gününe çeker. */
function shiftMonths(base: Date, months: number): Date {
  const total = base.getMonth() + months;
  const y = base.getFullYear() + Math.floor(total / 12);
  const m = ((total % 12) + 12) % 12;
  return new Date(
    y,
    m,
    Math.min(base.getDate(), daysInMonth(y, m)),
    base.getHours(),
    base.getMinutes(),
    base.getSeconds(),
    base.getMilliseconds(),
  );
}

function nextUnbounded(recurrence: Recurrence, base: Date, after: Date): Date {
  const interval = Math.max(1, Math.floor(recurrence.interval));

  if (recurrence.freq === 'daily') {
    const elapsed = daysBetween(localDay(base), localDay(after));
    for (let n = Math.max(0, Math.floor(elapsed / interval)); ; n++) {
      const candidate = shiftDays(base, n * interval);
      if (candidate.getTime() > after.getTime()) return candidate;
    }
  }

  if (recurrence.freq === 'weekly') {
    const listed = (recurrence.weekdays ?? []).filter((w) => w >= 1 && w <= 7);
    const weekdays = listed.length > 0 ? listed : [weekdayOf(base)];
    // Haftalar Pazartesi başlar; `interval`, serinin ilk haftasına göre sayılır.
    const baseWeekStart = addDays(localDay(base), 1 - weekdayOf(base));
    for (let offset = Math.max(0, daysBetween(localDay(base), localDay(after))); ; offset++) {
      const candidate = shiftDays(base, offset);
      const weekIndex = Math.floor(daysBetween(baseWeekStart, localDay(candidate)) / 7);
      if (
        weekIndex % interval === 0 &&
        weekdays.includes(weekdayOf(candidate)) &&
        candidate.getTime() > after.getTime()
      ) {
        return candidate;
      }
    }
  }

  const monthsPerStep = recurrence.freq === 'monthly' ? interval : interval * 12;
  const elapsedMonths = (after.getFullYear() - base.getFullYear()) * 12 + (after.getMonth() - base.getMonth());
  for (let n = Math.max(0, Math.floor(elapsedMonths / monthsPerStep)); ; n++) {
    const candidate = shiftMonths(base, n * monthsPerStep);
    if (candidate.getTime() > after.getTime()) return candidate;
  }
}

/**
 * Tekrar kuralının `after`'dan sonraki (ona eşit olmayan) ilk anı. `first`, serinin bilinen bir anıdır
 * (ör. ilk çalma); saat, haftanın günü ve (aylık/yıllık için) ayın günü ondan alınır.
 * `after`, `first`'ten önceyse `first` döner. `until` aşılırsa `null`.
 */
export function nextOccurrence(
  recurrence: Recurrence,
  first: Date | IsoDateTime,
  after: Date | IsoDateTime = new Date(),
): Date | null {
  const result = nextUnbounded(recurrence, toDate(first), toDate(after));
  if (recurrence.until && result.getTime() > new Date(recurrence.until).getTime()) return null;
  return result;
}

/** Tekrar kuralının insan diliyle Türkçe özeti: "her gün", "2 haftada bir Pazartesi ve Cuma", "her ay". */
export function describeRecurrence(recurrence: Recurrence): string {
  const n = Math.max(1, Math.floor(recurrence.interval));
  switch (recurrence.freq) {
    case 'daily':
      return n === 1 ? 'her gün' : `${n} günde bir`;
    case 'weekly': {
      const prefix = n === 1 ? 'her hafta' : `${n} haftada bir`;
      if (!recurrence.weekdays?.length) return prefix;
      const names = [...recurrence.weekdays].sort((a, b) => a - b).map(weekdayName);
      const list = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} ve ${names.at(-1)}`;
      return `${prefix} ${list}`;
    }
    case 'monthly':
      return n === 1 ? 'her ay' : `${n} ayda bir`;
    case 'yearly':
      return n === 1 ? 'her yıl' : `${n} yılda bir`;
  }
}
