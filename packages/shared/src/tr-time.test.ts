import { describe, expect, it } from 'vitest';
import { resolveTurkishTime } from './tr-time';

// Pazartesi 5 Ekim 2026, 10:20 (yerel saat). Fuber AI 1'in testindeki an ve beklenen sonuçlar (tests/tr-zaman.test.ts).
const NOW = new Date(2026, 9, 5, 10, 20);
const pad = (n: number) => String(n).padStart(2, '0');
const stamp = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const at = (text: string, now = NOW) => {
  const result = resolveTurkishTime(text, now);
  return result ? stamp(result.at) : null;
};

describe('Türkçe zaman çözücü (Fuber AI 1 ile aynı sonuçlar)', () => {
  it('yarın / gün adı / tarih + saat; "3’te" iş saati; geçen saat yarına, bugünün gün adı gelecek haftaya kayar', () => {
    expect(at('Yarın 14:00’te Atlas Gıda toplantısını hatırlat.')).toBe('2026-10-06 14:00');
    expect(at('Perşembe 16:00’da Murat’la bütçe toplantısı var, hatırlat.')).toBe('2026-10-08 16:00');
    expect(at('cuma 16:00')).toBe('2026-10-09 16:00');
    expect(at('24 Ekim 15:00')).toBe('2026-10-24 15:00');
    expect(at('haftaya salı 3’te')).toBe('2026-10-13 15:00');
    expect(at('pazartesi 9’a')).toBe('2026-10-12 09:00');
    expect(at('akşam 8’de ara')).toBe('2026-10-05 20:00');
    expect(at('saat 9')).toBe('2026-10-06 09:00');
    expect(at('2 saat sonra')).toBe('2026-10-05 12:20');
    expect(at('yarım saat sonra')).toBe('2026-10-05 10:50');
    const day = resolveTurkishTime('yarın', NOW)!;
    expect(stamp(day.at)).toBe('2026-10-06 09:00');
    expect(day.hasTime).toBe(false);
  });

  it('tekrar ve "bir gün önce"; geçmiş tarih gelecek yıla; anlaşılmayan metin null (uydurmaz)', () => {
    const weekly = resolveTurkishTime('Her pazartesi 10:30’da haftalık raporu hazırlamamı hatırlat.', NOW)!;
    expect(stamp(weekly.at)).toBe('2026-10-05 10:30');
    expect(weekly.recurrence).toBe('weekly');
    expect(resolveTurkishTime('her gün 9:00', NOW)!.recurrence).toBe('daily');
    const show = resolveTurkishTime('Kızım Ada’nın okul gösterisi 24 Ekim cumartesi 15:00’te. O gün öğleden sonrayı boş tut, bir gün önce de hatırlat.', NOW)!;
    expect(stamp(show.at)).toBe('2026-10-23 15:00');
    expect(stamp(show.event!)).toBe('2026-10-24 15:00');
    expect(at('3 Ocak')).toBe('2027-01-03 09:00');
    for (const text of ['merhaba', 'Q4 bütçesi 48 milyon', '5 madde olsun', 'Raporları hatırlıyor musun?', 'bir de şunu söyleyeyim', 'Ses modelin baya gelişmiş']) {
      expect(resolveTurkishTime(text, NOW), text).toBeNull();
    }
  });
});

describe('sesten yazıya çevrilen söz (sözcükle saat, ayın günü)', () => {
  it('sözcükle saat: "saat onda", "dokuzda", "akşam sekiz gibi", "buçuk"', () => {
    expect(at('yarın saat onda KDV beyannamesini hatırlat')).toBe('2026-10-06 10:00');
    expect(at('yarın sabah dokuzda toplantıyı hatırlat')).toBe('2026-10-06 09:00');
    expect(at('yarın on birde doktoru ara')).toBe('2026-10-06 11:00');
    expect(at('akşam sekiz buçukta haber ver')).toBe('2026-10-05 20:30');
    expect(at('öğleden sonra üçte')).toBe('2026-10-05 15:00');
    // Uzun, dağınık bir sesli söz; an: Pazartesi 16 Kasım 2026, 12:38.
    const monday = new Date(2026, 10, 16, 12, 38);
    expect(at('Mesela bugün unutma, kargo firmasına önemli bir şey soracağım. Evle alakalı bir mesele. Lütfen bunu bana hatırlat bugün. Akşam sekiz gibi falan.', monday)).toBe('2026-11-16 20:00');
    expect(at('Akşam sekizde kuaförü aramamı hatırlat', monday)).toBe('2026-11-16 20:00');
  });

  it('ayın günü: "her ayın 28\'inde" aylık tekrar ve bir sonraki 28; gün geçtiyse gelecek ay', () => {
    const monthly = resolveTurkishTime("her ayın 28'inde KDV beyannamesini vermemi hatırlat", NOW)!;
    expect(stamp(monthly.at)).toBe('2026-10-28 09:00');
    expect(monthly.recurrence).toBe('monthly');
    expect(monthly.hasTime).toBe(false);
    expect(at("ayın 3'ünde kirayı öde")).toBe('2026-11-03 09:00');
    expect(at("her ayın 5'i saat 10'da", new Date(2026, 9, 5, 10, 20))).toBe('2026-11-05 10:00');
    expect(at("her ayın 28'i saat 10", new Date(2026, 10, 16, 12, 0))).toBe('2026-11-28 10:00');
  });
});
