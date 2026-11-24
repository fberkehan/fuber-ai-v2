import { describe, expect, it } from 'vitest';
import { SentenceSplitter, splitSentences } from './sentence-splitter';

/** Metni verilen boyutta parçalara bölüp akış gibi besler. */
function stream(text: string, chunk: number): string[] {
  const splitter = new SentenceSplitter();
  const out: string[] = [];
  for (let i = 0; i < text.length; i += chunk) {
    out.push(...splitter.push(text.slice(i, i + chunk)));
  }
  out.push(...splitter.flush());
  return out;
}

describe('SentenceSplitter', () => {
  it('düz cümleleri ayırır', () => {
    expect(splitSentences('Tabii efendim. Hatırlatıcıyı kurdum! Başka bir şey var mı?')).toEqual([
      'Tabii efendim.',
      'Hatırlatıcıyı kurdum!',
      'Başka bir şey var mı?',
    ]);
  });

  it('cümleyi ardındaki boşluk gelir gelmez verir, akışın bitmesini beklemez', () => {
    const splitter = new SentenceSplitter();
    expect(splitter.push('Tamam efendim.')).toEqual([]);
    expect(splitter.push(' ')).toEqual(['Tamam efendim.']);
    expect(splitter.push('Yarın saat onda')).toEqual([]);
    expect(splitter.flush()).toEqual(['Yarın saat onda']);
  });

  it('parça boyutundan bağımsız aynı sonucu üretir', () => {
    const text =
      'Dr. Ayşe Hanım saat 10.30 için randevu verdi. Fuber A.Ş. adına 3. kattaki ofiste, yani example.com ekibiyle görüşeceksiniz. Toplam 1.250,50 TL ödenecek... ama acele yok. Hazır mısınız?';
    const expected = splitSentences(text);
    for (const size of [1, 2, 3, 7, 16, 64]) {
      expect(stream(text, size)).toEqual(expected);
    }
    expect(expected).toEqual([
      'Dr. Ayşe Hanım saat 10.30 için randevu verdi.',
      'Fuber A.Ş. adına 3. kattaki ofiste, yani example.com ekibiyle görüşeceksiniz.',
      'Toplam 1.250,50 TL ödenecek... ama acele yok.',
      'Hazır mısınız?',
    ]);
  });

  it('kısaltmalarda bölmez', () => {
    expect(splitSentences('Prof. Dr. Mehmet Bey aradı. Elma, armut vb. şeyler aldım.')).toEqual([
      'Prof. Dr. Mehmet Bey aradı.',
      'Elma, armut vb. şeyler aldım.',
    ]);
    expect(splitSentences('M. Kemal Atatürk 1881 yılında doğdu.')).toEqual(['M. Kemal Atatürk 1881 yılında doğdu.']);
    expect(splitSentences('Bunu T.C. kimlik numaranızla yaparsınız.')).toEqual([
      'Bunu T.C. kimlik numaranızla yaparsınız.',
    ]);
  });

  it('sayı, saat ve sıra sayısında bölmez', () => {
    expect(splitSentences('Oran yüzde 3.5 oldu. Saat 09.45 gibi çıkarız.')).toEqual([
      'Oran yüzde 3.5 oldu.',
      'Saat 09.45 gibi çıkarız.',
    ]);
    expect(splitSentences('Toplantı 2. katta olacak.')).toEqual(['Toplantı 2. katta olacak.']);
    expect(splitSentences('Bu 2. Dünya Savaşı belgeseli.')).toEqual(['Bu 2. Dünya Savaşı belgeseli.']);
  });

  it('uzun sayıdan sonra büyük harf gelirse böler, küçük harf gelirse bölmez', () => {
    expect(splitSentences('Kuruluş yılı 2019. Sonra büyüdük.')).toEqual(['Kuruluş yılı 2019.', 'Sonra büyüdük.']);
    expect(splitSentences('Madde 105. fıkrayı okuyun.')).toEqual(['Madde 105. fıkrayı okuyun.']);
  });

  it('üç noktada devam küçük harfle ise bölmez', () => {
    expect(splitSentences('Şey... sanırım olur. Peki… Başlayalım.')).toEqual([
      'Şey... sanırım olur.',
      'Peki…',
      'Başlayalım.',
    ]);
  });

  it('kapanış tırnağını cümleye dahil eder', () => {
    expect(splitSentences('“Hazırım.” dedi ve çıktı. (Sonra döndü.) Bitti.')).toEqual([
      '“Hazırım.” dedi ve çıktı.',
      '(Sonra döndü.)',
      'Bitti.',
    ]);
  });

  it('satır sonunu cümle sonu sayar ve boş parçaları atar', () => {
    expect(splitSentences('Birinci satır\nİkinci satır.\n\n...\nÜçüncü')).toEqual([
      'Birinci satır',
      'İkinci satır.',
      'Üçüncü',
    ]);
  });

  it('çok uzun cümleyi virgülden böler', () => {
    const long =
      'Bugün önce muhasebeciyle görüşeceksiniz, ardından bankaya uğrayıp imza sirkülerini teslim edeceksiniz, ' +
      'öğleden sonra da yeni ofisin sözleşmesini inceleyip avukata göndereceksiniz ve akşam yemeğinde yatırımcıyla buluşacaksınız';
    const parts = new SentenceSplitter({ maxChars: 100 }).push(long);
    expect(parts.length).toBeGreaterThanOrEqual(2);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(100);
    expect(parts[0]).toBe('Bugün önce muhasebeciyle görüşeceksiniz,');
    expect(parts[1]!.endsWith(',')).toBe(true);
  });

  it('reset bekleyen metni atar', () => {
    const splitter = new SentenceSplitter();
    splitter.push('Yarım kalan cümle');
    splitter.reset();
    expect(splitter.pending).toBe('');
    expect(splitter.flush()).toEqual([]);
  });
});
