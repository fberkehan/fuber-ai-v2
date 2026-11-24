import { describe, expect, it } from 'vitest';
import { toSpokenTurkish } from '../../worker/tr-speech';
import { detectEcho, isOwnSentenceStart, sameWord } from './echo-filter';

const lenient = { lenient: true, normalize: toSpokenTurkish };
const strict = { lenient: false, normalize: toSpokenTurkish };

/** Bir sınama oturumundan: Jarvis'in seslendirdiği metin ve ardından "kullanıcı sözü" diye yazıya geçen. */
const REAL = [
  {
    spoken: 'Bulut hesabında kredi yok; bu bilgisayardaki modelle çalışıyorum. Efendim, teşekkür ederim, iyiyim. Siz nasılsınız?',
    heard: 'Bu bilgisayardaki modelle çalışıyorum. Efendim teşekkür ederim, iyiyim. Siz nasılsınız?',
  },
  {
    spoken: "Efendim, özür dilerim. Efendim, hatırlatıcıyı kurdum. Bugün akşam 20:00'de çalacak. Umarım işinize yarar.",
    heard: 'Bunun işinize yarar.',
  },
];

describe('metin düzeyinde yankı süzgeci', () => {
  it.each(REAL)('gerçek örnek tur açmaz: "$heard"', ({ spoken, heard }) => {
    expect(detectEcho(heard, spoken, lenient)).toMatchObject({ kind: 'echo', rest: '' });
  });

  it('birinci gerçek örnek sıkı eşikte de yankıdır (sözcüklerin tamamı örtüşür)', () => {
    const verdict = detectEcho(REAL[0]?.heard ?? '', REAL[0]?.spoken ?? '', strict);
    expect(verdict.kind).toBe('echo');
    expect(verdict.coverage).toBe(1);
  });

  it('ikinci gerçek örnekte Whisper\'ın uydurduğu "Bunun" seslendirilen "Bugün"e denk gelir: sıkı eşikte de yankıdır', () => {
    expect(detectEcho(REAL[1]?.heard ?? '', REAL[1]?.spoken ?? '', strict)).toMatchObject({ kind: 'echo', matched: 3 });
    // Aynı kuyruk başka bir cümlenin ardından gelirse üç sözcüğün ikisi eşleşir: yalnız gevşek eşik yakalar.
    expect(detectEcho('Bunun işinize yarar.', 'Hatırlatıcıyı kurdum. Umarım işinize yarar.', strict).kind).toBe('none');
    expect(detectEcho('Bunun işinize yarar.', 'Hatırlatıcıyı kurdum. Umarım işinize yarar.', lenient).kind).toBe('echo');
  });

  it('onay sorusuna verilen tek sözcüklük yanıt yankı sayılmaz ("Onaylıyor musunuz?" → "Onaylıyorum")', () => {
    expect(detectEcho('Onaylıyorum', 'Dosya silinecek. Onaylıyor musunuz?', lenient).kind).toBe('none');
    expect(detectEcho('Evet, onaylıyorum.', 'Dosya silinecek. Onaylıyor musunuz?', lenient).kind).toBe('none');
    expect(detectEcho('Hayır', 'Anlayamadım. Evet ya da hayır der misiniz?', { ...lenient, tail: false }).kind).toBe('none');
  });

  it('rakamla seslendirilen metin, okunuşuyla yazıya çevrilen yankıyla eşleşir', () => {
    const spoken = "Hatırlatıcıyı kurdum. Bugün akşam 20:00'de çalacak.";
    expect(detectEcho('Bugün akşam yirmide çalacak.', spoken, strict).kind).toBe('echo');
    expect(detectEcho("Bugün akşam 20.00'de çalacak.", spoken, strict).kind).toBe('echo');
    expect(detectEcho('Bugün 16 Kasım 2026.', 'Bugün on altı Kasım iki bin yirmi altı.', strict).kind).toBe('echo');
  });

  it('Whisper\'ın bir-iki harflik sapması ve ek farkı eşleşmeyi bozmaz', () => {
    const spoken = 'Yarın güneşli olacak efendim, sıcaklık yirmi derece civarında.';
    expect(detectEcho('Yarın güneşli olacak efendi, sıcaklık yirmi derece civarı', spoken, strict).kind).toBe('echo');
    expect(sameWord('bilgisayardaki', 'bilgisayarda')).toBe(true);
    expect(sameWord('calisiyorum', 'calisiyoruz')).toBe(true);
    expect(sameWord('bu', 'bulut')).toBe(false);
    expect(sameWord('isime', 'isinize')).toBe(false);
  });

  it('yankının ardından gelen kullanıcı sözü ayrılır', () => {
    const spoken = REAL[1]?.spoken ?? '';
    expect(detectEcho('Umarım işinize yarar. Peki yarın hava nasıl olacak?', spoken, lenient)).toMatchObject({
      kind: 'partial',
      rest: 'Peki yarın hava nasıl olacak?',
    });
    expect(detectEcho('işinize yarar, tamam teşekkürler', spoken, lenient)).toMatchObject({ kind: 'partial', rest: 'tamam teşekkürler' });
  });

  it('kullanıcının sözünde geçen ortak sözcük yankıyı uzatmaz ("bugün")', () => {
    const spoken = 'Hatırlatıcıyı kurdum. Bugün akşam yirmide çalacak.';
    expect(detectEcho('yirmide çalacak. Bugün değil yarın çalsın', spoken, lenient)).toMatchObject({
      kind: 'partial',
      rest: 'Bugün değil yarın çalsın',
    });
  });

  it.each([
    ['Saat ustası mı dedin?', 'Bir zamanlar küçük bir sahil kasabasında yaşlı bir saat ustası yaşarmış.'],
    ['Evet, işime yarar.', 'Umarım işinize yarar.'],
    ['Yarın saat onda KDV beyannamesini hatırlat', 'Tamam efendim. Yarın saat onda hatırlatacağım.'],
    ['Teşekkür ederim. Sesli modeli kapatabilirsin.', 'Efendim, teşekkür ederim, iyiyim. Siz nasılsınız?'],
  ])('kullanıcının kendi sözü sıkı eşikte yankı sayılmaz: "%s"', (heard, spoken) => {
    expect(detectEcho(heard, spoken, strict)).toMatchObject({ kind: 'none', rest: heard });
  });

  it.each([
    ['Ankara\'nın hava durumunu bana bir söyler misin?', 'Efendim, teşekkür ederim, iyiyim. Nasıl yardımcı olabilirim?'],
    ['Bu akşam bir şey yapma', "Bugün akşam 20:00'de çalacak. Umarım işinize yarar."],
    ['Ben de iyiyim', 'Efendim, teşekkür ederim, iyiyim. Siz nasılsınız?'],
  ])('ilgisiz söz gevşek eşikte de yankı sayılmaz: "%s"', (heard, spoken) => {
    expect(detectEcho(heard, spoken, lenient).kind).toBe('none');
  });

  it('kuyruk kuralı: tek sözcük, seslendirilen metnin son sözcüklerindense yankıdır; ortasındansa değildir', () => {
    const spoken = 'Hatırlatıcıyı kurdum. Bugün akşam yirmide çalacak. Umarım işinize yarar.';
    expect(detectEcho('Yarar.', spoken, lenient).kind).toBe('echo');
    expect(detectEcho('Hatırlatıcıyı', spoken, lenient).kind).toBe('none');
    expect(detectEcho('Yarar.', spoken, { ...lenient, tail: false }).kind).toBe('none');
    expect(detectEcho('Yarar.', spoken, strict).kind).toBe('none');
  });

  it('boş söz ve boş seslendirme yankı değildir; uzun yanıtta yalnız son bölüm karşılaştırılır', () => {
    expect(detectEcho('', 'bir şey', lenient).kind).toBe('none');
    expect(detectEcho('saat kaç', '', lenient)).toMatchObject({ kind: 'none', rest: 'saat kaç' });
    const long = `${'eski cümle burada bitti. '.repeat(120)}Son olarak şunu söyleyeyim efendim.`;
    expect(detectEcho('Son olarak şunu söyleyeyim efendim.', long, strict).kind).toBe('echo');
  });
});

describe('Jarvis kendini mi kesti (konuşmayı kesen söz, kesilen cümlenin başı mı)', () => {
  const sentences = ['Bulut hesabında kredi yok; bu bilgisayardaki modelle çalışıyorum.', 'Yarın güneşli olacak efendim.'];

  // Düzeltme öncesi uçtan uca koşuda (sızıntı benzetimi, söz kesme `voice`) art arda açılan sahte turların dökümleri.
  it.each(['Bulut hırı.', 'Yarın güneşin...', 'Yarın günü...', 'Yarın güneşe.', 'Yarın güneyde', 'Yarın güne', 'Yarın', 'Bulut hesabında'])(
    'cümlenin yarım başı: "%s"',
    (heard) => {
      expect(isOwnSentenceStart(heard, sentences, toSpokenTurkish)).toBe(true);
    },
  );

  it.each(['Yarın değil bugün', 'Bulut ne demek?', 'Sus.', 'Bir dakika, başka bir şey soracağım.', 'Yarın güneşli olacak efendim ama ben sormadım ki'])(
    'kullanıcının sözü: "%s"',
    (heard) => {
      expect(isOwnSentenceStart(heard, sentences, toSpokenTurkish)).toBe(false);
    },
  );
});
