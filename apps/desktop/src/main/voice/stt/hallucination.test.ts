import { describe, expect, it } from 'vitest';
import { filterTranscript, joinSegments, preFilter, rmsOf, type RawTranscript } from './hallucination';

const raw = (text: string, extra: Partial<RawTranscript> = {}): RawTranscript => ({
  text,
  noSpeechProb: null,
  languageProbabilities: null,
  ...extra,
});

/** `seconds` saniyelik, `amplitude` genlikli 220 Hz ton. */
function tone(seconds: number, amplitude: number): Int16Array {
  const pcm = new Int16Array(Math.round(seconds * 16_000));
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.round(Math.sin((2 * Math.PI * 220 * i) / 16_000) * amplitude * 32767);
  return pcm;
}

describe('bölüt ön süzgeci', () => {
  it('çok kısa ve çok sessiz bölütü motora göndermez', () => {
    expect(preFilter(tone(0.1, 0.3))).toBe('too_short');
    expect(preFilter(new Int16Array(16_000))).toBe('too_quiet');
    expect(preFilter(tone(1, 0.001))).toBe('too_quiet');
    expect(preFilter(tone(0.4, 0.1))).toBeNull();
  });

  it('RMS 0–1 aralığında ölçülür', () => {
    expect(rmsOf(new Int16Array(0))).toBe(0);
    expect(rmsOf(tone(1, 0.5))).toBeCloseTo(0.5 / Math.SQRT2, 2);
  });
});

describe('halüsinasyon süzgeci', () => {
  it.each([
    ' Altyazı M.K.\n',
    'Altyazı',
    'İzlediğiniz için teşekkürler.',
    'İzlediğiniz için teşekkür ederim',
    'Bir sonraki videoda görüşmek üzere.',
    'Abone olmayı unutmayın',
    'Thanks for watching!',
    '[Müzik]',
    '(alkış)',
    '♪♪',
    'Çeviri: Ahmet Y.',
  ])('bilinen kalıp atılır: "%s"', (text) => {
    const result = filterTranscript(raw(text), 3000);
    expect(result.text).toBe('');
    expect(result.dropped === 'pattern' || result.dropped === 'empty').toBe(true);
  });

  it.each(['', '   ', '...', '. , !', '♪'])('söz içermeyen döküm boştur: "%s"', (text) => {
    expect(filterTranscript(raw(text), 3000)).toEqual({ text: '', dropped: 'empty' });
  });

  it('gerçek sözü olduğu gibi (boşlukları toplanmış) geçirir', () => {
    expect(filterTranscript(raw(' Carvis,\n yarın saat 10’da hatırlat.\n'), 4000)).toEqual({
      text: 'Carvis, yarın saat 10’da hatırlat.',
      dropped: null,
    });
    // Kalıp yalnız dökümün tamamıyken atılır; içinde geçmesi yetmez.
    expect(filterTranscript(raw('Bu videonun altyazısını bulur musun'), 3000).dropped).toBeNull();
    expect(filterTranscript(raw('İzlediğiniz için teşekkürler demeyi unutma'), 3000).dropped).toBeNull();
  });

  it('ses betimlemesini atıp sözü bırakır', () => {
    expect(filterTranscript(raw('[Müzik] Saat kaç?'), 3000).text).toBe('Saat kaç?');
  });

  it('modelin "söz yok" olasılığı yüksekse atar', () => {
    expect(filterTranscript(raw('Evet', { noSpeechProb: 0.9 }), 3000).dropped).toBe('no_speech');
    expect(filterTranscript(raw('Evet', { noSpeechProb: 0.1 }), 3000).dropped).toBeNull();
  });

  it('dil belirsizse (sessizlik, gürültü) uzun bölütü atar', () => {
    // Ölçülen değerler: beyaz gürültü tr 0,014 + en 0,367; sessizlik tr 0,024 + en 0,392.
    expect(filterTranscript(raw('Körnönger', { languageProbabilities: { tr: 0.014, en: 0.367, es: 0.149 } }), 3000).dropped).toBe(
      'language',
    );
    expect(filterTranscript(raw('Yarın hatırlat', { languageProbabilities: { tr: 0.72, en: 0.15 } }), 3000).dropped).toBeNull();
    expect(filterTranscript(raw('Open the door', { languageProbabilities: { tr: 0.02, en: 0.93 } }), 3000).dropped).toBeNull();
  });

  it('kısa bölütte dil sınaması yapmaz: "sus" gibi tek sözcükte dil tahmini güvenilmezdir', () => {
    expect(filterTranscript(raw('Sus', { languageProbabilities: { tr: 0.3, en: 0.16 } }), 730).dropped).toBeNull();
  });
});

describe('Whisper bölütlerinin birleştirilmesi', () => {
  // whisper-server yanıtı biçiminde uydurma bir örnek (uzun bir söz): bölüt sınırı zaman damgasına göre konur ve sözcük
  // ortasına düşebilir.
  const SAMPLE = [
    ' Sesin bugün çok daha net geliyor. Şu anda hiçbir ayar değiştirm',
    'eden seni dinliyorum. Yarın sabah toplantıya hazırlan',
    'mam gerekiyor, sen de bunu bilmelisin.',
    ' Kargomun durumunu sonra soracağım. Önce yarınki hava',
    ' tahminini öğrenmek istiyorum. Sonra da takvimimdeki toplantı',
    'ları okumanı istiyorum.',
  ];

  it('sözcüğün ortasına düşen bölüt sınırı boşluk olmaz (örnek yanıt)', () => {
    const text = joinSegments(SAMPLE).trim();
    expect(text).toBe(
      'Sesin bugün çok daha net geliyor. Şu anda hiçbir ayar değiştirmeden seni dinliyorum. Yarın sabah toplantıya hazırlanmam ' +
        'gerekiyor, sen de bunu bilmelisin. Kargomun durumunu sonra soracağım. Önce yarınki hava tahminini öğrenmek istiyorum. ' +
        'Sonra da takvimimdeki toplantıları okumanı istiyorum.',
    );
  });

  it.each([
    [['takvim', 'imdeki'], 'takvimimdeki'],
    [['dinl', 'iyorum.'], 'dinliyorum.'],
    [[' ben hazırl', 'anacağım'], ' ben hazırlanacağım'],
    [[' yarınki hav', 'a durumu'], ' yarınki hava durumu'],
    [[' bunu bil', 'melisin,'], ' bunu bilmelisin,'],
    [[' kargoyu sor', 'acağım.'], ' kargoyu soracağım.'],
    [[' toplantı', 'ları, saatlerini'], ' toplantıları, saatlerini'],
  ])('sözcük ortasından bölünme: %j → "%s"', (segments, expected) => {
    expect(joinSegments(segments)).toBe(expected);
  });

  it('yeni sözcükle başlayan bölüt kendi boşluğunu taşır; cümle sonundan sonra boşluksuz başlayan bölüte boşluk eklenir', () => {
    expect(joinSegments([' Saat kaç?', ' Yarın hava nasıl?'])).toBe(' Saat kaç? Yarın hava nasıl?');
    expect(joinSegments([' Saat kaç?', 'Yarın hava nasıl?'])).toBe(' Saat kaç? Yarın hava nasıl?');
    expect(joinSegments(['', ' Tamam.', ''])).toBe(' Tamam.');
    expect(joinSegments([])).toBe('');
  });

  it('süzgeç birleştirilmiş metni bozmaz', () => {
    expect(filterTranscript(raw(joinSegments(SAMPLE)), 19_000).text).toContain('değiştirmeden seni dinliyorum');
  });
});
