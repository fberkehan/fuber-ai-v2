import { describe, expect, it } from 'vitest';
import {
  createWakeMatcher,
  foldSpeech,
  farewellOf,
  isEndOfConversation,
  isStartOfConversation,
  isStopCommand,
  stopWordsSpoken,
  learnableSpelling,
  soundKey,
} from './text-match';

const matcher = createWakeMatcher(['hey jarvis'], 'Jarvis');

describe('foldSpeech', () => {
  it('Türkçe büyük harfleri ve aksanları düz Latin küçük harfe indirir', () => {
    expect(foldSpeech('ÇARVİS IŞIK Öğle Süs')).toBe('carvis isik ogle sus');
    expect(foldSpeech('Hâlâ kâğıt')).toBe('hala kagit');
  });
});

describe('uyandırma dökümü', () => {
  it.each([
    ['Jarvis', ''],
    ['Jarvis.', ''],
    ['Hey Jarvis', ''],
    ['Hey, Jarvis!', ''],
    ['Carvis, saat kaç?', 'saat kaç?'],
    ['Cervis saat kaç', 'saat kaç'],
    ['Çarvis, yarın saat onda KDV beyannamesini hatırlat.', 'yarın saat onda KDV beyannamesini hatırlat.'],
    ['Jarvıs ışıkları kapat', 'ışıkları kapat'],
    ['JARVİS', ''],
    ['Hey Carviz, hava nasıl', 'hava nasıl'],
    ['Heycarvis müzik aç', 'müzik aç'],
    ['Hay Çarvis', ''],
    ['Jarvis\n Yarın saat 10’da hatırlat', 'Yarın saat 10’da hatırlat'],
  ])('"%s" uyandırır, kalan "%s"', (text, rest) => {
    const match = matcher.match(text);
    expect(match.matched).toBe(true);
    expect(match.rest).toBe(rest);
    expect(match.phrase).toBe('hey jarvis');
  });

  it('Whisper’ın tek harf saptığı yazımları da ad sayar', () => {
    for (const text of ['Jarlis, salı günü toplantım var', 'Javis saat kaç', 'Hey Jarvi']) {
      expect(matcher.match(text).matched, text).toBe(true);
    }
  });

  it.each([
    "Jarvis'e söyle yarın gelsin",
    'Jarvis’in sesi güzel',
    "Carvis'i kapat",
    'Jarvise söyle yarın gel',
    'Carvisi çağır',
    'Jarvisle konuştum',
    'Bugün Jarvis ile konuştum',
    'Servis ne zaman gelecek',
    'Çarşıya gidiyorum',
    'Hey sen',
    'Merhaba',
    '',
    '...',
  ])('"%s" uyandırmaz (ek almış ad ya da başka söz)', (text) => {
    expect(matcher.match(text).matched).toBe(false);
  });

  it.each([
    ["Jarvis'cim, saat kaç?", 'saat kaç?'],
    ['Jarvisciğim bir bakar mısın', 'bir bakar mısın'],
    ["Carvis'çim", ''],
    ['Tamam Jarvis, şimdi şunu yap', 'şimdi şunu yap'],
    ['Alo Carvis', ''],
    ['Günaydın Jarvis', ''],
    ['Ee Jarvis hava nasıl', 'hava nasıl'],
  ])('d6: seslenme eki ve gündelik önekle "%s" uyandırır, kalan "%s"', (text, rest) => {
    const match = matcher.match(text);
    expect(match.matched, text).toBe(true);
    expect(match.rest).toBe(rest);
  });

  it.each(["Jarvis'imi kapat", 'Tamam servis geldi', 'Merhaba nasılsın', "Tamam Jarvis'e söylerim", 'Ecarvis'])('d6: "%s" uyandırmaz', (text) => {
    expect(matcher.match(text).matched).toBe(false);
  });

  it('politikadaki başka bir adı ve önekini de tanır', () => {
    const other = createWakeMatcher(['selam fuber'], 'Fuber');
    expect(other.match('Selam Fuber, not al').rest).toBe('not al');
    expect(other.match('Fuber not al').matched).toBe(true);
    expect(other.match("Fuber'e sor").matched).toBe(false);
    expect(other.match('Jarvis not al').matched).toBe(false);
  });

  it('ses anahtarı beklenen yazımları tek anahtara indirir', () => {
    const keys = ['Jarvis', 'Carvis', 'Cervis', 'Çarvis', 'Jarvıs', 'Jervis', 'Djarvis', 'Charvis', 'Carviz'].map(soundKey);
    expect(new Set(keys).size).toBe(1);
    expect(soundKey('servis')).not.toBe(soundKey('jarvis'));
  });

  it('sezicinin duyduğu sözü dökümün başından gevşek eşleşmeyle ayıklar', () => {
    expect(matcher.stripHeard('Hey Javis Yarın saat 10’da hatırlat.', 'hey jarvis')).toBe('Yarın saat 10’da hatırlat.');
    expect(matcher.stripHeard('Hey Çavuş, saat kaç', 'hey jarvis')).toBe('saat kaç');
    // Baş kısım söze benzemiyorsa metne dokunulmaz.
    expect(matcher.stripHeard('Yarın saat onda hatırlat', 'hey jarvis')).toBe('Yarın saat onda hatırlat');
  });
});

