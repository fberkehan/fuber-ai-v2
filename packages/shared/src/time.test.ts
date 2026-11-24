import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  describeRecurrence,
  formatDay,
  formatDayLong,
  fromLocal,
  isWithinLocalTimeRange,
  localDay,
  localTime,
  nextOccurrence,
  relativeDateTime,
  relativeDay,
  relativeTime,
  weekdayOf,
} from './time';

// Bütün tarihler yerel yapıcıyla üretilir; testler saat diliminden bağımsızdır.
const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);

describe('localDay', () => {
  it('yerel günü verir (gece yarısından hemen sonra bile)', () => {
    expect(localDay(at(2026, 11, 16, 0, 30))).toBe('2026-11-16');
    expect(localDay(at(2026, 11, 16, 23, 59))).toBe('2026-11-16');
    expect(localDay(at(2026, 1, 5, 2, 0))).toBe('2026-01-05');
  });

  it('UTC+ dilimlerinde toISOString tuzağına düşmez', () => {
    const justAfterMidnight = at(2026, 11, 16, 0, 30);
    const utcDay = justAfterMidnight.toISOString().slice(0, 10);
    // Doğunun dilimlerinde (Türkiye UTC+3) UTC günü bir önceki gündür; localDay yine doğru günü verir.
    if (justAfterMidnight.getTimezoneOffset() < -30) expect(utcDay).toBe('2026-11-15');
    expect(localDay(justAfterMidnight)).toBe('2026-11-16');
  });

  it('ISO metinden de çalışır', () => {
    const d = at(2026, 3, 9, 14, 5);
    expect(localDay(d.toISOString())).toBe('2026-03-09');
    expect(localTime(d.toISOString())).toBe('14:05');
  });
});

describe('gün aritmetiği', () => {
  it('fromLocal yerel gün ve saati kurar', () => {
    const d = fromLocal('2026-11-16', '09:30');
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 10, 16, 9, 30]);
    expect(() => fromLocal('16.11.2026')).toThrow();
  });

  it('addDays ay ve yıl sınırını aşar', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('daysBetween takvim günü sayar', () => {
    expect(daysBetween('2026-11-16', '2026-11-16')).toBe(0);
    expect(daysBetween('2026-11-16', '2026-11-23')).toBe(7);
    expect(daysBetween('2026-11-16', '2026-11-10')).toBe(-6);
    expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365);
  });

  it('weekdayOf ISO gününü verir', () => {
    expect(weekdayOf('2026-11-16')).toBe(1); // Pazartesi
    expect(weekdayOf('2026-11-22')).toBe(7); // Pazar
  });
});

describe('Türkçe biçimler', () => {
  const now = at(2026, 11, 16, 10, 0); // Pazartesi

  it('formatDay', () => {
    expect(formatDay('2026-11-16', now)).toBe('16 Kasım');
    expect(formatDay('2027-02-03', now)).toBe('3 Şubat 2027');
    expect(formatDayLong('2026-11-18', now)).toBe('18 Kasım Çarşamba');
  });

  it('relativeDay', () => {
    expect(relativeDay('2026-11-16', now)).toBe('bugün');
    expect(relativeDay('2026-11-17', now)).toBe('yarın');
    expect(relativeDay('2026-11-15', now)).toBe('dün');
    expect(relativeDay('2026-11-20', now)).toBe('Cuma');
    expect(relativeDay('2026-11-13', now)).toBe('3 gün önce');
    expect(relativeDay('2026-12-25', now)).toBe('25 Aralık');
    expect(relativeDay(at(2026, 11, 16, 23, 59), now)).toBe('bugün');
    expect(relativeDay(at(2026, 11, 17, 0, 1), now)).toBe('yarın');
  });

  it('relativeDateTime', () => {
    expect(relativeDateTime(at(2026, 11, 17, 10, 0), now)).toBe('yarın 10:00');
    expect(relativeDateTime(at(2026, 11, 16, 14, 30), now)).toBe('bugün 14:30');
    expect(relativeDateTime(at(2027, 1, 4, 9, 5), now)).toBe('4 Ocak 2027 09:05');
  });

  it('relativeTime', () => {
    expect(relativeTime(at(2026, 11, 16, 10, 0), now)).toBe('az önce');
    expect(relativeTime(new Date(now.getTime() + 20_000), now)).toBe('birazdan');
    expect(relativeTime(at(2026, 11, 16, 9, 55), now)).toBe('5 dk önce');
    expect(relativeTime(at(2026, 11, 16, 12, 0), now)).toBe('2 saat sonra');
    expect(relativeTime(at(2026, 11, 13, 10, 0), now)).toBe('3 gün önce');
    expect(relativeTime(at(2026, 10, 1, 10, 0), now)).toBe('1 Ekim');
  });
});

