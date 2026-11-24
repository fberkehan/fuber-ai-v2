import { describe, expect, it } from 'vitest';
import { fold, hitRanges, matches, tokens } from './search';

describe('ayar araması', () => {
  it('Türkçe harfleri katlar ve uzunluğu korur', () => {
    expect(fold('Kısayollar')).toBe('kisayollar');
    expect(fold('IŞIK İÇİN Öğüt')).toBe('isik icin ogut');
    for (const sample of ['Windows’la başlat', 'Gizlilik ve veri', 'İLK ÇAĞRI', 'şûra']) expect(fold(sample)).toHaveLength(sample.length);
  });

  it('aksansız yazılan sorgu aksanlı metni bulur', () => {
    expect(matches('Uyandırma sözü', tokens('uyandirma'))).toBe(true);
    expect(matches('Sessiz saatler', tokens('SESSİZ'))).toBe(true);
    expect(matches('Sessiz saatler', tokens('mikrofon'))).toBe(false);
  });

  it('bütün sözcükler aranır, sıra önemsizdir', () => {
    expect(matches('Mikrofonu sına: 3 saniye dinler', tokens('sina mikrofon'))).toBe(true);
    expect(matches('Mikrofonu sına', tokens('mikrofon yankı'))).toBe(false);
  });

  it('vurgu aralıkları özgün metne oturur ve çakışanlar birleşir', () => {
    const text = 'Kısayol kaydı: kısa bir kayıt';
    const ranges = hitRanges(text, tokens('kisa'));
    expect(ranges.map(([from, to]) => text.slice(from, to))).toEqual(['Kısa', 'kısa']);
    expect(hitRanges('aaaa', ['aa', 'aaa'])).toEqual([[0, 4]]);
    expect(hitRanges('Hitap', tokens(''))).toEqual([]);
  });
});