describe('dur-sözcükleri', () => {
  it.each(['Bir dakika.', 'Bi dakika', 'Bir saniye!', 'Bekle.', 'Tamam yeter.', 'Jarvis bir dakika'])('d6: "%s" konuşmayı keser', (text) => {
    expect(isStopCommand(text, matcher.nameKeys)).toBe(true);
  });

  it('d8: dur-sözcüğü Jarvis\'in az önce söylediği metinde geçiyorsa kendi sesidir', () => {
    expect(stopWordsSpoken('Bir saniye.', 'Bir saniye. Takviminize bakıyorum.')).toBe(true);
    expect(stopWordsSpoken('Bi saniye', 'Bir saniye.')).toBe(true);
    expect(stopWordsSpoken('Dor.', 'Şimdi dur ve dinle.')).toBe(true);
    expect(stopWordsSpoken('Dur.', 'Bir saniye. Durum şöyle efendim.')).toBe(false);
    expect(stopWordsSpoken('Bekle.', '')).toBe(false);
  });

  it.each(['Bir dakika, şunu da sorayım', 'Beş dakika sonra hatırlat', 'Bekle beni'])('d6: "%s" dur-sözcüğü değildir', (text) => {
    expect(isStopCommand(text, matcher.nameKeys)).toBe(false);
  });

  it.each([
    'sus',
    'Sus.',
    'SUS!',
    'Süs.',
    'Sos',
    'dur',
    'Dur!',
    'yeter',
    'kes',
    'Tamam sus',
    'tamam, yeter',
    'Sus artık',
    'Jarvis sus',
    'Carvis, dur lütfen',
    'sessiz ol',
    'kes sesini',
    'stop',
  ])('"%s" dur-sözcüğüdür', (text) => {
    expect(isStopCommand(text, matcher.nameKeys)).toBe(true);
  });

  it.each([
    'tamam',
    'Jarvis',
    'dur bir dakika şunu da ekle',
    'susma devam et',
    'durum nedir',
    'ses',
    'siz',
    'söz',
    'yeterli mi sence',
    'kesinlikle',
    'bana uzun bir hikaye anlat',
    '',
  ])('"%s" dur-sözcüğü değildir', (text) => {
    expect(isStopCommand(text, matcher.nameKeys)).toBe(false);
  });
});

describe('kip bitirme', () => {
  it('"tamam, bu kadar" bitirir; başka söz bitirmez', () => {
    expect(isEndOfConversation('Tamam, bu kadar.')).toBe(true);
    expect(isEndOfConversation('bu kadar')).toBe(true);
    expect(isEndOfConversation('bu kadar pahalı mı')).toBe(false);
  });

  it.each([
    'Görüşürüz.',
    'Tamam Jarvis, görüşürüz.',
    'Sohbeti bitir.',
    'Sohbeti bitirelim artık.',
    'Tamam, bu kadar yeter.',
    'Hoşça kal.',
    'Teşekkürler, bu kadar.',
  ])('"%s" sohbeti bitirir', (text) => {
    expect(isEndOfConversation(text, matcher.nameKeys)).toBe(true);
  });

  it.each(['Görüşürüz diye bir film var mı?', 'Sohbeti bitirmeden önce bir şey soracağım', 'Tamam.', 'Bu kadar soru yeter mi sence bugünlük'])(
    '"%s" bitirmez',
    (text) => {
      expect(isEndOfConversation(text, matcher.nameKeys)).toBe(false);
    },
  );

  // Kullanıcı: "Güle güle, bay bay gibi şeyler söylediğimde … sohbeti BİTİRMESİ lazım."
  it.each([
    'Güle güle.',
    'Bay bay.',
    'Bay bay Jarvis.',
    'Bye bye.',
    'Görüşürüz.',
    'Hoşça kal.',
    'Hoşçakalın.',
    'İyi geceler.',
    'Kendine iyi bak.',
    'Sonra konuşuruz.',
    'Kapat artık.',
    'Tamam o zaman, görüşürüz.',
    'Teşekkürler Jarvis, iyi geceler.',
    'Hadi görüşürüz, kendine iyi bak.',
  ])('"%s" vedadır: sohbeti bitirir', (text) => {
    expect(farewellOf(text, matcher.nameKeys)).not.toBeNull();
    expect(isEndOfConversation(text, matcher.nameKeys)).toBe(true);
  });

  it('"iyi geceler" ayrı tanınır (yanıt da "iyi geceler" olur)', () => {
    expect(farewellOf('Tamam, iyi geceler.', matcher.nameKeys)).toBe('night');
    expect(farewellOf('Güle güle.', matcher.nameKeys)).toBe('bye');
    // Komut vedadan ayrıdır: sessiz biter.
    expect(farewellOf('Tamam, bu kadar.', matcher.nameKeys)).toBeNull();
    expect(farewellOf('Sohbeti bitir.', matcher.nameKeys)).toBeNull();
  });

  it.each([
    'Ona güle güle dedim.',
    'Bay bay demeyi unutma diye hatırlat.',
    'Anneme iyi geceler mesajı yaz.',
    'Müziği kapat artık.',
    'Bay Ahmet’i ara.',
    'Yarın görüşürüz diye not al.',
    'İyi akşamlar.',
    'Kendine iyi bak ne demek?',
    'Teşekkürler.',
    'Kaan’la sonra konuşuruz dedik.',
  ])('"%s" veda değildir', (text) => {
    expect(farewellOf(text, matcher.nameKeys)).toBeNull();
    expect(isEndOfConversation(text, matcher.nameKeys)).toBe(false);
  });
});