describe('isWithinLocalTimeRange', () => {
  it('aynı gün içindeki aralık', () => {
    expect(isWithinLocalTimeRange(at(2026, 1, 1, 13, 0), '12:00', '14:00')).toBe(true);
    expect(isWithinLocalTimeRange(at(2026, 1, 1, 14, 0), '12:00', '14:00')).toBe(false);
  });

  it('gece yarısını aşan aralık', () => {
    expect(isWithinLocalTimeRange(at(2026, 1, 1, 23, 30), '22:00', '08:00')).toBe(true);
    expect(isWithinLocalTimeRange(at(2026, 1, 1, 7, 59), '22:00', '08:00')).toBe(true);
    expect(isWithinLocalTimeRange(at(2026, 1, 1, 8, 0), '22:00', '08:00')).toBe(false);
    expect(isWithinLocalTimeRange(at(2026, 1, 1, 12, 0), '22:00', '08:00')).toBe(false);
  });
});

describe('nextOccurrence', () => {
  const first = at(2026, 11, 16, 9, 0); // Pazartesi 09:00

  it('günlük: saati korur ve after sonrasını verir', () => {
    expect(nextOccurrence({ freq: 'daily', interval: 1 }, first, first)).toEqual(at(2026, 11, 17, 9, 0));
    expect(nextOccurrence({ freq: 'daily', interval: 1 }, first, at(2026, 11, 20, 8, 0))).toEqual(
      at(2026, 11, 20, 9, 0),
    );
    expect(nextOccurrence({ freq: 'daily', interval: 1 }, first, at(2026, 11, 20, 9, 0))).toEqual(
      at(2026, 11, 21, 9, 0),
    );
    expect(nextOccurrence({ freq: 'daily', interval: 3 }, first, at(2026, 11, 20, 12, 0))).toEqual(
      at(2026, 11, 22, 9, 0),
    );
  });

  it('after ilk andan önceyse ilk anı verir', () => {
    expect(nextOccurrence({ freq: 'daily', interval: 1 }, first, at(2026, 11, 10, 0, 0))).toEqual(first);
    expect(nextOccurrence({ freq: 'monthly', interval: 1 }, first, at(2026, 11, 16, 8, 59))).toEqual(first);
  });

  it('haftalık: gün listesi ve aralık', () => {
    expect(nextOccurrence({ freq: 'weekly', interval: 1 }, first, first)).toEqual(at(2026, 11, 23, 9, 0));
    expect(nextOccurrence({ freq: 'weekly', interval: 1, weekdays: [1, 5] }, first, first)).toEqual(
      at(2026, 11, 20, 9, 0),
    );
    expect(nextOccurrence({ freq: 'weekly', interval: 2, weekdays: [1, 5] }, first, at(2026, 11, 20, 9, 0))).toEqual(
      at(2026, 11, 30, 9, 0),
    );
  });

  it('aylık: olmayan günü ayın sonuna çeker, sonraki ayda asıl güne döner', () => {
    const jan31 = at(2026, 1, 31, 10, 0);
    expect(nextOccurrence({ freq: 'monthly', interval: 1 }, jan31, jan31)).toEqual(at(2026, 2, 28, 10, 0));
    expect(nextOccurrence({ freq: 'monthly', interval: 1 }, jan31, at(2026, 2, 28, 10, 0))).toEqual(
      at(2026, 3, 31, 10, 0),
    );
    expect(nextOccurrence({ freq: 'monthly', interval: 3 }, first, at(2027, 1, 1))).toEqual(at(2027, 2, 16, 9, 0));
  });

  it('yıllık ve until', () => {
    expect(nextOccurrence({ freq: 'yearly', interval: 1 }, first, first)).toEqual(at(2027, 11, 16, 9, 0));
    const until = at(2026, 11, 18, 0, 0).toISOString();
    expect(nextOccurrence({ freq: 'daily', interval: 1, until }, first, first)).toEqual(at(2026, 11, 17, 9, 0));
    expect(nextOccurrence({ freq: 'daily', interval: 1, until }, first, at(2026, 11, 17, 9, 0))).toBeNull();
  });
});

describe('describeRecurrence', () => {
  it('Türkçe özet üretir', () => {
    expect(describeRecurrence({ freq: 'daily', interval: 1 })).toBe('her gün');
    expect(describeRecurrence({ freq: 'weekly', interval: 2, weekdays: [5, 1] })).toBe(
      '2 haftada bir Pazartesi ve Cuma',
    );
    expect(describeRecurrence({ freq: 'monthly', interval: 1 })).toBe('her ay');
    expect(describeRecurrence({ freq: 'yearly', interval: 1 })).toBe('her yıl');
  });
});