describe('sohbet kipini başlatma', () => {
  it.each(['Sohbet edelim.', 'Hadi biraz sohbet edelim.', 'Jarvis, konuşalım mı?', 'Seninle sohbet etmek istiyorum.', 'Sohbet kipini aç.', 'Biraz konuşalım.'])(
    '"%s" başlatır',
    (text) => {
      expect(isStartOfConversation(text, matcher.nameKeys)).toBe(true);
    },
  );

  it.each([
    'Şu konuyu konuşalım: yarınki toplantı.',
    'Sohbet edelim diyen kimdi?',
    'Müşteriyle ne konuşalım?',
    'Sohbet',
    'Dün arkadaşlarla sohbet ettik, çok güzeldi.',
  ])('"%s" başlatmaz (model yanıtlar)', (text) => {
    expect(isStartOfConversation(text, matcher.nameKeys)).toBe(false);
  });
});

describe('kalibrasyonda öğrenilen yazımlar', () => {
  const phrases = ['hey jarvis'];

  it('ada benzeyen ama eşleştiricinin tanımadığı yazım öğrenilir', () => {
    expect(matcher.match('Hey Garvis').matched).toBe(false);
    expect(learnableSpelling('Hey Garvis.', phrases, 'Jarvis')).toBe('garvis');
    expect(learnableSpelling('Çarbiz', phrases, 'Jarvis')).toBe('carbiz');
    expect(learnableSpelling('Hey Charles', phrases, 'Jarvis')).toBe('charles');
  });

  it('ada benzemeyen söz, uzun cümle ve gündelik sözcük öğrenilmez', () => {
    expect(learnableSpelling('Merhaba', phrases, 'Jarvis')).toBeNull();
    expect(learnableSpelling('Bugün hava nasıl olacak', phrases, 'Jarvis')).toBeNull();
    expect(learnableSpelling('Hey servis', phrases, 'Jarvis')).toBeNull();
    expect(learnableSpelling('Hey', phrases, 'Jarvis')).toBeNull();
    expect(learnableSpelling('', phrases, 'Jarvis')).toBeNull();
  });

  it('öğrenilen yazım uyandırır; ona yalnız benzeyen söz uyandırmaz', () => {
    const learned = createWakeMatcher(phrases, 'Jarvis', ['garvis']);
    expect(learned.match('Hey Garvis, saat kaç?')).toEqual({ matched: true, phrase: 'hey jarvis', rest: 'saat kaç?' });
    expect(learned.match('Garviz saat kaç')).toMatchObject({ matched: true });
    // Öğrenilen yazıma tek harf uzaklık payı tanınmaz: "marvis", "garlis" uyandırmaz.
    expect(learned.match('Marvis saat kaç').matched).toBe(false);
    expect(learned.match('Garlis saat kaç').matched).toBe(false);
    // Ek almış hali yine seslenme değildir.
    expect(learned.match("Garvis'e söyle").matched).toBe(false);
    // Asıl ad ve payı olduğu gibi çalışır.
    expect(learned.match('Carvis, merhaba').matched).toBe(true);
    expect(learned.match('Jarlis merhaba').matched).toBe(true);
  });
});
